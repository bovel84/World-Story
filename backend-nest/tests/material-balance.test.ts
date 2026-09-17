/**
 * MATERIEL-CLARITY — bilancio materiale (read model).
 *
 * Verifica che la riga di sintesi («quanto ho, quanto produco, quanto consumo,
 * avanzo o deficit?») sia **derivata dal motore** e non inventata:
 *  - `consumo/mese` = fabbisogno del motore (`materialNeeds`);
 *  - `saldo/mese`   = flusso netto del motore (`advanceStock.flow`);
 *  - `produzione/mese` = consumo + saldo (aritmetica sui due numeri del motore);
 *  - scorta, tetto di stoccaggio e materiale perso vengono dal tick del motore.
 *
 * Nessuna LLM, nessun database: solo funzioni pure.
 */
import { describe, it, expect } from 'vitest';
import { MATERIAL_BALANCE_DAYS, materialBalance, describeMaterialBalance } from '../src/game/materialBalance';
import { advanceStock, type ResourceStock } from '../src/core/simulation/MaterialEconomy';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';
import type { NaturalEndowment } from '../src/core/simulation/MilitaryIndustry';

/** Conto nazionale minimo: i campi che il motore materiale legge davvero. */
function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'TST', provinces: 12, population: 60_000_000, gdp: 1_200,
    militaryPower: 80, factories: 12, ports: 4, universities: 6, forces: 200, mobilized: 0,
    monthlyRevenue: 9, monthlyExpenses: 8.4, monthlyBalance: 0.6, annualGrowthRate: 0.02,
    stability: 62, defenceBurdenPct: 3.4, warEffort: 18, socialTension: 28,
    nominalGdpUsdBillions: 1_200, gdpPerCapitaUsd: 20_000, government: 'Repubblica',
    ...overrides,
  };
}

/** Nazione con terra fertile, pesca, ferro e carbone: produce più di quanto consuma. */
const fertileLand: NaturalEndowment = { fertile_land: 5, fisheries: 5, iron: 4, coal: 4, oil: 2 };

/** Scorte di partenza lontane dal tetto: il flusso si legge senza deperimento. */
function stock(overrides: Partial<ResourceStock> = {}): ResourceStock {
  return { money: 120, debts: [], food: 30, clothing: 20, weapons: 10, fuel: 20, research: 5, technologies: [], ...overrides };
}

const tickOf = (s: ResourceStock, a: NationalAccount, e: NaturalEndowment = {}) =>
  advanceStock(s, a, MATERIAL_BALANCE_DAYS, e);

describe('materialBalance — bilancio mensile derivato dal motore', () => {
  it('espone i quattro materiali con etichette italiane', () => {
    const rows = materialBalance(stock(), account());
    expect(rows.map(row => row.kind)).toEqual(['food', 'clothing', 'weapons', 'fuel']);
    expect(rows.map(row => row.label)).toEqual(['Cibo', 'Vestiario', 'Armamenti', 'Carburante']);
  });

  it('il saldo è esattamente il flusso del motore e la produzione lo ricostruisce', () => {
    const a = account();
    const s = stock();
    const tick = tickOf(s, a, fertileLand);
    for (const row of materialBalance(s, a, fertileLand)) {
      expect(row.balancePerMonth).toBeCloseTo(Number(tick.flow[row.kind]), 3);
      // Il saldo è la differenza fra i due numeri mostrati: la riga non mente.
      expect(row.productionPerMonth - row.consumptionPerMonth).toBeCloseTo(row.balancePerMonth, 3);
    }
  });

  it('il consumo è il fabbisogno mensile del motore, non una stima', () => {
    const rows = materialBalance(stock(), account());
    // Popolazione 60 mln, 200 reparti: cibo 60 × 0,02 + 200 × 0,06 = 13,2;
    // vestiario 60 × 0,008 + 200 × 0,01 = 2,48.
    expect(rows.find(row => row.kind === 'food')!.consumptionPerMonth).toBeCloseTo(13.2, 3);
    expect(rows.find(row => row.kind === 'clothing')!.consumptionPerMonth).toBeCloseTo(2.48, 3);
  });

  it('nazione con terra e industria: avanzo su tutti i materiali', () => {
    const rows = materialBalance(stock(), account({ population: 100_000_000, forces: 20 }), fertileLand);
    const by = Object.fromEntries(rows.map(row => [row.kind, row]));
    for (const kind of ['food', 'clothing', 'weapons', 'fuel'] as const) {
      expect(by[kind].balancePerMonth).toBeGreaterThan(0);
      expect(by[kind].productionPerMonth).toBeGreaterThan(by[kind].consumptionPerMonth);
    }
  });

  it('nazione con grande esercito e poca terra: deficit reale, non un pareggio addolcito', () => {
    const rows = materialBalance(stock(), account());
    const food = rows.find(row => row.kind === 'food')!;
    expect(food.balancePerMonth).toBeLessThan(0);
    expect(food.consumptionPerMonth).toBeGreaterThan(food.productionPerMonth);
    // In deficit la produzione resta un numero leggibile (≥ 0), non un vuoto.
    expect(food.productionPerMonth).toBeGreaterThanOrEqual(0);
  });

  it('il tetto di stoccaggio e il materiale perso vengono dallo stesso tick', () => {
    const a = account();
    const s = stock();
    const tick = tickOf(s, a, fertileLand);
    const food = materialBalance(s, a, fertileLand).find(row => row.kind === 'food')!;
    expect(food.capacity).toBeGreaterThan(0);
    expect(food.spoiledPerMonth).toBeCloseTo(Number(tick.spoiled?.food || 0), 3);
  });

  it('magazzino già al tetto: il surplus risulta perso, non accumulato', () => {
    const full = materialBalance(stock({ food: 9_999 }), account({ population: 100_000_000, forces: 20 }), fertileLand);
    const food = full.find(row => row.kind === 'food')!;
    expect(food.stock).toBeGreaterThan(food.capacity);
    // Con avanzo e magazzino pieno il motore dichiara il deperimento: la riga lo riporta.
    expect(food.spoiledPerMonth).toBeGreaterThan(0);
  });

  it('senza conto nazionale non pubblica numeri (meglio nulla che inventato)', () => {
    expect(materialBalance(stock(), undefined)).toEqual([]);
    expect(describeMaterialBalance([])).toBe('Bilancio materiale non pubblicato.');
  });

  it('la riga di sintesi è leggibile a colpo d’occhio', () => {
    const text = describeMaterialBalance(materialBalance(stock(), account()));
    expect(text).toMatch(/Cibo \d/);
    expect(text).toMatch(/Armamenti \d/);
    expect(text).toMatch(/saldo [+-]?\d/);
    expect(text).toContain('/mese');
  });

  it('il ritmo dichiarato è mensile (30 giorni), come il motore', () => {
    expect(MATERIAL_BALANCE_DAYS).toBe(30);
  });
});
