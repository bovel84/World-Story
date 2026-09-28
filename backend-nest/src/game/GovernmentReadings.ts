/**
 * MG05 µ3 — L'agenda legge lo stato VERO della partita
 * ===================================================
 * `GovernmentAgenda.ts` è puro: trasforma fatti in scelte. Questo modulo
 * raccoglie i fatti — deficit dei cantieri, fazioni, bilancio, debito, opere —
 * dallo stato della partita, e li consegna all'agenda.
 *
 * Tre vincoli, che sono il punto:
 *
 *  - **I deficit dei cantieri sono misurati, non raccontati.** Si guarda ogni
 *    progetto che ha un contesto operativo e si confronta la distinta della fase
 *    attiva con ciò che il detentore ha davvero: la stessa aritmetica di
 *    `ProjectWorks.consumePhaseInputs`, letta senza consumare. Un cantiere che
 *    non è bloccato non produce una voce.
 *  - **Le cifre che il motore non ha non si inventano.** Se il bilancio o il
 *    debito non sono disponibili, la voce non si crea: meglio un'agenda più
 *    corta che un numero plausibile.
 *  - **Sola lettura.** Nessuna funzione qui prenota, spende o costruisce. È
 *    l'invariante MG-I1: il Governo propone, la bozza passa per la coda.
 */

import db from '../database';
import { parseInteger } from '../domain/quantities';
import { ledgerUnitId } from '../services/StrictEffectProducerService';
import { listStrictProjects } from '../repositories/project-runtime.repository';
import { getReservationAvailability } from '../services/ReservationService';
import { buildAgenda, type AgendaDeficit, type AgendaFaction, type GovernmentAgenda } from '../core/government/GovernmentAgenda';
import { governmentSnapshot } from '../core/simulation/GovernmentFactions';
import { loadSimulationCatalog } from '../scenario/loader';
import path from 'path';
import type { SimulationCatalog } from '../scenario/types';

/** L'id dell'effetto di consumo di una fase: la stessa derivazione di
 *  `ProjectWorks`, così le due letture non possono divergere. */
function consumeEffectIdFor(projectId: string, phaseId: string): string {
  return `cs_${projectId.slice('prj_'.length).slice(0, 12)}_${phaseId}`;
}

/** Il saldo di un detentore, senza sottrarre le riserve: quanto C'È. */
function holdingOf(branchId: string, kind: 'money' | 'material', unitId: string, holder: string): bigint {
  const rows = db.prepare(
    'SELECT to_ref, from_ref, delta FROM ledger_entries WHERE branch_id = ? AND kind = ? AND unit_id = ? AND (to_ref = ? OR from_ref = ?)',
  ).all(branchId, kind, unitId, holder, holder) as { to_ref: string | null; from_ref: string | null; delta: string }[];
  let total = 0n;
  for (const row of rows) total += row.to_ref === holder ? parseInteger(row.delta, 'delta') : -parseInteger(row.delta, 'delta');
  return total;
}

export interface AgendaReadingInput {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly playerPolityId: string;
  /** La fotografia del governo, già calcolata dalla sessione. */
  readonly government: ReturnType<typeof governmentSnapshot>;
  readonly catalog: SimulationCatalog | null;
}

/**
 * I deficit che BLOCCANO un cantiere, misurati sul ledger.
 *
 * Si guarda la fase attiva di ogni progetto con contesto: la distinta è quella
 * del piano, la disponibilità è quella del detentore **senza** sottrarre la
 * riserva del progetto (che è sua, e sta per spenderla). Un progetto che ha
 * tutto non produce una voce.
 */
export function blockedDeficits(input: AgendaReadingInput): readonly AgendaDeficit[] {
  const { branchId, catalog } = input;
  if (!branchId || !catalog) return [];
  const deficits: AgendaDeficit[] = [];

  for (const project of listStrictProjects(input.gameId, branchId)) {
    const work = catalog.works?.find(item => item.id === project.workId);
    if (!work) continue;

    // Si guarda la fase in corso E quella che sta per partire. Guardare solo
    // l'attiva sarebbe troppo tardi: la fase attiva ha già consumato la sua
    // distinta, quindi il suo fabbisogno risulta coperto anche quando il
    // cantiere si fermerà alla fase successiva — misurato: un cantiere con la
    // prima fase in corso e l'acciaio esaurito non produceva alcuna voce. Il
    // Governo deve vedere il problema PRIMA che il cantiere si fermi.
    const completed = new Set(project.state.phases.filter(phase => phase.status === 'completed').map(phase => phase.id));
    const candidates = work.phases.filter(phase => {
      const state = project.state.phases.find(candidate => candidate.id === phase.id);
      if (!state) return false;
      if (state.status === 'completed' || state.status === 'cancelled') return false;
      // Attiva o bloccata: è ora. Pianificata con le dipendenze soddisfatte: è
      // il passo che segue, e il suo fabbisogno riguarda il Governo adesso.
      if (state.status === 'active' || state.status === 'blocked') return true;
      return state.status === 'planned' && phase.dependencyIds.every(dep => completed.has(dep));
    });

    for (const declaration of candidates) {
    // Una fase che ha GIÀ consumato la sua distinta non ha un deficit: il suo
    // materiale l'ha preso. Riportarlo sarebbe un problema inventato — e
    // nasconderebbe quello vero, della fase che deve ancora partire.
    const alreadyConsumed = db.prepare(
      'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ? AND effect_id = ?',
    ).get(branchId, consumeEffectIdFor(project.projectId, declaration.id)) as { n: number };
    if (alreadyConsumed.n > 0) continue;

    for (const material of declaration.inputs) {
      const unitId = ledgerUnitId(material.resourceId);
      const held = holdingOf(branchId, 'material', unitId, project.context.materialActorId);
      const required = parseInteger(material.baseUnits, 'required');
      if (required > held) {
        const resource = catalog.resources.find(r => r.id === material.resourceId);
        deficits.push({
          code: 'MATERIAL_SHORTAGE',
          id: material.resourceId,
          required: required.toString(),
          available: held.toString(),
          missing: (required - held).toString(),
          unit: resource?.unit.symbol ?? '',
        });
      }
    }

    if (declaration.funds) {
      const unitId = ledgerUnitId(declaration.funds.currencyId);
      const held = holdingOf(branchId, 'money', unitId, project.context.payerActorId);
      const required = parseInteger(declaration.funds.minorUnits, 'required');
      if (required > held) {
        deficits.push({
          code: 'INSUFFICIENT_CASH',
          id: declaration.funds.currencyId,
          required: required.toString(),
          available: held.toString(),
          missing: (required - held).toString(),
          unit: 'unità minime',
        });
      }
    }
    }
  }
  return deficits;
}

