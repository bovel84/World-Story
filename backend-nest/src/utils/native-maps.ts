/**
 * MAP-NATIVE — mappe native scegliibili dai preset
 * ================================================
 * Un preset può RIFERENZIARE una mappa nativa (`map_base`) invece di copiare un
 * GeoJSON nel pacchetto. Il Pax pesa 7,3 MB: il riferimento evita duplicazioni.
 *
 * Precedenza (retrocompatibile):
 *   1. `map.geojson` proprio del preset → vince sempre;
 *   2. altrimenti `map_base` → la mappa nativa dichiarata;
 *   3. altrimenti `standard` (Natural Earth, come oggi).
 *
 * Whitelist RIGIDA: si caricano solo gli id elencati qui. Nessun id o path
 * arbitrario entra in `path.join` (niente path traversal). La fixture tecnica
 * `realism_test_world` NON è esposta.
 */

import fs from 'fs';
import path from 'path';
import { hasProvinceFeatures, type MapFeature } from './map-detail';

export type NativeMapId =
  | 'standard'
  | 'modern_world_provinces'
  | 'pax_modern_provinces'
  | 'paxh_ww2_provinces';

export interface NativeMapDefinition {
  id: NativeMapId;
  /** Nome leggibile per l'editor. */
  label: string;
  /** File GeoJSON, relativo alla cwd del backend. */
  file: string;
}

/** Mappa usata quando il preset non ha né un file proprio né `map_base`. */
export const DEFAULT_NATIVE_MAP_ID: NativeMapId = 'standard';

/** Elenco chiuso delle mappe native scegliibili (fixture esclusa). */
export const NATIVE_MAPS: readonly NativeMapDefinition[] = [
  { id: 'standard', label: 'Mappa mondiale standard', file: path.join('data', 'geojson', 'countries.geojson') },
  { id: 'modern_world_provinces', label: 'Mondo Provinciale Moderno', file: path.join('data', 'presets', 'modern_world_provinces', 'map.geojson') },
  { id: 'pax_modern_provinces', label: 'Mondo Pax — Province complete', file: path.join('data', 'presets', 'pax_modern_provinces', 'map.geojson') },
  { id: 'paxh_ww2_provinces', label: 'Mondo WW2 (Pax Historia)', file: path.join('data', 'presets', 'paxh_ww2_provinces', 'map.geojson') },
];

const BY_ID = new Map<string, NativeMapDefinition>(NATIVE_MAPS.map(m => [m.id, m]));

export interface NativeMapInfo {
  id: NativeMapId;
  label: string;
  /** true se la mappa contiene province (`properties.country` ≠ `code`). */
  hasProvinces: boolean;
  /** Numero di feature GeoJSON (regioni potenziali). */
  features: number;
}

export function isNativeMapId(value: unknown): value is NativeMapId {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Normalizza `map_base`: id valido → id, altrimenti `undefined`. */
export function normalizeMapBase(value: unknown): NativeMapId | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return isNativeMapId(trimmed) ? trimmed : undefined;
}

/**
 * Sceglie la sorgente geometrica della generazione. PURA e testabile.
 * `hasCustomMap` (preset con `map.geojson`) ha sempre la precedenza.
 */
export type MapSource = { kind: 'preset' } | { kind: 'native'; id: NativeMapId };

export function resolveMapSource(input: { hasCustomMap: boolean; mapBase?: unknown }): MapSource {
  if (input.hasCustomMap) return { kind: 'preset' };
  return { kind: 'native', id: normalizeMapBase(input.mapBase) ?? DEFAULT_NATIVE_MAP_ID };
}

/** Percorso assoluto di una mappa nativa (solo id in whitelist), o null. */
export function nativeMapPath(id: unknown): string | null {
  const def = typeof id === 'string' ? BY_ID.get(id) : undefined;
  if (!def) return null;
  return path.join(process.cwd(), def.file);
}

/** Carica il GeoJSON di una mappa nativa (solo id in whitelist), o null. */
export function loadNativeMap(id: unknown): { features?: MapFeature[] } | null {
  const p = nativeMapPath(id);
  if (!p) return null;
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e: any) {
    console.warn('[NativeMaps] GeoJSON nativo illeggibile', id, '-', e.message);
  }
  return null;
}

const statsCache = new Map<NativeMapId, NativeMapInfo>();

/** Metadati di una mappa nativa (feature, presenza province), con cache. */
export function nativeMapInfo(id: NativeMapId): NativeMapInfo {
  const cached = statsCache.get(id);
  if (cached) return cached;
  const def = BY_ID.get(id)!;
  const geojson = loadNativeMap(id);
  const features = Array.isArray(geojson?.features) ? geojson!.features! : [];
  const info: NativeMapInfo = {
    id,
    label: def.label,
    hasProvinces: hasProvinceFeatures(features),
    features: features.length,
  };
  statsCache.set(id, info);
  return info;
}

/** Elenco delle mappe native scegliibili con metadati, per l'editor. */
export function listNativeMaps(): NativeMapInfo[] {
  return NATIVE_MAPS.map(def => nativeMapInfo(def.id));
}
