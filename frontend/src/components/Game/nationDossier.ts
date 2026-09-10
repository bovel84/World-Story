import type { Region } from '../../types';
import type { NationAccount } from './NationDock';

export interface NationalProcess {
  id: string;
  title: string;
  summary: string;
  started_date: string;
  expected_date?: string | null;
}

export interface NationalAssets {
  provinces: number;
  population: number;
  gdpBillions: number;
  factories: number;
  ports: number;
  universities: number;
  forces: number;
  cities: number;
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const objectCount = (regions: Region[], types: string[]): number =>
  regions.reduce((total, region) => total + (region.objects || []).filter((object) => types.includes(object.type)).length, 0);

/**
 * G5-A — Sintesi read-only del dossier nazionale.
 * Il conto aggregato del motore prevale quando dichiara un campo; la mappa è
 * solo il fallback per le capacità territoriali che il conto non pubblica.
 */
export function summarizeNationalAssets(regions: Region[], account?: NationAccount | null): NationalAssets {
  const populationFromMap = regions.reduce((total, region) => total + Number(region.population || 0), 0);
  const gdpFromMap = regions.reduce((total, region) => total + Number(region.gdp || 0), 0);
  const provinces = finiteNumber(account?.provinces) ?? regions.length;

  return {
    provinces,
    population: finiteNumber(account?.population) ?? populationFromMap,
    gdpBillions: finiteNumber(account?.nominalGdpUsdBillions) ?? gdpFromMap,
    factories: finiteNumber(account?.factories) ?? objectCount(regions, ['factory']),
    ports: finiteNumber(account?.ports) ?? objectCount(regions, ['port']),
    universities: finiteNumber(account?.universities) ?? objectCount(regions, ['university', 'academy']),
    forces: finiteNumber(account?.forces) ?? objectCount(regions, ['army', 'battalion', 'fleet']),
    cities: objectCount(regions, ['city', 'capital']),
  };
}

/** Il motore pubblica un bilancio soltanto quando dichiara almeno una voce. */
export function hasNationalFinance(account?: NationAccount | null): boolean {
  return [account?.monthlyRevenue, account?.monthlyExpenses, account?.monthlyBalance, account?.annualGrowthRate]
    .some((value) => finiteNumber(value) !== undefined);
}

export function financeBalance(account?: NationAccount | null): number {
  const declared = finiteNumber(account?.monthlyBalance);
  if (declared !== undefined) return declared;
  return Number(account?.monthlyRevenue || 0) - Number(account?.monthlyExpenses || 0);
}
