/**
 * Effetti nazionali: le leve con cui il modello agisce sulla nazione.
 * Il motore valida, quantizza e limita: nulla passa alla lettera.
 */
import { describe, it, expect } from 'vitest';
import {
  EFFECT_LIMITS, EMPTY_MODIFIERS, MODIFIER_LIMITS, applyArsenalEffects, applyModifierEffects,
  applyModifiersToAccounts, applyStockEffects, decayModifiers, describeNationalEffects, hasModifiers,
  parseNationalEffects, stockCap, type NationalModifiers,
} from '../src/core/simulation/NationalEffects';
import { seedStock, type ResourceStock } from '../src/core/simulation/MaterialEconomy';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

const account = (over: Partial<NationalAccount> = {}): NationalAccount => ({
  polityId: 'DEU', provinces: 3, population: 10_000_000, gdp: 500, militaryPower: 300,
  factories: 4, ports: 2, universities: 3, forces: 6, mobilized: 2,
  monthlyRevenue: 10, monthlyExpenses: 8, monthlyBalance: 2, annualGrowthRate: 0.02,
  stability: 60, defenceBurdenPct: 2.4, warEffort: 30, socialTension: 20,
  nominalGdpUsdBillions: 1000, gdpPerCapitaUsd: 30_000, government: 'repubblica', ...over,
});

const stock = (over: Partial<ResourceStock> = {}): ResourceStock => ({ ...seedStock(account()), ...over });

describe('parseNationalEffects', () => {
  it('accetta solo forme valide, con motivo e riferimenti esistenti', () => {
    const effects = parseNationalEffects([
      { kind: 'stock', resource: 'food', delta: 10, reason: 'raccolto' },
      { kind: 'stock', resource: 'food', delta: 10 },                       // senza motivo
      { kind: 'stock', resource: 'krypto', delta: 5, reason: 'x' },         // risorsa ignota
      { kind: 'arsenal', equipmentId: 'astronave', delta: 2, reason: 'x' }, // voce ignota
      { kind: 'modifier', field: 'stability', delta: 999, reason: 'riforma' },
      { kind: 'economy', revenueMultiplierDelta: 5, reason: 'boom' },
      { kind: 'project', title: 'x', summary: 'y', months: 3, reason: 'z' }, // non più supportato
      { kind: 'arsenal', equipmentId: 'fucili', delta: -3, reason: 'perdite', polityId: 'SAU' },
    ]);
    expect(effects).toHaveLength(4);
    expect(effects[0]).toMatchObject({ kind: 'stock', resource: 'food', delta: 10 });
    // Il delta modificatore è limitato al tetto di turno.
    expect(effects[1]).toMatchObject({ kind: 'modifier', field: 'stability', delta: EFFECT_LIMITS.modifierDelta });
    // Il delta economico è limitato al tetto di turno.
    expect(effects[2]).toMatchObject({ kind: 'economy', revenueMultiplierDelta: EFFECT_LIMITS.economyDelta });
    expect(effects[3]).toMatchObject({ kind: 'arsenal', equipmentId: 'fucili', delta: -3, polityId: 'SAU' });
  });

  it('scarta input non array o non oggetto', () => {
    expect(parseNationalEffects(null)).toEqual([]);
    expect(parseNationalEffects('x')).toEqual([]);
    expect(parseNationalEffects([1, 'a', null])).toEqual([]);
  });
});

describe('applyStockEffects', () => {
  it('applica i delta con quantizzazione e clamp per risorsa', () => {
    const base = stock({ food: 100, money: 50, research: 100 });
    const { stock: next, applied, rejected } = applyStockEffects(base, [
      { kind: 'stock', resource: 'food', delta: 10, reason: 'raccolto' },
      { kind: 'stock', resource: 'money', delta: -20, reason: 'spesa' },
      { kind: 'stock', resource: 'food', delta: -999, reason: 'carestia' },
    ], account());
    expect(next.food).toBe(90);
    expect(next.money).toBe(30);
    expect(applied.length).toBe(3);
    expect(rejected).toEqual([]);
    // Il delta negativo enorme è stato limitato al 20% delle scorte.
    expect(applied[2].delta).toBe(-20);
  });

  it('non tocca i materiali sotto zero ma consente il debito in denaro', () => {
    const base = stock({ money: 2, weapons: 5 });
    const { stock: next } = applyStockEffects(base, [
      { kind: 'stock', resource: 'weapons', delta: -100, reason: 'perdite' },
      { kind: 'stock', resource: 'money', delta: -5, reason: 'spesa enorme' },
    ], account({ nominalGdpUsdBillions: 0 }));
    expect(next.weapons).toBe(0);
    expect(next.money).toBeLessThan(0);
  });

  it('il tetto del denaro dipende dal PIL', () => {
    const rich = stockCap('money', stock(), account({ nominalGdpUsdBillions: 1000 }));
    const poor = stockCap('money', stock(), account({ nominalGdpUsdBillions: 10 }));
    expect(rich).toBeGreaterThan(poor);
    expect(stockCap('food', stock({ food: 100 }))).toBeCloseTo(20, 5);
  });
});

