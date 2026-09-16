/**
 * World Story — OutboxService
 * ===========================
 * Durabilità degli eventi canonici (Fase 1: estratto da `game-session.ts`).
 * `enqueueOutboxRows` registra le righe DENTRO la transazione canonica;
 * `publishPendingOutbox` è un pubblicatore separato e ripetibile
 * (at-least-once: il client deduplica per ID stabile).
 */

import { gameRepository } from '../repositories';

export interface OutboxContext {
  gameId: string;
  /** True se c'è almeno un client SSE collegato (altrimenti le righe restano pending). */
  hasClient(): boolean;
  broadcast(type: any, data: any): boolean | void;
}

export class OutboxService {
  constructor(private readonly ctx: OutboxContext) {}

  /**
   * F02 passo 3: registra gli eventi canonici nell’outbox. Va invocata DENTRO
   * la transazione canonica, subito dopo addSimulationEvents: eventi e outbox
   * commettono o rollbackano insieme. Gli ID sono quelli stabili degli eventi.
   */
  enqueueOutboxRows(
    runId: string,
    checkpointId: string,
    revision: number,
    turn: number,
    rows: Array<{ id: string; date: string; headline: string; detail?: string; source: string; sourceActionIds?: string[] }>,
  ): void {
    if (!rows.length) return;
    gameRepository.enqueueOutbox(rows.map(event => ({
      id: event.id,
      gameId: this.ctx.gameId,
      runId,
      eventId: event.id,
      payload: {
        type: 'world_event' as const,
        eventId: event.id,
        runId,
        checkpointId,
        revision,
        turn,
        date: event.date,
        headline: event.headline,
        detail: event.detail ?? '',
        source: event.source,
        sourceActionIds: event.sourceActionIds || [],
      },
    })));
  }

  /**
   * F02 passo 3: pubblicatore outbox — separato e ripetibile. Pubblica solo
   * eventi già committati, in ordine di sequenza; marca «published» solo dopo
   * la diffusione (almeno-una-volta: un crash tra diffusione e marcia ripete
   * la diffusione con gli stessi ID stabili, e il client deduplica). Senza
   * client SSE le righe restano «pending»: il flush avviene alla (ri)connessione.
   */
  publishPendingOutbox(limit = 200): number {
    if (!this.ctx.hasClient()) return 0;
    try {
      const rows = gameRepository.pendingOutbox(this.ctx.gameId, limit);
      if (!rows.length) return 0;
      const published: string[] = [];
      for (const row of rows) {
        let payload: unknown;
        try { payload = JSON.parse(row.payload); } catch { payload = null; }
        if (!payload || !this.ctx.broadcast('world_event', payload)) break;
        published.push(row.id);
      }
      if (published.length) gameRepository.markOutboxPublished(this.ctx.gameId, published);
      return published.length;
    } catch (error) {
      // Il commit è già riuscito: conserva pending per retry, mai rollback finto.
      console.error('[OutboxService] Outbox publish failed after commit:', error);
      return 0;
    }
  }
}
