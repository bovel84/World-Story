/**
 * COUNTRY-CLARITY — scheda Industria: capacità, occupazione, settori,
 * produzione con limiti, ordine completato.
 */
import { describe, it, expect } from 'vitest';
import { industryOperatingPicture } from './industryOperatingPicture';
import { orderRatePerMonth } from './militaryOperatingPicture';
import type { ProductionOrder } from '../../services/api';
import type { NationalProcess } from './nationDossier';

function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'o1', equipmentId: 'carri_3', name: 'Carri armati di 3ª generazione', domain: 'terra',
    quantity: 12, progress: 25, spentMln: 1000, startedTurn: 1, startedDate: '2026-01-01',
    status: 'in_progress', note: '', qualityLoss: 0, updatedDate: '2026-02-01', expectedDate: '2026-02-01',
    ...overrides,
  };
}

function process(overrides: Partial<NationalProcess> = {}): NationalProcess {
  return { id: 'p1', title: 'Ferrovia verso il fronte', summary: 'Collegamento ferroviario', started_date: '2026-01-05', expected_date: '2026-06-01', progress: 40, progress_note: '', ...overrides } as NationalProcess;
}

const CATALOG = [{
  id: 'carri_3', name: 'Carri armati di 3ª generazione', domain: 'terra', category: 'Corazzati',
  quality: 62, tier: 'moderno', costMln: 8000, weaponsCost: 26, role: '', description: '', specs: [],
  canBuild: true, canBuy: true, buildCostMln: 8000, buyCostMln: 12800, reasons: [],
}];

describe('COUNTRY-CLARITY · industria', () => {
  it('capacità totale, usata e libera: una lavorazione attiva = una linea', () => {
    const picture = industryOperatingPicture({
      account: { factories: 8, ports: 3, universities: 2 },
      productionOrders: [order(), order({ id: 'o2', name: 'Fucili', equipmentId: 'fucili', quantity: 200, expectedDate: '2026-03-01' })],
      processes: [process(), process({ id: 'p2', title: 'Porto civile' })],
      maintenance: [{ facilityId: 'f1', typeName: 'Acciaieria', operational: true, sufficient: false, resourceId: 'coal', shortfall: '12' }],
      arsenal: { catalog: CATALOG as any, capacity: { factories: 8, ports: 3, universities: 2 } as any },
    });
    expect(picture.capacityTotal).toBe(8);
    expect(picture.assignments).toHaveLength(5);
    expect(picture.capacityUsed).toBe(5);
    expect(picture.capacityFree).toBe(3);
    expect(picture.usedPct).toBeCloseTo(62.5, 1);
    expect(picture.sectors.map(sector => sector.label)).toContain('Armamenti');
    expect(picture.sectors.map(sector => sector.label)).toContain('Manutenzione');
    expect(picture.assignments.find(item => item.kind === 'manutenzione')?.blocker).toContain('coal');
    expect(picture.drivers.some(driver => driver.label === 'Rallentamento: Acciaieria')).toBe(true);
    expect(picture.ports).toBe(3);
    expect(picture.universities).toBe(2);
  });

  it('nessun ordine: tutte le linee libere, nessuna invenzione', () => {
    const picture = industryOperatingPicture({ account: { factories: 6 } });
    expect(picture.capacityUsed).toBe(0);
    expect(picture.capacityFree).toBe(6);
    expect(picture.usedPct).toBe(0);
    expect(picture.assignments).toEqual([]);
    expect(picture.status).toBe('healthy');
    expect(picture.drivers.some(driver => driver.label === 'Nessuna lavorazione attiva')).toBe(true);
  });

  it('capacità satura: nessun margine per nuove lavorazioni', () => {
    const orders = Array.from({ length: 8 }, (_, index) => order({ id: `o${index}` }));
    const picture = industryOperatingPicture({ account: { factories: 8 }, productionOrders: orders });
    expect(picture.capacityUsed).toBe(8);
    expect(picture.capacityFree).toBe(0);
    expect(picture.usedPct).toBe(100);
    expect(picture.status).toBe('pressure');
    expect(picture.drivers[0].detail).toContain('nessun margine');
  });

  it('senza fabbriche il dominio è sotto pressione e lo dice', () => {
    const picture = industryOperatingPicture({ account: { factories: 0 } });
    expect(picture.status).toBe('pressure');
    expect(picture.drivers.some(driver => driver.label === 'Nessuno stabilimento registrato')).toBe(true);
    expect(picture.usedPct).toBe(0);
  });

  it('ordine completato: fuori dalle lavorazioni attive, dentro lo storico produttivo', () => {
    const picture = industryOperatingPicture({
      account: { factories: 4 },
      productionOrders: [order({ status: 'completed', progress: 100 }), order({ id: 'o2', progress: 50 })],
    });
    expect(picture.assignments.map(item => item.id)).toEqual(['prod-o2']);
    expect(picture.productions.map(item => item.status)).toEqual(['completed', 'in_progress']);
    expect(picture.productions[0].deliveredUnits).toBe(12);
    expect(picture.productions[1].deliveredUnits).toBe(6);
  });

  it('ritmo ed efficienza: date del motore, scorte di armamenti e carburante', () => {
    expect(orderRatePerMonth(order({ quantity: 12, startedDate: '2026-01-01', expectedDate: '2026-02-01' }))).toBeCloseTo(11.6, 1);
    expect(orderRatePerMonth(order({ startedDate: '2026-01-01', expectedDate: null }))).toBeNull();

    const full = industryOperatingPicture({
      account: { factories: 2 },
      productionOrders: [order({ progress: 0 })],
      arsenal: { catalog: CATALOG as any },
      resources: { weapons: 500, fuel: 500, needs: { fuel: 20 } as any },
    });
    expect(full.productions[0].efficiencyPct).toBe(100);
    expect(full.productions[0].limits).toEqual([]);

    const scarce = industryOperatingPicture({
      account: { factories: 2 },
      productionOrders: [order({ progress: 0 })],
      arsenal: { catalog: CATALOG as any },
      resources: { weapons: 156, fuel: 50, needs: { fuel: 20 } as any },
    });
    expect(scarce.productions[0].efficiencyPct).toBe(50);
    expect(scarce.productions[0].limits).toContain('armamenti 50%');
  });

  it('scenario storico: la produzione militare racconta sé stessa senza catalogo moderno', () => {
    const picture = industryOperatingPicture({
      account: { factories: 3, ports: 1, universities: 0 },
      productionOrders: [order({ id: 'o9', name: 'Artiglieria da campagna', equipmentId: 'artiglieria', quantity: 6, startedDate: '1815-01-01', expectedDate: '1815-07-01' })],
      arsenal: { catalog: [] },
    });
    expect(picture.capacityTotal).toBe(3);
    expect(picture.capacityUsed).toBe(1);
    expect(picture.productions[0].label).toBe('Artiglieria da campagna');
    expect(picture.productions[0].efficiencyPct).toBeNull();
    expect(picture.universities).toBe(0);
  });
});
