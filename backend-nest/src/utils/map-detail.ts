/**
 * World Story — Livelli di dettaglio della mappa (proiezione di generazione)
 * ========================================================================
 * Il preset può dichiarare `map_detail` con tre valori:
 *   - `nations` — 1 regione per paese (dissolve le province del paese);
 *   - `grouped` — poche regioni per paese (gerarchia reale se esiste,
 *                 altrimenti raggruppamento geografico deterministico);
 *   - `full`    — 1 regione per feature/provincia (comportamento storico).
 *
 * Il raggruppamento è una PROIEZIONE in fase di generazione del mondo: non
 * persiste nuovo stato e non tocca il motore di simulazione. Tutte le funzioni
 * qui sono pure e deterministiche (stesso input → stesso output), così sono
 * testabili senza LLM, DB o browser.
 *
 * Il modulo riusa gli helper già presenti (`geometryAreaDeg2`,
 * `largestRingCentroid`, `computeBorders`): nessuna nuova dipendenza.
 */

import { computeBorders } from './borders';
import { geometryAreaDeg2, largestRingCentroid } from './geo';

export type MapDetail = 'nations' | 'grouped' | 'full';

export const MAP_DETAILS: readonly MapDetail[] = ['nations', 'grouped', 'full'] as const;

/**
 * Proprietà che possono portare una gerarchia intermedia utilizzabile
 * (`grouped` le preferisce al clustering geografico).
 */
export const GROUPING_HIERARCHY_KEYS: readonly string[] = [
  'region', 'admin1', 'macroregion', 'group', 'parent', 'admin_region', 'province_group',
];

export interface MapFeature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: unknown;
}

/** Gruppo di feature proiettato in una regione di gioco. */
export interface DerivedGroup {
  /** Codice regione (univoco nel mondo). */
  code: string;
  name: string;
  /** Politia proprietaria (codice paese). */
  owner: string;
  /** Codici delle feature membri. */
  memberCodes: string[];
  /** Geometria GeoJSON (Polygon o MultiPolygon dei membri). */
  geometry: unknown;
  /** Proprietà della feature GeoJSON (preserva `surface_type`/`tags` per la costa). */
  properties: Record<string, unknown>;
  /** Area (gradi²) dei membri, con lo stesso fallback della generazione storica. */
  areaDeg2: number;
  hasCapital: boolean;
  /** Dettaglio dei membri: serve a sommare statistiche coerenti tra livelli. */
  memberStats: Array<{ code: string; areaDeg2: number; hasCapital: boolean }>;
  /** Punto rappresentativo del gruppo (per etichette e ordine deterministico). */
  centroid: [number, number] | null;
}

export interface DeriveGroupsOptions {
  /** Codice paese proprietario (obbligatorio). */
  owner: string;
  /** Nome del paese per `nations`/`grouped` (default: prima feature). */
  countryName?: string;
  /** Chiavi di gerarchia accettate (default `GROUPING_HIERARCHY_KEYS`). */
  hierarchyKeys?: readonly string[];
  /** Dimensione target dei gruppi per il clustering (default 3). */
  targetGroupSize?: number;
}

// ---------------------------------------------------------------------------
// Validazione del campo preset
// ---------------------------------------------------------------------------

export function isMapDetail(value: unknown): value is MapDetail {
  return typeof value === 'string' && (MAP_DETAILS as readonly string[]).includes(value);
}

export function normalizeMapDetail(value: unknown): MapDetail | undefined {
  return isMapDetail(value) ? value : undefined;
}

/**
 * Livello effettivo del preset. Retrocompatibilità: senza campo, un preset con
 * mappa provinciale resta `full`, uno senza resta `nations` (identico a oggi).
 * `full`/`grouped` richiedono una mappa provinciale: altrimenti si ricade su
 * `nations` senza inventare regioni.
 */
export function resolveMapDetail(explicit: unknown, hasProvinceMap: boolean): MapDetail {
  const requested = normalizeMapDetail(explicit);
  if (requested) {
    if ((requested === 'full' || requested === 'grouped') && !hasProvinceMap) return 'nations';
    return requested;
  }
  return hasProvinceMap ? 'full' : 'nations';
}

/** Vero se le feature portano province (`properties.country` ≠ `properties.code`). */
export function hasProvinceFeatures(features: MapFeature[]): boolean {
  return features.some(feature => {
    const props = (feature?.properties || {}) as Record<string, unknown>;
    return typeof props.country === 'string' && props.country !== ''
      && typeof props.code === 'string' && props.code !== ''
      && props.country !== props.code;
  });
}

