/**
 * Test del magazzino materiale (percorso legacy). Verifica:
 *  - seed proporzionato all'economia;
 *  - produzione/consumo e carenze per cibo, vestiario, armamenti, carburante;
 *  - sblocco tecnologie con prerequisiti;
 *  - costo di movimento a piedi vs motorizzato e pagamento con carenza.
 */
import { describe, it, expect } from 'vitest';
import {
  DEBT_MONTHLY_INTEREST, TECHNOLOGIES, advanceStock, applyFlow, creditHeadroom, creditLimit, debtOf,
  describeStock, financePurchase, movementCost, normalizeStock, payMovement, seedStock,
  technologyById, unlockTechnologies, type ResourceStock,
} from '../src/core/simulation/MaterialEconomy';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'DEU', provinces: 3, population: 10_000_000, gdp: 500, militaryPower: 300,
    factories: 4, ports: 2, universities: 3, forces: 6, mobilized: 2,
    monthlyRevenue: 1, monthlyExpenses: 0.8, monthlyBalance: 0.2, annualGrowthRate: 0.02,
    stability: 60, defenceBurdenPct: 2.4, warEffort: 30, socialTension: 20,
    nominalGdpUsdBillions: 40, gdpPerCapitaUsd: 4000, government: 'Repubblica',
    ...overrides,
  };
}

function stock(overrides: Partial<ResourceStock> = {}): ResourceStock {
  return { money: 10, food: 100, clothing: 100, weapons: 100, fuel: 100, research: 0, technologies: [], ...overrides };
}

