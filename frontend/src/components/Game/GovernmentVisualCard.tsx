import type { MapFocusVisual, GovernmentVisualSnapshot } from './governmentVisual';
import { governmentVisualModel } from './governmentVisual';
import { svgPathBounds, zoneCentroid } from './regionFocus';
import { MAX_MAP_REGION_IDS } from './presentation';
import './governmentVisual.css';

export interface GovernmentVisualCardProps {
  card: MapFocusVisual;
  snapshot: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
}

/** Shared by government voices. This increment renders map-focus only. */
export function GovernmentVisualCard({ card, snapshot, onFocusMap }: GovernmentVisualCardProps) {
  if (card.type !== 'map-focus') return null;
  const model = governmentVisualModel(card, snapshot);
  if (!model) return null;
  return <section className="government-visual-card" aria-label={`Contesto geografico: ${card.title}`}>
    <header><span className="government-visual-kind">CONTESTO GEOGRAFICO</span><h4>{card.title}</h4></header>
    {model.preview ? <svg className="government-visual-preview" viewBox={model.preview.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={model.regions.map(region => region.name).join(', ')}>
      {model.preview.paths.map(path => {
        const center = zoneCentroid(path.path);
        const bounds = svgPathBounds(path.path)!;
        return <g key={path.id} data-region-id={path.id}>
          <path d={path.path} fill={path.color} fillRule="evenodd" stroke="#dceaf3" strokeWidth="1.25" vectorEffect="non-scaling-stroke"><title>{path.name}</title></path>
          {model.preview!.paths.length <= 4 && center && <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 10} fill="#fff">{path.name}</text>}
        </g>;
      })}
    </svg> : <p className="government-visual-fallback" role="status">{model.regions.length > MAX_MAP_REGION_IDS ? 'Contesto territoriale esteso: apri la mappa principale per tutti i territori.' : 'Geometria non disponibile per una rappresentazione completa e affidabile.'}</p>}
    <p className="government-visual-regions">{model.regions.length <= MAX_MAP_REGION_IDS ? model.regions.map(region => region.name).join(' · ') : `${model.regions.length} territori canonici`}</p>
    <ul className="government-visual-legend" aria-label="Proprietà attuale dei territori">
      {model.legend.map((entry, index) => <li key={index}><span className="government-visual-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />{entry.label}</li>)}
    </ul>
    {card.description && <p className="government-visual-description">{card.description}</p>}
    <button type="button" className="government-visual-open" disabled={!onFocusMap} onClick={() => onFocusMap?.(card)}>Mostra sulla mappa principale <span aria-hidden="true">↗</span></button>
  </section>;
}
