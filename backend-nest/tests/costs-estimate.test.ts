import { describe, expect, it } from 'vitest';
import { estimateIntentCosts, type CostEstimate } from '../src/core/feasibility/costs';
import type { OrderIntent } from '../src/core/feasibility/intent';
import type { SimulationCatalog } from '../src/scenario/types';

const catalog = {
  resources: [
    { id: 'iron_ore', name: 'Minerale di ferro', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true },
    { id: 'coal', name: 'Carbone', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true },
    { id: 'steel', name: 'Acciaio', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true },
  ],
  recipes: [
    {
      id: 'r_steel',
      name: 'Conversione in acciaio',
      facilityTypeId: 'ft_foundry',
      inputs: [
        { resourceId: 'iron_ore', baseUnits: '60' },
        { resourceId: 'coal', baseUnits: '40' },
      ],
      outputs: [{ resourceId: 'steel', baseUnits: '50' }],
      durationDays: 3,
    },
  ],
  facilityTypes: [
    {
      id: 'ft_foundry',
      name: 'Altoforno',
      capacity: { unit: 'kg/giorno', perDay: '80' },
      maintenance: { resourceId: 'coal', baseUnits: '5', periodDays: 30 },
    },
  ],
} as unknown as SimulationCatalog;

function intent(overrides: Partial<OrderIntent>): OrderIntent {
  return {
    id: 'o1',
    actorPolityId: 'A',
    originalText: 'testo',
    actionKind: 'produce',
    targetIds: ['plant'],
    catalogRef: 'r_steel',
    priority: 0,
    dependencyIds: [],
    authorization: { allowPartialStart: false, allowedPhaseIds: [] },
    ...overrides,
  } as OrderIntent;
}

describe('estimateIntentCosts (G4-D — stima da catalogo, sola lettura)', () => {
  it('ricetta: proietta input materiali e durata autorevole', () => {
    const estimate: CostEstimate = estimateIntentCosts(catalog, intent({}));
    expect(estimate.basis).toBe('recipe');
    expect(estimate.timeDays).toBe(3);
    expect(estimate.inputs).toEqual([
      { resourceId: 'iron_ore', name: 'Minerale di ferro', quantity: '60', unit: 'kg' },
      { resourceId: 'coal', name: 'Carbone', quantity: '40', unit: 'kg' },
    ]);
    expect(estimate.upkeep).toHaveLength(0);
  });

  it('quantità richiesta scala i consumi per eccesso (2 cicli → 120/80)', () => {
    const estimate = estimateIntentCosts(catalog, intent({
      quantity: { resourceId: 'steel', baseUnits: '100' },
    }));
    // 100/50 = 2 cicli esatti: 60*2=120 minerale, 40*2=80 carbone.
    expect(estimate.inputs.map(l => l.quantity)).toEqual(['120', '80']);
    expect(estimate.timeDays).toBe(3);
  });

  it('quantità frazionaria arrotonda per eccesso (60 richiesti → 2 cicli)', () => {
    const estimate = estimateIntentCosts(catalog, intent({
      quantity: { resourceId: 'steel', baseUnits: '60' },
    }));
    // 60/50 = 1 ciclo intero + resto → ceil = 2 cicli.
    expect(estimate.inputs.map(l => l.quantity)).toEqual(['120', '80']);
  });

  it('quantità di risorsa diversa dal prodotto non scala (fattore 1)', () => {
    const estimate = estimateIntentCosts(catalog, intent({
      quantity: { resourceId: 'coal', baseUnits: '999' },
    }));
    expect(estimate.inputs.map(l => l.quantity)).toEqual(['60', '40']);
  });

  it('construct: espone il mantenimento dichiarato dell\'impianto', () => {
    const estimate = estimateIntentCosts(catalog, intent({
      actionKind: 'construct',
      catalogRef: 'ft_foundry',
      targetIds: ['r1', 'r2'],
      quantity: undefined,
    }));
    expect(estimate.basis).toBe('upkeep');
    expect(estimate.timeDays).toBe(0);
    expect(estimate.upkeep).toHaveLength(1);
    expect(estimate.upkeep[0]?.line).toMatchObject({ resourceId: 'coal', quantity: '5', unit: 'kg' });
    expect(estimate.upkeep[0]?.periodDays).toBe(30);
  });

  it('procure: la richiesta esplicita è il consumo da sostenere', () => {
    const estimate = estimateIntentCosts(catalog, intent({
      actionKind: 'procure',
      targetIds: ['lot', 'from', 'to'],
      catalogRef: undefined,
      quantity: { resourceId: 'coal', baseUnits: '25' },
    }));
    expect(estimate.basis).toBe('request');
    expect(estimate.inputs).toEqual([
      { resourceId: 'coal', name: 'Carbone', quantity: '25', unit: 'kg' },
    ]);
  });

  it('policy e ricerca non inventano consumi (basis none)', () => {
    for (const actionKind of ['policy', 'research', 'qualitative'] as const) {
      const estimate = estimateIntentCosts(catalog, intent({
        actionKind,
        catalogRef: undefined,
        targetIds: actionKind === 'qualitative' ? [] : ['x'],
        quantity: undefined,
      }));
      expect(estimate).toEqual({ timeDays: 0, inputs: [], upkeep: [], basis: 'none' });
    }
  });

  it('catalogRef ignoto produce stima vuota senza errori', () => {
    const estimate = estimateIntentCosts(catalog, intent({ catalogRef: 'r_inesistente' }));
    expect(estimate.basis).toBe('none');
    expect(estimate.inputs).toHaveLength(0);
  });
});