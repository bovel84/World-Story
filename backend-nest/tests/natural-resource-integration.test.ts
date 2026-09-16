/**
 * Integrazione risorse naturali dinamiche: estrazione, esaurimento e mercato.
 * La riserva si consuma, il magazzino cresce e gli scambi muovono denaro e
 * scorte in modo atomico e persistente.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-natural-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'natural_world';
let db: any;
let worldRepository: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: JSON.stringify({ events: [], narration: '', voided: [], startChat: [] }) }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Natural World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_DEU`, name: 'Germania', color: '#FF0000', owner: 'DEU',
        population: 80_000_000, gdp: 4000, militaryPower: 500, flag: 'DEU',
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'p1', type: 'port', name: 'Porto', level: 3 },
        ],
      },
      {
        id: `${WORLD_ID}_SAU`, name: 'Arabia Saudita', color: '#00FF00', owner: 'SAU',
        population: 35_000_000, gdp: 1000, militaryPower: 400, flag: 'SAU',
        objects: [{ id: 'a1', type: 'army', name: 'Guardia', level: 3 }],
      },
    ],
  );

  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_DEU`, '#FF0000');
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('risorse naturali dinamiche', () => {
  it('espone riserve e magazzino allineati al giacimento', () => {
    const { session } = createGame();
    const { natural } = session.getResources();
    expect(natural.length).toBeGreaterThan(0);
    for (const node of natural) {
      expect(node.reserve).toBe(node.maxReserve);
      expect(node.stockpile).toBe(0);
      expect(node.endowment).toBeGreaterThan(0);
      expect(node.depletionPct).toBe(0);
    }
    const coal = natural.find((node: any) => node.kind === 'coal');
    expect(coal?.maxReserve).toBe(coal?.endowment * 24);
  });

  it('estrae, consuma la riserva e alimenta il magazzino a ogni turno', async () => {
    const { session } = createGame();
    const before = session.getResources().natural;
    const target = before[0];
    await session.advanceDate(30);
    const after = session.getResources().natural;
    const updated = after.find((node: any) => node.kind === target.kind);
    expect(updated.reserve).toBeLessThan(before[0].reserve);
    expect(updated.stockpile).toBeGreaterThan(0);
    expect(updated.depletionPct).toBeGreaterThan(0);
  });

  it('espone un mercato con prezzi di acquisto superiori a quelli di vendita', () => {
    const { session } = createGame();
    const { market } = session.getResources();
    expect(market.length).toBeGreaterThan(0);
    for (const quote of market) {
      expect(quote.ask).toBeGreaterThan(quote.bid);
      expect(quote.mid).toBeGreaterThan(0);
    }
  });

  it('vende le scorte al mercato incassando denaro', async () => {
    const { session } = createGame();
    const kind = session.getResources().natural[0].kind;
    await session.advanceDate(30);
    const stockpile = session.getResources().natural.find((n: any) => n.kind === kind).stockpile;
    expect(stockpile).toBeGreaterThanOrEqual(1);
    const before = session.getResources().stock.money;
    const result = session.tradeResource('sell', kind, 1);
    expect(result.ok).toBe(true);
    expect(result.unitPrice).toBeGreaterThan(0);
    const after = session.getResources();
    expect(after.stock.money).toBeGreaterThan(before);
    expect(after.natural.find((n: any) => n.kind === kind).stockpile).toBeLessThan(stockpile);
  });

  it('compra risorse pagando il prezzo di mercato', () => {
    const { session } = createGame();
    const kind = session.getResources().natural[0].kind;
    (session as any).nationState.resourceStocks.set('DEU', { ...session.getResources().stock, money: 1000 });
    const result = session.tradeResource('buy', kind, 2);
    expect(result.ok).toBe(true);
    expect(session.getResources().stock.money).toBeLessThan(1000);
    expect(session.getResources().natural.find((n: any) => n.kind === kind).stockpile).toBe(2);
  });

  it('rifiuta scambi impossibili con errori chiari', () => {
    const { session } = createGame();
    const kind = session.getResources().natural[0].kind;
    expect(() => session.tradeResource('sell', kind, 999_999)).toThrow(/insufficient_stockpile/);
    expect(() => session.tradeResource('buy', kind, 999_999)).toThrow(/insufficient_money/);
    expect(() => session.tradeResource('buy', 'kryptonite', 1)).toThrow(/unknown_resource/);
    expect(() => session.tradeResource('buy', kind, 0)).toThrow(/quantity_invalid/);
  });

  it('persiste riserve e scambi nel database', async () => {
    const { session, gameId } = createGame();
    const kind = session.getResources().natural[0].kind;
    await session.advanceDate(30);
    session.tradeResource('sell', kind, 1);
    const { naturalResourceRepository } = await import('../src/repositories');
    const stored = naturalResourceRepository.get(gameId, 'DEU');
    expect(stored?.ledger[kind]?.extractedTotal).toBeGreaterThan(0);
  });

  it('parte sempre con una tesoreria positiva e la registra nello storico', async () => {
    const { session } = createGame();
    const start = session.getResources().stock.money;
    expect(start).toBeGreaterThan(0);
    await session.advanceDate(30);
    const history = session.getNationalHistory();
    expect(history.length).toBeGreaterThan(0);
    // Il punto storico porta il denaro: è la serie su cui il Dossier disegna
    // la crescita o il calo della valuta.
    const point = history[history.length - 1] as { account: Record<string, unknown> };
    expect(Number(point.account.money)).toBeGreaterThan(0);
    expect(Number.isFinite(Number(point.account.debt))).toBe(true);
  });

  it('ripara un magazzino rimasto interamente a zero', async () => {
    const { session, gameId } = createGame();
    const { resourceRepository } = await import('../src/repositories');
    resourceRepository.upsert(gameId, 'DEU', {
      money: 0, debts: [], food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [],
    }, 0, null);
    (session as any).nationState.resourceStocks.clear();
    const stock = session.getResources().stock;
    expect(stock.money).toBeGreaterThan(0);
    expect(stock.food).toBeGreaterThan(0);
  });

  it('trimma un magazzino legacy oltre la capacità reale', async () => {
    const { session, gameId } = createGame();
    const { resourceRepository } = await import('../src/repositories');
    resourceRepository.upsert(gameId, 'DEU', {
      money: 0, debts: [], food: 9999, clothing: 9999, weapons: 9999, fuel: 9999, research: 0, technologies: [],
    }, 0, null);
    (session as any).nationState.resourceStocks.clear();
    const resources = session.getResources();
    expect(resources.stock.food).toBeLessThanOrEqual(Number(resources.capacity.food) + 1e-9);
    expect(resources.stock.food).toBeLessThan(9999);
  });

  it('la nazione può fare debito: cassa subito, interessi e tensione dopo', () => {
    const { session } = createGame();
    const polity = session.getResources().account.polityId;
    const before = session.getResources();
    const beforeTension = session.getNationalAccounts()[polity].socialTension;
    const borrowed = session.borrowSovereignDebt(5, 10);
    expect(borrowed.ok).toBe(true);
    expect(borrowed.tranche.principal).toBe(5);
    const after = session.getResources();
    expect(after.stock.money).toBeGreaterThan(before.stock.money);
    expect(after.debt).toBeCloseTo(before.debt + 5, 1);
    expect(after.debts.length).toBe(before.debts.length + 1);
    expect(after.annualInterest).toBeGreaterThan(0);
    expect(after.debtRatioPct).toBeGreaterThan(before.debtRatioPct);
    // Il debito ha un riflesso sociale: la tensione non cala.
    expect(session.getNationalAccounts()[polity].socialTension).toBeGreaterThanOrEqual(beforeTension);
    // Oltre il tetto di credito il motore rifiuta l'operazione.
    expect(() => session.borrowSovereignDebt(after.creditLimit + 100, 5)).toThrow(/credit_exhausted/);
    expect(() => session.borrowSovereignDebt(0, 5)).toThrow(/amount_invalid/);
  });
});
