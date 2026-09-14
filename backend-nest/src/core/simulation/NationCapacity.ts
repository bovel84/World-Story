/**
 * Capacità nazionale di base — da che cosa un paese è *disponibile*.
 * ==================================================================
 * Industria, università, cantieri e reparti non possono essere uguali per
 * tutti: una nazione di 41 milioni di abitanti a reddito basso non ha la stessa
 * base industriale di un paese ricco di 60 milioni. Prima di questo modulo la
 * capacità veniva **solo** dagli oggetti disegnati sulla mappa (`factory`,
 * `port`, `university`, `army`): nelle mappe che non li contengono tutte le
 * nazioni risultavano a zero — disponibilità identiche e quindi inutili.
 *
 * Qui la base si deriva da fatti reali e verificabili:
 *  - **popolazione** (dimensione del paese, scala sublineare `sqrt`);
 *  - **reddito pro capite reale** (registro `country-facts`: PIL nominale noto
 *    per ~65 paesi, altrimenti fascia di reddito) → la ricchezza compra
 *    industria e ricerca;
 *  - **province costiere** (dal `surface_type` della mappa) → i porti sono
 *    geografia, non popolazione: un paese senza mare non ha cantieri;
 *  - **potenza militare** mappata dai reparti già presenti nel mondo.
 *
 * Tutto è deterministico e additivo rispetto agli oggetti della mappa: la base
 * è il profilo del paese, gli oggetti sono ciò che il gioco ha costruito.
 */

import { estimatedNominalGdpUsdBillions } from '../../utils/country-facts';

export interface CapacityInput {
  polityId: string;
  population: number;
  /** Province con sbocco al mare (o isole): i porti sono geografia. */
  coastalProvinces: number;
  militaryPower: number;
}

export interface CapacityBaseline {
  factories: number;
  ports: number;
  universities: number;
  forces: number;
  /** Reddito pro capite usato (USD) e fascia di ricchezza applicata. */
  incomePerCapitaUsd: number;
  wealthTier: number;
  /** Scala demografica applicata (`sqrt` dei milioni di abitanti). */
  populationScale: number;
  /** Frase leggibile sulle fonti, mostrabile nel Dossier. */
  sources: string;
}

/** Tetto della base derivata: la mappa può aggiungere, la base non esplode. */
export const CAPACITY_LIMITS = { factories: 14, universities: 10, ports: 10, forces: 24 } as const;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const positive = (value: unknown) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);

/**
 * Fascia di ricchezza da reddito pro capite reale. Un paese ricco ha più
 * industria e più università a parità di abitanti.
 */
export function wealthTierFor(incomePerCapitaUsd: number): number {
  if (incomePerCapitaUsd >= 30_000) return 1.6;
  if (incomePerCapitaUsd >= 15_000) return 1.3;
  if (incomePerCapitaUsd >= 6_000) return 1.0;
  if (incomePerCapitaUsd >= 2_500) return 0.7;
  return 0.45;
}

/**
 * Scala economica del paese: radice del PIL nominale reale in centinaia di
 * miliardi (100 mld = 1). È il PIL — non la popolazione — a decidere quanta
 * industria e quanta ricerca una nazione può permettersi: un paese ricco e
 * piccolo batte un paese povero e grande.
 */
export function economicScaleFor(gdpBillions: number): number {
  return Math.sqrt(Math.max(0, gdpBillions) / 100);
}

/**
 * Profilo di capacità di base di una nazione. Stessa nazione e stessi dati ⇒
 * stesso risultato, sempre.
 */
export function baselineCapacity(input: CapacityInput): CapacityBaseline {
  const population = positive(input.population);
  const populationM = population / 1_000_000;
  const populationScale = Math.sqrt(populationM);
  const gdpBillions = estimatedNominalGdpUsdBillions(input.polityId, population);
  const incomePerCapitaUsd = population > 0 ? (gdpBillions * 1_000_000_000) / population : 0;
  const wealthTier = wealthTierFor(incomePerCapitaUsd);
  const economicScale = economicScaleFor(gdpBillions);
  const coastal = positive(input.coastalProvinces);
  const militaryPower = positive(input.militaryPower);

  return {
    // Industria: economia, corretta dal reddito (un paese ricco industrializza
    // di più a parità di PIL).
    factories: clamp(Math.round(economicScale * (0.9 + wealthTier * 0.45)), 0, CAPACITY_LIMITS.factories),
    // Ricerca: economia + popolazione (un paese grande ha più atenei).
    universities: clamp(Math.round(economicScale * 0.7 + populationScale * 0.3), 0, CAPACITY_LIMITS.universities),
    // Geografia: la radice delle province costiere evita che un arcipelago
    // diventi una flotta. Nessuno sbocco al mare ⇒ nessun cantiere.
    ports: coastal > 0 ? clamp(Math.round(Math.sqrt(coastal) * 1.2), 1, CAPACITY_LIMITS.ports) : 0,
    // Reparti: potenza militare del mondo + peso economico del paese.
    forces: clamp(Math.round(Math.log10(1 + militaryPower) * 3.2 + economicScale * 0.25), 0, CAPACITY_LIMITS.forces),
    incomePerCapitaUsd: Math.round(incomePerCapitaUsd),
    wealthTier,
    populationScale: Math.round(populationScale * 100) / 100,
    sources: describeCapacitySources({ population, coastal, wealthTier, incomePerCapitaUsd, gdpBillions }),
  };
}

/** Frase leggibile: da dove vengono i numeri (mostrata nel Dossier). */
export function describeCapacitySources(input: {
  population: number; coastal: number; wealthTier: number; incomePerCapitaUsd: number; gdpBillions: number;
}): string {
  const millions = (input.population / 1_000_000).toFixed(1).replace('.', ',');
  const number = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value);
  const wealth = input.wealthTier >= 1.6 ? 'reddito alto'
    : input.wealthTier >= 1.3 ? 'reddito medio-alto'
      : input.wealthTier >= 1 ? 'reddito medio'
        : input.wealthTier >= 0.7 ? 'reddito medio-basso' : 'reddito basso';
  const coast = input.coastal > 0
    ? `${number(input.coastal)} ${input.coastal === 1 ? 'provincia costiera' : 'province costiere'}`
    : 'nessuno sbocco al mare';
  return `PIL ${number(input.gdpBillions)} mld, ${millions} milioni di abitanti, ${number(input.incomePerCapitaUsd)} USD pro capite (${wealth}), ${coast}`;
}

/** Un `surface_type` costiero (o insulare) abilita i porti. */
const COASTAL_RE = /"surface_type"\s*:\s*"(Coastal|Ocean|Strait)"/;

/**
 * Rileva la costa dal GeoJSON della provincia. Il risultato è memorizzato per
 * id di provincia: le regioni non cambiano geometria, quindi il GeoJSON si
 * scandisce una sola volta per processo e non a ogni tick.
 */
const coastalCache = new Map<string, boolean>();
export function coastalFromGeojson(regionId: string, geojson?: string | null): boolean {
  const cached = coastalCache.get(regionId);
  if (cached !== undefined) return cached;
  const coastal = !!geojson && COASTAL_RE.test(geojson);
  // Una geometria assente non è una risposta definitiva: si memorizza solo
  // quando il GeoJSON c'era davvero.
  if (geojson) coastalCache.set(regionId, coastal);
  return coastal;
}

/** Solo per i test: la cache per id non deve attraversare casi diversi. */
export function resetCoastalCache(): void {
  coastalCache.clear();
}
