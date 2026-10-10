import type { MapFocusVisual, GovernmentVisualSnapshot } from './governmentVisual';
import { governmentVisualModel, mapLayerForVisual } from './governmentVisual';
import { svgPathBounds, zoneCentroid } from './regionFocus';
import { MARKER_STYLE } from './regionMarkers';
import { placeLabels, MAX_PREVIEW_LABELS, type LabelCandidate } from './regionLabels';
import { MAX_MAP_PREVIEW_REGIONS } from './presentation';
import './governmentVisual.css';

export interface GovernmentVisualCardProps {
  card: MapFocusVisual;
  snapshot: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
}

/**
 * MAP02/MAP03 — Il ruolo di una zona decide come si disegna, non se si disegna.
 * La primaria resta il colore canonico (politico, o della fascia tematica quando
 * MAP04 è attiva); il contesto si attenua e le adiacenti restano in contorno
 * sottile: così la scheda dice **dove** sta il soggetto, che è la cosa che una
 * mappa piccola può dire meglio di una riga di testo.
 */
function zoneStyle(role: 'primary' | 'context' | 'adjacent') {
  if (role === 'primary') return { fillOpacity: 1, stroke: '#dceaf3', strokeWidth: 1.25 };
  if (role === 'adjacent') return { fillOpacity: 0.5, stroke: '#8fa9bd', strokeWidth: 1 };
  return { fillOpacity: 0.22, stroke: '#3d5468', strokeWidth: 0.75 };
}

