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
    worldStartDate: () => '1951-01-01',
    playerPolityId: () => 'AAA',
    isStrictGame: () => false,
    // AAA: 10 forze + 2 mobilitate, guerra fredda (11.000 uomini per reparto,
    // 80% con arma individuale): fucili = 12 × 11.000 × 0,8 = 105.600.
    // Mobilità: 10 × 2 (profilo guerra fredda), non più la costante 1,5.
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
    expect(units).toEqual({ fucili: 105_600, apc: 20 });
    expect(service.peekArsenal('AAA')).toEqual({ fucili: 105_600, apc: 20 });
  });

  it('l epoca dello scenario decide la dotazione di partenza', () => {
    const army = { forces: 10, mobilized: 2 };
    const modern = new MilitaryService(makeContext({
      worldStartDate: () => '1990-01-01',
      accounts: () => ({ DDD: army }), initialAccounts: () => ({ DDD: army }),
    }));
    expect(modern.epoch()).toBe('moderno');
    // 12.000 uomini per reparto × 12 reparti × 75% = 108.000 armi individuali.
    expect(modern.arsenalUnits('DDD')).toEqual({ fucili: 108_000, apc: 15 });
    // 1815: nessun mezzo corazzato nel mondo, quindi nemmeno nel seed.
    const napoleonic = new MilitaryService(makeContext({
      worldStartDate: () => '1815-06-18',
      accounts: () => ({ CCC: army }), initialAccounts: () => ({ CCC: army }),
    }));
    expect(napoleonic.epoch()).toBe('pre_industriale');
    // 800 uomini per reparto × 12 × 90% = 8.640.
    expect(napoleonic.arsenalUnits('CCC')).toEqual({ fucili: 8_640 });
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

  describe('produzione bloccata e quantità (P12, P13)', () => {
  /** Ordine aperto scritto direttamente nel repository: qui conta la capacità. */
  const openOrder = (gameId: string, equipmentId: string, quantity: number) => ({
    id: `ord-${gameId}`, equipmentId, name: equipmentId, domain: 'terra', quantity,
    progress: 25, spentMln: 100, startedTurn: 1, startedDate: '1951-01-01',
    status: 'in_progress' as const, note: '', qualityLoss: 0, updatedDate: '1951-01-01',
  });

  const industry = (gameId: string, factories: number) => makeContext({
    gameId,
    accounts: () => ({ AAA: { forces: 1, mobilized: 0, factories, ports: 0, universities: 0 } }),
    initialAccounts: () => ({ AAA: { forces: 1, mobilized: 0 } }),
  });

  it('P12: senza impianti la produzione è bloccata, il progresso non avanza e l’ETA non è falsa', async () => {
    const { productionRepository } = await import('../src/repositories');
    const gameId = 'military-blocked-game';
    productionRepository.upsert(gameId, openOrder(gameId, 'fucili', 500));
    const service = new MilitaryService(industry(gameId, 0));
    expect(service.industrialCapacity('AAA').blocked).toBe(true);
    expect(service.industrialCapacity('AAA').overflowFactor).toBe(0);
    const bulletins: string[] = service.advanceProduction(30);
    expect(bulletins.some((line: string) => line.includes('Produzione bloccata'))).toBe(true);
    // Non «il 25% del ritmo»: zero linee, zero avanzamento.
    expect(bulletins.some((line: string) => line.includes('25%'))).toBe(false);
    // Il quadro che vede la UI: ETA nulla (non una data inventata) e ordine aperto.
    const published = service.getArsenal().production;
    expect(published.orders[0].progress).toBe(25);
    expect(published.orders[0].expectedDate).toBeNull();
    expect(published.inProgress).toBe(1);
    // E nessun ordine è stato perso o chiuso.
    const stored = productionRepository.list(gameId).find(order => order.id === `ord-${gameId}`);
    expect(stored?.progress).toBe(25);
    expect(stored?.status).toBe('in_progress');
  });

  it('P13: un ordine grande satura l’industria e slitta, uno piccolo no', async () => {
    const { productionRepository } = await import('../src/repositories');
    productionRepository.upsert('qty-small', openOrder('qty-small', 'apc', 1));
    productionRepository.upsert('qty-big', openOrder('qty-big', 'apc', 5_000));
    const small = new MilitaryService(industry('qty-small', 1));
    const big = new MilitaryService(industry('qty-big', 1));
    // Il carro singolo non satura 10 linee; cinquemila carri sì.
    expect(small.industrialCapacity('AAA').saturated).toBe(false);
    expect(small.industrialCapacity('AAA').overflowFactor).toBe(1);
    expect(big.industrialCapacity('AAA').saturated).toBe(true);
    expect(big.industrialCapacity('AAA').overflowFactor).toBeLessThan(1);
    expect(big.industrialCapacity('AAA').demand)
      .toBeGreaterThan(small.industrialCapacity('AAA').demand);
    // Stessa data d'inizio, stessa voce: la consegna grande è più lontana.
    const smallEta = small.getArsenal().production.orders[0].expectedDate;
    const bigEta = big.getArsenal().production.orders[0].expectedDate;
    expect(smallEta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bigEta > smallEta!).toBe(true);
  });
});
});
