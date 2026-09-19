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

export type OperationalObjectKind = 'facility' | 'ship' | 'fleet' | 'construction' | 'personnel' | 'unit' | 'front';

export interface OperationalObjectRow {
  id: string;
  kind: OperationalObjectKind;
  data: Record<string, unknown>;
}

/**
 * MILITARY/WARFRONT INTEGRITY P0-1: insieme **completo** degli oggetti
 * persistenti di una partita, nella forma che entra in un checkpoint.
 *
 * `schema`/`version` esistono per la compatibilità: un salvataggio vecchio non
 * ha `operationalState` (`undefined` ⇒ non si tocca lo stato corrente), mentre
 * un salvataggio nuovo lo ha sempre — anche con `rows: []`, che significa
 * «questo ramo non aveva oggetti» e va applicato.
 */
export interface OperationalObjectsSnapshot {
  schema: 'world_story_operational_objects';
  version: 1;
  rows: Array<{ objectId: string; kind: OperationalObjectKind; data: Record<string, unknown> }>;
}

export const OPERATIONAL_OBJECTS_SCHEMA = 'world_story_operational_objects' as const;

interface RawRow {
  object_id: string;
  kind: string;
  data: string;
}

const KINDS: OperationalObjectKind[] = ['facility', 'ship', 'fleet', 'construction', 'personnel', 'unit', 'front'];

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

  /**
   * Sostituisce **l'intero insieme** di un tipo in una sola transazione:
   * scrittura degli oggetti presenti e rimozione di quelli che non ci sono
   * più. O seed, o transazione d'azione: mai uno stato a metà.
   */
  replaceKind: (gameId: string, kind: OperationalObjectKind, rows: Array<{ id: string; data: Record<string, unknown> }>): void => {
    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const remove = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const ids = new Set(rows.map(row => row.id));
    const replace = db.transaction(() => {
      for (const row of rows) upsert.run(gameId, row.id, kind, JSON.stringify(row.data ?? {}), now);
      for (const existing of (db.prepare('SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = ?').all(gameId, kind) as Array<{ object_id: string }>)) {
        if (!ids.has(existing.object_id)) remove.run(gameId, existing.object_id);
      }
    });
    replace();
  },

  /**
   * MILITARY/WARFRONT INTEGRITY P0-1: **REPLACE ALL FOR GAME**. L'insieme del
   * checkpoint diventa l'insieme della partita: le righe presenti sono
   * scritte, quelle che non ci sono più (di **qualsiasi** tipo) sono rimosse.
   * Una sola transazione: se un insert fallisce non resta uno stato a metà.
   */
  replaceAll: (gameId: string, rows: Array<{ objectId: string; kind: OperationalObjectKind; data: Record<string, unknown> }>): void => {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const remove = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const present = new Set(rows.map(row => row.objectId));
    const replace = db.transaction(() => {
      for (const row of rows) insert.run(gameId, row.objectId, row.kind, JSON.stringify(row.data ?? {}), now);
      for (const existing of (db.prepare('SELECT object_id FROM game_operational_objects WHERE game_id = ?').all(gameId) as Array<{ object_id: string }>)) {
        if (!present.has(existing.object_id)) remove.run(gameId, existing.object_id);
      }
    });
    replace();
  },

  /**
   * Snapshot completo e **deterministico** (ordinato per `kind`, `objectId`):
   * è ciò che il checkpoint serializza e che `semanticStateHash` confronta.
   */
  snapshot: (gameId: string): OperationalObjectsSnapshot => ({
    schema: OPERATIONAL_OBJECTS_SCHEMA,
    version: 1,
    rows: operationalObjectRepository.list(gameId).map(row => ({ objectId: row.id, kind: row.kind, data: row.data })),
  }),

  remove: (gameId: string, id: string): void => {
    db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?').run(gameId, id);
  },

  removeKind: (gameId: string, kind: OperationalObjectKind): void => {
    db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND kind = ?').run(gameId, kind);
  },
};

export default operationalObjectRepository;
