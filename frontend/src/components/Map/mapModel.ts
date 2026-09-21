import type { GeoJSONSourceDiff } from 'maplibre-gl';
import type { Region, MapObject } from '../../types';
import citiesRegistry from '../../data/cities.json';
import capitalsRegistry from '../../data/capitals.json';

/**
 * Viste tematiche della mappa. Ogni layer risponde a una domanda diversa ma
 * legge sempre lo stesso stato canonico: la mappa non crea nuove verità.
 */
export type MapLayer =
  | 'political'
  | 'military'
  | 'economy'
  | 'resources'
  | 'infrastructure'
  | 'diplomacy'
  | 'changes'
  | 'terrain';

/** Definizione centralizzata dei layer: unica fonte per label e descrizioni. */
export interface MapLayerDefinition {
  id: MapLayer;
  label: string;
  /** Domanda a cui il layer risponde, mostrata nella legenda. */
  description: string;
}

export const MAP_LAYERS: MapLayerDefinition[] = [
  { id: 'political', label: 'Politica', description: 'Chi controlla ogni territorio.' },
  { id: 'military', label: 'Militare', description: 'Dove sono fronti, reparti e trasferimenti in corso.' },
  { id: 'economy', label: 'Economia', description: 'Dove è concentrato il PIL territoriale.' },
  { id: 'resources', label: 'Risorse', description: 'Dove sono localizzate le risorse con sito canonico.' },
  { id: 'infrastructure', label: 'Infrastrutture', description: 'Dove sono le opere e le capacità territoriali.' },
  { id: 'diplomacy', label: 'Diplomazia', description: 'Quali territori appartengono a polity alleate, neutrali o ostili.' },
  { id: 'changes', label: 'Modifiche', description: 'Cosa è cambiato di recente in questa sessione.' },
  { id: 'terrain', label: 'Terreno', description: 'La base geografica, con i colori politici attenuati.' },
];

export const DEFAULT_MAP_LAYER: MapLayer = 'political';

export function mapLayerDefinition(id: MapLayer): MapLayerDefinition {
  return MAP_LAYERS.find(layer => layer.id === id) ?? MAP_LAYERS[0];
}

export interface MapFilters {
  showCities: boolean;
  showPorts: boolean;
  showIndustry: boolean;
  showUnits: boolean;
}
export const DEFAULT_MAP_FILTERS: MapFilters = {
  showCities: true, showPorts: true, showIndustry: true, showUnits: true,
};
export const EMPTY_IDS: string[] = [];

/**
 * Classificazione dei tipi oggetto per i layer tematici. Unità e opere restano
 * insiemi distinti: nel layer Infrastrutture un reparto non deve mai diventare
 * un'opera, e viceversa.
 */
export const MILITARY_OBJECT_TYPES = ['army', 'battalion', 'fleet', 'missile', 'mobilization'] as const;
/** Opere civili/industriali che rispondono «dove sono le capacità territoriali». */
export const INFRASTRUCTURE_OBJECT_TYPES = [
  'factory', 'port', 'infrastructure', 'power_plant', 'university',
  'construction_site', 'exchange', 'clearing',
] as const;
/** Installazioni strategiche: infrastruttura, ma gated dal filtro unità. */
export const STRATEGIC_OBJECT_TYPES = [
  'base', 'airbase', 'naval_base', 'radar', 'fortification', 'missile_site',
] as const;

/** Icone degli oggetti di gioco sulla mappa: glifo monocromatico + colore opera. */
export interface MapIcon { color: string; label: string }
export const OBJECT_ICONS: Record<string, MapIcon> = {
  city: { color: '#ffffff', label: '●' },
  capital: { color: '#ffd700', label: '★' },
  // Contatori operativi: simboli compatti e leggibili anche a vista mondo.
  army: { color: '#cf433d', label: 'Ⅱ' },
  battalion: { color: '#d95a47', label: 'Ⅰ' },
  fleet: { color: '#3978bb', label: '≋' },
  missile: { color: '#d7792a', label: '➤' },
  // Opere territoriali: ogni tipo mantiene una silhouette riconoscibile.
  radar: { color: '#5a9b70', label: '◎' },
  port: { color: '#3978bb', label: '⚓' },
  factory: { color: '#c68a32', label: '⚙' },
  university: { color: '#8b62ad', label: '◆' },
  base: { color: '#7f8793', label: '■' },
  airbase: { color: '#708aa3', label: '✈' },
  naval_base: { color: '#32678e', label: '⚓' },
  fortification: { color: '#85806f', label: '⬟' },
  missile_site: { color: '#a65d36', label: '↑' },
  infrastructure: { color: '#9a8060', label: '═' },
  power_plant: { color: '#b59b3b', label: 'ϟ' },
  construction_site: { color: '#b3aa8c', label: '⋯' },
  mobilization: { color: '#b56b4f', label: '↟' },
};

