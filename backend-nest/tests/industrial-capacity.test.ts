/**
 * IndustrialCapacity — la capacità industriale come regola del motore.
 *
 * Verifica che il totale derivi dagli impianti reali, che la domanda venga dai
 * dati del motore (requires della voce di catalogo, mesi residui dei progetti,
 * termini di manutenzione) e che la saturazione rallenti invece di rifiutare.
 */
import { describe, it, expect } from 'vitest';
import {
  CAPACITY_PER_FACTORY, CAPACITY_PER_PORT, CAPACITY_PER_UNIVERSITY, MAX_ALLOCATION_PER_ITEM,
  industrialCapacityOf, industrialCapacityTotal, maintenanceAllocation, militaryOrderAllocation,
  projectAllocation,
} from '../src/core/simulation/IndustrialCapacity';

describe('totale della capacità', () => {
  it('deriva dagli impianti che il motore già conta', () => {
    const { total, basis } = industrialCapacityTotal({ factories: 3, ports: 2, universities: 5 });
    expect(total).toBe(3 * CAPACITY_PER_FACTORY + 2 * CAPACITY_PER_PORT + 5 * CAPACITY_PER_UNIVERSITY);
    expect(basis).toContain('3 fabbriche');
    expect(basis).toContain('2 porti');
    expect(basis).toContain('5 atenei');
  });

  it('senza impianti la capacità è zero e lo dichiara', () => {
    const { total, basis } = industrialCapacityTotal({ factories: 0, ports: 0, universities: 0 });
    expect(total).toBe(0);
    expect(basis).toBe('nessun impianto censito dal motore');
  });

  it('dati mancanti o negativi non creano capacità', () => {
    expect(industrialCapacityTotal({ factories: -4, ports: NaN as unknown as number, universities: 0 }).total).toBe(0);
  });
});

describe('domanda delle lavorazioni', () => {
  it('un ordine militare domanda capacità dalle requires della voce di catalogo', () => {
    // 'apc' richiede 2 fabbriche, dominio terra: max(4, 8) + 0 = 8.
    const allocation = militaryOrderAllocation({ id: 'ord-1', equipmentId: 'apc', name: 'Veicoli corazzati da trasporto', quantity: 4 });
    expect(allocation.capacityDemand).toBe(8);
    expect(allocation.kind).toBe('military_production');
    expect(allocation.label).toBe('Veicoli corazzati da trasporto ×4');
    expect(allocation.basis).toContain('2 fabbriche');
  });

  it('il dominio pesa: mare e missili costano più di terra', () => {
    const land = militaryOrderAllocation({ id: 'a', equipmentId: 'apc' });
    const naval = militaryOrderAllocation({ id: 'b', equipmentId: 'cacciatorpediniere' });
    expect(naval.capacityDemand).toBeGreaterThan(land.capacityDemand);
    expect(naval.sector).toContain('mare');
  });

  it('la quantità non moltiplica la capacità occupata: la linea resta occupata', () => {
    const one = militaryOrderAllocation({ id: 'a', equipmentId: 'apc', quantity: 1 });
    const many = militaryOrderAllocation({ id: 'a', equipmentId: 'apc', quantity: 500 });
    expect(one.capacityDemand).toBe(many.capacityDemand);
  });

  it('nessuna lavorazione può occupare tutto l’impianto', () => {
    const allocation = militaryOrderAllocation({ id: 'a', equipmentId: 'cacciatorpediniere' });
    expect(allocation.capacityDemand).toBeLessThanOrEqual(MAX_ALLOCATION_PER_ITEM);
  });

  it('una voce sconosciuta non inventa requisiti', () => {
    const allocation = militaryOrderAllocation({ id: 'a', equipmentId: 'non-esiste', name: 'Ignoto' });
    expect(allocation.capacityDemand).toBe(4);
    expect(allocation.sector).toBe('militare');
  });

  it('i progetti domandano capacità sul lavoro residuo', () => {
    const start = projectAllocation({ id: 'p1', title: 'Ferrovia', started_date: '2026-01-01', expected_date: '2026-07-01', progress: 0 });
    const end = projectAllocation({ id: 'p1', title: 'Ferrovia', started_date: '2026-01-01', expected_date: '2026-07-01', progress: 90 });
    expect(start.capacityDemand).toBeGreaterThan(end.capacityDemand);
    expect(start.basis).toContain('6 mesi');
  });

  it('un progetto senza date resta una lavorazione minima, non zero', () => {
    const allocation = projectAllocation({ id: 'p1', title: 'Progetto' });
    expect(allocation.capacityDemand).toBeGreaterThanOrEqual(1);
  });

  it('la manutenzione domanda capacità dalle unità dichiarate dal catalogo', () => {
    const allocation = maintenanceAllocation({ facilityId: 'f1', typeName: 'Acciaieria', baseUnits: '40', periodDays: 30 })!;
    expect(allocation.capacityDemand).toBe(5);
    expect(allocation.sector).toBe('Manutenzione impianti');
    expect(allocation.basis).toContain('40 unità');
  });

  it('un impianto fermo non occupa linee', () => {
    expect(maintenanceAllocation({ facilityId: 'f1', baseUnits: '40', operational: false })).toBeNull();
    // Una manutenzione senza unità dichiarate non è un lavoro.
    expect(maintenanceAllocation({ facilityId: 'f1', baseUnits: '0' })).toBeNull();
  });
});

