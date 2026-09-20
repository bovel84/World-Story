/**
* World Story — mappa di gioco su MapLibre GL
 * =======================================
* Il componente ha mantenuto il nome storico MapboxMapView (usato in App.tsx),
* ma internamente funziona su MapLibre GL — senza token.
 * 
 * Look realistico (riferimento: Schermata 2026-09-03): basemap satellitare
 * World Imagery di Esri (gratuito, senza chiave) con colori smorzati; sopra,
 * le regioni della partita sono disegnate semitrasparenti così il terreno
 * (oceano blu scuro, verdi, deserti, montagne) resta visibile — stile HOI4/mod.
* Confini, etichette, oggetti e marker vengono disegnati
* solo dai dati della partita (region.geojson).
 *
 * Supporta: riempimenti delle regioni, confini, etichette nomi (MAIUSCOLO), selezione, hover,
 * tooltip con statistiche, evidenziazione delle regioni modificate, marker degli oggetti,
* navigazione da tastiera (+/-/0/frecce).
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { syncScarLayers, type TemporalScar } from './TemporalScarLayer';
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Region } from '../../types';
import type { MapObject } from '../../types';
import type { MilitaryUnitPayload, WarFrontPayload } from '../../services/api';
import { MapTools } from './MapTools';
import { MapLegend } from '../Shell/MapLegend';
import { MilitaryStateOverlay } from './MilitaryStateOverlay';
import { buildMilitaryMapModel } from './militaryMapModel';
import { RegionFeatureIndex, diffRegionFeatures, objectIconFor, objectIsVisible, objectQualifiesAtZoom, regionLabelVisible, fixedCityCoordinate, resolveMapObjectCoordinate, DEFAULT_MAP_FILTERS, EMPTY_IDS, type MapLayer, type MapFilters, type MapSearchEntry } from './mapModel';
import './map.css';
import { constructionReport } from '../../utils/construction';
import type { FeedItem } from '../Game/EventFeed';
import { TacticalOverlay } from './TacticalOverlay';
import { MarkerMotion } from './MarkerMotion';
import { createMilitarySymbol } from './militarySymbol';
import { MILITARY_TYPES } from './tacticalModel';

const EMPTY_EVENTS: FeedItem[] = [];

// I territori aggiornati nell'ultima sessione sopravvivono al rimontaggio
// della mappa (cambio modulo su mobile, ricarica della scheda): senza questa
// memoria la vista «Modifiche» partiva vuota e le icone dei cambiamenti
// sembravano sparire proprio dopo un refresh su telefono.
const RECENT_CHANGES_KEY = 'ws-recent-changed-regions';
function readRecentChangedRegions(scope: string): string[] {
  try {
    const raw = sessionStorage.getItem(`${RECENT_CHANGES_KEY}:${scope}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(0, 20)
      : [];
  } catch { return []; }
}
function writeRecentChangedRegions(scope: string, ids: string[]): void {
  try { sessionStorage.setItem(`${RECENT_CHANGES_KEY}:${scope}`, JSON.stringify(ids.slice(0, 20))); }
  catch { /* memoria volatile: la mappa funziona comunque */ }
}

// Il punto canonico di città e capitali vive in `mapModel` (`fixedCityCoordinate`):
// renderer e ricerca leggono lo **stesso** registro geografico, senza duplicati.

// Corrispondenza ISO 3166-1 alpha-3 → alpha-2 per flagcdn.com
const ISO3_TO_ISO2: Record<string, string> = {
  USA: 'us', RUS: 'ru', CHN: 'cn', GBR: 'gb', FRA: 'fr',
  DEU: 'de', JPN: 'jp', IND: 'in', BRA: 'br', CAN: 'ca',
  ITA: 'it', ESP: 'es', MEX: 'mx', AUS: 'au', KOR: 'kr',
  SAU: 'sa', TUR: 'tr', POL: 'pl', NLD: 'nl', BEL: 'be',
  SWE: 'se', NOR: 'no', DNK: 'dk', FIN: 'fi', AUT: 'at',
  CHE: 'ch', PRT: 'pt', GRC: 'gr', CZE: 'cz', HUN: 'hu',
  ROU: 'ro', BGR: 'bg', UKR: 'ua', BLR: 'by', SRB: 'rs',
  HRV: 'hr', BIH: 'ba', SVN: 'si', SVK: 'sk', MKD: 'mk',
  MNE: 'me', ALB: 'al', MDA: 'md', LTU: 'lt', LVA: 'lv', EST: 'ee',
  KAZ: 'kz', KGZ: 'kg', TJK: 'tj', TKM: 'tm', UZB: 'uz',
  AZE: 'az', GEO: 'ge', ARM: 'am', MNG: 'mn', NPL: 'np',
  PAK: 'pk', BGD: 'bd', LKA: 'lk', MMR: 'mm', KHM: 'kh',
  LAO: 'la', VNM: 'vn', THA: 'th', IDN: 'id', MYS: 'my',
  PHL: 'ph', SGP: 'sg', BRN: 'bn', TWN: 'tw', PRK: 'kp',
  IRN: 'ir', IRQ: 'iq', SYR: 'sy', ISR: 'il', JOR: 'jo',
  LBN: 'lb', KWT: 'kw', BHR: 'bh', QAT: 'qa', ARE: 'ae',
  OMN: 'om', YEM: 'ye', AFG: 'af', EGY: 'eg', LBY: 'ly',
  DZA: 'dz', MAR: 'ma', TUN: 'tn', SDN: 'sd', SDS: 'ss',
  ETH: 'et', ERI: 'er', DJI: 'dj', SOM: 'so', KEN: 'ke',
  UGA: 'ug', TZA: 'tz', RWA: 'rw', BDI: 'bi', COD: 'cd',
  COG: 'cg', CAF: 'cf', CMR: 'cm', TCD: 'td', NER: 'ne',
  NGA: 'ng', BEN: 'bj', TGO: 'tg', GHA: 'gh', CIV: 'ci',
  LBR: 'lr', SLE: 'sl', GIN: 'gn', GNB: 'gw', SEN: 'sn',
  GMB: 'gm', MRT: 'mr', MLI: 'ml', BFA: 'bf', CPV: 'cv',
  STP: 'st', GNQ: 'gq', GAB: 'ga', AGO: 'ao', ZMB: 'zm',
  ZWE: 'zw', MOZ: 'mz', MWI: 'mw', ZAF: 'za', NAM: 'na',
  BWA: 'bw', LSO: 'ls', SWZ: 'sz', MDG: 'mg', MUS: 'mu',
  SYC: 'sc', COM: 'km', ARG: 'ar', CHL: 'cl', COL: 'co',
  PER: 'pe', VEN: 've', ECU: 'ec', BOL: 'bo', PRY: 'py',
  URY: 'uy', GUY: 'gy', SUR: 'sr', GTM: 'gt', BLZ: 'bz',
  HND: 'hn', SLV: 'sv', NIC: 'ni', CRI: 'cr', PAN: 'pa',
  CUB: 'cu', HTI: 'ht', DOM: 'do', JAM: 'jm', TTO: 'tt',
  BHS: 'bs', BRB: 'bb', PRI: 'pr', GRD: 'gd', LCA: 'lc',
  VCT: 'vc', KNA: 'kn', ATG: 'ag', DMA: 'dm', GRL: 'gl',
  ISL: 'is', IRL: 'ie', LUX: 'lu', MLT: 'mt', CYP: 'cy',
  AND: 'ad', MCO: 'mc', SMR: 'sm', LIE: 'li', FJI: 'fj',
  PNG: 'pg', SLB: 'sb', VUT: 'vu', WSM: 'ws', TON: 'to',
  NZL: 'nz', KIR: 'ki', NRU: 'nr', PLW: 'pw', MHL: 'mh',
  FSM: 'fm', TLS: 'tl', GUM: 'gu', MNP: 'mp', ASM: 'as',
  NCL: 'nc', PYF: 'pf', COK: 'ck', NIU: 'nu', PCN: 'pn',
  WLF: 'wf', ABW: 'aw', CUW: 'cw', SXM: 'sx', MAF: 'mf',
  BLM: 'bl', BMU: 'bm', CYM: 'ky', TCA: 'tc', VGB: 'vg',
  VIR: 'vi', AIA: 'ai', MSR: 'ms', FLK: 'fk', SHN: 'sh',
  SGS: 'gs', IOT: 'io', SAH: 'eh', ATA: 'aq', ATF: 'tf',
  FRO: 'fo', GGY: 'gg', JEY: 'je', IMN: 'im', HKG: 'hk',
  PSE: 'ps', KOS: 'xk', ALD: 'ax', CYN: 'cy', SPM: 'pm',
};

