import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Map as LibreMap, GeoJSONSource } from 'maplibre-gl';
import type { Region } from '../../types';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { createMilitarySymbol } from './militarySymbol';
import { parseRegionGeometry } from './mapModel';
import type {
  MilitaryMapCoordinate,
  MilitaryMapFront,
  MilitaryMapReadModel,
  MilitaryMapUnit,
} from './militaryMapModel';
import './military-state.css';

const FRONT_SOURCE = 'military-current-fronts';
const FRONT_FILL = 'military-current-fronts-fill';
const FRONT_LINE = 'military-current-fronts-line';
const STATUS_LABEL: Record<string, string> = {
  forming: 'in formazione', operational: 'operativo', degraded: 'degradato',
  retreating: 'in ripiegamento', destroyed: 'distrutto', active: 'attivo',
  stalemate: 'stallo', breakthrough: 'sfondamento', collapsed: 'collassato', closed: 'chiuso',
};
const ORDER_LABEL: Record<string, string> = {
  attack: 'Attacca', defend: 'Difendi', reserve: 'Riserva', withdraw: 'Ripiega',
};

function MilitaryCounterSymbol() {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!host.current || host.current.firstChild) return;
    host.current.append(createMilitarySymbol('battalion'));
  }, []);
  return <span className="military-counter-symbol" ref={host} aria-hidden="true" />;
}

function nearCamera(point: MilitaryMapCoordinate, centerLng: number): MilitaryMapCoordinate {
  return [point[0] + 360 * Math.round((centerLng - point[0]) / 360), point[1]];
}

function frontFeatures(model: MilitaryMapReadModel, regions: Region[]): GeoJSON.FeatureCollection {
  const byId = new Map(regions.map(region => [region.id, region]));
  const features: GeoJSON.Feature[] = [];
  for (const front of model.fronts) for (const regionId of front.regionIds) {
    const geometry = parseRegionGeometry(byId.get(regionId)?.geojson);
    if (!geometry) continue;
    features.push({
      type: 'Feature', id: `${front.id}:${regionId}`, geometry,
      properties: { frontId: front.id, regionId, status: front.status },
    });
  }
  return { type: 'FeatureCollection', features };
}

