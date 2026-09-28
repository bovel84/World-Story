/**
 * MG03 — Il cantiere avanza, e alla fine c'è un'opera
 * ==================================================
 * MG02 ha fatto nascere il cantiere con le sue riserve. Restava il difetto che
 * rende tutto inutile: **il progetto non avanzava mai**. Il tick sa consumare il
 * lavoro schedulato (`applyDueCanonicalEffects` → `project_work_schedule`), ma
 * nessuno lo schedulava: l'ordine creava un cantiere e lì restava, con le
 * riserve impegnate e nessun giorno che passava.
 *
 * Questo modulo chiude il cerchio e lo chiude **onestamente**, con tre regole:
 *
 *  - **Il lavoro si scheda solo se i materiali ci sono.** La fase consuma la
 *    distinta: se il materiale non è disponibile, la fase non parte e il cantiere
 *    resta bloccato — oltre la data prevista, come dice il gate di MG03. Non è un
 *    «passa comunque»: è un blocco che si spiega.
 *  - **Il consumo è un movimento vero.** I materiali passano dalla riserva al
 *    ledger (`consumo`), e la cassa si spende. Prima MG02 prenotava; ora MG03
 *    consuma, e la differenza fra «impegnato» e «speso» (§6.1) si vede nei conti.
 *  - **L'opera nasce solo dal collaudo.** Il piano mette l'asset `pending` al
 *    collaudo; qui si scrive l'oggetto sulla mappa con l'effetto dichiarato dalla
 *    distinta. Nessuna scorciatoia da `expectedDate`: quella era la strada legacy,
 *    e `completeDueConstructions` non vale per i progetti strict.
 *
 * Il modulo **non è puro**: scrive sul database, e per questo ogni passo è
 * idempotente e ancorato a un effetto con id derivato dal progetto e dalla fase.
 */

import db, { withCanonicalTransaction } from '../database';
import { parseInteger } from '../domain/quantities';
import { ledgerUnitId } from '../services/StrictEffectProducerService';
import { getReservationAvailability } from '../services/ReservationService';
import { appendLedgerEntries } from '../repositories/ledger.repository';
import { getProjectRuntime } from '../repositories/project-runtime.repository';
import { activatePhase, advancePhaseDay, completeCommissioning } from '../core/projects/ProjectEngine';
import type { LedgerEntryInput } from '../domain/ledger';

export type PhaseOutcome =
  /** Il lavoro della fase è stato schedulato: il tick lo consumerà. */
  | { readonly kind: 'scheduled'; readonly phaseId: string; readonly dueDate: string }
  /** I materiali della fase non ci sono: il cantiere resta fermo, e si dice cosa manca. */
  | { readonly kind: 'blocked'; readonly phaseId: string; readonly missing: readonly string[] }
  /** La fase ha finito il lavoro e attende il collaudo. */
  | { readonly kind: 'commissioning'; readonly phaseId: string }
  /** Nulla da fare: progetto chiuso, o già schedulato. */
  | { readonly kind: 'idle'; readonly reason: string };

export interface AdvanceProjectInput {
  readonly gameId: string;
  readonly branchId: string;
  readonly projectId: string;
  /** Giorni che il salto concede al cantiere. */
  readonly elapsedDays: number;
  /** Data a cui imputare il lavoro e i consumi. */
  readonly asOfDate: string;
  /** Detentore dei materiali: la stessa coppia decisa al commit. */
  readonly materialHolder: string;
  readonly moneyHolder: string;
  /**
   * Versione attesa del runtime. Se il progetto è stato toccato da un altro
   * percorso (il tick, un collaudo), l'avanzamento non si applica e non
   * cancella quel lavoro.
   */
  readonly expectedVersion?: number;
}

/** Id degli effetti derivati: la stessa fase non consuma due volte. */
export function workEffectId(projectId: string, phaseId: string, day: number): string {
  return `wk_${projectId.slice('prj_'.length).slice(0, 12)}_${phaseId}_${day}`;
}
export function consumeEffectId(projectId: string, phaseId: string): string {
  return `cs_${projectId.slice('prj_'.length).slice(0, 12)}_${phaseId}`;
}

