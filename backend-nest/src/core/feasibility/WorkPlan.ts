/**
 * MG02 µ2 — Dalla distinta dell'opera al piano di progetto
 * =======================================================
 * Fino a qui il motore sapeva **valutare** una costruzione e **misurare** il
 * deficit, ma un ordine autorizzato non diventava nulla: `createProjectRuntime`
 * non aveva alcun chiamante applicativo. Questo modulo è il primo pezzo che
 * colma quel vuoto, e lo fa **in modo puro**: nessun database, nessuna
 * transazione, nessun LLM. Trasforma una distinta del catalogo in un
 * `ProjectPlan` che `ProjectEngine` accetta.
 *
 * Tre scelte, tutte vincolate dal codice esistente:
 *  - **Il collaudo è obbligatorio sull'ultima fase.** `requiresCommissioning:
 *    true` significa che la fase si chiude in `commissioning` e l'asset resta
 *    `pending` finché non c'è un collaudo esplicito: è l'invariante MG-I3, «gli
 *    oggetti non nascono dalla prosa». Una strada non è pronta perché i giorni
 *    sono passati.
 *  - **Gli id sono canonici.** `ProjectPlan.id` e ogni `ProjectPhase.id` passano
 *    da `isIdString` (minuscolo, `[a-z0-9_]`), e l'ordine arriva con id
 *    generati: la derivazione è deterministica e sanificata, non una
 *    concatenazione che può produrre un id rifiutato dal motore.
 *  - **Il piano porta la distinta, non la consuma.** `budget` e `inputs`
 *    restano sul piano come dati dichiarati: chi li consuma è il tick, e chi li
 *    prenota è il commit. Scriverli qui non spende nulla.
 */

import crypto from 'crypto';
import { isIdString, parseInteger } from '../../domain/quantities';
import type { ProjectPlan, ProjectPhase, ProjectState } from '../projects/ProjectEngine';
import { activatePhase, authorizeProject, createProject } from '../projects/ProjectEngine';
import type { WorkDefinition } from '../../scenario/types';

export class WorkPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkPlanError';
  }
}

/**
 * Id di progetto derivato dall'ordine, in modo **deterministico**: lo stesso
 * ordine produce lo stesso progetto, quindi un retry non ne crea un secondo.
 * Il digest evita sia il troncamento (che farebbe collidere due ordini lunghi)
 * sia l'id non canonico (un ordine può iniziare con una cifra).
 */
export function projectIdForOrder(orderId: string): string {
  if (!orderId || typeof orderId !== 'string') throw new WorkPlanError('orderId obbligatorio per derivare il progetto');
  const digest = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 16);
  const id = `prj_${digest}`;
  if (!isIdString(id)) throw new WorkPlanError(`id progetto derivato non canonico: ${id}`);
  return id;
}

/**
 * Il piano di progetto di un'opera del catalogo.
 *
 * Le fasi conservano l'ordine dichiarato e le dipendenze dichiarate; la durata
 * minima è quella della distinta (`minDays`) e il lavoro quello dichiarato
 * (`workload`). L'`assetId` dell'ultima fase è il tipo d'asset dell'opera: è
 * ciò che il collaudo rende operativo.
 */
