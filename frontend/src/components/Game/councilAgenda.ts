/**
 * WS-GOVUX-P1 — L'agenda viva del Consiglio
 * =========================================
 * Il P0 aveva rilevato che la schermata di scelta mostrava solo nome e
 * competenza: nessuna frase, nessun argomento, nessuno stato, e nessuna sintesi
 * conteggiata. Qui vive il **selettore puro** che deriva l'agenda dei ministri
 * dagli stessi dati che il Consiglio già possiede:
 *
 *  - gli **indirizzi** del motore (`CabinetAddressView`): nome, ruolo, apertura,
 *    voci con urgenza e strade;
 *  - il **filo del colloquio** per sedia (`ministerChats`): chi ha già parlato;
 *  - la **memoria** per sedia (`MinisterMemoryRecord[]`): proposte discusse,
 *    questioni aperte, decisioni accodate.
 *
 * Regola di ferro: **nessuna urgenza inventata**. Lo stato `richiede attenzione`
 * esiste solo se una voce del **motore** ha urgenza `critica`; non si deduce dal
 * testo, non si stima, non si aggiunge. Gli altri stati derivano dal colloquio e
 * dalla memoria, con una precedenza dichiarata e verificabile.
 *
 * Il modulo è puro: nessun I/O, nessuna chiamata al modello, nessun numero
 * nuovo. La UI rende ciò che questo selettore restituisce, e la **sintesi** in
 * testa è contata sugli **stessi record** della lista.
 */
import type { CabinetAddressView, CabinetSessionView } from '../../services/api';
import type { MinisterMemoryRecord } from './ministerMemory';
import type { AdvisorMessage } from '../../stores/chatStore';

/** Le sette sedie, nello stesso ordine dichiarato dal motore (`Cabinet.ts`). */
export const COUNCIL_SEAT_ORDER = ['tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra'] as const;
export type CouncilSeat = (typeof COUNCIL_SEAT_ORDER)[number];

/** Gli stati del colloquio. Quattro, distinti, mai sovrapposti. */
export type CouncilSeatState =
  | 'richiede-attenzione'
  | 'in-attesa-di-decisione'
  | 'discussione-aperta'
  | 'disponibile';

export const COUNCIL_STATE_LABEL: Record<CouncilSeatState, string> = {
  'richiede-attenzione': 'richiede attenzione',
  'in-attesa-di-decisione': 'in attesa di decisione',
  'discussione-aperta': 'discussione aperta',
  disponibile: 'disponibile',
};

/** La voce d'agenda di una sedia: cosa porta, di cosa si parla, a che punto è. */
export interface CouncilAgendaEntry {
  seat: CouncilSeat;
  /** Il nome della sedia («Ministro del Tesoro»). */
  label: string;
  /** Il ruolo: che cosa legge la sedia. */
  role: string;
  /** La frase breve del ministro: la sua apertura, parola del motore. */
  brief: string;
  /** L'argomento principale: la prima questione portata al consiglio. */
  topic: string;
  /** Le questioni aperte sul tavolo (i bisogni delle voci, dal motore). */
  questions: string[];
  /** Quante voci hanno urgenza `critica`: solo il motore lo decide. */
  criticalCount: number;
  /** Quanti scambi esistono già con questa sedia. */
  messageCount: number;
  /** Lo stato del colloquio, con la regola dichiarata sotto. */
  state: CouncilSeatState;
}

/** La sintesi del Consiglio: contata sugli **stessi** record della lista. */
export interface CouncilAgendaSummary {
  total: number;
  attention: number;
  inDecision: number;
  discussing: number;
  available: number;
  /** Somma delle questioni sul tavolo di tutte le sedie. */
  questions: number;
}

export interface CouncilAgenda {
  entries: CouncilAgendaEntry[];
  summary: CouncilAgendaSummary;
}

export interface CouncilAgendaInput {
  session: CabinetSessionView | null;
  /** Il filo del colloquio per sedia (`ministerChats`). */
  threads: Record<string, AdvisorMessage[]>;
  /** La memoria per sedia (`MinisterMemoryStore`). */
  memory: Record<string, MinisterMemoryRecord[]>;
}

/** L'ultimo indice di un tipo di ricordo, o -1: la memoria è in ordine di scrittura. */
function lastIndexOfKind(records: readonly MinisterMemoryRecord[], kind: MinisterMemoryRecord['kind']): number {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].kind === kind) return index;
  }
  return -1;
}

/**
 * Lo stato di una sedia, con la regola in chiaro (prima che combacia vince):
 *
 *  1. `richiede-attenzione` — almeno una voce del motore con urgenza `critica`.
 *     È l'unico caso in cui l'attenzione è dichiarata: mai dedotta dal testo.
 *  2. `in-attesa-di-decisione` — una proposta è stata discussa e non ancora
 *     firmata (in memoria c'è `proposal-discussed` dopo l'ultima decisione
 *     `queued-decision`).
 *  3. `discussione-aperta` — il colloquio è iniziato (esiste un filo) oppure una
 *     questione è rimasta aperta in memoria dopo l'ultima decisione.
 *  4. `disponibile` — nessuna delle precedenti: la sedia ha dati ma è quieta.
 */
export function councilSeatState(input: {
  criticalCount: number;
  thread: readonly AdvisorMessage[];
  memory: readonly MinisterMemoryRecord[];
}): CouncilSeatState {
  if (input.criticalCount > 0) return 'richiede-attenzione';
  const lastQueued = lastIndexOfKind(input.memory, 'queued-decision');
  if (lastIndexOfKind(input.memory, 'proposal-discussed') > lastQueued) return 'in-attesa-di-decisione';
  if (input.thread.length > 0 || lastIndexOfKind(input.memory, 'open-question') > lastQueued) return 'discussione-aperta';
  return 'disponibile';
}

/** L'agenda dei ministri, nell'ordine dichiarato; sintesi dagli stessi record. */
export function deriveCouncilAgenda({ session, threads, memory }: CouncilAgendaInput): CouncilAgenda {
  const addresses = session?.addresses ?? [];
  const entries: CouncilAgendaEntry[] = addresses
    .map((address, index) => {
      const items = address.items ?? [];
      const criticalCount = items.filter(item => item.urgency === 'critica').length;
      const thread = threads[address.seat] ?? [];
      const records = memory[address.seat] ?? [];
      const questions = items.map(item => item.need);
      return {
        seat: address.seat as CouncilSeat,
        label: address.label,
        role: address.reads,
        brief: address.opening,
        topic: questions[0] ?? '',
        questions,
        criticalCount,
        messageCount: thread.length,
        state: councilSeatState({ criticalCount, thread, memory: records }),
        _index: index,
      };
    })
    .sort((a, b) => {
      const rank = (seat: CouncilSeat): number => {
        const position = COUNCIL_SEAT_ORDER.indexOf(seat);
        return position === -1 ? COUNCIL_SEAT_ORDER.length : position;
      };
      return rank(a.seat) - rank(b.seat) || a._index - b._index;
    })
    .map(({ _index, ...entry }) => entry);

  const summary: CouncilAgendaSummary = {
    total: entries.length,
    attention: entries.filter(entry => entry.state === 'richiede-attenzione').length,
    inDecision: entries.filter(entry => entry.state === 'in-attesa-di-decisione').length,
    discussing: entries.filter(entry => entry.state === 'discussione-aperta').length,
    available: entries.filter(entry => entry.state === 'disponibile').length,
    questions: entries.reduce((sum, entry) => sum + entry.questions.length, 0),
  };

  return { entries, summary };
}
