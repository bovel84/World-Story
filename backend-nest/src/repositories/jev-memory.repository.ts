import db from '../database';
import { assertJevBranchScope, jevScopeKey } from '../core/government/jev/jev.types';
import type { JevBranchScope, JevMemoryRecord, JevScope } from '../core/government/jev/jev.types';

export interface JevMemoryListOptions {
  gameDate?: string;
  turn?: number;
  limit?: number;
  /** Retrieval eligibility before LIMIT; default storage inspection still includes archived rows. */
  eligibleOnly?: boolean;
}

interface MemoryRow {
  id: string;
  game_id: string;
  branch_id: string;
  scope: JevMemoryRecord['scope'];
  scope_key: string;
  type: JevMemoryRecord['type'];
  game_date: string;
  turn: number | null;
  created_at: string;
  title: string | null;
  text: string;
  actors_json: string;
  topics_json: string;
  importance: number;
  confidence: number;
  status: JevMemoryRecord['status'];
  lifecycle: JevMemoryRecord['lifecycle'];
  source_event_ids_json: string | null;
  parent_memory_ids_json: string | null;
  access_count: number;
  last_accessed_at: string | null;
  metadata_json: string | null;
}

const COLUMNS = `id, game_id, branch_id, scope, scope_key, type, game_date, turn,
  created_at, title, text, actors_json, topics_json, importance, confidence,
  status, lifecycle, source_event_ids_json, parent_memory_ids_json,
  access_count, last_accessed_at, metadata_json`;
const TYPES: readonly JevMemoryRecord['type'][] = [
  'decision', 'promise', 'policy', 'outcome', 'relationship', 'opinion', 'conflict',
  'agreement', 'event', 'project', 'crisis', 'historical_episode',
];
const STATUSES: readonly JevMemoryRecord['status'][] = ['active', 'resolved', 'superseded', 'archived'];
const LIFECYCLES: readonly JevMemoryRecord['lifecycle'][] = ['hot', 'warm', 'cold', 'archived'];
const MAX_LIST_LIMIT = 5000;

function requiredString(value: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Expected nonempty JEV string');
}

function nonnegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Expected nonnegative JEV integer');
}

function gameDate(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('JEV gameDate must use YYYY-MM-DD');
  }
}

function stringArray(value: string[]): string {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError('Expected JEV string array');
  }
  return JSON.stringify(value);
}

function metadataJson(metadata: Record<string, unknown> | undefined): string | null {
  if (metadata === undefined) return null;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || (Object.getPrototypeOf(metadata) !== Object.prototype && Object.getPrototypeOf(metadata) !== null)) {
    throw new TypeError('JEV metadata must be a plain JSON object');
  }
  // Reject lossy values as well as circular structures/BigInt; never silently
  // turn non-finite numeric evidence into JSON null.
  return JSON.stringify(metadata, (_key, value: unknown) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
      || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('JEV metadata must be JSON-serializable');
    }
    return value;
  });
}

function scopeParams(scope: JevScope): [string, string, JevScope['kind'], string] {
  const key = jevScopeKey(scope); // also validates explicit game/branch/minister mandate
  return [scope.gameId, scope.branchId === null ? '' : scope.branchId, scope.kind, key];
}

function rowToRecord(row: MemoryRow): JevMemoryRecord {
  return {
    id: row.id, gameId: row.game_id, branchId: row.branch_id === '' ? null : row.branch_id,
    scope: row.scope, scopeKey: row.scope_key, type: row.type, gameDate: row.game_date,
    turn: row.turn, createdAt: row.created_at, text: row.text,
    actors: JSON.parse(row.actors_json), topics: JSON.parse(row.topics_json),
    importance: row.importance, confidence: row.confidence, status: row.status,
    lifecycle: row.lifecycle, accessCount: row.access_count,
    ...(row.title !== null ? { title: row.title } : {}),
    ...(row.source_event_ids_json !== null ? { sourceEventIds: JSON.parse(row.source_event_ids_json) } : {}),
    ...(row.parent_memory_ids_json !== null ? { parentMemoryIds: JSON.parse(row.parent_memory_ids_json) } : {}),
    ...(row.last_accessed_at !== null ? { lastAccessedAt: row.last_accessed_at } : {}),
    ...(row.metadata_json !== null ? { metadata: JSON.parse(row.metadata_json) } : {}),
  };
}

