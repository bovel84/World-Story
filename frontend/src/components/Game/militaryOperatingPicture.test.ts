/**
 * COUNTRY-CLARITY — scheda Forze armate: uomini, copertura per categoria,
 * prontezza operativa, produzione interna contro acquisto.
 */
import { describe, it, expect } from 'vitest';
import { equipmentCoverage, manpowerPayload, militaryOperatingPicture, orderRatePerMonth, procurementRows, readinessPicture } from './militaryOperatingPicture';
import type { ArsenalResponse, ArsenalLine, ProductionOrder } from '../../services/api';

function line(name: string, category: string, domain: string, quantity: number): ArsenalLine {
  return { id: name.toLowerCase().replace(/\W+/g, '_'), name, category, domain, quantity, quality: 60, tier: 'moderno', combatFactor: 1 } as unknown as ArsenalLine;
}

const LINES: ArsenalLine[] = [
  line('Fucili d’ordinanza', 'Fanteria', 'terra', 240),
  line('Veicoli blindati', 'Corazzati', 'terra', 9),
  line('Artiglieria da campagna', 'Artiglieria', 'terra', 3),
  line('SAM a corto raggio', 'Difesa aerea', 'missili', 5),
  line('Caccia multiruolo', 'Aerei', 'aria', 2),
  line('Fregata', 'Navale', 'mare', 1),
];

function arsenal(overrides: Partial<ArsenalResponse> = {}): Partial<ArsenalResponse> {
  return { lines: LINES, qualityIndex: 60, combatFactor: 1.1, effectiveMilitaryPower: 4200, baseMilitaryPower: 3800, catalog: [], units: {}, ...overrides };
}

const ORDER: ProductionOrder = {
  id: 'o1', equipmentId: 'carri_3', name: 'Carri di 3ª generazione', domain: 'terra', quantity: 12,
  progress: 0, spentMln: 0, startedTurn: 1, startedDate: '2026-01-01', expectedDate: '2026-02-01',
  status: 'in_progress', note: '', qualityLoss: 0, updatedDate: '2026-01-15', expectedDate2: undefined,
} as unknown as ProductionOrder;

const CATALOG = [
  { id: 'carri_3', name: 'Carri di 3ª generazione', domain: 'terra', category: 'Corazzati', quality: 62, tier: 'moderno', costMln: 8000, weaponsCost: 26, role: '', description: '', specs: [], canBuild: true, canBuy: true, buildCostMln: 8000, buyCostMln: 12800, reasons: [] },
  { id: 'caccia_5', name: 'Caccia di 5ª generazione', domain: 'aria', category: 'Aerei', quality: 80, tier: 'avanzato', costMln: 12000, weaponsCost: 30, role: '', description: '', specs: [], canBuild: false, canBuy: true, buildCostMln: null, buyCostMln: 24000, reasons: ['Tecnologia non disponibile'] },
];

