/**
* Open-Pax — Componente mappa selezione mondo (Fase 4)
 * ==============================================
* Mappa SVG del mondo sulla geometria reale Natural Earth (senza dipendenze esterne).
* Proiezione equirettangolare: x = (lng + 180) / 360 * width,
 *                           y = (90 - lat) / 180 * height.
 * Clic su un paese disponibile → onSelect(code).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoApi } from '../../services/api';
import type { GeoCountryFeature } from '../../services/api';

/** Dimensioni logiche del viewBox della mappa */
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 500;

/** Proiezione lng/lat → coordinate SVG */
function project(lng: number, lat: number): [number, number] {
  return [((lng + 180) / 360) * MAP_WIDTH, ((90 - lat) / 180) * MAP_HEIGHT];
}

/** Anello del poligono (array [lng, lat]) → frammento di path */
function ringToPath(ring: number[][]): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d + 'Z';
}

/** Geometria del paese (Polygon/MultiPolygon) → attributo d per <path> */
function geometryToPath(geometry: GeoCountryFeature['geometry']): string {
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates as number[][][]).map(ringToPath).join('');
  }
  return (geometry.coordinates as number[][][][])
    .map((polygon) => polygon.map(ringToPath).join(''))
    .join('');
}

interface WorldSelectMapProps {
  /** Codici dei paesi selezionabili (ISO_A3) */
  availableCodes: string[];
  /** Codice attualmente selezionato (evidenziato sulla mappa) */
  selectedCode?: string | null;
  /** true = tutti i paesi cliccabili, false = solo availableCodes */
  allowAll?: boolean;
  /** Clic su un paese (selezione; la conferma è a carico del pulsante nel genitore) */
  onSelect: (code: string) => void;
/** Errore nel caricamento dei dati geografici — il genitore mostrerà la vista fallback */
  onError?: () => void;
}

interface TooltipState {
  name: string;
  x: number;
  y: number;
}

export const WorldSelectMap: React.FC<WorldSelectMapProps> = ({
  availableCodes,
  selectedCode = null,
  allowAll = false,
  onSelect,
  onError,
}) => {
  const [features, setFeatures] = useState<GeoCountryFeature[] | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Protezione da onError ripetuti (es. con StrictMode e doppio effetto)
  const errorReportedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    geoApi
      .getCountries()
      .then((collection) => {
        if (cancelled) return;
        if (!collection || !Array.isArray(collection.features)) {
          throw new Error('Risposta non valida da /api/geo/countries');
        }
        setFeatures(collection.features);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[WorldSelectMap] Dati geografici non disponibili, uso il fallback:', err);
        if (!errorReportedRef.current) {
          errorReportedRef.current = true;
          onError?.();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  // Insieme dei codici disponibili — per una verifica rapida
  const availableSet = useMemo(() => new Set(availableCodes), [availableCodes]);

  // Pre-costruisce il path per ogni paese
  const paths = useMemo(() => {
    if (!features) return [];
    return features.map((feature) => ({
      code: feature.properties.code,
      name: feature.properties.name,
      d: geometryToPath(feature.geometry),
    }));
  }, [features]);

  if (!features) {
    return (
      <div className="world-select-map">
        <div className="world-select-map-loading">Caricamento mappa del mondo…</div>
      </div>
    );
  }

/** Coordinate del cursore nel contenitore della mappa — per il tooltip */
  const updateTooltip = (e: React.MouseEvent, name: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ name, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="world-select-map" ref={containerRef}>
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mappa del mondo"
      >
        {paths.map(({ code, name, d }) => {
          const isAvailable = allowAll || availableSet.has(code);
          const isSelected = selectedCode === code;
          const className = [
            'world-country',
            isAvailable ? 'available' : 'disabled',
            isSelected ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <path
              key={code}
              d={d}
              className={className}
              onMouseMove={(e) => updateTooltip(e, name)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (isAvailable) onSelect(code);
              }}
            />
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="world-select-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.name}
        </div>
      )}
    </div>
  );
};

export default WorldSelectMap;