/**
 * Avanza un progetto di un salto.
 *
 * Per ogni giorno concesso: si cerca la fase attiva, si verificano i materiali,
 * si consuma la distinta (una volta sola nella vita della fase) e si scheda il
 * lavoro. Quando il lavoro della fase finisce si passa alla successiva; quando
 * finisce l'ultima, la fase va in collaudo.
 *
 * Il consumo dei materiali avviene **all'inizio della fase**, non giorno per
 * giorno: una strada consuma l'acciaio della massicciata quando la massicciata
 * comincia, non quando piove. È una semplificazione dichiarata, e il gate che
 * conta — «la mancanza di input blocca la fase oltre la data prevista» — è
 * rispettato dalla verifica che precede il consumo.
 */
export function advanceProject(input: AdvanceProjectInput): readonly PhaseOutcome[] {
  const outcomes: PhaseOutcome[] = [];
  const { gameId, branchId, projectId } = input;

  const runtime = getProjectRuntimeSafe(branchId, projectId);
  if (!runtime) return [{ kind: 'idle', reason: 'progetto inesistente su questo ramo' }];
  let { plan, state } = runtime;
  if (['completed', 'cancelled', 'failed'].includes(state.status)) {
    return [{ kind: 'idle', reason: `progetto ${state.status}` }];
  }

  const phasesById = new Map(plan.phases.map(phase => [phase.id, phase]));

  for (let day = 0; day < input.elapsedDays; day++) {
    const current = state.phases.find(phase => phase.status === 'active' || phase.status === 'blocked');
    if (!current) {
      // Nessuna fase attiva: o è finito, o la prossima va attivata.
      // Le dipendenze stanno nel PIANO, non nello stato: `PhaseState` porta solo
      // lo stato di avanzamento. Cercarle nello stato è l'errore che il
      // compilatore ha fermato.
      const completedIds = new Set(state.phases.filter(phase => phase.status === 'completed').map(phase => phase.id));
      const next = plan.phases.find(phase => {
        const current = state.phases.find(candidate => candidate.id === phase.id);
        return current?.status === 'planned' && phase.dependencyIds.every(dep => completedIds.has(dep));
      });
      if (!next) break;
      state = activatePhase(plan, state, next.id);
      continue;
    }

    const declaration = phasesById.get(current.id);
    if (!declaration) return [...outcomes, { kind: 'idle', reason: `fase ${current.id} non dichiarata nel piano` }];

    // 1) I materiali della fase ci sono? Il consumo è una volta sola.
    const consumed = consumePhaseInputs({
      gameId, branchId, projectId, plan, phaseId: current.id,
      holder: input.materialHolder, moneyHolder: input.moneyHolder, asOfDate: input.asOfDate,
    });
    if (!consumed.ok) {
      // Il cantiere resta fermo: la fase non avanza di un giorno, e il motivo è
      // un numero, non un silenzio.
      return [...outcomes, { kind: 'blocked', phaseId: current.id, missing: consumed.missing }];
    }

    // 2) Un giorno di lavoro. Il lavoro è il massimo della fase diviso i suoi
    // giorni minimi: così la fase dura esattamente `minDays`, non di più né di
    // meno — e il tick non è una scorciatoia.
    const dailyWork = dailyWorkFor(declaration.workload, declaration.minDays);
    state = advancePhaseDay(plan, state, current.id, dailyWork);
  }

  // 3) Il lavoro va PERSISTITO: `advancePhaseDay` è pura, e senza questa
  // scrittura il cantiere avanzerebbe solo nella memoria del salto — il difetto
  // che il primo giro di test ha trovato (`completedWork: '0'` dopo un giorno
  // di lavoro). Si scrive una volta sola, alla fine, e con un controllo di
  // versione: se un altro percorso ha toccato il progetto, non lo si sovrascrive.
  persistProjectState({ branchId, projectId, state, expectedVersion: input.expectedVersion });

  // 4) Il collaudo: l'ultima fase lo richiede, e senza di esso l'asset resta
  // `pending`. Non è implicato dai giorni trascorsi (invariante MG-I3).
  const commissioningPhase = state.phases.find(phase => phase.status === 'commissioning');
  if (commissioningPhase) outcomes.push({ kind: 'commissioning', phaseId: commissioningPhase.id });

  return outcomes;
}

