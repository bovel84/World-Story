import { useEffect, useId, useMemo, useRef, type RefObject } from 'react';
import type {
  MilitaryUnitPayload,
  OperatingPicturePayload,
  UnitActionImpactPayload,
  UnitActionRequest,
  UnitOrderImpactPayload,
  UnitOrderRequest,
  WarFrontPayload,
} from '../../services/api';
import type { Region } from '../../types';
import { constructionReport } from '../../utils/construction';
import { UnitActionPanel } from '../Game/UnitActionPanel';
import {
  operatingObjectForUnit,
  playerControlsUnit,
  type MapContextIndex,
  type ResolvedMapContext,
} from '../Map/mapContext';
import './ProvinceInspector.css';

interface ProvinceInspectorProps {
  context: ResolvedMapContext | null;
  index: MapContextIndex;
  allRegions: Region[];
  playerPolityId: string;
  operatingPicture?: OperatingPicturePayload | null;
  /** Invalida i dry-run su turno/data/revisione/ramo. */
  snapshotKey: string;
  onClose: () => void;
  onSelectRegion: (regionId: string) => void;
  onSelectUnit: (unitId: string) => void;
  onSelectFront: (frontId: string) => void;
  onFocusRegion: (regionId: string) => void;
  onOpenArmedForces?: () => void;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}

const STATUS_LABEL: Record<string, string> = {
  forming: 'In formazione', operational: 'Operativo', degraded: 'Degradato',
  retreating: 'In ripiegamento', destroyed: 'Distrutto', active: 'Attivo',
  stalemate: 'Stallo', breakthrough: 'Sfondamento', collapsed: 'Collassato', closed: 'Chiuso',
};
const ORDER_LABEL: Record<string, string> = {
  attack: 'Attacca', defend: 'Difendi', reserve: 'Riserva', withdraw: 'Ripiega',
};

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString('it-IT') : '—';
}
function formatDate(value?: string | null): string {
  return value ? value.split('-').reverse().join('.') : '—';
}
function formatPressure(value: number): string {
  return `${Math.round(Number(value || 0) * 100)}%`;
}
function ownerName(region: Region, allRegions: Region[]): string {
  if (!region.owner || region.owner === 'neutral') return 'Neutrale';
  const representative = allRegions.find(item => item.owner === region.owner && item.polityName)
    ?? allRegions.find(item => item.id === region.owner || item.polityName === region.owner);
  return representative?.polityName || representative?.name || region.owner;
}
function polityName(polityId: string, allRegions: Region[]): string {
  const representative = allRegions.find(region => region.owner === polityId && region.polityName)
    ?? allRegions.find(region => region.owner === polityId);
  return representative?.polityName || representative?.name || polityId;
}

function UnitSummary({ unit, allRegions, onSelect }: {
  unit: MilitaryUnitPayload;
  allRegions: Region[];
  onSelect: () => void;
}) {
  return <li className="context-unit-row">
    <button type="button" onClick={onSelect} data-context-unit={unit.id}>
      <span><strong>{unit.name}</strong><small>{polityName(unit.polityId, allRegions)} · {STATUS_LABEL[unit.status] || unit.status}</small></span>
      <span className="context-unit-metrics">
        <small>{formatNumber(unit.personnel)} uomini · prontezza {Math.round(unit.readiness * 100)}%</small>
        <small>{ORDER_LABEL[unit.order] || unit.order}{unit.movement ? ' · in trasferimento, fuori combattimento' : ''}</small>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  </li>;
}

function InspectorHeader({ eyebrow, title, code, color, onClose, headingId, headingRef }: {
  eyebrow: string; title: string; code: string; color?: string; onClose: () => void;
  headingId: string; headingRef: RefObject<HTMLHeadingElement>;
}) {
  return <header className="province-inspector-header">
    <div className="province-inspector-color" style={{ backgroundColor: color || '#71889a' }} />
    <div className="province-inspector-title-group"><small className="context-eyebrow">{eyebrow}</small>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="province-inspector-name">{title}</h2><span className="province-inspector-id">{code}</span></div>
    <button type="button" className="province-inspector-close" onClick={onClose} aria-label="Chiudi contesto mappa">×</button>
  </header>;
}

