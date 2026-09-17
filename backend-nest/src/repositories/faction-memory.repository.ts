/**
 * World Story — Memoria politica delle fazioni (repository)
 * ========================================================
 * Il motore scrive qui le decisioni che riguardano una fazione; la fotografia
 * del governo le rilegge come fiducia/risentimento. Righe immutabili: mai
 * aggiornate, solo potate dal rewind (`deleteAfterTurn`).
 *
 * Retrocompatibile: la tabella è nuova, i salvataggi precedenti non hanno
 * memoria e la fotografia del governo resta identica a prima.
 */
import db from '../database';
import type { FactionMemoryEvent, FactionMemoryKind, FactionMemoryRow } from '../core/simulation/FactionMemory';

interface MemoryRow {
  id: string;
  game_id: string;
  branch_id: string;
  polity_id: string;
  faction_id: string;
  kind: string;
  lever: string | null;
  weight: number | string;
  turn: number | string;
  game_date: string;
  text: string;
  source_event_id: string | null;
}

function rowToEvent(row: MemoryRow): FactionMemoryRow {
  return {
    id: row.id,
    gameId: row.game_id,
    branchId: row.branch_id,
    polityId: row.polity_id,
    factionId: row.faction_id,
    kind: row.kind as FactionMemoryKind,
    lever: row.lever,
    weight: Number(row.weight) || 0,
    turn: Number(row.turn) || 0,
    gameDate: row.game_date,
    text: row.text ?? '',
    sourceEventId: row.source_event_id,
  };
}

/** Identità stabile di un evento: stessa decisione → stessa riga (idempotenza). */
export function factionMemoryId(event: FactionMemoryEvent): string {
  const source = event.sourceEventId ?? `turn:${event.turn}:${event.gameDate}`;
  return `${source}:${event.factionId}:${event.kind}`;
}

export const factionMemoryRepository = {
  /**
   * Registra gli eventi di memoria. Idempotente: registrare due volte la stessa
   * decisione non raddoppia il peso politico.
   */
  insertMany: (
    gameId: string,
    polityId: string,
    events: readonly FactionMemoryEvent[],
    options: { branchId?: string } = {},
  ): number => {
    if (!Array.isArray(events) || events.length === 0) return 0;
    const branchId = options.branchId ?? 'main';
    const statement = db.prepare(`
      INSERT OR IGNORE INTO game_faction_memory
        (id, game_id, branch_id, polity_id, faction_id, kind, lever, weight, turn, game_date, text, source_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    const run = db.transaction((list: readonly FactionMemoryEvent[]) => {
      for (const event of list) {
        const result = statement.run(
          factionMemoryId(event), gameId, branchId, polityId, event.factionId, event.kind,
          event.lever ?? null, Number(event.weight) || 0, Number(event.turn) || 0,
          String(event.gameDate).slice(0, 10), event.text ?? '', event.sourceEventId ?? null,
        );
        inserted += Number(result.changes) || 0;
      }
    });
    run(events);
    return inserted;
  },

  /** Tutti gli eventi di memoria di una partita (per la nazione, se indicata). */
  list: (gameId: string, options: { polityId?: string; branchId?: string } = {}): FactionMemoryRow[] => {
    const branchId = options.branchId ?? 'main';
    const rows = options.polityId
      ? db.prepare(`
          SELECT * FROM game_faction_memory
           WHERE game_id = ? AND branch_id = ? AND polity_id = ?
           ORDER BY game_date ASC, turn ASC, recorded_at ASC, id ASC
        `).all(gameId, branchId, options.polityId)
      : db.prepare(`
          SELECT * FROM game_faction_memory
           WHERE game_id = ? AND branch_id = ?
           ORDER BY game_date ASC, turn ASC, recorded_at ASC, id ASC
        `).all(gameId, branchId);
    return (rows as MemoryRow[]).map(rowToEvent);
  },

  /** Potatura del rewind: la memoria torna a com'era prima del salto indietro. */
  deleteAfterTurn: (gameId: string, turn: number, options: { branchId?: string } = {}): number => {
    const branchId = options.branchId ?? 'main';
    const result = db.prepare(
      'DELETE FROM game_faction_memory WHERE game_id = ? AND branch_id = ? AND turn > ?',
    ).run(gameId, branchId, turn);
    return Number(result.changes) || 0;
  },

  /** Dimentica ogni memoria di una partita (partita nuova / reset). */
  deleteAll: (gameId: string): number => {
    const result = db.prepare('DELETE FROM game_faction_memory WHERE game_id = ?').run(gameId);
    return Number(result.changes) || 0;
  },
};
