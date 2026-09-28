/**
 * MG02 µ1 — Il preflight legge il possesso, in un punto solo
 * =========================================================
 * Le due rotte di preflight (`POST /actions/evaluate` con un intent già
 * normalizzato, e `POST /actions/check-feasibility` da testo libero) devono
 * giudicare **allo stesso modo**. Se ognuna leggesse il ledger per conto suo,
 * la parità sarebbe una coincidenza da mantenere a mano, e la prima modifica
 * distratta le farebbe divergere — che è esattamente il difetto misurato in
 * MG01, dove `check-feasibility` non leggeva affatto.
 *
 * Qui vive la decisione, in un solo posto: **quando** si legge il ledger, da
 * **chi**, e **cosa** se ne ricava.
 */

import { readAvailability, ledgerHasState } from './FeasibilityReadings';
import { measureDeficits, type DeficitResult } from '../core/feasibility/Availability';
import type { SimulationCatalog } from '../scenario/types';
import type { OrderIntent } from '../core/feasibility/intent';

export interface PreflightReadingInput {
  /** Modalità economica della partita: in legacy il ledger non è la fonte. */
  readonly economyMode: 'legacy' | 'strict';
  /** Ramo dell'ordine. Assente = non si legge, non «disponibile zero». */
  readonly branchId: string | null | undefined;
  /** Attore che paga: la disponibilità si legge presso di lui, non presso la nazione. */
  readonly actorId: string;
  readonly catalog: SimulationCatalog;
  readonly intent: OrderIntent;
}

/**
 * Letture e deficit per un ordine, oppure `undefined` quando non si può
 * leggere: partita non strict (il ledger non è la fonte), ramo assente, o
 * ramo senza stato economico materializzato.
 *
 * Il `undefined` **non è** «tutto a posto»: è «non verificato», e la
 * valutazione lo dichiara come tale con l'avviso «disponibilità non
 * verificata». La differenza fra «non so» e «puoi» è il punto della fase.
 */
export function strictReadingsFor(input: PreflightReadingInput): DeficitResult | undefined {
  if (input.economyMode !== 'strict') return undefined;
  if (!input.branchId) return undefined;
  if (!ledgerHasState(input.branchId)) return undefined;
  const readings = readAvailability(input.branchId, input.actorId, input.catalog);
  return measureDeficits(input.intent, input.catalog, readings, input.actorId);
}
