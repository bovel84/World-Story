import type { MilitaryUnitPayload, WarFrontPayload } from '../../services/api';
import type { MapObject, Region } from '../../types';
import { parseRegionGeometry } from './mapModel';

export type MilitaryMapCoordinate = [number, number];

export type MilitaryMapUnitPayload = MilitaryUnitPayload;

export interface MilitaryPolityPresentation {
  id: string;
  name: string;
  color: string;
  flag: string | null;
}

export interface MilitaryMovementRoute extends NonNullable<MilitaryUnitPayload['movement']> {
  /** The committed remainder of the engine path. No client-side pathfinding. */
  path: string[];
  anchors: Array<{ regionId: string; point: MilitaryMapCoordinate | null }>;
}

export type MilitaryMapUnit = Omit<MilitaryUnitPayload, 'movement'> & {
  source: 'persistent';
  point: MilitaryMapCoordinate | null;
  polity: MilitaryPolityPresentation;
  movement?: MilitaryMovementRoute;
};

export interface MilitaryMapFront extends WarFrontPayload {
  /** Visible persistent units assigned by their own `frontId`. */
  unitIds: string[];
  /** Assigned units which are neither destroyed nor currently moving. */
  activeCombatUnitIds: string[];
}

export interface LegacyMilitaryMapObject {
  source: 'legacy';
  id: string;
  regionId: string;
  polityId: string;
  point: MilitaryMapCoordinate | null;
  polity: MilitaryPolityPresentation;
  object: MapObject;
}

export interface MilitaryUnitDensity<T> {
  visible: T[];
  overflow: number;
  total: number;
}

export interface MilitaryMapReadModel {
  regionAnchors: Record<string, MilitaryMapCoordinate>;
  polities: Record<string, MilitaryPolityPresentation>;
  units: MilitaryMapUnit[];
  unitsByRegion: Record<string, MilitaryMapUnit[]>;
  stacksByRegion: Record<string, MilitaryUnitDensity<MilitaryMapUnit>>;
  movements: Array<{ unitId: string; polityId: string; route: MilitaryMovementRoute }>;
  fronts: MilitaryMapFront[];
  /** Legacy map objects left only when no persistent unit/army has the exact id. */
  legacyObjects: LegacyMilitaryMapObject[];
}

export const MILITARY_UNITS_PER_REGION = 3;
const LEGACY_MILITARY_TYPES = new Set(['army', 'battalion', 'fleet', 'missile']);
const FALLBACK_POLITY_COLORS = ['#78909c', '#8d7f6f', '#6f8799', '#8d6f78', '#748c79', '#80739a'];

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function unitPolityId(unit: MilitaryUnitPayload): string {
  if (!unit.polityId) throw new TypeError(`Military unit ${unit.id} has no polityId`);
  return unit.polityId;
}

const finiteCoordinate = (lng: number, lat: number): MilitaryMapCoordinate | null =>
  Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? [lng, lat] : null;

/**
 * A deterministic anchor from valid region GeoJSON. For MultiPolygons the
 * centroid of the largest exterior ring is used. Degenerate, but otherwise
 * valid, rings fall back to their bounding-box centre.
 */
export function militaryRegionAnchor(region: Pick<Region, 'geojson'>): MilitaryMapCoordinate | null {
  const geometry = parseRegionGeometry(region.geojson);
  if (!geometry) return null;
  const rings = geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map(polygon => polygon[0]);

  let selected: { area: number; point: MilitaryMapCoordinate | null; ring: GeoJSON.Position[] } | null = null;
  for (const ring of rings) {
    let area = 0;
    let x = 0;
    let y = 0;
    for (let index = 0; index < ring.length - 1; index++) {
      const [ax, ay] = ring[index];
      const [bx, by] = ring[index + 1];
      const cross = ax * by - bx * ay;
      area += cross;
      x += (ax + bx) * cross;
      y += (ay + by) * cross;
    }
    const magnitude = Math.abs(area);
    const point = magnitude > 1e-8 ? finiteCoordinate(x / (3 * area), y / (3 * area)) : null;
    if (!selected || magnitude > selected.area) selected = { area: magnitude, point, ring };
  }
  if (!selected) return null;
  if (selected.point) return selected.point;

  const lngs = selected.ring.map(position => position[0]);
  const lats = selected.ring.map(position => position[1]);
  return finiteCoordinate(
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  );
}

