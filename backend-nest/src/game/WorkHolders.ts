/**
 * MG02 µ6 — Chi paga e chi ha i materiali, decisi dal server
 * =========================================================
 * Il client non deve scegliere i detentori di un impegno: sono un fatto dello
 * stato economico, non una preferenza dell'interfaccia. Ma la dichiarazione
 * d'opera (`PendingWorkOrder`) li richiede, perché il commit deve sapere su
 * quali conti prenotare.
 *
 * Questo modulo li **risolve** dal catalogo e dal ledger del ramo, e li espone
 * con la valutazione: il client li riceve e li rimanda indietro tali e quali.
 * Non è un giro inutile — è il server che decide, e il client che li rimanda non
 * li inventa: se li alterasse, `applyWorkCommits` li rifiuterebbe perché non
 * appartengono alla polity del giocatore.
 *
 * Due ruoli distinti, perché nella realtà lo sono (misurato: la cassa sta sulla
 * tesoreria della polity, acciaio e utensili sull'impresa):
 *  - **il pagatore** è la tesoreria della polity, come per ogni altro percorso
 *    economico (`bindStrictEconomy`);
 *  - **il detentore dei materiali** è l'attore della polity che ha davvero la
 *    disponibilità per TUTTI i materiali dell'opera. Se nessuno li copre tutti,
 *    non c'è un detentore: l'opera non è finanziabile, e va detto.
 *
 * Modulo di sola lettura: non prenota, non spende, non muta.
 */

import { readAvailability } from './FeasibilityReadings';
import { ledgerUnitId } from '../services/StrictEffectProducerService';
import { totalMaterialsFor } from '../core/feasibility/WorkPlan';
import { parseInteger } from '../domain/quantities';
import type { SimulationCatalog, WorkDefinition } from '../scenario/types';

export interface WorkHolders {
  /** Chi impegna la cassa: la tesoreria della polity. */
  readonly payerActorId: string;
  /** Chi ha i materiali dell'opera, se qualcuno li copre tutti. */
  readonly materialActorId: string | null;
  /** Materiali che nessun attore della polity copre, con quanto manca. */
  readonly missingMaterials: readonly { readonly resourceId: string; readonly missing: string }[];
  /** Motivo leggibile quando non c'è un detentore unico. */
  readonly note?: string;
}

/**
 * Risolve i detentori di un'opera per una polity.
 *
 * Il detentore dei materiali è **uno solo** perché il commit ne accetta uno: se
 * due attori diversi coprissero materiali diversi, servirebbe una mappa
 * risorsa→detentore, che è lavoro di una fase successiva. Qui si preferisce
 * dichiarare il limite invece di scegliere arbitrariamente il primo attore.
 */
export function resolveWorkHolders(
  catalog: SimulationCatalog,
  branchId: string | null,
  polityId: string,
  work: WorkDefinition,
): WorkHolders {
  const payer = catalog.actors.find(actor => actor.polityId === polityId && actor.type === 'treasury');
  const materials = totalMaterialsFor(work);

  if (!payer) {
    return {
      payerActorId: '', materialActorId: null, missingMaterials: [],
      note: 'la nazione non ha una tesoreria nel catalogo: nessun conto su cui impegnare',
    };
  }

  if (materials.length === 0) {
    return { payerActorId: payer.actorId, materialActorId: payer.actorId, missingMaterials: [] };
  }

  if (!branchId) {
    return {
      payerActorId: payer.actorId, materialActorId: null, missingMaterials: [],
      note: 'stato economico non disponibile: il possesso dei materiali non è verificabile',
    };
  }

  // Gli attori della polity, esclusa la tesoreria (che è il pagatore, non il
  // magazzino: §4.3.1, il settore privato non è il magazzino del governo).
  const candidates = catalog.actors.filter(actor => actor.polityId === polityId && actor.type !== 'treasury');

  let best: { actorId: string; missing: { resourceId: string; missing: string }[] } | null = null;
  for (const candidate of candidates) {
    const readings = readAvailability(branchId, candidate.actorId, catalog);
    const byResource = new Map(readings.stock.map(item => [item.unitId, parseInteger(item.available, 'stock')]));
    const missing: { resourceId: string; missing: string }[] = [];
    for (const material of materials) {
      const available = byResource.get(ledgerUnitId(material.resourceId)) ?? 0n;
      const required = parseInteger(material.baseUnits, 'material');
      if (required > available) missing.push({ resourceId: material.resourceId, missing: (required - available).toString() });
    }
    if (missing.length === 0) {
      // Copre tutto: è il detentore. Non si cerca «il migliore», si cerca chi
      // può: se più di uno copre, il primo in ordine di catalogo — e l'ordine
      // del catalogo è dichiarato, non casuale.
      return { payerActorId: payer.actorId, materialActorId: candidate.actorId, missingMaterials: [] };
    }
    // Ricorda il candidato con meno mancanze, per dire QUANTO manca.
    if (!best || missing.length < best.missing.length) best = { actorId: candidate.actorId, missing };
  }

  return {
    payerActorId: payer.actorId,
    materialActorId: null,
    missingMaterials: best?.missing ?? materials.map(material => ({ resourceId: material.resourceId, missing: material.baseUnits })),
    note: candidates.length === 0
      ? 'nessun attore della nazione può detenere materiali'
      : 'nessun attore della nazione copre tutti i materiali dell’opera',
  };
}
