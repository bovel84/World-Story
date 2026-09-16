/**
 * GamePersistenceService — test di isolamento su DB temporaneo:
 * salvataggi/checkpoint, snapshot di rewind e codec del playback in pausa.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { semanticStateHash } from '../src/domain/semantic-hash';

const TEST_DB = path.join(os.tmpdir(), `world-story-persistence-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let GamePersistenceService: any;
const GAME_ID = 'persist-game';

/** SaveData minimale ma serializzabile e con hash deterministico. */
function baseSaveData(overrides: Record<string, any> = {}) {
  return {
    currentTurn: 3,
    currentDate: '1951-03-01',
    players: [{ id: 'p1', name: 'Giocatore', regionId: 'r1', color: '#f00' }],
    regions: [['r1', { id: 'r1', name: 'Roma', color: '#f00', owner: 'PLAYER', population: 1, gdp: 1, militaryPower: 1, objects: [], borders: [], status: 'active' }]],
    relationships: {},
    actions: [],
    results: [],
    ...overrides,
  };
}

function makeService(stateOverrides: Record<string, any> = {}) {
  return new GamePersistenceService({
    gameId: GAME_ID,
    captureState: () => baseSaveData(stateOverrides) as any,
    currentTurn: () => 3,
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('p-world', 'W', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'p-world', 3, '1951-03-01')`).run(GAME_ID);
  const mod = await import('../src/game/GamePersistenceService');
  GamePersistenceService = mod.GamePersistenceService;
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('GamePersistenceService — salvataggi', () => {
  it('save inserisce la riga con hash semantico coerente', () => {
    const svc = makeService();
    const { saveId, currentTurn, currentDate } = svc.save('checkpoint-1');
    expect(currentTurn).toBe(3);
    expect(currentDate).toBe('1951-03-01');
    const row = db.prepare('SELECT * FROM saves WHERE id = ?').get(saveId) as any;
    expect(row.name).toBe('checkpoint-1');
    expect(row.content_hash).toBe(semanticStateHash(baseSaveData()));
    expect(JSON.parse(row.data).currentTurn).toBe(3);
  });

  it('semanticHash coincide con quello del salvataggio', () => {
    const svc = makeService();
    const { saveId } = svc.save('checkpoint-2');
    const row = db.prepare('SELECT content_hash FROM saves WHERE id = ?').get(saveId) as any;
    expect(svc.semanticHash()).toBe(row.content_hash);
  });
});

describe('GamePersistenceService — rewind', () => {
  it('nessuno snapshot → canRewind false', () => {
    const svc = makeService();
    expect(svc.canRewind()).toBe(false);
    expect(svc.latestRewindSnapshot()).toBeNull();
  });

  it('salva, legge e consuma solo l’ultimo snapshot di rewind', () => {
    const svc = makeService();
    svc.saveRewindSnapshot();
    svc.saveRewindSnapshot();
    expect(svc.canRewind()).toBe(true);
    // ne resta uno solo
    const count = db.prepare("SELECT COUNT(*) AS c FROM saves WHERE game_id = ? AND name = '__rewind__'").get(GAME_ID) as any;
    expect(count.c).toBe(1);

    const snapshot = svc.latestRewindSnapshot();
    expect(snapshot?.saveData.currentTurn).toBe(3);
    expect(snapshot?.hash).toBe(semanticStateHash(baseSaveData()));

    svc.consumeRewindSnapshot(snapshot!.id);
    expect(svc.canRewind()).toBe(false);
  });
});

describe('GamePersistenceService — restore (loadFromSave)', () => {
  function makeBridge(initial: Record<string, any> = {}) {
    const state: any = {
      currentTurn: 1,
      currentDate: '1951-01-01',
      players: [],
      regions: new Map([['r1', { id: 'r1', name: 'Roma', owner: 'PLAYER', population: 1, gdp: 1, militaryPower: 1 }]]),
      relationships: {},
      actions: [],
      results: [],
      consolidatedHistory: '',
      consolidatedUpTo: 0,
      difficulty: 'normal',
      interveneRequested: false,
      pendingActions: [],
      pausedRun: null,
      ...initial,
    };
    const svc = new GamePersistenceService({
      gameId: GAME_ID,
      captureState: () => ({}),
      currentTurn: () => state.currentTurn,
      isStrictGame: () => false,
      captureApplyState: () => ({ ...state, regions: new Map(state.regions) }),
      applyState: (s: any) => { Object.assign(state, s); },
      prepareRestore: () => {},
      syncRegionsToDB: () => {},
      afterRestore: () => {},
    });
    return { svc, state };
  }

  it('applica lo snapshot allo stato e al DB', () => {
    const { svc, state } = makeBridge();
    svc.loadFromSave({
      currentTurn: 7,
      currentDate: '1951-07-01',
      players: [{ id: 'p', name: 'G', regionId: 'r1', color: '#000' }],
      regions: [['r1', { id: 'r1', name: 'Roma', owner: 'PLAYER' }]],
    } as any);
    expect(state.currentTurn).toBe(7);
    expect(state.currentDate).toBe('1951-07-01');
    expect(state.actions).toHaveLength(0);
    const game = db.prepare('SELECT current_turn, "current_date" AS current_date FROM games WHERE id = ?').get(GAME_ID) as any;
    expect(game.current_turn).toBe(7);
    expect(game.current_date).toBe('1951-07-01');
  });

  it('hash mismatch rifiuta il restore senza mutare lo stato', () => {
    const { svc, state } = makeBridge();
    const snapshot = baseSaveData();
    expect(() => svc.loadFromSave(snapshot as any, 'hash-sbagliato')).toThrow(/snapshot_hash_mismatch/);
    expect(state.currentTurn).toBe(1);
  });
});

describe('GamePersistenceService — codec playback in pausa', () => {
  it('revivePausedRunState normalizza i campi e usa il turno di fallback', () => {
    const svc = makeService();
    const state = svc.revivePausedRunState({
      runId: 'run-1',
      periodStart: '1951-03-01',
      destination: '1951-04-01',
      remainingEvents: [{ headline: 'Evento', date: '1951-03-10', mapChanges: [] }],
    });
    expect(state).toBeTruthy();
    expect(state.runId).toBe('run-1');
    expect(state.jumpTurn).toBe(3);
    expect(state.revisionBase).toBe(4);
    expect(state.completion.narration).toBe('');
    expect(state.appliedCount).toBe(0);
  });

  it('revivePausedRunState rifiuta stati invalidi', () => {
    const svc = makeService();
    expect(svc.revivePausedRunState(null)).toBeNull();
    expect(svc.revivePausedRunState({ runId: 1 })).toBeNull();
    expect(svc.revivePausedRunState({ runId: 'x', remainingEvents: [], periodStart: 2, destination: 'd' })).toBeNull();
  });

  it('revivePausedRun legge la riga simulation_runs solo se awaiting_next', () => {
    const svc = makeService();
    const pending = JSON.stringify({
      runId: 'run-2', periodStart: '1951-03-01', destination: '1951-04-01', remainingEvents: [],
    });
    db.prepare(`INSERT INTO simulation_runs (id, game_id, mode, status, start_date, created_at, pending_state)
      VALUES ('run-2', ?, 'jump', 'awaiting_next', '1951-03-01', '1951-03-01', ?)`).run(GAME_ID, pending);
    expect(svc.revivePausedRun('run-2')?.runId).toBe('run-2');
    expect(svc.revivePausedRun('missing')).toBeNull();

    db.prepare(`INSERT INTO simulation_runs (id, game_id, mode, status, start_date, created_at)
      VALUES ('run-3', ?, 'jump', 'completed', '1951-03-01', '1951-03-01')`).run(GAME_ID);
    expect(svc.revivePausedRun('run-3')).toBeNull();
  });

  it('revivePausedRunFromRow accetta stringa o oggetto', () => {
    const svc = makeService();
    const raw = { runId: 'r', periodStart: 'a', destination: 'b', remainingEvents: [] };
    expect(svc.revivePausedRunFromRow({ pendingState: raw })?.runId).toBe('r');
    expect(svc.revivePausedRunFromRow({ pendingState: JSON.stringify(raw) })?.runId).toBe('r');
    expect(svc.revivePausedRunFromRow({})).toBeNull();
  });
});
