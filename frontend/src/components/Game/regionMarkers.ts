/**
 * MAP09 — I segni sul territorio
 * =============================
 * Una mappa di sole sagome dice *dove*, non *cosa c'è*. La scheda ha già in
 * memoria la lista canonica degli oggetti di ogni provincia — capitali, città,
 * porti, stabilimenti (`region.objects`, dal motore) — e ne usava **uno solo**:
 * il pallino della capitale, e pure nel posto sbagliato (il centroide del
 * poligono, non le coordinate reali della capitale).
 *
 * Qui i segni si proiettano con la **stessa** proiezione dei poligoni — la
 * `projectPoint` di `staticMapModel`, con gli stessi limiti e la stessa tela —
 * quindi cadono esattamente dove il disegno li mette. Non nasce una seconda
 * cartografia: la scheda e la mappa grande restano d'accordo.
 *
 * ## Cosa si disegna, e cosa no
 *
 * Le capitali, i porti e gli stabilimenti sono **pochi** (una capitale, qualche
 * impianto): si disegnano sempre, perché ognuno è un fatto. Le **città** sono
 * molte — 229 negli Stati Uniti, 8 in Giordania — e su un riquadro di 640×260
 * diventerebbero un campo di stelle: si disegnano solo nelle **zone in evidenza**
 * (quelle di cui si parla) e fino a un tetto, che è un tetto di *resa*, non di
 * verità.
 *
 * ## Cosa non si inventa mai
 *
 * Un oggetto senza coordinate reali (`lat`/`lng`) non viene disegnato: i mondi
 * legacy portano `x`/`y` sulla tela 2000×1500, che è un altro sistema, e
 * sovrapporli sarebbe una bugia. Un tipo di oggetto che questo modulo non conosce
 * viene ignorato, non interpretato.
 *
 * Modulo **puro**: nessun I/O, nessuno stato.
 */

import type { Region } from '../../types';
import type { GeoBounds } from '../Map/staticMapModel';
import { projectPoint } from '../Map/staticMapModel';

/** I tipi di oggetto che diventano un segno. Chiuso: il resto si ignora. */
export const MARKER_KINDS = ['capital', 'port', 'factory', 'city'] as const;
export type MarkerKind = typeof MARKER_KINDS[number];

/** Tetto di resa per le città: oltre, un riquadro piccolo diventa illeggibile. */
export const MAX_CITY_MARKERS = 8;

export interface RegionMarker {
  readonly id: string;
  readonly kind: MarkerKind;
  readonly name: string;
  /** Coordinate nel sistema del `viewBox` (la stessa tela dei poligoni). */
  readonly x: number;
  readonly y: number;
}

/** Come si disegna ogni tipo: raggio e colori, dichiarati una volta sola. */
export const MARKER_STYLE: Record<MarkerKind, { radius: number; fill: string; stroke: string }> = {
  capital: { radius: 3, fill: '#ffd166', stroke: '#0a141e' },
  port: { radius: 2.2, fill: '#7fd1e8', stroke: '#0a141e' },
  factory: { radius: 2.2, fill: '#e8a37f', stroke: '#0a141e' },
  city: { radius: 1.4, fill: '#dceaf3', stroke: '#0a141e' },
};

const isKind = (value: unknown): value is MarkerKind =>
  typeof value === 'string' && (MARKER_KINDS as readonly string[]).includes(value);

/** Le coordinate reali di un oggetto, o `null` se l'oggetto non ne ha di vere. */
function markerPoint(object: Record<string, unknown>): { lng: number; lat: number } | null {
  const lng = Number(object.lng);
  const lat = Number(object.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

export interface MarkerInput {
  readonly regions: readonly Region[];
  /** I limiti geografici **della stessa proiezione** dei poligoni. */
  readonly bounds: GeoBounds;
  /** La tela: la stessa di `buildStaticMap`. */
  readonly width: number;
  readonly height: number;
  /** Gli id delle zone in evidenza: lì le città si disegnano, altrove no. */
  readonly primaryIds?: readonly string[];
  readonly maxCities?: number;
}

/**
 * I segni da disegnare, nell'ordine in cui compaiono: prima i fatti unici
 * (capitali, porti, stabilimenti), poi le città delle zone in evidenza.
 *
 * L'ordine è deterministico — ordine delle regioni, poi ordine degli oggetti —
 * così la scheda resta comparabile fra due rese.
 */
export function projectMarkers(input: MarkerInput): RegionMarker[] {
  const primary = new Set(input.primaryIds ?? []);
  const maxCities = input.maxCities ?? MAX_CITY_MARKERS;
  const unique: RegionMarker[] = [];
  const cities: RegionMarker[] = [];
  for (const region of input.regions) {
    for (const raw of region.objects ?? []) {
      const object = raw as unknown as Record<string, unknown>;
      const kind = object.type;
      if (!isKind(kind)) continue;
      // Le città solo dove si sta guardando: altrove saturerebbero il riquadro.
      if (kind === 'city' && !primary.has(region.id)) continue;
      const point = markerPoint(object);
      if (!point) continue; // Nessuna coordinata reale: non si disegna, non si stima.
      const [x, y] = projectPoint(point.lng, point.lat, input.bounds, input.width, input.height);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const marker: RegionMarker = {
        id: String(object.id ?? `${region.id}:${kind}:${unique.length + cities.length}`),
        kind,
        name: String(object.name ?? region.name),
        x, y,
      };
      (kind === 'city' ? cities : unique).push(marker);
    }
  }
  return [...unique, ...cities.slice(0, maxCities)];
}
