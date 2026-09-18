/**
 * COUNTRY-CLARITY ENGINE — scheda Industria (read model).
 *
 * La capacità industriale non è più una convenzione della UI: totale,
 * occupazione, saturazione e fattore di rallentamento arrivano dal motore.
 * Questi test verificano che il read model li legga, li unisca alle lavorazioni
 * locali (date, avanzamento, vincoli) e — quando il dato manca — lo dichiari
 * invece di inventare un secondo calcolo. In più: le unità consegnate seguono
 * la semantica del motore (consegna solo a lavori finiti).
 */
import { describe, it, expect } from 'vitest';
import { industryOperatingPicture } from './industryOperatingPicture';
import { orderRatePerMonth } from './militaryOperatingPicture';
import type { IndustrialCapacityPayload, ProductionOrder } from '../../services/api';
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

/** Capacità industriale come la pubblica il motore. */
function capacity(overrides: Partial<IndustrialCapacityPayload> = {}): IndustrialCapacityPayload {
  return {
    total: 8, used: 1, free: 7, utilizationPct: 12.5, demand: 1, satisfactionPct: 100,
    overflowFactor: 1, saturated: false,
    allocations: [{ id: 'o1', kind: 'military_production', label: 'Carri armati di 3ª generazione ×12', capacityDemand: 16, sector: 'Corazzati (terra)', basis: 'Voce di catalogo: 3 fabbriche richieste.' }],
    byKind: { military_production: 16, project: 0, maintenance: 0 },
    defenceSharePct: 100,
    totalBasis: '8 fabbriche × 10 linee',
    ...overrides,
  };
}

const CATALOG = [{
  id: 'carri_3', name: 'Carri armati di 3ª generazione', domain: 'terra', category: 'Corazzati',
  quality: 62, tier: 'moderno', costMln: 8000, weaponsCost: 26, role: '', description: '', specs: [],
  canBuild: true, canBuy: true, buildCostMln: 8000, buyCostMln: 12800, reasons: [],
}] as never;

