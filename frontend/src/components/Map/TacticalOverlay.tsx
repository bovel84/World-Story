import { useEffect, useId, useMemo, useState } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import type { Region } from '../../types';
import type { FeedItem } from '../Game/EventFeed';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { publicNarrativeText } from '../../services/publicNarrative';
import { buildBattleReports, buildUnitRoutes, interpolateCoordinate, type Coordinate } from './tacticalModel';
import './tactical.css';

const Swords = () => <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 4l4 2 14 17-3 3L8 9zM25 4l-4 2L7 23l3 3L24 9z" fill="currentColor"/><path d="M4 21l7 7M21 28l7-7M5 28l3-3M24 25l3 3" fill="none" stroke="currentColor" strokeWidth="2.5"/></svg>;
const dateLabel = (date?: string) => date?.split('-').reverse().join('.') || '';

export function TacticalOverlay({ map, regions, events, currentDate, visible, playerId, onFocus }: {
  map: LibreMap; regions: Region[]; events: FeedItem[]; currentDate?: string;
  visible: boolean; playerId?: string; onFocus: (regionId: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [toolsBottom, setToolsBottom] = useState(124);
  const [open, setOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const markerId = useId().replace(/:/g, '');
  const routes = useMemo(() => buildUnitRoutes(regions, currentDate), [regions, currentDate]);
  const battles = useMemo(() => buildBattleReports(regions, events, currentDate), [regions, events, currentDate]);
  useEffect(() => {
    let frame = 0;
    const shortcuts = map.getContainer().parentElement?.querySelector('.map-shortcuts');
    const measureTools = () => {
      if (shortcuts) setToolsBottom(shortcuts.getBoundingClientRect().bottom - map.getContainer().getBoundingClientRect().top + 12);
    };
    const refresh = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measureTools(); setRevision(r => r + 1); }); };
    const observer = new ResizeObserver(measureTools);
    if (shortcuts) observer.observe(shortcuts);
    measureTools();
    map.on('move', refresh); map.on('resize', refresh);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); map.off('move', refresh); map.off('resize', refresh); };
  }, [map]);

  const projection = useMemo(() => {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const nearCamera = (point: Coordinate): Coordinate => [point[0] + 360 * Math.round((map.getCenter().lng - point[0]) / 360), point[1]];
    const projectedRoutes = routes.map(route => {
      const origin = nearCamera(route.from);
      const end = interpolateCoordinate(origin, route.to, 1);
      const from = map.project(origin), to = map.project(end);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length < 14 || Math.max(from.x, to.x) < 0 || Math.min(from.x, to.x) > width
        || Math.max(from.y, to.y) < 0 || Math.min(from.y, to.y) > height) return null;
      // Stop before the unit counter, so the direction remains readable.
      const trim = Math.min(22, length / 3);
      const x = to.x - (to.x - from.x) / length * trim, y = to.y - (to.y - from.y) / length * trim;
      return { route, d: `M${from.x},${from.y} L${x},${y}`, from };
    }).filter(item => item !== null).slice(0, 120);
    const projectedBattles = battles.map(battle => {
      const anchor = map.project(nearCamera(battle.point));
      // A leader keeps the report stamp clear of unit counters and place labels.
      const point = { x: Math.max(62, Math.min(width - 62, anchor.x + 48)), y: Math.max(76, anchor.y - 42) };
      return { battle, anchor, point };
    }).filter(({ anchor, point }) => anchor.x >= 0 && anchor.x <= width && anchor.y >= 0 && point.y <= height - 30);
    return { routes: projectedRoutes, battles: projectedBattles };
  }, [map, routes, battles, revision]);
  const selected = battles.find(battle => battle.id === selectedReport);
  if (!visible) return null;
  const locate = (id: string) => { setOpen(false); onFocus(id); };
  return <>
    <svg className="tactical-routes" aria-hidden="true">
      <defs>
        <marker id={`${markerId}-own`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5 1 9" fill="none" stroke="#a7e4de" strokeWidth="2"/></marker>
        <marker id={`${markerId}-other`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5 1 9" fill="none" stroke="#edc36c" strokeWidth="2"/></marker>
      </defs>
      {projection.routes.map(({ route, d, from }) => <g key={route.id} className={route.owner === playerId ? 'tactical-route own' : 'tactical-route'} data-route-id={route.id}>
        <path d={d} className="tactical-route-shadow"/><path d={d} className="tactical-route-line" markerEnd={`url(#${markerId}-${route.owner === playerId ? 'own' : 'other'})`}/>
        <circle cx={from.x} cy={from.y} r="3"/>
      </g>)}
      {projection.battles.map(({ battle, anchor, point }) => <g className="tactical-contact-leader" key={battle.id}>
        <path d={`M${anchor.x},${anchor.y} L${point.x},${point.y}`}/><circle cx={anchor.x} cy={anchor.y} r="3"/>
      </g>)}
    </svg>
    <div className="tactical-battles">
      {projection.battles.map(({ battle, point }, index) => <button type="button" key={battle.id}
        className="tactical-battle" data-battle-region={battle.regionId}
        style={{ left: point.x, top: point.y }} aria-label={`Leggi il dispaccio: ${battle.event.text}`}
        onClick={() => { setSelectedReport(battle.id); setOpen(true); }}>
        <span className="tactical-battle-ring" aria-hidden="true"/><Swords/>
        {!projection.battles.slice(0, index).some(other => Math.hypot(point.x - other.point.x, point.y - other.point.y) < 130)
          && <span className="tactical-battle-caption">Scontro segnalato <time>{dateLabel(battle.event.date)}</time></span>}
      </button>)}
    </div>
    {(routes.length > 0 || battles.length > 0) && <button type="button" className="tactical-summary" style={{ top: toolsBottom }}
      onClick={() => { setSelectedReport(null); setOpen(true); }} aria-label="Apri situazione militare">
      <span aria-hidden="true">↗</span> {routes.length} {routes.length === 1 ? 'spostamento' : 'spostamenti'} <span className="tactical-summary-separator">/</span> {battles.length} {battles.length === 1 ? 'scontro' : 'scontri'}
    </button>}
    <AccessibleDialog open={open} onClose={() => setOpen(false)} className="tactical-report" overlayClassName="tactical-report-backdrop" ariaLabel="Situazione militare">
      <header><div><small>ATLANTE OPERATIVO · {dateLabel(currentDate)}</small><h2>{selected ? 'Dispaccio dal fronte' : 'Situazione militare'}</h2></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Chiudi situazione militare">×</button></header>
      {selected ? <article><time>{dateLabel(selected.event.date)}</time><h3>{publicNarrativeText(selected.event.text)}</h3>
        <p className="tactical-report-detail">{publicNarrativeText(selected.event.detail || 'Consulta i dispacci del mondo per la cronaca completa.')}</p>
        <button type="button" onClick={() => locate(selected.regionId)}>Mostra il territorio ↗</button>
        <button type="button" onClick={() => setSelectedReport(null)}>Tutti i movimenti e gli scontri</button></article>
        : <><p className="tactical-report-note">Ultimi 30 giorni di gioco. Le frecce collegano origine e destinazione degli spostamenti eseguiti: non sono strade né ordini in attesa. Gli scontri indicano dispacci recenti, non necessariamente combattimenti ancora in corso.</p>
          {battles.length > 0 && <section><h3>Scontri segnalati</h3><ul>{battles.map(battle => <li key={battle.id}>
            <button type="button" onClick={() => setSelectedReport(battle.id)}><span>{publicNarrativeText(battle.event.text)}</span><time>{dateLabel(battle.event.date)} ↗</time></button>
          </li>)}</ul></section>}
          {routes.length > 0 && <section><h3>Spostamenti eseguiti</h3><ul>{routes.map(route => <li key={route.id}>
            <strong>{route.name}</strong><span>{route.origin} → {route.destination}</span><time>{dateLabel(route.date)} · {route.owner}</time>
          </li>)}</ul></section>}
        </>}
    </AccessibleDialog>
  </>;
}