/**
 * L'icona dipende da cosa si costruisce o mobilita: un cantiere navale
 * mostra l'ancora, una leva di fanteria il glifo del battaglione. Il bordo
 * tratteggiato (stile cantiere) segnala comunque lo stato in preparazione.
 */
export function objectIconFor(obj: Pick<MapObject, 'type'> & { metadata?: Record<string, unknown> | null }): MapIcon {
  const planned = typeof obj.metadata?.plannedType === 'string' ? obj.metadata.plannedType : '';
  if (obj.type === 'construction_site' && OBJECT_ICONS[planned]) return OBJECT_ICONS[planned];
  if (obj.type === 'mobilization' && OBJECT_ICONS[planned]) return OBJECT_ICONS[planned];
  return OBJECT_ICONS[obj.type] ?? OBJECT_ICONS.city;
}

// Limiti di validità GeoJSON/WGS84: una coordinata fuori intervallo non è
// proiettabile e romperebbe l'intera sorgente, non solo la sua provincia.
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
const isValidPosition = (position: unknown): boolean => Array.isArray(position)
  && position.length >= 2
  && Number.isFinite(position[0]) && Number.isFinite(position[1])
  && Math.abs(position[0] as number) <= MAX_LONGITUDE
  && Math.abs(position[1] as number) <= MAX_LATITUDE;
const isValidRing = (ring: unknown): boolean => {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isValidPosition)) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  // GeoJSON LinearRing: la prima e l'ultima posizione devono essere
  // equivalenti. L'input aperto viene scartato, mai chiuso automaticamente.
  return first[0] === last[0] && first[1] === last[1];
};

/**
 * Invalid imported geometry must not prevent the rest of the world from
 * rendering: a geometry is accepted only if it is a Polygon/MultiPolygon whose
 * rings have ≥ 4 positions, finite WGS84 coordinates and matching first/last
 * positions. Anything else is skipped for that province alone (never repaired).
 */
export function parseRegionGeometry(value?: string): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value) return null;
  try {
    const geometry = JSON.parse(value)?.geometry;
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return null;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) return null;
    const valid = polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0
      && polygon.every(isValidRing));
    return valid ? geometry : null;
  } catch { return null; }
}

// ── Registri geografici condivisi (città e capitali) ────────────────────────
export type CityLocation = { name: string; country: string; lat: number; lng: number; pop: number };
export type CapitalLocation = { capital: string; lat: number; lng: number };

const normalizePlaceName = (value: string): string => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const CITY_POINTS = new Map<string, CityLocation>(
  (citiesRegistry.cities as CityLocation[]).map(city => [`${city.country}:${normalizePlaceName(city.name)}`, city]),
);
const CAPITAL_POINTS = capitalsRegistry as Record<string, CapitalLocation>;

/**
 * Coordinate canoniche di una città/capitale dal registro storico. Il punto è
 * lo **stesso** usato dal renderer e dalla ricerca: un oggetto senza `lat/lng`
 * non resta orfano e non riceve coordinate arbitrarie. `null` se sconosciuto.
 */
export function fixedCityCoordinate(type: string, country: string, name: string): [number, number] | null {
  if (type === 'capital') {
    const capital = CAPITAL_POINTS[country];
    return capital ? [capital.lng, capital.lat] : null;
  }
  if (type !== 'city') return null;
  const city = CITY_POINTS.get(`${country}:${normalizePlaceName(name)}`);
  return city ? [city.lng, city.lat] : null;
}

// Limite della proiezione Web Mercator usata da MapLibre. Le coordinate degli
// oggetti non vengono mai corrette silenziosamente: se non sono proiettabili,
// non costituiscono una destinazione geografica valida.
const MAX_MAP_OBJECT_LATITUDE = 85;
const validMapObjectCoordinate = (point: [unknown, unknown] | null): point is [number, number] => !!point
  && Number.isFinite(point[0]) && Number.isFinite(point[1])
  && Math.abs(point[0] as number) <= MAX_LONGITUDE
  && Math.abs(point[1] as number) <= MAX_MAP_OBJECT_LATITUDE;