export function planFromWork(work: WorkDefinition, projectId: string): ProjectPlan {
  if (!isIdString(projectId)) throw new WorkPlanError(`projectId non canonico: ${projectId}`);
  if (!work.phases.length) throw new WorkPlanError(`opera ${work.id} senza fasi`);

  const lastPhaseId = work.phases[work.phases.length - 1].id;

  const phases: ProjectPhase[] = work.phases.map(phase => {
    if (!isIdString(phase.id)) throw new WorkPlanError(`id di fase non canonico: ${phase.id}`);
    // Il collaudo si richiede sull'ULTIMA fase: è il confine oltre il quale
    // l'asset diventa operativo, e nessuna fase intermedia deve poterlo
    // anticipare.
    const requiresCommissioning = phase.id === lastPhaseId;
    return {
      id: phase.id,
      dependencyIds: [...phase.dependencyIds],
      workload: phase.workload,
      minDays: phase.minDays,
      ...(phase.funds ? { budget: { currencyId: phase.funds.currencyId, minorUnits: phase.funds.minorUnits } } : {}),
      inputs: phase.inputs.map(input => ({ resourceId: input.resourceId, baseUnits: input.baseUnits })),
      ...(requiresCommissioning ? { assetId: work.assetTypeId } : {}),
      requiresCommissioning,
    };
  });

  // `validateProjectPlan` è l'arbitro: se la distinta del catalogo produce un
  // piano che il motore dei progetti rifiuta, l'errore deve uscire QUI e non a
  // metà di una transazione.
  // Il piano porta con sé l'OPERA da cui nasce: senza, un avanzamento non
  // saprebbe quale distinta consumare né che cosa consegnare. Il campo non è
  // nel tipo di `ProjectPlan` (che è del motore progetti e non conosce le
  // opere), ed è dichiarato qui come parte del piano persistito.
  return { id: projectId, workId: work.id, phases } as ProjectPlan & { workId: string };
}

/**
 * Lo stato iniziale di un progetto autorizzato: pronto, con la prima fase
 * attiva. Le fasi senza dipendenze sono quelle che possono partire; se ce n'è
 * più d'una, si attiva la prima dichiarata — l'ordine del catalogo è la
 * sequenza, e attivarne una sola è la scelta conservativa: nessun lavoro
 * parte in parallelo senza che qualcuno lo abbia deciso.
 */
export function authorizedStateFor(plan: ProjectPlan): ProjectState {
  const first = plan.phases.find(phase => phase.dependencyIds.length === 0) ?? plan.phases[0];
  if (!first) throw new WorkPlanError('piano senza fasi');
  const created = createProject(plan);
  const authorized = authorizeProject(created);
  return activatePhase(plan, authorized, first.id);
}

/** Piano e stato insieme: è la coppia che `createProjectRuntime` persiste. */
export function runtimeFor(work: WorkDefinition, orderId: string): { plan: ProjectPlan; state: ProjectState } {
  const plan = planFromWork(work, projectIdForOrder(orderId));
  return { plan, state: authorizedStateFor(plan) };
}

/**
 * Il costo dell'opera in cassa, in unità minime, per la prenotazione.
 * Somma i fondi di TUTTE le fasi: il denaro è fungibile e il fabbisogno di un
 * progetto è il suo totale — è la stessa regola del deficit materiale, e non
 * un residuo fase per fase.
 */
export function totalFundsFor(work: WorkDefinition): { currencyId: string; minorUnits: string } | null {
  const funds = work.phases.filter(phase => phase.funds).map(phase => phase.funds!);
  if (!funds.length) return null;
  const currencyId = funds[0].currencyId;
  for (const entry of funds) {
    // Valute eterogenee non si sommano (§6.1): si rifiuta invece di arrotondare.
    if (entry.currencyId !== currencyId) {
      throw new WorkPlanError(`l'opera ${work.id} chiede due valute diverse: ${currencyId}, ${entry.currencyId}`);
    }
  }
  const total = funds.reduce((sum, entry) => sum + parseInteger(entry.minorUnits, 'funds'), 0n);
  return { currencyId, minorUnits: total.toString() };
}

/**
 * I materiali dell'opera per unità, aggregati come il deficit: la prenotazione
 * è sul totale, e il cantiere non distingue più la fase quando impegna.
 */
export function totalMaterialsFor(work: WorkDefinition): readonly { resourceId: string; baseUnits: string }[] {
  const totals = new Map<string, bigint>();
  for (const phase of work.phases) {
    for (const input of phase.inputs) {
      totals.set(input.resourceId, (totals.get(input.resourceId) ?? 0n) + parseInteger(input.baseUnits, 'input'));
    }
  }
  return [...totals.entries()].map(([resourceId, baseUnits]) => ({ resourceId, baseUnits: baseUnits.toString() }));
}