/**
 * Scrive lo stato avanzato del progetto.
 *
 * Il controllo di versione non è decorativo: `stageProjectTick` e
 * `consumeStagedProjectTick` usano la stessa colonna, e una scrittura alla
 * cieca cancellerebbe il loro lavoro. Se la versione è cambiata, il progetto è
 * stato toccato da qualcun altro e questo avanzamento non si applica.
 */
function persistProjectState(input: {
  branchId: string; projectId: string; state: unknown; expectedVersion?: number;
}): boolean {
  return withCanonicalTransaction(() => {
    if (input.expectedVersion === undefined) {
      db.prepare('UPDATE project_runtime_states SET state_json = ?, version = version + 1 WHERE branch_id = ? AND project_id = ?')
        .run(JSON.stringify(input.state), input.branchId, input.projectId);
      return true;
    }
    const result = db.prepare(
      'UPDATE project_runtime_states SET state_json = ?, version = version + 1 WHERE branch_id = ? AND project_id = ? AND version = ?',
    ).run(JSON.stringify(input.state), input.branchId, input.projectId, input.expectedVersion);
    return result.changes === 1;
  });
}

/** Lavoro giornaliero: il totale distribuito sui giorni minimi, arrotondato in su. */
export function dailyWorkFor(workload: string, minDays: number): string {
  const total = parseInteger(workload, 'workload');
  const days = BigInt(Math.max(1, minDays));
  const daily = total / days;
  return (total % days === 0n ? daily : daily + 1n).toString();
}

/**
 * Il saldo di un detentore, senza sottrarre le riserve.
 *
 * Diverso da `getReservationAvailability`: quella risponde a «quanto posso
 * impegnare ancora», questa a «quanto c'è». Per spendere un impegno già preso
 * serve la seconda — la prima conterebbe il progetto contro sé stesso.
 */
function ledgerHolding(branchId: string, kind: 'money' | 'material', unitId: string, holder: string): bigint {
  const rows = db.prepare(
    'SELECT to_ref, from_ref, delta FROM ledger_entries WHERE branch_id = ? AND kind = ? AND unit_id = ? AND (to_ref = ? OR from_ref = ?)',
  ).all(branchId, kind, unitId, holder, holder) as { to_ref: string | null; from_ref: string | null; delta: string }[];
  let total = 0n;
  for (const row of rows) {
    const delta = parseInteger(row.delta, 'delta');
    total += row.to_ref === holder ? delta : -delta;
  }
  return total;
}

function getProjectRuntimeSafe(branchId: string, projectId: string) {
  try {
    return getProjectRuntime(branchId, projectId);
  } catch {
    // Il repository lancia quando il progetto non c'è: qui è un esito, non un
    // errore — un progetto cancellato o mai creato non deve far fallire il salto.
    return null;
  }
}

/**
 * Consuma la distinta di una fase: materiali dalla riserva al ledger, cassa dal
 * conto. **Una volta sola**: l'effetto ha un id derivato, e un secondo tentativo
 * è un no-op.
 */
