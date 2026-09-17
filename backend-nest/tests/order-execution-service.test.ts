/**
 * OrderExecutionService — test di isolamento dell'economia, del protocollo e
 * della coda ordini estratti da GameSession. Usa un DB temporaneo per la coda
 * (pending_actions ha FK su games); economia/protocollo sono puri.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { estimateOrderCost } from '../src/core/simulation/OrderCost';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';
import type { ResourceStock } from '../src/core/simulation/MaterialEconomy';
import type { PendingAction } from '../src/game/OrderExecutionService';

const TEST_DB = path.join(os.tmpdir(), `world-story-order-exec-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let OrderExecutionService: any;
const GAME_ID = 'order-exec-game';

function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'BWA', provinces: 10, population: 8_700_000, gdp: 400, militaryPower: 38,
    factories: 1, ports: 0, universities: 2, forces: 5, mobilized: 0,
    monthlyRevenue: 20, monthlyExpenses: 0.5, monthlyBalance: 19.5, annualGrowthRate: 0.02,
    stability: 52, defenceBurdenPct: 1.4, warEffort: 20, socialTension: 20,
    nominalGdpUsdBillions: 1000, gdpPerCapitaUsd: 9_500, government: 'Repubblica', ...overrides,
  };
}

function stock(overrides: Partial<ResourceStock> = {}): ResourceStock {
  return {
    money: 1000, debts: [], food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [],
    ...overrides,
  };
}

function debt(principal: number) {
  return {
    id: `d-${principal}`, label: 'Test', principal, annualRatePct: 3,
    issuedDate: '1951-01-01', maturityDate: '1961-01-01', termYears: 10,
  };
}

function makeService(opts: { account?: NationalAccount; stock?: ResourceStock; strict?: boolean; playable?: boolean } = {}) {
  const acct = opts.account ?? account();
  let current = opts.stock ?? stock();
  const saved: ResourceStock[] = [];
  const service = new OrderExecutionService({
    gameId: GAME_ID,
    assertPlayable: () => { if (opts.playable === false) throw new Error('game_over'); },
    worldId: 'w',
    isStrictGame: () => opts.strict === true,
    playerPolityId: () => 'BWA',
    playerPolity: () => 'BWA',
    accounts: () => ({ BWA: acct }),
    resourceStock: () => current,
    saveResourceStock: (_polityId: string, s: ResourceStock) => { current = s; saved.push(s); },
    buildGameData: () => ({}),
    enhanceOrder: async (_g: unknown, text: string) => ({ text }),
    convertActionsBatch: async () => [],
  });
  return { service, saved, getStock: () => current };
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('oe-world', 'OE', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'oe-world', 1, '1951-01-01')`).run(GAME_ID);
  const mod = await import('../src/game/OrderExecutionService');
  OrderExecutionService = mod.OrderExecutionService;
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

describe('OrderExecutionService — economia', () => {
  it('stima il costo dal conto nazionale', () => {
    const { service } = makeService();
    expect(service.estimateOrderCost('Costruire una ferrovia'))
      .toEqual(estimateOrderCost('Costruire una ferrovia', account()));
  });

  it('addebita un ordine accettato quando la cassa copre', () => {
    const { service, saved, getStock } = makeService({ stock: stock({ money: 1000 }) });
    const outcomes: any[] = [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }];
    const result = service.settleOrderCosts(outcomes, ['a1'], new Map([['a1', 'Costruire una ferrovia']]));
    expect(result.unfunded).toHaveLength(0);
    expect(result.lines).toHaveLength(1);
    expect(getStock().money).toBeLessThan(1000);
    expect(saved).toHaveLength(1);
  });

  it('annulla e dichiara non coperto un ordine senza cassa né credito', () => {
    // debito oltre il tetto → headroom 0; cassa 0 → nessuna copertura
    const { service } = makeService({ stock: stock({ money: 0, debts: [debt(100000)] }) });
    const outcomes: any[] = [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }];
    const result = service.settleOrderCosts(outcomes, ['a1'], new Map([['a1', 'Costruire una ferrovia']]));
    expect(result.unfunded).toHaveLength(1);
    expect(result.unfunded[0].actionId).toBe('a1');
    expect(outcomes[0].status).toBe('voided');
  });

  it('degrada a partial un ordine coperto solo in parte', () => {
    const { service } = makeService({ stock: stock({ money: 5, debts: [debt(100000)] }) });
    const outcomes: any[] = [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }];
    const result = service.settleOrderCosts(outcomes, ['a1'], new Map([['a1', 'Costruire una ferrovia']]));
    expect(outcomes[0].status).toBe('partial');
    expect(result.lines.some((l: string) => l.includes('solo in parte'))).toBe(true);
  });

  it('in strict non addebita nulla', () => {
    const { service } = makeService({ strict: true });
    const result = service.settleOrderCosts([{ actionId: 'a1', status: 'accepted' }], ['a1'], new Map([['a1', 'x']]));
    expect(result).toEqual({ lines: [], unfunded: [], entries: [] });
  });

  it('restituisce l\'effetto strutturato per decisione (charged / partial / unfunded)', () => {
    const rich = makeService({ stock: stock({ money: 1000 }) });
    const charged = rich.service.settleOrderCosts(
      [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }],
      ['a1'],
      new Map([['a1', 'Costruire una ferrovia']]),
    );
    expect(charged.entries).toHaveLength(1);
    expect(charged.entries[0]).toMatchObject({ actionId: 'a1', kind: 'charged' });
    expect(charged.entries[0].chargedMld).toBeGreaterThan(0);
    expect(charged.entries[0].chargedMld).toBe(charged.entries[0].requestedMld);
    expect(charged.entries[0].label.length).toBeGreaterThan(0);

    // Cassa insufficiente ma credito parziale → copertura parziale dichiarata.
    const partial = makeService({ stock: stock({ money: 5, debts: [debt(100000)] }) }).service
      .settleOrderCosts(
        [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }],
        ['a1'],
        new Map([['a1', 'Costruire una ferrovia']]),
      );
    expect(partial.entries[0]).toMatchObject({ actionId: 'a1', kind: 'partial' });
    expect(partial.entries[0].chargedMld).toBeLessThan(partial.entries[0].requestedMld);

    // Nessuna copertura → ordine annullato, addebito zero (nessun numero inventato).
    const unfunded = makeService({ stock: stock({ money: 0, debts: [debt(100000)] }) }).service
      .settleOrderCosts(
        [{ actionId: 'a1', action: 'Costruire una ferrovia', status: 'accepted' }],
        ['a1'],
        new Map([['a1', 'Costruire una ferrovia']]),
      );
    expect(unfunded.entries[0]).toMatchObject({ actionId: 'a1', kind: 'unfunded', chargedMld: 0 });
    expect(unfunded.entries[0].requestedMld).toBeGreaterThan(0);

    // Un ordine respinto non produce alcun effetto: non è attribuibile.
    const rejected = rich.service.settleOrderCosts(
      [{ actionId: 'a2', action: 'x', status: 'rejected' }],
      ['a2'],
      new Map([['a2', 'x']]),
    );
    expect(rejected.entries).toEqual([]);
  });

  it('orderFundingNotes elenca solo gli ordini non sostenibili', () => {
    const { service } = makeService({ stock: stock({ money: 0, debts: [debt(100000)] }) });
    const notes = service.orderFundingNotes([{ id: 'a1', text: 'Costruire una ferrovia' }]);
    expect(notes).toContain('actionId:a1');
    const rich = makeService({ stock: stock({ money: 100000 }) }).service;
    expect(rich.orderFundingNotes([{ id: 'a1', text: 'Costruire una ferrovia' }])).toBeNull();
  });
});

describe('OrderExecutionService — protocollo esiti', () => {
  let service: any;
  beforeAll(() => { service = makeService().service; });

  it('risolve per actionId canonico', () => {
    const outcomes: any[] = [{ actionId: 'a1', action: 'x', status: 'accepted' }];
    const map = service.outcomesByActionId([{ id: 'a1', text: 'x' }], outcomes, []);
    expect(map.get('a1')).toBe(outcomes[0]);
  });

  it('risolve il testo legacy solo quando è univoco', () => {
    const outcomes: any[] = [{ action: 'x', status: 'accepted' } as any];
    const map = service.outcomesByActionId([{ id: 'a1', text: 'x' }], outcomes, []);
    expect(map.get('a1')).toBe(outcomes[0]);
  });

  it('rifiuta actionId ignoti, duplicati e testi ambigui', () => {
    expect(() => service.outcomesByActionId([{ id: 'a1', text: 'x' }], [{ actionId: 'zz', action: 'x', status: 'accepted' } as any], []))
      .toThrow(/unknown or duplicated/);
    expect(() => service.outcomesByActionId([{ id: 'a1', text: 'x' }], [
      { actionId: 'a1', action: 'x', status: 'accepted' } as any,
      { actionId: 'a1', action: 'x', status: 'accepted' } as any,
    ], [])).toThrow(/unknown or duplicated/);
    expect(() => service.outcomesByActionId(
      [{ id: 'a1', text: 'x' }, { id: 'a2', text: 'x' }],
      [{ action: 'x', status: 'accepted' } as any], [],
    )).toThrow(/ambiguous/);
  });

  it('ignora esiti senza ordini nel lotto', () => {
    const map = service.outcomesByActionId([], [{ actionId: 'a1', action: 'x', status: 'accepted' } as any], []);
    expect(map.size).toBe(0);
  });
});

describe('OrderExecutionService — coda', () => {
  it('accoda, espone la coda e incrementa la versione', () => {
    const { service } = makeService();
    const action = service.enqueue('Costruire una ferrovia');
    expect(action.status).toBe('pending');
    expect(service.getPendingActions().map((a: PendingAction) => a.id)).toContain(action.id);
    expect(service.getQueueVersion()).toBeGreaterThan(0);
  });

  it('non accoda se la partita non è giocabile', () => {
    const { service } = makeService({ playable: false });
    expect(() => service.enqueue('x')).toThrow(/game_over/);
  });

  it('modifica e rimuove solo ordini pending', () => {
    const { service } = makeService();
    const a = service.enqueue('testo originale');
    const updated = service.updatePendingAction(a.id, '  testo aggiornato  ');
    expect(updated?.text).toBe('testo aggiornato');
    expect(service.updatePendingAction('missing', 'x')).toBeNull();
    expect(service.removePendingAction(a.id)).toBe(true);
    expect(service.removePendingAction(a.id)).toBe(false);
  });

  it('replaceQueue/snapshot/clearCompleted gestiscono la coda in memoria', () => {
    const { service } = makeService();
    service.replaceQueue([
      { id: 'p', text: 'p', createdAt: 'x', status: 'pending' },
      { id: 'c', text: 'c', createdAt: 'x', status: 'completed' },
    ]);
    const snap = service.snapshot();
    expect(snap).toHaveLength(2);
    snap[0].text = 'mutato';
    expect(service.queue()[0].text).toBe('p'); // snapshot è una copia
    service.clearCompletedActions();
    expect(service.queue().map((a: PendingAction) => a.id)).toEqual(['p']);
  });
});
