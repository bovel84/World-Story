import fs from 'fs';
import path from 'path';
import { pointInGeometry } from './geo';
import { shortId } from './short-id';
import { paxSettlementObjectsForGeometry } from './pax-geography';

export interface CityEntry {
  name: string;
  country: string;
  lat: number;
  lng: number;
  pop: number;
}

export interface CapitalEntry {
  capital: string;
  lat: number;
  lng: number;
}

let citiesCache: CityEntry[] | null = null;
let capitalsCache: Record<string, CapitalEntry> | null = null;

function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getMajorCities(): CityEntry[] {
  if (citiesCache) return citiesCache;
  try {
    const file = path.join(process.cwd(), 'data', 'geojson', 'cities.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { cities: [] };
    citiesCache = (raw.cities || []).filter((c: any) =>
      c && typeof c.name === 'string' && typeof c.country === 'string'
      && typeof c.lat === 'number' && typeof c.lng === 'number'
    );
  } catch (e) {
    console.warn('[Cities] cities.json non leggibile:', e);
    citiesCache = [];
  }
  return citiesCache!;
}

export function getCapitalsRegistry(): Record<string, CapitalEntry> {
  if (capitalsCache) return capitalsCache;
  try {
    const file = path.join(process.cwd(), 'data', 'geojson', 'capitals.json');
    capitalsCache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  } catch (e) {
    console.warn('[Cities] capitals.json non leggibile:', e);
    capitalsCache = {};
  }
  return capitalsCache!;
}

/** Tutte le città principali del paese realmente contenute nella geometria. */
export function cityObjectsForGeometry(geometry: any, countryCode: string, limit = Infinity): any[] {
  if (!geometry || !countryCode) return [];
  return getMajorCities()
    .filter(c => c.country === countryCode && pointInGeometry([c.lng, c.lat], geometry))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit)
    .map(c => ({ id: shortId(), type: 'city', name: c.name, lat: c.lat, lng: c.lng, pop: c.pop }));
}

/** Capitale del paese, solo nella provincia/geometria che la contiene.
 * Se il registro delle città ha la grafia italiana nello stesso punto,
 * preferiamola: evita il doppione bilingue «Moscow / Mosca». */
export function capitalObjectsForGeometry(geometry: any, countryCode: string): any[] {
  const cap = getCapitalsRegistry()[countryCode];
  if (!cap || !geometry || !pointInGeometry([cap.lng, cap.lat], geometry)) return [];
  const localName = getMajorCities().find(city =>
    city.country === countryCode
    && Math.abs(city.lat - cap.lat) < 0.08
    && Math.abs(city.lng - cap.lng) < 0.08
  )?.name;
  return [{ id: shortId(), type: 'capital', name: localName || cap.capital, lat: cap.lat, lng: cap.lng }];
}

/**
 * Migra/integra oggetti di vecchi mondi:
 * - preserva costruzioni/eserciti;
 * - geolocalizza città legacy per nome;
 * - aggiunge capitale + TUTTE le città principali mancanti nella regione;
 * - evita il doppione capitale/città quando hanno quasi le stesse coordinate.
 */
export function enrichGeographicObjects(existing: any[], geometry: any, countryCode: string, paxProvince = false): any[] {
  if (!geometry || !countryCode || !/^[A-Z]{3}$/.test(countryCode)) return existing || [];

  // Le province Pax non devono mai ricevere città dalla vecchia registry:
  // conserviamo soltanto i punti con provenienza Pax e gli asset di gioco.
  const sourceObjects = existing || [];
  const mapObjects = paxProvince
    ? sourceObjects.filter(obj => (obj?.type !== 'city' && obj?.type !== 'capital') || obj.sourceRegionId)
    : sourceObjects;
  const hasExistingSettlement = mapObjects.some(obj => obj?.type === 'city' || obj?.type === 'capital');
  const paxCities = hasExistingSettlement ? [] : paxSettlementObjectsForGeometry(geometry);
  const legacyCities = paxProvince ? [] : cityObjectsForGeometry(geometry, countryCode);
  const registryCities = [...paxCities, ...legacyCities].filter((candidate, index, all) =>
    all.findIndex(other => Math.abs(other.lat - candidate.lat) < 0.08 && Math.abs(other.lng - candidate.lng) < 0.08) === index
  );
  // `registryCapital` viene aggiunta solo se il punto è nella geometria;
  // `canonicalCapital` serve invece a ripulire gli oggetti già presenti anche
  // sulle mappe storiche con confini imprecisi.
  const registryCapital = paxProvince ? undefined : capitalObjectsForGeometry(geometry, countryCode)[0];
  const rawCapital = getCapitalsRegistry()[countryCode];
  const canonicalCityName = rawCapital && getMajorCities().find(city =>
    city.country === countryCode
    && Math.abs(city.lat - rawCapital.lat) < 0.08
    && Math.abs(city.lng - rawCapital.lng) < 0.08
  )?.name;
  const canonicalCapital = rawCapital
    ? { type: 'capital', name: canonicalCityName || rawCapital.capital, lat: rawCapital.lat, lng: rawCapital.lng }
    : undefined;
  const byName = new Map(registryCities.map(c => [normalizeName(c.name), c]));
  const samePlace = (a: any, b: any) =>
    typeof a?.lat === 'number' && typeof a?.lng === 'number'
    && Math.abs(a.lat - b.lat) < 0.08 && Math.abs(a.lng - b.lng) < 0.08;

  // Normalizza le capitali già presenti nei salvataggi alla grafia locale e
  // poi riduce i marker sovrapposti. La capitale prevale sulla città normale.
  const normalized = mapObjects.map(obj => {
    if (obj?.type !== 'city' && obj?.type !== 'capital') return obj;
    if (obj.type === 'capital' && canonicalCapital
        && (samePlace(obj, canonicalCapital)
          || typeof obj.lat !== 'number' || typeof obj.lng !== 'number')) {
      return { ...obj, name: canonicalCapital.name, lat: canonicalCapital.lat, lng: canonicalCapital.lng };
    }
    if (typeof obj.lat !== 'number' || typeof obj.lng !== 'number') {
      const found = byName.get(normalizeName(String(obj.name || '')));
      if (found) return { ...obj, name: found.name, lat: found.lat, lng: found.lng, pop: obj.pop ?? found.pop };
    }
    return obj;
  });

  const result = normalized.reduce<any[]>((unique, obj) => {
    if (obj?.type !== 'city' && obj?.type !== 'capital') {
      unique.push(obj);
      return unique;
    }
    const duplicateIndex = unique.findIndex(existingObj =>
      (existingObj?.type === 'city' || existingObj?.type === 'capital') && samePlace(existingObj, obj)
    );
    if (duplicateIndex < 0) {
      unique.push(obj);
    } else if (obj.type === 'capital' && unique[duplicateIndex].type !== 'capital') {
      unique[duplicateIndex] = obj;
    }
    return unique;
  }, []);

  const alreadyHas = (candidate: any) => result.some(obj =>
    (obj.type === candidate.type && normalizeName(String(obj.name || '')) === normalizeName(candidate.name))
    || samePlace(obj, candidate)
  );

  if (registryCapital && !alreadyHas(registryCapital)) result.push(registryCapital);
  for (const city of registryCities) {
    // Se la città coincide con la capitale, il marker capitale è sufficiente.
    if (registryCapital && samePlace(city, registryCapital)) continue;
    if (!alreadyHas(city)) result.push(city);
  }
  return result;
}