describe('COUNTRY-CLARITY ENGINE · industria', () => {
  it('legge totale, occupazione e saturazione dal motore', () => {
    const picture = industryOperatingPicture({
      account: { factories: 8, ports: 3, universities: 2 },
      productionOrders: [order()],
      arsenal: { catalog: CATALOG, industrialCapacity: capacity() },
    });
    expect(picture.capacityPublished).toBe(true);
    expect(picture.capacityTotal).toBe(8);
    expect(picture.capacityUsed).toBe(1);
    expect(picture.capacityFree).toBe(7);
    expect(picture.usedPct).toBeCloseTo(12.5, 1);
    expect(picture.demand).toBe(1);
    expect(picture.saturated).toBe(false);
    expect(picture.overflowFactor).toBe(1);
    expect(picture.defenceSharePct).toBe(100);
    expect(picture.totalBasis).toContain('8 fabbriche');
    expect(picture.ports).toBe(3);
    expect(picture.universities).toBe(2);
  });

  it('unisce ogni lavorazione del motore al suo contesto locale', () => {
    const picture = industryOperatingPicture({
      account: { factories: 8 },
      productionOrders: [order()],
      processes: [process()],
      maintenance: [{ facilityId: 'f1', typeName: 'Acciaieria', operational: true, sufficient: false, resourceId: 'coal', shortfall: '12' }],
      arsenal: {
        catalog: CATALOG,
        industrialCapacity: capacity({
          used: 3, free: 5, demand: 3, utilizationPct: 37.5, defenceSharePct: 53.3,
          allocations: [
            { id: 'o1', kind: 'military_production', label: 'Carri armati ×12', capacityDemand: 16, sector: 'Corazzati (terra)', basis: 'Voce di catalogo.' },
            { id: 'p1', kind: 'project', label: 'Ferrovia verso il fronte', capacityDemand: 6, sector: 'Infrastrutture e progetti', basis: 'Progetto di 5 mesi.' },
            { id: 'f1', kind: 'maintenance', label: 'Acciaieria', capacityDemand: 5, sector: 'Manutenzione impianti', basis: 'Manutenzione da 40 unità.' },
          ],
        }),
      },
    });
    expect(picture.assignments).toHaveLength(3);
    const production = picture.assignments.find(item => item.kind === 'produzione')!;
    expect(production.capacityDemand).toBe(16);
    expect(production.progressPct).toBe(25);
    expect(production.detail).toContain('consegna prevista 2026-02-01');
    const project = picture.assignments.find(item => item.kind === 'progetto')!;
    expect(project.capacityDemand).toBe(6);
    expect(project.progressPct).toBe(40);
    expect(project.sector).toBe('Infrastrutture'); // categoria del progetto, dal motore
    const maintenance = picture.assignments.find(item => item.kind === 'manutenzione')!;
    expect(maintenance.blocker).toContain('coal');
    expect(maintenance.detail).toContain('Manca 12 coal');
    expect(picture.sectors.find(sector => sector.label === 'Manutenzione impianti')?.capacityDemand).toBe(5);
    expect(picture.drivers.some(driver => driver.label === 'Rallentamento: Acciaieria')).toBe(true);
    expect(picture.drivers.some(driver => driver.label.includes('impianti in manutenzione'))).toBe(true);
  });

  it('industria satura: lo dice il motore, il read model lo ripete', () => {
    const picture = industryOperatingPicture({
      account: { factories: 2 },
      productionOrders: [order()],
      arsenal: {
        catalog: CATALOG,
        industrialCapacity: capacity({ total: 20, used: 20, free: 0, utilizationPct: 100, demand: 96, satisfactionPct: 20.8, overflowFactor: 0.25, saturated: true }),
      },
    });
    expect(picture.saturated).toBe(true);
    expect(picture.capacityFree).toBe(0);
    expect(picture.usedPct).toBe(100);
    expect(picture.headline).toContain('industria satura');
    expect(picture.drivers[0].label).toContain('Industria satura');
    expect(picture.drivers[0].detail).toContain('25%');
    expect(picture.status).toBe('pressure');
  });

  it('senza capacità pubblicata il read model non inventa un secondo calcolo', () => {
    const picture = industryOperatingPicture({
      account: { factories: 6 },
      productionOrders: [order()],
    });
    expect(picture.capacityPublished).toBe(false);
    expect(picture.capacityTotal).toBe(0);
    expect(picture.capacityUsed).toBe(0);
    expect(picture.usedPct).toBe(0);
    // Le lavorazioni restano elencate, senza occupazione delle linee.
    expect(picture.assignments).toEqual([]);
    expect(picture.status).toBe('pressure');
    expect(picture.drivers[0].label).toContain('non pubblicata');
    expect(picture.headline).toContain('non pubblicata');
  });

  it('nessuna lavorazione: le linee libere sono quelle del motore', () => {
    const picture = industryOperatingPicture({
      account: { factories: 6 },
      arsenal: { industrialCapacity: capacity({ total: 60, used: 0, free: 60, utilizationPct: 0, demand: 0, allocations: [], byKind: {}, defenceSharePct: 0 }) },
    });
    expect(picture.capacityUsed).toBe(0);
    expect(picture.capacityFree).toBe(60);
    expect(picture.assignments).toEqual([]);
    expect(picture.status).toBe('healthy');
    expect(picture.drivers.some(driver => driver.label === 'Nessuna lavorazione attiva')).toBe(true);
  });

  it('le unità consegnate seguono il motore: solo a lavori finiti', () => {
    const picture = industryOperatingPicture({
      account: { factories: 4 },
      productionOrders: [
        order({ status: 'completed', progress: 100, qualityLoss: 25 }),
        order({ id: 'o2', progress: 50 }),
      ],
      arsenal: { industrialCapacity: capacity() },
    });
    // Un ordine in corso non ha consegnato nulla: il progresso non è una consegna.
    expect(picture.productions.map(item => item.status)).toEqual(['completed', 'in_progress']);
    expect(picture.productions[0].deliveredUnits).toBe(9); // 12 meno il 25% difettoso
    expect(picture.productions[0].projectedUnits).toBe(9);
    expect(picture.productions[0].inProgressUnits).toBe(0);
    expect(picture.productions[1].deliveredUnits).toBe(0);
    expect(picture.productions[1].projectedUnits).toBe(12);
    expect(picture.productions[1].inProgressUnits).toBe(12);
  });

  it('ritmo ed efficienza: date del motore, scorte di armamenti e carburante', () => {
    expect(orderRatePerMonth(order({ quantity: 12, startedDate: '2026-01-01', expectedDate: '2026-02-01' }))).toBeCloseTo(11.6, 1);
    expect(orderRatePerMonth(order({ startedDate: '2026-01-01', expectedDate: null }))).toBeNull();

    const full = industryOperatingPicture({
      account: { factories: 2 },
      productionOrders: [order({ progress: 0 })],
      arsenal: { catalog: CATALOG, industrialCapacity: capacity() },
      resources: { weapons: 500, fuel: 500, needs: { fuel: 20 } as never },
    });
    expect(full.productions[0].efficiencyPct).toBe(100);
    expect(full.productions[0].limits).toEqual([]);

    const scarce = industryOperatingPicture({
      account: { factories: 2 },
      productionOrders: [order({ progress: 0 })],
      arsenal: { catalog: CATALOG, industrialCapacity: capacity() },
      resources: { weapons: 156, fuel: 50, needs: { fuel: 20 } as never },
    });
    expect(scarce.productions[0].efficiencyPct).toBe(50);
    expect(scarce.productions[0].limits).toContain('armamenti 50%');
  });

  it('scenario storico: la produzione militare racconta sé stessa senza catalogo moderno', () => {
    const picture = industryOperatingPicture({
      account: { factories: 3, ports: 1, universities: 0 },
      productionOrders: [order({ id: 'o9', name: 'Artiglieria da campagna', equipmentId: 'artiglieria', quantity: 6, startedDate: '1815-01-01', expectedDate: '1815-07-01' })],
      arsenal: {
        catalog: [],
        industrialCapacity: capacity({
          total: 30, used: 16, free: 14, utilizationPct: 53.3, demand: 16,
          allocations: [{ id: 'o9', kind: 'military_production', label: 'Artiglieria da campagna ×6', capacityDemand: 16, sector: 'Artiglieria (terra)', basis: 'Voce di catalogo.' }],
          byKind: { military_production: 16, project: 0, maintenance: 0 },
        }),
      },
    });
    expect(picture.capacityTotal).toBe(30);
    expect(picture.capacityUsed).toBe(16);
    expect(picture.productions[0].label).toBe('Artiglieria da campagna');
    expect(picture.productions[0].efficiencyPct).toBeNull();
    expect(picture.universities).toBe(0);
  });
});
