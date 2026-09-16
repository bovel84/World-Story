/**
 * M07 µ4g — revisione indipendente (settimo riesame): test di regressione
 * ======================================================================
 * Il report µ4g dichiara le remediation S-12 (plafond/execution e date
 * canoniche), S-13 (decoder semantico M02/runtime) e S-14 (source/target
 * fence) ma non esisteva un test dedicato per ciascuna. Questa suite prova i
 * claim sul codice reale: un fallimento qui è un difetto, non un'opinione.
 *
 * Isolamento: DB temporaneo in `os.tmpdir()`, impostato PRIMA degli import
 * dinamici di `../src/database`. Nessun DB reale, nessuna rete, nessun LLM.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB = path.join(os.tmpdir(), `world-story-m07-review-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

type Snap = typeof import('../src/repositories/economy-snapshot.repository');
type Mandates = typeof import('../src/services/MandateService');

let db: typeof import('../src/database').default;
let snap: Snap;
let mandates: Mandates;

const GAME = 'review-game';
const SRC = 'review-src';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('review-world', 'Review');
  db.prepare('INSERT INTO games(id,world_id) VALUES(?,?)').run(GAME, 'review-world');
  for (const branch of [SRC, 'review-dst', 'review-other-target']) {
    db.prepare('INSERT INTO game_branches(id,game_id,name,created_at) VALUES(?,?,?,?)')
      .run(branch, GAME, branch, '1951-01-01T00:00:00.000Z');
  }
  db.prepare('INSERT INTO games(id,world_id) VALUES(?,?)').run('other-game', 'review-world');
  db.prepare('INSERT INTO game_branches(id,game_id,name,created_at) VALUES(?,?,?,?)')
    .run('other-branch', 'other-game', 'o', '1951-01-01T00:00:00.000Z');

  snap = await import('../src/repositories/economy-snapshot.repository');
  mandates = await import('../src/services/MandateService');

  mandates.createMandateRecord(GAME, SRC, {
    id: 'm1', title: 'Scorte strategiche', currencyId: 'test', ceiling: '100',
    startDate: '1951-01-01', endDate: '1951-12-31',
    whitelist: ['purchase'], suppliers: ['vendor'], resourceId: 'steel', minStock: '50',
    noNewDebt: true,
  });
  mandates.executeMandateRecord(GAME, SRC, 'm1', {
    executionId: 'e1', mandateId: 'm1', actionType: 'purchase', supplier: 'vendor',
    amount: '20', atDate: '1951-02-01',
  });
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
  }
});

/** Snapshot valido catturato una volta; ogni test lavora su una copia. */
const base = (): ReturnType<Snap['captureEconomicSnapshot']> =>
  clone(snap.captureEconomicSnapshot(GAME, SRC));

describe('M07 µ4g — S-12: plafond, execution e date canoniche', () => {
  it('lo snapshot reale è valido', () => {
    expect(snap.validateEconomicSnapshot(base())).toBe(true);
  });

  it('spent divergente dalla somma delle execution è rifiutato', () => {
    const state = base() as { tables: Record<string, Array<Record<string, unknown>>> };
    state.tables.mandates[0].spent = '99';
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/spent divergente/);
  });

  it('spent negativo è rifiutato', () => {
    const state = base() as { tables: Record<string, Array<Record<string, unknown>>> };
    state.tables.mandates[0].spent = '-1';
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/spent negativo/);
  });

  it('execution oltre il plafond è rifiutata', () => {
    const state = base() as { tables: Record<string, Array<Record<string, unknown>>> };
    state.tables.mandateExecutions[0].amount = '200';
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/supera plafond/);
  });

  it('execution fuori periodo è rifiutata', () => {
    const state = base() as { tables: Record<string, Array<Record<string, unknown>>> };
    state.tables.mandateExecutions[0].at_date = '1952-01-01';
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/fuori periodo/);
  });

  it('data di calendario inesistente è rifiutata (round-trip UTC)', () => {
    const state = base() as { tables: Record<string, Array<Record<string, unknown>>> };
    state.tables.mandateExecutions[0].at_date = '1951-02-30';
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/at_date/);
  });

  it('MandateEngine rifiuta direttamente una data inesistente', () => {
    expect(() => mandates.createMandateRecord(GAME, SRC, {
      id: 'bad-date', title: 'Bad', currencyId: 'test', ceiling: '1',
      startDate: '1951-02-30', endDate: '1951-12-31',
      whitelist: ['purchase'], suppliers: ['vendor'], noNewDebt: false,
    })).toThrow();
  });
});

describe('M07 µ4g — S-13: decoder semantico M02/runtime', () => {
  it('riserva con residuo > iniziale è rifiutata', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.reservations = [
      { initial_amount: '10', remaining_amount: '20', status: 'active', kind: 'money', unit_id: 'test' },
    ];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/reservation non valida/);
  });

  it('cashflow con outstanding > amount è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.cashflows = [{
      currency_id: 'test', amount: '10', outstanding_amount: '20', due_date: '1951-01-01',
      legal_priority: 0, partial_allowed: 0, shortage_policy: 'arrears', status: 'scheduled',
    }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/cashflow amount non valido/);
  });

  it('debito con denominatore nullo è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.debts = [{
      limit_amount: '1', rate_numerator: '1', rate_denominator: '0', drawn_amount: '0',
      principal_outstanding: '0', accrued_interest: '0', carry_numerator: '0',
      maturity_date: '1951-01-01',
    }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/denominator non positivo/);
  });

  it('escrow con importo negativo è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.escrows = [{ amount: '-1', status: 'draft' }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/escrow non valida/);
  });

  it('lavoro di progetto non positivo è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.projectWork = [{ work_done: '0', due_date: '1951-01-01', status: 'scheduled' }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow();
  });

  it('runtime progetto con JSON corrotto è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.projectRuntime = [{ plan_json: 'not json', state_json: '{}', version: 0 }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/plan_json/);
  });

  it('runtime spedizione con flag non booleano è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.shipmentRuntime = [{ shipment_json: '{}', transport_authorized: 2, version: 0 }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/shipment runtime non valido/);
  });

  it('scadenzario strict con entry_json corrotto è rifiutato', () => {
    const state = base() as { tables: Record<string, unknown> };
    state.tables.strictLedgerSchedule = [{ entry_json: 'not json' }];
    expect(() => snap.validateEconomicSnapshot(state)).toThrow(/entry_json/);
  });
});

describe('M07 µ4g — S-14: source/target fence', () => {
  it('capture con game diverso dal proprietario del ramo è rifiutato', () => {
    expect(() => snap.captureEconomicSnapshot('other-game', SRC)).toThrow(/snapshot_branch_fence/);
  });

  it('capture di un ramo inesistente è rifiutato', () => {
    expect(() => snap.captureEconomicSnapshot(GAME, 'no-such-branch')).toThrow(/snapshot_branch_missing/);
  });

  it('restore su ramo di un altro game è rifiutato prima di qualunque delete', () => {
    expect(() => snap.restoreEconomicSnapshot(GAME, 'other-branch', base())).toThrow(/snapshot_branch_fence/);
  });
});