// ---------------------------------------------------------------------------
// Proiezione
// ---------------------------------------------------------------------------

interface Entry {
  code: string;
  name: string;
  geometry: unknown;
  areaDeg2: number;
  hasCapital: boolean;
  point: [number, number] | null;
  props: Record<string, unknown>;
}

function isTruthyCapital(value: unknown): boolean {
  return value === true || value === 'true' || value === 'True' || value === 1;
}

function polygonsOf(geometry: unknown): number[][][][] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as number[][][]];
  if (g.type === 'MultiPolygon') return g.coordinates as number[][][][];
  return [];
}

function firstCoordinate(geometry: unknown): [number, number] | null {
  let found: [number, number] | null = null;
  const visit = (value: unknown): void => {
    if (found || !Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      found = [value[0], value[1]];
      return;
    }
    for (const child of value) visit(child);
  };
  visit((geometry as { coordinates?: unknown } | null)?.coordinates);
  return found;
}

function representativePoint(feature: MapFeature): [number, number] | null {
  const centroid = (feature.properties || {})['centroid'];
  if (Array.isArray(centroid) && typeof centroid[0] === 'number' && typeof centroid[1] === 'number') {
    return [centroid[0], centroid[1]];
  }
  const ring = largestRingCentroid(feature.geometry);
  if (ring) return [ring.lng, ring.lat];
  return firstCoordinate(feature.geometry);
}

function toEntries(features: MapFeature[]): Entry[] {
  return features.map(feature => {
    const props = (feature.properties || {}) as Record<string, unknown>;
    const code = String(props.code ?? '');
    return {
      code,
      name: typeof props.name === 'string' && props.name ? props.name : code,
      geometry: feature.geometry,
      areaDeg2: geometryAreaDeg2(feature.geometry) || 0.0001,
      hasCapital: isTruthyCapital(props.is_capital),
      point: representativePoint(feature),
      props,
    };
  }).filter(entry => entry.code !== '');
}

function makeGroup(owner: string, code: string, name: string, members: Entry[]): DerivedGroup {
  const geometry = members.length === 1
    ? members[0].geometry
    : { type: 'MultiPolygon', coordinates: members.flatMap(member => polygonsOf(member.geometry)) };
  const points = members.map(member => member.point).filter((p): p is [number, number] => !!p);
  const centroid = points.length > 0
    ? [
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length,
      ] as [number, number]
    : null;
  return {
    code,
    name,
    owner,
    memberCodes: members.map(member => member.code),
    geometry,
    properties: mergeProperties(owner, code, name, members),
    areaDeg2: members.reduce((sum, member) => sum + member.areaDeg2, 0),
    hasCapital: members.some(member => member.hasCapital),
    memberStats: members.map(member => ({ code: member.code, areaDeg2: member.areaDeg2, hasCapital: member.hasCapital })),
    centroid,
  };
}

/**
 * Proprietà della feature GeoJSON del gruppo. Per `full` conserva le proprietà
 * originali della provincia (così `surface_type` continua a guidare la capacità
 * navale); per i gruppi aggregati fonde `surface_type`/`tags` dei membri.
 */
function mergeProperties(owner: string, code: string, name: string, members: Entry[]): Record<string, unknown> {
  if (members.length === 1) return { ...members[0].props, code, name, country: owner };
  const merged: Record<string, unknown> = {
    code,
    name,
    country: owner,
    is_capital: members.some(member => member.hasCapital),
  };
  const surfaces = members.map(member => member.props.surface_type);
  const surface = surfaces.find(value => value === 'Coastal' || value === 'Ocean' || value === 'Strait')
    ?? surfaces.find(value => typeof value === 'string');
  if (surface) merged.surface_type = surface;
  const tags = new Set<string>();
  for (const member of members) {
    const value = member.props.tags;
    if (Array.isArray(value)) for (const tag of value) tags.add(String(tag));
  }
  if (tags.size > 0) merged.tags = [...tags];
  return merged;
}

/** Chiave di gerarchia realmente presente e capace di raggruppare (non unica). */
function pickHierarchyKey(entries: Entry[], keys: readonly string[]): string | null {
  for (const key of keys) {
    const values = entries.map(entry => entry.props[key]);
    if (values.every(value => value === undefined || value === null || value === '')) continue;
    const distinct = new Set(values.map(value => String(value)));
    if (distinct.size > 1 && distinct.size < entries.length) return key;
  }
  return null;
}

