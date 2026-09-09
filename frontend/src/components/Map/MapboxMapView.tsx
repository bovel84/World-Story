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
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Region } from '../../types';
import type { MapObject } from '../../types';
import citiesRegistry from '../../data/cities.json';
import capitalsRegistry from '../../data/capitals.json';

type CityLocation = { name: string; country: string; lat: number; lng: number; pop: number };
type CapitalLocation = { capital: string; lat: number; lng: number };

const normalizePlaceName = (value: string): string => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// Registro frontend: ogni città storica usa sempre questo punto geografico,
// senza dipendere da x/y legacy o da snapshot di partita meno recenti.
const FIXED_CITY_POINTS = new Map<string, CityLocation>(
  (citiesRegistry.cities as CityLocation[]).map(city => [
    `${city.country}:${normalizePlaceName(city.name)}`, city,
  ]),
);
const FIXED_CAPITAL_POINTS = capitalsRegistry as Record<string, CapitalLocation>;

const fixedCityCoordinate = (type: string, country: string, name: string): [number, number] | null => {
  if (type === 'capital') {
    const capital = FIXED_CAPITAL_POINTS[country];
    return capital ? [capital.lng, capital.lat] : null;
  }
  if (type !== 'city') return null;
  const city = FIXED_CITY_POINTS.get(`${country}:${normalizePlaceName(name)}`);
  return city ? [city.lng, city.lat] : null;
};

// Corrispondenza ISO 3166-1 alpha-3 → alpha-2 per flagcdn.com
const ISO3_TO_ISO2: Record<string, string> = {
  USA: 'us', RUS: 'ru', CHN: 'cn', GBR: 'gb', FRA: 'fr',
  DEU: 'de', JPN: 'jp', IND: 'in', BRA: 'br', CAN: 'ca',
  ITA: 'it', ESP: 'es', MEX: 'mx', AUS: 'au', KOR: 'kr',
  SAU: 'sa', TUR: 'tr', POL: 'pl', NLD: 'nl', BEL: 'be',
  SWE: 'se', NOR: 'no', DNK: 'dk', FIN: 'fi', AUT: 'at',
  CHE: 'ch', PRT: 'pt', GRC: 'gr', CZE: 'cz', HUN: 'hu',
  ROU: 'ro', BGR: 'bg', UKR: 'ua', KAZ: 'kz', ARG: 'ar',
  CHL: 'cl', COL: 'co', PER: 'pe', VEN: 've', ECU: 'ec',
  BOL: 'bo', PRY: 'py', URY: 'uy', GTM: 'gt', CUB: 'cu',
  HTI: 'ht', DOM: 'do', HND: 'hn', NIC: 'ni', CRI: 'cr',
  PAN: 'pa', SLV: 'sv', JAM: 'jm', TTO: 'tt', PRK: 'kp',
  VNM: 'vn', THA: 'th', IDN: 'id', MYS: 'my', PHL: 'ph',
  PAK: 'pk', BGD: 'bd', IRN: 'ir', IRQ: 'iq', SYR: 'sy',
  ISR: 'il', EGY: 'eg', LBY: 'ly', DZA: 'dz', MAR: 'ma',
  TUN: 'tn', NGA: 'ng', ZAF: 'za', ETH: 'et', KEN: 'ke',
  GHA: 'gh', AGO: 'ao', MOZ: 'mz', TZA: 'tz', CMR: 'cm',
  COD: 'cd', SDN: 'sd', SOM: 'so', YEM: 'ye', AFG: 'af',
  MMR: 'mm', KHM: 'kh', LAO: 'la', MNG: 'mn', NPL: 'np',
  LKA: 'lk', AZE: 'az', GEO: 'ge', ARM: 'am', BLR: 'by',
  MDA: 'md', LTU: 'lt', LVA: 'lv', EST: 'ee', SRB: 'rs',
  HRV: 'hr', BIH: 'ba', SVN: 'si', SVK: 'sk', MKD: 'mk',
  MNE: 'me', ALB: 'al', RWA: 'rw', UZB: 'uz', TKM: 'tm',
  KGZ: 'kg', TJK: 'tj',
};

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
  showFlags?: boolean;
  playerCountryCode?: string;
  showMinimap?: boolean;
}

