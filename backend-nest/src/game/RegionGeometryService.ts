/**
 * World Story — RegionGeometryService
 * ===================================
 * Geometria e risoluzione flessibile delle regioni, estratta da `game-session.ts`
 * come secondo passo della Fase 1. È logica deterministica, senza LLM: qui vive
 * tutto ciò che riguarda centroidi e punti di frontiera.
 *
 * Il servizio **non possiede lo stato delle regioni**: riceve un accessor alla
 * mappa viva della sessione e mantiene solo le proprie cache (centroide GeoJSON
 * e geometria point-in-polygon), esattamente come faceva `GameSession`. Questo
 * preserva il comportamento e rende il codice testabile in isolamento.
 */

import db from '../database';
import { RegionResolver } from '../utils/name-resolver';

/** Regione minima richiesta dalla geometria; il resto dello stato resta nella sessione. */
export interface GeometryRegion {
  id: string;
  owner: string;
  svgPath?: string;
  objects?: any[];
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export class RegionGeometryService<R extends GeometryRegion = GeometryRegion> {
  /** Кэш геоцентроидов регионов: geojson тяжёлый, считаем один раз на сессию. */
  private readonly geoCenterCache = new Map<string, GeoPoint | null>();
  /** Кэш геометрий для определения границы (point-in-polygon). */
  private readonly regionGeometryCache = new Map<string, any>();

  constructor(private readonly regions: () => Map<string, R>) {}

  /**
   * Гибкий резолвинг региона: id → имя (fuzzy) → override-форматы оригинала
   * ('random', 'coastal', 'west/east/north/south' и русские аналоги, 'target X').
   */
  resolveRegionFlexible(key: string | undefined | null, resolver: RegionResolver): R | undefined {
    if (!key) return undefined;
    const direct = this.regions().get(key) || resolver.resolve(key);
    if (direct) return this.regions().get(direct.id);

    const norm = key.trim().toLowerCase();
    const all = Array.from(this.regions().values());
    if (all.length === 0) return undefined;

    // Детерминированный «случайный» выбор — от длины строки, чтобы ход был воспроизводим
    const pickDeterministic = (pool: R[]) =>
      pool[key.length % pool.length];

    if (norm === 'random') return pickDeterministic(all);

    if (norm === 'coastal') {
      const coastal = all.filter(r => (r.objects || []).some((o: any) => o.type === 'port'));
      return pickDeterministic(coastal.length > 0 ? coastal : all);
    }

    if (norm.startsWith('target ')) {
      const inner = this.regions().get(norm.slice(7)) || resolver.resolve(key.slice(7));
      return inner ? this.regions().get(inner.id) : undefined;
    }

    const dirMap: Record<string, 'west' | 'east' | 'north' | 'south'> = {
      west: 'west', western: 'west', ovest: 'west', occidente: 'west', запад: 'west',
      east: 'east', eastern: 'east', est: 'east', oriente: 'east', восток: 'east',
      north: 'north', northern: 'north', nord: 'north', settentrione: 'north', север: 'north',
      south: 'south', southern: 'south', sud: 'south', meridione: 'south', юг: 'south',
    };
    const dir = Object.entries(dirMap).find(([k]) => norm === k || norm.startsWith(k + ' '))?.[1];
    if (dir) {
      const withCentroid = all
        .map(r => ({ r, c: this.svgCentroid(r.svgPath) }))
        .filter((x): x is { r: R; c: { x: number; y: number } } => !!x.c);
      if (withCentroid.length === 0) return pickDeterministic(all);
      withCentroid.sort((a, b) => {
        switch (dir) {
          case 'west': return a.c.x - b.c.x;
          case 'east': return b.c.x - a.c.x;
          case 'north': return a.c.y - b.c.y; // SVG: y растёт вниз
          case 'south': return b.c.y - a.c.y;
        }
      });
      return withCentroid[0].r;
    }

    return undefined;
  }

  /** Центроид региона из SVG-пути (среднее всех координат). */
  svgCentroid(path: string | undefined): { x: number; y: number } | null {
    if (!path) return null;
    const nums = path.match(/-?\d+\.?\d*/g);
    if (!nums || nums.length < 4) return null;
    let sumX = 0, sumY = 0, count = 0;
    for (let i = 0; i < nums.length; i += 2) {
      sumX += Number(nums[i]);
      sumY += Number(nums[i + 1] || 0);
      count++;
    }
    return count > 0 ? { x: sumX / count, y: sumY / count } : null;
  }

  /**
   * Центр региона в lat/lng — для маркеров Этапа 4 ({ id, type, name, lat, lng }).
   * Приоритет: geojson-геометрия из БД (шаблонные миры Natural Earth; кастомные
   * SVG-карты тоже сконвертированы в lng/lat через svgPathToGeoJSON) →
   * центроид SVG-пути по конвенции 2000x1500 → null.
   */
  regionCenter(region: R): GeoPoint | null {
    if (!this.geoCenterCache.has(region.id)) {
      this.geoCenterCache.set(region.id, this.computeGeoCenter(region.id));
    }
    const fromGeo = this.geoCenterCache.get(region.id);
    if (fromGeo) return fromGeo;

    const c = this.svgCentroid(region.svgPath);
    if (c) {
      // Та же конвенция SVG→lng/lat, что в svgPathToGeoJSON (холст 2000x1500)
      return { lng: (c.x / 2000) * 360 - 180, lat: 90 - (c.y / 1500) * 180 };
    }
    return null;
  }

  /**
   * Центроид региона по geojson из БД: среднее точек внешнего кольца
   * наибольшего полигона. GeoJSON хранит координаты как [lng, lat].
   * Для стран через антимеридиан (Россия, США) среднее грубое — для маркера достаточно.
   */
  private computeGeoCenter(regionId: string): GeoPoint | null {
    try {
      const row = db.prepare('SELECT geojson FROM world_regions WHERE id = ?').get(regionId) as any;
      if (!row?.geojson) return null;
      const gj = JSON.parse(row.geojson);
      const geom = gj?.geometry ?? gj;
      const polygons: any[] = geom?.type === 'Polygon'
        ? [geom.coordinates]
        : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
      let bestRing: any[] | null = null;
      for (const poly of polygons) {
        const ring = poly?.[0];
        if (Array.isArray(ring) && (!bestRing || ring.length > bestRing.length)) bestRing = ring;
      }
      if (!bestRing || bestRing.length === 0) return null;
      let sumLng = 0, sumLat = 0, n = 0;
      for (const pt of bestRing) {
        if (Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number') {
          sumLng += pt[0];
          sumLat += pt[1];
          n++;
        }
      }
      return n > 0 ? { lng: sumLng / n, lat: sumLat / n } : null;
    } catch {
      return null;
    }
  }

  private regionGeometry(regionId: string): any | null {
    if (this.regionGeometryCache.has(regionId)) return this.regionGeometryCache.get(regionId);
    let geometry: any = null;
    try {
      const row = db.prepare('SELECT geojson FROM world_regions WHERE id = ?').get(regionId) as any;
      if (row?.geojson) {
        const gj = JSON.parse(row.geojson);
        const geom = gj?.geometry ?? gj;
        if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') geometry = geom;
      }
    } catch {
      geometry = null;
    }
    this.regionGeometryCache.set(regionId, geometry);
    return geometry;
  }

  private static pointInRing(x: number, y: number, ring: any[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]?.[0];
      const yi = ring[i]?.[1];
      const xj = ring[j]?.[0];
      const yj = ring[j]?.[1];
      if (typeof xi !== 'number' || typeof yi !== 'number' || typeof xj !== 'number' || typeof yj !== 'number') continue;
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  private pointInGeometry(lng: number, lat: number, geometry: any): boolean {
    const polygons: any[] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const poly of polygons) {
      if (!Array.isArray(poly) || !poly.length || !Array.isArray(poly[0])) continue;
      if (!RegionGeometryService.pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (Array.isArray(poly[i]) && RegionGeometryService.pointInRing(lng, lat, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  /**
   * Punto di schieramento di frontiera: parte dal centroide della provincia e
   * avanza verso la provincia più vicina della politia indicata, fermandosi
   * all'ultimo punto ancora dentro i confini della provincia. Così una
   * formazione "di frontiera" compare sul confine e non nel centro abitato.
   */
  frontierPosition(region: R, targetPolityId: string): GeoPoint | null {
    const start = this.regionCenter(region);
    const geometry = this.regionGeometry(region.id);
    if (!start || !geometry) return null;
    let toward: GeoPoint | null = null;
    let bestDist = Infinity;
    for (const other of this.regions().values()) {
      if (other.owner !== targetPolityId) continue;
      const center = this.regionCenter(other);
      if (!center) continue;
      const dist = (center.lat - start.lat) ** 2 + (center.lng - start.lng) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        toward = center;
      }
    }
    if (!toward) return null;
    let last = { ...start };
    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = {
        lat: start.lat + (toward.lat - start.lat) * t,
        lng: start.lng + (toward.lng - start.lng) * t,
      };
      if (this.pointInGeometry(point.lng, point.lat, geometry)) last = point;
      else break;
    }
    return last;
  }
}
