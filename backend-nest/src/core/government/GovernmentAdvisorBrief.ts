/**
 * WS-GOV-ADVISOR-HUB — Il briefing del Primo Consulente
 * =====================================================
 * Il Consulente non genera crisi: **legge** il motore e ordina ciò che merita
 * attenzione. Questo modulo è il suo read model strutturato, costruito dalle
 * fonti canoniche già esistenti (`GovernmentSituation` e `GovernmentFollowUp`),
 * non dal testo.
 *
 * Regole:
 *  - **Tutti e sette i ministri esistono sempre.** Il roster del gabinetto è
 *    separato dall'agenda: una sedia senza questioni è `available`, non assente.
 *  - **Il lifecycle distingue il nuovo dall'aperto.** Una situazione già vista
 *    resta `active`; solo un ingresso nella stessa data è `new`; una situazione
 *    che nasce da una decisione o da un'inerzia è `follow-up`.
 *  - **Modulo puro**: riceve situazioni, follow-up e recenti decisioni già letti,
 *    restituisce il briefing. Nessuna scrittura, nessun fatto inventato.
 */

import { CABINET_SEATS, SEAT_LABEL, type CabinetSeat } from './Cabinet';
import type { GovernmentFollowUp, GovernmentSituation } from './GovernmentSituations';

export type SituationLifecycle = 'new' | 'active' | 'follow-up';

export interface CabinetRosterEntry {
  readonly seat: CabinetSeat;
  readonly label: string;
  /** `engaged` = ha un rapporto di una decisione presa; `available` = consultabile. */
  readonly state: 'engaged' | 'available';
}

export interface RecentDecision {
  readonly pressureId: string;
  readonly title: string;
  readonly resolution: string;
}

export interface GovernmentAdvisorBrief {
  readonly date: string;
  readonly situations: readonly GovernmentSituation[];
  readonly followUps: readonly GovernmentFollowUp[];
  readonly cabinet: readonly CabinetRosterEntry[];
  readonly recentDecisions: readonly RecentDecision[];
}

/**
 * WS-GOV-ADVISOR-HUB P3.1 — Ciò che è nuovo, ciò che resta aperto, ciò che è un
 * seguito. `currentTurn` è il turno corrente: una situazione aperta nello stesso
 * turno è `new`, altrimenti `active`.
 */
export function situationLifecycle(situation: GovernmentSituation, currentTurn: number): SituationLifecycle {
  if (situation.origin.type === 'previous-decision' || situation.origin.type === 'inaction') return 'follow-up';
  return situation.openedTurn === currentTurn ? 'new' : 'active';
}

/** Il briefing: situazioni, rapporti, roster dei sette ministri e decisioni recenti. */
export function buildGovernmentAdvisorBrief(input: {
  readonly date: string;
  readonly situations: readonly GovernmentSituation[];
  readonly followUps: readonly GovernmentFollowUp[];
  readonly recentDecisions?: readonly { readonly id: string; readonly title: string; readonly resolution?: string | null }[];
}): GovernmentAdvisorBrief {
  // WS-GOV-REALITY-CLEANUP — `engaged` NON si deduce da Pressure detector/legacy:
  // una quest invisibile non deve mostrare «Ministro X — sul tavolo». Restano
  // solo i rapporti di verifica di decisioni realmente prese. Il read model qui
  // non conosce le stanze del Consiglio aperte: senza quella fonte, un ministro
  // è `available`, mai dedotto.
  const engaged = new Set<CabinetSeat>(input.followUps.map(followUp => followUp.owner));
  return {
    date: input.date,
    situations: [...input.situations],
    followUps: [...input.followUps],
    // P9 — Il roster è SEMPRE completo: un ministro senza urgenze resta disponibile.
    cabinet: CABINET_SEATS.map(seat => ({ seat, label: SEAT_LABEL[seat], state: engaged.has(seat) ? 'engaged' : 'available' })),
    recentDecisions: (input.recentDecisions ?? []).map(record => ({ pressureId: record.id, title: record.title, resolution: record.resolution ?? '' })),
  };
}
