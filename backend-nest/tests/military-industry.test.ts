/**
 * Test del dominio militare-industriale: risorse naturali reali, catalogo con
 * qualità, fattibilità di costruzione/acquisto e legame con la produzione.
 */
import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT_CATALOG, IMPORT_MARKUP, arsenalCombatFactor, arsenalQualityIndex, arsenalStrength,
  combatAttrition, describeArsenal, describeEndowment, equipmentById, naturalResourcesFor,
  procurementOption, resourceCostFactor, tierForQuality, type NationCapacity,
} from '../src/core/simulation/MilitaryIndustry';
import { advanceStock, seedStock, type ResourceStock } from '../src/core/simulation/MaterialEconomy';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'DEU', provinces: 3, population: 10_000_000, gdp: 500, militaryPower: 300,
    factories: 3, ports: 2, universities: 3, forces: 5, mobilized: 1,
    monthlyRevenue: 1, monthlyExpenses: 0.8, monthlyBalance: 0.2, annualGrowthRate: 0.02,
    stability: 60, defenceBurdenPct: 2.4, warEffort: 30, socialTension: 20,
    nominalGdpUsdBillions: 40, gdpPerCapitaUsd: 4000, government: 'Repubblica', ...overrides,
  };
}

function capacity(overrides: Partial<NationCapacity> = {}): NationCapacity {
  return {
    factories: 5, ports: 3, universities: 4, technologies: [], money: 1_000, weapons: 1_000,
    endowment: {}, ...overrides,
  };
}

function stock(overrides: Partial<ResourceStock> = {}): ResourceStock {
  return { money: 100, food: 100, clothing: 100, weapons: 100, fuel: 100, research: 0, technologies: [], ...overrides };
}

describe('risorse naturali reali', () => {
  it('riconosce le dotazioni note senza inventare', () => {
    expect(naturalResourcesFor('SAU').oil).toBe(5);
    expect(naturalResourcesFor('AUS').iron).toBe(5);
    expect(naturalResourcesFor('COD').diamonds).toBe(5);
    expect(naturalResourcesFor('NOR').fisheries).toBe(5);
    expect(naturalResourcesFor('JPN').oil).toBeUndefined();
    expect(naturalResourcesFor('RUS').rare_earths).toBe(3);
  });

  it('applica un baseline minimo ai paesi non censiti', () => {
    const endowment = naturalResourcesFor('ZZZ');
    expect(endowment.fertile_land).toBe(1);
    expect(endowment.water).toBe(1);
    expect(endowment.oil).toBeUndefined();
  });

  it('descrive in modo leggibile', () => {
    expect(describeEndowment({ oil: 5, gas: 3 })).toMatch(/Petrolio 5\/5/);
    expect(describeEndowment({})).toMatch(/nessuna risorsa/);
  });
});

describe('catalogo e qualità', () => {
  it('assegna la fascia di qualità corretta', () => {
    expect(tierForQuality(10)).toBe('obsoleto');
    expect(tierForQuality(35)).toBe('datato');
    expect(tierForQuality(55)).toBe('moderno');
    expect(tierForQuality(75)).toBe('avanzato');
    expect(tierForQuality(95)).toBe('nuova_generazione');
  });

  it('copre terra, aria, mare, missili e droni con qualità crescenti', () => {
    const domains = new Set(EQUIPMENT_CATALOG.map(item => item.domain));
    expect(domains).toEqual(new Set(['terra', 'aria', 'mare', 'missili', 'droni']));
    expect(equipmentById('carri_4')!.quality).toBeGreaterThan(equipmentById('carri_3')!.quality);
    expect(equipmentById('sciame')!.tier).toBe('nuova_generazione');
  });

  it('calcola la forza dell’arsenale pesando dominio e qualità', () => {
    expect(arsenalStrength({})).toBe(0);
    const weak = arsenalStrength({ fucili: 10 });
    const strong = arsenalStrength({ carri_4: 10 });
    expect(strong).toBeGreaterThan(weak);
    expect(arsenalStrength({ carri_4: 1 })).toBeGreaterThan(arsenalStrength({ fucili: 1 }));
    expect(describeArsenal({ fucili: 2, carri_4: 5 })[0].equipment.id).toBe('carri_4');
  });

  it('misura la qualità media pesata sulle quantità', () => {
    expect(arsenalQualityIndex({})).toBe(0);
    expect(arsenalQualityIndex({ fucili: 10 })).toBe(35);
    // (10×35 + 10×84) / 20 = 59,5 → 60
    expect(arsenalQualityIndex({ fucili: 10, carri_4: 10 })).toBe(60);
  });

  it('la potenza effettiva premia un arsenale moderno e penalizza il vuoto', () => {
    const empty = arsenalCombatFactor({}, 10);
    const modern = arsenalCombatFactor({ carri_4: 40, caccia_5: 10 }, 10);
    expect(empty).toBeLessThanOrEqual(0.7);
    expect(modern).toBeGreaterThan(1);
    // Il fattore è limitato all'intervallo dichiarato.
    expect(arsenalCombatFactor({ sciame: 10_000 }, 1)).toBeLessThanOrEqual(1.6);
    expect(empty).toBeGreaterThanOrEqual(0.6);
  });

  it('l’attrito di battaglia è deterministico e quantizzato', () => {
    const { units, lost } = combatAttrition({ fucili: 100, apc: 10 }, 0.2);
    expect(units.fucili).toBe(80);
    expect(units.apc).toBe(8);
    expect(lost).toBe(22);
    expect(combatAttrition({}, 0.5).lost).toBe(0);
    // Non azzera mai completamente sotto intensità massima.
    expect(combatAttrition({ fucili: 1 }, 0.5).units.fucili).toBeUndefined();
  });
});

