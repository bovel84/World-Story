import { useMemo, type ReactNode } from 'react';
import type { Region } from '../../types';

export interface MapLegendProps {
  regions: Region[];
  selectedRegionId?: string | null;
  /** Livello attivo: "political" | "terrain" | "changes" */
  activeLayer: 'political' | 'terrain' | 'changes';
  onLayerChange: (layer: 'political' | 'terrain' | 'changes') => void;
  /** Filtri opzionali per il livello politico */
  filters?: {
    showCities?: boolean;
    showPorts?: boolean;
    showIndustry?: boolean;
    showUnits?: boolean;
  };
  onFiltersChange?: (filters: Partial<MapLegendProps['filters']>) => void;
  className?: string;
}

const LAYERS = [
  { id: 'political' as const, label: 'Politica', icon: '🗺️' },
  { id: 'terrain' as const, label: 'Terreno', icon: '⛰️' },
  { id: 'changes' as const, label: 'Cambiamenti', icon: '⚡' },
] as const;

export function MapLegend({
  regions,
  selectedRegionId,
  activeLayer,
  onLayerChange,
  filters,
  onFiltersChange,
  className = '',
}: MapLegendProps) {
  const ownerColors = useMemo(() => {
    const map = new Map<string, string>();
    regions.forEach(r => {
      if (r.owner && r.owner !== 'neutral' && !map.has(r.owner)) {
        map.set(r.owner, r.color);
      }
    });
    return map;
  }, [regions]);

  return (
    <div className={`map-legend${className}`} role="region" aria-label="Legenda mappa">
      {/* Selettore livello */}
      <div className="map-legend-layers" role="tablist" aria-label="Livelli mappa">
        {LAYERS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeLayer === id}
            className={`map-legend-layer${activeLayer === id ? ' active' : ''}`}
            onClick={() => onLayerChange(id)}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Contenuto per livello */}
      {activeLayer === 'political' && (
        <div className="map-legend-content" role="tabpanel">
          <fieldset className="map-legend-filters">
            <legend>Filtri</legend>
            <label>
              <input
                type="checkbox"
                checked={filters?.showCities ?? true}
                onChange={e => onFiltersChange?.({ showCities: e.target.checked })}
              />
              Città
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters?.showPorts ?? true}
                onChange={e => onFiltersChange?.({ showPorts: e.target.checked })}
              />
              Porti
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters?.showIndustry ?? true}
                onChange={e => onFiltersChange?.({ showIndustry: e.target.checked })}
              />
              Industria
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters?.showUnits ?? true}
                onChange={e => onFiltersChange?.({ showUnits: e.target.checked })}
              />
              Unità
            </label>
          </fieldset>

          <div className="map-legend-owners">
            <strong>Proprietari</strong>
            {Array.from(ownerColors.entries()).slice(0, 12).map(([owner, color]) => (
              <div key={owner} className="map-legend-owner">
                <span className="map-legend-swatch" style={{ backgroundColor: color }} />
                <span>{owner}</span>
              </div>
            ))}
            {ownerColors.size > 12 && <span className="map-legend-more">+{ownerColors.size - 12} altri</span>}
          </div>
        </div>
      )}

      {activeLayer === 'terrain' && (
        <div className="map-legend-content" role="tabpanel">
          <p className="map-legend-hint">Livello terreno: colori per tipologia (pianure, colline, montagne, deserti, acqua).</p>
          <div className="map-legend-terrain-swatch">
            <span style={{ background: 'linear-gradient(90deg, #2d5a27, #4a7c3a)' }} title="Pianure/Foreste" />
            <span style={{ background: 'linear-gradient(90deg, #8b7355, #a68a64)' }} title="Colline" />
            <span style={{ background: 'linear-gradient(90deg, #6b5b4a, #8b7d6b)' }} title="Montagne" />
            <span style={{ background: 'linear-gradient(90deg, #d4c48a, #e8d8a8)' }} title="Deserti" />
            <span style={{ background: 'linear-gradient(90deg, #1a3a5c, #2d5a8a)' }} title="Acqua" />
          </div>
        </div>
      )}

      {activeLayer === 'changes' && (
        <div className="map-legend-content" role="tabpanel">
          <p className="map-legend-hint">Cambiamenti territoriali recenti (ultimi 30 giorni).</p>
          <div className="map-legend-change-swatch">
            <div><span style={{ background: '#e9b85a', border: '2px dashed #9f3028' }} /> Confine precedente (cicatrice)</div>
            <div><span style={{ background: '#9f3028' }} /> Nuovo controllo</div>
            <div><span style={{ background: '#5fa978' }} /> Liberato</div>
            <div><span style={{ background: '#667eea' }} /> Conteso</div>
          </div>
        </div>
      )}

      {/* Provincia selezionata */}
      {selectedRegionId && (
        <div className="map-legend-selected">
          <strong>Selezionata</strong>
          {regions.find(r => r.id === selectedRegionId)?.name || selectedRegionId}
        </div>
      )}
    </div>
  );
}

export default MapLegend;