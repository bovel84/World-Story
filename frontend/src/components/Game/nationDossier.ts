import type { Region } from '../../types';
import type { NationAccount, NationResources } from './NationDock';

export interface NationalProcess {
  id: string;
  title: string;
  summary: string;
  started_date: string;
  expected_date?: string | null;
  /** Percentuale di completamento calcolata dal motore (0-100). */
  progress?: number | null;
  /** Nota del motore sull'avanzamento (ritardi, vincoli, difetti). */
  progress_note?: string | null;
}

/** Progetto già chiuso, mostrato nella sezione «Completati» del Dossier. */
export interface CompletedProcess {
  id: string;
  title: string;
  summary: string;
  started_date: string;
  expected_date?: string | null;
  /** Data (mondo) in cui il motore ha registrato la chiusura. */
  completed_date?: string | null;
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
  /**
   * Quota di ciascuna capacità che deriva dal profilo del paese (PIL,
   * abitanti, costa, potenza militare) invece che dagli oggetti della mappa.
   */
  baseFactories: number;
  basePorts: number;
  baseUniversities: number;
  baseForces: number;
  /** Frase del motore sulle fonti della disponibilità (PIL, abitanti, costa). */
  capacitySources?: string;
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
    baseFactories: finiteNumber(account?.capacityBase?.factories) ?? 0,
    basePorts: finiteNumber(account?.capacityBase?.ports) ?? 0,
    baseUniversities: finiteNumber(account?.capacityBase?.universities) ?? 0,
    baseForces: finiteNumber(account?.capacityBase?.forces) ?? 0,
    capacitySources: typeof account?.capacitySources === 'string' ? account.capacitySources : undefined,
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

/**
 * Normalizza il magazzino pubblicato dal motore nella forma piatta usata dal
 * Dossier. L'API `resources` annida le scorte in `stock`; altri payload le
 * espongono già piatte. Accettare entrambe le forme evita che la tesoreria
 * venga letta come zero quando il valore è semplicemente annidato.
 * Restituisce `null` solo se non c'è alcun magazzino da mostrare.
 */
export function normalizeResources(raw: unknown): NationResources | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, any>;
  const stock: Record<string, any> = source.stock && typeof source.stock === 'object' ? source.stock : source;
  const value = (input: unknown): number | undefined => {
    if (input === null || input === undefined || input === '') return undefined;
    return Number.isFinite(Number(input)) ? Number(input) : undefined;
  };
  const technologies = Array.isArray(source.technologies)
    ? source.technologies.filter((id: unknown): id is string => typeof id === 'string')
    : Array.isArray(stock.technologies)
      ? stock.technologies.filter((id: unknown): id is string => typeof id === 'string')
      : undefined;

  return {
    money: value(stock.money),
    food: value(stock.food),
    clothing: value(stock.clothing),
    weapons: value(stock.weapons),
    fuel: value(stock.fuel),
    research: value(stock.research),
    ...(technologies ? { technologies } : {}),
    ...(Array.isArray(source.natural) ? { natural: source.natural } : {}),
    ...(Array.isArray(source.market) ? { market: source.market } : {}),
    debt: value(source.debt),
    creditLimit: value(source.creditLimit),
    creditHeadroom: value(source.creditHeadroom),
    ...(Array.isArray(source.debts) ? { debts: source.debts } : {}),
    overdraft: value(source.overdraft),
    annualInterest: value(source.annualInterest),
    averageMaturityYears: value(source.averageMaturityYears),
    debtRatioPct: value(source.debtRatioPct),
    marketRatePct: value(source.marketRatePct),
    ...(source.capacity && typeof source.capacity === 'object' ? { capacity: source.capacity } : {}),
    ...(source.needs && typeof source.needs === 'object' ? { needs: source.needs } : {}),
    // Bilancio materiale del mese (MATERIEL-CLARITY): solo righe con un
    // materiale riconoscibile; il resto non viene inventato.
    ...(Array.isArray(source.balance)
      ? { balance: source.balance.filter((row: any) => row && typeof row === 'object' && typeof row.kind === 'string') }
      : {}),
    ...(source.modifiers && typeof source.modifiers === 'object' ? { modifiers: source.modifiers } : {}),
  };
}