/** General narrative records only; no dependency on/copy of MinisterMemoryRecord. */
export const jevMemoryRepository = {
  /** Standalone minister recall uses only the active branch's persisted cursor, without hydrating world state. */
  currentPoint(scope: JevBranchScope): { gameDate: string; turn: number } | null {
    assertJevBranchScope(scope);
    return (db.prepare(`SELECT "current_date" AS gameDate, current_turn AS turn FROM games
      WHERE id = ? AND COALESCE(head_branch_id, '') = ?`).get(scope.gameId, scope.branchId ?? '') as { gameDate: string; turn: number } | undefined) ?? null;
  },

  upsert(scope: JevScope, record: JevMemoryRecord): number {
    const [gameId, branchId, kind, key] = scopeParams(scope);
    if (!record || record.gameId !== gameId || record.branchId !== scope.branchId
      || record.scope !== kind || record.scopeKey !== key) {
      throw new TypeError('JEV record identity does not match its canonical scope');
    }
    requiredString(record.id);
    requiredString(record.createdAt);
    requiredString(record.text);
    gameDate(record.gameDate);
    if (record.turn !== null) nonnegativeInteger(record.turn);
    nonnegativeInteger(record.accessCount);
    if (record.title !== undefined && typeof record.title !== 'string') throw new TypeError('Invalid JEV title');
    if (record.lastAccessedAt !== undefined) requiredString(record.lastAccessedAt);
    if (!TYPES.includes(record.type) || !STATUSES.includes(record.status) || !LIFECYCLES.includes(record.lifecycle)) {
      throw new TypeError('Invalid JEV memory enum');
    }
    for (const weight of [record.importance, record.confidence]) {
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new TypeError('JEV importance/confidence must be within 0..1');
      }
    }
    const actors = stringArray(record.actors);
    const topics = stringArray(record.topics);
    const sources = record.sourceEventIds === undefined ? null : stringArray(record.sourceEventIds);
    const parents = record.parentMemoryIds === undefined ? null : stringArray(record.parentMemoryIds);
    const metadata = metadataJson(record.metadata);
    const result = db.prepare(`
      INSERT INTO jev_memory (${COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id, game_id, branch_id) DO UPDATE SET
        type = excluded.type, game_date = excluded.game_date, turn = excluded.turn,
        created_at = excluded.created_at, title = excluded.title, text = excluded.text,
        actors_json = excluded.actors_json, topics_json = excluded.topics_json,
        importance = excluded.importance, confidence = excluded.confidence,
        status = excluded.status, lifecycle = excluded.lifecycle,
        source_event_ids_json = excluded.source_event_ids_json,
        parent_memory_ids_json = excluded.parent_memory_ids_json,
        access_count = excluded.access_count, last_accessed_at = excluded.last_accessed_at,
        metadata_json = excluded.metadata_json
      WHERE jev_memory.game_id = excluded.game_id AND jev_memory.branch_id = excluded.branch_id
        AND jev_memory.scope = excluded.scope AND jev_memory.scope_key = excluded.scope_key
    `).run(
      record.id, gameId, branchId, kind, key, record.type, record.gameDate, record.turn,
      record.createdAt, record.title ?? null, record.text, actors, topics,
      record.importance, record.confidence, record.status, record.lifecycle,
      sources, parents, record.accessCount, record.lastAccessedAt ?? null, metadata,
    );
    if (result.changes === 0) throw new Error('JEV ID already belongs to another scope in this game/branch');
    return result.changes;
  },

  find(scope: JevScope, id: string): JevMemoryRecord | null {
    const params = scopeParams(scope);
    requiredString(id);
    const row = db.prepare(`SELECT ${COLUMNS} FROM jev_memory
      WHERE game_id = ? AND branch_id = ? AND scope = ? AND scope_key = ? AND id = ?`
    ).get(...params, id) as MemoryRow | undefined;
    return row ? rowToRecord(row) : null;
  },

  listMemory(scope: JevScope, options: JevMemoryListOptions = {}): JevMemoryRecord[] {
    const params = scopeParams(scope);
    if (options.gameDate !== undefined) gameDate(options.gameDate);
    if (options.turn !== undefined) nonnegativeInteger(options.turn);
    const limit = options.limit ?? MAX_LIST_LIMIT;
    nonnegativeInteger(limit);
    const rows = db.prepare(`SELECT ${COLUMNS} FROM jev_memory
      WHERE game_id = ? AND branch_id = ? AND scope = ? AND scope_key = ?
        AND (? IS NULL OR game_date <= ?)
        AND (? IS NULL OR turn IS NULL OR turn <= ?)
        ${options.eligibleOnly ? "AND status IN ('active', 'resolved') AND lifecycle <> 'archived'" : ''}
      ORDER BY importance DESC, game_date DESC, turn DESC, id ASC LIMIT ?`
    ).all(...params, options.gameDate ?? null, options.gameDate ?? null,
      options.turn ?? null, options.turn ?? null, Math.min(limit, MAX_LIST_LIMIT)) as MemoryRow[];
    return rows.map(rowToRecord);
  },

  touch(scope: JevScope, ids: readonly string[], time: string): number {
    const params = scopeParams(scope);
    requiredString(time);
    if (!Array.isArray(ids)) throw new TypeError('JEV touch requires IDs');
    ids.forEach(requiredString);
    const statement = db.prepare(`UPDATE jev_memory SET access_count = access_count + 1, last_accessed_at = ?
      WHERE game_id = ? AND branch_id = ? AND scope = ? AND scope_key = ? AND id = ?`);
    return db.transaction(() => {
      let changes = 0;
      for (const id of new Set(ids)) changes += statement.run(time, ...params, id).changes;
      return changes;
    })();
  },

  /** Potatura al rewind: cancellazione limitata a game + branch, mai globale. */
  pruneAfterTurn(scope: JevBranchScope, cutoff: { turn?: number; gameDate?: string }): number {
    assertJevBranchScope(scope);
    const clauses: string[] = [];
    const params: Array<string | number> = [scope.gameId, scope.branchId === null ? '' : scope.branchId];
    if (cutoff.turn != null) {
      clauses.push('(turn IS NOT NULL AND turn > ?)');
      params.push(cutoff.turn);
    }
    if (cutoff.gameDate) {
      clauses.push('(game_date > ?)');
      params.push(cutoff.gameDate);
    }
    if (clauses.length === 0) return 0;
    const result = db.prepare(
      `DELETE FROM jev_memory WHERE game_id = ? AND branch_id = ? AND (${clauses.join(' OR ')})`,
    ).run(...params);
    return Number(result.changes) || 0;
  },

  /** Fork branch-aware: copia TUTTE le colonne sul nuovo ramo, idempotente. */
  forkMemory(from: JevBranchScope, toBranchId: string): number {
    assertJevBranchScope(from);
    requiredString(toBranchId);
    const result = db.prepare(`
      INSERT OR IGNORE INTO jev_memory (${COLUMNS})
      SELECT id, game_id, ?, scope, scope_key, type, game_date, turn, created_at, title, text,
        actors_json, topics_json, importance, confidence, status, lifecycle,
        source_event_ids_json, parent_memory_ids_json, access_count, last_accessed_at, metadata_json
        FROM jev_memory
       WHERE game_id = ? AND branch_id = ?
    `).run(toBranchId, from.gameId, from.branchId === null ? '' : from.branchId);
    return Number(result.changes) || 0;
  },

  /** Explicit game + branch cleanup, never a game-wide delete. */
  deleteBranch(scope: JevBranchScope): number {
    assertJevBranchScope(scope);
    return db.prepare('DELETE FROM jev_memory WHERE game_id = ? AND branch_id = ?')
      .run(scope.gameId, scope.branchId === null ? '' : scope.branchId).changes;
  },
};
