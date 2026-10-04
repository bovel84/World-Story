import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `world-story-verified-session-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

let db: typeof import('../src/database').default;
let session: import('../src/game-session').GameSession;
let registry: import('../src/session-registry').SessionRegistry;
let history: typeof import('../src/repositories/national-account.repository').nationalAccountRepository;
let games: typeof import('../src/repositories/game.repository').gameRepository;
const worldId = 'verified_uganda_world';
const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { throw new Error('Verified reads must not invoke an LLM'); },
  async stream() { throw new Error('Verified reads must not invoke an LLM'); },
  clearCache() {},
};

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repos = await import('../src/repositories');
  history = repos.nationalAccountRepository;
  games = repos.gameRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: worldId, name: 'Verified Uganda', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{ id: `${worldId}_UGA`, name: 'Uganda', color: '#FF0000', owner: 'UGA',
      population: 5_000_000, gdp: 200, militaryPower: 40, flag: 'UGA', coastal: false,
      borders: [], objects: [] }],
  );
});
beforeEach(() => {
  const created = registry.createSession(worldId, 'Presidente', `${worldId}_UGA`, '#FF0000');
  session = registry.getSession(created.gameId)!;
});
afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

function capture(): import('../src/game-session').SaveData {
  return structuredClone((session as any).captureCheckpointData());
}

function savedBaseline(foodAvailable = true) {
  const state = capture();
  state.currentTurn = 2; state.currentDate = '1951-02-01';
  session.loadFromSave(state);
  const current = session.getVerifiedWorldSnapshot();
  const account = {
    ...current.economy.account, polityId: 'UGA', money: current.economy.treasury! - 0.123456789,
    monthlyBalance: current.economy.monthlyBalance! + 0.234567891,
    socialTension: current.facts.socialTension.rawValue as number - 1.234567891,
    ...(foodAvailable ? { foodCoverageMonths: current.economy.foodCoverageMonths! + 0.345678912 } : {}),
  };
  // TurnPipeline records its completed date before incrementing the logical
  // turn; the persisted save is the authoritative prior-turn/date anchor.
  history.append(current.gameId, current.branchId!, 'UGA', 1, state.currentDate, account);
  const save = session.save('Prior turn');
  const priorState = capture();
  const next = structuredClone(priorState);
  next.currentTurn = 3; next.currentDate = '1951-03-01';
  session.loadFromSave(next);
  return { account, priorState, saveId: save.saveId, branchId: current.branchId! };
}

describe('GameSession.getVerifiedWorldSnapshot', () => {
  it('exposes server-owned typed reality with canonical geography and no fabricated capacity assets', () => {
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.polityId).toBe('UGA');
    expect(snapshot.geography).toMatchObject({ coastal: false, landlocked: true });
    expect(snapshot.infrastructure.ports).toEqual([]);
    expect(snapshot.infrastructure.railways).toEqual([]);
    expect(snapshot.infrastructure.factories).toEqual([]);
    expect(snapshot.facts.ports.value).toBe('Porti posseduti: nessuno');
    expect(snapshot.economy.treasury).not.toBeNull();
    expect(snapshot.diplomacy.commitments).toEqual([]);
    expect(snapshot.diplomacy.activeNegotiations).toBeNull();
    expect(snapshot.branchId).toBeTruthy();
    expect(snapshot.changes).toMatchObject({ available: false, reason: 'previous_snapshot_unavailable' });
  });

  it('does not pretend that a prior getter call in the same turn is a previous-turn baseline', () => {
    const previous = session.getVerifiedWorldSnapshot();
    const snapshot = session.getVerifiedWorldSnapshot(previous);
    expect(snapshot.changes).toMatchObject({ available: false, reason: 'previous_snapshot_not_comparable', deltas: [] });
  });

  it('supplies actual persisted prior-turn values without an explicit previous argument or a getter cache', () => {
    const { account } = savedBaseline();
    console.log('DEBUG_BASELINE', db.prepare('SELECT current_turn,current_date,saved_at,data,content_hash FROM saves WHERE game_id=?').all(session.id), db.prepare('SELECT * FROM national_account_history WHERE game_id=?').all(session.id), capture(), (session as any).buildGameData().playerPolityId);
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.changes).toMatchObject({ available: true, previousTurn: 2, previousDate: '1951-02-01' });
    for (const [key, before] of Object.entries({ treasury: account.money, monthlyBalance: account.monthlyBalance,
      foodCoverageMonths: account.foodCoverageMonths!, socialTension: account.socialTension })) {
      const after = snapshot.facts[key].rawValue as number;
      expect(snapshot.changes.deltas.find(delta => delta.key === key)).toMatchObject({ before, after, delta: after - before });
    }
    const beforeRead = db.prepare('SELECT total_changes() AS changes').get();
    expect(session.getVerifiedWorldSnapshot().changes).toEqual(snapshot.changes);
    expect(db.prepare('SELECT total_changes() AS changes').get()).toEqual(beforeRead);
  });

  it('does not invent historical food coverage or declare military unchanged from account history', () => {
    savedBaseline(false);
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.changes.available).toBe(true);
    expect(snapshot.changes.comparedKeys).toEqual(expect.arrayContaining(['treasury', 'monthlyBalance', 'socialTension']));
    expect(snapshot.changes.unavailableKeys).toEqual(expect.arrayContaining(['foodCoverageMonths', 'military']));
    expect(snapshot.changes.deltas.some(delta => delta.key === 'foodCoverageMonths')).toBe(false);
  });

  it('survives session reconstruction from persisted state without retaining a read baseline in RAM', async () => {
    const { account } = savedBaseline();
    const { GameSession } = await import('../src/game-session');
    const reloaded = new GameSession(session.id, worldId, stubProvider);
    reloaded.loadFromSave(capture());
    expect(reloaded.getVerifiedWorldSnapshot().changes.deltas.find(delta => delta.key === 'treasury'))
      .toMatchObject({ before: account.money });
  });

  it('never reuses a baseline across branches or borrows a parent branch history', () => {
    const { branchId } = savedBaseline();
    expect(session.getVerifiedWorldSnapshot().changes.available).toBe(true);
    const state = capture();
    session.loadFromSave(state, undefined, { newBranch: { name: 'Verified fork' } });
    expect(session.getVerifiedWorldSnapshot().branchId).not.toBe(branchId);
    expect(session.getVerifiedWorldSnapshot().changes).toMatchObject({ available: false, deltas: [] });
  });

  it('restoring an earlier date in the same branch cannot expose future account rows or saved baselines', () => {
    const { priorState, account, branchId } = savedBaseline();
    history.append(session.id, branchId, 'UGA', 3, '1951-04-01', { ...account, money: -999 });
    session.save('Future');
    session.loadFromSave(priorState);
    expect(session.getVerifiedWorldSnapshot().changes).toMatchObject({ available: false, deltas: [] });
    expect(session.getVerifiedWorldSnapshot().changes.deltas.some(delta => delta.before === -999)).toBe(false);
  });

  it('rejects saved anchors from an abandoned history even if turn and branch IDs still match', () => {
    const { priorState, branchId, account } = savedBaseline();
    const abandoned = capture();
    abandoned.currentTurn = 3; abandoned.currentDate = '1951-03-01';
    abandoned.results = [{ id: 'abandoned-result', turn: 2, date: '1951-03-01', narration: 'Abandoned', countryResponse: '', events: [] }];
    session.loadFromSave(abandoned);
    history.append(session.id, branchId, 'UGA', 2, '1951-03-01', { ...account, money: -999 });
    session.save('Abandoned prior state');
    session.loadFromSave(priorState);
    const alternate = capture();
    alternate.currentTurn = 4; alternate.currentDate = '1951-03-15';
    alternate.results = [{ id: 'alternate-result', turn: 2, date: '1951-03-01', narration: 'Alternate', countryResponse: '', events: [] }];
    session.loadFromSave(alternate);
    expect(session.getVerifiedWorldSnapshot().changes).toMatchObject({ available: false, deltas: [] });
  });

  it('history points alone cannot identify a true prior-turn state, and malformed saves stay unknown', () => {
    const initial = session.getVerifiedWorldSnapshot();
    history.append(session.id, initial.branchId!, 'UGA', initial.turn! - 1, '1950-12-01', { money: -999, monthlyBalance: -2 });
    db.prepare('INSERT INTO saves(id,game_id,name,current_turn,current_date,data,saved_at) VALUES(?,?,?,?,?,?,?)')
      .run('corrupt-anchor', session.id, 'Corrupt', initial.turn! - 1, '1950-12-01', '{', new Date().toISOString());
    expect(session.getVerifiedWorldSnapshot().changes).toMatchObject({ available: false, deltas: [] });
    expect(games.getHeadBranch(session.id)).toBe(initial.branchId);
  });
});
