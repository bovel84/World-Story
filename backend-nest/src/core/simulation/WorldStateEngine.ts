import { estimatedNominalGdpUsdBillions, governmentForPolity, referenceDebtToGdpPct } from '../../utils/country-facts';
import { baselineCapacity, coastalFromGeojson } from './NationCapacity';
import { MAX_JUMP_DAYS } from './calendar';

/**
 * Deterministic long-term state for World Story.
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
  /** Provincia con sbocco al mare: abilita i porti di base del paese. */
  coastal?: boolean;
  /** GeoJSON della provincia: usato solo per dedurre la costa se `coastal` manca. */
  geojson?: string | null;
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
  /** Riserve richiamate ma non ancora operative (oggetti "mobilization"). */
  mobilized: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyBalance: number;
  annualGrowthRate: number;
  stability: number;
  /** Spesa militare in percentuale del PIL nominale (0-100). */
  defenceBurdenPct: number;
  /**
   * Debito pubblico lordo in percentuale del PIL (0-100+), dal registro reale.
   * È il carico che la nazione eredita: la tesoreria di partenza è la posizione
   * netta (riserve − debito) e il tetto di credito garantisce un margine.
   * Resta 0 nei mondi storici, dove il debito 2024 sarebbe anacronistico.
   */
  debtBurdenPct?: number;
  /**
   * Rapporto debito/PIL effettivo al momento della lettura (titoli emessi +
   * scoperto di cassa): cresce quando la nazione fa nuovo debito. È questo che
   * pesa su tensione e stabilità e che le fazioni vedono.
   */
  debtRatioPct?: number;
  /** Interessi passivi annui sul debito in % delle entrate pubbliche. */
  debtServicePct?: number;
  /** Indice 0-100 dello sforzo bellico materiale (forze + riserve richiamate). */
  warEffort: number;
  /** Indice 0-100 di tensione sociale interna (mobilitazione, casse, università). */
  socialTension: number;
  /** Scala nominale comparabile fra paesi (miliardi USD): fatti 2024 nei mondi
   *  moderni, indice di mappa su scala storica nei mondi pre-1990. */
  nominalGdpUsdBillions: number;
  gdpPerCapitaUsd: number;
  government: string;
  /** Forza dell'arsenale (quantità × qualità × dominio), se calcolata. */
  arsenalStrength?: number;
  /** Fattore di combattimento dell'arsenale (0.6-1.6), se calcolato. */
  arsenalCombatFactor?: number;
  /** Potenza militare effettiva = potenza di mappa × fattore arsenale. */
  effectiveMilitaryPower?: number;
  /**
   * Quota di fabbriche, cantieri, atenei e reparti che deriva dal profilo del
   * paese (PIL, abitanti, costa, potenza militare) e non dagli oggetti della
   * mappa: la disponibilità dipende dalla nazione, e il Dossier può dirlo.
   */
  capacityBase?: { factories: number; ports: number; universities: number; forces: number };
  /** Frase leggibile sulle fonti del profilo di capacità. */
  capacitySources?: string;
}

export interface WorldStateTick {
  accounts: Record<string, NationalAccount>;
  changedRegions: string[];
}

const finiteNonNegative = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

/** Opzioni della lettura dei conti nazionali. */
export interface WorldStateOptions {
  /**
   * Fatti 2024 applicabili (PIL, popolazione di riferimento, debito pubblico).
   * `false` per i preset pre-1990: il motore usa solo i dati della mappa, così
   * un mondo del 1951 non eredita PIL e debito odierni.
   */
  modernFacts?: boolean;
  /**
   * Data di partenza dello scenario (ISO). Serve alla tabella di conversione
   * storica per scegliere il PIL dell'epoca giusta (1939, 1951…).
   */
  startDate?: string | null;
}

