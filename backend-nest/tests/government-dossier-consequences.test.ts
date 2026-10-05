import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import type { ActionRecord } from '../src/game-session';
import type { LedgerEntryInput } from '../src/domain/ledger';

const DB = path.join(os.tmpdir(), `government-dossier-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;
let db: typeof import('../src/database').default;
let readGovernmentDossier: typeof import('../src/core/government/GovernmentDossier').readGovernmentDossier;
let appendLedgerEntries: typeof import('../src/repositories/ledger.repository').appendLedgerEntries;
let semanticStateHash: typeof import('../src/domain/semantic-hash').semanticStateHash;
let captureEconomicSnapshot: typeof import('../src/repositories/economy-snapshot.repository').captureEconomicSnapshot;
const order: ActionRecord = { id: 'order', playerId: 'president', turn: 2, text: 'Importare grano', createdAt: '2026-06-01T00:00:00Z' };

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default; database.initDatabase();
  ({ readGovernmentDossier } = await import('../src/core/government/GovernmentDossier'));
  ({ appendLedgerEntries } = await import('../src/repositories/ledger.repository'));
  ({ semanticStateHash } = await import('../src/domain/semantic-hash'));
  ({ captureEconomicSnapshot } = await import('../src/repositories/economy-snapshot.repository'));
  db.prepare('INSERT INTO worlds (id,name) VALUES (?,?)').run('world', 'World');
  for (const game of ['game', 'foreign']) {
    db.prepare('INSERT INTO games (id,world_id,head_branch_id) VALUES (?,?,?)').run(game, 'world', `${game}-main`);
    db.prepare('INSERT INTO game_branches (id,game_id,name,created_at) VALUES (?,?,?,?)').run(`${game}-main`, game, 'main', '2026-06-01');
  }
  db.prepare('INSERT INTO game_branches (id,game_id,name,created_at) VALUES (?,?,?,?)').run('fork', 'game', 'fork', '2026-06-01');
  db.prepare('INSERT INTO players (id,game_id,name,region_id,polity_id) VALUES (?,?,?,?,?)').run('president', 'game', 'President', 'region', 'UGA');
  db.prepare('INSERT INTO players (id,game_id,name,region_id,polity_id) VALUES (?,?,?,?,?)').run('other', 'game', 'Other', 'region', 'KEN');
});
beforeEach(() => {
  for (const table of ['simulation_action_outcomes', 'simulation_events', 'simulation_checkpoints', 'simulation_runs', 'turn_results', 'actions', 'pending_actions', 'ledger_entries', 'strict_effect_staging', 'finance_cashflows', 'finance_operations']) db.prepare(`DELETE FROM ${table}`).run();
});
afterAll(() => { db?.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true }); });

function recordAction(action = order, gameId = 'game') {
  db.prepare('INSERT INTO actions (id,game_id,player_id,turn,text,created_at) VALUES (?,?,?,?,?,?)')
    .run(action.id, gameId, action.playerId, action.turn, action.text, action.createdAt);
}
function snapshot(baseline = true, money = 10, food = 0): VerifiedWorldSnapshot {
  const data = (date: string, turn: number, cash: number, stock: number) => ({
    id: 'game', playerPolityId: 'UGA', currentDate: date, currentTurn: turn,
    worldState: { resources: { stock: { money: cash, food: stock } } },
    actions: [order], results: [],
  });
  const before = buildVerifiedWorldSnapshot({ gameData: data('1951-02-01', 2, 10, 0), branchId: 'game-main' });
  return buildVerifiedWorldSnapshot({ gameData: data('1951-03-01', 3, money, food), branchId: 'game-main', previousSnapshot: baseline ? before : null });
}
function entry(effectId = 'order', atDate = '1951-02-15'): LedgerEntryInput {
  return { effectId, entryIndex: 0, cause: 'consegna', kind: 'material', unitId: 'food', fromRef: 'supplier', toRef: 'treasury', ownerRef: 'UGA', delta: '250', atDate };
}
function report(world: VerifiedWorldSnapshot, branch = 'game-main', json = '["Grano consegnato"]') {
  const payload = { economicState: captureEconomicSnapshot('game', branch) };
  db.prepare("INSERT INTO simulation_runs (id,game_id,mode,status,start_date,created_at) VALUES ('run','game','fixed','completed','1951-02-01','2026-06-01')").run();
  db.prepare('INSERT INTO simulation_checkpoints (id,run_id,game_id,revision,turn,game_date,data,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('checkpoint', 'run', 'game', 1, 3, '1951-03-01', JSON.stringify(payload), semanticStateHash(payload), '2026-06-01');
  const events = [{ id: 'event', date: '1951-03-01', headline: 'Grano consegnato', detail: '', source: 'world' as const, simulationId: 'run', sourceActionIds: ['order'] }];
  db.prepare('INSERT INTO turn_results (id,game_id,turn,narration,events,timeline_events,date) VALUES (?,?,?,?,?,?,?)')
    .run('result', 'game', 3, 'Consegna riuscita', '[]', JSON.stringify(events), '1951-03-01');
  db.prepare('INSERT INTO simulation_action_outcomes (id,run_id,game_id,action_id,status,summary,event_headlines) VALUES (?,?,?,?,?,?,?)')
    .run('outcome', 'run', 'game', 'order', 'accepted', 'Consegna riuscita', json);
  world.recent.consequences = [{ id: 'result', turn: 3, date: '1951-03-01', narration: 'Consegna riuscita', countryResponse: '', events: [], timelineEvents: events }];
}

describe('GovernmentDossier — canonical read-only consequence chain', () => {
  it('keeps signed pending orders separate from reports and actual application', () => {
    const world = snapshot();
    db.prepare('INSERT INTO pending_actions (id,game_id,text,created_at) VALUES (?,?,?,?)').run('pending', 'game', 'Comprare grano', '2026-06-01');
    world.recent.signedActs = [{ id: 'pending', text: 'Comprare grano', createdAt: '2026-06-01', status: 'signed_pending_execution' }];
    recordAction(); report(world);
    const dossier = readGovernmentDossier(world);
    expect(dossier.decisions.find(x => x.id === 'pending')).toMatchObject({ status: 'signed_pending_execution', executionStatus: 'not_started', result: null, sourceRef: 'pending_actions.pending' });
    expect(dossier.decisions.find(x => x.id === 'order')).toMatchObject({ status: 'recorded', executionStatus: null, result: [{ status: 'accepted', evidence: 'report_only', sourceRef: 'simulation_action_outcomes.outcome' }] });
    expect(dossier.appliedEffects).toEqual([]); // narrative success is not a material delivery
  });

  it('recognizes canonical actions when the legacy DB records execution time instead of signature time', () => {
    recordAction();
    // TurnPipelineService.addAction does not persist ActionRecord.createdAt:
    // SQLite defaults to execution wall-clock time, unlike the signed queue.
    db.prepare("UPDATE actions SET created_at='2026-06-15 13:20:00'").run();
    appendLedgerEntries('game', 'game-main', [entry()]);
    const dossier = readGovernmentDossier(snapshot());
    expect(dossier.decisions).toMatchObject([{ id: 'order', createdAt: '2026-06-15 13:20:00', sourceRef: 'actions.order' }]);
    expect(dossier.appliedEffects?.[0].sourceAction?.id).toBe('order');
  });

  it('exposes exact applied ledger quantities and only explicit action links, never delta causation', () => {
    recordAction();
    appendLedgerEntries('game', 'game-main', [entry(), entry('unrelated')]);
    const world = snapshot(true, 9, 0);
    const dossier = readGovernmentDossier(world);
    expect(dossier.before).toMatchObject({ date: '1951-02-01', turn: 2, facts: { treasury: { rawValue: 10 }, 'resources.food': { rawValue: 0 } } });
    expect(dossier.after.facts.treasury.rawValue).toBe(9);
    expect(dossier.appliedEffects).toHaveLength(2);
    expect(dossier.appliedEffects![0]).toMatchObject({ effectId: 'order', cause: 'consegna', delta: '250', atDate: '1951-02-15', sourceRef: 'ledger_entries.game-main.order.0', sourceAction: { id: 'order', sourceRef: 'actions.order' } });
    expect(dossier.appliedEffects![1].sourceAction).toBeNull();
    expect(dossier.observedChanges).toEqual(world.changes);
    expect(dossier.causalAttribution).toBe('explicit_links_only');
    expect(JSON.stringify(dossier.observedChanges)).not.toContain('order');
  });

  it('distinguishes a measured zero and unchanged shortage from unavailable effects', () => {
    const dossier = readGovernmentDossier(snapshot());
    expect(dossier.before?.facts['resources.food'].rawValue).toBe(0);
    expect(dossier.after.facts['resources.food'].rawValue).toBe(0);
    expect(dossier.observedChanges.comparedKeys).toContain('resources.food');
    expect(dossier.observedChanges.deltas).toEqual([]);
    expect(dossier.appliedEffects).toEqual([]);
    const unknown = readGovernmentDossier(snapshot(false));
    expect(unknown.before).toBeNull(); expect(unknown.appliedEffects).toBeNull();
  });

  it('an actual canonical cash shortage leaves arrears, not a fabricated payment effect', async () => {
    const finance = await import('../src/services/FinanceService');
    finance.createCashflow('game', 'game-main', { cashflowId: 'grain-debt',
      debtor: { ref: 'treasury', currencyId: 'usd' }, creditor: { ref: 'supplier', currencyId: 'usd' },
      amount: '100', dueDate: '1951-02-15', legalPriority: 1, partialAllowed: true, shortagePolicy: 'arrears' });
    expect(finance.settleDueCashflows('game', 'game-main', '1951-02-15')).toEqual([{ cashflowId: 'grain-debt', paid: '0', status: 'arrears' }]);
    const world = snapshot(); recordAction(); report(world);
    expect(readGovernmentDossier(world).appliedEffects).toEqual([]);
    // A partial canonical payment is the quantity actually moved, not the
    // authorized amount or the report's claim of complete fulfillment.
    appendLedgerEntries('game', 'game-main', [{ effectId: 'funding', entryIndex: 0, cause: 'stanziamento', kind: 'money', unitId: 'usd', fromRef: null, toRef: 'treasury', delta: '30', atDate: '1951-02-01' }]);
    expect(finance.settleDueCashflows('game', 'game-main', '1951-02-16')).toEqual([{ cashflowId: 'grain-debt', paid: '30', status: 'arrears' }]);
    expect(readGovernmentDossier(world).appliedEffects).toMatchObject([{ cause: 'pagamento', delta: '30', sourceAction: null }]);
  });

  it('invalid canonical ledger quantities leave application unknown rather than quietly zero', () => {
    appendLedgerEntries('game', 'game-main', [entry()]);
    db.prepare("UPDATE ledger_entries SET delta='not-an-integer'").run();
    expect(readGovernmentDossier(snapshot()).appliedEffects).toBeNull();
  });

  it('does not infer an effects period from a ledger or an older history row without a baseline', () => {
    appendLedgerEntries('game', 'game-main', [entry()]);
    expect(readGovernmentDossier(snapshot(false)).appliedEffects).toBeNull();
    const world = snapshot(); world.changes.previousDate = '1951-04-01';
    expect(readGovernmentDossier(world).before).toBeNull();
    expect(readGovernmentDossier(world).appliedEffects).toBeNull();
  });

  it('rejects foreign-game/branch/future/baseline-date rows and abandoned or foreign-player actions', () => {
    recordAction();
    const abandoned = { ...order, id: 'abandoned' }; recordAction(abandoned);
    const other = { ...order, id: 'other-order', playerId: 'other' }; recordAction(other);
    const foreign = { ...order, id: 'foreign-order' }; recordAction(foreign, 'foreign');
    const future = { ...order, id: 'future-order', turn: 4 }; recordAction(future);
    appendLedgerEntries('game', 'game-main', [entry('valid'), entry('old', '1951-02-01'), entry('future', '1951-03-02')]);
    appendLedgerEntries('game', 'fork', [entry('fork')]);
    appendLedgerEntries('foreign', 'foreign-main', [entry('foreign')]);
    appendLedgerEntries('foreign', 'game-main', [entry('spoofed-game')]);
    const world = snapshot(); world.recent.orders.push(other, foreign, future);
    const dossier = readGovernmentDossier(world);
    expect(dossier.decisions.map(x => x.id)).toEqual(['order']);
    expect(dossier.appliedEffects?.map(x => x.effectId)).toEqual(['valid']);
    world.branchId = 'foreign-main';
    expect(readGovernmentDossier(world).appliedEffects).toBeNull();
    expect(readGovernmentDossier(world).decisions).toEqual([]);
  });

  it('treats malformed report JSON or branch provenance as unknown, not executed or zero material effect', () => {
    recordAction(); const world = snapshot(); report(world, 'game-main', '{invalid');
    expect(readGovernmentDossier(world).decisions[0].result).toBeNull();
    db.prepare("UPDATE simulation_action_outcomes SET event_headlines='[]'").run();
    db.prepare("UPDATE simulation_checkpoints SET data='{invalid'").run();
    expect(readGovernmentDossier(world).decisions[0].result).toBeNull();
    const fork = { economicState: captureEconomicSnapshot('game', 'fork') };
    db.prepare('UPDATE simulation_checkpoints SET data=?,content_hash=?').run(JSON.stringify(fork), semanticStateHash(fork));
    expect(readGovernmentDossier(world).decisions[0].result).toBeNull();
    const main = { economicState: captureEconomicSnapshot('game', 'game-main') };
    db.prepare('UPDATE simulation_checkpoints SET data=?,content_hash=?').run(JSON.stringify(main), 'invalid-hash');
    expect(readGovernmentDossier(world).decisions[0].result).toBeNull();
    db.prepare('UPDATE simulation_checkpoints SET content_hash=?').run(semanticStateHash(main));
    db.prepare("UPDATE simulation_action_outcomes SET game_id='foreign'").run();
    expect(readGovernmentDossier(world).decisions[0].result).toBeNull();
    expect(readGovernmentDossier(world).appliedEffects).toEqual([]);
  });

  it('is stable on reload and read-only, with no model/engine invocation or staged-effect promotion', async () => {
    recordAction(); appendLedgerEntries('game', 'game-main', [entry()]);
    const world = snapshot(); report(world);
    db.prepare('INSERT INTO strict_effect_staging (game_id,branch_id,anchor_revision,effect_id,kind,payload_json) VALUES (?,?,?,?,?,?)')
      .run('game', 'game-main', 0, 'only-staged', 'ledger', JSON.stringify(entry('only-staged')));
    const changes = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const original = structuredClone(world);
    const first = readGovernmentDossier(world);
    vi.resetModules();
    const reload = (await import('../src/core/government/GovernmentDossier')).readGovernmentDossier;
    const reloadedDb = (await import('../src/database')).default;
    try { expect(reload(JSON.parse(JSON.stringify(world)))).toEqual(first); } finally { reloadedDb.close(); }
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(changes);
    expect(first.appliedEffects?.map(x => x.effectId)).toEqual(['order']);
    expect(world).toEqual(original);
    // Database authorizer is unavailable in better-sqlite3: also reject every
    // attempted write at the adapter boundary, including lazy readers.
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`Read attempted write: ${sql}`);
      return prepare(sql);
    });
    try { expect(readGovernmentDossier(world)).toEqual(first); } finally { spy.mockRestore(); }
  });
});