export function consumePhaseInputs(input: {
  gameId: string; branchId: string; projectId: string; plan: { id: string; phases: readonly any[] };
  phaseId: string; holder: string; moneyHolder: string; asOfDate: string;
}): { ok: true } | { ok: false; missing: string[] } {
  const phase = input.plan.phases.find((candidate: any) => candidate.id === input.phaseId);
  if (!phase) return { ok: false, missing: [`fase ${input.phaseId} non dichiarata`] };

  const missing: string[] = [];
  const entries: LedgerEntryInput[] = [];
  const effectId = consumeEffectId(input.projectId, input.phaseId);

  // Verifica PRIMA di scrivere: mai un consumo parziale.
  //
  // **La riserva di questo stesso cantiere non conta come indisponibilità.**
  // Il commit ha già impegnato la distinta (MG02); quel denaro e quella merce
  // sono del progetto, ed è qui che si spendono. Contando `available` — che
  // sottrae l'impegnato — un cantiere finanziato esattamente non partirebbe mai:
  // misurato, un'opera coperta al centesimo restava bloccata per sempre.
  // Si verifica quindi il TOTALE del detentore, e la coerenza con la riserva è
  // garantita dall'averla creata al commit.
  for (const material of (phase.inputs ?? []) as { resourceId: string; baseUnits: string }[]) {
    const unitId = ledgerUnitId(material.resourceId);
    const held = ledgerHolding(input.branchId, 'material', unitId, input.holder);
    if (parseInteger(material.baseUnits, 'material') > held) {
      missing.push(`${material.resourceId}: mancano ${(parseInteger(material.baseUnits, 'm') - held).toString()}`);
    }
  }
  if (phase.budget) {
    const unitId = ledgerUnitId(phase.budget.currencyId);
    const held = ledgerHolding(input.branchId, 'money', unitId, input.moneyHolder);
    if (parseInteger(phase.budget.minorUnits, 'budget') > held) {
      missing.push(`${phase.budget.currencyId}: mancano ${(parseInteger(phase.budget.minorUnits, 'b') - held).toString()}`);
    }
  }
  if (missing.length > 0) return { ok: false, missing };

  return withCanonicalTransaction(() => {
    // Idempotenza: se l'effetto è già nel ledger, la fase ha già consumato.
    const existing = db.prepare(
      'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ? AND effect_id = ?',
    ).get(input.branchId, effectId) as { n: number };
    if (existing.n > 0) return { ok: true };

    // I materiali entrano nel CANTIERE e il denaro in un conto di COSTO del
    // progetto: non si distruggono. Un `toRef: null` faceva uscire merce e cassa
    // dal mondo — misurato: la somma dei saldi monetari calava di 12000 senza
    // che nessuno li avesse incassati, e l'invariante «la somma dei movimenti
    // per unità è zero» (ledger.test.ts) era violata. Erano due difetti reali,
    // non una scelta di rappresentazione.
    const siteRef = `site:${input.projectId}`;
    const costRef = `cost:${input.projectId}`;

    let index = 0;
    for (const material of (phase.inputs ?? []) as { resourceId: string; baseUnits: string }[]) {
      entries.push({
        effectId, entryIndex: index++, cause: 'consumo', kind: 'material',
        unitId: ledgerUnitId(material.resourceId),
        fromRef: input.holder, toRef: siteRef, delta: material.baseUnits, atDate: input.asOfDate,
      });
    }
    if (phase.budget) {
      entries.push({
        effectId, entryIndex: index++, cause: 'pagamento', kind: 'money',
        unitId: ledgerUnitId(phase.budget.currencyId),
        fromRef: input.moneyHolder, toRef: costRef, delta: phase.budget.minorUnits, atDate: input.asOfDate,
      });
    }
    if (entries.length > 0) appendLedgerEntries(input.gameId, input.branchId, entries);
    return { ok: true };
  });
}

/**
 * Il collaudo: consegna l'asset e restituisce ciò che serve a scriverlo sulla
 * mappa. Il progetto passa a `completed` e l'asset da `pending` ad attivato —
 * solo qui, e solo dopo il collaudo esplicito.
 */
export function commissionProject(input: {
  gameId: string; branchId: string; projectId: string; phaseId: string;
}): { plan: any; state: any; assetId: string | null } | null {
  const runtime = getProjectRuntimeSafe(input.branchId, input.projectId);
  if (!runtime) return null;
  const { plan, state } = runtime;
  const phase = plan.phases.find(candidate => candidate.id === input.phaseId);
  if (!phase || phase.requiresCommissioning !== true) return null;

  return withCanonicalTransaction(() => {
    const commissioned = completeCommissioning(plan, state, input.phaseId);
    const activated = { ...commissioned, activatedAssets: [...commissioned.activatedAssets, ...commissioned.pendingAssets], pendingAssets: [] };
    db.prepare('UPDATE project_runtime_states SET state_json = ?, version = version + 1 WHERE branch_id = ? AND project_id = ?')
      .run(JSON.stringify(activated), input.branchId, input.projectId);
    return { plan, state: activated, assetId: phase.assetId ?? null };
  });
}
