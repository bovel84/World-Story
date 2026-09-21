/**
 * World Story — Fase 2: `GameMap`
 * ==============================
 * La superficie geografica della partita: MapLibre quando il mondo ha
 * geometrie, il rendering SVG di fallback quando ha path, e un invito a
 * tornare agli scenari quando non ha né l'uno né l'altro. Era un blocco JSX
 * dentro `renderGame`; qui è un componente con props esplicite.
 *
 * Contratto invariato: la mappa è un read model — mostra regioni, cambi,
 * cicatrici ed eventi, e l'unica mutazione che può innescare è la selezione di
 * una regione (che apre l'ispettore), mai un cambiamento del mondo.
 */
import React, { Suspense, lazy } from 'react';
import type { Region } from '../../types';
import type { TemporalScar } from '../Map/TemporalScarLayer';
import type { FeedItem } from './EventFeed';
import type { MapLayer, MapFilters } from '../Map/mapModel';
import type { MilitaryUnitPayload, WarFrontPayload } from '../../services/api';
import { MapView } from '../Map/MapView';

const MapboxMapView = lazy(async () => ({ default: (await import('../Map/MapboxMapView')).MapboxMapView }));

export interface GameMapProps {
  worldId?: string;
  regions: Region[];
  activeLayer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  filters: MapFilters;
  onFiltersChange: (partial: Partial<MapFilters>) => void;
  selectedRegion?: string;
  onRegionClick: (regionId: string) => void;
  /** MAP P4 — callback ID-only dei counter/fronti persistenti. */
  onUnitClick: (unitId: string) => void;
  onFrontClick: (frontId: string) => void;
  /** Solo un comando esplicito muove la camera; cambiare contesto non la resetta. */
  focusRegionRequest?: { regionId: string; requestId: number } | null;
  changedRegionIds: string[];
  temporalScars: TemporalScar[];
  events: FeedItem[];
  currentDate?: string;
  militaryUnits: MilitaryUnitPayload[];
  militaryFronts: WarFrontPayload[];
  militaryStateLoading?: boolean;
  militaryStateError?: string | null;
  /** MAP P3 — relazioni canoniche per il layer Diplomazia. */
  relationships?: Record<string, Record<string, string>> | null;
  showFlags: boolean;
  playerCountryCode: string;
  /** Nessuna geometria disponibile: torna agli scenari. */
  onBackToScenarios: () => void;
}

export function GameMap({
  worldId,
  regions,
  activeLayer,
  onLayerChange,
  filters,
  onFiltersChange,
  selectedRegion,
  onRegionClick,
  onUnitClick,
  onFrontClick,
  focusRegionRequest,
  changedRegionIds,
  temporalScars,
  events,
  currentDate,
  militaryUnits,
  militaryFronts,
  militaryStateLoading,
  militaryStateError,
  relationships,
  showFlags,
  playerCountryCode,
  onBackToScenarios,
}: GameMapProps) {
  if (regions.some(r => r.geojson)) {
    return (
      <Suspense fallback={<div className="map-loading-fallback" role="status">Caricamento mappa…</div>}>
        <MapboxMapView
          key={worldId}
          regions={regions}
          activeLayer={activeLayer}
          onLayerChange={onLayerChange}
          filters={filters}
          onFiltersChange={onFiltersChange}
          selectedRegionId={selectedRegion || undefined}
          onRegionClick={onRegionClick}
          onUnitClick={onUnitClick}
          onFrontClick={onFrontClick}
          focusRegionRequest={focusRegionRequest}
          changedRegionIds={changedRegionIds}
          temporalScars={temporalScars}
          events={events}
          currentDate={currentDate}
          militaryUnits={militaryUnits}
          militaryFronts={militaryFronts}
          militaryStateLoading={militaryStateLoading}
          militaryStateError={militaryStateError}
          relationships={relationships}
          showFlags={showFlags}
          playerCountryCode={playerCountryCode}
        />
      </Suspense>
    );
  }

  if (regions.some(r => r.svgPath)) {
    return (
      <MapView
        regions={regions}
        selectedRegionId={selectedRegion || undefined}
        onRegionClick={onRegionClick}
        changedRegionIds={changedRegionIds}
        activeLayer={activeLayer}
      />
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0f',
      color: '#667eea',
      padding: '40px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
      <h3>Mappa non disponibile</h3>
      <p style={{ color: '#b8c3d2', maxWidth: '360px' }}>
        Questo mondo non contiene geometrie regionali. Torna agli scenari e genera una nuova partita: il problema non si risolve attendendo.
      </p>
      <button type="button" className="btn-submit-actions" onClick={onBackToScenarios}>
        Torna agli scenari
      </button>
    </div>
  );
}