// Le bandiere emoji servono solo per i codici davvero mappati: così un codice
// sconosciuto non stampa tre lettere al posto della bandiera.
const hasFlagCode = (code: string): boolean =>
  !!code && Object.prototype.hasOwnProperty.call(ISO3_TO_ISO2, code.toUpperCase());

// Conversione ISO 3166-1 alpha-3 in emoji-bandiera
const codeToEmoji = (code: string): string => {
  if (!code || code.length !== 3) return '';
  const toAlpha2 = ISO3_TO_ISO2[code];
  if (!toAlpha2) return code;
  return toAlpha2.toUpperCase().split('').map(c =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  ).join('');
};

// URL PNG della bandiera su flagcdn.com dal codice paese a 3 lettere
const getFlagUrl = (code3: string, size: number = 40): string | null => {
  const code2 = ISO3_TO_ISO2[code3];
  if (!code2) return null;
  return `https://flagcdn.com/w${size}/${code2}.png`;
};

interface MapboxMapViewProps {
  regions: Region[];
  selectedRegionId?: string;
  onRegionClick?: (regionId: string) => void;
  onRegionHover?: (regionId: string | null) => void;
  changedRegionIds?: string[];
  /** G4-C: cicatrici temporali — confini precedenti appena mutati. */
  temporalScars?: TemporalScar[];
  showFlags?: boolean;
  playerCountryCode?: string;
  showMinimap?: boolean;
  activeLayer?: MapLayer;
  onLayerChange?: (layer: MapLayer) => void;
  filters?: MapFilters;
  onFiltersChange?: (filters: Partial<MapFilters>) => void;
  events?: FeedItem[];
  currentDate?: string;
  /** MAP P2 — stato militare persistente attuale (player + NPC). */
  militaryUnits?: MilitaryUnitPayload[];
  militaryFronts?: WarFrontPayload[];
  militaryStateLoading?: boolean;
  militaryStateError?: string | null;
}


/** Contenuto sicuro per i popup degli oggetti importati da preset/salvataggi. */
const createObjectPopupContent = (obj: MapObject): HTMLDivElement => {
  const content = document.createElement('div');
  content.style.cssText = 'color:#e8e8ee;padding:4px;background:#141420;';

  const title = document.createElement('strong');
  const ownerCode = obj.owner ? String(obj.owner).toUpperCase() : '';
  const ownerFlag = hasFlagCode(ownerCode) ? `${codeToEmoji(ownerCode)} ` : '';
  title.textContent = `${ownerFlag}${obj.name}`;

  const meta = document.createElement('span');
  meta.style.cssText = 'color:#aaa;font-size:11px;line-height:1.45;';
  const status = typeof obj.metadata?.status === 'string' ? ` · ${obj.metadata.status}` : '';
  const planned = typeof obj.metadata?.plannedType === 'string' ? ` → ${obj.metadata.plannedType}` : '';
  const owner = obj.owner ? ` · ${obj.owner}` : '';
  meta.textContent = `${obj.type}${planned}${status}${owner}${obj.pop ? ` · ${obj.pop.toFixed(1)}M ab.` : ''}`;

  const report = constructionReport(obj);
  if (report.length) {
    content.append(title);
    for (const row of report) {
      const line = document.createElement('div');
      line.style.cssText = 'font-size:12px;line-height:1.5;margin-top:5px;overflow-wrap:anywhere;';
      line.textContent = `${row.label}: ${row.value}`;
      content.append(line);
    }
  } else content.append(title, document.createElement('br'), meta);
  if (MILITARY_TYPES.has(obj.type) && obj.metadata?.movedDate) {
    const movement = document.createElement('div');
    movement.style.cssText = 'margin-top:8px;border-top:1px solid #496071;padding-top:8px;font-size:12px;line-height:1.5;';
    movement.textContent = `Ultimo spostamento: ${obj.metadata.previousRegionName || 'origine registrata'} → posizione attuale · ${obj.metadata.movedDate}`;
    content.append(movement);
  }
  return content;
};

// Tile satellitari (World Imagery di Esri — gratuite, senza API key).
// Danno alla mappa l'aspetto realistico del riferimento: oceano blu scuro,
// terre con colori naturali (veri toni di verde/deserto/montagna).
const SATELLITE_TILES_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Stile base: satellite reale + sfondo scuro di riserva (se le tile non caricate —
// es. offline — la mappa resta usabile con lo sfondo scuro e le regioni). 
// Le regioni della partita sono disegnate SEMITRASPARENTI sopra il satellite,
// così il terreno resta visibile sotto i colori politici (stile HOI4/mod moderni).
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  name: 'world-story-satellite',
  sources: {
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_TILES_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Immagini © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0d1117' },
    },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      paint: {
        'raster-saturation': -0.15,
        'raster-contrast': 0.08,
        'raster-brightness-max': 0.8,
        'raster-fade-duration': 300,
      },
    },
  ],
};

const REGIONS_SOURCE_ID = 'regions';
const FILL_LAYER_ID = 'regions-fill';
const LINE_LAYER_ID = 'regions-line';
const GRATICULE_SOURCE_ID = 'graticule';
const GRATICULE_LAYER_ID = 'graticule-line';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_UNITS: MilitaryUnitPayload[] = [];
const EMPTY_FRONTS: WarFrontPayload[] = [];

// Griglia di coordinate (in gradi) come geojson proprio — senza sorgenti esterne
const buildGraticule = (): GeoJSON.FeatureCollection => {
  const features: GeoJSON.Feature[] = [];
  const STEP = 30;
  for (let lng = -180; lng <= 180; lng += STEP) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[lng, -85], [lng, 85]] },
    });
  }
  for (let lat = -60; lat <= 60; lat += STEP) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return { type: 'FeatureCollection', features };
};

// Attraversamento ricorsivo di tutte le coordinate della geometria (Polygon e MultiPolygon)
const eachPosition = (geometry: GeoJSON.Geometry, cb: (pos: GeoJSON.Position) => void): void => {
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      cb(coords as GeoJSON.Position);
      return;
    }
    coords.forEach(walk);
  };
  walk('coordinates' in geometry ? geometry.coordinates : undefined);
};

// Anelli esterni dei poligoni (per l'etichetta prendiamo il più grande)
const getOuterRings = (geometry: GeoJSON.Geometry): GeoJSON.Position[][] => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map(poly => poly[0]).filter(Boolean);
  }
  return [];
};

// Area dell'anello con la formula del laccio (per scegliere il poligono principale)
const ringArea = (ring: GeoJSON.Position[]): number => {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
};

// Centroid dell'anello (pesato; in caso degenere — media dei vertici)
const ringCentroid = (ring: GeoJSON.Position[]): [number, number] => {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const sum = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
};

// Punto etichetta della regione: centroid dell'anello esterno più grande
const getLabelPoint = (geometry: GeoJSON.Geometry): [number, number] | null => {
  const rings = getOuterRings(geometry);
  if (rings.length === 0) return null;
  const mainRing = rings.reduce((best, ring) => (ringArea(ring) > ringArea(best) ? ring : best));
  return ringCentroid(mainRing);
};

