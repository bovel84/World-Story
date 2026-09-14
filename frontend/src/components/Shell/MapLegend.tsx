import { useId, useState } from 'react';
import type { Region } from '../../types';
import { DEFAULT_MAP_FILTERS, type MapFilters, type MapLayer } from '../Map/mapModel';

export interface MapLegendProps {
  regions: Region[];
  selectedRegionId?: string | null;
  activeLayer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  filters?: Partial<MapFilters>;
  onFiltersChange?: (filters: Partial<MapFilters>) => void;
  className?: string;
}

const LAYERS = [
  { id: 'political' as const, label: 'Politica' },
  { id: 'terrain' as const, label: 'Terreno' },
  { id: 'changes' as const, label: 'Modifiche' },
];
const FILTERS = [
  { id: 'showCities' as const, label: 'Città' },
  { id: 'showPorts' as const, label: 'Porti e basi navali' },
  { id: 'showIndustry' as const, label: 'Opere e industria' },
  { id: 'showUnits' as const, label: 'Unità e difese' },
];
const LEGEND_COLLAPSED_KEY = 'ws-map-legend-collapsed';
function readCollapsedPreference(): boolean {
  try { return localStorage.getItem(LEGEND_COLLAPSED_KEY) !== '0'; }
  catch { return true; }
}

export function MapLegend({ regions, selectedRegionId, activeLayer, onLayerChange, filters, onFiltersChange, className = '' }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const bodyId = useId();
  const layerGroup = useId();
  const selected = regions.find(region => region.id === selectedRegionId);
  return (
    <section className={`map-legend${collapsed ? ' collapsed' : ''} ${className}`} aria-label="Legenda mappa">
      <button type="button" className="map-legend-toggle" aria-expanded={!collapsed} aria-controls={bodyId}
        onClick={() => setCollapsed(previous => {
          try { localStorage.setItem(LEGEND_COLLAPSED_KEY, previous ? '0' : '1'); } catch { /* memory only */ }
          return !previous;
        })}>
        <span aria-hidden="true">▱</span>
        Livelli e legenda <span className="map-layer-caption">{LAYERS.find(layer => layer.id === activeLayer)?.label}</span>
        <span className="map-legend-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="map-legend-body" id={bodyId} hidden={collapsed}>
        <fieldset className="map-layer-options">
          <legend>Vista della mappa</legend>
          {LAYERS.map(layer => <label key={layer.id}>
            <input type="radio" name={layerGroup} value={layer.id} checked={activeLayer === layer.id}
              onChange={() => onLayerChange(layer.id)} />
            <span>{layer.label}</span>
          </label>)}
        </fieldset>
        <p className="map-legend-explanation">{activeLayer === 'terrain'
          ? 'Immagini satellitari con colori politici attenuati. I confini restano visibili.'
          : activeLayer === 'changes'
            ? 'In risalto gli ultimi territori aggiornati nella sessione. Usa “Modifiche” in alto per raggiungerli.'
            : 'I colori indicano il controllo dei territori. Seleziona un territorio per aprire il dossier.'}</p>
        {onFiltersChange && <fieldset className="map-asset-options">
          <legend>Elementi visibili</legend>
          {FILTERS.map(filter => <label key={filter.id}>
            <input type="checkbox" checked={filters?.[filter.id] ?? DEFAULT_MAP_FILTERS[filter.id]}
              onChange={event => onFiltersChange({ [filter.id]: event.target.checked })} />{filter.label}
          </label>)}
        </fieldset>}
        <div className="map-key">
          <span><i className="map-key-selected" /> Territorio selezionato</span>
          <span><i className="map-key-changed" /> Territorio aggiornato</span>
          <span><i className="map-key-scar" /> Controllo precedente (temporaneo)</span>
          <span><i className="map-key-route" /> Spostamento eseguito (ultimi 30 giorni)</span>
          <span><i className="map-key-battle" /> Scontro segnalato nei dispacci</span>
        </div>
        {selected && <p className="map-legend-selection"><span style={{ background: selected.color }} />
          {selected.name} · {selected.polityName || selected.owner}
        </p>}
        <p className="map-legend-explanation">Trascina per spostarti, usa la rotella o due dita per lo zoom. Con il focus sulla mappa: frecce, + / − e 0.</p>
      </div>
    </section>
  );
}
export default MapLegend;