describe('MaterialEconomy', () => {
  it('normalizza scorte sporche e scarta tecnologie inesistenti', () => {
    const clean = normalizeStock({ money: '3', food: -5, fuel: 'x', technologies: ['motorizzazione', 'inesistente', 'motorizzazione'] });
    expect(clean).toMatchObject({ money: 3, food: 0, fuel: 0, technologies: ['motorizzazione'] });
  });

  it('semina scorte operative proporzionate all’economia', () => {
    const seeded = seedStock(account());
    expect(seeded.money).toBeGreaterThanOrEqual(5);
    expect(seeded.food).toBeGreaterThan(0);
    expect(seeded.fuel).toBeGreaterThan(0);
    expect(seeded.weapons).toBeGreaterThan(0);
    expect(seeded.technologies).toEqual([]);
  });

  it('produce cibo e consuma per popolazione e truppe, accumulando il saldo', () => {
    const before = stock({ food: 500 });
    const rich = advanceStock(before, account({ population: 20_000_000, forces: 4, mobilized: 0, factories: 20 }), 30);
    expect(rich.stock.food).toBeGreaterThan(before.food);
    const poor = advanceStock(before, account({ population: 40_000_000, forces: 20, mobilized: 10, factories: 0 }), 30);
    expect(poor.stock.food).toBeLessThan(before.food);
    // Con riserve quasi esaurite la carenza viene segnalata.
    const drained = advanceStock(stock({ food: 1 }), account({ population: 40_000_000, forces: 20, mobilized: 10, factories: 0 }), 30);
    expect(drained.flow.shortages.join(' ')).toMatch(/Cibo|Armamenti|Carburante/);
  });

  it('il denaro segue il saldo mensile (revenue − spese) del periodo', () => {
    const tick = advanceStock(stock({ money: 10 }), account({ monthlyBalance: 1.2 }), 30);
    expect(tick.stock.money).toBeCloseTo(11.2, 5);
    const deficit = advanceStock(stock({ money: 10 }), account({ monthlyBalance: -2 }), 30);
    expect(deficit.stock.money).toBeCloseTo(8, 5);
  });

  it('sblocca le tecnologie in ordine, rispettando i prerequisiti', () => {
    const textile = technologyById('industria_tessile')!;
    const unlocked = unlockTechnologies(stock({ research: textile.cost }));
    expect(unlocked.unlocked.map(tech => tech.id)).toContain('industria_tessile');
    expect(unlocked.stock.research).toBe(0);
    // Senza tessile non si può sbloccare l'industria bellica anche con i punti.
    const blocked = unlockTechnologies(stock({ research: 10_000, technologies: [] }));
    const ids = blocked.unlocked.map(tech => tech.id);
    expect(ids.indexOf('industria_tessile')).toBeLessThan(ids.indexOf('industria_bellica'));
    // Idempotente: chi ha già tutto non risblocca.
    const all = TECHNOLOGIES.map(tech => tech.id);
    const none = unlockTechnologies(stock({ research: 10_000, technologies: all }));
    expect(none.unlocked).toEqual([]);
  });

  it('la carenza è segnalata solo quando il fabbisogno non è coperto', () => {
    const short = advanceStock(stock({ food: 0 }), account({ population: 60_000_000, forces: 30, factories: 0 }), 30);
    expect(short.flow.shortages.join(' ')).toMatch(/Cibo/);
    const ok = advanceStock(stock({ food: 10_000 }), account({ population: 1_000_000, forces: 1, factories: 5 }), 30);
    expect(ok.flow.shortages).toEqual([]);
  });

  it('a piedi non serve carburante; con Motorizzazione sì e costa meno con Logistica', () => {
    const foot = movementCost(stock());
    expect(foot.motorized).toBe(false);
    expect(foot.fuel).toBe(0);
    expect(foot.food).toBeGreaterThan(0);
    const motor = movementCost(stock({ technologies: ['industria_tessile', 'industria_bellica', 'motorizzazione'] }));
    expect(motor.motorized).toBe(true);
    expect(motor.fuel).toBeGreaterThan(0);
    const advanced = movementCost(stock({ technologies: ['motorizzazione', 'logistica_avanzata'] }));
    expect(advanced.food).toBeLessThan(motor.food);
    expect(advanced.fuel).toBeLessThan(motor.fuel);
  });

  it('paga il movimento consumando le scorte e segnala la carenza senza andare in negativo', () => {
    const cost = movementCost(stock({ technologies: ['motorizzazione'] }));
    const poor = stock({ food: 0, fuel: 0, money: 0 });
    const paid = payMovement(poor, cost);
    expect(paid.covered).toBe(false);
    expect(paid.stock.food).toBe(0);
    expect(paid.stock.fuel).toBe(0);
    expect(paid.shortages.length).toBeGreaterThanOrEqual(2);
    const rich = payMovement(stock({ food: 50, fuel: 50, money: 50 }), cost);
    expect(rich.covered).toBe(true);
    expect(rich.stock.fuel).toBeLessThan(50);
  });

  it('applyFlow non lascia mai materiali negativi ma consente il debito in denaro', () => {
    const result = applyFlow(stock({ money: 1, food: 1 }), { money: -5, food: -3 });
    expect(result.money).toBe(-4);
    expect(result.food).toBe(0);
  });

  it('describeStock elenca scorte, tecnologie e pressione militare', () => {
    const text = describeStock(stock({ technologies: ['motorizzazione'] }), account());
    expect(text).toMatch(/Tesoreria/);
    expect(text).toMatch(/Motorizzazione/);
    expect(text).toMatch(/Fabbisogno militare/);
    expect(text).toMatch(/Nessun debito/);
  });

  it('il debito è la tesoreria negativa, con interessi e tetto di credito', () => {
    expect(debtOf(stock({ money: 10 }))).toBe(0);
    expect(debtOf(stock({ money: -7.5 }))).toBe(7.5);
    const limit = creditLimit(account());
    expect(limit).toBeGreaterThanOrEqual(5);
    expect(creditHeadroom(stock({ money: 0 }), account())).toBeCloseTo(limit, 2);
    expect(creditHeadroom(stock({ money: -limit }), account())).toBe(0);
    // Il debito matura interessi nel tick.
    const tick = advanceStock(stock({ money: -100 }), account(), 30);
    expect(tick.stock.money).toBeLessThan(-100);
    expect(tick.stock.money).toBeCloseTo(-100 - 100 * DEBT_MONTHLY_INTEREST + 0.2, 2);
    expect(describeStock(stock({ money: -50 }), account())).toMatch(/Debito pubblico/);
  });

  it('financePurchase copre con cassa e credito, e rifiuta oltre il tetto', () => {
    const limit = creditLimit(account());
    const cash = financePurchase(stock({ money: 10 }), account(), 4);
    expect(cash).toEqual({ ok: true, cashUsed: 4, debtUsed: 0 });
    const mixed = financePurchase(stock({ money: 1 }), account(), 4);
    expect(mixed.ok).toBe(true);
    expect(mixed.cashUsed).toBe(1);
    expect(mixed.debtUsed).toBe(3);
    const over = financePurchase(stock({ money: 0 }), account(), limit + 1);
    expect(over.ok).toBe(false);
    expect(over.error).toBe('credit_exhausted');
    // Con il debito già al tetto non c'è spazio.
    const maxed = financePurchase(stock({ money: -limit }), account(), 1);
    expect(maxed.error).toBe('credit_exhausted');
  });
});
