import type { Region } from '../../types';
import type { FeedItem } from '../Game/EventFeed';
import { parseRegionGeometry } from './mapModel';

export type Coordinate = [number, number];
export const TACTICAL_WINDOW_DAYS = 30;
export const MILITARY_TYPES = new Set(['army', 'battalion', 'fleet', 'missile']);
export interface UnitRoute {
  id: string; name: string; from: Coordinate; to: Coordinate;
  origin: string; destination: string; date: string; owner: string;
}
export interface BattleReport { id: string; regionId: string; point: Coordinate; event: FeedItem }

export function validCoordinate(lng: unknown, lat: unknown): Coordinate | null {
  return typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 85 ? [lng, lat] : null;
}

function day(value?: string): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / 86400000 : NaN;
}
export function isRecentReport(date: string | undefined, currentDate: string | undefined): boolean {
  const age = day(currentDate) - day(date);
  return age >= 0 && age <= TACTICAL_WINDOW_DAYS;
}

/** Latest committed leg only. A route is a record, not a promise of future movement. */
export function buildUnitRoutes(regions: Region[], currentDate?: string): UnitRoute[] {
  const routes: UnitRoute[] = [];
  const byId = new Map(regions.map(region => [region.id, region]));
  const seen = new Set<string>();
  for (const region of regions) for (const unit of region.objects || []) {
    if (!MILITARY_TYPES.has(unit.type) || seen.has(unit.id)) continue;
    seen.add(unit.id);
    const meta = unit.metadata;
    if (!meta || !isRecentReport(meta.movedDate, currentDate) || meta.previousRegionId === region.id) continue;
    const from = validCoordinate(meta.previousLng, meta.previousLat);
    const to = validCoordinate(unit.lng, unit.lat);
    if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
    routes.push({ id: unit.id, name: unit.name, from, to, date: meta.movedDate,
      origin: byId.get(meta.previousRegionId)?.name || meta.previousRegionName || 'Origine',
      destination: region.name, owner: unit.owner || region.owner });
  }
  return routes;
}

/** Keep the shortest longitude arc, including a crossing of the date line. */
export function interpolateCoordinate(from: Coordinate, to: Coordinate, progress: number): Coordinate {
  const t = Math.max(0, Math.min(1, progress));
  const dx = (((to[0] - from[0] + 180) % 360 + 360) % 360) - 180;
  return [from[0] + dx * t, from[1] + (to[1] - from[1]) * t];
}

export function regionReportPoint(region: Region): Coordinate | null {
  const geometry = parseRegionGeometry(region.geojson);
  if (!geometry) return null;
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map(p => p[0]);
  let largestArea = -1;
  let point: Coordinate | null = null;
  for (const ring of rings) {
    let area = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
      const cross = ax * by - bx * ay;
      area += cross; x += (ax + bx) * cross; y += (ay + by) * cross;
    }
    if (Math.abs(area) > largestArea && Math.abs(area) > 1e-8) {
      const candidate = validCoordinate(x / (3 * area), y / (3 * area));
      if (candidate) { point = candidate; largestArea = Math.abs(area); }
    }
  }
  return point;
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const combat = /\b(battaglia|battaglie|scontro|scontri|combattimento|combattimenti|bombardamento|bombardamenti|assedio|attacco respinto|offensiva respinta)\b/;
const nonCombat = /\b(non|nessun\w*|senza|evitat\w*|scongiurat\w*|simulat\w*|esercitazion\w*|pian\w*|prepar\w*|previst\w*|rischio|minacci\w*|possibil\w*|ipotesi|cessat\w*|tregua|armistizio|anniversario|commemor\w*|negoziat\w*)\b/;

/** Do not invent combat from troop proximity, ownership or generic military news.
 * Reports are localized only to an unambiguous place, never every changed province. */
export function buildBattleReports(regions: Region[], events: FeedItem[], currentDate?: string): BattleReport[] {
  const result = new Map<string, BattleReport>();
  for (const event of events) {
    if (!isRecentReport(event.date, currentDate)) continue;
    const title = fold(event.text);
    if (!combat.test(title) || nonCombat.test(title)) continue;
    const names = regions.filter(region => region.name && (` ${title} `).includes(` ${fold(region.name)} `));
    const longest = names.filter(region => !names.some(other => other !== region && fold(other.name).includes(fold(region.name))));
    const linked = (event.regionIds || []).map(id => regions.find(region => region.id === id)).filter((r): r is Region => !!r);
    const region = longest.length === 1 ? longest[0] : longest.length === 0 && linked.length === 1 ? linked[0] : undefined;
    if (!region) continue;
    const point = regionReportPoint(region);
    if (!point) continue;
    const previous = result.get(region.id);
    if (!previous || (event.date || '') >= (previous.event.date || '')) {
      result.set(region.id, { id: event.id, regionId: region.id, point, event });
    }
  }
  return [...result.values()].sort((a, b) => (b.event.date || '').localeCompare(a.event.date || '')).slice(0, 24);
}