function squaredDistance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  // Correzione della longitudine per la latitudine: prossimità più sensata.
  const latScale = Math.cos((a[1] * Math.PI) / 180);
  return dx * dx * latScale * latScale + dy * dy;
}

function chunkGroups(entries: Entry[], owner: string, countryName: string, k: number): DerivedGroup[] {
  const sorted = [...entries].sort((a, b) => a.code.localeCompare(b.code));
  const size = Math.ceil(sorted.length / k);
  const groups: DerivedGroup[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    groups.push(makeGroup(owner, `${owner}-g${groups.length + 1}`, `${countryName} · ${groups.length + 1}`, sorted.slice(i, i + size)));
  }
  return groups;
}

/** Raggruppamento geografico deterministico dei membri (K = ceil(n/target)). */
function clusterGroups(entries: Entry[], owner: string, countryName: string, targetGroupSize: number): DerivedGroup[] {
  const sorted = [...entries].sort((a, b) => a.code.localeCompare(b.code));
  const k = Math.max(1, Math.ceil(sorted.length / Math.max(1, targetGroupSize)));
  if (k <= 1) return [makeGroup(owner, owner, countryName, sorted)];
  if (sorted.some(entry => !entry.point)) return chunkGroups(sorted, owner, countryName, k);

  const points = sorted.map(entry => entry.point as [number, number]);
  let seeds: [number, number][] = Array.from({ length: k }, (_, i) => points[Math.floor((i * sorted.length) / k)]);
  let assignment = points.map((_, index) => index % k);

  for (let iteration = 0; iteration < 12; iteration++) {
    assignment = points.map(point => {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < seeds.length; c++) {
        const distance = squaredDistance(point, seeds[c]);
        if (distance < bestDistance - 1e-12) { bestDistance = distance; best = c; }
      }
      return best;
    });
    seeds = seeds.map((seed, c) => {
      const members = points.filter((_, index) => assignment[index] === c);
      if (members.length === 0) return seed;
      return [
        members.reduce((sum, p) => sum + p[0], 0) / members.length,
        members.reduce((sum, p) => sum + p[1], 0) / members.length,
      ] as [number, number];
    });
  }

  const buckets = new Map<number, Entry[]>();
  sorted.forEach((entry, index) => {
    const c = assignment[index];
    (buckets.get(c) ?? buckets.set(c, []).get(c)!).push(entry);
  });
  // Ordine deterministico: per codice membro più piccolo.
  const ordered = [...buckets.values()].sort((a, b) =>
    a.map(m => m.code).sort()[0].localeCompare(b.map(m => m.code).sort()[0]));
  return ordered.map((members, index) =>
    makeGroup(owner, `${owner}-g${index + 1}`, `${countryName} · ${index + 1}`, members));
}

/**
 * Proietta le feature di una polity nelle regioni di gioco per il livello dato.
 * Le feature passate devono appartenere tutte alla stessa polity (`owner`).
 */
export function deriveGroups(features: MapFeature[], level: MapDetail, options: DeriveGroupsOptions): DerivedGroup[] {
  const entries = toEntries(features);
  if (entries.length === 0) return [];
  const owner = options.owner;
  const countryName = options.countryName || entries[0].name || owner;

  if (level === 'full') {
    return entries.map(entry => makeGroup(owner, entry.code, entry.name, [entry]));
  }
  if (level === 'nations') {
    return [makeGroup(owner, owner, countryName, entries)];
  }

  const hierarchyKey = pickHierarchyKey(entries, options.hierarchyKeys ?? GROUPING_HIERARCHY_KEYS);
  if (hierarchyKey) {
    const buckets = new Map<string, Entry[]>();
    for (const entry of entries) {
      const raw = entry.props[hierarchyKey];
      const key = raw === undefined || raw === null || raw === '' ? `__${entry.code}` : String(raw);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(entry);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, members], index) =>
        makeGroup(owner, `${owner}-g${index + 1}`, `${countryName} · ${key}`, members));
  }

  return clusterGroups(entries, owner, countryName, options.targetGroupSize ?? 3);
}

// ---------------------------------------------------------------------------
// Statistiche aggregate (stessa formula storica, applicata al gruppo)
// ---------------------------------------------------------------------------

export interface CountryTotals { population: number; gdp: number; military: number }
export interface GroupStats { population: number; gdp: number; militaryPower: number }

/**
 * Distribuisce i totali della polity sulle regioni. Le statistiche di ogni
 * feature seguono la formula storica (peso d'area, capitale ×1.6, bonus
 * militare ×1.25); i gruppi aggregati SOMMANO le feature membri, così `nations`
 * e `grouped` restano coerenti con `full` (che è identico a oggi).
 */
