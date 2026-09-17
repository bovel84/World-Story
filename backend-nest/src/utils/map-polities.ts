/**
 * MAP-COMPLETE — le politie di una mappa
 * ======================================
 * Il concetto di «nazioni giocabili» è abolito: TUTTE le entità presenti nella
 * sorgente geometrica (mappa propria del preset o mappa nativa) diventano
 * politie del mondo. Il preset non decide più *chi esiste*; decide solo chi ha
 * un nome storico, un colore curato e chi è **consigliato** al giocatore.
 *
 * Questo modulo costruisce quell'elenco in modo PURO e testabile, riusando le
 * fonti già presenti:
 *   1. codici e nomi visualizzati vengono dalle feature della mappa
 *      (`properties.country` per le province, altrimenti `properties.code`;
 *      nome da `nameEn`, poi `name`);
 *   2. i nomi/colori storici del preset (`countries`, `country_colors`) vincono;
 *   3. poi il nome italiano curato (`polityDisplayNameIt`) e il registro
 *      `data/countries.json` (nomi/colori ufficiali);
 *   4. da ultimo il nome della feature; il colore mancante è deterministico
 *      (`colorForPolity`) e comunque mai nero — vedi `resolveRegionColor`.
 *
 * `countries` = nomi/colori storici. `country_codes` = nazioni consigliate.
 */

import type { MapFeature } from './map-detail';
import { getCountry } from './countries';
import { colorForPolity } from './color';
import { polityDisplayNameIt } from './country-facts';
import { loadNativeMap, resolveMapSource, DEFAULT_NATIVE_MAP_ID } from './native-maps';
import { loadPresetMap } from './preset-loader';

export interface MapPolity {
  code: string;
  name: string;
  color: string;
}

/** Nome/colore storico dichiarato dal preset per un codice (nessun obbligo). */
export interface PolityOverride {
  code: string;
  name?: string;
  color?: string;
}

/**
 * Codici polity e nome della feature, nell'ordine della mappa. PURA.
 * Il codice è `properties.country` quando esiste ed è diverso da `properties.code`
 * (mappe provinciali: la provincia appartiene alla nazione-madre), altrimenti
 * `properties.code` (mappe nazionali). Le feature senza codice sono ignorate.
 */
export function polityEntriesFromFeatures(
  features: MapFeature[] | undefined,
): Array<{ code: string; featureName: string }> {
  const seen = new Map<string, string>();
  for (const feature of features ?? []) {
    const props = (feature?.properties || {}) as Record<string, unknown>;
    const parent = typeof props.country === 'string' ? props.country.trim() : '';
    const rawCode = typeof props.code === 'string' ? props.code.trim() : '';
    const isProvince = !!parent && parent !== rawCode;
    const code = isProvince ? parent : rawCode;
    if (!code) continue;
    // `nameEn` è il nome internazionale (la mappa standard usa `name` in russo).
    // Per una PROVINCIA `name` è il nome della provincia («Alaska»), non della
    // nazione: in quel caso solo `nameEn` è una fonte valida.
    const featureName = String(props.nameEn || (isProvince ? '' : props.name) || '').trim();
    if (!seen.has(code) || (!seen.get(code) && featureName)) seen.set(code, featureName);
  }
  return [...seen.entries()].map(([code, featureName]) => ({ code, featureName }));
}

/**
 * Dizionario codice → nome internazionale della mappa mondiale standard.
 * Riuso puro: serve solo a dare un nome alle entità che compaiono in una mappa
 * provinciale senza nome proprio (le province portano il nome della provincia,
 * non della nazione). Non introduce un secondo elenco di politie.
 */
let standardNamesCache: Map<string, string> | null = null;
function standardMapNames(): Map<string, string> {
  if (standardNamesCache) return standardNamesCache;
  const map = loadNativeMap(DEFAULT_NATIVE_MAP_ID);
  standardNamesCache = new Map(
    polityEntriesFromFeatures(map?.features).map(entry => [entry.code, entry.featureName]),
  );
  return standardNamesCache;
}

/**
 * Partizione delle feature della sorgente, con le STESSE regole della
 * generazione: `properties.country` (≠ `code`) → provincia della nazione-madre;
 * altrimenti la feature è nazionale e una polity occupa l'intera geometria.
 * Pura e testabile: serve a provare che ogni polity ha una geometria.
 */
