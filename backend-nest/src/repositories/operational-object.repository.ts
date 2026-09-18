/**
 * World Story — Operational Object Repository
 * ===========================================
 *
 * Stato proprio degli oggetti persistenti (impianti, navi, flotte, cantieri,
 * equipaggi navali). Una riga per oggetto con `data` JSON: è la sola fonte
 * autoritativa dello stato che l'aggregato nazionale non può esprimere. Le
 * armate restano oggetti della mappa (regioni); qui vivono le famiglie che la
 * mappa non ospita.
 */

import db from '../database';

export type OperationalObjectKind = 'facility' | 'ship' | 'fleet' | 'construction' | 'personnel';

export interface OperationalObjectRow {
  id: string;
  kind: OperationalObjectKind;
  data: Record<string, unknown>;
}

interface RawRow {
  object_id: string;
  kind: string;
  data: string;
}

const KINDS: OperationalObjectKind[] = ['facility', 'ship', 'fleet', 'construction', 'personnel'];

function parseKind(kind: string): OperationalObjectKind | null {
  return (KINDS as string[]).includes(kind) ? (kind as OperationalObjectKind) : null;
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const operationalObjectRepository = {
  /** Tutti gli oggetti di una partita, ordinati per tipo e id (deterministico). */
  list: (gameId: string, kind?: OperationalObjectKind): OperationalObjectRow[] => {
    const rows = (kind
      ? db.prepare('SELECT object_id, kind, data FROM game_operational_objects WHERE game_id = ? AND kind = ? ORDER BY object_id').all(gameId, kind)
      : db.prepare('SELECT object_id, kind, data FROM game_operational_objects WHERE game_id = ? ORDER BY kind, object_id').all(gameId)) as RawRow[];
    return rows
      .map(row => ({ id: row.object_id, kind: parseKind(row.kind), data: parseData(row.data) }))
      .filter((row): row is OperationalObjectRow => Boolean(row.kind));
  },

  /** Elenco degli id di un tipo: serve a distinguere «assente» da «vuoto». */
  idsOfKind: (gameId: string, kind: OperationalObjectKind): string[] =>
    (db.prepare('SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = ? ORDER BY object_id').all(gameId, kind) as Array<{ object_id: string }>)
      .map(row => row.object_id),

  /** Scrittura idempotente: stesso id, stesso contenuto ⇒ nessun cambio. */
  upsert: (gameId: string, kind: OperationalObjectKind, id: string, data: Record<string, unknown>): void => {
    db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `).run(gameId, id, kind, JSON.stringify(data ?? {}), new Date().toISOString());
  },

  /** Scrittura in blocco dentro una transazione (seed e transazioni d'azione). */
  upsertMany: (gameId: string, rows: Array<{ kind: OperationalObjectKind; id: string; data: Record<string, unknown> }>): void => {
    if (rows.length === 0) return;
    const now = new Date().toISOString();
    const statement = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const run = db.transaction(() => {
      for (const row of rows) statement.run(gameId, row.id, row.kind, JSON.stringify(row.data ?? {}), now);
    });
    run();
  },

  remove: (gameId: string, id: string): void => {
    db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?').run(gameId, id);
  },

  removeKind: (gameId: string, kind: OperationalObjectKind): void => {
    db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND kind = ?').run(gameId, kind);
  },
};

export default operationalObjectRepository;