export function distributeCountryStats(totals: CountryTotals, groups: DerivedGroup[]): GroupStats[] {
  const weightOf = (member: { areaDeg2: number; hasCapital: boolean }) =>
    member.areaDeg2 * (member.hasCapital ? 1.6 : 1);
  const allMembers = groups.flatMap(group => group.memberStats);
  const totalWeight = allMembers.reduce((sum, member) => sum + weightOf(member), 0) || 1;
  const perFeature = new Map<string, GroupStats>();
  for (const member of allMembers) {
    const share = weightOf(member) / totalWeight;
    perFeature.set(member.code, {
      population: Math.max(100000, Math.round((Number(totals.population) || 0) * share)),
      gdp: Math.max(1, Math.round((Number(totals.gdp) || 0) * share)),
      militaryPower: Math.max(1, Math.round((Number(totals.military) || 0) * share * (member.hasCapital ? 1.25 : 1))),
    });
  }
  return groups.map(group => group.memberStats.reduce<GroupStats>((accumulator, member) => {
    const stats = perFeature.get(member.code) ?? { population: 0, gdp: 0, militaryPower: 0 };
    return {
      population: accumulator.population + stats.population,
      gdp: accumulator.gdp + stats.gdp,
      militaryPower: accumulator.militaryPower + stats.militaryPower,
    };
  }, { population: 0, gdp: 0, militaryPower: 0 }));
}

// ---------------------------------------------------------------------------
// Adiacenza delle province e confini dei gruppi
// ---------------------------------------------------------------------------

function parseAdjacencyList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '[]') return [];
    try {
      const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch { return null; }
  }
  return null;
}

/**
 * Adiacenza tra le province (per codice feature). Usa la proprietà esplicita
 * `adjacencies` quando presente su tutte le feature (mappa Pax); altrimenti la
 * deriva dalla geometria con `computeBorders`. Non inventa adiacenze.
 */
export function buildProvinceAdjacency(features: MapFeature[]): Record<string, string[]> {
  const codes = new Set<string>();
  const idAlias = new Map<string, string>();
  for (const feature of features) {
    const props = (feature.properties || {}) as Record<string, unknown>;
    const code = String(props.code ?? '');
    if (!code) continue;
    codes.add(code);
    if (props.pax_region_id !== undefined && props.pax_region_id !== null) {
      idAlias.set(String(props.pax_region_id), code);
    }
  }

  const explicit = new Map<string, Set<string>>();
  let withExplicit = 0;
  for (const feature of features) {
    const props = (feature.properties || {}) as Record<string, unknown>;
    const code = String(props.code ?? '');
    if (!code) continue;
    const list = parseAdjacencyList(props.adjacencies);
    if (!list) continue;
    withExplicit += 1;
    const resolved = new Set<string>();
    for (const id of list) {
      const alias = idAlias.get(id);
      if (alias && alias !== code) resolved.add(alias);
      else if (codes.has(id) && id !== code) resolved.add(id);
    }
    explicit.set(code, resolved);
  }
  if (withExplicit >= codes.size && codes.size > 0) {
    return Object.fromEntries([...explicit.entries()].map(([code, set]) => [code, [...set].sort()]));
  }

  const geometryInput: Record<string, unknown> = {};
  for (const feature of features) {
    const code = String(((feature.properties || {}) as Record<string, unknown>).code ?? '');
    if (code && feature.geometry) geometryInput[code] = feature.geometry;
  }
  return computeBorders(geometryInput as Record<string, { type: string; coordinates: unknown }>);
}

/**
 * Confini tra gruppi derivati dall'adiacenza delle province membri: due gruppi
 * sono confinanti se almeno una provincia di A confina con una di B.
 */
export function deriveGroupBorders(
  groups: DerivedGroup[],
  provinceAdjacency: Record<string, string[]>,
): Record<string, string[]> {
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const code of group.memberCodes) groupOf.set(code, group.code);
  const adjacency = new Map<string, Set<string>>();
  for (const group of groups) adjacency.set(group.code, new Set());
  for (const [province, neighbours] of Object.entries(provinceAdjacency)) {
    const from = groupOf.get(province);
    if (!from) continue;
    for (const neighbour of neighbours) {
      const to = groupOf.get(neighbour);
      if (!to || to === from) continue;
      adjacency.get(from)!.add(to);
      adjacency.get(to)!.add(from);
    }
  }
  return Object.fromEntries([...adjacency.entries()].map(([code, set]) => [code, [...set].sort()]));
}