describe('COUNTRY-CLARITY · forze armate', () => {
  it('copertura per categoria: possesso sulla dotazione di riferimento', () => {
    const coverage = equipmentCoverage({ forces: 6, mobilized: 2 }, arsenal());
    const individual = coverage.find(row => row.id === 'individualWeapons') as any;
    expect(individual.required).toBe(340); // 40×6 + 50×2, formula del motore
    expect(individual.actual).toBe(240);
    expect(individual.pct).toBe(70.6);
    expect(individual.tone).toBe('warning');
    expect(coverage.find(row => row.id === 'armoredMobility')?.pct).toBe(100);
    expect(coverage.find(row => row.id === 'supportWeapons')?.pct).toBe(100);
    expect(coverage.find(row => row.id === 'navalSupport')?.required).toBe(1);
    expect(coverage.find(row => row.id === 'individualWeapons')?.items[0]).toContain('Fucili');
  });

  it('copertura zero: senza uomini il fabbisogno è nullo, non finto', () => {
    const coverage = equipmentCoverage({ forces: 0, mobilized: 0 }, arsenal());
    expect(coverage.every(row => row.required === 0)).toBe(true);
    expect(coverage.every(row => row.pct === 100)).toBe(true); // possiede mezzi senza reparti
    const empty = equipmentCoverage(null, null);
    expect(empty.every(row => row.actual === 0 && row.pct === 0)).toBe(true);
  });

  it('prontezza operativa: media pesata, modulata da carburante, scorte e qualità', () => {
    const coverage = equipmentCoverage({ forces: 6, mobilized: 2 }, arsenal());
    const ready = readinessPicture({ account: { forces: 6, mobilized: 2 }, arsenal: arsenal(), coverage });
    expect(ready.readinessPct).toBe(76);
    expect(ready.status).toBe('stable');
    expect(ready.drivers.some(driver => /Copertura armi individuali/.test(driver.label))).toBe(true);
    expect(ready.drivers.some(driver => /riservisti richiamati/.test(driver.label))).toBe(true);

    const dry = readinessPicture({
      account: { forces: 6, mobilized: 2 }, arsenal: arsenal(), coverage,
      resources: { fuel: 10, needs: { fuel: 30 } as any },
    });
    expect(dry.readinessPct).toBeLessThan(30);
    expect(dry.status).toBe('critical');
    expect(dry.drivers.some(driver => /^Carburante:/.test(driver.label))).toBe(true);
    expect(dry.drivers.find(driver => /^Carburante:/.test(driver.label))?.tone).toBe('critical');
  });

  it('manpower: reparti del motore, nessuna conversione in uomini', () => {
    const payload = manpowerPayload({ forces: 12, mobilized: 3, population: 60_000_000 }, { capacityBase: { forces: 20 } });
    expect(payload).toMatchObject({ active: 12, mobilized: 3, standing: 15, baseline: 20, mobilizedPct: 20, shareOfPopulationPct: null, reservePool: null });
    expect(manpowerPayload({ population: 10_000_000 }, null)).toBeNull();
    expect(manpowerPayload({ forces: 5, mobilized: 0 })).toMatchObject({ standing: 5, mobilizedPct: 0, baseline: null });
    expect(manpowerPayload(null, { capacityBase: { forces: 4 } })).toMatchObject({ active: 0, standing: 0, baseline: 4 });
  });

  it('i fattori mancanti non puniscono: senza scorte pubblicate la prontezza non crolla', () => {
    const coverage = equipmentCoverage({ forces: 4, mobilized: 0 }, arsenal());
    const ready = readinessPicture({ account: { forces: 4 }, arsenal: arsenal(), coverage, resources: {} });
    expect(ready.readinessPct).toBeGreaterThan(50);
    expect(ready.drivers.every(driver => driver.label !== 'Carburante: dato non disponibile di operazioni')).toBe(true);
  });

  it('produzione in casa contro acquisto: ordini, ritmo e motivi del motore', () => {
    const rows = procurementRows(arsenal({ catalog: CATALOG as any, units: { caccia_5: 5 }, production: { orders: [ORDER], inProgress: 1 } as any }));
    const fighter = rows.find(row => row.id === 'caccia_5') as any;
    const tank = rows.find(row => row.id === 'carri_3') as any;
    expect(rows[0].id).toBe('caccia_5'); // in servizio: prima di tutto
    expect(fighter.available).toBe(5);
    expect(fighter.canBuild).toBe(false);
    expect(fighter.canBuy).toBe(true);
    expect(fighter.domestic).toBe(false);
    expect(fighter.imported).toBeNull(); // il motore non traccia le importazioni
    expect(tank.inProduction).toBe(12);
    expect(tank.domestic).toBe(true);
    expect(tank.productionPerMonth).toBeCloseTo(11.6, 1);
    expect(tank.reasons).toEqual([]);
    expect(orderRatePerMonth(ORDER)).toBeCloseTo(11.6, 1);
    expect(orderRatePerMonth({ ...ORDER, expectedDate: null } as any)).toBeNull();
  });

  it('quadro completo: uomini, prontezza, scorte e sistemi in casa in un colpo d’occhio', () => {
    const picture = militaryOperatingPicture({
      account: { forces: 6, mobilized: 2 },
      resources: { weapons: 200, fuel: 4, needs: { weapons: 4, fuel: 2 } as any },
      arsenal: arsenal({ catalog: CATALOG as any }),
      assets: { capacityBase: { forces: 18 } },
    });
    expect(picture.manpower?.standing).toBe(8);
    expect(picture.manpower?.baseline).toBe(18);
    expect(picture.manpower?.mobilizedPct).toBe(25);
    expect(picture.headline).toContain('8 reparti sotto le armi');
    expect(picture.headline).toContain('sistemi prodotti in casa');
    expect(picture.qualityIndex).toBe(60);
    expect(picture.combatFactor).toBe(1.1);
    expect(picture.stock.find(row => row.id === 'weapons')?.tone).toBe('positive');
    expect(picture.stock.find(row => row.id === 'fuel')?.tone).toBe('warning');
    expect(picture.stock.find(row => row.id === 'fuel')?.text).toBe('2,0 mesi');
    expect(picture.drivers.some(driver => driver.label.startsWith('8 reparti sotto le armi'))).toBe(true);
    expect(picture.drivers.some(driver => /^Prontezza operativa/.test(driver.label))).toBe(true);
    expect(picture.status).toBe('pressure'); // scorte carburante sotto soglia
  });

  it('dati mancanti: il quadro lo dichiara invece di inventare numeri', () => {
    const picture = militaryOperatingPicture({});
    expect(picture.manpower).toBeNull();
    expect(picture.headline).not.toContain('sotto le armi');
    expect(picture.drivers.some(driver => driver.label === 'Forze non pubblicate dal motore')).toBe(true);
    expect(picture.stock.every(row => row.stock === null && row.text === 'dato non disponibile')).toBe(true);
    expect(picture.procurement).toEqual([]);
    expect(picture.status).toBe('critical');
  });

  it('scenario storico: reparti a piedi, nessun catalogo, numeri coerenti', () => {
    const picture = militaryOperatingPicture({
      account: { forces: 20, mobilized: 80 },
      arsenal: { lines: [line('Fucili a miccia', 'Fanteria', 'terra', 800), line('Cannoni', 'Artiglieria', 'terra', 10)], qualityIndex: 22, catalog: [] },
    });
    const individual = picture.coverage.find(row => row.id === 'individualWeapons') as any;
    expect(individual.required).toBe(4800); // 40×20 + 50×80
    expect(individual.pct).toBe(16.7);
    expect(picture.readiness.readinessPct).toBeLessThan(35);
    expect(picture.status).toBe('critical');
    expect(picture.procurement).toEqual([]);
  });
});