describe('quadro completo', () => {
  const base = { factories: 2, ports: 0, universities: 0 };

  it('somma le lavorazioni e calcola occupazione e quote', () => {
    const capacity = industrialCapacityOf({
      ...base,
      orders: [{ id: 'ord-1', equipmentId: 'apc', quantity: 2 }],
      projects: [{ id: 'p1', title: 'Ferrovia', started_date: '2026-01-01', expected_date: '2026-03-01' }],
    });
    expect(capacity.total).toBe(20);
    expect(capacity.allocations).toHaveLength(2);
    expect(capacity.byKind.military_production).toBe(8);
    expect(capacity.used).toBe(capacity.demand);
    expect(capacity.free).toBe(capacity.total - capacity.used);
    expect(capacity.saturated).toBe(false);
    expect(capacity.overflowFactor).toBe(1);
    expect(capacity.satisfactionPct).toBe(100);
    expect(capacity.utilizationPct).toBeGreaterThan(0);
  });

  it('gli ordini conclusi o falliti non occupano più linee', () => {
    const capacity = industrialCapacityOf({
      ...base,
      orders: [
        { id: 'ord-1', equipmentId: 'apc', status: 'in_progress' },
        { id: 'ord-2', equipmentId: 'apc', status: 'completed' },
        { id: 'ord-3', equipmentId: 'apc', status: 'failed' },
      ],
    });
    expect(capacity.allocations.map(allocation => allocation.id)).toEqual(['ord-1']);
  });

  it('quando la domanda supera la capacità l’industria è satura e il lavoro rallenta', () => {
    const capacity = industrialCapacityOf({
      ...base,
      orders: [
        { id: 'a', equipmentId: 'cacciatorpediniere' },
        { id: 'b', equipmentId: 'cacciatorpediniere' },
        { id: 'c', equipmentId: 'cacciatorpediniere' },
        { id: 'd', equipmentId: 'cacciatorpediniere' },
      ],
    });
    expect(capacity.demand).toBeGreaterThan(capacity.total);
    expect(capacity.used).toBe(capacity.total);
    expect(capacity.free).toBe(0);
    expect(capacity.saturated).toBe(true);
    expect(capacity.overflowFactor).toBeLessThan(1);
    expect(capacity.overflowFactor).toBeGreaterThanOrEqual(0.25);
    expect(capacity.satisfactionPct).toBeLessThan(100);
  });

  it('il fattore di rallentamento non scende sotto un quarto (nessuna paralisi)', () => {
    const orders = Array.from({ length: 200 }, (_, index) => ({ id: `o${index}`, equipmentId: 'cacciatorpediniere' }));
    const capacity = industrialCapacityOf({ factories: 1, ports: 0, universities: 0, orders });
    expect(capacity.overflowFactor).toBe(0.25);
  });

  it('senza impianti nessuno lavora: capacità zero e fattore al minimo', () => {
    const capacity = industrialCapacityOf({
      factories: 0, ports: 0, universities: 0,
      orders: [{ id: 'a', equipmentId: 'apc' }],
    });
    expect(capacity.total).toBe(0);
    expect(capacity.used).toBe(0);
    expect(capacity.utilizationPct).toBe(0);
    expect(capacity.saturated).toBe(true);
    expect(capacity.overflowFactor).toBe(0.25);
  });

  it('senza lavorazioni la capacità è tutta libera', () => {
    const capacity = industrialCapacityOf({ ...base });
    expect(capacity.demand).toBe(0);
    expect(capacity.used).toBe(0);
    expect(capacity.free).toBe(capacity.total);
    expect(capacity.utilizationPct).toBe(0);
    expect(capacity.saturated).toBe(false);
    expect(capacity.satisfactionPct).toBe(100);
    expect(capacity.defenceSharePct).toBe(0);
  });

  it('la quota della difesa dice quanto dell’industria è militare', () => {
    const capacity = industrialCapacityOf({
      ...base,
      orders: [{ id: 'a', equipmentId: 'apc' }],
      projects: [{ id: 'p1', title: 'Ferrovia', started_date: '2026-01-01', expected_date: '2026-03-01' }],
    });
    expect(capacity.defenceSharePct).toBe(Math.round(8 / capacity.demand * 1000) / 10);
  });

  it('è deterministico: due chiamate identiche danno lo stesso quadro', () => {
    const input = {
      ...base,
      orders: [{ id: 'a', equipmentId: 'apc' }],
      projects: [{ id: 'p1', title: 'Ferrovia', started_date: '2026-01-01', expected_date: '2026-04-01' }],
      maintenance: [{ facilityId: 'f1', baseUnits: '24', periodDays: 30 }],
    };
    expect(industrialCapacityOf(input)).toEqual(industrialCapacityOf(input));
  });
});
