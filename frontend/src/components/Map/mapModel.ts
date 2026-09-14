import type { GeoJSONSourceDiff } from 'maplibre-gl';
import type { Region, MapObject } from '../../types';

export type MapLayer = 'political' | 'terrain' | 'changes';
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

/** Invalid imported geometry must not prevent the rest of the world from rendering. */
export function parseRegionGeometry(value?: string): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value) return null;
  try {
    const geometry = JSON.parse(value)?.geometry;
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return null;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) return null;
    const valid = polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0
      && polygon.every(ring => Array.isArray(ring) && ring.length >= 4
        && ring.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0])
          && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90)));
    return valid ? geometry : null;
  } catch { return null; }
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
  if (['army', 'battalion', 'fleet', 'missile', 'mobilization', 'base', 'airbase', 'radar', 'fortification', 'missile_site'].includes(type)) return filters.showUnits;
  return filters.showIndustry;
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
    for (const object of region.objects || []) {
      if (!Number.isFinite(object.lng) || !Number.isFinite(object.lat) || Math.abs(object.lat!) > 85) continue;
      entries.push({
        id: `${region.id}:${object.id}`, regionId: region.id, name: object.name,
        context: `${region.name} · ${context}${object.type === 'mobilization' ? ' · In formazione' : object.type === 'construction_site' ? ' · Cantiere' : ''}`, point: [object.lng!, object.lat!],
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
