import fs from 'fs';
import path from 'path';
import { pointInGeometry } from './geo';
import { shortId } from './short-id';

interface PaxElement {
  name: string;
  classification: string;
  region_name?: string;
  location: { latitude: number; longitude: number; regionID?: string };
}

let settlementsCache: PaxElement[] | null = null;
let regionNamesCache: Record<string, string> | null = null;

type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number };

function geometryBounds(geometry: any): Bounds | null {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const visit = (value: any): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      minLng = Math.min(minLng, value[0]); maxLng = Math.max(maxLng, value[0]);
      minLat = Math.min(minLat, value[1]); maxLat = Math.max(maxLat, value[1]);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return Number.isFinite(minLng) ? { minLng, maxLng, minLat, maxLat } : null;
}

/**
 * Insediamenti georeferenziati della cartografia Pax.
 * Il file usa coordinate reali WGS84: [longitudine, latitudine].
 */
function getPaxRegionNames(): Record<string, string> {
  if (regionNamesCache) return regionNamesCache;
  try {
    const file = path.join(process.cwd(), 'data', 'geojson', 'pax_region_data.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    regionNamesCache = Object.fromEntries(Object.entries(raw as Record<string, { name?: string }>)
      .filter(([, region]) => typeof region?.name === 'string')
      .map(([id, region]) => [id, region.name!]));
  } catch {
    regionNamesCache = {};
  }
  return regionNamesCache;
}

export function getPaxSettlements(): PaxElement[] {
  if (settlementsCache) return settlementsCache;
  try {
    const file = path.join(process.cwd(), 'data', 'geojson', 'pax_elements.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    settlementsCache = Object.values(raw as Record<string, PaxElement>).filter((element): element is PaxElement => {
      const location = element?.location;
      return !!location
        && (element.classification === 'city_or_locality' || element.classification === 'capital')
        && typeof element.name === 'string'
        && typeof location.latitude === 'number'
        && typeof location.longitude === 'number'
        && location.latitude >= -85 && location.latitude <= 85
        && location.longitude >= -180 && location.longitude <= 180;
    });
  } catch (error) {
    console.warn('[Pax geography] pax_elements.json non leggibile:', error);
    settlementsCache = [];
  }
  return settlementsCache;
}

/**
 * Punti fissi per una geometria: il marker non dipende da coordinate SVG o
 * dallo stato del salvataggio. Il limite protegge la mappa mondiale da migliaia
 * di marker DOM nello stesso stato/provincia.
 */
export function paxSettlementObjectsForGeometry(geometry: any, limit = 30): any[] {
  const bounds = geometryBounds(geometry);
  if (!bounds) return [];
  return getPaxSettlements()
    // Riduce migliaia di test point-in-polygon a poche decine per regione.
    .filter(element => element.location.longitude >= bounds.minLng && element.location.longitude <= bounds.maxLng
      && element.location.latitude >= bounds.minLat && element.location.latitude <= bounds.maxLat)
    .filter(element => pointInGeometry([element.location.longitude, element.location.latitude], geometry))
    .sort((a, b) => Number(b.classification === 'capital') - Number(a.classification === 'capital')
      || a.name.localeCompare(b.name, 'it'))
    .slice(0, limit)
    .map(element => ({
      id: shortId(),
      type: element.classification === 'capital' ? 'capital' : 'city',
      name: element.name,
      lat: element.location.latitude,
      lng: element.location.longitude,
      sourceRegionName: element.region_name || getPaxRegionNames()[String(element.location.regionID || '')],
      sourceRegionId: element.location.regionID,
    }));
}
