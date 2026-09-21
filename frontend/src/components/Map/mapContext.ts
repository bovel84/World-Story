import type { MilitaryUnitPayload, OperatingObjectPayload, OperatingPicturePayload, WarFrontPayload } from '../../services/api';
import type { Region } from '../../types';

/**
 * MAP P4 — la selezione della mappa conserva soltanto identità canoniche.
 * Gli oggetti vengono sempre risolti contro lo snapshot corrente: nessuna copia
 * di regione, reparto o fronte può sopravvivere a rewind/restore/refresh.
 */
export type MapContextSelection =
  | { kind: 'region'; regionId: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'front'; frontId: string }
  | null;

export interface MapContextIndex {
  regionsById: ReadonlyMap<string, Region>;
  unitsById: ReadonlyMap<string, MilitaryUnitPayload>;
  frontsById: ReadonlyMap<string, WarFrontPayload>;
  unitsByRegion: ReadonlyMap<string, readonly MilitaryUnitPayload[]>;
  frontsByRegion: ReadonlyMap<string, readonly WarFrontPayload[]>;
  unitsByFront: ReadonlyMap<string, readonly MilitaryUnitPayload[]>;
}

export type ResolvedMapContext =
  | { kind: 'region'; region: Region }
  | { kind: 'unit'; unit: MilitaryUnitPayload }
  | { kind: 'front'; front: WarFrontPayload };

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

/** Indici economici per ID: costruire una volta con `useMemo`, non a ogni click. */
export function buildMapContextIndex(input: {
  regions: readonly Region[];
  units: readonly MilitaryUnitPayload[];
  fronts: readonly WarFrontPayload[];
}): MapContextIndex {
  const regionsById = new Map(input.regions.map(region => [region.id, region]));
  const unitsById = new Map(input.units.map(unit => [unit.id, unit]));
  const frontsById = new Map(input.fronts.map(front => [front.id, front]));
  const unitsByRegion = new Map<string, MilitaryUnitPayload[]>();
  const frontsByRegion = new Map<string, WarFrontPayload[]>();
  const unitsByFront = new Map<string, MilitaryUnitPayload[]>();

  for (const unit of input.units) {
    if (unit.regionId) append(unitsByRegion, unit.regionId, unit);
    if (unit.frontId) append(unitsByFront, unit.frontId, unit);
  }
  for (const front of input.fronts) {
    if (front.status === 'closed') continue;
    for (const regionId of front.regionIds) append(frontsByRegion, regionId, front);
  }

  return { regionsById, unitsById, frontsById, unitsByRegion, frontsByRegion, unitsByFront };
}

/** Risolve un ID contro lo snapshot canonico corrente; ID assente/chiuso → null. */
export function resolveMapContext(
  selection: MapContextSelection,
  index: MapContextIndex,
): ResolvedMapContext | null {
  if (!selection) return null;
  if (selection.kind === 'region') {
    const region = index.regionsById.get(selection.regionId);
    return region ? { kind: 'region', region } : null;
  }
  if (selection.kind === 'unit') {
    const unit = index.unitsById.get(selection.unitId);
    return unit && unit.status !== 'destroyed' ? { kind: 'unit', unit } : null;
  }
  const front = index.frontsById.get(selection.frontId);
  return front && front.status !== 'closed' ? { kind: 'front', front } : null;
}

/** Regione geografica associata al contesto, senza trasformarla in authority. */
export function mapContextRegionId(context: ResolvedMapContext | null): string | null {
  if (!context) return null;
  if (context.kind === 'region') return context.region.id;
  if (context.kind === 'unit') return context.unit.regionId;
  return context.front.objectiveRegionId || context.front.regionIds[0] || null;
}

/** L'authority del reparto è sempre la sua polity, mai il proprietario del suolo. */
export function playerControlsUnit(unit: Pick<MilitaryUnitPayload, 'polityId'>, playerPolityId: string): boolean {
  return Boolean(playerPolityId) && unit.polityId === playerPolityId;
}

/**
 * Join canonico fra persistent unit e OperatingObject: stesso ID e kind unit.
 * Se manca, la mappa degrada a dettaglio read-only; non sintetizza azioni.
 */
export function operatingObjectForUnit(
  picture: OperatingPicturePayload | null | undefined,
  unitId: string,
): OperatingObjectPayload | null {
  return picture?.objects.find(object => object.kind === 'unit' && object.id === unitId) ?? null;
}