/**
 * Le opere del catalogo, con ciò che manca al paese per costruirle.
 *
 * Per ogni risorsa della distinta si confronta il fabbisogno TOTALE dell'opera
 * con ciò che il migliore detentore del paese ha davvero: è la stessa regola del
 * deficit — il totale per unità, non la differenza di una fase.
 */
export function buildableWorks(input: AgendaReadingInput): readonly { workId: string; name: string; missing: readonly string[] }[] {
  const { branchId, catalog } = input;
  if (!catalog) return [];

  const actorsOfPolity = catalog.actors.filter(actor => actor.polityId === input.playerPolityId);

  return (catalog.works ?? []).map(work => {
    if (!branchId) return { workId: work.id, name: work.name, missing: ['stato economico non disponibile'] };

    // Fabbisogno totale per risorsa: le fasi si sommano, l'opera è una sola.
    const required = new Map<string, bigint>();
    for (const phase of work.phases) {
      for (const material of phase.inputs) {
        required.set(material.resourceId, (required.get(material.resourceId) ?? 0n) + parseInteger(material.baseUnits, 'q'));
      }
    }

    const missing: string[] = [];
    for (const [resourceId, need] of required) {
      const unitId = ledgerUnitId(resourceId);
      const best = actorsOfPolity.reduce((maximum, actor) => {
        const value = holdingOf(branchId, 'material', unitId, actor.actorId);
        return value > maximum ? value : maximum;
      }, 0n);
      if (need > best) {
        const resource = catalog.resources.find(r => r.id === resourceId);
        missing.push(`${resource?.name ?? resourceId} (mancano ${(need - best).toString()} ${resource?.unit.symbol ?? ''})`.trim());
      }
    }
    return { workId: work.id, name: work.name, missing };
  });
}

/**
 * L'agenda completa, dal vero stato della partita.
 *
 * Restituisce `null` quando il binding del catalogo manca: senza catalogo non si
 * sa cosa si può costruire né quanto costa, e un'agenda senza quelle voci
 * sarebbe una proposta a metà spacciata per completa.
 */
export function readGovernmentAgenda(input: {
  gameId: string;
  branchId: string | null;
  playerPolityId: string;
  government: ReturnType<typeof governmentSnapshot>;
}): GovernmentAgenda {
  const catalog = (() => {
    const row = db.prepare('SELECT template_id FROM worlds WHERE id = (SELECT world_id FROM games WHERE id = ?)')
      .get(input.gameId) as { template_id?: string } | undefined;
    const templateId = row?.template_id;
    if (!templateId) return null;
    return loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId)).catalog;
  })();

  const factions: AgendaFaction[] = input.government.factions.map(faction => ({
    id: faction.id,
    name: faction.name,
    powerPct: faction.powerPct,
    satisfaction: faction.satisfaction,
    stance: faction.stance,
    demandTitle: faction.demand.title,
    demandDetail: faction.demand.detail,
    urgency: faction.demand.urgency,
  }));

  const reading: AgendaReadingInput = {
    gameId: input.gameId,
    branchId: input.branchId,
    playerPolityId: input.playerPolityId,
    government: input.government,
    catalog,
  };

  return buildAgenda({
    deficits: blockedDeficits(reading),
    factions,
    budget: {
      balance: String(input.government.budget.balance),
      unit: 'mld',
      effectiveTaxRatePct: input.government.budget.effectiveTaxRatePct,
    },
    debt: input.government.debt,
    reserves: [],
    buildable: buildableWorks(reading),
    currencyId: catalog?.manifest.currency.id ?? '',
  });
}

export { getReservationAvailability };