/** Fixed map density: at most three counters, followed by an overflow count. */
export function militaryUnitDensity<T>(items: readonly T[]): MilitaryUnitDensity<T> {
  return {
    visible: items.slice(0, MILITARY_UNITS_PER_REGION),
    overflow: Math.max(0, items.length - MILITARY_UNITS_PER_REGION),
    total: items.length,
  };
}

function regionOrder(a: Region, b: Region): number {
  const aCapital = Boolean(a.metadata?.isCapitalProvince);
  const bCapital = Boolean(b.metadata?.isCapitalProvince);
  return Number(bCapital) - Number(aCapital) || compareText(a.id, b.id);
}

/** Presentation never comes from the territory in which a unit happens to be. */
export function militaryPolityPresentation(
  polityId: string,
  regions: readonly Region[],
): MilitaryPolityPresentation {
  const owned = regions.filter(region => region.owner === polityId).sort(regionOrder);
  const named = owned.find(region => Boolean(region.polityName)) ?? owned[0];
  const visual = owned[0];
  let hash = 0;
  for (const char of polityId) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return {
    id: polityId,
    name: named?.polityName || named?.name || polityId,
    color: visual?.color || FALLBACK_POLITY_COLORS[hash % FALLBACK_POLITY_COLORS.length],
    flag: visual?.flag || null,
  };
}

function compareUnits(a: MilitaryMapUnit, b: MilitaryMapUnit): number {
  return compareText(a.polityId, b.polityId)
    || compareText(a.armyId, b.armyId)
    || compareText(a.id, b.id);
}

function compareNullableRegion(a: { regionId: string | null }, b: { regionId: string | null }): number {
  return compareText(a.regionId || '', b.regionId || '');
}