describe('applyArsenalEffects', () => {
  it('limita i delta al 25% della dotazione ed elimina a zero', () => {
    const { units, applied } = applyArsenalEffects({ fucili: 100, carri_4: 2 }, [
      { kind: 'arsenal', equipmentId: 'fucili', delta: 1000, reason: 'mobilitazione' },
      { kind: 'arsenal', equipmentId: 'carri_4', delta: -1000, reason: 'distrutti' },
    ]);
    expect(units.fucili).toBe(125);
    expect(units.carri_4).toBeUndefined();
    expect(applied[0].delta).toBe(25);
    expect(applied[1].delta).toBe(-2);
  });
});

describe('modificatori nazionali', () => {
  it('applica e limita i delta, poi decade verso la neutralità', () => {
    const { modifiers, applied } = applyModifierEffects(EMPTY_MODIFIERS, [
      { kind: 'modifier', field: 'stability', delta: 20, reason: 'riforma' },
      { kind: 'modifier', field: 'socialTension', delta: -15, reason: 'concessioni' },
      { kind: 'economy', revenueMultiplierDelta: 0.1, growthModifierDelta: 0.01, reason: 'boom export' },
    ]);
    expect(applied).toHaveLength(3);
    expect(modifiers.stability).toBe(20);
    expect(modifiers.socialTension).toBe(-15);
    expect(modifiers.revenueMultiplier).toBeCloseTo(1.1, 5);
    expect(hasModifiers(modifiers)).toBe(true);
    // I limiti assoluti non sono superabili con applicazioni ripetute.
    let saturated = EMPTY_MODIFIERS;
    for (let i = 0; i < 20; i += 1) saturated = applyModifierEffects(saturated, [{ kind: 'modifier', field: 'stability', delta: 25, reason: 'x' }]).modifiers;
    expect(saturated.stability).toBe(MODIFIER_LIMITS.stability);
    const decayed = decayModifiers(modifiers, 0.5);
    expect(decayed.stability).toBe(10);
    expect(decayed.revenueMultiplier).toBeCloseTo(1.05, 5);
  });

  it('l’overlay modifica davvero i conti usati dal motore', () => {
    const accounts = { DEU: account() };
    const modifiers: NationalModifiers = { stability: -30, socialTension: 20, warEffort: 10, revenueMultiplier: 0.5, growthModifier: -0.05 };
    const overlaid = applyModifiersToAccounts(accounts, () => modifiers);
    expect(overlaid.DEU.stability).toBe(30);
    expect(overlaid.DEU.socialTension).toBe(40);
    expect(overlaid.DEU.warEffort).toBe(40);
    expect(overlaid.DEU.monthlyRevenue).toBe(5);
    expect(overlaid.DEU.monthlyBalance).toBe(-3);
    expect(overlaid.DEU.annualGrowthRate).toBeCloseTo(-0.03, 5);
    // Gli indici sono sempre nel range 0-100.
    const clamped = applyModifiersToAccounts({ DEU: account({ stability: 10 }) }, () => ({ ...EMPTY_MODIFIERS, stability: -45 }));
    expect(clamped.DEU.stability).toBe(0);
  });

  it('senza modificatori i conti restano identici', () => {
    const accounts = { DEU: account() };
    const overlaid = applyModifiersToAccounts(accounts, () => ({ ...EMPTY_MODIFIERS }));
    expect(overlaid.DEU).toBe(accounts.DEU);
  });

  it('descrive gli effetti applicati per la cronaca', () => {
    const lines = describeNationalEffects([
      { kind: 'stock', resource: 'food', delta: 12.5, reason: 'raccolto record' },
      { kind: 'modifier', field: 'stability', delta: -10, reason: 'sconfitta' },
    ]);
    expect(lines.join(' ')).toMatch(/food \+12.5: raccolto record/);
    expect(lines.join(' ')).toMatch(/stability -10: sconfitta/);
  });

  it('in strict le leve materiali da testo sono vietate', async () => {
    const { validateStrictWorldChanges } = await import('../src/core/simulation/EffectValidator');
    expect(() => validateStrictWorldChanges({ nationalEffects: [{ kind: 'stock', resource: 'money', delta: 1, reason: 'x' }] }))
      .toThrow(/nationalEffects/);
    expect(() => validateStrictWorldChanges({ nationalEffects: [] })).not.toThrow();
  });
});
