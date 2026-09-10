/**
 * World Story — G4-C: Cicatrice temporale
 * ======================================
 * Quando una regione cambia padrone, il confine precedente resta visibile
 * per qualche secondo come «cicatrice»: tratteggio nel colore del vecchio
 * proprietario e riempimento spettrale. È documentazione del mutamento,
 * non controllo: il layer non intercetta click (beforeId sotto i layer
 * interattivi).
 */

export interface TemporalScar {
  /** ID canonico della regione cambiata. */
  id: string;
  /** Nome della regione per legenda e lettori di schermo. */
  name: string;
  /** Padronanza prima del cambio (owner o codice paese). */
  previousOwner: string;
  /** Colore del vecchio proprietario. */
  previousColor: string;
  /** Timestamp di creazione: il layer non dipende da timer interni. */
  startedAt: number;
}

export const SCAR_SOURCE_ID = 'ws-temporal-scar-source';
export const SCAR_FILL_LAYER_ID = 'ws-temporal-scar-fill';
export const SCAR_LINE_LAYER_ID = 'ws-temporal-scar-line';

type RegionLike = {
  id: string;
  name?: string;
  /** GeoJSON come stringa JSON (contratto Region) o oggetto già parsingato. */
  geojson?: string | any;
  color?: string;
  owner?: string;
};

const EMPTY_COLLECTION: { type: string; features: any[] } = { type: 'FeatureCollection', features: [] };

function extractGeometry(region?: Partial<RegionLike>): any | null {
  if (!region?.geojson) return null;
  try {
    const parsed = typeof region.geojson === 'string' ? JSON.parse(region.geojson) : region.geojson;
    return parsed?.geometry ?? null;
  } catch {
    return null; // geojson corrotto: nessuna cicatrice per questa regione
  }
}

/** GeoJSON delle cicatrici: geometria della regione + colore del vecchio padrone. */
export function buildScarGeoJson(
  scars: TemporalScar[],
  regions: RegionLike[],
): { type: string; features: any[] } {
  if (!scars.length) return { type: 'FeatureCollection', features: [] };
  const byId = new Map(regions.map(region => [region.id, region]));
  const features: any[] = [];
  for (const scar of scars) {
    const region = byId.get(scar.id);
    const geometry = extractGeometry(byId.get(scar.id));
    if (!geometry) continue;
    features.push({
      type: 'Feature',
      properties: {
        scarId: scar.id,
        scarName: scar.name,
        scarOwner: scar.previousOwner,
        scarColor: scar.previousColor,
      },
      geometry,
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Contratto minimale della mappa MapLibre usato dalla sincronizzazione. */
interface ScarMapLike {
  getSource: (id: string) => { setData?: (data: any) => void } | undefined;
  addSource: (id: string, spec: any) => void;
  getLayer: (id: string) => any;
  addLayer: (layer: any, beforeId?: string) => void;
}

/** Crea (una volta) i layer della cicatrice e ne aggiorna i dati. */
export function syncScarLayers(map: ScarMapLike, scars: TemporalScar[], regions: RegionLike[]): void {
  if (!map.getSource(SCAR_SOURCE_ID)) {
    map.addSource(SCAR_SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION });
  }
  const source: any = map.getSource(SCAR_SOURCE_ID);

  // Riempimento evanescente del vecchio padrone, sotto le etichette.
  if (!map.getLayer(SCAR_FILL_LAYER_ID)) {
    map.addLayer({
      id: SCAR_FILL_LAYER_ID,
      type: 'fill',
      source: SCAR_SOURCE_ID,
      paint: {
        'fill-color': ['get', 'scarColor'],
        'fill-opacity': 0.18,
      },
    });
  }
  // Tratteggio del confine precedente: la firma visiva della cicatrice.
  if (!map.getLayer(SCAR_LINE_LAYER_ID)) {
    map.addLayer({
      id: SCAR_LINE_LAYER_ID,
      type: 'line',
      source: SCAR_SOURCE_ID,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'scarColor'],
        'line-width': 2.5,
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    });
  }
  source.setData?.(buildScarGeoJson(scars, regions));
}