// Icone degli oggetti di gioco sulla mappa
const OBJECT_ICONS: Record<string, { color: string; label: string }> = {
  city: { color: '#ffffff', label: '●' },
  // Capitale: stella dorata — visivamente distinta da una città normale
  capital: { color: '#ffd700', label: '★' },
  army: { color: '#ff4444', label: '▲' },
  // Battaglione: triangolo rosso (come l'esercito — entrambi i tipi vengono renderizzati)
  battalion: { color: '#ff4444', label: '▲' },
  fleet: { color: '#4488ff', label: '◆' },
  missile: { color: '#ff8800', label: '✈' },
  radar: { color: '#44ff44', label: '◎' },
  port: { color: '#4488ff', label: '⚓' },
  factory: { color: '#ffaa00', label: '⚙' },
  university: { color: '#aa44ff', label: '★' },
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
const geometryAreaDeg2Client = (geometry: GeoJSON.Geometry): number => {
  const rings = getOuterRings(geometry);
  let max = 0;
  for (const ring of rings) max = Math.max(max, Math.abs(ringArea(ring)));
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
  changedRegionIds = [],
  showFlags = false,
  playerCountryCode,
  // Prop mantenuto per compatibilità API; la minimappa in modalità offline non è usata
  showMinimap = true,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const objectMarkers = useRef<maplibregl.Marker[]>([]);
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const countryLabelMarkers = useRef<maplibregl.Marker[]>([]);
  // Etichette oggetti (città/costruzioni): mostrate solo da zoom 3.5 —
  // nei mondi provinciali ci sono centinaia di marker e a vista mondo
  // il testo affollerebbe la mappa
  const objectLabelEls = useRef<HTMLDivElement[]>([]);
  // Dimensioni base dei marker oggetti (per lo scaling con lo zoom)
  const objectBaseSizes = useRef<{ el: HTMLDivElement; base: number; label: HTMLDivElement | null }[]>([]);
  // Info area per etichette regioni: id → area (gradi²) — le province piccole
  // mostrano il nome solo da zoom 3.2, le grandi sempre
  const regionAreas = useRef<Record<string, number>>({});
  const fittedRegionIds = useRef<string>('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{ x: number; y: number; name: string; owner: string | null; population: number; gdp: number; militaryPower: number } | null>(null);

  // Valori aggiornati per i gestori della mappa (registrati una volta sola)
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const onRegionClickRef = useRef(onRegionClick);
  onRegionClickRef.current = onRegionClick;
  const onRegionHoverRef = useRef(onRegionHover);
  onRegionHoverRef.current = onRegionHover;

  // Limiti della mappa dalle regioni (attraversamento di tutte le coordinate, incluso MultiPolygon)
  const getBounds = useCallback((): [[number, number], [number, number]] => {
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    regionsRef.current.forEach(region => {
      if (!region.geojson) return;
      try {
        const geojson = JSON.parse(region.geojson);
        if (!geojson.geometry) return;
        eachPosition(geojson.geometry, (pos) => {
          minLng = Math.min(minLng, pos[0]);
          maxLng = Math.max(maxLng, pos[0]);
          minLat = Math.min(minLat, pos[1]);
          maxLat = Math.max(maxLat, pos[1]);
        });
      } catch (e) { /* ignoriamo il geojson corrotto */ }
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

  // Navigazione da tastiera: + / - / 0 / frecce
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!map.current) return;
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
    });

    // Pulsanti zoom/bussola di MapLibre
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
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
          'fill-color': [
            'case',
            ['get', 'isSelected'], '#ffffff',
            // Politia del giocatore: owner = polityId (codice paese da playerCountryCode;
            // per mappe personalizzate — 'player')
            ['get', 'isPlayer'], '#00ff88',
            ['get', 'color']
          ],
          'fill-opacity': [
            'case',
            ['get', 'isSelected'], 0.88,
            ['get', 'isHovered'], 0.72,
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
            ['get', 'isSelected'], '#ffffff',
            // Evidenziazione delle regioni modificate nel turno
            ['get', 'isChanged'], '#ffd700',
            ['get', 'isHovered'], '#8a8a8a',
            // Confine scuro sottile — su un fondale satellitare si legge meglio
            // un tratto nero semi-scuro che il vecchio grigio piatto
            '#141414'
          ],
          'line-width': [
            'case',
            ['get', 'isSelected'], 3,
            ['get', 'isChanged'], 3,
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
        setTooltipInfo(null);
      });

      m.on('mousemove', FILL_LAYER_ID, (e) => {
        const props = e.features?.[0]?.properties;
        const id = props?.id || null;
        setHoveredRegionId(prev => (prev === id ? prev : id));
        if (onRegionHoverRef.current) {
          onRegionHoverRef.current(id);
        }
        // Aggiornamento tooltip
        if (id) {
          const region = regionsRef.current.find(r => r.id === id);
          if (region) {
            // Riga «Controllo: X» — solo se la regione è posseduta da un'altra politia
            // (come nell'originale: tooltip «West Germany / Northern Bavaria»).
            // Il nome della politia lo prendiamo dalla sua regione «home» (id tipo `${worldId}_${polityId}`).
            let ownerName: string | null = null;
            const owner = region.owner;
            if (owner && owner !== 'neutral' && owner !== region.name) {
              const homeRegion = regionsRef.current.find(
                r => r.owner === owner && r.id.endsWith(`_${owner}`)
              );
              const resolved = homeRegion?.name || owner;
              if (resolved !== region.name) {
                ownerName = resolved;
              }
            }
            setTooltipInfo({
              x: e.point.x,
              y: e.point.y,
              name: region.name,
              owner: ownerName,
              population: region.population,
              gdp: region.gdp,
              militaryPower: region.militaryPower,
            });
          }
        }
      });

      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Dati delle regioni: ricostruzione della FeatureCollection e setData nella sorgente.
  // L'evidenziazione (selezione/hover/modificate) vive nelle properties delle feature, i layer non vengono ricreati.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    const geojsonFeatures: GeoJSON.Feature[] = [];

    regions.forEach(region => {
      if (!region.geojson) return;
      try {
        const parsed = JSON.parse(region.geojson);
        parsed.properties = {
          ...parsed.properties,
          id: region.id,
          name: region.name,
          color: region.color,
          flag: region.flag || null,
          flag_emoji: region.flag ? codeToEmoji(region.flag) : '',
          owner: region.owner || null,
          isSelected: region.id === selectedRegionId,
          isHovered: hoveredRegionId === region.id,
          isChanged: changedRegionIds.includes(region.id),
          isPlayer: !!region.owner && region.owner === (playerCountryCode || 'player'),
        };
        geojsonFeatures.push(parsed);
      } catch (e) { /* ignoriamo il geojson corrotto */ }
    });

    const source = m.getSource(REGIONS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: geojsonFeatures });

    // Al cambio del set di regioni adattiamo l'area visibile
    const idsKey = regions.map(r => r.id).sort().join('|');
    if (idsKey && idsKey !== fittedRegionIds.current) {
      fittedRegionIds.current = idsKey;
      m.fitBounds(getBounds(), { padding: 50, duration: 500 });
    }
  }, [regions, mapLoaded, selectedRegionId, hoveredRegionId, changedRegionIds, playerCountryCode, getBounds]);

  // Etichette delle regioni — marker HTML: lo stile offline senza glifi non supporta
  // layer symbol con text-field, quindi le etichette le disegniamo con elementi DOM
  // (pointer-events: none — non interferiscono con clic e hover sulle regioni).
  // Nei mondi provinciali (centinaia di regioni) le province piccole nascondono
  // il nome a vista mondo (zoom < 3.2) per non affollare la mappa.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    // Rimuove le vecchie etichette
    labelMarkers.current.forEach(marker => marker.remove());
    labelMarkers.current = [];
    regionAreas.current = {};

    regions.forEach(region => {
      if (!region.geojson) return;
      try {
        const geojson = JSON.parse(region.geojson);
        if (!geojson.geometry) return;
        const point = getLabelPoint(geojson.geometry);
        if (!point) return;
        regionAreas.current[region.id] = geometryAreaDeg2Client(geojson.geometry);

        const flagEmoji = region.flag ? codeToEmoji(region.flag) : '';
        const el = document.createElement('div');
        el.className = 'openpax-map-label';
        el.dataset.regionId = region.id;
        el.dataset.province = region.metadata?.pax_region_id ? '1' : '0';
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
        labelMarkers.current.push(marker);
      } catch (e) { /* ignoriamo il geojson corrotto */ }
    });

    return () => {
      labelMarkers.current.forEach(marker => marker.remove());
      labelMarkers.current = [];
    };
  }, [regions, mapLoaded, showFlags]);

  // Una sola etichetta per politia: le province restano mute finché non sono
  // selezionate, ma la lettura politica della mappa è sempre immediata.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;
    countryLabelMarkers.current.forEach(marker => marker.remove());
    countryLabelMarkers.current = [];

    const byOwner = new Map<string, Region[]>();
    regions.forEach(region => {
      if (!region.owner || region.owner === 'neutral') return;
      const list = byOwner.get(region.owner) || [];
      list.push(region);
      byOwner.set(region.owner, list);
    });
    byOwner.forEach((countryRegions, owner) => {
      const capitalRegion = countryRegions.find(region => region.objects?.some(object => object.type === 'capital'));
      const representative = capitalRegion || countryRegions.reduce((largest, region) => {
        const area = region.geojson ? geometryAreaDeg2Client(JSON.parse(region.geojson).geometry) : 0;
        const largestArea = largest?.geojson ? geometryAreaDeg2Client(JSON.parse(largest.geojson).geometry) : -1;
        return area > largestArea ? region : largest;
      }, countryRegions[0]);
      if (!representative) return;
      const capital = representative.objects?.find(object => object.type === 'capital');
      let point: [number, number] | null = capital && typeof capital.lng === 'number' && typeof capital.lat === 'number'
        ? [capital.lng, capital.lat]
        : null;
      if (!point && representative.geojson) {
        try { point = getLabelPoint(JSON.parse(representative.geojson).geometry); } catch { /* no label */ }
      }
      if (!point) return;
      const label = document.createElement('div');
      label.className = 'openpax-country-label';
      label.dataset.owner = owner;
      // Priorità cartografica per il decluttering a vista mondo.
      label.dataset.area = String(representative.geojson
        ? geometryAreaDeg2Client(JSON.parse(representative.geojson).geometry)
        : 0);
      label.textContent = representative.polityName || owner;
      label.style.cssText = `
        pointer-events:none;color:#fff;font:800 11px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;
        letter-spacing:1.1px;text-transform:uppercase;white-space:nowrap;
        text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 5px #000;
      `;
      countryLabelMarkers.current.push(new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat(clampLngLat(point)).addTo(m));
    });
    return () => {
      countryLabelMarkers.current.forEach(marker => marker.remove());
      countryLabelMarkers.current = [];
    };
  }, [regions, mapLoaded]);

  // Visibilità in base allo zoom: etichette regioni piccole da zoom 3.2,
  // etichette oggetti (città grandi/costruzioni) da zoom 3.5
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    const updateVisibility = () => {
      const zoom = m.getZoom();
      // Scaling dei marker oggetti con lo zoom: a vista mondo (zoom basso) i
      // marker restano piccoli, ingrandendosi man mano che ci si avvicina.
      // I marker restano ancorati alla loro posizione geografica (setLngLat).
      const scale = Math.pow(1.35, zoom - 1);
      objectBaseSizes.current.forEach(({ el, base, label }) => {
        const s = Math.max(6, Math.round(base * scale));
        el.style.width = `${s}px`;
        el.style.height = `${s}px`;
        el.style.fontSize = `${Math.max(8, Math.round(9 * scale))}px`;
        const type = el.dataset.objectType;
        const pop = Number(el.dataset.population || 0);
        // A vista mondo non mostriamo nemmeno i puntini: centinaia di città
        // trasformano il globo in rumore visivo. Capitali da 1.8, grandi città
        // da 2.3, tutte le altre da 3.1; unità/costruzioni restano visibili.
        const showMarker = type !== 'city' && type !== 'capital'
          || type === 'capital' && zoom >= 2.2
          || type === 'city' && ((pop >= 3 && zoom >= 2.6) || zoom >= 3.2);
        el.style.display = showMarker ? 'flex' : 'none';
        if (label) {
          label.style.top = `${s + 3}px`;
          label.style.fontSize = `${Math.max(9, Math.round(10 * scale))}px`;
        }
      });
      labelMarkers.current.forEach((marker) => {
        const el = marker.getElement();
        if (!el) return;
        const regionId = el.dataset.regionId || '';
        const area = regionAreas.current[regionId] ?? 0;
        // Le province Pax sono leggibili solo quando vengono selezionate:
        // anche a zoom alto migliaia di nomi annullerebbero la cartografia.
        // Stati/regioni nazionali conservano invece la gerarchia per zoom.
        const isProvince = el.dataset.province === '1';
        const selected = regionId === selectedRegionId;
        const focused = selected || regionId === hoveredRegionId;
        // A vista mondo lasciamo l'identità ai label delle politie (uno per
        // nazione). I nomi di regione rientrano solo avvicinandosi o quando
        // l'utente li indica: evita il doppione nazione/regione e il muro di
        // testo osservato sul planisfero.
        const visible = isProvince
          ? selected
          : focused || (zoom >= 2.4 && area >= 12) || (zoom >= 3.0 && area >= 0.35);
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
        const visible = selected || (zoom < 1.8 ? area >= 75 : zoom < 2.5 ? area >= 10 : true);
        if (!visible) { el.style.display = 'none'; return; }
        el.style.display = '';
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        countryBoxes.push({
          el,
          priority: (selected ? 10_000 : 0) + Math.min(999, Math.round(area)),
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
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

    m.on('zoomend', updateVisibility);
    m.on('moveend', updateVisibility);
    updateVisibility();

    return () => {
      m.off('zoomend', updateVisibility);
      m.off('moveend', updateVisibility);
    };
  }, [regions, mapLoaded, selectedRegionId, hoveredRegionId]);

  // Tutti gli oggetti di gioco di tutte le regioni (per i marker).
  // `regionOwner` permette di scegliere una città principale per ogni nazione:
  // capitale se presente, altrimenti città più popolosa.
  const allObjects = useMemo(() => {
    const result: (MapObject & { regionName: string; regionColor: string; regionOwner: string; regionCountry: string; isPrimary: boolean })[] = [];
    const raw: (MapObject & { regionName: string; regionColor: string; regionOwner: string; regionCountry: string })[] = [];
    regions.forEach(region => {
      (region.objects || []).forEach((obj: MapObject) => raw.push({
        ...obj,
        regionName: region.name,
        regionColor: region.color,
        regionOwner: region.owner,
        regionCountry: String(region.flag || region.owner || '').toUpperCase(),
      }));
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
    // Capitali nascoste: il registro fisso spesso piazza le stelle nel mare
    // sulle mappe custom (es. Madrid/Rabat/Bern nell'Atlantico). Le togliamo
    // dalla mappa finché il posizionamento non è affidabile.
    for (const obj of uniqueRaw) {
      if (obj.type === 'capital') continue;
      result.push({ ...obj, isPrimary: primaryByOwner.get(obj.regionOwner) === obj.id });
    }
    return result;
  }, [regions]);

  // Marker degli oggetti
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const m = map.current;

    // Rimuove i vecchi marker
    objectMarkers.current.forEach(marker => marker.remove());
    objectMarkers.current = [];
    objectLabelEls.current = [];
    objectBaseSizes.current = [];

    allObjects.forEach(obj => {
      // Coordinate: standard nuovo lat/lng reali (capitali, città, costruzioni);
      // fallback legacy x/y SVG (mappe vecchie con svgPath)
      let lngLat: [number, number] | null = fixedCityCoordinate(obj.type, obj.regionCountry, obj.name);
      if (!lngLat && typeof obj.lat === 'number' && typeof obj.lng === 'number') {
        lngLat = [obj.lng, obj.lat];
      } else if (!lngLat && obj.x !== undefined && obj.y !== undefined) {
        lngLat = [(obj.x / 2000) * 360 - 180, 90 - (obj.y / 1500) * 180];
      }
      if (!lngLat) return;

      const icon = OBJECT_ICONS[obj.type] || OBJECT_ICONS.city;

      // Elemento DOM personalizzato del marker — stile satellite: contorni
      // scuri/chiari per staccare dal fondale, dimensioni per tipo
      const el = document.createElement('div');
      el.className = 'openpax-map-object';
      el.dataset.objectType = obj.type;
      el.dataset.population = String(obj.pop || 0);
      const isSmallDot = obj.type === 'city';
      const size = obj.type === 'capital' ? 18 : isSmallDot ? 10 : 16;
      el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background: ${icon.color};
        border: ${isSmallDot ? '1.5px' : '2px'} solid rgba(10, 10, 15, 0.85);
        outline: 1px solid rgba(255, 255, 255, 0.75);
        border-radius: ${obj.type === 'factory' ? '3px' : '50%'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        color: #101018;
        cursor: pointer;
        box-shadow: 0 1px 5px rgba(0,0,0,0.55);
        position: relative;
      `;
      if (!isSmallDot) el.textContent = icon.label;

      // Tutte le città del registro hanno un'etichetta; la visibilità è
      // gerarchica (capitale/principale sempre, metropoli e altre per zoom).
      const showLabel = true;
      let label: HTMLDivElement | null = null;
      if (showLabel) {
        label = document.createElement('div');
        label.className = 'openpax-object-label';
        label.textContent = obj.name;
        label.dataset.objectType = obj.type;
        label.dataset.population = String(obj.pop || 0);
        label.dataset.primary = String(obj.isPrimary);
        label.style.cssText = `
          position: absolute;
          left: 50%;
          top: ${size + 3}px;
          transform: translateX(-50%);
          color: #fff;
          font-size: 10px;
          font-weight: 600;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
          letter-spacing: 0.4px;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
          opacity: 0;
          transition: opacity 0.25s;
        `;
        el.appendChild(label);
      }

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(clampLngLat(lngLat))
        .setPopup(
          new maplibregl.Popup({ offset: 12 })
            .setHTML(`<div style="color:#e8e8ee;padding:4px;background:#141420;"><b>${obj.name}</b><br/><span style="color:#999;font-size:11px;">${obj.type}${obj.pop ? ` · ${obj.pop.toFixed(1)}M ab.` : ''}</span></div>`)
        )
        .addTo(m);
      objectMarkers.current.push(marker);
      if (label) objectLabelEls.current.push(label);
      objectBaseSizes.current.push({ el, base: size, label });
    });

    // Applica subito lo scaling in base allo zoom corrente (il listener
    // zoomend/moveend aggiornerà i marker ai successivi cambi di zoom).
    if (map.current) {
      const zoom = map.current.getZoom();
      const scale = Math.pow(1.35, zoom - 1);
      objectBaseSizes.current.forEach(({ el, base, label }) => {
        const s = Math.max(6, Math.round(base * scale));
        el.style.width = `${s}px`;
        el.style.height = `${s}px`;
        el.style.fontSize = `${Math.max(8, Math.round(9 * scale))}px`;
        const type = el.dataset.objectType;
        const pop = Number(el.dataset.population || 0);
        const showMarker = type !== 'city' && type !== 'capital'
          || type === 'capital' && zoom >= 1.8
          || type === 'city' && ((pop >= 3 && zoom >= 2.3) || zoom >= 3.1);
        el.style.display = showMarker ? 'flex' : 'none';
        if (label) {
          label.style.top = `${s + 3}px`;
          label.style.fontSize = `${Math.max(9, Math.round(10 * scale))}px`;
        }
      });
    }

    return () => {
      objectMarkers.current.forEach(marker => marker.remove());
      objectMarkers.current = [];
    };
  }, [allObjects, mapLoaded]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {!mapLoaded && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#667eea',
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
            left: tooltipInfo.x + 10,
            top: tooltipInfo.y - 10,
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
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', color: '#667eea' }}>
            {tooltipInfo.name}
          </div>
          {tooltipInfo.owner && (
            <div style={{ color: '#ccc', marginBottom: '6px' }}>Controllo: {tooltipInfo.owner}</div>
          )}
          <div style={{ color: '#aaa' }}>👥 {tooltipInfo.population?.toLocaleString()}</div>
          <div style={{ color: '#aaa' }}>💰 {tooltipInfo.gdp}</div>
          <div style={{ color: '#aaa' }}>⚔️ {tooltipInfo.militaryPower}</div>
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
