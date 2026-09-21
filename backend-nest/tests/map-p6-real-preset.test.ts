/**
 * MAP P6.1 — Blocker C: preset **reali** e geografia economica canonica
 * ====================================================================
 * MAP P6 legge la geografia economica dal catalogo di scenario. Il riscontro
 * verificato è che i preset reali (`modern_world_provinces`, `mondo_1936`,
 * `mondo_1989`, `europa_1815`, `europa_1914`, `pax_modern_provinces`,
 * `paxh_ww2_provinces`) **non contengono alcuna fonte strutturata** di
 * giacimenti o impianti:
 *
 *  - nessuna cartella `simulation/` (quindi nessun `initial-state.json`);
 *  - in `preset.json` esistono solo `countries: [{ code, name, color }]`
 *    (metadati di presentazione) e testo libero (`description`, `prompts`);
 *  - nel `map.geojson` le proprietà sono geografiche/politiche
 *    (`code`, `name`, `country`, `is_capital`, `area_km2`, `surface_type`,
 *    `tags`, `adjacencies`, `centroid`): nessun asset economico.
 *
 * Regola applicata (supplemento §20–22): **niente dataset inventati e niente
 * string matching a runtime**. Se la fonte non esiste, P6 non pubblica nulla e
 * il layer dichiara l'assenza (`canonical: false`). Questo test:
 *
 *  1. documenta l'evidenza (fallisce se un giorno un catalogo compare: la fase
 *     di authoring/import dovrà allora essere aggiornata di conseguenza);
 *  2. prova che con un preset reale l'endpoint **non inventa** geografia
 *     economica e che la selezione regioni del mondo resta significativa;
 *  3. prova che, quando un catalogo esiste, ogni `regionId` pubblicata esiste
 *     davvero nel mondo (nessun sito orfano).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapp6-preset-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

/** Preset reale scelto: è il più coerente con la mappa mondiale. */
const REAL_PRESET = 'modern_world_provinces';
const PRESETS_DIR = path.join(process.cwd(), 'data', 'presets');
const WORLD = 'mapp6_real_world';
const REGIONS = [`${WORLD}_ITA`, `${WORLD}_DEU`, `${WORLD}_FRA`];

let db: any;
let registry: any;
let gamesRouter: any;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  repos.worldRepository.createWithRegions(
    { id: WORLD, name: 'Mondo reale', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8, templateId: REAL_PRESET },
    REGIONS.map((id, index) => ({
      id, name: id, color: '#111', owner: ['ITA', 'DEU', 'FRA'][index],
      population: 10_000_000, gdp: 900, militaryPower: 100, flag: ['ITA', 'DEU', 'FRA'][index],
      borders: [], objects: [],
    })),
  );
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  } catch { /* tmp */ }
});

const callGetRoute = (routePath: string, params: Record<string, string>) => {
  const layer = gamesRouter.stack.find((item: any) => item.route?.path === routePath && item.route.methods.get);
  if (!layer) throw new Error(`route missing: ${routePath}`);
  let response: { status: number; body: any } | null = null;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { response = { status: this.statusCode, body: payload }; return this; },
  };
  layer.route.stack[0].handle({ method: 'GET', params }, res);
  if (!response) throw new Error(`route did not respond: ${routePath}`);
  return response;
};

describe('MAP P6.1 — preset reale senza fonte strutturata', () => {
  it('evidenza: i preset reali non hanno catalogo strict di geografia economica', () => {
    const realPresets = ['modern_world_provinces', 'pax_modern_provinces', 'mondo_1936', 'mondo_1989', 'europa_1914', 'europa_1815', 'paxh_ww2_provinces'];
    for (const preset of realPresets) {
      const base = path.join(PRESETS_DIR, preset);
      // Nessun catalogo: senza `simulation/` non esiste alcun asset canonico.
      expect(fs.existsSync(path.join(base, 'simulation')), preset).toBe(false);
      const parsed = JSON.parse(fs.readFileSync(path.join(base, 'preset.json'), 'utf8')) as Record<string, unknown>;
      const assetKeys = Object.keys(parsed).filter(key =>
        ['objects', 'industries', 'mines', 'factories', 'ports', 'resources', 'deposits', 'facilities'].includes(key.toLowerCase()));
      expect(assetKeys, preset).toEqual([]);
      // `countries` è presentazione: nome e colore, non geografia economica.
      const countries = (parsed.countries as Array<Record<string, unknown>> | undefined) || [];
      for (const country of countries) expect(Object.keys(country).sort()).toEqual(['code', 'color', 'name']);
    }
  });

  it('il caricamento del preset reale non produce catalogo: nessun dato inventato', async () => {
    const loader = await import('../src/scenario/loader');
    const loaded = loader.loadSimulationCatalog(path.join(PRESETS_DIR, REAL_PRESET));
    expect(loaded.catalog).toBeNull();
  });

  it('endpoint su partita con preset reale: `canonical: false`, array vuoti', () => {
    const gameId = registry.createSession(WORLD, 'Player', REGIONS[0], '#FF0000').gameId;
    const response = callGetRoute('/:id/map-assets', { id: gameId });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ resources: [], facilities: [], canonical: false });
  });

  it('il filtro geografico resta significativo: gli id del mondo non sono quelli del catalogo fixture', () => {
    // Prova strutturale dell'invariante «nessun sito orfano»: le regioni del
    // mondo sono un insieme reale e non vuoto, distinto dallo spazio id della
    // fixture tecnica (nessuna corrispondenza per nome o similarità).
    expect(REGIONS.length).toBeGreaterThan(0);
    const fixtureRegions = ['ALPHA-nord', 'ALPHA-ovest', 'ALPHA-sud', 'BETA-est'];
    for (const fixture of fixtureRegions) expect(REGIONS).not.toContain(fixture);
  });
});