/** Calculates and advances only facts that are derivable from the map. */
export class WorldStateEngine {
  static accounts(
    regions: Iterable<WorldStateRegion>,
    options: WorldStateOptions = {},
  ): Record<string, NationalAccount> {
    const modernFacts = options.modernFacts !== false;
    const accounts: Record<string, NationalAccount> = Object.create(null);
    // Province costiere per polity: i porti sono geografia, non popolazione.
    const coastalProvinces: Record<string, number> = Object.create(null);
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
        mobilized: 0,
        monthlyRevenue: 0,
        monthlyExpenses: 0,
        monthlyBalance: 0,
        annualGrowthRate: 0,
        stability: 50,
        defenceBurdenPct: 0,
        debtBurdenPct: 0,
        warEffort: 0,
        socialTension: 0,
        nominalGdpUsdBillions: 0,
        gdpPerCapitaUsd: 0,
        government: governmentForPolity(polityId),
      };
      account.provinces++;
      account.population += finiteNonNegative(region.population);
      account.gdp += finiteNonNegative(region.gdp);
      account.militaryPower += finiteNonNegative(region.militaryPower);
      const coastal = region.coastal ?? coastalFromGeojson(region.id, region.geojson);
      if (coastal) coastalProvinces[polityId] = (coastalProvinces[polityId] || 0) + 1;
      // One scan of map objects, with no temporary arrays per asset type.
      for (const object of region.objects || []) {
        const level = Math.max(1, finiteNonNegative(object.level));
        switch (object.type) {
          case 'factory': account.factories += level; break;
          case 'port': account.ports += level; break;
          case 'university': account.universities += level; break;
          case 'army': case 'battalion': case 'fleet': case 'missile': account.forces += level; break;
          case 'mobilization': account.mobilized += level; break;
        }
      }
    }

    for (const account of Object.values(accounts)) {
      // La base nazionale (popolazione, reddito, costa, forze) si somma agli
      // oggetti della mappa: senza di essa ogni paese senza impianti disegnati
      // avrebbe disponibilità identiche e pari a zero.
      const baseline = baselineCapacity({
        polityId: account.polityId,
        population: account.population,
        coastalProvinces: coastalProvinces[account.polityId] || 0,
        militaryPower: account.militaryPower,
        modernFacts,
        gdpIndex: account.gdp,
        startDate: options.startDate,
      });
      account.factories += baseline.factories;
      account.ports += baseline.ports;
      account.universities += baseline.universities;
      account.forces += baseline.forces;
      account.capacityBase = {
        factories: baseline.factories, ports: baseline.ports,
        universities: baseline.universities, forces: baseline.forces,
      };
      account.capacitySources = baseline.sources;
      // Infrastructure affects productive capacity, but is capped so a map
      // full of objects cannot make an economy explode exponentially. Una
      // nazione che richiama riserve comprime la crescita civile: l'economia
      // di guerra sottrae manodopera e capitali ai settori produttivi.
      const baseGrowth = Math.min(
        0.065,
        0.012 + account.factories * 0.0018 + account.ports * 0.001 + account.universities * 0.0012,
      );
      const warDrag = 1 - Math.min(0.45, account.mobilized * 0.035 + account.forces * 0.004);
      account.annualGrowthRate = Math.max(0, baseGrowth * warDrag);
      // I valori provinciali sono un indice di simulazione; entrate e uscite
      // usano invece una scala nominale comparabile (miliardi USD), così il
      // bollettino non dipende dal numero di province di una nazione.
      account.nominalGdpUsdBillions = estimatedNominalGdpUsdBillions(account.polityId, account.population, {
        modernFacts,
        gdpIndex: account.gdp,
        startDate: options.startDate,
      });
      account.gdpPerCapitaUsd = Math.round(account.nominalGdpUsdBillions * 1_000_000_000 / Math.max(account.population, 1));
      const taxRate = Math.min(0.18, 0.09 + account.factories * 0.00035 + account.ports * 0.0002);
      account.monthlyRevenue = account.nominalGdpUsdBillions * taxRate / 12;
      // Le riserve richiamate costano denaro prima ancora di essere operative:
      // la spesa militare cresce con forze e mobilitazioni e comprime il saldo.
      const defenceRate = Math.min(
        0.16,
        0.012 + account.forces * 0.0007 + account.mobilized * 0.0018
          + (account.militaryPower / Math.max(account.nominalGdpUsdBillions, 1)) * 0.004,
      );
      account.defenceBurdenPct = Math.round(defenceRate * 1000) / 10;
      // Il debito pubblico è un fatto ereditato dalla storia del paese, non
      // qualcosa che nasce a zero. Solo nei mondi moderni però: applicare il
      // debito 2024 a una partita del 1951 sarebbe anacronistico, quindi lì si
      // parte da zero e la nazione costruisce il proprio debito giocando.
      account.debtBurdenPct = modernFacts ? referenceDebtToGdpPct(account.polityId) : 0;
      account.monthlyExpenses = account.nominalGdpUsdBillions * (0.032 + defenceRate) / 12;
      account.monthlyBalance = account.monthlyRevenue - account.monthlyExpenses;
      // A transparent, bounded indicator rather than an LLM-invented value.
      // Le riserve richiamate pesano sul consenso (logoramento), non solo sull'esercito.
      account.stability = Math.round(Math.max(0, Math.min(100,
        48 + Math.min(24, account.monthlyBalance / Math.max(account.nominalGdpUsdBillions, 1) * 900)
        + Math.min(12, account.universities * 0.8)
        - Math.min(20, account.forces * 0.35)
        - Math.min(20, account.mobilized * 3.2),
      )));
      const forceLoad = account.forces + account.mobilized * 0.6;
      account.warEffort = Math.round(Math.max(0, Math.min(100, forceLoad * 3.2 + account.defenceBurdenPct * 2.2)));
      const deficitRatio = account.monthlyBalance < 0
        ? Math.min(12, (-account.monthlyBalance) / Math.max(account.nominalGdpUsdBillions, 1) * 700)
        : 0;
      account.socialTension = Math.round(Math.max(0, Math.min(100,
        16 + account.mobilized * 6 + account.forces * 1.4 - account.universities * 1.1 + deficitRatio,
      )));
    }
    return accounts;
  }

  /** Advance population, productive output and peacetime readiness. */
  static advance(
    regions: Iterable<WorldStateRegion>,
    days: number,
    options: WorldStateOptions = {},
  ): WorldStateTick {
    if (!Number.isInteger(days) || days < 0 || days > MAX_JUMP_DAYS) throw new Error('Invalid economic period');
    const yearFraction = days / 365;
    const list = Array.from(regions);
    const before = this.accounts(list, options);
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
    return { accounts: this.accounts(list, options), changedRegions };
  }

  static playerBulletin(account: NationalAccount | undefined): string | null {
    if (!account) return null;
    const money = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
    const sign = account.monthlyBalance >= 0 ? '+' : '−';
    return `Quadro nazionale: ${account.government}; popolazione ${money(account.population)}; PIL nominale stimato $${money(account.nominalGdpUsdBillions)} mld (circa $${money(account.gdpPerCapitaUsd)} pro capite). Bilancio mensile: entrate ${money(account.monthlyRevenue)}, uscite ${money(account.monthlyExpenses)}, saldo ${sign}${money(Math.abs(account.monthlyBalance))} (spesa militare ${money(account.defenceBurdenPct)}% del PIL). Crescita annua ${Math.round(account.annualGrowthRate * 1000) / 10}%, stabilità ${account.stability}/100. Riserve mobilitate: ${money(account.mobilized)}; sforzo bellico ${account.warEffort}/100; tensione sociale ${account.socialTension}/100.`;
  }
}
