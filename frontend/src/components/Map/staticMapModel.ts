/**
 * World Story — mappa statica dal GeoJSON
 * =======================================
 * Quando WebGL non è disponibile MapLibre non parte, e il ripiego SVG non ha
 * dati: i mondi reali portano **solo** `region.geojson` (117.096 regioni su
 * 117.096 nel database di sviluppo, zero con `svgPath`). Senza questa mappa il
 * giocatore resterebbe cieco sulla geografia proprio nel momento in cui il
 * gioco funziona.
 *
 * Il modulo è **puro**: trasforma geometrie reali in un disegno statico
 * (proiezione, percorsi, riquadro) senza dipendere da React o dal DOM, così si
 * può testare e sbagliare senza conseguenze.
 *
 * Non è una mappa interattiva: niente zoom, niente layer tematici, niente
 * marker militari. È la **geografia essenziale** — chi possiede cosa — con i
 * colori già calcolati dal motore.
 */
import type { Region } from '../../types';
import { parseRegionGeometry } from './mapModel';

/** Riquadro geografico: ovest, sud, est, nord (gradi). */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Una provincia pronta al disegno: un percorso SVG e il suo colore. */
export interface StaticRegionPath {
  id: string;
  name: string;
  owner: string;
  color: string;
  /** Attributo `d` di un `<path>` SVG. */
  path: string;
}

export interface StaticMapModel {
  /** `null` se nessuna geometria è disegnabile. */
  bounds: GeoBounds | null;
  paths: StaticRegionPath[];
  /** Regioni con geometria illeggibile: dichiarate, mai disegnate a caso. */
  skipped: number;
  /** Larghezza/altezza del disegno in unità interne (viewBox). */
  width: number;
  height: number;
}

const EMPTY: StaticMapModel = { bounds: null, paths: [], skipped: 0, width: 1000, height: 600 };

/** Margine attorno al riquadro, in gradi: evita che il bordo tocchi il riquadro. */
const PADDING_DEGREES = 2;

/**
 * Riquadro che contiene tutte le geometrie. `null` se non ce n'è nessuna
 * valida: il chiamante mostra lo stato «mappa non disponibile», non un riquadro
 * inventato.
 */
export function boundsOf(geometries: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>): GeoBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = false;
  const visit = (coordinate: unknown): void => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return;
    const [lng, lat] = coordinate;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    seen = true;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  for (const geometry of geometries) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) for (const point of ring) visit(point);
    }
  }
  if (!seen) return null;
  return {
    west: west - PADDING_DEGREES,
    south: south - PADDING_DEGREES,
    east: east + PADDING_DEGREES,
    north: north + PADDING_DEGREES,
  };
}

/**
 * Proiezione equirettangolare semplice, con la longitudine corretta dal coseno
 * della latitudine media: alle latitudini europee una mappa non corretta
 * apparirebbe schiacciata in orizzontale. La scala è **unica** sui due assi, così
 * la geografia non si deforma.
 */
export function projectPoint(lng: number, lat: number, bounds: GeoBounds, width: number, height: number): [number, number] {
  const spanLng = Math.max(1e-6, bounds.east - bounds.west);
  const spanLat = Math.max(1e-6, bounds.north - bounds.south);
  const midLatRad = ((bounds.north + bounds.south) / 2) * Math.PI / 180;
  const lngScale = Math.max(1e-6, Math.cos(midLatRad));
  // Unità geografiche corrette: la longitudine «pesa» meno dell'equivalente in latitudine.
  const xSpan = spanLng * lngScale;
  const scale = Math.min(width / xSpan, height / spanLat);
  const xOffset = (width - xSpan * scale) / 2;
  const yOffset = (height - spanLat * scale) / 2;
  const x = xOffset + (lng - bounds.west) * lngScale * scale;
  // La latitudine cresce verso nord, la coordinata SVG verso il basso.
  const y = yOffset + (bounds.north - lat) * scale;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

/** Percorso SVG di un anello proiettato. Chiude sempre il tracciato. */
function ringPath(ring: Array<[number, number]>, bounds: GeoBounds, width: number, height: number): string {
  const points = ring
    .filter(point => Array.isArray(point) && point.length >= 2
      && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(point => projectPoint(point[0], point[1], bounds, width, height));
  if (points.length < 3) return '';
  const [first, ...rest] = points;
  return `M${first[0]},${first[1]}` + rest.map(([x, y]) => `L${x},${y}`).join('') + 'Z';
}

/**
 * Modello della mappa statica: riquadro, percorsi e scarti dichiarati.
 *
 * Le geometrie illeggibili sono **contate**, non disegnate a caso: un GeoJSON
 * corrotto non deve produrre un puntino arbitrario sulla mappa. Il colore è
 * quello che il motore ha già assegnato alla regione; in sua assenza si usa un
 * grigio neutro, mai un colore inventato.
 */
export function buildStaticMap(
  regions: readonly Region[],
  width = 1000,
  height = 600,
): StaticMapModel {
  const drawn: Array<{ region: Region; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }> = [];
  let skipped = 0;
  for (const region of regions) {
    if (!region.geojson) continue;
    const geometry = parseRegionGeometry(region.geojson);
    if (!geometry) { skipped++; continue; }
    drawn.push({ region, geometry });
  }
  if (drawn.length === 0) return { ...EMPTY, width, height, skipped };

  const bounds = boundsOf(drawn.map(entry => entry.geometry));
  if (!bounds) return { ...EMPTY, width, height, skipped };

  const paths: StaticRegionPath[] = [];
  for (const { region, geometry } of drawn) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const d = polygons
      .map(polygon => polygon.map(ring => ringPath(ring as Array<[number, number]>, bounds, width, height)).join(''))
      .join('');
    if (!d) { skipped++; continue; }
    paths.push({
      id: region.id,
      name: region.name,
      owner: region.owner,
      color: region.color || '#3a3f4b',
      path: d,
    });
  }
  return { bounds, paths, skipped, width, height };
}
