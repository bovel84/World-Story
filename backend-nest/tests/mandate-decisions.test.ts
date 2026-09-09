import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB = path.join(os.tmpdir(), `world-story-mandate-decisions-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;
const GAME = 'decision-game';
const BRANCH = 'decision-branch';
let db: typeof import('../src/database').default;
let ledger: typeof import('../src/repositories/ledger.repository');
let mandates: typeof import('../src/services/MandateService');
let decisions: typeof import('../src/services/MandateDecisionService');

function material(effectId: string, cause: 'estrazione' | 'produzione' | 'consumo', fromRef: string | null, toRef: string | null, delta: string, ownerRef: string) {
  return { effectId, entryIndex: 0, cause, kind: 'material' as const, unitId: 'tools', fromRef, toRef, ownerRef, delta, atDate: '1951-01-01' };
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  ledger = await import('../src/repositories/ledger.repository');
  mandates = await import('../src/services/MandateService');
  decisions = await import('../src/services/MandateDecisionService');
});
afterAll(() => { try { fs.rmSync(DB); } catch { /* tmp */ } });

const definition = (id: string, whitelist: string[]) => ({
  id, title: `Guardia ${id}`, currencyId: 'test', ceiling: '1000', startDate: '1951-01-01', endDate: '1951-12-31',
  whitelist, suppliers: ['vendor'], resourceId: 'tools', minStock: '30', noNewDebt: true,
});

describe('M07 µ4 — decisioni persistenti scorte minime', () => {
  it('aggrega solo owner della polity, non compra, non spamma e riapre dopo nuova carenza', () => {
    ledger.appendLedgerEntries(GAME, BRANCH, [material('owner-a', 'estrazione', null, 'alpha_factory', '10', 'alpha_factory')]);
    ledger.appendLedgerEntries(GAME, BRANCH, [material('owner-b', 'estrazione', null, 'alpha_farms', '5', 'alpha_farms')]);
    // Lo stock estero non entra nella soglia della polity del giocatore.
    ledger.appendLedgerEntries(GAME, BRANCH, [material('foreign-custody', 'estrazione', null, 'alpha_factory', '1000', 'beta_treasury')]);
    mandates.createMandateRecord(GAME, BRANCH, definition('authorized', ['purchase']));
    mandates.createMandateRecord(GAME, BRANCH, definition('outside', ['maintain']));

    const opened = decisions.refreshMandateStockDecisions(GAME, BRANCH, '1951-01-10', ['alpha_factory', 'alpha_farms']);
    expect(opened).toEqual([
      expect.objectContaining({ mandateId: 'authorized', kind: 'stock_shortfall_authorized', availableStock: '15', shortfall: '15', status: 'open' }),
      expect.objectContaining({ mandateId: 'outside', kind: 'stock_shortfall_outside_authorization', availableStock: '15', shortfall: '15', status: 'open' }),
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mandate_executions WHERE branch_id=?').get(BRANCH).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_cashflows WHERE branch_id=?').get(BRANCH).n).toBe(0);
    expect(decisions.refreshMandateStockDecisions(GAME, BRANCH, '1951-01-11', ['alpha_factory', 'alpha_farms'])).toEqual([]);

    expect(decisions.acknowledgeMandateDecision(GAME, BRANCH, 'authorized', 'stock_shortfall_authorized')).toMatchObject({ status: 'acknowledged' });
    ledger.appendLedgerEntries(GAME, BRANCH, [material('replenish', 'produzione', null, 'alpha_factory', '15', 'alpha_factory')]);
    expect(decisions.refreshMandateStockDecisions(GAME, BRANCH, '1951-01-12', ['alpha_factory', 'alpha_farms'])).toEqual([]);
    expect(decisions.listOpenMandateDecisions(GAME, BRANCH)).toEqual([]);

    ledger.appendLedgerEntries(GAME, BRANCH, [material('consume', 'consumo', 'alpha_factory', null, '25', 'alpha_factory')]);
    const reopened = decisions.refreshMandateStockDecisions(GAME, BRANCH, '1951-01-13', ['alpha_factory', 'alpha_farms']);
    expect(reopened.map(item => [item.mandateId, item.status, item.availableStock, item.shortfall])).toEqual([
      ['authorized', 'open', '5', '25'], ['outside', 'open', '5', '25'],
    ]);
    decisions.cancelMandateAndResolveDecisions(GAME, BRANCH, 'authorized');
    expect(decisions.listOpenMandateDecisions(GAME, BRANCH)).toEqual([
      expect.objectContaining({ mandateId: 'outside', status: 'open' }),
    ]);
    expect(() => decisions.acknowledgeMandateDecision(GAME, BRANCH, 'authorized', 'stock_shortfall_authorized')).toThrow(/già risolta/);
  });

  it('non richiede owner binding se non esiste alcuna guardia minStock; lo richiede appena configurata', () => {
    expect(decisions.refreshMandateStockDecisions('empty-game', 'empty-branch', '1951-01-01', [])).toEqual([]);
    mandates.createMandateRecord('binding-game', 'binding-branch', definition('requires-owner', ['purchase']));
    expect(() => decisions.refreshMandateStockDecisions('binding-game', 'binding-branch', '1951-01-01', [])).toThrow(/nessun attore catalogo/);
  });
});