function formatPressure(value: number): string {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDate(value?: string | null): string {
  return value ? value.split('-').reverse().join('.') : '—';
}

function equipmentRows(equipment: Record<string, number>): Array<[string, number]> {
  return Object.entries(equipment).filter(([, quantity]) => Number.isFinite(quantity) && quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function MilitaryStateOverlay({
  map,
  regions,
  model,
  visible,
  loading = false,
  error = null,
  playerPolityId,
  onFocusRegion,
}: {
  map: LibreMap;
  regions: Region[];
  model: MilitaryMapReadModel;
  visible: boolean;
  loading?: boolean;
  error?: string | null;
  playerPolityId?: string;
  onFocusRegion: (regionId: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedFrontId, setSelectedFrontId] = useState<string | null>(null);
  const [selectedRegionStack, setSelectedRegionStack] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<{ regionId: string; polityId: string } | null>(null);
  const arrowId = useId().replace(/:/g, '');

  const regionNames = useMemo(() => new Map(regions.map(region => [region.id, region.name])), [regions]);

  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; setRevision(value => value + 1); });
    };
    map.on('move', refresh);
    map.on('resize', refresh);
    return () => { cancelAnimationFrame(frame); map.off('move', refresh); map.off('resize', refresh); };
  }, [map]);

  useEffect(() => {
    const data = visible ? frontFeatures(model, regions) : { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
    const source = map.getSource(FRONT_SOURCE) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource(FRONT_SOURCE, { type: 'geojson', data });
      map.addLayer({
        id: FRONT_FILL, type: 'fill', source: FRONT_SOURCE,
        paint: { 'fill-color': '#d99052', 'fill-opacity': 0.13 },
      }, map.getLayer('regions-line') ? 'regions-line' : undefined);
      map.addLayer({
        id: FRONT_LINE, type: 'line', source: FRONT_SOURCE,
        paint: { 'line-color': '#ffd08a', 'line-width': 2.2, 'line-opacity': 0.82, 'line-dasharray': [2, 2] },
      });
    }
    return () => {
      if (!map.getStyle()) return;
      if (map.getLayer(FRONT_LINE)) map.removeLayer(FRONT_LINE);
      if (map.getLayer(FRONT_FILL)) map.removeLayer(FRONT_FILL);
      if (map.getSource(FRONT_SOURCE)) map.removeSource(FRONT_SOURCE);
    };
  }, [map]);

  useEffect(() => {
    const source = map.getSource(FRONT_SOURCE) as GeoJSONSource | undefined;
    if (source) source.setData(visible ? frontFeatures(model, regions) : { type: 'FeatureCollection', features: [] });
  }, [map, model, regions, visible]);

  useEffect(() => {
    if (!visible) {
      setSelectedUnitId(null);
      setSelectedFrontId(null);
      setSelectedRegionStack(null);
      setSelectedGroup(null);
    }
  }, [visible]);

  useEffect(() => {
    if (selectedUnitId && !model.units.some(unit => unit.id === selectedUnitId)) setSelectedUnitId(null);
    if (selectedFrontId && !model.fronts.some(front => front.id === selectedFrontId)) setSelectedFrontId(null);
    if (selectedRegionStack && !model.stacksByRegion[selectedRegionStack]) setSelectedRegionStack(null);
    if (selectedGroup && !model.groupsByRegion[selectedGroup.regionId]
      ?.some(group => group.polityId === selectedGroup.polityId)) setSelectedGroup(null);
  }, [model, selectedFrontId, selectedGroup, selectedRegionStack, selectedUnitId]);

  const projection = useMemo(() => {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerLng = map.getCenter().lng;
    const zoom = map.getZoom();
    const units: Array<{
      unit: MilitaryMapUnit; x: number; y: number; offset: number;
      aggregate?: number; groupPolityId?: string;
    }> = [];
    const overflows: Array<{ regionId: string; count: number; total: number; x: number; y: number }> = [];

    for (const [regionId, stack] of Object.entries(model.stacksByRegion)) {
      const anchor = model.regionAnchors[regionId];
      if (!anchor) continue;
      const point = map.project(nearCamera(anchor, centerLng));
      if (point.x < -90 || point.x > width + 90 || point.y < -70 || point.y > height + 70) continue;
      if (zoom < 2.2) {
        // Zoom mondo: un counter aggregato per polity. Mai mescolare le
        // nazionalità: [AAA 2] [BBB 1], con offset deterministici.
        const groups = model.groupsByRegion[regionId] || [];
        groups.forEach((group, index) => {
          const lead = group.visible[0];
          if (!lead) return;
          units.push({
            unit: lead, x: point.x, y: point.y,
            offset: (index - (groups.length - 1) / 2) * 44,
            aggregate: group.total, groupPolityId: group.polityId,
          });
        });
        continue;
      }
      stack.visible.forEach((unit, index) => units.push({
        unit, x: point.x, y: point.y, offset: (index - (stack.visible.length - 1) / 2) * 34,
      }));
      if (stack.overflow > 0) overflows.push({
        regionId, count: stack.overflow, total: stack.total, x: point.x, y: point.y + 31,
      });
    }

    const movements = model.movements.flatMap(movement => {
      const anchors = movement.route.anchors.filter((item): item is { regionId: string; point: MilitaryMapCoordinate } => Boolean(item.point));
      if (anchors.length < 2) return [];
      const coordinates: MilitaryMapCoordinate[] = [];
      for (const item of anchors) {
        const previous = coordinates[coordinates.length - 1];
        const previousLng = previous ? previous[0] : centerLng;
        coordinates.push(nearCamera(item.point, previousLng));
      }
      const points = coordinates.map(point => map.project(point));
      if (points.every(point => point.x < 0 || point.x > width || point.y < 0 || point.y > height)) return [];
      const target = points[points.length - 1];
      return [{ ...movement, d: points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' '), target }];
    });

    const fronts = model.fronts.flatMap(front => {
      const regionId = front.objectiveRegionId && model.regionAnchors[front.objectiveRegionId]
        ? front.objectiveRegionId : front.regionIds.find(id => model.regionAnchors[id]);
      if (!regionId) return [];
      const point = map.project(nearCamera(model.regionAnchors[regionId], centerLng));
      if (point.x < -50 || point.x > width + 50 || point.y < -80 || point.y > height + 50) return [];
      // Staccato dal counter della regione obiettivo, così resta cliccabile.
      return [{ front, regionId, x: point.x, y: point.y - 52 }];
    });
    return { units, overflows, movements, fronts };
  }, [map, model, revision]);

  if (!visible) return null;
  const selectedUnit = model.units.find(unit => unit.id === selectedUnitId) ?? null;
  const selectedFront = model.fronts.find(front => front.id === selectedFrontId) ?? null;
  const selectedStack = selectedRegionStack ? model.unitsByRegion[selectedRegionStack] || [] : [];
  const selectedGroupUnits = selectedGroup
    ? model.groupsByRegion[selectedGroup.regionId]?.find(group => group.polityId === selectedGroup.polityId)?.units ?? []
    : [];
  const selectedGroupPolity = selectedGroup ? model.polities[selectedGroup.polityId] : null;
  const selectedGroupRegionName = selectedGroup
    ? regionNames.get(selectedGroup.regionId) || selectedGroup.regionId : '';
  const selectedGroupRegionTotal = selectedGroup
    ? model.unitsByRegion[selectedGroup.regionId]?.length || 0 : 0;
  const dialogOpen = Boolean(selectedUnit || selectedFront || selectedRegionStack || selectedGroup);
  const closeDialog = () => {
    setSelectedUnitId(null); setSelectedFrontId(null);
    setSelectedRegionStack(null); setSelectedGroup(null);
  };
  const selectUnit = (id: string) => {
    setSelectedFrontId(null); setSelectedRegionStack(null); setSelectedGroup(null); setSelectedUnitId(id);
  };
  const selectFront = (id: string) => {
    setSelectedUnitId(null); setSelectedRegionStack(null); setSelectedGroup(null); setSelectedFrontId(id);
  };
  const selectGroup = (regionId: string, polityId: string) => {
    setSelectedUnitId(null); setSelectedFrontId(null); setSelectedRegionStack(null);
    setSelectedGroup({ regionId, polityId });
  };

  return <>
    <svg className="military-state-routes" aria-hidden="true">
      <defs>
        <marker id={`${arrowId}-player`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L9 5 1 9" fill="none" stroke="#9de5e0" strokeWidth="2" /></marker>
        <marker id={`${arrowId}-other`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L9 5 1 9" fill="none" stroke="#ffd08a" strokeWidth="2" /></marker>
      </defs>
      {projection.movements.map(movement => {
        const own = movement.polityId === playerPolityId;
        return <g key={movement.unitId} className={`military-active-route${own ? ' own' : ''}`}
          data-movement-unit-id={movement.unitId} data-route-path={movement.route.path.join(',')}>
          <path className="military-active-route-shadow" d={movement.d} />
          <path className="military-active-route-line" d={movement.d} markerEnd={`url(#${arrowId}-${own ? 'player' : 'other'})`} />
          <rect x={movement.target.x - 5} y={movement.target.y - 5} width="10" height="10" transform={`rotate(45 ${movement.target.x} ${movement.target.y})`} />
        </g>;
      })}
    </svg>

    <div className="military-state-fronts">
      {projection.fronts.map(({ front, regionId, x, y }) => <button type="button" key={front.id}
        className={`military-front-badge status-${front.status}`} data-front-id={front.id}
        data-objective-region={front.objectiveRegionId || ''} style={{ left: x, top: y }}
        aria-label={`${front.name}, ${STATUS_LABEL[front.status] || front.status}, apri dettaglio`}
        onClick={() => selectFront(front.id)}>
        <span aria-hidden="true">FR</span><small>{front.name}</small>
        {front.objectiveRegionId === regionId && <i aria-hidden="true">◎</i>}
      </button>)}
    </div>

    <div className="military-state-units">
      {projection.units.map(({ unit, x, y, offset, aggregate, groupPolityId }) => <button type="button" key={`${unit.regionId}:${unit.id}`}
        className={`military-unit-counter status-${unit.status}${unit.movement ? ' moving' : ''}${aggregate ? ' aggregate' : ''}`}
        data-unit-id={unit.id} data-unit-polity={unit.polityId} data-unit-region={unit.regionId || ''}
        data-unit-status={unit.status} data-unit-moving={unit.movement ? 'true' : 'false'}
        data-unit-aggregate={aggregate ? String(aggregate) : ''}
        style={{ left: x + offset, top: y, '--unit-color': unit.polity.color } as CSSProperties}
        aria-label={aggregate
          ? `${aggregate} reparti ${unit.polity.name} in ${regionNames.get(unit.regionId || '') || unit.regionName || unit.regionId}, apri elenco`
          : `${unit.name}, ${unit.polity.name}, ${unit.personnel.toLocaleString('it-IT')} uomini, ${STATUS_LABEL[unit.status] || unit.status}${unit.movement ? ', in trasferimento' : ''}`}
        onClick={() => aggregate
          ? (groupPolityId ? selectGroup(unit.regionId as string, groupPolityId) : setSelectedRegionStack(unit.regionId))
          : selectUnit(unit.id)}>
        <span className="military-counter-visual"><MilitaryCounterSymbol /><b>{aggregate || ''}</b></span>
        <span className="military-counter-flag" aria-hidden="true">{unit.polity.flag || unit.polityId.slice(0, 3)}</span>
        <span className="military-counter-state" aria-hidden="true">{unit.movement ? '→' : unit.status === 'retreating' ? '↙' : unit.status === 'degraded' ? '!' : ''}</span>
      </button>)}
      {projection.overflows.map(item => <button type="button" className="military-unit-overflow" key={item.regionId}
        data-unit-overflow-region={item.regionId} style={{ left: item.x, top: item.y }}
        aria-label={`Altri ${item.count} reparti, ${item.total} totali nella regione`}
        onClick={() => setSelectedRegionStack(item.regionId)}>+{item.count}</button>)}
    </div>

    {error && <div className="military-state-unavailable" role="status">{error}</div>}
    {!error && loading && <div className="military-state-loading" role="status">Aggiornamento situazione militare…</div>}

    <AccessibleDialog open={dialogOpen} onClose={closeDialog} className="military-state-report"
      overlayClassName="military-state-report-backdrop" ariaLabel={selectedUnit ? `Reparto ${selectedUnit.name}` : selectedFront ? `Fronte ${selectedFront.name}` : selectedGroup ? `Reparti ${selectedGroupPolity?.name || selectedGroup.polityId} in ${selectedGroupRegionName}` : 'Reparti nella regione'}>
      <header>
        <div><small>STATO OPERATIVO ATTUALE</small><h2>{selectedUnit?.name || selectedFront?.name
          || (selectedGroup ? `Reparti ${selectedGroupPolity?.name || selectedGroup.polityId} in ${selectedGroupRegionName}` : 'Reparti nella regione')}</h2></div>
        <button type="button" onClick={closeDialog} aria-label="Chiudi dettaglio militare">×</button>
      </header>

      {selectedUnit && <UnitDetail unit={selectedUnit} model={model} regions={regions}
        onFocus={() => selectedUnit.regionId && onFocusRegion(selectedUnit.regionId)} />}
      {selectedFront && <FrontDetail front={selectedFront} model={model} regions={regions}
        onSelectUnit={selectUnit} onFocus={() => {
          const target = selectedFront.objectiveRegionId || selectedFront.regionIds[0];
          if (target) onFocusRegion(target);
        }} />}
      {selectedGroup && <section className="military-stack-detail" data-polity-group-region={selectedGroup.regionId}
        data-polity-group={selectedGroup.polityId}>
        <p>{selectedGroupUnits.length} reparti {selectedGroupPolity?.name || selectedGroup.polityId} in {selectedGroupRegionName}. L’ordine è deterministico; nessun reparto è scartato.</p>
        <ul>{selectedGroupUnits.map(unit => <li key={unit.id}><button type="button" onClick={() => selectUnit(unit.id)}>
          <span><strong>{unit.name}</strong><small>{unit.polity.name} · {STATUS_LABEL[unit.status] || unit.status}{unit.movement ? ' · in trasferimento' : ''}</small></span><span>↗</span>
        </button></li>)}</ul>
        {selectedGroupRegionTotal > selectedGroupUnits.length && <button type="button"
          onClick={() => { setSelectedGroup(null); setSelectedRegionStack(selectedGroup.regionId); }}>
          Vedi tutti i {selectedGroupRegionTotal} reparti della regione ↗
        </button>}
      </section>}
      {selectedRegionStack && <section className="military-stack-detail">
        <p>{selectedStack.length} reparti persistenti. L’ordine è deterministico; nessun reparto è scartato.</p>
        <ul>{selectedStack.map(unit => <li key={unit.id}><button type="button" onClick={() => selectUnit(unit.id)}>
          <span><strong>{unit.name}</strong><small>{unit.polity.name} · {STATUS_LABEL[unit.status] || unit.status}{unit.movement ? ' · in trasferimento' : ''}</small></span><span>↗</span>
        </button></li>)}</ul>
      </section>}
    </AccessibleDialog>
  </>;
}

function UnitDetail({ unit, model, regions, onFocus }: {
  unit: MilitaryMapUnit; model: MilitaryMapReadModel; regions: Region[]; onFocus: () => void;
}) {
  const front = unit.frontId ? model.fronts.find(item => item.id === unit.frontId) : null;
  const region = regions.find(item => item.id === unit.regionId);
  const equipment = equipmentRows(unit.equipment);
  return <article className="military-detail-body">
    <dl>
      <div><dt>Politia</dt><dd>{unit.polity.name} <small>({unit.polityId})</small></dd></div>
      <div><dt>Armata</dt><dd>{unit.armyId}</dd></div>
      <div><dt>Posizione</dt><dd>{region?.name || unit.regionName || unit.regionId || 'Non assegnata'}</dd></div>
      <div><dt>Personale</dt><dd>{unit.personnel.toLocaleString('it-IT')}</dd></div>
      <div><dt>Prontezza</dt><dd>{Math.round(unit.readiness * 100)}%</dd></div>
      <div><dt>Stato</dt><dd>{STATUS_LABEL[unit.status] || unit.status}</dd></div>
      <div><dt>Ordine</dt><dd>{ORDER_LABEL[unit.order] || unit.order}</dd></div>
      <div><dt>Fronte</dt><dd>{unit.movement ? 'Fuori combattimento · in trasferimento' : front?.name || 'Nessuno'}</dd></div>
    </dl>
    <section><h3>Equipaggiamento pubblicato</h3>{equipment.length
      ? <ul>{equipment.map(([id, quantity]) => <li key={id}><span>{id}</span><strong>{quantity.toLocaleString('it-IT')}</strong></li>)}</ul>
      : <p>Nessun equipaggiamento pubblicato.</p>}</section>
    {unit.movement && <section data-movement-detail={unit.id}><h3>In trasferimento</h3><dl>
      <div><dt>Destinazione</dt><dd>{unit.movement.targetRegionName || unit.movement.targetRegionId}</dd></div>
      <div><dt>Tratta corrente</dt><dd>{unit.movement.path[0] || unit.regionId} → {unit.movement.path[1] || unit.movement.targetRegionId}</dd></div>
      <div><dt>Tratte</dt><dd>{Math.min(unit.movement.pathIndex, unit.movement.totalHops)} / {unit.movement.totalHops}</dd></div>
      <div><dt>Prossimo hop</dt><dd>{unit.movement.remainingDaysToNextHop} giorni</dd></div>
      <div><dt>Durata tratta</dt><dd>{unit.movement.daysPerHop} giorni</dd></div>
      <div><dt>Arrivo stimato</dt><dd>{formatDate(unit.movement.estimatedArrivalDate)}</dd></div>
      <div><dt>Motorizzato</dt><dd>{unit.movement.motorized ? 'Sì' : 'No'}</dd></div>
    </dl></section>}
    {unit.regionId && <button type="button" onClick={onFocus}>Mostra la regione ↗</button>}
  </article>;
}

function FrontDetail({ front, model, regions, onSelectUnit, onFocus }: {
  front: MilitaryMapFront; model: MilitaryMapReadModel; regions: Region[];
  onSelectUnit: (id: string) => void; onFocus: () => void;
}) {
  const attacker = model.polities[front.attackerPolityId];
  const defender = model.polities[front.defenderPolityId];
  const objective = regions.find(region => region.id === front.objectiveRegionId);
  const assigned = front.unitIds.map(id => model.units.find(unit => unit.id === id)).filter((unit): unit is MilitaryMapUnit => Boolean(unit));
  return <article className="military-detail-body">
    <dl>
      <div><dt>Stato</dt><dd>{STATUS_LABEL[front.status] || front.status}</dd></div>
      <div><dt>Attaccante</dt><dd>{attacker?.name || front.attackerPolityId} · {formatPressure(front.attackerPressure)}</dd></div>
      <div><dt>Difensore</dt><dd>{defender?.name || front.defenderPolityId} · {formatPressure(front.defenderPressure)}</dd></div>
      <div><dt>Obiettivo</dt><dd>{objective?.name || front.objectiveRegionId || 'Nessuno'}</dd></div>
      <div><dt>Iniziativa</dt><dd>{front.momentumPolityId ? model.polities[front.momentumPolityId]?.name || front.momentumPolityId : 'Parità'}</dd></div>
      <div><dt>Aggiornato</dt><dd>{formatDate(front.updatedDate)}</dd></div>
    </dl>
    <section><h3>Reparti associati</h3>{assigned.length
      ? <ul>{assigned.map(unit => <li key={unit.id}><button type="button" onClick={() => onSelectUnit(unit.id)}>
        <span>{unit.name}<small>{unit.polity.name}{unit.movement ? ' · in trasferimento, fuori combattimento' : ''}</small></span><span>↗</span>
      </button></li>)}</ul>
      : <p>Nessun reparto associato.</p>}</section>
    <button type="button" onClick={onFocus}>Mostra il teatro ↗</button>
  </article>;
}
