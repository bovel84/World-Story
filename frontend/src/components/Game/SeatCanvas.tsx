/**
 * World Story — WS-GOVOFFICE-07: la tela della sedia (presentazione)
 * =================================================================
 * Lo spazio a destra della seduta è una **tela riutilizzabile**: riceve una
 * lista di `SeatCanvasBlock` (già derivati dal read model, vedi `seatCanvas.ts`)
 * e li rende. Non conosce il Tesoro, non legge lo stato: è il "riuso per tutte
 * le sedie" della Parte C4.
 *
 * Blocchi resi:
 *  - `metrics`  → le cifre del quadro operativo (con provenienza);
 *  - `chart`    → le figure SVG del motore (riuso di `AdvisorChart`);
 *  - `strategy` → il diagramma a cascata (riuso di `StrategicPlanDiagram`);
 *  - `map`      → le zone del paese e l'opera-obiettivo (geometria del motore);
 *  - `ideas`    → le idee del ministro (contenuto curato).
 */
import { AdvisorChart } from './AdvisorChart';
import { StrategicPlanDiagram } from './StrategicPlanDiagram';
import { toneClass, type SeatCanvasBlock, type CanvasZone } from './seatCanvasModel';

function ZoneMap({ zones, target }: { zones: CanvasZone[]; target?: { label: string; detail: string } | null }) {
  const withGeometry = zones.filter(zone => Boolean(zone.svgPath));
  return (
    <div className="zone-map">
      {withGeometry.length > 0 ? (
        <svg className="zone-map-svg" viewBox="0 0 100 100" role="img" aria-label="Zone del paese su cui investire">
          {withGeometry.map(zone => (
            <path key={zone.id} className={`zone-map-shape ${toneClass(zone.tone)}`} d={zone.svgPath} vectorEffect="non-scaling-stroke">
              <title>{`${zone.name}: ${zone.detail}`}</title>
            </path>
          ))}
        </svg>
      ) : (
        <ul className="zone-map-list">
          {zones.map(zone => (
            <li key={zone.id} className={`zone-map-item ${toneClass(zone.tone)}`}>
              <span className="zone-map-name">{zone.name}</span>
              <span className="zone-map-detail">{zone.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <p className="zone-map-target">
          <span className="zone-map-target-label">Obiettivo</span> {target.label} — {target.detail}
        </p>
      )}
    </div>
  );
}

export interface SeatCanvasProps {
  blocks: SeatCanvasBlock[];
  /** Nessun blocco: la tela lo dice, non finge contenuto. */
  emptyLabel?: string;
  className?: string;
}

export function SeatCanvas({ blocks, emptyLabel = 'Nessun dato pubblicato per questa sedia.', className }: SeatCanvasProps) {
  if (blocks.length === 0) {
    return <p className="seat-canvas-empty">{emptyLabel}</p>;
  }
  return (
    <div className={`seat-canvas${className ? ` ${className}` : ''}`} data-blocks={blocks.length}>
      {blocks.map(block => {
        if (block.kind === 'metrics') {
          return (
            <section key={block.id} className="seat-canvas-block seat-canvas-metrics" data-kind="metrics">
              <h4 className="seat-canvas-title">{block.title}</h4>
              {block.note && <p className="seat-canvas-note">{block.note}</p>}
              <dl className="seat-canvas-metric-list">
                {block.metrics.map(metric => (
                  <div key={metric.id} className={`seat-canvas-metric ${toneClass(metric.tone)}`}>
                    <dt>{metric.label}</dt>
                    <dd>
                      {metric.display}
                      {metric.hint && <span className="seat-canvas-metric-basis">{metric.hint}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        }
        if (block.kind === 'chart') {
          return (
            <section key={block.id} className="seat-canvas-block" data-kind="chart">
              <AdvisorChart figure={block.figure} />
            </section>
          );
        }
        if (block.kind === 'strategy') {
          return (
            <section key={block.id} className="seat-canvas-block" data-kind="strategy">
              <StrategicPlanDiagram plan={block.plan} />
            </section>
          );
        }
        if (block.kind === 'map') {
          return (
            <section key={block.id} className="seat-canvas-block" data-kind="map">
              <h4 className="seat-canvas-title">{block.title}</h4>
              <p className="seat-canvas-note">{block.note}</p>
              <ZoneMap zones={block.zones} target={block.target} />
            </section>
          );
        }
        return (
          <section key={block.id} className="seat-canvas-block" data-kind="ideas">
            <h4 className="seat-canvas-title">{block.title}</h4>
            <ul className="seat-canvas-ideas">
              {block.ideas.map((idea, index) => (
                <li key={`${block.id}-${index}`} className={`seat-canvas-idea${idea.tone ? ` ${toneClass(idea.tone)}` : ''}`}>
                  <span className="seat-canvas-idea-title">{idea.title}</span>
                  <span className="seat-canvas-idea-detail">{idea.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default SeatCanvas;