/** Shared by government voices. This increment renders map-focus only. */
export function GovernmentVisualCard({ card, snapshot, onFocusMap }: GovernmentVisualCardProps) {
  if (card.type !== 'map-focus') return null;
  const model = governmentVisualModel(card, snapshot);
  if (!model) return null;
  const zones = model.zones;
  const primary = new Set(zones?.primary ?? []);
  const adjacent = new Set(zones?.adjacent ?? []);
  const roleOf = (id: string): 'primary' | 'context' | 'adjacent' =>
    primary.has(id) ? 'primary' : adjacent.has(id) ? 'adjacent' : 'context';
  const paths = model.preview?.paths ?? [];
  // MAP02 — Le etichette seguono le primarie, che sono poche e nominate. Senza
  // ruoli resta il vecchio comportamento (nomi solo per un insieme minuscolo);
  // senza anteprima non c'è nessuna etichetta da disegnare.
  const labelOrder = !model.preview ? []
    : zones?.primary.length ? zones.primary
    : paths.length <= 4 ? paths.map(path => path.id) : [];
  // MAP03 — Il riquadro del `viewBox` decide il corpo del testo: la stessa
  // aritmetica di scatole serve un riquadro grande o piccolo.
  const viewBox = model.preview?.viewBox.split(/\s+/).map(Number) ?? [];
  const frameWidth = viewBox.length === 4 ? viewBox[2] : 640;
  const candidates: LabelCandidate[] = [];
  for (const id of labelOrder) {
    const path = paths.find(item => item.id === id);
    if (!path) continue;
    const center = zoneCentroid(path.path);
    const bounds = svgPathBounds(path.path);
    if (!center || !bounds) continue;
    candidates.push({
      id, name: path.name, x: center.x, y: center.y,
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
    });
  }
  const labels = placeLabels(candidates, {
    fontSize: Math.max(8, frameWidth / 40),
    maxLabels: zones?.primary.length ? MAX_PREVIEW_LABELS : 4,
  });
  const primaryNames = zones ? model.regions.filter(region => primary.has(region.id)).map(region => region.name) : [];
  // MAP09 — I segni: le capitali, i porti e gli stabilimenti dove il motore li ha
  // registrati, e le città delle zone in evidenza. Proiettati con la **stessa**
  // proiezione dei poligoni (niente seconde coordinate, niente pallini stimati),
  // e mai sui mondi legacy, che non portano coordinate reali.
  const markers = model.preview?.markers ?? [];
  const markerRadius = Math.max(1, frameWidth / 220);
  // MAP06 — Il contorno del soggetto: le primarie che toccano il territorio fuori
  // dall'insieme. Si legge dall'adiacenza canonica, non da una somiglianza di nomi.
  const borderIds = new Set(zones?.border ?? []);
  const borderWidth = frameWidth / 200;
  return <section className="government-visual-card" aria-label={`Contesto geografico: ${card.title}`}>
    <header><span className="government-visual-kind">CONTESTO GEOGRAFICO</span><h4>{card.title}</h4></header>
    {model.preview ? <svg className="government-visual-preview" viewBox={model.preview.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={model.regions.map(region => region.name).join(', ')}>
      {model.preview.paths.map(path => {
        const role = roleOf(path.id);
        const style = zones ? zoneStyle(role) : { fillOpacity: 1, stroke: '#dceaf3', strokeWidth: 1.25 };
        const fill = model.metricColors?.get(path.id) ?? path.color;
        return <g key={path.id} data-region-id={path.id} data-role={zones ? role : undefined}>
          <path d={path.path} fill={fill} fillRule="evenodd" stroke={style.stroke} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" {...(style.fillOpacity < 1 ? { fillOpacity: style.fillOpacity } : {})}><title>{path.name}</title></path>
        </g>;
      })}
      {markers.map(marker => {
        const markerStyle = MARKER_STYLE[marker.kind];
        return <g key={marker.id} data-marker={marker.kind}>
          <circle cx={marker.x} cy={marker.y} r={markerStyle.radius * markerRadius} fill={markerStyle.fill} stroke={markerStyle.stroke} strokeWidth="0.75" vectorEffect="non-scaling-stroke" aria-hidden="true"><title>{marker.name}</title></circle>
        </g>;
      })}
      {labels.map(label => <text key={label.id} x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fontSize={label.fontSize} fill="#fff" pointerEvents="none">{label.text}</text>)}
    </svg> : <p className="government-visual-fallback" role="status">{model.regions.length > MAX_MAP_PREVIEW_REGIONS ? 'Contesto territoriale esteso: apri la mappa principale per tutti i territori.' : 'Geometria non disponibile per una rappresentazione completa e affidabile.'}</p>}
    {/* Le primarie si nominano; il resto è contesto e non ha bisogno di un elenco. */}
    <p className="government-visual-regions">{zones?.primary.length
      ? `In evidenza: ${primaryNames.join(' · ')}${model.regions.length > zones.primary.length ? ` — sulle ${model.regions.length} del contesto` : ''}`
      : model.regions.length <= MAX_MAP_PREVIEW_REGIONS ? model.regions.map(region => region.name).join(' · ') : `${model.regions.length} territori canonici`}</p>
    {/* MAP04 — con una metrica la legenda dichiara la scala, non i proprietari. */}
    <ul className="government-visual-legend" aria-label={model.metricLabel ? `Scala: ${model.metricLabel}` : 'Proprietà attuale dei territori'}>
      {model.metricLabel && <li className="government-visual-legend-title">{model.metricLabel}{model.metricMeasured !== undefined ? ` — ${model.metricMeasured} province con dato` : ''}</li>}
      {model.legend.map((entry, index) => <li key={index}>{entry.color && <span className="government-visual-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />}{entry.label}</li>)}
    </ul>
    {card.description && <p className="government-visual-description">{card.description}</p>}
    {/* MAP11 — Il pulsante dichiara **cosa** si vedrà: se la scheda è colorata da
        una grandezza, la mappa si apre sulla stessa lettura. */}
    <button type="button" className="government-visual-open" disabled={!onFocusMap} onClick={() => onFocusMap?.(card)}>
      {mapLayerForVisual(card) === 'economy' ? 'Apri la mappa del prodotto' : 'Mostra sulla mappa principale'} <span aria-hidden="true">↗</span>
    </button>
  </section>;
}