describe('costruzione e acquisto', () => {
  it('non si costruisce un caccia senza tecnologia, industria e risorse', () => {
    const option = procurementOption(equipmentById('caccia_4')!, capacity({ technologies: [], factories: 0 }));
    expect(option.canBuild).toBe(false);
    expect(option.reasons.join(' ')).toMatch(/tecnologia|fabbriche|università|risorsa/);
    // L'importazione resta possibile con la sola tesoreria.
    expect(option.canBuy).toBe(capacity().money * 1000 >= option.buyCostMln);
  });

  it('costruisce solo con i requisiti completi', () => {
    const option = procurementOption(equipmentById('caccia_4')!, capacity({
      technologies: ['aeronautica_avanzata', 'elettronica'],
      endowment: { bauxite: 3, rare_earths: 2 },
    }));
    expect(option.canBuild).toBe(true);
    expect(option.reasons).toEqual([]);
  });

  it('importare costa il sovrapprezzo di mercato', () => {
    const option = procurementOption(equipmentById('fucili')!, capacity());
    expect(option.buyCostMln).toBe(Math.round(equipmentById('fucili')!.costMln * IMPORT_MARKUP));
  });

  it('le risorse proprie riducono il costo di costruzione', () => {
    const poor = resourceCostFactor(equipmentById('carri_4')!, {});
    const rich = resourceCostFactor(equipmentById('carri_4')!, { iron: 5, rare_earths: 5 });
    expect(rich).toBeLessThan(poor);
    expect(rich).toBeGreaterThanOrEqual(0.85);
  });

  it('la tesoreria insufficiente blocca sia costruzione sia acquisto', () => {
    const option = procurementOption(equipmentById('portaerei')!, capacity({ money: 0.1 }));
    expect(option.canBuild).toBe(false);
    expect(option.canBuy).toBe(false);
  });
});

describe('le risorse naturali pesano sulla produzione', () => {
  it('una nazione petrolifera produce carburante anche senza porti', () => {
    const without = advanceStock(stock({ fuel: 10 }), account({ ports: 0, factories: 0 }), 30, {});
    const withOil = advanceStock(stock({ fuel: 10 }), account({ ports: 0, factories: 0 }), 30, { oil: 5 });
    expect(withOil.stock.fuel).toBeGreaterThan(without.stock.fuel);
  });

  it('ferro e carbone alimentano gli armamenti, la terra fertile il cibo', () => {
    const base = account({ factories: 0, universities: 0, population: 0, forces: 0, mobilized: 0 });
    const plain = advanceStock(stock({ weapons: 0, food: 0 }), base, 30, {});
    const rich = advanceStock(stock({ weapons: 0, food: 0 }), base, 30, { iron: 5, coal: 5, fertile_land: 5 });
    expect(rich.stock.weapons).toBeGreaterThan(plain.stock.weapons);
    expect(rich.stock.food).toBeGreaterThan(plain.stock.food);
  });

  it('l’export di risorse genera reddito', () => {
    const noOil = advanceStock(stock({ money: 10 }), account({ monthlyBalance: 0 }), 30, {});
    const oil = advanceStock(stock({ money: 10 }), account({ monthlyBalance: 0 }), 30, { oil: 5 });
    expect(oil.stock.money).toBeGreaterThan(noOil.stock.money);
  });

  it('il magazzino iniziale riflette le risorse naturali', () => {
    const plain = seedStock(account(), {});
    const oilState = seedStock(account(), { oil: 5, iron: 5, fertile_land: 5 });
    expect(oilState.fuel).toBeGreaterThan(plain.fuel);
    expect(oilState.weapons).toBeGreaterThan(plain.weapons);
    expect(oilState.food).toBeGreaterThan(plain.food);
  });
});
