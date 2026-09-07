import { estimatedNominalGdpUsdBillions, governmentForPolity } from '../../utils/country-facts';
import { MAX_JUMP_DAYS } from './calendar';

/**
 * Deterministic long-term state for Open-Pax.
 *
 * This layer deliberately has no LLM dependency.  It turns the map state
 * (population, output and real objects) into national accounts and advances
 * the slow variables of the world between two dates.  Narrative systems may
 * describe these facts, but cannot create a second, contradictory economy.
 */

export interface WorldStateRegion {
  id: string;
  owner: string;
  population: number;
  gdp: number;
  militaryPower: number;
  objects?: Array<{ type?: string; level?: number }>;
  status?: string;
}

export interface NationalAccount {
  polityId: string;
  provinces: number;
  population: number;
  gdp: number;
  militaryPower: number;
  factories: number;
  ports: number;
  universities: number;
  forces: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyBalance: number;
  annualGrowthRate: number;
  stability: number;
  /** Scala nominale comparabile fra paesi (miliardi USD, stima 2024). */
  nominalGdpUsdBillions: number;
  gdpPerCapitaUsd: number;
  government: string;
}

export interface WorldStateTick {
  accounts: Record<string, NationalAccount>;
  changedRegions: string[];
}

const finiteNonNegative = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

/** Calculates and advances only facts that are derivable from the map. */
export class WorldStateEngine {
  static accounts(regions: Iterable<WorldStateRegion>): Record<string, NationalAccount> {
    const accounts: Record<string, NationalAccount> = Object.create(null);
    for (const region of regions) {
      const polityId = region.owner || 'neutral';
      const account = accounts[polityId] ||= {
        polityId,
        provinces: 0,
        population: 0,
        gdp: 0,
        militaryPower: 0,
        factories: 0,
        ports: 0,
        universities: 0,
        forces: 0,
        monthlyRevenue: 0,
        monthlyExpenses: 0,
        monthlyBalance: 0,
        annualGrowthRate: 0,
        stability: 50,
        nominalGdpUsdBillions: 0,
        gdpPerCapitaUsd: 0,
        government: governmentForPolity(polityId),
      };
      account.provinces++;
      account.population += finiteNonNegative(region.population);
      account.gdp += finiteNonNegative(region.gdp);
      account.militaryPower += finiteNonNegative(region.militaryPower);
      // One scan of map objects, with no temporary arrays per asset type.
      for (const object of region.objects || []) {
        const level = Math.max(1, finiteNonNegative(object.level));
        switch (object.type) {
          case 'factory': account.factories += level; break;
          case 'port': account.ports += level; break;
          case 'university': account.universities += level; break;
          case 'army': case 'battalion': case 'fleet': case 'missile': account.forces += level; break;
        }
      }
    }

    for (const account of Object.values(accounts)) {
      // Infrastructure affects productive capacity, but is capped so a map
      // full of objects cannot make an economy explode exponentially.
      account.annualGrowthRate = Math.min(
        0.065,
        0.012 + account.factories * 0.0018 + account.ports * 0.001 + account.universities * 0.0012,
      );
      // I valori provinciali sono un indice di simulazione; entrate e uscite
      // usano invece una scala nominale comparabile (miliardi USD), così il
      // bollettino non dipende dal numero di province di una nazione.
      account.nominalGdpUsdBillions = estimatedNominalGdpUsdBillions(account.polityId, account.population);
      account.gdpPerCapitaUsd = Math.round(account.nominalGdpUsdBillions * 1_000_000_000 / Math.max(account.population, 1));
      const taxRate = Math.min(0.18, 0.09 + account.factories * 0.00035 + account.ports * 0.0002);
      account.monthlyRevenue = account.nominalGdpUsdBillions * taxRate / 12;
      const defenceRate = Math.min(0.09, 0.012 + account.forces * 0.0007 + (account.militaryPower / Math.max(account.nominalGdpUsdBillions, 1)) * 0.004);
      account.monthlyExpenses = account.nominalGdpUsdBillions * (0.032 + defenceRate) / 12;
      account.monthlyBalance = account.monthlyRevenue - account.monthlyExpenses;
      // A transparent, bounded indicator rather than an LLM-invented value.
      account.stability = Math.round(Math.max(0, Math.min(100,
        48 + Math.min(24, account.monthlyBalance / Math.max(account.nominalGdpUsdBillions, 1) * 900)
        + Math.min(12, account.universities * 0.8)
        - Math.min(20, account.forces * 0.35),
      )));
    }
    return accounts;
  }

  /** Advance population, productive output and peacetime readiness. */
  static advance(regions: Iterable<WorldStateRegion>, days: number): WorldStateTick {
    if (!Number.isInteger(days) || days < 0 || days > MAX_JUMP_DAYS) throw new Error('Invalid economic period');
    const yearFraction = days / 365;
    const list = Array.from(regions);
    const before = this.accounts(list);
    if (days === 0) return { accounts: before, changedRegions: [] };
    const changedRegions: string[] = [];

    for (const region of list) {
      if (region.owner === 'neutral' || region.status === 'destroyed') continue;
      const account = before[region.owner || 'neutral'];
      if (!account) continue;
      const oldGDP = finiteNonNegative(region.gdp);
      const oldPopulation = finiteNonNegative(region.population);
      const oldMilitary = finiteNonNegative(region.militaryPower);
      // Keep precision internally: rounding 0.003 to cents destroyed small
      // province economies. Compounding gives the same outcome whether a
      // year is advanced in one step or in weekly ticks (unchanged rates).
      region.gdp = oldGDP * Math.pow(1 + account.annualGrowthRate, yearFraction);
      region.population = oldPopulation * Math.pow(1.008, yearFraction);
      // Readiness slowly decays without an explicit mobilisation order; do not
      // erase units, only their abstract military power.
      region.militaryPower = oldMilitary * Math.pow(0.9975, yearFraction);
      if (region.gdp !== oldGDP || region.population !== oldPopulation || region.militaryPower !== oldMilitary) {
        changedRegions.push(region.id);
      }
    }
    return { accounts: this.accounts(list), changedRegions };
  }

  static playerBulletin(account: NationalAccount | undefined): string | null {
    if (!account) return null;
    const money = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
    const sign = account.monthlyBalance >= 0 ? '+' : '−';
    return `Quadro nazionale: ${account.government}; popolazione ${money(account.population)}; PIL nominale stimato $${money(account.nominalGdpUsdBillions)} mld (circa $${money(account.gdpPerCapitaUsd)} pro capite). Bilancio mensile: entrate ${money(account.monthlyRevenue)}, uscite ${money(account.monthlyExpenses)}, saldo ${sign}${money(Math.abs(account.monthlyBalance))}. Crescita annua ${Math.round(account.annualGrowthRate * 1000) / 10}%, stabilità ${account.stability}/100.`;
  }
}
