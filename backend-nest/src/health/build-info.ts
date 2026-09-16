/**
 * Q02 µ3 — Informazioni di build/versione per health.
 * ==================================================
 * Espone build ID (backend e frontend), schema dati e `modelVersion` dei
 * cataloghi dichiarati, **senza mai includere segreti** (token proprietario,
 * chiavi LLM, percorsi sensibili).
 *
 * Sorgenti, tutte innocue e deterministiche:
 *  - build ID backend: `WORLD_STORY_BUILD_ID` (iniettato in build/CI), altrimenti `'dev'`.
 *  - build ID frontend: `WORLD_STORY_FRONTEND_BUILD_ID`, altrimenti il file
 *    `frontend/dist/build-id.txt` emesso dal plugin Vite, altrimenti `null`.
 *  - schema: versione dello snapshot economico (costante di dominio) + stato
 *    reale del database (`PRAGMA user_version`, numero di tabelle).
 *  - modelVersion: `id@version` dei cataloghi presenti in `data/presets`.
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../database';
import { ownerAuthMode, type OwnerAuthMode } from '../security/owner-guard';

/** Versione dello snapshot economico (open_pax_economy). */
export const ECONOMY_SNAPSHOT_VERSION = 1;

export interface CatalogModelVersion {
  id: string;
  version: number;
  mode: string;
  declaration: string;
}

export interface BuildInfo {
  status: 'ok';
  timestamp: string;
  build: { backend: string; frontend: string | null };
  schema: { economySnapshot: number; database: { userVersion: number; tables: number } };
  modelVersions: CatalogModelVersion[];
  auth: OwnerAuthMode;
  api: { base: '/api'; sameOrigin: true };
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* percorso non leggibile: si prova il successivo */
    }
  }
  return null;
}

export function backendBuildId(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env.WORLD_STORY_BUILD_ID ?? '').trim();
  return value.length > 0 ? value : 'dev';
}

/** Il frontend scrive il proprio build id accanto alla build (`dist/build-id.txt`). */
export function frontendBuildId(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = (env.WORLD_STORY_FRONTEND_BUILD_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  const file = firstExisting([
    path.resolve(__dirname, '../../../frontend/dist/build-id.txt'),
    path.resolve(__dirname, '../../frontend/dist/build-id.txt'),
    path.resolve(process.cwd(), 'frontend/dist/build-id.txt'),
    path.resolve(process.cwd(), '../frontend/dist/build-id.txt'),
  ]);
  if (!file) return null;
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Cataloghi dichiarati, letti dai manifest (economici: nessun caricamento completo). */
export function catalogModelVersions(): CatalogModelVersion[] {
  const presetsDir = firstExisting([
    path.resolve(__dirname, '../../data/presets'),
    path.resolve(__dirname, '../../../data/presets'),
    path.resolve(process.cwd(), 'data/presets'),
    path.resolve(process.cwd(), 'backend-nest/data/presets'),
  ]);
  if (!presetsDir) return [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(presetsDir);
  } catch {
    return [];
  }
  const versions: CatalogModelVersion[] = [];
  for (const entry of entries.sort()) {
    const manifestPath = path.join(presetsDir, entry, 'simulation', 'manifest.json');
    try {
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      if (typeof manifest.id !== 'string' || typeof manifest.version !== 'number') continue;
      versions.push({
        id: manifest.id,
        version: manifest.version,
        mode: typeof manifest.mode === 'string' ? manifest.mode : 'unknown',
        declaration: typeof manifest.declaration === 'string' ? manifest.declaration : 'unknown',
      });
    } catch {
      /* manifest illeggibile: non deve abbattere l'health */
    }
  }
  return versions;
}

function databaseSchema(): { userVersion: number; tables: number } {
  try {
    const userVersion = Number(db.pragma('user_version', { simple: true })) || 0;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n?: number } | undefined;
    return { userVersion, tables: Number(row?.n) || 0 };
  } catch {
    return { userVersion: 0, tables: 0 };
  }
}

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    build: { backend: backendBuildId(env), frontend: frontendBuildId(env) },
    schema: { economySnapshot: ECONOMY_SNAPSHOT_VERSION, database: databaseSchema() },
    modelVersions: catalogModelVersions(),
    auth: ownerAuthMode(env),
    api: { base: '/api', sameOrigin: true },
  };
}
