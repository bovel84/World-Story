/**
 * World Story — TimelineService
 * =============================
 * Read model della timeline (cronaca) e dei processi/progetti persistiti.
 *
 * Estratto da `game-session.ts` come primo passo della Fase 1: la timeline era
 * una responsabilità coesa ma sepolta in un God Object. Il servizio è
 * deliberatamente **senza stato proprio** — tutta la verità resta in
 * `GameSession` — e riceve gli input espliciti di cui ha bisogno. Questo
 * mantiene la semantica identica e rende il servizio verificabile in isolamento.
 *
 * Responsabilità:
 *  - costruzione ordinata delle entry di timeline (eventi + narrazione);
 *  - paginazione della cronaca persistita;
 *  - lettura dei progetti in corso e completati dal motore.
 */

import { gameRepository } from '../repositories';
import { projectProgress } from '../core/simulation/MilitaryProduction';

export interface TimelineEventRecord {
  id: string;
  date: string;
  headline: string;
  detail: string;
  source: 'world' | 'diplomacy';
  /** Run/checkpoint che ha prodotto l'evento, per lettore e ripresa. */
  simulationId?: string;
  /** Ordini del lotto che il server ha associato all'evento. */
  sourceActionIds?: string[];
  chatId?: string;
  speakerName?: string;
}

export interface TurnResultRecord {
  id: string;
  turn: number;
  narration: string;
  countryResponse: string;
  events: string[];
  /** Run persistito che ha prodotto questo checkpoint. */
  simulationId?: string;
  timelineEvents?: TimelineEventRecord[];
  /** Data di gioco raggiunta alla fine del periodo (per la Timeline) */
  date?: string;
}

export interface TimelineEntry {
  turn: number;
  date: string;
  events: TimelineEventRecord[];
  narration: string;
}

export interface TimelinePage {
  timeline: TimelineEntry[];
  hasMore: boolean;
  nextAfter: number;
}

/** Sorgente minima di una entry: risultato in memoria o riga persistita. */
export interface TimelineSource {
  id: string;
  turn: number;
  date?: string;
  events?: string[];
  timelineEvents?: TimelineEventRecord[];
  narration?: string;
  simulationId?: string;
}

export type PublicTextFilter = (value: unknown) => string;

export class TimelineService {
  constructor(
    private readonly gameId: string,
    private readonly publicText: PublicTextFilter,
  ) {}

  /** Costruisce le entry ordinate della timeline da risultati/righe. */
  buildEntries(results: TimelineSource[]): TimelineEntry[] {
    const entries: TimelineEntry[] = results.map(r => ({
      turn: r.turn,
      date: r.date || '',
      events: r.timelineEvents?.length
        ? r.timelineEvents.map(event => ({
            ...event,
            headline: this.publicText(event.headline),
            detail: this.publicText(event.detail),
          }))
        : (r.events || []).map((headline, index) => ({
            id: `${r.id}-${index}`,
            date: r.date || '',
            headline: this.publicText(headline),
            detail: this.publicText(r.narration),
            source: 'world' as const,
            simulationId: r.simulationId,
          })),
      narration: this.publicText(r.narration),
    }));
    // I messaggi delle chat restano nel loro thread. La timeline riceve solo
    // eventi diplomatici esplicitamente committati dal simulatore (apertura
    // causale di chat o relationshipChanges), mai euristiche su parole come
    // "trattato" o "guerra" in una conversazione.
    for (const entry of entries) {
      entry.events.sort((a, b) => (a.date || entry.date).localeCompare(b.date || entry.date));
    }
    return entries.sort((a, b) => a.turn - b.turn || a.date.localeCompare(b.date));
  }

  /** Timeline completa dai risultati tenuti in memoria dalla sessione. */
  getTimeline(results: TimelineSource[]): TimelineEntry[] {
    return this.buildEntries(results);
  }

  /**
   * Pagina la cronaca persistita dal DB (§10.1). `afterTurn` è il cursore
   * (turno da cui continuare); `limit` è la dimensione della pagina. Restituisce
   * `hasMore` e `nextAfter` per il recupero progressivo, così il registro non
   * è limitato irreversibilmente ai turni in memoria o agli ultimi N eventi.
   */
  getTimelinePage(afterTurn: number, limit: number): TimelinePage {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;
    const safeAfter = Number.isFinite(afterTurn) && afterTurn >= 0 ? Math.floor(afterTurn) : 0;
    const { rows, hasMore } = gameRepository.getTimelinePage(this.gameId, safeAfter, safeLimit);
    const timeline = this.buildEntries(rows as TimelineSource[]);
    const last = timeline.at(-1);
    return { timeline, hasMore, nextAfter: last ? last.turn : safeAfter };
  }

  /**
   * Progetti in corso con avanzamento calcolato dal motore: se il valore
   * persistito è più vecchio della data corrente (progetto mai toccato da un
   * salto di tempo) vince il calcolo dalle date. Mai un 0% su un progetto
   * avviato.
   */
  getOngoingProcesses(currentDate: string) {
    return gameRepository.getOngoingProcesses(this.gameId).map(process => ({
      ...process,
      progress: Math.max(
        Number.isFinite(Number(process.progress)) ? Math.max(0, Number(process.progress)) : 0,
        projectProgress(process.started_date, process.expected_date, currentDate),
      ),
    }));
  }

  /** Progetti chiusi di recente, letti dal motore (read model del Dossier). */
  getCompletedProcesses(limit = 20) {
    return gameRepository.getCompletedProcesses(this.gameId, limit).map(process => ({
      ...process,
      status: 'completed' as const,
      progress: 100,
      // Data di gioco della chiusura; per i progetti chiusi prima dell'introduzione
      // della colonna resta il fallback sul timestamp di aggiornamento.
      completed_date: process.completed_date || (process.updated_at || '').slice(0, 10) || null,
    }));
  }
}
