/**
 * M07 µ1 — mandati di delega (MAT31, maestro §7.5).
 * ===================================================
 * MAT31: mandato budget 100, spese 60+60, retry → la seconda non è
 * autorizzata (ceiling_exceeded) e il limite non viene mai superato; il
 * retry della prima esecuzione è no-op verificato (plafond consumato una
 * sola volta). In più: whitelist, fornitori, prezzo limite, periodo e
 * scadenza sono vincoli del motore, non suggerimenti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-mandates-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

type MandateEngine = typeof import('../src/core/mandates/MandateEngine');
type MandateService = typeof import('../src/services/MandateService');

let engine: MandateEngine;
let service: MandateService;

const GAME = 'mandate-game';
const BRANCH = 'mandate-branch';

const DEF = {
  id: 'mandate_steel',
  title: 'Mantieni scorte di acciaio',
  currencyId: 'test',
  ceiling: '100',
  startDate: '1951-01-01',
  endDate: '1951-12-31',
  whitelist: ['acquista'],
  suppliers: ['fornitore_a', 'fornitore_b'],
  priceLimit: '10',
  resourceId: 'steel',
  minStock: '30',
  noNewDebt: true,
};

function exec(
  executionId: string,
  amount: string,
  overrides: Partial<Parameters<typeof engine.executeMandate>[2]> = {},
): Parameters<typeof engine.executeMandate>[2] {
  return {
    executionId,
    mandateId: DEF.id,
    actionType: 'acquista',
    supplier: 'fornitore_a',
    amount,
    price: '10',
    quantity: '6',
    atDate: '1951-02-01',
    ...overrides,
  };
}

beforeAll(async () => {
  const database = await import('../src/database');
  database.initDatabase();
  engine = await import('../src/core/mandates/MandateEngine');
  service = await import('../src/services/MandateService');
});

afterAll(() => {
  try { fs.rmSync(TEST_DB); } catch { /* DB temporaneo */ }
});

describe('M07 µ1 — motore puro: tetto, whitelist, fornitori, prezzo, periodo', () => {
  it('MAT31: budget 100, spese 60+60 → la seconda non è autorizzata, limite mai superato', () => {
    const state0 = engine.createMandate(DEF);
    const first = engine.executeMandate(DEF, state0, exec('e1', '60'));
    expect(first.applied).toBe(true);
    expect(first.state.spent).toBe('60');
    expect(engine.remainingPlafond(DEF, first.state)).toBe('40');

    // Seconda spesa di 60: supera il plafond residuo 40 → rifiutata.
    expect(() => engine.executeMandate(DEF, first.state, exec('e2', '60'))).toThrow(/supera il plafond residuo/);

    // Retry della prima: no-op verificato, plafond consumato una sola volta.
    const retry = engine.executeMandate(DEF, first.state, exec('e1', '60'));
    expect(retry.applied).toBe(false);
    expect(retry.state.spent).toBe('60');
    expect(retry.state.executions).toHaveLength(1);
  });

  it('una spesa entro il residuo è ammessa e consuma il plafond', () => {
    const state0 = engine.createMandate(DEF);
    const first = engine.executeMandate(DEF, state0, exec('e1', '60'));
    const second = engine.executeMandate(DEF, first.state, exec('e2', '40'));
    expect(second.applied).toBe(true);
    expect(second.state.spent).toBe('100');
    expect(engine.remainingPlafond(DEF, second.state)).toBe('0');
  });

  it('azione fuori whitelist → rifiutata', () => {
    const state0 = engine.createMandate(DEF);
    expect(() => engine.executeMandate(DEF, state0, exec('e1', '10', { actionType: 'costruisci' })))
      .toThrow(/fuori dalla whitelist/);
  });

  it('fornitore non ammesso → rifiutato', () => {
    const state0 = engine.createMandate(DEF);
    expect(() => engine.executeMandate(DEF, state0, exec('e1', '10', { supplier: 'fornitore_x' })))
      .toThrow(/non ammesso dal mandato/);
  });

  it('prezzo oltre il limite → rifiutato', () => {
    const state0 = engine.createMandate(DEF);
    expect(() => engine.executeMandate(DEF, state0, exec('e1', '10', { price: '11' })))
      .toThrow(/supera il limite/);
  });

  it('esecuzione fuori periodo o dopo scadenza → rifiutata', () => {
    const state0 = engine.createMandate(DEF);
    expect(() => engine.executeMandate(DEF, state0, exec('e1', '10', { atDate: '1950-12-31' })))
      .toThrow(/non ancora valido/);
    expect(() => engine.executeMandate(DEF, state0, exec('e1', '10', { atDate: '1952-01-01' })))
      .toThrow(/scaduto/);
    expect(engine.isExpired(DEF, '1952-01-01')).toBe(true);
    expect(engine.isExpired(DEF, '1951-06-01')).toBe(false);
  });

  it('retry con contenuto diverso → conflitto, non una seconda spesa', () => {
    const state0 = engine.createMandate(DEF);
    const first = engine.executeMandate(DEF, state0, exec('e1', '60'));
    expect(() => engine.executeMandate(DEF, first.state, exec('e1', '61'))).toThrow(/contenuto diverso/);
    expect(first.state.spent).toBe('60');
  });

  it('definizione non valida → errore di schema', () => {
    expect(() => engine.createMandate({ ...DEF, ceiling: '0' })).toThrow(/ceiling/);
    expect(() => engine.createMandate({ ...DEF, whitelist: [] })).toThrow(/whitelist/);
    expect(() => engine.createMandate({ ...DEF, endDate: '1950-01-01' })).toThrow(/precede/);
  });
});