function RegionContext({ region, index, allRegions, playerPolityId, onSelectUnit, onSelectFront, onOpenArmedForces }: {
  region: Region; index: MapContextIndex; allRegions: Region[]; playerPolityId: string;
  onSelectUnit: (id: string) => void; onSelectFront: (id: string) => void; onOpenArmedForces?: () => void;
}) {
  const assets = useMemo(() => {
    const counts = { factories: 0, ports: 0, cities: 0, capital: 0, infrastructure: 0 };
    for (const object of region.objects || []) {
      if (object.type === 'factory') counts.factories += 1;
      if (object.type === 'port') counts.ports += 1;
      if (object.type === 'city') counts.cities += 1;
      if (object.type === 'capital') counts.capital += 1;
      if (object.type === 'radar') counts.infrastructure += 1;
    }
    return counts;
  }, [region.objects]);
  const units = (index.unitsByRegion.get(region.id) || []).filter(unit => unit.status !== 'destroyed');
  const fronts = index.frontsByRegion.get(region.id) || [];
  const metadata = region.metadata || {};
  const infrastructureLevel = metadata.infrastructure_level
    ? Number(metadata.infrastructure_level)
    : Math.min(5, 1 + assets.infrastructure + (assets.capital ? 2 : assets.cities > 0 ? 1 : 0));
  const tags = Array.isArray(metadata.tags) ? metadata.tags.slice(0, 5) : [];
  const isPlayer = region.owner === playerPolityId;

  return <>
    <dl className="province-inspector-meta">
      <div><dt>Proprietario</dt><dd>{ownerName(region, allRegions)}{isPlayer && ' (Tu)'}</dd></div>
      <div><dt>Superficie</dt><dd>{metadata.surface_type || 'Terra'}</dd></div>
      <div><dt>Popolazione</dt><dd>{formatNumber(region.population)}</dd></div>
      <div><dt>PIL</dt><dd>{formatNumber(region.gdp)}</dd></div>
      <div><dt>Stato</dt><dd>{region.status}</dd></div>
      <div><dt>INFRA</dt><dd>L{infrastructureLevel}</dd></div>
    </dl>
    <div className="province-inspector-assets" aria-label="Asset territoriali">
      <span title="Impianti industriali">⚙ <b>{assets.factories}</b></span>
      <span title="Porti">⚓ <b>{assets.ports}</b></span>
      <span title="Città">● <b>{assets.cities + assets.capital}</b></span>
      <span title="Reparti persistenti">▲ <b>{units.length}</b></span>
    </div>

    {region.objects?.some(object => object.type === 'construction_site') && <section className="province-construction" aria-label="Cantieri nel territorio">
      <h3>Cantieri nel territorio</h3><p>Un’opera entra in servizio solo dopo il completamento confermato.</p>
      {region.objects.filter(object => object.type === 'construction_site').map(object => <article key={object.id}>
        <h4>{object.name}</h4><dl>{constructionReport(object).map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      </article>)}
    </section>}

    <section className="map-context-section" aria-labelledby={`units-${region.id}`}>
      <header><div><small>STATO PERSISTENTE</small><h3 id={`units-${region.id}`}>Reparti presenti</h3></div><b>{units.length}</b></header>
      {units.length ? <ul className="context-unit-list">{units.map(unit => <UnitSummary key={unit.id} unit={unit} allRegions={allRegions} onSelect={() => onSelectUnit(unit.id)} />)}</ul>
        : <p className="context-empty">Nessun reparto persistente nella regione.</p>}
    </section>

    <section className="map-context-section" aria-labelledby={`fronts-${region.id}`}>
      <header><div><small>TEATRO</small><h3 id={`fronts-${region.id}`}>Fronti interessati</h3></div><b>{fronts.length}</b></header>
      {fronts.length ? <ul className="context-link-list">{fronts.map(front => <li key={front.id}><button type="button" onClick={() => onSelectFront(front.id)}>
        <span><strong>{front.name}</strong><small>{STATUS_LABEL[front.status] || front.status} · {front.attackerPolityId} / {front.defenderPolityId}</small></span><span aria-hidden="true">›</span>
      </button></li>)}</ul> : <p className="context-empty">Nessun fronte attivo nel territorio.</p>}
    </section>

    {tags.length > 0 && <div className="province-inspector-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    <div className="province-inspector-borders"><dt>Confini ({region.borders?.length || 0})</dt><dd>
      {region.borders?.map(border => { const neighbor = index.regionsById.get(border); return <span key={border} className="border-link" style={{ borderLeftColor: neighbor?.color }}>{neighbor?.name || border}</span>; })}
    </dd></div>
    {onOpenArmedForces && <div className="context-navigation"><button type="button" onClick={onOpenArmedForces}>Apri Forze armate</button></div>}
  </>;
}

function UnitContext({ unit, index, allRegions, playerPolityId, operatingPicture, snapshotKey, onSelectRegion, onSelectFront, onFocusRegion, onUnitAction, onUnitOrder }: {
  unit: MilitaryUnitPayload; index: MapContextIndex; allRegions: Region[]; playerPolityId: string;
  operatingPicture?: OperatingPicturePayload | null; snapshotKey: string;
  onSelectRegion: (id: string) => void; onSelectFront: (id: string) => void; onFocusRegion: (id: string) => void;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}) {
  const region = unit.regionId ? index.regionsById.get(unit.regionId) : null;
  const front = unit.frontId ? index.frontsById.get(unit.frontId) : null;
  const own = playerControlsUnit(unit, playerPolityId);
  const operatingObject = own ? operatingObjectForUnit(operatingPicture, unit.id) : null;
  const equipment = Object.entries(unit.equipment).filter(([, quantity]) => Number.isFinite(quantity) && quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const remainingPath = unit.movement?.path.slice(unit.movement.pathIndex) || [];

  return <>
    <nav className="context-breadcrumb" aria-label="Navigazione del contesto">
      {unit.regionId && <button type="button" onClick={() => onSelectRegion(unit.regionId as string)}>{region?.name || unit.regionName || unit.regionId}</button>}
      {front && <><span aria-hidden="true">›</span><button type="button" onClick={() => onSelectFront(front.id)}>{front.name}</button></>}
      <span aria-hidden="true">›</span><strong>{unit.name}</strong>
    </nav>
    <dl className="province-inspector-meta context-meta-wide">
      <div><dt>Politia</dt><dd>{polityName(unit.polityId, allRegions)} ({unit.polityId})</dd></div>
      <div><dt>Armata</dt><dd>{unit.armyId}</dd></div>
      <div><dt>Posizione</dt><dd>{region?.name || unit.regionName || unit.regionId || 'Non assegnata'}</dd></div>
      <div><dt>Personale</dt><dd>{formatNumber(unit.personnel)}</dd></div>
      <div><dt>Prontezza</dt><dd>{Math.round(unit.readiness * 100)}%</dd></div>
      <div><dt>Stato</dt><dd>{STATUS_LABEL[unit.status] || unit.status}</dd></div>
      <div><dt>Ordine</dt><dd>{ORDER_LABEL[unit.order] || unit.order}</dd></div>
      <div><dt>Fronte</dt><dd>{front?.name || 'Nessuno'}{unit.movement ? ' · fuori combattimento, in trasferimento' : ''}</dd></div>
      <div><dt>Aggiornato</dt><dd>{formatDate(unit.updatedDate)}</dd></div>
    </dl>

    <section className="map-context-section"><header><div><small>LOGISTICA</small><h3>Fabbisogno mensile</h3></div></header>
      <dl className="context-inline-facts"><div><dt>Carburante</dt><dd>{formatNumber(unit.monthlyNeeds.fuel)}</dd></div>
        <div><dt>Armamenti</dt><dd>{formatNumber(unit.monthlyNeeds.weapons)}</dd></div><div><dt>Cibo</dt><dd>{formatNumber(unit.monthlyNeeds.food)}</dd></div></dl>
    </section>
    <section className="map-context-section"><header><div><small>DOTAZIONE</small><h3>Equipaggiamento</h3></div><b>{equipment.length}</b></header>
      {equipment.length ? <ul className="context-equipment">{equipment.map(([id, quantity]) => <li key={id}><span>{id}</span><strong>{formatNumber(quantity)}</strong></li>)}</ul>
        : <p className="context-empty">Nessun equipaggiamento pubblicato.</p>}
    </section>

    {unit.movement && <section className="map-context-section context-movement" data-movement-detail={unit.id}>
      <header><div><small>P6 · ROTTA DEL MOTORE</small><h3>In trasferimento</h3></div></header>
      <p className="context-route" data-route-path={remainingPath.join(',')}>{remainingPath.map(id => index.regionsById.get(id)?.name || id).join(' → ')}</p>
      <dl className="context-inline-facts">
        <div><dt>Destinazione</dt><dd>{unit.movement.targetRegionName || unit.movement.targetRegionId}</dd></div>
        <div><dt>Tratte</dt><dd>{Math.min(unit.movement.pathIndex, unit.movement.totalHops)} / {unit.movement.totalHops}</dd></div>
        <div><dt>Prossimo hop</dt><dd>{unit.movement.remainingDaysToNextHop} giorni</dd></div>
        <div><dt>Durata tratta</dt><dd>{unit.movement.daysPerHop} giorni</dd></div>
        <div><dt>ETA</dt><dd>{formatDate(unit.movement.estimatedArrivalDate)}</dd></div>
        <div><dt>Motorizzato</dt><dd>{unit.movement.motorized ? 'Sì' : 'No'}</dd></div>
      </dl>
    </section>}

    <div className="context-navigation">
      {unit.regionId && <button type="button" onClick={() => onFocusRegion(unit.regionId as string)}>Centra posizione</button>}
      {front && <button type="button" onClick={() => onSelectFront(front.id)}>Apri fronte</button>}
    </div>

    <section className="map-context-section context-actions" aria-label={`Comandi per ${unit.name}`}>
      <header><div><small>AUTHORITY DEL MOTORE</small><h3>Azioni disponibili</h3></div></header>
      {!own && <p className="context-readonly" data-unit-readonly={unit.id}>Reparto {unit.polityId}: dettaglio in sola lettura. Solo i reparti della tua polity possono ricevere ordini.</p>}
      {own && !operatingObject && <p className="context-readonly" data-unit-readonly={unit.id}>Il motore non pubblica un oggetto operativo per questo reparto. Nessuna azione viene sintetizzata.</p>}
      {own && operatingObject && operatingPicture && <UnitActionPanel object={operatingObject} picture={operatingPicture}
        snapshotKey={snapshotKey} onUnitAction={onUnitAction} onUnitOrder={onUnitOrder} />}
    </section>
  </>;
}

function FrontUnitGroup({ title, units, allRegions, onSelectUnit }: {
  title: string; units: readonly MilitaryUnitPayload[]; allRegions: Region[]; onSelectUnit: (id: string) => void;
}) {
  return <section className="context-front-side"><h4>{title} <b>{units.length}</b></h4>
    {units.length ? <ul className="context-unit-list">{units.map(unit => <UnitSummary key={unit.id} unit={unit} allRegions={allRegions} onSelect={() => onSelectUnit(unit.id)} />)}</ul>
      : <p className="context-empty">Nessun reparto assegnato.</p>}
  </section>;
}

function FrontContext({ front, index, allRegions, onSelectUnit, onSelectRegion, onFocusRegion }: {
  front: WarFrontPayload; index: MapContextIndex; allRegions: Region[];
  onSelectUnit: (id: string) => void; onSelectRegion: (id: string) => void; onFocusRegion: (id: string) => void;
}) {
  const objective = front.objectiveRegionId ? index.regionsById.get(front.objectiveRegionId) : null;
  const assigned = (index.unitsByFront.get(front.id) || []).filter(unit => unit.status !== 'destroyed');
  const attackers = assigned.filter(unit => unit.polityId === front.attackerPolityId);
  const defenders = assigned.filter(unit => unit.polityId === front.defenderPolityId);
  const others = assigned.filter(unit => unit.polityId !== front.attackerPolityId && unit.polityId !== front.defenderPolityId);
  const theatre = front.regionIds.map(id => index.regionsById.get(id)?.name || id);
  return <>
    <nav className="context-breadcrumb" aria-label="Navigazione del contesto">
      {front.objectiveRegionId && <button type="button" onClick={() => onSelectRegion(front.objectiveRegionId as string)}>{objective?.name || front.objectiveRegionId}</button>}
      <span aria-hidden="true">›</span><strong>{front.name}</strong>
    </nav>
    <dl className="province-inspector-meta context-meta-wide">
      <div><dt>Stato</dt><dd>{STATUS_LABEL[front.status] || front.status}</dd></div>
      <div><dt>Attaccante</dt><dd>{polityName(front.attackerPolityId, allRegions)} · {formatPressure(front.attackerPressure)}</dd></div>
      <div><dt>Difensore</dt><dd>{polityName(front.defenderPolityId, allRegions)} · {formatPressure(front.defenderPressure)}</dd></div>
      <div><dt>Obiettivo</dt><dd>{objective?.name || front.objectiveRegionId || 'Nessuno'}</dd></div>
      <div><dt>Iniziativa</dt><dd>{front.momentumPolityId ? polityName(front.momentumPolityId, allRegions) : 'Parità'}</dd></div>
      <div><dt>Aggiornato</dt><dd>{formatDate(front.updatedDate)}</dd></div>
    </dl>
    <section className="map-context-section"><header><div><small>TEATRO</small><h3>Regioni del fronte</h3></div><b>{theatre.length}</b></header>
      <p>{theatre.join(' · ')}</p><div className="context-navigation">
        {front.objectiveRegionId && <button type="button" onClick={() => onFocusRegion(front.objectiveRegionId as string)}>Centra obiettivo</button>}
        {front.objectiveRegionId && <button type="button" onClick={() => onSelectRegion(front.objectiveRegionId as string)}>Apri territorio</button>}
      </div>
    </section>
    <section className="map-context-section" data-front-context={front.id}><header><div><small>ORDINI AI REPARTI, NON AL FRONTE</small><h3>Reparti assegnati</h3></div><b>{assigned.length}</b></header>
      <FrontUnitGroup title={`Attaccante · ${front.attackerPolityId}`} units={attackers} allRegions={allRegions} onSelectUnit={onSelectUnit} />
      <FrontUnitGroup title={`Difensore · ${front.defenderPolityId}`} units={defenders} allRegions={allRegions} onSelectUnit={onSelectUnit} />
      {others.length > 0 && <FrontUnitGroup title="Altri reparti assegnati" units={others} allRegions={allRegions} onSelectUnit={onSelectUnit} />}
      {assigned.some(unit => unit.movement) && <p className="context-note">I reparti in trasferimento sono indicati come fuori combattimento e non contano fra gli effettivi attivi del fronte.</p>}
    </section>
  </>;
}

export function ProvinceInspector({
  context,
  index,
  allRegions,
  playerPolityId,
  operatingPicture,
  snapshotKey,
  onClose,
  onSelectRegion,
  onSelectUnit,
  onSelectFront,
  onFocusRegion,
  onOpenArmedForces,
  onUnitAction,
  onUnitOrder,
}: ProvinceInspectorProps) {
  const headingId = useId().replace(/:/g, '');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const title = context?.kind === 'region' ? context.region.name : context?.kind === 'unit' ? context.unit.name : context?.kind === 'front' ? context.front.name : '';
  const code = context?.kind === 'region' ? context.region.id : context?.kind === 'unit' ? context.unit.id : context?.kind === 'front' ? context.front.id : '';
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [code]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!context) return null;
  const color = context.kind === 'region' ? context.region.color : context.kind === 'unit'
    ? allRegions.find(region => region.owner === context.unit.polityId)?.color : '#d99052';

  return <div className="province-inspector map-context-inspector" role="region" aria-labelledby={headingId} data-map-context={context.kind} data-map-context-id={code}>
    <InspectorHeader eyebrow={context.kind === 'region' ? 'TERRITORIO' : context.kind === 'unit' ? 'REPARTO PERSISTENTE' : 'FRONTE PERSISTENTE'}
      title={title} code={code} color={color} onClose={onClose} headingId={headingId} headingRef={headingRef} />
    <div className="province-inspector-body">
      {context.kind === 'region' && <RegionContext region={context.region} index={index} allRegions={allRegions}
        playerPolityId={playerPolityId} onSelectUnit={onSelectUnit} onSelectFront={onSelectFront} onOpenArmedForces={onOpenArmedForces} />}
      {context.kind === 'unit' && <UnitContext unit={context.unit} index={index} allRegions={allRegions}
        playerPolityId={playerPolityId} operatingPicture={operatingPicture} snapshotKey={snapshotKey}
        onSelectRegion={onSelectRegion} onSelectFront={onSelectFront} onFocusRegion={onFocusRegion}
        onUnitAction={onUnitAction} onUnitOrder={onUnitOrder} />}
      {context.kind === 'front' && <FrontContext front={context.front} index={index} allRegions={allRegions}
        onSelectUnit={onSelectUnit} onSelectRegion={onSelectRegion} onFocusRegion={onFocusRegion} />}
    </div>
  </div>;
}

export default ProvinceInspector;
