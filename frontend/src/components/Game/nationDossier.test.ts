import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { financeBalance, hasNationalFinance, normalizeResources, summarizeNationalAssets } from './nationDossier';

const region = (id: string, objects: string[] = []): Region => ({
  id,
  name: id,
  color: '#123456',
  owner: 'USA',
  population: 10,
  gdp: 4,
  militaryPower: 0,
  objects: objects.map((type, index) => ({ id: `${id}-${index}`, type } as any)),
  borders: [],
  status: 'normal' as Region['status'],
  metadata: {},
});

describe('nationDossier (G5-A)', () => {
  it('usa il conto nazionale quando il motore pubblica una capacità', () => {
    const assets = summarizeNationalAssets([region('a', ['factory', 'port'])], {
      provinces: 12, population: 99, nominalGdpUsdBillions: 88,
      factories: 7, ports: 3, universities: 2, forces: 5,
    });
    expect(assets).toMatchObject({ provinces: 12, population: 99, gdpBillions: 88, factories: 7, ports: 3, universities: 2, forces: 5 });
  });

  it('usa solo la mappa autorevole come fallback, senza stimare risorse', () => {
    const assets = summarizeNationalAssets([
      region('a', ['factory', 'city', 'army']),
      region('b', ['factory', 'port', 'capital', 'battalion', 'university']),
    ]);
    expect(assets).toEqual({ provinces: 2, population: 20, gdpBillions: 8, factories: 2, ports: 1, universities: 1, forces: 2, cities: 2 });
  });

  it('riconosce le voci finanziarie pubblicate e rispetta il saldo dichiarato', () => {
    expect(hasNationalFinance({ monthlyRevenue: 0 })).toBe(true);
    expect(financeBalance({ monthlyRevenue: 8, monthlyExpenses: 3 })).toBe(5);
    expect(financeBalance({ monthlyRevenue: 8, monthlyExpenses: 3, monthlyBalance: -1 })).toBe(-1);
    expect(hasNationalFinance({})).toBe(false);
  });

  it('legge la tesoreria dal magazzino annidato: mai zero per un valore annidato', () => {
    const flat = normalizeResources({
      stock: { money: 185.85, food: 20.87, clothing: 12, weapons: 160, fuel: 90, research: 40, technologies: ['ferrovie'] },
      natural: [{ kind: 'diamonds' }],
      market: [{ kind: 'diamonds' }],
      debt: 4.2, creditLimit: 49.92, creditHeadroom: 45.72,
      modifiers: { stability: -12 },
    });
    expect(flat).toMatchObject({ money: 185.85, food: 20.87, clothing: 12, weapons: 160, fuel: 90, research: 40, debt: 4.2, creditLimit: 49.92, creditHeadroom: 45.72 });
    expect(flat?.technologies).toEqual(['ferrovie']);
    expect(flat?.natural).toHaveLength(1);
    expect(flat?.modifiers).toEqual({ stability: -12 });
  });

  it('accetta anche la forma già piatta e ignora i valori non numerici', () => {
    const flat = normalizeResources({ money: 10, food: 'x', weapons: null, natural: 'no' });
    expect(flat?.money).toBe(10);
    expect(flat?.food).toBeUndefined();
    expect(flat?.weapons).toBeUndefined();
    expect(flat?.natural).toBeUndefined();
    expect(normalizeResources(null)).toBeNull();
    expect(normalizeResources('x')).toBeNull();
  });
});
