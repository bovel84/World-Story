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
 *
 * **La mappa non può abbattere il gioco.** MapLibre richiede WebGL e non ha
 * ripiego: senza contesto grafico solleva un errore non gestito che risale fino
 * alla radice React e uccide la partita (`Failed to initialize WebGL`). Qui la
 * disponibilità si accerta **prima** di montare la mappa e un confine d'errore
 * protegge comunque il montaggio; in entrambi i casi si degrada alla mappa
 * statica, che disegna il GeoJSON reale — il ripiego SVG non basta, perché i
 * mondi reali portano solo `geojson`.
 */
import React, { Suspense, lazy, useMemo } from 'react';
import type { Region } from '../../types';
import type { TemporalScar } from '../Map/TemporalScarLayer';
import type { FeedItem } from './EventFeed';
import type { MapLayer, MapFilters } from '../Map/mapModel';
import type { MilitaryUnitPayload, WarFrontPayload } from '../../services/api';
import { MapView } from '../Map/MapView';
import { StaticGeoMap } from '../Map/StaticGeoMap';
import { MapErrorBoundary } from './MapErrorBoundary';
import { detectWebGL } from '../Map/webglSupport';

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
  /** MAP P5 — candidati risorsa canonici: stessi input di mappa e dossier. */
  resourceCandidates?: readonly import('../Map/thematicMapModel').ResourceSiteCandidate[];
  /** MAP P6 — impianti canonici mondiali: stessa fonte di mappa e dossier. */
  worldFacilities?: readonly import('../Map/thematicMapModel').CanonicalFacilitySite[];
  /** MAP P6 — sorgente canonica non disponibile: il layer lo dichiara. */
  resourcesUnavailableReason?: string | null;
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
  resourceCandidates,
  worldFacilities,
  resourcesUnavailableReason,
  showFlags,
  playerCountryCode,
  onBackToScenarios,
}: GameMapProps) {
  // La disponibilità di WebGL si verifica **una volta** per montaggio: è una
  // prova sul documento, non dipende dalle regioni.
  const webgl = useMemo(() => detectWebGL(), []);

  if (regions.some(r => r.geojson)) {
    // Niente WebGL: la mappa interattiva non può partire. Si degrada subito,
    // senza nemmeno tentare — il tentativo costerebbe un errore non gestito.
    if (!webgl.available) {
      return (
        <StaticGeoMap
          regions={regions}
          selectedRegionId={selectedRegion}
          onRegionClick={onRegionClick}
          changedRegionIds={changedRegionIds}
          reason={webgl.reason}
        />
      );
    }
    return (
      // Anche con WebGL dichiarato disponibile il montaggio può fallire (driver,
      // contesto perso): il confine garantisce che la partita non muoia.
      <MapErrorBoundary fallback={
        <StaticGeoMap
          regions={regions}
          selectedRegionId={selectedRegion}
          onRegionClick={onRegionClick}
          changedRegionIds={changedRegionIds}
          reason="context_failed"
        />
      }>
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
            resourceCandidates={resourceCandidates}
            worldFacilities={worldFacilities}
            resourcesUnavailableReason={resourcesUnavailableReason}
            showFlags={showFlags}
            playerCountryCode={playerCountryCode}
          />
        </Suspense>
      </MapErrorBoundary>
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
