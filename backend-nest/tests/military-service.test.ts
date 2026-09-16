/**
 * MilitaryService — test di isolamento dell'arsenale/produzione estratti da
 * GameSession. Usa un DB temporaneo (game_arsenals non ha FK) e un contesto
 * fittizio: verifica seed, cache, persistenza e produzione vuota.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-military-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let MilitaryService: any;

const GAME_ID = 'military-test-game';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    gameId: GAME_ID,
    currentTurn: () => 3,
    currentDate: () => '1951-03-01',
    playerPolityId: () => 'AAA',
    isStrictGame: () => false,
    // AAA: 10 forze + 2 mobilitate → fucili = 12*40 + 2*10 = 500, apc = 10*1.5 = 15
    accounts: () => ({ AAA: { forces: 10, mobilized: 2 } }),
    initialAccounts: () => ({ AAA: { forces: 10, mobilized: 2 } }),
    resourceStock: () => ({ money: 0, weapons: 0, technologies: [] }),
    saveResourceStock: () => {},
    ...overrides,
  };
}

describe('MilitaryService', () => {
  beforeAll(async () => {
    const dbModule = await import('../src/database');
    db = dbModule.default;
    dbModule.initDatabase();
    const mod = await import('../src/game/MilitaryService');
    MilitaryService = mod.MilitaryService;
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

  it('inizialmente l arsenale non è in cache', () => {
    const service = new MilitaryService(makeContext());
    expect(service.peekArsenal('AAA')).toBeUndefined();
  });

  it('semina l arsenale dall esercito di partenza e lo mette in cache', () => {
    const service = new MilitaryService(makeContext());
    const units = service.arsenalUnits('AAA');
    expect(units).toEqual({ fucili: 500, apc: 15 });
    expect(service.peekArsenal('AAA')).toEqual({ fucili: 500, apc: 15 });
  });

  it('saveArsenal persiste e una nuova istanza rilegge dal DB', () => {
    const service = new MilitaryService(makeContext());
    service.saveArsenal('AAA', { fucili: 7 });
    expect(service.arsenalUnits('AAA')).toEqual({ fucili: 7 });

    const reloaded = new MilitaryService(makeContext());
    expect(reloaded.arsenalUnits('AAA')).toEqual({ fucili: 7 });
  });

  it('getProduction è vuota senza ordini', () => {
    const service = new MilitaryService(makeContext());
    expect(service.getProduction()).toEqual({ orders: [], inProgress: 0 });
  });

  it('advanceProduction non fa nulla senza ordini o in strict', () => {
    expect(new MilitaryService(makeContext()).advanceProduction(30)).toEqual([]);
    expect(new MilitaryService(makeContext({ isStrictGame: () => true })).advanceProduction(30)).toEqual([]);
  });
});
