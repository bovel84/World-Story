/**
 * World Story — mappa statica (ripiego senza WebGL)
 * =================================================
 * Disegna la geografia politica dal GeoJSON quando la mappa interattiva non può
 * partire. È un **read model**: mostra chi possiede cosa e consente di
 * selezionare una regione aprendo l'ispettore — l'unica mutazione che una mappa
 * può innescare in questo gioco.
 *
 * Non finge di essere MapLibre: niente zoom, niente layer tematici, niente
 * marker militari. Dichiara cosa manca (`webglUnavailableNotice`) invece di
 * lasciare il giocatore davanti a una schermata vuota.
 */
import React, { useMemo, useState } from 'react';
import type { Region } from '../../types';
import { buildStaticMap } from './staticMapModel';
import { webglUnavailableNotice, type WebGLSupport } from './webglSupport';

export interface StaticGeoMapProps {
  regions: readonly Region[];
  selectedRegionId?: string;
  onRegionClick?: (regionId: string) => void;
  changedRegionIds?: readonly string[];
  /** Ragione della indisponibilità: decide il messaggio, non il disegno. */
  reason?: WebGLSupport['reason'];
}

export const StaticGeoMap: React.FC<StaticGeoMapProps> = ({
  regions,
  selectedRegionId,
  onRegionClick,
  changedRegionIds,
  reason = 'context_failed',
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const model = useMemo(() => buildStaticMap(regions), [regions]);
  const changed = useMemo(() => new Set(changedRegionIds ?? []), [changedRegionIds]);

  if (model.paths.length === 0) {
    return (
      <div className="static-geo-map is-empty" role="status">
        <p>Mappa non disponibile: nessuna geometria disegnabile in questo mondo.</p>
      </div>
    );
  }

  return (
    <div className="static-geo-map" role="group" aria-label="Mappa politica statica">
      {/* Il messaggio è `role="status"`: annuncia la degradazione senza rubare
          il fuoco, e spiega che la partita continua. */}
      <p className="static-geo-map-notice" role="status">{webglUnavailableNotice(reason)}</p>
      <svg
        className="static-geo-map-canvas"
        viewBox={`0 0 ${model.width} ${model.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Mappa politica di ${model.paths.length} province`}
      >
        {model.paths.map(entry => {
          const isSelected = entry.id === selectedRegionId;
          const isChanged = changed.has(entry.id);
          return (
            <path
              key={entry.id}
              d={entry.path}
              fill={entry.color}
              fillOpacity={isSelected || hovered === entry.id ? 1 : 0.82}
              stroke={isSelected ? '#ffffff' : isChanged ? '#f0c419' : '#0a0a0f'}
              strokeWidth={isSelected ? 2 : isChanged ? 1.2 : 0.5}
              tabIndex={onRegionClick ? 0 : -1}
              role={onRegionClick ? 'button' : undefined}
              aria-label={`${entry.name} — ${entry.owner}`}
              onMouseEnter={() => setHovered(entry.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onRegionClick?.(entry.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onRegionClick?.(entry.id);
                }
              }}
            >
              <title>{`${entry.name} — ${entry.owner}`}</title>
            </path>
          );
        })}
      </svg>
      {model.skipped > 0 && (
        <p className="static-geo-map-skipped" role="note">
          {model.skipped} {model.skipped === 1 ? 'provincia non disegnata' : 'province non disegnate'}: geometria illeggibile.
        </p>
      )}
    </div>
  );
};

export default StaticGeoMap;