/**
 * Authority frontend unica per la posizione geografica di un oggetto mappa.
 * Il registro canonico vince sempre su snapshot legacy/stale; in sua assenza
 * si accettano soltanto coordinate persistite finite e proiettabili. Il
 * fallback storico SVG x/y resta deliberatamente responsabilità del renderer.
 */
export function resolveMapObjectCoordinate(input: {
  type: string;
  country: string;
  name: string;
  lng?: unknown;
  lat?: unknown;
}): [number, number] | null {
  const canonical = fixedCityCoordinate(input.type, input.country, input.name);
  if (validMapObjectCoordinate(canonical)) return canonical;
  const persisted: [unknown, unknown] = [input.lng, input.lat];
  return validMapObjectCoordinate(persisted) ? persisted : null;
}

/** Per-map cache: unchanged borders are parsed once; deleted regions are evicted. */
export class RegionFeatureIndex {
  private cache = new Map<string, { raw?: string; feature: GeoJSON.Feature | null }>();

  build(regions: Region[], playerCountryCode?: string): Map<string, GeoJSON.Feature> {
    const features = new Map<string, GeoJSON.Feature>();
    const liveIds = new Set(regions.map(region => region.id));
    for (const id of this.cache.keys()) if (!liveIds.has(id)) this.cache.delete(id);
    for (const region of regions) {
      const cached = this.cache.get(region.id);
      const geometry = cached && cached.raw === region.geojson
        ? cached.feature?.geometry ?? null : parseRegionGeometry(region.geojson);
      if (!geometry) {
        this.cache.set(region.id, { raw: region.geojson, feature: null });
        continue;
      }
      const properties = {
        id: region.id, name: region.name, color: region.color || '#788797',
        owner: region.owner || '', isPlayer: region.owner === (playerCountryCode || 'player'),
      };
      const same = cached?.feature?.geometry === geometry
        && Object.entries(properties).every(([key, value]) => cached.feature?.properties?.[key] === value);
      const feature: GeoJSON.Feature = same ? cached!.feature! : {
        type: 'Feature', id: region.id, geometry, properties,
      };
      this.cache.set(region.id, { raw: region.geojson, feature });
      features.set(region.id, feature);
    }
    return features;
  }
}

/** IDs are canonical, not array offsets: additions/deletions cannot shift selection. */
export function diffRegionFeatures(previous: Map<string, GeoJSON.Feature>, next: Map<string, GeoJSON.Feature>): GeoJSONSourceDiff | null {
  const remove = [...previous.keys()].filter(id => !next.has(id));
  const add: GeoJSON.Feature[] = [];
  const update: NonNullable<GeoJSONSourceDiff['update']> = [];
  next.forEach((feature, id) => {
    const before = previous.get(id);
    if (!before) add.push(feature);
    else if (before !== feature) update.push({
      id,
      ...(before.geometry !== feature.geometry ? { newGeometry: feature.geometry } : {}),
      addOrUpdateProperties: Object.entries(feature.properties || {}).map(([key, value]) => ({ key, value })),
    });
  });
  return remove.length || add.length || update.length ? { remove, add, update } : null;
}

/**
 * Zoom minimo perché un oggetto compaia sulla mappa. A vista mondo (zoom 1)
 * restano leggibili solo le nazioni e le capitali: unità, porti e opere
 * entrano gradualmente, così la mappa non si trasforma in un muro di icone.
 * Le città usano una soglia più fine basata sulla popolazione (vedi il layer).
 */
export function objectMinZoom(type: MapObject['type']): number {
  switch (type) {
    // Capitali: primo oggetto a entrare, ancora politica della mappa.
    case 'capital': return 2.0;
    case 'city': return 3.2;
    // Contatori operativi: compaiono quando si guarda un teatro, non il globo.
    case 'army':
    case 'battalion':
    case 'fleet':
    case 'missile':
    case 'mobilization': return 2.2;
    case 'port':
    case 'naval_base': return 2.4;
    // Opere territoriali e industria: solo a scala regionale.
    default: return 2.6;
  }
}

/**
 * Se l'oggetto va mostrato a questo zoom. Le città sono l'eccezione: le
 * metropoli compaiono prima delle cittadine minori (soglia per popolazione).
 * `zoomBias` alza virtualmente lo zoom sui viewport piccoli (mobile): a parità
 * di scala geografica una schermata stretta ha meno pixel, quindi lo stesso
 * teatro resta sotto la soglia e le icone (unità, opere, cambiamenti)
 * sparirebbero proprio dove servono di più.
 */