function buildModel(
  regions: readonly Region[],
  sourceUnits: readonly MilitaryUnitPayload[],
  sourceFronts: readonly WarFrontPayload[],
): MilitaryMapReadModel {
  const orderedRegions = [...regions].sort((a, b) => compareText(a.id, b.id));
  const regionsById = new Map(orderedRegions.map(region => [region.id, region]));
  const anchors = new Map<string, MilitaryMapCoordinate>();
  for (const region of orderedRegions) {
    const point = militaryRegionAnchor(region);
    if (point) anchors.set(region.id, point);
  }

  const polityIds = new Set<string>();
  for (const unit of sourceUnits) polityIds.add(unitPolityId(unit));
  for (const front of sourceFronts) {
    polityIds.add(front.attackerPolityId);
    polityIds.add(front.defenderPolityId);
    if (front.momentumPolityId) polityIds.add(front.momentumPolityId);
  }
  for (const region of orderedRegions) for (const object of region.objects || []) {
    if (LEGACY_MILITARY_TYPES.has(object.type)) polityIds.add(object.owner || region.owner);
  }
  const polities = Object.create(null) as Record<string, MilitaryPolityPresentation>;
  for (const polityId of [...polityIds].sort(compareText)) {
    polities[polityId] = militaryPolityPresentation(polityId, orderedRegions);
  }

  const units = sourceUnits
    .filter(unit => unit.status !== 'destroyed')
    .map((unit): MilitaryMapUnit => {
      const polityId = unitPolityId(unit);
      const point = unit.regionId ? anchors.get(unit.regionId) ?? null : null;
      const { movement: sourceMovement, ...unitWithoutMovement } = unit;
      const movement: MilitaryMovementRoute | undefined = sourceMovement
        ? {
          ...sourceMovement,
          path: sourceMovement.path.slice(sourceMovement.pathIndex),
          anchors: sourceMovement.path.slice(sourceMovement.pathIndex)
            .map(regionId => ({ regionId, point: anchors.get(regionId) ?? null })),
        }
        : undefined;
      return {
        ...unitWithoutMovement,
        polityId,
        source: 'persistent',
        point,
        polity: polities[polityId] ?? militaryPolityPresentation(polityId, orderedRegions),
        ...(movement ? { movement } : {}),
      };
    })
    .sort((a, b) => compareNullableRegion(a, b) || compareUnits(a, b));

  const unitsByRegion = Object.create(null) as Record<string, MilitaryMapUnit[]>;
  for (const unit of units) {
    if (!unit.regionId || !regionsById.has(unit.regionId)) continue;
    (unitsByRegion[unit.regionId] ??= []).push(unit);
  }
  const stacksByRegion = Object.create(null) as Record<string, MilitaryUnitDensity<MilitaryMapUnit>>;
  for (const regionId of Object.keys(unitsByRegion).sort(compareText)) {
    unitsByRegion[regionId].sort(compareUnits);
    stacksByRegion[regionId] = militaryUnitDensity(unitsByRegion[regionId]);
  }

  const movements = units
    .filter((unit): unit is MilitaryMapUnit & { movement: MilitaryMovementRoute } => Boolean(unit.movement))
    .map(unit => ({ unitId: unit.id, polityId: unit.polityId, route: unit.movement }));

  const fronts = sourceFronts
    .filter(front => front.status !== 'closed')
    .map(front => {
      const assigned = units.filter(unit => unit.frontId === front.id);
      return {
        ...front,
        regionIds: [...front.regionIds],
        unitIds: assigned.map(unit => unit.id),
        activeCombatUnitIds: assigned.filter(unit => !unit.movement).map(unit => unit.id),
      };
    })
    .sort((a, b) => compareText(a.id, b.id));

  // Match against every persistent record, including destroyed records: a
  // destroyed persistent unit must not resurrect through its legacy marker.
  const persistentIds = new Set<string>();
  for (const unit of sourceUnits) {
    persistentIds.add(unit.id);
    persistentIds.add(unit.armyId);
  }
  const legacyObjects: LegacyMilitaryMapObject[] = [];
  for (const region of orderedRegions) {
    for (const object of region.objects || []) {
      if (!LEGACY_MILITARY_TYPES.has(object.type) || persistentIds.has(object.id)) continue;
      const polityId = object.owner || region.owner;
      legacyObjects.push({
        source: 'legacy', id: object.id, regionId: region.id, polityId,
        point: anchors.get(region.id) ?? null, polity: polities[polityId], object,
      });
    }
  }
  legacyObjects.sort((a, b) => compareText(a.regionId, b.regionId) || compareText(a.id, b.id));

  const regionAnchors = Object.create(null) as Record<string, MilitaryMapCoordinate>;
  for (const [regionId, point] of anchors) regionAnchors[regionId] = point;

  return { regionAnchors, polities, units, unitsByRegion, stacksByRegion, movements, fronts, legacyObjects };
}

export function buildMilitaryMapModel(input: {
  regions: readonly Region[];
  units: readonly MilitaryUnitPayload[];
  fronts: readonly WarFrontPayload[];
}): MilitaryMapReadModel;
export function buildMilitaryMapModel(
  regions: readonly Region[],
  units: readonly MilitaryUnitPayload[],
  fronts?: readonly WarFrontPayload[],
): MilitaryMapReadModel;
export function buildMilitaryMapModel(
  inputOrRegions: { regions: readonly Region[]; units: readonly MilitaryUnitPayload[]; fronts: readonly WarFrontPayload[] } | readonly Region[],
  units: readonly MilitaryUnitPayload[] = [],
  fronts: readonly WarFrontPayload[] = [],
): MilitaryMapReadModel {
  if (Array.isArray(inputOrRegions)) {
    return buildModel(inputOrRegions as readonly Region[], units, fronts);
  }
  const input = inputOrRegions as {
    regions: readonly Region[];
    units: readonly MilitaryUnitPayload[];
    fronts: readonly WarFrontPayload[];
  };
  return buildModel(input.regions, input.units, input.fronts);
}
