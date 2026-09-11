import { useMemo, useState } from 'react';
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

const TERRAIN_ITEMS = [
  { label: 'Pianure e foreste', background: 'linear-gradient(90deg, #2d5a27, #4a7c3a)' },
  { label: 'Colline', background: 'linear-gradient(90deg, #8b7355, #a68a64)' },
  { label: 'Montagne', background: 'linear-gradient(90deg, #6b5b4a, #8b7d6b)' },
  { label: 'Deserti', background: 'linear-gradient(90deg, #d4c48a, #e8d8a8)' },
  { label: 'Acqua', background: 'linear-gradient(90deg, #1a3a5c, #2d5a8a)' },
] as const;

const CHANGE_ITEMS = [
  { label: 'Confine precedente (cicatrice)', swatchStyle: { background: '#e9b85a', border: '2px dashed #9f3028' } },
  { label: 'Nuovo controllo', swatchStyle: { background: '#9f3028' } },
  { label: 'Liberato', swatchStyle: { background: '#5fa978' } },
  { label: 'Conteso', swatchStyle: { background: '#667eea' } },
] as const;

const LEGEND_COLLAPSED_KEY = 'ws-map-legend-collapsed';

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(LEGEND_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPreference);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      try {
        localStorage.setItem(LEGEND_COLLAPSED_KEY, prev ? '0' : '1');
      } catch {
        // localStorage indisponibile: ci si limita allo stato in memoria.
      }
      return !prev;
    });
  };

  return (
    <div
      className={`map-legend${collapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}`}
      role="region"
      aria-label="Legenda mappa"
    >
      {/* Intestazione collassabile: la legenda resta accessibile senza rubare
          spazio alla mappa, e la scelta persiste in localStorage. */}
      <button
        type="button"
        className="map-legend-toggle"
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <span className="map-legend-toggle-icon" aria-hidden="true">🗺️</span>
        Legenda mappa
        <span className="map-legend-chevron" aria-hidden="true">▼</span>
      </button>

      <div className="map-legend-body">
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
              <span className="map-legend-layer-icon" aria-hidden="true">{icon}</span>
              <span className="map-legend-layer-label">{label}</span>
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
              <div className="map-legend-owners-grid">
                {Array.from(ownerColors.entries()).slice(0, 12).map(([owner, color]) => (
                  <div key={owner} className="map-legend-owner">
                    <span className="map-legend-swatch" style={{ backgroundColor: color }} />
                    <span className="map-legend-owner-name">{owner}</span>
                  </div>
                ))}
              </div>
              {ownerColors.size > 12 && <span className="map-legend-more">+{ownerColors.size - 12} altri</span>}
            </div>
          </div>
        )}

        {activeLayer === 'terrain' && (
          <div className="map-legend-content" role="tabpanel">
            <p className="map-legend-hint">Colori per tipologia di terreno.</p>
            <div className="map-legend-terrain-swatch">
              {TERRAIN_ITEMS.map(({ label, background }) => (
                <div key={label} className="map-legend-swatch-row">
                  <span className="map-legend-terrain-bar" style={{ background }} aria-hidden="true" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeLayer === 'changes' && (
          <div className="map-legend-content" role="tabpanel">
            <p className="map-legend-hint">Cambiamenti territoriali recenti (ultimi 30 giorni).</p>
            <div className="map-legend-change-swatch">
              {CHANGE_ITEMS.map(({ label, swatchStyle }) => (
                <div key={label} className="map-legend-swatch-row">
                  <span className="map-legend-change-bar" style={swatchStyle} aria-hidden="true" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Provincia selezionata */}
        {selectedRegionId && (
          <div className="map-legend-selected">
            <strong>Selezionata: </strong>
            {regions.find(r => r.id === selectedRegionId)?.name || selectedRegionId}
          </div>
        )}
      </div>
    </div>
  );
}

export default MapLegend;