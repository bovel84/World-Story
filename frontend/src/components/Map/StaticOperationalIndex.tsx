/** Read-only operational index for the SVG/GeoJSON fallback when WebGL is
 * unavailable. Nothing here changes military state, assets or the world map. */
import type { Region } from '../../types';
import type { MilitaryUnitPayload } from '../../services/api';
import type { CanonicalFacilitySite } from './thematicMapModel';

export interface StaticOperationalEntry {
  id: string;
  kind: 'unit' | 'facility' | 'infrastructure';
  regionId: string;
  name: string;
  regionName: string;
  status: string;
}

const INFRA_TYPES = new Set([
  'factory', 'port', 'airport', 'airfield', 'road', 'railway',
  'rail', 'power_plant', 'powerplant', 'dam', 'university',
  'construction_site', 'construction', 'hospital', 'mine',
]);

export function staticOperationalEntries(
  regions: readonly Region[],
  units: readonly MilitaryUnitPayload[],
  worldFacilities: readonly CanonicalFacilitySite[],
  playerPolityId: string,
): StaticOperationalEntry[] {
  const regionById = new Map(regions.map(region => [region.id, region]));
  const result: StaticOperationalEntry[] = [];
  const knownInfrastructure = new Set<string>();

  for (const unit of units) {
    if (unit.polityId !== playerPolityId || unit.status === 'destroyed' || !unit.regionId) continue;
    const region = regionById.get(unit.regionId);
    if (!region) continue;
    result.push({
      id: unit.id, kind: 'unit', regionId: region.id,
      regionName: region.name, name: unit.name,
      status: unit.movement ? 'in movimento' : unit.status,
    });
  }

  for (const facility of worldFacilities) {
    const region = regionById.get(facility.regionId);
    if (!region) continue;
    const controller = facility.controllerPolityId || facility.polityId || region.owner;
    if (controller !== playerPolityId) continue;
    const label = facility.typeName.trim() || facility.typeId;
    const fingerprint = [region.id, label.toLowerCase()].join(':');
    knownInfrastructure.add(fingerprint);
    result.push({
      id: facility.id, kind: 'facility', regionId: region.id,
      regionName: region.name, name: label,
      status: facility.operational ? 'operativo' : 'non operativo',
    });
  }

  // Only real, persisted map objects: no visual factory from an unapproved
  // proposal or an LLM description. Current owner controls visibility.
  for (const region of regions) {
    if (region.owner !== playerPolityId) continue;
    for (const object of region.objects ?? []) {
      if (!INFRA_TYPES.has(object.type.toLowerCase())) continue;
      if (object.owner && object.owner !== playerPolityId) continue;
      const name = object.name || object.type;
      const fingerprint = [region.id, name.toLowerCase()].join(':');
      if (knownInfrastructure.has(fingerprint)) continue;
      knownInfrastructure.add(fingerprint);
      result.push({
        id: object.id, kind: 'infrastructure', regionId: region.id,
        regionName: region.name, name, status: 'registrato sulla mappa',
      });
    }
  }
  return result;
}

export function StaticOperationalIndex({ entries, onRegionClick, onUnitClick }: {
  entries: readonly StaticOperationalEntry[];
  onRegionClick?: (regionId: string) => void;
  onUnitClick?: (unitId: string) => void;
}) {
  if (!entries.length) return null;
  const units = entries.filter(entry => entry.kind === 'unit');
  const sites = entries.filter(entry => entry.kind !== 'unit');
  return <details className="static-map-operational-index">
    <summary>Situazione operativa · {units.length} reparti · {sites.length} impianti e infrastrutture</summary>
    <p>Posizioni e stati confermati dalla partita. Seleziona una voce per aprire il relativo contesto.</p>
    <div className="static-map-operational-groups">
      {([['Reparti', units], ['Impianti e infrastrutture', sites]] as const).map(([title, items]) =>
        items.length > 0 && <section key={title}>
          <h4>{title}</h4>
          <ul>{items.map(entry => <li key={entry.kind + ':' + entry.id}>
            <button type="button" onClick={() => entry.kind === 'unit' && onUnitClick
              ? onUnitClick(entry.id) : onRegionClick?.(entry.regionId)}
              disabled={!onRegionClick && !(entry.kind === 'unit' && onUnitClick)}>
              <strong>{entry.name}</strong>
              <span>{entry.regionName} · {entry.status}</span>
            </button>
          </li>)}</ul>
        </section>)}
    </div>
  </details>;
}