describe('M07 µ1 — servizio con persistenza: idempotenza e plafond', () => {
  it('MAT31: crea mandato, spende 60, la seconda 60 è rifiutata, retry no-op', () => {
    const created = service.createMandateRecord(GAME, BRANCH, DEF);
    expect(created.created).toBe(true);
    expect(created.mandate.spent).toBe('0');

    const first = service.executeMandateRecord(GAME, BRANCH, DEF.id, exec('s1', '60'));
    expect(first.applied).toBe(true);
    expect(first.mandate.spent).toBe('60');
    expect(service.getMandateRemaining(BRANCH, DEF.id)).toBe('40');

    // Seconda spesa di 60: non autorizzata, limite non superato.
    expect(() => service.executeMandateRecord(GAME, BRANCH, DEF.id, exec('s2', '60')))
      .toThrow(/supera il plafond residuo/);
    expect(service.getMandate(BRANCH, DEF.id)?.spent).toBe('60');

    // Retry della prima: no-op verificato, plafond consumato una sola volta.
    const retry = service.executeMandateRecord(GAME, BRANCH, DEF.id, exec('s1', '60'));
    expect(retry.applied).toBe(false);
    expect(retry.mandate.spent).toBe('60');
    expect(service.getMandate(BRANCH, DEF.id)?.executions).toHaveLength(1);
    expect(service.totalMandateSpent(BRANCH)).toBe('60');
  });

  it('creazione idempotente: stesso contenuto → no-op, diverso → conflitto', () => {
    const again = service.createMandateRecord(GAME, BRANCH, DEF);
    expect(again.created).toBe(false);
    expect(() => service.createMandateRecord(GAME, BRANCH, { ...DEF, ceiling: '200' }))
      .toThrow(service.MandateConflictError);
  });

  it('esecuzione con contenuto diverso sullo stesso executionId → conflitto', () => {
    expect(() => service.executeMandateRecord(GAME, BRANCH, DEF.id, exec('s1', '61')))
      .toThrow(service.MandateConflictError);
  });

  it('annullamento: nessuna nuova esecuzione, le già applicate restano', () => {
    const cancelled = service.cancelMandateRecord(BRANCH, DEF.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.spent).toBe('60');
    expect(() => service.executeMandateRecord(GAME, BRANCH, DEF.id, exec('s3', '10')))
      .toThrow(/non attivo/);
    expect(() => service.cancelMandateRecord(BRANCH, DEF.id)).toThrow(/già annullato/);
  });

  it('mandato inesistente → not_found', () => {
    expect(service.getMandate(BRANCH, 'missing')).toBeNull();
    expect(() => service.executeMandateRecord(GAME, BRANCH, 'missing', exec('x', '10')))
      .toThrow(/non trovato/);
  });
});