export interface MapFeaturePartition {
  /** Una feature nazionale per codice polity. */
  countryFeatures: Record<string, MapFeature>;
  /** Province raggruppate per codice polity (nazione-madre). */
  provinceFeaturesByCountry: Record<string, MapFeature[]>;
}

export function partitionMapFeatures(features: MapFeature[] | undefined): MapFeaturePartition {
  const countryFeatures: Record<string, MapFeature> = {};
  const provinceFeaturesByCountry: Record<string, MapFeature[]> = {};
  for (const feature of features ?? []) {
    const props = (feature?.properties || {}) as Record<string, unknown>;
    const code = typeof props.code === 'string' ? props.code.trim() : '';
    if (!code) continue;
    const parent = typeof props.country === 'string' ? props.country.trim() : '';
    if (parent && parent !== code) {
      (provinceFeaturesByCountry[parent] ??= []).push(feature);
    } else {
      countryFeatures[code] = feature;
    }
  }
  return { countryFeatures, provinceFeaturesByCountry };
}

/**
 * Elenco completo e ordinato delle politie della mappa, con nome e colore
 * risolti. PURA: il registro è letto da `getCountry`, il resto è deterministico.
 */
export function buildMapPolities(
  entries: Array<{ code: string; featureName?: string }>,
  options: {
    /** Nomi/colori storici del preset (vincono su tutto). */
    curated?: PolityOverride[];
    /** Palette curata del preset (`country_colors`). */
    countryColors?: Record<string, string>;
  } = {},
): MapPolity[] {
  const curated = new Map((options.curated ?? []).map(entry => [entry.code, entry]));
  const polities: MapPolity[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const code = String(entry?.code || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const override = curated.get(code);
    const registry = getCountry(code);
    // «Nome italiano curato» ha la precedenza sul registro inglese; il registro
    // e il nome della feature fanno da ripiego (`polityDisplayNameIt` restituisce
    // il fallback quando il codice non è nel dizionario).
    const fallbackName = String(
      registry?.name || entry?.featureName || standardMapNames().get(code) || code,
    ).trim() || code;
    const name = String(override?.name || polityDisplayNameIt(code, fallbackName)).trim() || code;
    const curatedColor = options.countryColors?.[code];
    const color = String(
      override?.color || curatedColor || registry?.color || colorForPolity(code),
    ).trim();
    polities.push({ code, name, color });
  }

  polities.sort((a, b) => a.code.localeCompare(b.code));
  return polities;
}

/** Preset di cui serve l'elenco politie (campi geometrici + override storici). */
export interface PresetMapPolitySource {
  id: string;
  has_custom_map?: boolean;
  map_base?: unknown;
  countries?: PolityOverride[];
  country_colors?: Record<string, string>;
}

/** Politie di un preset a partire dalle feature già caricate. PURA. */
export function mapPolitiesFromFeatures(
  preset: PresetMapPolitySource,
  features: MapFeature[] | undefined,
): MapPolity[] {
  return buildMapPolities(polityEntriesFromFeatures(features), {
    curated: preset.countries,
    countryColors: preset.country_colors,
  });
}

/**
 * Politie di un preset caricando la sua sorgente geometrica con la stessa
 * precedenza della generazione (map.geojson proprio → `map_base` → standard).
 */
export function mapPolitiesForPreset(preset: PresetMapPolitySource): MapPolity[] {
  const source = resolveMapSource({ hasCustomMap: !!preset.has_custom_map, mapBase: preset.map_base });
  const geojson = source.kind === 'preset' ? loadPresetMap(preset.id) : loadNativeMap(source.id);
  return mapPolitiesFromFeatures(preset, geojson?.features);
}

/**
 * Codici delle politie che il preset cura (nome/colore storico) e consiglia:
 * `countries` del pacchetto se presente, altrimenti i `country_codes` legacy.
 * Sono gli unici a ricevere i dati dal modello; gli altri ricevono il baseline.
 */
export function curatedPolityCodes(preset: {
  countries?: PolityOverride[];
  country_codes?: string[];
}): string[] {
  const codes = preset.countries && preset.countries.length > 0
    ? preset.countries.map(entry => entry.code)
    : preset.country_codes ?? [];
  return [...new Set(codes.map(code => String(code || '').trim().toUpperCase()).filter(Boolean))];
}

/** Un codice è una polity della mappa? Confronto diretto (i codici sono già normalizzati). */
export function hasPolity(polities: MapPolity[], code: string | undefined | null): boolean {
  if (!code) return false;
  return polities.some(polity => polity.code === code);
}
