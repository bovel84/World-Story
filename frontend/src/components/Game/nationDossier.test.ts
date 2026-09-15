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
    expect(assets).toEqual({
      provinces: 2, population: 20, gdpBillions: 8, factories: 2, ports: 1, universities: 1, forces: 2, cities: 2,
      baseFactories: 0, basePorts: 0, baseUniversities: 0, baseForces: 0, capacitySources: undefined,
    });
  });

  it('espone la quota di disponibilità che deriva dal profilo del paese', () => {
    const assets = summarizeNationalAssets([region('a', ['factory'])], {
      factories: 6, ports: 2, universities: 3, forces: 4,
      capacityBase: { factories: 5, ports: 2, universities: 3, forces: 4 },
      capacitySources: 'PIL 20 mld, 2,7 milioni di abitanti, 4 province costiere',
    });
    expect(assets.baseFactories).toBe(5);
    expect(assets.basePorts).toBe(2);
    expect(assets.baseUniversities).toBe(3);
    expect(assets.baseForces).toBe(4);
    expect(assets.capacitySources).toContain('PIL 20 mld');
    // Conteggio assente: nessuna base inventata dal client.
    expect(summarizeNationalAssets([]).baseFactories).toBe(0);
    expect(summarizeNationalAssets([]).capacitySources).toBeUndefined();
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
      debts: [{ id: 'debt-1', label: 'Titolo 10 anni', principal: 4.2, annualRatePct: 3.1, issuedDate: '1951-01-01', maturityDate: '1961-01-01', termYears: 10 }],
      overdraft: 0, annualInterest: 0.13, averageMaturityYears: 10, debtRatioPct: 18.6, marketRatePct: 3.1,
      modifiers: { stability: -12 },
    });
    expect(flat).toMatchObject({ money: 185.85, food: 20.87, clothing: 12, weapons: 160, fuel: 90, research: 40, debt: 4.2, creditLimit: 49.92, creditHeadroom: 45.72 });
    expect(flat?.technologies).toEqual(['ferrovie']);
    expect(flat?.natural).toHaveLength(1);
    expect(flat?.debts).toHaveLength(1);
    expect(flat?.debtRatioPct).toBe(18.6);
    expect(flat?.annualInterest).toBe(0.13);
    expect(flat?.averageMaturityYears).toBe(10);
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
