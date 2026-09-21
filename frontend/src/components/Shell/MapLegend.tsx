import { useId, useState } from 'react';
import type { Region } from '../../types';
import { DEFAULT_MAP_FILTERS, MAP_LAYERS, mapLayerDefinition, type MapFilters, type MapLayer } from '../Map/mapModel';
import {
  DIPLOMACY_LABELS,
  ECONOMY_COLORS,
  economyLegendRanges,
  type DiplomaticMapStatus,
  type ThematicMapModel,
} from '../Map/thematicMapModel';

export interface MapLegendProps {
  regions: Region[];
  selectedRegionId?: string | null;
  activeLayer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  filters?: Partial<MapFilters>;
  onFiltersChange?: (filters: Partial<MapFilters>) => void;
  /** MAP P3 — read model tematico per la legenda contestuale. */
  thematic?: ThematicMapModel;
  className?: string;
}

const FILTERS = [
  { id: 'showCities' as const, label: 'Città' },
  { id: 'showPorts' as const, label: 'Porti e basi navali' },
  { id: 'showIndustry' as const, label: 'Opere e industria' },
  { id: 'showUnits' as const, label: 'Unità e fronti' },
];
const LEGEND_COLLAPSED_KEY = 'ws-map-legend-collapsed';
const DIPLOMACY_ORDER: DiplomaticMapStatus[] = ['player', 'ally', 'neutral', 'hostile', 'unknown'];
const DIPLOMACY_KEY_CLASS: Record<DiplomaticMapStatus, string> = {
  player: 'map-key-diplo-player', ally: 'map-key-diplo-ally', neutral: 'map-key-diplo-neutral',
  hostile: 'map-key-diplo-hostile', unknown: 'map-key-no-data',
};

function readCollapsedPreference(): boolean {
  try { return localStorage.getItem(LEGEND_COLLAPSED_KEY) !== '0'; }
  catch { return true; }
}

const formatValue = (value: number | null): string =>
  value === null ? '' : Math.round(value).toLocaleString('it-IT');

function economyRangeLabel(range: { min: number | null; max: number | null }): string {
  if (range.min === null) return `< ${formatValue(range.max)}`;
  if (range.max === null) return `≥ ${formatValue(range.min)}`;
  return `${formatValue(range.min)}–${formatValue(range.max)}`;
}

export function MapLegend({
  regions, selectedRegionId, activeLayer, onLayerChange, filters, onFiltersChange,
  thematic, className = '',
}: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const bodyId = useId();
  const layerGroup = useId();
  const selected = regions.find(region => region.id === selectedRegionId);
  const definition = mapLayerDefinition(activeLayer);
  const unitsVisible = filters?.showUnits ?? DEFAULT_MAP_FILTERS.showUnits;
  const economyRanges = thematic ? economyLegendRanges(thematic.economy) : [];

  return (
    <section className={`map-legend${collapsed ? ' collapsed' : ''} ${className}`} aria-label="Legenda mappa">
      <button type="button" className="map-legend-toggle" aria-expanded={!collapsed} aria-controls={bodyId}
        onClick={() => setCollapsed(previous => {
          try { localStorage.setItem(LEGEND_COLLAPSED_KEY, previous ? '0' : '1'); } catch { /* memory only */ }
          return !previous;
        })}>
        <span aria-hidden="true">▱</span>
        Livelli e legenda <span className="map-layer-caption">{definition.label}</span>
        <span className="map-legend-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="map-legend-body" id={bodyId} hidden={collapsed}>
        <fieldset className="map-layer-options">
          <legend>Vista della mappa</legend>
          {MAP_LAYERS.map(layer => <label key={layer.id}>
            <input type="radio" name={layerGroup} value={layer.id} checked={activeLayer === layer.id}
              onChange={() => onLayerChange(layer.id)} />
            <span>{layer.label}</span>
          </label>)}
        </fieldset>
        <p className="map-legend-explanation">{definition.description}</p>

        {onFiltersChange && <fieldset className="map-asset-options">
          <legend>Elementi visibili</legend>
          {FILTERS.map(filter => <label key={filter.id}>
            <input type="checkbox" checked={filters?.[filter.id] ?? DEFAULT_MAP_FILTERS[filter.id]}
              onChange={event => onFiltersChange({ [filter.id]: event.target.checked })} />{filter.label}
          </label>)}
        </fieldset>}

        {activeLayer === 'economy'
          ? <div className="map-key map-key-quantitative"
            data-economy-buckets={thematic ? thematic.economy.edges.join(',') : ''}>
            <span className="map-key-title">PIL territoriale</span>
            {economyRanges.map(range => <span key={range.index}>
              <i className={`map-key-economy-${range.index}`} style={{ background: ECONOMY_COLORS[range.index] }} />
              {economyRangeLabel(range)}
            </span>)}
            <span><i className="map-key-no-data" /> Dato non disponibile</span>
          </div>
          : activeLayer === 'diplomacy'
            ? <div className="map-key">
              <span className="map-key-title">Rapporto con il tuo Stato</span>
              {DIPLOMACY_ORDER.map(status => <span key={status}>
                <i className={DIPLOMACY_KEY_CLASS[status]} /> {DIPLOMACY_LABELS[status]}
              </span>)}
            </div>
            : activeLayer === 'infrastructure'
              ? <div className="map-key">
                <span><i className="map-key-industry" /> Opera industriale (fabbrica, porto, centrale, università)</span>
                <span><i className="map-key-construction" /> Cantiere in costruzione</span>
                <span><i className="map-key-strategic" /> Installazione strategica (base, radar, difesa)</span>
              </div>
              : activeLayer === 'resources'
                ? <div className="map-key">
                  <span className="map-key-title">Risorse territorializzate</span>
                  <span>{thematic?.resources.available
                    ? `${thematic.resources.sites.length} siti con localizzazione canonica`
                    : 'Nessuna risorsa con localizzazione territoriale canonica'}</span>
                </div>
                : <div className="map-key">
                  <span><i className="map-key-selected" /> Territorio selezionato</span>
                  <span><i className="map-key-changed" /> Territorio aggiornato</span>
                  <span><i className="map-key-scar" /> Controllo precedente (temporaneo)</span>
                  {unitsVisible && <span><i className="map-key-unit" /> Reparto persistente (stato attuale)</span>}
                  {unitsVisible && <span><i className="map-key-front" /> Fronte attivo e obiettivo</span>}
                  {unitsVisible && <span><i className="map-key-march" /> Trasferimento in corso (P6)</span>}
                  {unitsVisible && <span><i className="map-key-route" /> Spostamento eseguito (ultimi 30 giorni)</span>}
                  {unitsVisible && <span><i className="map-key-battle" /> Scontro segnalato nei dispacci</span>}
                </div>}
        {selected && <p className="map-legend-selection"><span style={{ background: selected.color }} />
          {selected.name} · {selected.polityName || selected.owner}
        </p>}
        <p className="map-legend-explanation">Trascina per spostarti, usa la rotella o due dita per lo zoom. Con il focus sulla mappa: frecce, + / − e 0.</p>
      </div>
    </section>
  );
}
export default MapLegend;