export function objectQualifiesAtZoom(type: MapObject['type'], zoom: number, population = 0, zoomBias = 0): boolean {
  const effectiveZoom = zoom + zoomBias;
  if (type === 'city') return (population >= 3 && effectiveZoom >= 2.6) || effectiveZoom >= 3.2;
  return effectiveZoom >= objectMinZoom(type);
}

export function objectIsVisible(type: MapObject['type'], filters: MapFilters): boolean {
  if (type === 'city' || type === 'capital') return filters.showCities;
  if (type === 'port' || type === 'naval_base') return filters.showPorts;
  if ((MILITARY_OBJECT_TYPES as readonly string[]).includes(type)) return filters.showUnits;
  if ((STRATEGIC_OBJECT_TYPES as readonly string[]).includes(type)) return filters.showUnits;
  return filters.showIndustry;
}

/**
 * Visibilità dell'oggetto **per layer attivo**. Il layer Infrastrutture mostra
 * opere e installazioni ma mai i reparti puri: un'armata non è un'infrastruttura.
 * Gli altri layer mantengono il comportamento storico basato sui filtri.
 */
export function objectIsVisibleForLayer(
  type: MapObject['type'],
  filters: MapFilters,
  layer: MapLayer,
): boolean {
  if (layer === 'infrastructure' && (MILITARY_OBJECT_TYPES as readonly string[]).includes(type)) return false;
  return objectIsVisible(type, filters);
}

/**
 * Budget di etichette di provincia visibili contemporaneamente: selezione e
 * hover non lo consumano. Impedisce che un mondo con migliaia di province
 * accenda altrettanti testi DOM solo per nasconderli.
 */
export const REGION_LABEL_BUDGET = 90;

/**
 * Decisione **pura** di visibilità di una etichetta di regione. Le province
 * parlano solo se selezionate; le regioni nazionali seguono la gerarchia per
 * zoom; il budget limita le etichette non prioritarie. La logica vive qui per
 * essere testabile senza montare la mappa.
 */
export function regionLabelVisible(input: {
  isProvince: boolean;
  selected: boolean;
  hovered: boolean;
  zoom: number;
  area: number;
  shown: number;
  budget?: number;
}): { visible: boolean; countsTowardBudget: boolean } {
  const budget = input.budget ?? REGION_LABEL_BUDGET;
  const focused = input.selected || input.hovered;
  const qualifies = input.isProvince
    ? input.selected
    : focused || (input.zoom >= 2.4 && input.area >= 12)
      || (input.zoom >= 3.0 && input.area >= 0.35) || input.zoom >= 3.2;
  const visible = qualifies && (focused || input.shown < budget);
  return { visible, countsTowardBudget: visible && !focused };
}

export const normalizeMapSearch = (text: string): string => text.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').trim();

export interface MapSearchEntry {
  id: string;
  regionId: string;
  name: string;
  context: string;
  search: string;
  point?: [number, number];
}

export function buildMapSearchIndex(regions: Region[]): MapSearchEntry[] {
  return regions.flatMap(region => {
    if (!parseRegionGeometry(region.geojson)) return [];
    const context = region.polityName || region.owner || 'Territorio';
    const entries: MapSearchEntry[] = [{
      id: region.id, regionId: region.id, name: region.name, context,
      search: normalizeMapSearch(`${region.name} ${context} ${region.id}`),
    }];
    const regionCountry = String(region.flag || region.owner || '').toUpperCase();
    for (const object of region.objects || []) {
      // Renderer e ricerca condividono la stessa authority: il registro
      // canonico precede sempre eventuali coordinate persistite stale.
      const point = resolveMapObjectCoordinate({
        type: object.type, country: regionCountry, name: object.name,
        lng: object.lng, lat: object.lat,
      });
      if (!point) continue;
      entries.push({
        id: `${region.id}:${object.id}`, regionId: region.id, name: object.name,
        context: `${region.name} · ${context}${object.type === 'mobilization' ? ' · In formazione' : object.type === 'construction_site' ? ' · Cantiere' : ''}`, point,
        search: normalizeMapSearch(`${object.name} ${region.name} ${context}`),
      });
    }
    return entries;
  });
}

export function searchMap(index: MapSearchEntry[], query: string, limit = 12): MapSearchEntry[] {
  const term = normalizeMapSearch(query);
  if (!term) return [];
  return index.filter(entry => entry.search.includes(term))
    .sort((a, b) => Number(normalizeMapSearch(b.name).startsWith(term)) - Number(normalizeMapSearch(a.name).startsWith(term)))
    .slice(0, limit);
}
