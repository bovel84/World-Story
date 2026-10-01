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
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AdvisorChart } from './AdvisorChart';
import { StrategicPlanDiagram } from './StrategicPlanDiagram';
import { focusViewBox, partitionZones } from './regionFocus';
import { toneClass, type SeatCanvasBlock, type CanvasZone } from './seatCanvasModel';

/**
 * WS-MINISTER-UX-08 (5) — La provenienza non sta in primo piano: le cifre
 * restano leggibili, le fonti si aprono a richiesta. Un unico posto per ogni
 * blocco, così la tavola non si riempie di note.
 */
function Provenance({ label = 'Fonti', children }: { label?: string; children: ReactNode }) {
  return (
    <details className="seat-sources">
      <summary className="seat-sources-summary">{label}</summary>
      <div className="seat-sources-body">{children}</div>
    </details>
  );
}

function ZoneMap({
  zones,
  target,
  focusIds = [],
}: {
  zones: CanvasZone[];
  target?: { label: string; detail: string } | null;
  focusIds?: readonly string[];
}) {
  // WS-MINISTER-UX-04 — Il viewBox si misura dai path (non più fisso a 100×100),
  // e la selezione richiesta mette in evidenza le zone pertinenti.
  const viewBox = focusViewBox(zones, focusIds);
  const { focused, hasFocus } = partitionZones(zones, focusIds);
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? (hasFocus ? [...focused][0] ?? null : null);
  const withGeometry = zones.filter(zone => Boolean(zone.svgPath));
  const legendZones = hasFocus ? zones.filter(zone => focused.has(zone.id)) : zones.slice(0, 6);
  const activeZone = activeId ? zones.find(zone => zone.id === activeId) ?? null : null;

  return (
    <div className="zone-map">
      {withGeometry.length > 0 ? (
        <svg className="zone-map-svg" viewBox={viewBox} role="img" aria-label="Zone del paese su cui investire">
          {withGeometry.map(zone => {
            const isFocused = focused.has(zone.id);
            const dimmed = hasFocus && !isFocused;
            return (
              <path
                key={zone.id}
                className={`zone-map-shape ${toneClass(zone.tone)}${isFocused ? ' focused' : ''}${dimmed ? ' dimmed' : ''}${activeId === zone.id ? ' active' : ''}`}
                d={zone.svgPath}
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="button"
                aria-label={`${zone.name}: ${zone.detail}`}
                onClick={() => setSelected(zone.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(zone.id);
                  }
                }}
              >
                <title>{`${zone.name}: ${zone.detail}`}</title>
              </path>
            );
          })}
        </svg>
      ) : (
        <ul className="zone-map-list">
          {zones.map(zone => (
            <li key={zone.id} className={`zone-map-item ${toneClass(zone.tone)}${focused.has(zone.id) ? ' focused' : ''}`}>
              <span className="zone-map-name">{zone.name}</span>
              <span className="zone-map-detail">{zone.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {/* La legenda è anche il controllo accessibile della selezione: l'SVG è
          decorativo per chi non lo vede, l'elenco no. */}
      {legendZones.length > 0 && (
        <ul className="zone-map-legend" aria-label={hasFocus ? 'Zone in evidenza' : 'Zone del paese'}>
          {legendZones.map(zone => (
            <li key={zone.id}>
              <button
                type="button"
                className={`zone-map-legend-btn ${toneClass(zone.tone)}${activeId === zone.id ? ' active' : ''}`}
                onClick={() => setSelected(zone.id)}
              >
                <span className="zone-map-swatch" aria-hidden="true" />
                {zone.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeZone && (
        <p className="zone-map-selected">
          <span className="zone-map-selected-label">Zona</span> {activeZone.name} — {activeZone.detail}
        </p>
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
  /**
   * WS-MINISTER-UX-04 — Le zone da mettere in evidenza su una mappa (dalla
   * direttiva di presentazione). Solo riferimenti: la geometria la porta il read
   * model.
   */
  focusRegionIds?: readonly string[];
  /**
   * WS-MINISTER-UX-07 (A2) — La voce di spesa da evidenziare nel grafico di
   * bilancio, scelta dal discorso. `undefined` = si mostra l'insieme.
   */
  focusLabel?: string;
}

export function SeatCanvas({ blocks, emptyLabel = 'Nessun dato pubblicato per questa sedia.', className, focusRegionIds, focusLabel }: SeatCanvasProps) {
  if (blocks.length === 0) {
    return <p className="seat-canvas-empty">{emptyLabel}</p>;
  }
  return (
    <div className={`seat-canvas${className ? ` ${className}` : ''}`} data-blocks={blocks.length}>
      {blocks.map(block => {
        if (block.kind === 'metrics') {
          const withHint = block.metrics.filter(metric => metric.hint);
          return (
            <section key={block.id} className="seat-canvas-block seat-canvas-metrics" data-kind="metrics">
              <h4 className="seat-canvas-title">{block.title}</h4>
              <dl className="seat-canvas-metric-list">
                {block.metrics.map(metric => (
                  <div key={metric.id} className={`seat-canvas-metric ${toneClass(metric.tone)}`}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.display}</dd>
                  </div>
                ))}
              </dl>
              {(block.note || withHint.length > 0) && (
                <Provenance label="Provenienza delle cifre">
                  {block.note && <p className="seat-canvas-note">{block.note}</p>}
                  {withHint.map(metric => (
                    <p key={metric.id} className="seat-sources-line">{metric.label}: {metric.hint}</p>
                  ))}
                </Provenance>
              )}
            </section>
          );
        }
        if (block.kind === 'chart') {
          return (
            <section key={block.id} className="seat-canvas-block" data-kind="chart">
              <AdvisorChart figure={block.figure} focusLabel={focusLabel} />
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
              <ZoneMap
                key={`${block.id}:${(focusRegionIds ?? []).join(',')}`}
                zones={block.zones}
                target={block.target}
                focusIds={focusRegionIds}
              />
              {block.note && (
                <Provenance label="Fonti della mappa">
                  <p className="seat-canvas-note">{block.note}</p>
                </Provenance>
              )}
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