// Area in gradi² del poligono più grande (per la visibilità delle etichette
// nei mondi provinciali: le province piccole non affollano la vista mondo)
const areaCache = new WeakMap<GeoJSON.Geometry, number>();
const geometryAreaDeg2Client = (geometry: GeoJSON.Geometry): number => {
  const cached = areaCache.get(geometry);
  if (cached !== undefined) return cached;
  const rings = getOuterRings(geometry);
  let max = 0;
  for (const ring of rings) max = Math.max(max, Math.abs(ringArea(ring)));
  areaCache.set(geometry, max);
  return max;
};

// Limite Web Mercator in latitudine (oltre ±85° la proiezione non è definita)
const MAX_MERCATOR_LAT = 85;

// Clampa le coordinate nell'intervallo valido della mappa.
// Senza questo fitBounds/setLngLat lanciano «Invalid LngLat latitude value»,
// se la geometria tocca i poli (Antartide −90°) + il padding va oltre il limite.
const clampLngLat = (p: [number, number]): [number, number] => {
  let [lng, lat] = p;
  if (!isFinite(lng)) lng = 0;
  if (!isFinite(lat)) lat = 0;
  lng = Math.max(-180, Math.min(180, lng));
  lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  return [lng, lat];
};

export const MapboxMapView: React.FC<MapboxMapViewProps> = ({
  regions,
  selectedRegionId,
  onRegionClick,
  onRegionHover,
  changedRegionIds = EMPTY_IDS,
  temporalScars = [],
  showFlags = false,
  playerCountryCode,
  // Prop mantenuto per compatibilità API; la minimappa in modalità offline non è usata
  showMinimap = true,
  activeLayer = 'political',
  onLayerChange,
  filters = DEFAULT_MAP_FILTERS,
  onFiltersChange,
  events = EMPTY_EVENTS,
  currentDate,
  militaryUnits = EMPTY_UNITS,
  militaryFronts = EMPTY_FRONTS,
  militaryStateLoading = false,
  militaryStateError = null,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const objectMarkers = useRef<maplibregl.Marker[]>([]);
  type ObjectMarkerEntry = { signature: string; marker: maplibregl.Marker; el: HTMLDivElement; baseWidth: number; baseHeight: number; label: HTMLDivElement | null };
  const objectEntries = useRef(new Map<string, ObjectMarkerEntry>());
  const labelEntries = useRef(new Map<string, { signature: string; geometry: GeoJSON.Geometry; area: number; marker: maplibregl.Marker }>());
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const countryLabelMarkers = useRef<maplibregl.Marker[]>([]);
  // Etichette oggetti (città/costruzioni): mostrate solo da zoom 3.5 —
  // nei mondi provinciali ci sono centinaia di marker e a vista mondo
  // il testo affollerebbe la mappa
  const objectLabelEls = useRef<HTMLDivElement[]>([]);
  // Dimensioni base dei marker oggetti (per lo scaling con lo zoom)
  const objectBaseSizes = useRef<{ el: HTMLDivElement; baseWidth: number; baseHeight: number; label: HTMLDivElement | null; marker: maplibregl.Marker }[]>([]);
  // Info area per etichette regioni: id → area (gradi²) — le province piccole
  // mostrano il nome solo da zoom 3.2, le grandi sempre
  const regionAreas = useRef<Record<string, number>>({});
  const fittedInitialView = useRef(false);
  const featureIndex = useRef(new RegionFeatureIndex());
  const sentFeatures = useRef(new Map<string, GeoJSON.Feature>());
  const features = useMemo(() => featureIndex.current.build(regions, playerCountryCode), [regions, playerCountryCode]);
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const [recentRegionIds, setRecentRegionIds] = useState<string[]>(() => readRecentChangedRegions(playerCountryCode || 'local'));
  const highlightedIds = activeLayer === 'changes' ? recentRegionIds : changedRegionIds;
  const previousHighlights = useRef(new Set<string>());
  const [sourceRevision, setSourceRevision] = useState(0);
  const [markerViewportRevision, setMarkerViewportRevision] = useState(0);
  const updateVisibilityRef = useRef<() => void>(() => {});
  const markerMotion = useRef<MarkerMotion | null>(null);
  if (!markerMotion.current) markerMotion.current = new MarkerMotion(() => updateVisibilityRef.current());
  const reducedMotion = useRef(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotion.current = preference.matches;
      if (preference.matches || document.hidden) markerMotion.current?.finish();
    };
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      markerMotion.current?.dispose();
    };
  }, []);
  const regionsById = useMemo(() => new Map(regions.map(region => [region.id, region])), [regions]);

  // MAP P2 — read model derivato dello stato militare persistente. La mappa
  // resta un read model: nessuno stato militare parallelo vive qui.
  const militaryModel = useMemo(() => buildMilitaryMapModel({
    regions, units: militaryUnits, fronts: militaryFronts,
  }), [regions, militaryUnits, militaryFronts]);
  // Un reparto persistente sostituisce il vecchio marker aggregato con lo
  // stesso id; se non esiste un equivalente, il marker legacy resta visibile.
  const persistentMilitaryIds = useMemo(
    () => new Set(militaryUnits.flatMap(unit => [unit.id, unit.armyId])),
    [militaryUnits],
  );

  useEffect(() => {
    if (!changedRegionIds.length) return;
    const scope = playerCountryCode || 'local';
    setRecentRegionIds(previous => {
      const next = [...new Set([...changedRegionIds, ...previous])].slice(0, 20);
      writeRecentChangedRegions(scope, next);
      return next;
    });
  }, [changedRegionIds, playerCountryCode]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const hoveredRegion = hoveredRegionId ? regionsById.get(hoveredRegionId) : undefined;
  const tooltipInfo = hoveredRegion && hoverPoint ? {
    ...hoverPoint, name: hoveredRegion.name,
    owner: hoveredRegion.owner === 'neutral' ? null : hoveredRegion.polityName || hoveredRegion.owner,
    population: hoveredRegion.population, gdp: hoveredRegion.gdp, militaryPower: hoveredRegion.militaryPower,
  } : null;

  // Valori aggiornati per i gestori della mappa (registrati una volta sola)
  const onRegionClickRef = useRef(onRegionClick);
  onRegionClickRef.current = onRegionClick;
  const onRegionHoverRef = useRef(onRegionHover);
  onRegionHoverRef.current = onRegionHover;

  // Limiti della mappa dalle regioni (attraversamento di tutte le coordinate, incluso MultiPolygon)
  const getBounds = useCallback((): [[number, number], [number, number]] => {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    featuresRef.current.forEach(feature => {
      eachPosition(feature.geometry, (pos) => {
        minLng = Math.min(minLng, pos[0]);
        maxLng = Math.max(maxLng, pos[0]);
        minLat = Math.min(minLat, pos[1]);
        maxLat = Math.max(maxLat, pos[1]);
      });
    });

    if (!isFinite(minLng)) {
      return [[-180, -85], [180, 85]];
    }

    // Margine dai bordi
    const padding = 0.1;
    const lngPad = (maxLng - minLng) * padding;
    const latPad = (maxLat - minLat) * padding;

    // Clamp: il padding non deve portare i limiti oltre la proiezione (Antartide −90°)
    return [
      clampLngLat([minLng - lngPad, minLat - latPad]),
      clampLngLat([maxLng + lngPad, maxLat + latPad])
    ];
  }, []);

  // Funzioni di zoom per tastiera e pulsanti
  const zoomIn = useCallback(() => {
    map.current?.zoomIn({ duration: 300 });
  }, []);

  const zoomOut = useCallback(() => {
    map.current?.zoomOut({ duration: 300 });
  }, []);

  const resetView = useCallback(() => {
    map.current?.fitBounds(getBounds(), { padding: 50, duration: 500 });
  }, [getBounds]);

  const focusRegions = useCallback((ids: string[], duration = 500) => {
    const bounds = new maplibregl.LngLatBounds();
    ids.forEach(id => {
      const feature = featuresRef.current.get(id);
      if (feature) eachPosition(feature.geometry, position => bounds.extend(clampLngLat([position[0], position[1]])));
    });
    if (!bounds.isEmpty()) map.current?.fitBounds(bounds, {
      padding: { top: 110, bottom: 70, left: 50, right: 50 }, maxZoom: 6, duration,
    });
  }, []);

  const locate = useCallback((entry: MapSearchEntry) => {
    onRegionClickRef.current?.(entry.regionId);
    if (entry.point) map.current?.flyTo({ center: entry.point, zoom: 5, duration: 500 });
    else focusRegions([entry.regionId]);
  }, [focusRegions]);

  // Navigazione da tastiera: + / - / 0 / frecce
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!map.current || document.activeElement !== mapContainer.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
          e.preventDefault();
          zoomOut();
          break;
        case '0':
          e.preventDefault();
          resetView();
          break;
        case 'ArrowUp':
          e.preventDefault();
          map.current.panBy([0, -100], { duration: 200 });
          break;
        case 'ArrowDown':
          e.preventDefault();
          map.current.panBy([0, 100], { duration: 200 });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          map.current.panBy([-100, 0], { duration: 200 });
          break;
        case 'ArrowRight':
          e.preventDefault();
          map.current.panBy([100, 0], { duration: 200 });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, resetView]);

  // Inizializzazione della mappa (una volta sola)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: OFFLINE_STYLE,
      center: [0, 20],
      zoom: 1,
      attributionControl: false,
      keyboard: false, // One keyboard handler, scoped to the focused surface.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // Il mondo si scorre in ogni direzione, anche oltre l'antimeridiano: la
      // mappa non è mai chiusa a est/ovest e il pan non si blocca sul bordo.
      renderWorldCopies: true,
      locale: { 'NavigationControl.ZoomIn': 'Ingrandisci', 'NavigationControl.ZoomOut': 'Riduci', 'Map.Title': 'Mappa del mondo' },
    });
    map.current.getCanvas().tabIndex = -1;
    map.current.touchZoomRotate.disableRotation();
    const resizeObserver = new ResizeObserver(() => map.current?.resize());
    resizeObserver.observe(mapContainer.current);

    // Pulsanti zoom/bussola di MapLibre
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-right');

    // Game layers do not wait for external satellite tiles (slow/offline networks).
    map.current.on('style.load', () => {
      if (!map.current) return;
      const m = map.current;

      // Griglia di coordinate sotto le regioni
      m.addSource(GRATICULE_SOURCE_ID, { type: 'geojson', data: buildGraticule() });
      m.addLayer({
        id: GRATICULE_LAYER_ID,
        type: 'line',
        source: GRATICULE_SOURCE_ID,
        paint: {
          'line-color': '#1c2333',
          'line-width': 1,
        },
      });

      // Sorgente e layer delle regioni (i dati arriveranno dopo via setData)
      m.addSource(REGIONS_SOURCE_ID, { type: 'geojson', data: EMPTY_FC });

      // Riempimento delle regioni
      m.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: REGIONS_SOURCE_ID,
        paint: {
          // Selection changes the outline, never the political identity.
          'fill-color': ['get', 'color'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.7,
            ['boolean', ['feature-state', 'hovered'], false], 0.65,
            // Riempimento semitrasparente: il terreno satellitare resta visibile
            // sotto il colore politico (look realistico del riferimento).
            0.52
          ],
        },
      });

      // Confini delle regioni
      m.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: REGIONS_SOURCE_ID,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#ffffff',
            // Evidenziazione delle regioni modificate nel turno
            ['boolean', ['feature-state', 'changed'], false], '#edc36c',
            ['boolean', ['feature-state', 'hovered'], false], '#d3e4ee',
            // Confine scuro sottile — su un fondale satellitare si legge meglio
            // un tratto nero semi-scuro che il vecchio grigio piatto
            '#141414'
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            ['boolean', ['feature-state', 'changed'], false], 3,
            1.6
          ],
          'line-opacity': 0.85,
        },
      });

      // Clic sulla regione
      m.on('click', FILL_LAYER_ID, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id && onRegionClickRef.current) {
          onRegionClickRef.current(id);
        }
      });

      // Hover: cursore + stato locale + tooltip
      m.on('mouseenter', FILL_LAYER_ID, () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = 'pointer';
        }
      });

      m.on('mouseleave', FILL_LAYER_ID, () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = '';
        }
        setHoveredRegionId(null);
        setHoverPoint(null);
        onRegionHoverRef.current?.(null);
      });

      m.on('mousemove', FILL_LAYER_ID, (e) => {
        const props = e.features?.[0]?.properties;
        const id = props?.id || null;
        setHoveredRegionId(prev => (prev === id ? prev : id));
        if (onRegionHoverRef.current) {
          onRegionHoverRef.current(id);
        }
        // Content is derived from live props, including while the pointer is still.
        setHoverPoint(id ? { x: e.point.x, y: e.point.y } : null);
      });

      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        resizeObserver.disconnect();
        markerMotion.current?.dispose();
        objectEntries.current.forEach(entry => entry.marker.remove());
        labelEntries.current.forEach(entry => entry.marker.remove());
        objectEntries.current.clear();
        labelEntries.current.clear();
        map.current.remove();
        map.current = null;
        fittedInitialView.current = false;
        sentFeatures.current = new Map();
        previousHighlights.current.clear();
        setMapLoaded(false);
      }
    };
  }, []);

  // Only committed data changes reach the GeoJSON worker. Interaction uses
  // feature-state, so hovering never reparses/reuploads thousands of borders.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    const source = m.getSource(REGIONS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const diff = diffRegionFeatures(sentFeatures.current, features);
    if (diff) {
      for (const id of diff.remove || []) m.removeFeatureState({ source: REGIONS_SOURCE_ID, id });
      source.updateData(diff);
      sentFeatures.current = features;
      setSourceRevision(revision => revision + 1);
    }
    // Fit once per mounted world, never after an in-game addition/deletion.
    if (features.size && !fittedInitialView.current) {
      fittedInitialView.current = true;
      const playerIds = regions.filter(region => region.owner === (playerCountryCode || 'player')).map(region => region.id);
      if (playerIds.length) focusRegions(playerIds, 0);
      else m.fitBounds(getBounds(), { padding: 50, duration: 0 });
    }
  }, [features, mapLoaded, getBounds, focusRegions, playerCountryCode]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    const refreshCityViewport = () => setMarkerViewportRevision(revision => revision + 1);
    m.on('moveend', refreshCityViewport);
    m.on('resize', refreshCityViewport);
    return () => { m.off('moveend', refreshCityViewport); m.off('resize', refreshCityViewport); };
  }, [mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !selectedRegionId || !features.has(selectedRegionId)) return;
    const m = map.current;
    const target = { source: REGIONS_SOURCE_ID, id: selectedRegionId };
    m.setFeatureState(target, { selected: true });
    return () => { if (map.current === m && featuresRef.current.has(selectedRegionId)) m.setFeatureState(target, { selected: false }); };
  }, [selectedRegionId, mapLoaded, sourceRevision]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !hoveredRegionId || !features.has(hoveredRegionId)) return;
    const m = map.current;
    const target = { source: REGIONS_SOURCE_ID, id: hoveredRegionId };
    m.setFeatureState(target, { hovered: true });
    return () => { if (map.current === m && featuresRef.current.has(hoveredRegionId)) m.setFeatureState(target, { hovered: false }); };
  }, [hoveredRegionId, mapLoaded, sourceRevision]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const next = new Set(highlightedIds.filter(id => features.has(id)));
    for (const id of previousHighlights.current) {
      if (!next.has(id) && features.has(id)) map.current.setFeatureState({ source: REGIONS_SOURCE_ID, id }, { changed: false });
    }
    for (const id of next) map.current.setFeatureState({ source: REGIONS_SOURCE_ID, id }, { changed: true });
    previousHighlights.current = next;
  }, [highlightedIds, mapLoaded, sourceRevision]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    map.current.setPaintProperty(FILL_LAYER_ID, 'fill-opacity', [
      'case',
      ['boolean', ['feature-state', 'selected'], false], 0.7,
      ['boolean', ['feature-state', 'hovered'], false], 0.6,
      ...(activeLayer === 'changes' ? [['boolean', ['feature-state', 'changed'], false], 0.72] : []),
      activeLayer === 'terrain' ? 0.12 : activeLayer === 'changes' ? 0.18 : 0.52,
    ]);
  }, [activeLayer, mapLoaded]);

  // G4-C — cicatrici temporali: tratteggio e riempimento del vecchio padrone
  // sulle regioni appena cambiate. Layer non interattivi, sotto i controlli.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    syncScarLayers(map.current as any, temporalScars, regions);
  }, [temporalScars, regions, mapLoaded]);

  // Etichette delle regioni — marker HTML: lo stile offline senza glifi non supporta
  // layer symbol con text-field, quindi le etichette le disegniamo con elementi DOM
  // (pointer-events: none — non interferiscono con clic e hover sulle regioni).
  // Nei mondi provinciali (centinaia di regioni) il nome della provincia appare
  // SOLO quando la provincia è selezionata con un clic: la mappa resta leggibile
  // a ogni zoom e l'identità visiva la tengono le etichette delle nazioni.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    // Reuse unchanged labels: statistic/asset updates do not rebuild the DOM.
    labelMarkers.current = [];
    regionAreas.current = {};
    const liveLabels = new Set<string>();

    regions.forEach(region => {
      if (!region.geojson) return;
      try {
        const geometry = features.get(region.id)?.geometry;
        if (!geometry) return;
        regionAreas.current[region.id] = geometryAreaDeg2Client(geometry);
        // Thousands of provincial labels were created only to be hidden.
        // A province speaks only when selected; country labels cover the rest.
        const isProvince = regions.length > 350 || Boolean(region.metadata?.pax_region_id);
        if (isProvince && region.id !== selectedRegionId) return;
        liveLabels.add(region.id);
        const signature = JSON.stringify([region.name, region.flag, showFlags, region.metadata?.pax_region_id]);
        const previous = labelEntries.current.get(region.id);
        if (previous?.signature === signature && previous.geometry === geometry) {
          labelMarkers.current.push(previous.marker);
          regionAreas.current[region.id] = previous.area;
          return;
        }
        const point = getLabelPoint(geometry);
        if (!point) return;
        regionAreas.current[region.id] = geometryAreaDeg2Client(geometry);
        previous?.marker.remove();
        const flagEmoji = region.flag ? codeToEmoji(region.flag) : '';
        const el = document.createElement('div');
        el.className = 'openpax-map-label';
        el.dataset.regionId = region.id;
        el.dataset.province = isProvince ? '1' : '0';
        el.style.cssText = `
          pointer-events: none;
          color: #ffffff;
          font-size: 13px;
          font-weight: 700;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          text-transform: uppercase;
          letter-spacing: 1.6px;
          text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 6px rgba(0,0,0,0.8);
          white-space: nowrap;
          user-select: none;
        `;
        el.textContent = showFlags && flagEmoji ? `${flagEmoji} ${region.name}` : region.name;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(clampLngLat(point))
          .addTo(m);
        el.setAttribute('aria-hidden', 'true');
        el.removeAttribute('tabindex');
        labelMarkers.current.push(marker);
        labelEntries.current.set(region.id, { signature, geometry, area: regionAreas.current[region.id], marker });
      } catch (e) { /* ignoriamo il geojson corrotto */ }
    });
    for (const [id, entry] of labelEntries.current) {
      if (!liveLabels.has(id)) { entry.marker.remove(); labelEntries.current.delete(id); }
    }
    updateVisibilityRef.current();
  }, [regions, mapLoaded, showFlags, selectedRegionId]);

  // Una sola etichetta per politia, sempre visibile a ogni zoom: le province
  // parlano solo quando sono selezionate, ma la lettura politica della mappa
  // è sempre immediata.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    countryLabelMarkers.current.forEach(marker => marker.remove());
    countryLabelMarkers.current = [];

    const byOwner = new Map<string, Region[]>();
    regions.forEach(region => {
      if (!region.owner || region.owner === 'neutral' || !features.has(region.id)) return;
      const list = byOwner.get(region.owner) || [];
      list.push(region);
      byOwner.set(region.owner, list);
    });
    byOwner.forEach((countryRegions, owner) => {
      const capitalRegion = countryRegions.find(region => region.objects?.some(object => object.type === 'capital'));
      const representative = capitalRegion || countryRegions.reduce((largest, region) => {
        const area = regionAreas.current[region.id] || 0;
        const largestArea = regionAreas.current[largest.id] || 0;
        return area > largestArea ? region : largest;
      }, countryRegions[0]);
      if (!representative) return;
      const capital = representative.objects?.find(object => object.type === 'capital');
      let point: [number, number] | null = capital && typeof capital.lng === 'number' && typeof capital.lat === 'number'
        ? [capital.lng, capital.lat]
        : null;
      if (!point) point = getLabelPoint(features.get(representative.id)!.geometry);
      if (!point) return;
      const label = document.createElement('div');
      label.className = 'openpax-country-label';
      label.dataset.owner = owner;
      // Regione-sede dell'etichetta: se l'utente la seleziona, il label della
      // politia lascia il posto al label della regione (stesso punto, stesso nome).
      label.dataset.repRegionId = representative.id;
      // Priorità cartografica per il decluttering a vista mondo.
      label.dataset.area = String(regionAreas.current[representative.id] || 0);
      label.textContent = representative.polityName || owner;
      label.style.cssText = `
        pointer-events:none;color:#fff;font:800 11px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;
        letter-spacing:1.1px;text-transform:uppercase;white-space:nowrap;
        text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 5px #000;
      `;
      countryLabelMarkers.current.push(new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat(clampLngLat(point)).addTo(m));
      label.setAttribute('aria-hidden', 'true');
      label.removeAttribute('tabindex');
    });
    return () => {
      countryLabelMarkers.current.forEach(marker => marker.remove());
      countryLabelMarkers.current = [];
    };
  }, [regions, mapLoaded]);

  // Visibilità in base allo zoom: le province parlano solo da selezionate,
  // le regioni nazionali seguono la gerarchia per zoom, gli oggetti
  // (città grandi/costruzioni) da zoom 3.5
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    const updateVisibility = () => {
      const zoom = m.getZoom();
      const canvas = m.getCanvas();
      // Viewport stretto (mobile): lo stesso teatro ha meno pixel, quindi lo
      // zoom numerico resta più basso e unità/opere sparirebbero. Il bias alza
      // virtualmente la soglia; i cambiamenti recenti sono forzati in vista.
      const compact = canvas.clientWidth < 640;
      const zoomBias = compact ? 0.9 : 0;
      const changedRegionsOnLayer = activeLayer === 'changes' ? new Set(recentRegionIds) : null;
      // Elementi fuori camera non partecipano a layout/paint: essenziale nei
      // mondi provinciali su mobile, dove migliaia di marker saturano il DOM.
      const isInViewport = (point: maplibregl.LngLat) => {
        const projected = m.project(point);
        return projected.x >= -40 && projected.x <= canvas.clientWidth + 40
          && projected.y >= -40 && projected.y <= canvas.clientHeight + 40;
      };
      // Scaling dei marker oggetti con lo zoom: a vista mondo (zoom basso) i
      // marker restano minuscoli (0.72×) e crescono piano avvicinandosi, con un
      // tetto basso (1.4×) per non coprire il territorio.
      const scale = Math.min(1.4, 0.72 + zoom * 0.11);
      objectBaseSizes.current.forEach(({ el, baseWidth, baseHeight, label, marker }) => {
        const width = Math.max(5, Math.round(baseWidth * scale));
        const height = Math.max(5, Math.round(baseHeight * scale));
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        el.style.fontSize = `${Math.max(7, Math.round(8 * scale))}px`;
        const type = el.dataset.objectType;
        const pop = Number(el.dataset.population || 0);
        // A vista mondo non mostriamo nemmeno i puntini: centinaia di città
        // trasformano il globo in rumore visivo. Capitali da 2.0, grandi città
        // da 2.6, tutte le altre da 3.2; unità, porti e opere seguono
        // objectMinZoom così entrano per gradi invece che tutti insieme.
        // Nel layer «Modifiche» gli oggetti dei territori appena aggiornati
        // (unità, cantieri, fortificazioni) restano visibili a ogni zoom: sono
        // il motivo per cui il giocatore apre quella vista.
        const changedHere = !!changedRegionsOnLayer && type !== 'city' && changedRegionsOnLayer.has(el.dataset.regionId || '');
        const qualifies = changedHere || objectQualifiesAtZoom(type || 'city', zoom, pop, zoomBias);
        const showMarker = objectIsVisible(type || '', filters) && isInViewport(marker.getLngLat()) && qualifies;
        el.style.display = showMarker ? 'flex' : 'none';
        if (label) {
          label.style.top = `${height + 2}px`;
          label.style.fontSize = `${Math.max(8, Math.round(9 * scale))}px`;
        }
      });
      let shownRegionLabels = 0;
      labelMarkers.current.forEach((marker) => {
        const el = marker.getElement();
        if (!el) return;
        const regionId = el.dataset.regionId || '';
        const area = regionAreas.current[regionId] ?? 0;
        // Le province Pax mostrano il nome SOLO quando sono selezionate con un
        // clic: a ogni altro livello di zoom la mappa resta pulita, altrimenti
        // paesi con molte province diventano un muro di testo illeggibile.
        // L'hover è comunque copiato dal tooltip con i dati della provincia.
        // Stati/regioni nazionali conservano invece la gerarchia per zoom.
        const isProvince = el.dataset.province === '1';
        const selected = regionId === selectedRegionId;
        // A vista mondo lasciamo l'identità ai label delle politie (uno per
        // nazione). La decisione (gerarchia + budget) è pura e testabile.
        const decision = regionLabelVisible({
          isProvince, selected, hovered: regionId === hoveredRegionId, zoom, area, shown: shownRegionLabels,
        });
        const visible = decision.visible && isInViewport(marker.getLngLat());
        if (visible && decision.countsTowardBudget) shownRegionLabels += 1;
        el.style.display = visible ? '' : 'none';
      });

      // Una sola etichetta politica per area non sovrapposta. Le macroaree
      // vincono a zoom basso; selezione e hover hanno sempre priorità.
      type CountryBox = { el: HTMLElement; priority: number; x: number; y: number; w: number; h: number };
      const selectedOwner = regions.find(region => region.id === selectedRegionId)?.owner;
      const countryBoxes: CountryBox[] = [];
      countryLabelMarkers.current.forEach(marker => {
        const el = marker.getElement();
        const area = Number(el.dataset.area || 0);
        const selected = el.dataset.owner === selectedOwner;
        // Il nome della NAZIONE deve restare leggibile a ogni zoom: lo
        // nascondiamo solo se fuori camera o se la regione selezionata è
        // proprio la sede dell'etichetta (per non scrivere due volte lo
        // stesso nome nello stesso punto).
        const representativeLabel = labelEntries.current.get(el.dataset.repRegionId || '')?.marker.getElement();
        const representativeVisible = representativeLabel && representativeLabel.style.display !== 'none';
        const visible = isInViewport(marker.getLngLat()) && !representativeVisible;
        if (!visible) { el.style.display = 'none'; return; }
        el.style.display = '';
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        countryBoxes.push({
          el,
          priority: (selected ? 10_000 : 0) + Math.min(999, Math.round(area)),
          x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height,
        });
      });
      countryBoxes
        .sort((a, b) => b.priority - a.priority)
        .reduce<CountryBox[]>((accepted, box) => {
          const pad = 14;
          const hit = accepted.some(other =>
            Math.abs(other.x - box.x) < (other.w + box.w) / 2 + pad
            && Math.abs(other.y - box.y) < (other.h + box.h) / 2 + pad);
          box.el.style.opacity = hit ? '0' : '1';
          if (!hit) accepted.push(box);
          return accepted;
        }, []);
      // ── Anti-sovrapposizione etichette (stile Victoria 3) ──────────────
      // Proietta ogni etichetta visibile sullo schermo, ordina per priorità
      // (capitali > città principali > popolose > altre) e accende solo quelle
      // il cui rettangolo non collide con un'etichetta già accesa.
      type Box = { el: HTMLDivElement; priority: number; x: number; y: number; w: number; h: number };
      const boxes: Box[] = [];
      objectLabelEls.current.forEach(el => {
        const type = el.dataset.objectType;
        const pop = Number(el.dataset.population || 0);
        const primary = el.dataset.primary === 'true';
        // Etichette città solo da zoom alto: a vista mondo restano solo i
        // nomi delle regioni, niente duplicati (regione + città sovrapposti)
        const visible = (type === 'capital' && zoom >= 2.8
          || (pop >= 3 && zoom >= 3.0)
          || zoom >= 3.4) && el.parentElement?.style.display !== 'none';
        if (!visible) { el.style.opacity = '0'; return; }
        // Il parent del label è il marker-el; il suo rect segue la proiezione mappa
        const host = el.parentElement as HTMLElement | null;
        if (!host || host.style.display === 'none') { el.style.opacity = '0'; return; }
        const r = el.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        if (r.width === 0) { el.style.opacity = '0'; return; }
        const priority = (type === 'capital' ? 3 : 0) + (primary ? 2 : 0) + (pop >= 3 ? 1 : 0);
        boxes.push({ el, priority, x: hr.left, y: r.top, w: r.width, h: r.height });
      });
      boxes
        .sort((a, b) => b.priority - a.priority || a.y - b.y)
        .reduce<Box[]>((accepted, box) => {
          const pad = 4;
          const hit = accepted.some(o =>
            Math.abs(o.x - box.x) < (o.w + box.w) / 2 + pad &&
            Math.abs(o.y - box.y) < (o.h + box.h) / 2 + pad);
          box.el.style.opacity = hit ? '0' : '1';
          if (!hit) accepted.push(box);
          return accepted;
        }, []);
    };

    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateVisibility(); });
    };
    updateVisibilityRef.current = schedule;
    m.on('move', schedule);
    m.on('resize', schedule);
    schedule(); // Runs after all marker reconciliation effects, before paint.

    return () => {
      cancelAnimationFrame(frame);
      m.off('move', schedule);
      m.off('resize', schedule);
      updateVisibilityRef.current = () => {};
    };
  }, [regions, mapLoaded, selectedRegionId, hoveredRegionId, filters, activeLayer, recentRegionIds]);

  // Tutti gli oggetti di gioco di tutte le regioni (per i marker).
  // `regionOwner` permette di scegliere una città principale per ogni nazione:
  // capitale se presente, altrimenti città più popolosa.
  const allObjects = useMemo(() => {
    type RenderObject = MapObject & {
      regionId: string;
      regionName: string;
      regionColor: string;
      regionOwner: string;
      regionCountry: string;
      objectOwnerColor: string;
      objectOwnerCode: string;
      isPrimary: boolean;
      stackIndex: number;
      stackSize: number;
    };
    const result: RenderObject[] = [];
    const raw: Omit<RenderObject, 'isPrimary' | 'stackIndex' | 'stackSize'>[] = [];
    const ownerColors = new Map(regions
      .filter(region => region.owner && region.owner !== 'neutral')
      .map(region => [region.owner, region.color] as const));
    regions.forEach(region => {
      (region.objects || []).forEach((obj: MapObject) => {
        // MAP P2: il reparto persistente vince come stato operativo.
        if (MILITARY_TYPES.has(obj.type) && persistentMilitaryIds.has(obj.id)) return;
        raw.push({
          ...obj,
          regionId: region.id,
          regionName: region.name,
          regionColor: region.color,
          regionOwner: region.owner,
          regionCountry: String(region.flag || region.owner || '').toUpperCase(),
          objectOwnerColor: ownerColors.get(String(obj.owner || region.owner)) || region.color,
          objectOwnerCode: String(obj.owner || region.owner || '').toUpperCase(),
        });
      });
    });
    // Una stessa località può arrivare da un vecchio salvataggio come capitale
    // inglese e città italiana: il punto fisso la rende identificabile e la
    // capitale prevale, quindi il renderer crea un unico marker.
    const uniqueRaw: typeof raw = [];
    for (const obj of raw) {
      const fixed = fixedCityCoordinate(obj.type, obj.regionCountry, obj.name);
      const duplicateIndex = (obj.type === 'city' || obj.type === 'capital') && fixed
        ? uniqueRaw.findIndex(other => {
          if ((other.type !== 'city' && other.type !== 'capital') || other.regionCountry !== obj.regionCountry) return false;
          const otherFixed = fixedCityCoordinate(other.type, other.regionCountry, other.name);
          return !!otherFixed && Math.abs(otherFixed[0] - fixed[0]) < 0.08 && Math.abs(otherFixed[1] - fixed[1]) < 0.08;
        })
        : -1;
      if (duplicateIndex < 0) uniqueRaw.push(obj);
      else if (obj.type === 'capital' && uniqueRaw[duplicateIndex].type !== 'capital') uniqueRaw[duplicateIndex] = obj;
    }

    const primaryByOwner = new Map<string, string>();
    for (const obj of uniqueRaw) {
      if (obj.type !== 'capital' && obj.type !== 'city') continue;
      const currentId = primaryByOwner.get(obj.regionOwner);
      const current = raw.find(x => x.id === currentId);
      if (!current || obj.type === 'capital' || (current.type !== 'capital' && (obj.pop || 0) > (current.pop || 0))) {
        primaryByOwner.set(obj.regionOwner, obj.id);
      }
    }
    // Gli oggetti generati dal motore condividono spesso il centroide della
    // provincia. Conserviamo quel punto canonico ma assegniamo slot visuali:
    // i contatori non si coprono e restano tutti cliccabili a ogni zoom.
    const visibleRaw = uniqueRaw.filter(obj => obj.type !== 'capital');
    const stackKey = (obj: typeof visibleRaw[number]): string => {
      const point = resolveMapObjectCoordinate({
        type: obj.type, country: obj.regionCountry, name: obj.name, lng: obj.lng, lat: obj.lat,
      });
      if (point) return `${point[0].toFixed(4)}:${point[1].toFixed(4)}`;
      if (typeof obj.x === 'number' && typeof obj.y === 'number') return `svg:${obj.x.toFixed(2)}:${obj.y.toFixed(2)}`;
      return `unplaced:${obj.id}`;
    };
    const stackTotals = new Map<string, number>();
    const stackSeen = new Map<string, number>();
    visibleRaw.forEach(obj => stackTotals.set(stackKey(obj), (stackTotals.get(stackKey(obj)) || 0) + 1));
    for (const obj of visibleRaw) {
      const key = stackKey(obj);
      const stackIndex = stackSeen.get(key) || 0;
      stackSeen.set(key, stackIndex + 1);
      result.push({
        ...obj,
        isPrimary: primaryByOwner.get(obj.regionOwner) === obj.id,
        stackIndex,
        stackSize: stackTotals.get(key) || 1,
      });
    }
    return result;
  }, [regions, persistentMilitaryIds]);

  // Marker degli oggetti
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    objectMarkers.current = [];
    objectLabelEls.current = [];
    objectBaseSizes.current = [];
    const liveObjects = new Set<string>();
    const zoom = m.getZoom();
    const canvas = m.getCanvas();
    let visibleCities = 0;

    allObjects.forEach(obj => {
      // Authority condivisa con la ricerca: registro canonico → lat/lng validi.
      // Il fallback x/y resta solo qui per i vecchi mondi SVG.
      let lngLat = resolveMapObjectCoordinate({
        type: obj.type, country: obj.regionCountry, name: obj.name, lng: obj.lng, lat: obj.lat,
      });
      if (!lngLat && obj.x !== undefined && obj.y !== undefined) {
        lngLat = [(obj.x / 2000) * 360 - 180, 90 - (obj.y / 1500) * 180];
      }
      if (!lngLat || !lngLat.every(Number.isFinite)) return;
      if (obj.type === 'city' || obj.type === 'capital') {
        const qualifies = filters.showCities && objectQualifiesAtZoom(obj.type, zoom, obj.pop || 0);
        if (!qualifies) return;
        const point = m.project(clampLngLat(lngLat));
        if (point.x < -40 || point.x > canvas.clientWidth + 40 || point.y < -40 || point.y > canvas.clientHeight + 40 || visibleCities >= 300) return;
        visibleCities++;
      }
      // Object IDs belong to the world, not the region: crossing a border
      // must keep the same marker and an already-open popup.
      const key = obj.id;
      liveObjects.add(key);
      const signature = JSON.stringify(obj);
      const previous = objectEntries.current.get(key);
      if (previous?.signature === signature) {
        objectMarkers.current.push(previous.marker);
        if (previous.label) objectLabelEls.current.push(previous.label);
        objectBaseSizes.current.push(previous);
        return;
      }

      const icon = objectIconFor(obj);
      const plannedType = typeof obj.metadata?.plannedType === 'string' ? obj.metadata.plannedType : '';
      const militaryTypes = new Set(['army', 'battalion', 'fleet', 'missile']);
      const isMobilizing = obj.type === 'mobilization';
      const isMilitary = militaryTypes.has(obj.type) || isMobilizing;
      const isInProgress = obj.type === 'construction_site' || isMobilizing;
      const isSmallDot = obj.type === 'city';
      const isFacility = !isSmallDot && !isMilitary && obj.type !== 'capital';
      // Dimensioni base contenute: a vista mondo lo scaling le riduce ancora,
      // così le icone non coprono i confini e le etichette delle nazioni.
      const baseWidth = isMilitary ? 26 : obj.type === 'capital' ? 13 : isSmallDot ? 7 : 13;
      const baseHeight = isMilitary ? 20 : baseWidth;

      // Contatori in stile atlante operativo: unità rettangolari col bordo
      // della nazione, opere quadrate, cantieri tratteggiati. Il doppio bordo
      // mantiene leggibilità tanto sul satellite quanto sui colori politici.
      const el = previous?.el || document.createElement('div');
      el.replaceChildren();
      el.className = 'openpax-map-object';
      el.dataset.objectId = obj.id;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${obj.name} · ${plannedType || obj.type}`);
      el.dataset.objectType = obj.type;
      el.dataset.military = String(isMilitary);
      el.dataset.regionId = obj.regionId;
      el.dataset.population = String(obj.pop || 0);
      el.dataset.objectStatus = String(obj.metadata?.status || '');
      el.title = plannedType ? `${obj.name} · ${plannedType}` : `${obj.name} · ${obj.type}`;
      const isMine = !!playerCountryCode && obj.objectOwnerCode === playerCountryCode;
      const borderColor = isMilitary
        ? (isMine ? '#ffffff' : obj.objectOwnerColor)
        : 'rgba(12, 15, 20, 0.9)';
      el.style.cssText = `
        width: ${baseWidth}px;
        height: ${baseHeight}px;
        background: ${isMilitary ? `linear-gradient(165deg, ${icon.color}, #243542)` : icon.color};
        border: ${isInProgress ? '1.5px dashed' : isSmallDot ? '1px solid' : '1.5px solid'} ${borderColor};
        outline: ${isMine ? '2px solid #ffffff' : isSmallDot ? 'none' : '1px solid rgba(255, 255, 255, 0.55)'};
        border-radius: ${isSmallDot ? '50%' : isMilitary ? '2px' : isFacility ? '3px' : '50%'};
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        font-size: 8px;
        font-weight: 800;
        line-height: 1;
        color: ${isMilitary ? '#fff0d8' : '#11151b'};
        cursor: pointer;
        box-shadow: ${isMilitary ? `inset 0 -2px 0 ${obj.objectOwnerColor}${isMine ? ', 0 0 0 2px rgba(255,255,255,0.85)' : ''}, 0 1px 4px rgba(0,0,0,0.55)` : '0 1px 4px rgba(0,0,0,0.5)'};
        opacity: ${isInProgress ? '0.75' : '1'};
        position: absolute;
      `;
      if (isMilitary) {
        el.appendChild(createMilitarySymbol(isMobilizing ? plannedType : obj.type));
        const echelon = document.createElement('span');
        echelon.className = 'openpax-unit-echelon';
        echelon.textContent = isMobilizing ? '⋯' : obj.type === 'army' ? 'Ⅱ' : 'Ⅰ';
        el.appendChild(echelon);
      } else if (!isSmallDot) el.textContent = icon.label;

      // Bandiera dell'unità: distingue a colpo d'occhio le forze proprie da
      // quelle dell'avversario, che spesso hanno colori politici simili.
      if (isMilitary && hasFlagCode(obj.objectOwnerCode)) {
        const badge = document.createElement('span');
        badge.className = 'openpax-object-flag';
        badge.textContent = codeToEmoji(obj.objectOwnerCode);
        badge.style.cssText = 'position:absolute;top:-9px;right:-9px;font-size:11px;line-height:1;pointer-events:none;filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);';
        el.appendChild(badge);
      }

      // Tutte le città del registro hanno un'etichetta; la visibilità è
      // gerarchica (capitale/principale sempre, metropoli e altre per zoom).
      const showLabel = true;
      let label: HTMLDivElement | null = null;
      if (showLabel) {
        label = document.createElement('div');
        label.className = 'openpax-object-label';
        label.textContent = obj.name;
        el.dataset.objectPlanned = plannedType;
        label.dataset.objectType = obj.type;
        label.dataset.population = String(obj.pop || 0);
        label.dataset.primary = String(obj.isPrimary);
        label.style.cssText = `
          position: absolute;
          left: 50%;
          top: ${baseHeight + 2}px;
          transform: translateX(-50%);
          color: #fff;
          font-size: 9px;
          font-weight: 600;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          text-shadow: 0 1px 3px rgba(0,0,0,0.95), -1px 0 2px rgba(0,0,0,0.85), 1px 0 2px rgba(0,0,0,0.85);
          letter-spacing: 0.3px;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
          opacity: 0;
          transition: opacity 0.25s;
        `;
        el.appendChild(label);
      }

      // Il primo oggetto resta sul centroide; gli altri formano anelli di
      // contatori in pixel, senza falsificare la posizione geografica salvata.
      const stackSlot = obj.stackIndex;
      const ring = stackSlot === 0 ? 0 : Math.floor((stackSlot - 1) / 8) + 1;
      const angle = stackSlot === 0 ? 0 : ((stackSlot - 1) % 8) * (Math.PI / 4);
      const radius = ring * 38;
      const offset: [number, number] = [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
      const marker = previous?.marker || new maplibregl.Marker({ element: el, anchor: 'center', offset });
      marker.setOffset(offset);
      const destination = clampLngLat(lngLat);
      if (previous && MILITARY_TYPES.has(obj.type) && !reducedMotion.current && !document.hidden) {
        markerMotion.current?.move(key, marker, destination);
      } else {
        markerMotion.current?.cancel(key);
        marker.setLngLat(destination);
      }
      if (previous) {
        // Keep the popup open and update its content as a unit moves/changes.
        marker.getPopup()?.setDOMContent(createObjectPopupContent(obj));
      } else {
        marker.setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(createObjectPopupContent(obj))).addTo(m);
      }
      const entry = { signature, el, baseWidth, baseHeight, label, marker, regionId: obj.regionId };
      objectEntries.current.set(key, entry);
      objectMarkers.current.push(marker);
      if (label) objectLabelEls.current.push(label);
      objectBaseSizes.current.push(entry);
    });

    for (const [key, entry] of objectEntries.current) {
      if (!liveObjects.has(key)) {
        markerMotion.current?.cancel(key);
        entry.marker.remove(); objectEntries.current.delete(key);
      }
    }
    updateVisibilityRef.current();
  }, [allObjects, mapLoaded, markerViewportRevision, filters]);

  return (
    <div className="world-map" data-map-layer={activeLayer}>
      <MapTools regions={regions} recentRegionIds={recentRegionIds} ready={mapLoaded}
        hasPlayer={regions.some(region => region.owner === (playerCountryCode || 'player'))}
        onLocate={locate} onWorld={resetView}
        onPlayer={() => focusRegions(regions.filter(region => region.owner === (playerCountryCode || 'player')).map(region => region.id))} />
      {onLayerChange && <MapLegend regions={regions} selectedRegionId={selectedRegionId}
        activeLayer={activeLayer} onLayerChange={onLayerChange}
        filters={filters} onFiltersChange={onFiltersChange} className="map-floating-legend" />}
      <div
        ref={mapContainer}
        className="map-keyboard-surface"
        style={{ width: '100%', height: '100%' }}
        tabIndex={0}
        role="region"
        aria-label="Mappa del mondo. Usa più, meno, zero e le frecce per navigare quando la mappa ha il focus."
        onPointerDown={event => {
          if (event.target instanceof HTMLCanvasElement) mapContainer.current?.focus({ preventScroll: true });
        }}
      />
      {mapLoaded && map.current && <TacticalOverlay map={map.current} regions={regions} events={events}
        currentDate={currentDate} visible={filters.showUnits} playerId={playerCountryCode}
        onFocus={id => focusRegions([id])} />}
      {mapLoaded && map.current && <MilitaryStateOverlay map={map.current} regions={regions} model={militaryModel}
        visible={filters.showUnits} loading={militaryStateLoading} error={militaryStateError}
        playerPolityId={playerCountryCode} onFocusRegion={id => focusRegions([id])} />}
      {!mapLoaded && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#d3e4ee',
          fontSize: '1.2rem',
        }}>
          Caricamento mappa…
        </div>
      )}

      {/* Tooltip della regione */}
      {tooltipInfo && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(tooltipInfo.x + 14, (mapContainer.current?.clientWidth || 320) - 248)),
            top: Math.max(8, Math.min(tooltipInfo.y + 14, (mapContainer.current?.clientHeight || 240) - 170)),
            width: 232,
            maxWidth: 'calc(100% - 16px)',
            overflowWrap: 'anywhere',
            background: 'rgba(20, 20, 30, 0.95)',
            border: '1px solid #444',
            borderRadius: '6px',
            padding: '10px 14px',
            color: '#fff',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            minWidth: '140px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', color: '#d3e4ee' }}>
            {tooltipInfo.name}
          </div>
          {tooltipInfo.owner && (
            <div style={{ color: '#ccc', marginBottom: '6px' }}>Controllo: {tooltipInfo.owner}</div>
          )}
          <div style={{ color: '#c4cfd8' }}>Popolazione: {tooltipInfo.population?.toLocaleString('it-IT')}</div>
          <div style={{ color: '#c4cfd8' }}>PIL: {tooltipInfo.gdp?.toLocaleString('it-IT')}</div>
          <div style={{ color: '#c4cfd8' }}>Forza militare: {tooltipInfo.militaryPower?.toLocaleString('it-IT')}</div>
          <div style={{ color: '#c4cfd8', marginTop: 8 }}>Seleziona per aprire il dossier ↗</div>
        </div>
      )}

      {/* I controlli nativi MapLibre, in alto a destra, sono l'unica
          navigazione della mappa: evitiamo duplicati nascosti dal feed. */}
      {/* Attribuzione tile satellitari (richiesta dalla licenza Esri) */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        zIndex: 5,
        padding: '2px 8px',
        background: 'rgba(10, 10, 15, 0.55)',
        color: 'rgba(255,255,255,0.55)',
        fontSize: '10px',
        borderTopLeftRadius: '6px',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        Immagini © Esri, Maxar, Earthstar Geographics
      </div>
    </div>
  );
};
