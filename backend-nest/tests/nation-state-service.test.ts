/**
 * NationStateService — test di isolamento (DB temporaneo): modificatori,
 * riserve naturali e mercato. Lo stato materiale è coperto end-to-end da
 * material-economy/natural-resource-integration; qui si verifica il servizio.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-nation-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let NationStateService: any;
const GAME_ID = 'nation-game';

function makeService(accounts: Record<string, any> = {}) {
  return new NationStateService({
    gameId: GAME_ID,
    currentTurn: () => 1,
    currentDate: () => '1951-01-01',
    isStrictGame: () => false,
    playerPolityId: () => 'PLAYER',
    worldStateOptions: () => ({ modernFacts: false, startDate: '1951-01-01' }),
    initialAccounts: () => ({}),
    sessionAccounts: () => accounts,
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('n-world', 'N', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'n-world', 1, '1951-01-01')`).run(GAME_ID);
  const mod = await import('../src/game/NationStateService');
  NationStateService = mod.NationStateService;
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

describe('NationStateService — modificatori', () => {
  it('parte dalla neutralità e persiste', () => {
    const svc = makeService();
    const empty = svc.modifiersFor('PLAYER');
    expect(empty.stability).toBeTypeOf('number');
    svc.saveModifiers('PLAYER', { ...empty, stability: empty.stability + 5 });
    expect(svc.modifiersFor('PLAYER').stability).toBe(empty.stability + 5);

    // Una nuova istanza rilegge dal DB.
    const reloaded = makeService();
    expect(reloaded.modifiersFor('PLAYER').stability).toBe(empty.stability + 5);
  });
});

describe('NationStateService — riserve naturali', () => {
  it('semina il ledger dal giacimento e lo persiste', () => {
    const svc = makeService();
    const ledger = svc.resourceLedger('PLAYER');
    expect(Object.keys(ledger).length).toBeGreaterThan(0);

    const reloaded = makeService();
    expect(Object.keys(reloaded.resourceLedger('PLAYER')).length).toBe(Object.keys(ledger).length);
  });
});

describe('NationStateService — mercato e cache', () => {
  it('ensureMarket è idempotente e peekStockCached parte vuoto', () => {
    const svc = makeService();
    expect(svc.peekStockCached('PLAYER')).toBeNull();
    const first = svc.ensureMarket();
    const second = svc.ensureMarket();
    expect(second).toBe(first);
  });
});

describe('NationStateService — avanzamento materiale', () => {
  const accounts = { PLAYER: { provinces: 3, nominalGdpUsdBillions: 100 } };

  it('advanceResources produce il report del magazzino del giocatore', () => {
    const svc = makeService(accounts);
    const lines = svc.advanceResources(30, accounts, '1951-01-31');
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.some((l: string) => l.includes('🏭'))).toBe(true);
  });

  it('getResources espone stock, conto e debito', () => {
    const svc = makeService(accounts);
    const res = svc.getResources();
    expect(res.stock).toBeTruthy();
    expect(res.account).toBe(accounts.PLAYER);
    expect(typeof res.debt).toBe('number');
    expect(Array.isArray(res.debts)).toBe(true);
  });
});
