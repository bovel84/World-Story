/**
 * WS-JEV-W7 — Consolidamento deterministico in episodi storici.
 *
 * Difende le invarianti della fase:
 *  1. gli eventi originali NON si cancellano: passano a `lifecycle='archived'`
 *     con il riferimento all'episodio che li ha sostituiti;
 *  2. il consolidamento è **idempotente**: stessa finestra + stesso scope →
 *     nessun episodio duplicato;
 *  3. è **deterministico** (scope + finestra temporale, nessun LLM) e filtra
 *     sempre per `game_id` E `branch_id`.
 *
 * Solo SQLite temporaneo e repository reale: nessun backend, nessuna rete,
 * nessun provider, MAI il DB operativo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JevIngestInput, JevScope } from '../src/core/government/jev/jev.types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w7-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'memory.sqlite');
const originalEnabled = process.env.JEV_MEMORY_ENABLED;

const GAME = 'jev-w7-game';
const OTHER_GAME = 'jev-w7-other';
const BRANCH = 'branch-A';
const BRANCH_B = 'branch-B';

let db: any;
let service: typeof import('../src/core/government/jev/jev-memory.service');
let types: typeof import('../src/core/government/jev/jev.types');
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let gameRepository: typeof import('../src/repositories/game.repository').gameRepository;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('w7-world', 'W7', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'w7-world', 20, '1951-06-01')`).run(GAME);
  db.prepare(`UPDATE games SET head_branch_id = ? WHERE id = ?`).run(BRANCH, GAME);
  service = await import('../src/core/government/jev/jev-memory.service');
  types = await import('../src/core/government/jev/jev.types');
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.JEV_MEMORY_ENABLED = 'true';
  for (const gameId of [GAME, OTHER_GAME]) {
    for (const branchId of [BRANCH, BRANCH_B, null]) jevRepo.deleteBranch({ gameId, branchId });
  }
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

function governmentScope(gameId = GAME, branchId: string | null = BRANCH): JevScope {
  return { kind: 'government', gameId, branchId };
}

function rawInput(turn: number, text: string, over: Partial<JevIngestInput> = {}): JevIngestInput {
  return {
    gameId: GAME, branchId: BRANCH, gameDate: '1951-01-01', turn,
    source: 'government', actorIds: ['governo'], text, eventType: 'government_decision',
    scope: governmentScope(), ...over,
  };
}

function seedRaw(turns: number[], gameId = GAME, branchId: string | null = BRANCH): string[] {
  const inputs = turns.map(turn => rawInput(turn, `Decisione del turno ${turn}`, { gameId, branchId, scope: governmentScope(gameId, branchId) }));
  service.ingestJevBatch(inputs, '2026-01-01T00:00:00.000Z');
  return inputs.map(input => service.jevIngestId(input));
}

function rawRows(gameId = GAME, branchId: string | null = BRANCH) {
  return jevRepo.listMemory(governmentScope(gameId, branchId)).filter(record => record.type !== 'historical_episode');
}

function episodes(gameId = GAME, branchId: string | null = BRANCH) {
  return jevRepo.listMemory(governmentScope(gameId, branchId)).filter(record => record.type === 'historical_episode');
}

describe('JEV-W7 consolidamento: archiviazione, non cancellazione', () => {
  it('crea un episodio e archivia le grezze, senza eliminarle', () => {
    const ids = seedRaw([1, 2, 3, 4, 5]);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20, now: '2026-01-01T00:00:00.000Z' });
    expect(result).toMatchObject({ episodes_created: 1, memories_archived: 5, model_calls: 0 });

    const raws = rawRows();
    expect(raws).toHaveLength(5); // nessuna cancellazione
    expect(raws.every(record => record.lifecycle === 'archived')).toBe(true);
    const [episode] = episodes();
    expect(episode.type).toBe('historical_episode');
    expect([...episode.parentMemoryIds ?? []].sort()).toEqual([...ids].sort());
    expect(raws.every(record => record.parentMemoryIds?.[0] === episode.id)).toBe(true);
    expect(episode.text).toContain('EPISODIO STORICO');
    expect(episode.text).toContain('Decisione del turno 3');
  });

  it('è idempotente: rieseguire non duplica episodi né archivia due volte', () => {
    seedRaw([1, 2, 3, 4, 5]);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    const again = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(again).toMatchObject({ episodes_created: 0, episodes_updated: 0, memories_archived: 0, windows_processed: 0 });
    expect(episodes()).toHaveLength(1);
    expect(rawRows()).toHaveLength(5);
  });

  it('ricostruisce lo stesso episodio in modo deterministico', () => {
    seedRaw([1, 2, 3, 4, 5]);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20, now: '2026-01-01T00:00:00.000Z' });
    const first = episodes()[0];
    // Simula una riesecuzione sulla stessa finestra rimettendo le grezze attive.
    db.prepare(`UPDATE jev_memory SET lifecycle = 'active' WHERE scope_key = 'government' AND type <> 'historical_episode'`).run();
    expect(service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20, now: '2026-01-02T00:00:00.000Z' })).toMatchObject({ episodes_updated: 1, memories_archived: 5 });
    const second = episodes()[0];
    expect(second.text).toBe(first.text);
    expect(second.parentMemoryIds).toEqual(first.parentMemoryIds);
    expect(second.createdAt).toBe(first.createdAt); // i metadati esistenti non si azzerano
    expect(episodes()).toHaveLength(1);
  });
});

describe('JEV-W7 consolidamento: finestre e isolamento', () => {
  it('lascia grezze le memorie più recenti della finestra', () => {
    seedRaw([5, 15]);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    const active = rawRows().filter(record => record.lifecycle !== 'archived');
    expect(active.map(record => record.turn)).toEqual([15]);
    expect(episodes()).toHaveLength(1);
  });

  it('consolida ogni finestra completata quando il turno salta in avanti', () => {
    seedRaw([5, 15, 25]);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 40 });
    // readyTurn = 30 → finestre (0,10], (10,20], (20,30]: tre episodi.
    expect(result.episodes_created).toBe(3);
    expect(result.memories_archived).toBe(3);
    expect(episodes()).toHaveLength(3);
  });

  it('non contamina altri giochi né altri rami', () => {
    seedRaw([1, 2, 3], GAME, BRANCH);
    seedRaw([1, 2, 3], GAME, BRANCH_B);
    seedRaw([1, 2, 3], OTHER_GAME, BRANCH);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(episodes(GAME, BRANCH)).toHaveLength(1);
    expect(episodes(GAME, BRANCH_B)).toHaveLength(0);
    expect(episodes(OTHER_GAME, BRANCH)).toHaveLength(0);
    expect(rawRows(GAME, BRANCH_B).every(record => record.lifecycle !== 'archived')).toBe(true);
    expect(rawRows(OTHER_GAME, BRANCH).every(record => record.lifecycle !== 'archived')).toBe(true);
  });

  it('un turno non pronto non tocca il repository', () => {
    seedRaw([1, 2, 3]);
    const list = vi.spyOn(jevRepo, 'listMemory');
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 10 });
    expect(result).toMatchObject({ episodes_created: 0, memories_archived: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it('flag off: nessun episodio e nessun accesso al repository', () => {
    seedRaw([1, 2, 3]);
    process.env.JEV_MEMORY_ENABLED = 'false';
    const list = vi.spyOn(jevRepo, 'listScopes');
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(result.episodes_created).toBe(0);
    expect(result.memories_archived).toBe(0);
    expect(list).not.toHaveBeenCalled();
    expect(episodes()).toHaveLength(0);
  });

  it('uno scope illeggibile non fa fallire l’intero consolidamento', () => {
    seedRaw([1, 2, 3]);
    // Riga con scope_key non ricostruibile (non fa round-trip con lo scope
    // dichiarato): deve essere saltata con un warning, non far cadere tutto.
    db.prepare(`INSERT INTO jev_memory (id, game_id, branch_id, scope, scope_key, type, game_date, turn, created_at, text, actors_json, topics_json, importance, confidence, status, lifecycle, access_count)
      VALUES ('bogus', ?, ?, 'government', 'government:rotto', 'decision', '1951-01-01', 2, '2026-01-01T00:00:00.000Z', 'x', '[]', '[]', 0.5, 0.5, 'active', 'warm', 0)`).run(GAME, BRANCH);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(result.episodes_created).toBe(1);
    expect(result.memories_archived).toBe(3);
    expect(warn).toHaveBeenCalled();
  });
});

describe('JEV-W7 inverso dello scope (usato dal consolidamento)', () => {
  const cases: Array<[JevScope, string]> = [
    [{ kind: 'world', gameId: GAME, branchId: BRANCH }, 'world'],
    [{ kind: 'government', gameId: GAME, branchId: BRANCH }, 'government'],
    [{ kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'm1' }, 'minister:tesoro:m1'],
    [{ kind: 'nation', gameId: GAME, branchId: BRANCH, polityId: 'ITA' }, 'nation:ITA'],
    [{ kind: 'faction', gameId: GAME, branchId: BRANCH, factionId: 'lavoratori' }, 'faction:lavoratori'],
    [{ kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'FRA', b: 'ITA' }, 'diplomacy:FRA:ITA'],
    [{ kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA' }, 'nation:ITA:view:FRA'],
  ];

  it('ricostruisce ogni scope da kind + scopeKey con round-trip verificato', () => {
    for (const [scope, key] of cases) {
      expect(types.jevScopeKey(scope)).toBe(key);
      expect(types.jevScopeFromKey(scope.kind, key, GAME, BRANCH)).toEqual(scope);
    }
  });

  it('distingue nation da perception nonostante il prefisso condiviso', () => {
    const nation = types.jevScopeFromKey('nation', 'nation:ITA', GAME, BRANCH);
    const perception = types.jevScopeFromKey('perception', 'nation:ITA:view:FRA', GAME, BRANCH);
    expect(nation).toMatchObject({ kind: 'nation', polityId: 'ITA' });
    expect(perception).toMatchObject({ kind: 'perception', observer: 'ITA', subject: 'FRA' });
  });

  it('rifiuta una chiave che non torna al round-trip', () => {
    expect(() => types.jevScopeFromKey('government', 'nation:ITA', GAME, BRANCH)).toThrow(/round-trip/);
  });
});

describe('JEV-W7 retrieval: l’episodio sostituisce le grezze archiviate', () => {
  it('la fazione legge l’episodio e non più le memorie archiviate', () => {
    const factionId = 'lavoratori';
    service.ingestJevBatch(service.factionMemoryInputs([
      { factionId, kind: 'favor', lever: 'welfare', weight: 10, turn: 2, gameDate: '1951-01-01', text: 'GREZZA_WELFARE', sourceEventId: 'p1' },
      { factionId, kind: 'grievance', lever: 'tasse', weight: -8, turn: 3, gameDate: '1951-01-01', text: 'GREZZA_TASSE', sourceEventId: 'p2' },
    ], { gameId: GAME, branchId: BRANCH, gameDate: '1951-01-01', turn: 3 }));
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    const memory = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId, asOf: { gameDate: '1951-06-01', turn: 20 } });
    expect(memory.text).toContain('EPISODIO STORICO');
    expect(memory.text).toContain('GREZZA_WELFARE');
    // Le archiviate non competono più come memoria attiva: la sezione ha solo l'episodio.
    expect(memory.ids).toHaveLength(1);
    expect(memory.text.split('EPISODIO STORICO').length - 1).toBe(1);
  });

  it('l’episodio rispetta il tetto di byte (nessuna sintesi inventata)', () => {
    const long = 'X'.repeat(300);
    seedRaw([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], GAME, BRANCH);
    // Testo lungo per ogni grezza: l’episodio deve restare bounded.
    db.prepare(`UPDATE jev_memory SET text = ? WHERE scope_key = 'government' AND type <> 'historical_episode'`).run(`DECISIONE ${long}`);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    const [episode] = episodes();
    expect(Buffer.byteLength(episode.text, 'utf8')).toBeLessThanOrEqual(service.EPISODE_TEXT_BYTES);
    expect(episode.text).toContain('EPISODIO STORICO');
    expect(episode.text).toContain('memorie consolidate');
  });
});

describe('JEV-W7 questioni aperte e rewind', () => {
  it('non consolida promesse e conflitti aperti: restano eligible per UNRESOLVED', () => {
    seedRaw([3, 4], GAME, BRANCH); // due decisioni
    service.ingestJevBatch([
      rawInput(2, 'PROMESSA_APERTA', { eventType: 'government_promise' }),
      rawInput(2, 'CONFLITTO_APERTO', { eventType: 'war_declared' }),
    ]);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(result.episodes_created).toBe(1);
    expect(result.memories_archived).toBe(2); // solo le due decisioni
    const [episode] = episodes();
    expect(episode.text).not.toContain('PROMESSA_APERTA');
    expect(episode.text).not.toContain('CONFLITTO_APERTO');
    const open = rawRows().filter(record => record.status === 'active' && ['promise', 'conflict'].includes(record.type));
    expect(open).toHaveLength(2);
    expect(open.every(record => record.lifecycle !== 'archived')).toBe(true);
  });

  it('una volta risolte, le questioni aperte entrano nell’episodio e si archiviano', () => {
    const ids = service.ingestJevBatch([
      rawInput(2, 'PROMESSA_RISOLTA', { eventType: 'government_promise' }),
    ]).outcomes.map(outcome => outcome.id);
    db.prepare(`UPDATE jev_memory SET status = 'resolved' WHERE id = ?`).run(ids[0]);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(result.memories_archived).toBe(1);
    expect(episodes()[0].text).toContain('PROMESSA_RISOLTA');
  });

  it('il rewind ricostruisce le grezze orfane invece di lasciarle invisibili', () => {
    seedRaw([1, 2, 3, 4, 5], GAME, BRANCH);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    expect(episodes()).toHaveLength(1);
    expect(rawRows().every(record => record.lifecycle === 'archived')).toBe(true);
    // Rewind dentro la finestra: l’episodio (turn 5) sparisce, le grezze <= 4 no.
    gameRepository.deleteAfterTurn(GAME, 3);
    expect(episodes()).toHaveLength(0);
    const survivors = rawRows();
    expect(survivors.map(record => record.turn).sort()).toEqual([1, 2, 3, 4]);
    expect(survivors.every(record => record.lifecycle !== 'archived')).toBe(true);
    expect(survivors.every(record => !record.parentMemoryIds?.length)).toBe(true);
  });

  it('il rewind che conserva l’episodio non tocca le grezze archiviate', () => {
    seedRaw([1, 2, 3, 4, 5], GAME, BRANCH);
    service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    gameRepository.deleteAfterTurn(GAME, 8); // l’episodio (turn 5) resta
    expect(episodes()).toHaveLength(1);
    expect(rawRows().every(record => record.lifecycle === 'archived')).toBe(true);
  });
});
