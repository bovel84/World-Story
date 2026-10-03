import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { governmentSnapshot } from '../src/core/simulation/GovernmentFactions';

const DB = path.join(os.tmpdir(), `world-story-government-format-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

describe('GovernmentReadings display-only formatting', () => {
  let db: typeof import('../src/database').default;
  let readCabinetSession: typeof import('../src/game/GovernmentReadings').readCabinetSession;

  beforeAll(async () => {
    const database = await import('../src/database');
    db = database.default;
    database.initDatabase();
    expect(db.name).toBe(DB);
    ({ readCabinetSession } = await import('../src/game/GovernmentReadings'));
  });

  afterAll(() => {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
  });

  it('never emits raw treasury decimals or mutates the numeric source account/snapshot', () => {
    const account = Object.freeze({ monthlyBalance: -7.60987654321, nominalGdpUsdBillions: 100,
      defenceBurdenPct: 1.23456789, forces: 200.123456789, mobilized: 0 });
    const government = Object.freeze({
      ...governmentSnapshot(),
      factions: [],
      budget: Object.freeze({ ...governmentSnapshot().budget, balance: 7.60987654321, effectiveTaxRatePct: 24.123456789 }),
      debt: Object.freeze({ ratioPct: 110.123456789, servicePct: 14.123456789 }),
    });
    const before = structuredClone({ account, government });
    const session = readCabinetSession({ gameId: 'format-test-no-catalog', branchId: null,
      playerPolityId: 'TEST', account, government });
    const treasury = session.addresses.find(address => address.seat === 'tesoro')!;

    expect(treasury.items[0].because).toContain('-7,61 mld');
    expect(treasury.items[0].need).toContain('disavanzo');
    expect(treasury.opening).toContain('-7,61 mld');
    expect([treasury.items[0].need, treasury.items[0].because, treasury.opening].join('\n')).not.toMatch(/\d+[.,]\d{3,}/);
    expect(JSON.stringify(treasury)).not.toContain('7.60987654321');
    expect({ account, government }).toEqual(before);
    expect(account.monthlyBalance).toBe(-7.60987654321);
    expect(government.budget.balance).toBe(7.60987654321);
    expect(government.debt.ratioPct).toBe(110.123456789);
    expect(session.canonicalMutation).toBe(false);
  });
});
