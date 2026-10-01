import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { JevMemoryRecord, JevScope } from '../src/core/government/jev/jev.types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w1-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
const testDbPath = path.join(directory, 'memory.sqlite');
process.env.OPEN_PAX_DB_PATH = testDbPath;
let db: Database.Database;
let repo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let scopeKey: typeof import('../src/core/government/jev/jev.types').jevScopeKey;
let getConfig: typeof import('../src/core/government/jev/jev.config').getJevConfig;
const minister: JevScope = { kind: 'minister', gameId: 'game-1', branchId: null, seat: 'tesoro', mandate: 'tesoro@ITA:m1' };

function record(scope: JevScope = minister, changes: Partial<JevMemoryRecord> = {}): JevMemoryRecord {
  return {
    id: 'advice', gameId: scope.gameId, branchId: scope.branchId, scope: scope.kind,
    scopeKey: scopeKey(scope), type: 'policy', gameDate: '1951-01-01', turn: 1,
    createdAt: '2026-10-01T10:00:00Z', title: 'Tax advice', text: 'Do not reduce taxes',
    actors: ['president', 'tesoro'], topics: ['taxation'], importance: 0.8, confidence: 0.9,
    status: 'active', lifecycle: 'hot', sourceEventIds: ['event-1'], parentMemoryIds: [],
    accessCount: 0, metadata: { claim: true, nested: { reason: 'deficit' } }, ...changes,
  };
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  ({ jevScopeKey: scopeKey } = await import('../src/core/government/jev/jev.types'));
  ({ getJevConfig: getConfig } = await import('../src/core/government/jev/jev.config'));
  ({ jevMemoryRepository: repo } = await import('../src/repositories/jev-memory.repository'));
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH;
  else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('JEV W1 scoped storage', () => {
  it('uses collision-safe encoded components and shared, sorted diplomacy keys', () => {
    expect(scopeKey(minister)).toBe('minister:tesoro:tesoro%40ITA%3Am1');
    const diplomacy: JevScope = { kind: 'diplomacy', gameId: 'g', branchId: null, a: 'ITA', b: 'FRA' };
    expect(scopeKey(diplomacy)).toBe('diplomacy:FRA:ITA');
    expect(scopeKey({ ...diplomacy, a: 'FRA', b: 'ITA' })).toBe(scopeKey(diplomacy));
    expect(scopeKey({ ...diplomacy, a: 'A:B', b: 'C' })).not.toBe(scopeKey({ ...diplomacy, a: 'A', b: 'B:C' }));
    expect(scopeKey({ ...minister, mandate: 'a:b' })).not.toBe(scopeKey({ ...minister, mandate: 'a%3Ab' }));
  });

  it('upserts idempotently, round-trips JSON and stores null branch as empty string', () => {
    const initial = record();
    repo.upsert(minister, initial);
    repo.upsert(minister, { ...initial, text: 'Updated advice' });
    expect(repo.listMemory(minister)).toEqual([{ ...initial, text: 'Updated advice' }]);
    expect(repo.find(minister, initial.id)?.branchId).toBeNull();
    expect(db.prepare('SELECT branch_id FROM jev_memory WHERE game_id = ? AND branch_id = ? AND id = ?')
      .get(minister.gameId, '', initial.id)).toEqual({ branch_id: '' });
  });

  it('isolates game, branch, mandate and seat, and rejects moving an existing ID to another scope', () => {
    const scopes: JevScope[] = [
      { ...minister, gameId: 'game-2' }, { ...minister, branchId: 'branch-2' },
      { ...minister, mandate: 'tesoro@ITA:m2' }, { ...minister, seat: 'esteri' },
    ];
    scopes.forEach((scope, i) => {
      expect(repo.find(scope, 'advice')).toBeNull();
      repo.upsert(scope, record(scope, { id: `isolated-${i}` }));
      expect(repo.listMemory(scope).map(r => r.id)).toEqual([`isolated-${i}`]);
    });
    expect(repo.listMemory(minister).map(r => r.id)).toEqual(['advice']);
    expect(() => repo.upsert(scopes[2], record(scopes[2]))).toThrow();
    expect(repo.find(minister, 'advice')?.text).toBe('Updated advice');
  });

  it('retrieves reversed diplomacy pairs as the same shared memory', () => {
    const scope: JevScope = { kind: 'diplomacy', gameId: 'diplomacy', branchId: null, a: 'ITA', b: 'FRA' };
    repo.upsert(scope, record(scope));
    expect(repo.find({ ...scope, a: 'FRA', b: 'ITA' }, 'advice')).toEqual(record(scope));
  });

  it('excludes future dates and turns (including when a record has no turn), and limits results', () => {
    const scope: JevScope = { kind: 'world', gameId: 'cutoff', branchId: null };
    repo.upsert(scope, record(scope, { id: 'old', gameDate: '1940-01-01', turn: null }));
    repo.upsert(scope, record(scope, { id: 'present', gameDate: '1951-01-01', turn: 5 }));
    repo.upsert(scope, record(scope, { id: 'future-date', gameDate: '1952-01-01', turn: null }));
    repo.upsert(scope, record(scope, { id: 'future-turn', gameDate: '1950-01-01', turn: 6 }));
    expect(repo.listMemory(scope, { gameDate: '1951-01-01', turn: 5 }).map(r => r.id).sort()).toEqual(['old', 'present']);
    expect(repo.listMemory(scope, { gameDate: '1951-01-01', turn: 5, limit: 1 })).toHaveLength(1);
    expect(repo.listMemory(scope, { limit: 0 })).toEqual([]);
    expect(() => repo.listMemory(scope, { limit: -1 })).toThrow();
  });

  it('touches only requested records within the full scope and deletes only a specified branch', () => {
    const scope: JevScope = { kind: 'world', gameId: 'touch', branchId: null };
    const branch: JevScope = { ...scope, branchId: 'other' };
    repo.upsert(scope, record(scope));
    repo.upsert(branch, record(branch));
    expect(repo.touch(scope, ['advice', 'missing'], '2026-10-01T11:00:00Z')).toBe(1);
    expect(repo.find(scope, 'advice')).toMatchObject({ accessCount: 1, lastAccessedAt: '2026-10-01T11:00:00Z' });
    expect(repo.find(branch, 'advice')?.accessCount).toBe(0);
    expect(repo.touch({ ...scope, kind: 'government' }, ['advice'], 'now')).toBe(0);
    expect(repo.touch(scope, [], 'now')).toBe(0);
    expect(repo.deleteBranch(scope)).toBe(1);
    expect(repo.find(branch, 'advice')).not.toBeNull();
    expect(repo.find(minister, 'advice')).not.toBeNull();
  });

  it('validates record identity, explicit branches, enums, bounded weights and JSON before writing', () => {
    for (const invalid of [
      { gameId: 'wrong' }, { branchId: 'wrong' }, { branchId: undefined }, { scope: 'world' }, { scopeKey: 'wrong' },
      { importance: -0.1 }, { importance: 1.1 }, { confidence: NaN }, { confidence: Infinity },
      { type: 'not-a-type' }, { status: 'queued' }, { lifecycle: 'invalid' },
      { actors: ['valid', 123] }, { metadata: { invalid: BigInt(1) } }, { metadata: new Date() },
      { metadata: { invalid: undefined } }, { accessCount: -1 },
    ]) {
      expect(() => repo.upsert(minister, record(minister, invalid as Partial<JevMemoryRecord>))).toThrow();
    }
    const missingBranch = { kind: 'world', gameId: 'missing-branch' } as JevScope;
    expect(() => repo.listMemory(missingBranch)).toThrow();
    expect(() => repo.find(missingBranch, 'id')).toThrow();
    expect(() => repo.deleteBranch(missingBranch)).toThrow();
    expect(() => scopeKey({ ...minister, seat: 'economy' } as unknown as JevScope)).toThrow();
  });

  it('reopens SQLite and retains data without migrating existing minister memory', async () => {
    const before = repo.find(minister, 'advice');
    db.prepare(`INSERT INTO minister_memory
      (game_id, branch_id, seat, mandate, record_id, kind, state, summary, refs_json, record_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(minister.gameId, '', 'tesoro', 'tesoro@ITA:m1', 'existing-canonical', 'objective', 'open',
      'Canonical minister advice', '{"gameDate":"1951-01-01"}', '1951-01-01');
    db.close();
    vi.resetModules();
    const database = await import('../src/database');
    db = database.default;
    database.initDatabase();
    ({ jevMemoryRepository: repo } = await import('../src/repositories/jev-memory.repository'));
    expect(repo.find(minister, 'advice')).toEqual(before);
    expect(repo.find(minister, 'existing-canonical')).toBeNull();
    expect(repo.listMemory(minister)).toHaveLength(1);
    expect(db.prepare('SELECT record_id FROM minister_memory WHERE game_id = ? AND branch_id = ?')
      .all(minister.gameId, '')).toEqual([{ record_id: 'existing-canonical' }]);
  });

  it('reads feature flags dynamically with safe budgets and no semantic or paid LLM default', () => {
    expect(getConfig({})).toMatchObject({
      enabled: true, maxActiveMemories: 5000, consolidationIntervalTurns: 10,
      maxMinisterContextTokens: 4500, maxDiplomaticContextTokens: 3500,
      semanticRetrievalEnabled: false, llmFallbackEnabled: false, debug: false,
      contextBudget: { identity: 400, worldState: 1200, strategicMemory: 800, retrievedMemory: 1200, recentConversation: 800 },
    });
    const previous = process.env.JEV_MEMORY_ENABLED;
    try {
      process.env.JEV_MEMORY_ENABLED = 'false';
      expect(getConfig().enabled).toBe(false);
      process.env.JEV_MEMORY_ENABLED = 'true';
      expect(getConfig().enabled).toBe(true);
      expect(() => getConfig({ JEV_MEMORY_ENABLED: 'typo' })).toThrow();
    } finally {
      if (previous === undefined) delete process.env.JEV_MEMORY_ENABLED;
      else process.env.JEV_MEMORY_ENABLED = previous;
    }
  });
});
