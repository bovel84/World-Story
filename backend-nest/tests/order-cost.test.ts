/**
 * Costo degli ordini del giocatore: la cassa deve seguire le scelte.
 * La stima è deterministica e viene addebitata dal motore all'esecuzione.
 */
import { describe, expect, it } from 'vitest';
import { affordableCharge, classifyOrder, describeOrderCost, estimateOrderCost } from '../src/core/simulation/OrderCost';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'BWA', provinces: 10, population: 8_700_000, gdp: 400, militaryPower: 38,
    factories: 1, ports: 0, universities: 2, forces: 5, mobilized: 0,
    monthlyRevenue: 0.62, monthlyExpenses: 0.5, monthlyBalance: 0.12, annualGrowthRate: 0.02,
    stability: 52, defenceBurdenPct: 1.4, warEffort: 20, socialTension: 20,
    nominalGdpUsdBillions: 83, gdpPerCapitaUsd: 9_500, government: 'Repubblica', ...overrides,
  };
}

describe('classificazione dell’ordine', () => {
  it('riconosce le famiglie di ordini dalle parole chiave', () => {
    expect(classifyOrder('Costruire una ferrovia verso il confine').category).toBe('infrastruttura');
    expect(classifyOrder('Aprire una fabbrica di taglio diamanti').category).toBe('industria');
    expect(classifyOrder('Finanziare l’apertura di una università a Gaborone').category).toBe('ricerca');
    expect(classifyOrder('Mobilitare una brigata corazzata al confine').category).toBe('militare');
    expect(classifyOrder('Avviare un piano sanitario nazionale').category).toBe('sociale');
    expect(classifyOrder('Firmare un accordo commerciale con il Sudafrica').category).toBe('commercio');
    expect(classifyOrder('Aprire un’ambasciata a Luanda').category).toBe('diplomazia');
    expect(classifyOrder('Avvia un censimento nazionale').category).toBe('amministrazione');
    expect(classifyOrder('Osservare la situazione').category).toBe('generale');
  });

  it('una spesa militare pesa più di un accordo diplomatico', () => {
    const military = estimateOrderCost('Costruire una brigata corazzata', account());
    const diplomacy = estimateOrderCost('Aprire un’ambasciata a Luanda', account());
    expect(military.amountMld).toBeGreaterThan(diplomacy.amountMld);
  });

  it('la portata dichiarata muove la stima', () => {
    const plain = estimateOrderCost('Costruire una ferrovia', account());
    const big = estimateOrderCost('Costruire una ferrovia nazionale', account());
    const small = estimateOrderCost('Costruire una ferrovia pilota', account());
    expect(big.amountMld).toBeGreaterThan(plain.amountMld);
    expect(small.amountMld).toBeLessThan(plain.amountMld);
  });
});

describe('stima del costo', () => {
  it('è deterministica e proporzionale al gettito del paese', () => {
    const poor = estimateOrderCost('Costruire una ferrovia', account({ monthlyRevenue: 0.62 }));
    const rich = estimateOrderCost('Costruire una ferrovia', account({ monthlyRevenue: 20 }));
    expect(estimateOrderCost('Costruire una ferrovia', account())).toEqual(poor);
    expect(rich.amountMld).toBeGreaterThan(poor.amountMld);
    // 25% del gettito annuo × fattore infrastrutture
    expect(poor.amountMld).toBeCloseTo(0.62 * 12 * 0.25 * 1.4, 2);
  });

  it('non produce mai cifre inventate o non finite', () => {
    const noAccount = estimateOrderCost('Costruire una ferrovia', null);
    expect(Number.isFinite(noAccount.amountMld)).toBe(true);
    expect(noAccount.amountMld).toBeGreaterThan(0);
    const broken = estimateOrderCost('Costruire una ferrovia', account({ monthlyRevenue: NaN }));
    expect(Number.isFinite(broken.amountMld)).toBe(true);
    expect(estimateOrderCost('', account()).amountMld).toBeGreaterThan(0);
  });

  it('dichiara la base del calcolo e i giorni tipici', () => {
    const estimate = estimateOrderCost('Costruire una ferrovia nazionale', account());
    expect(estimate.basis).toContain('25% del gettito annuo');
    expect(estimate.basis).toContain('Infrastrutture');
    expect(estimate.timeDays).toBeGreaterThan(0);
    expect(describeOrderCost(estimate, 'Costruire una ferrovia nazionale')).toContain('mld dalla tesoreria');
    // Il titolo lungo non sfonda il dispaccio.
    const long = describeOrderCost(estimate, 'x'.repeat(300));
    expect(long.length).toBeLessThan(220);
    expect(long).toContain('…');
  });

  it('non addebita oltre cassa più credito residuo', () => {
    // Cassa capiente: si paga tutto.
    expect(affordableCharge(12.4, 185.85, 49.92)).toEqual({ charge: 12.4, shortfall: 0 });
    // Cassa insufficiente ma credito disponibile: si va a debito.
    expect(affordableCharge(12.4, 3, 49.92)).toEqual({ charge: 12.4, shortfall: 0 });
    // Credito al tetto: si paga solo la cassa, il resto resta scoperto.
    expect(affordableCharge(12.4, 3, 0)).toEqual({ charge: 3, shortfall: 9.4 });
    // Nessuna cassa e nessun credito: nessuna spesa, nessun debito nuovo.
    expect(affordableCharge(12.4, -50, 0)).toEqual({ charge: 0, shortfall: 12.4 });
  });

  it('non produce mai addebiti inventati o negativi', () => {
    expect(affordableCharge(Number.NaN, 10, 5)).toEqual({ charge: 0, shortfall: 0 });
    expect(affordableCharge(-5, 10, 5)).toEqual({ charge: 0, shortfall: 0 });
    expect(affordableCharge(4, Number.NaN, Number.NaN)).toEqual({ charge: 0, shortfall: 4 });
    expect(affordableCharge(0.005, 10, 0).charge).toBe(0.01);
  });
});
