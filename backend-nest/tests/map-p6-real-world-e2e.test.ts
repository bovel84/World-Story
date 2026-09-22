/**
 * MAP P6.3 — verifica end-to-end sul VERO percorso di creazione del mondo moderno
 * ==============================================================================
 * Il test P6.2 costruiva le regioni a mano (`worldRepository.createWithRegions`
 * con sole 4 province utili): una scorciatoia che non provava né il contratto
 * `feature.properties.code → <worldId>_<code>` nel flusso reale, né il binding
 * `game → world → template → catalogo`.
 *
 * Qui si attraversa la catena **vera**, senza mock della geografia:
 *
 *   POST /api/worlds/generate  (sync)  → `runWorldGeneration` reale
 *     → partitionMapFeatures → deriveGroups → createWithRegions (946 regioni)
 *   POST /api/games                    → createSession reale
 *   GET  /api/games/:id/map-assets     → handler reale, nessuna risposta finta
 *
 * L'unico stub è il **provider LLM** (come già fanno gli altri test di route):
 * il contenuto generato dal modello non è oggetto di questa verifica, la
 * geografia e il binding sì. Nessun credito LLM consumato, nessuna rete.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapp63-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const PRESET_ID = 'modern_world_provinces';
const PRESET_DIR = path.join(process.cwd(), 'data', 'presets', PRESET_ID);

// Vertical slice del catalogo P6.2: solo id già esistenti, nessun asset nuovo.
const EXPECTED = {
  resource: [
    ['deposit:USTX:crude_oil:1', 'crude_oil', 'USTX'],
    ['deposit:ZANW:coal:1', 'coal', 'ZANW'],
    ['deposit:AUWA:iron_ore:1', 'iron_ore', 'AUWA'],
  ],
  facility: [
    ['facility:NLNH:refinery:1', 'refinery', 'NLNH'],
    ['facility:NLNH:refinery:2', 'refinery', 'NLNH'],
  ],
  hidden: 'deposit:RUSA:crude_oil:1',
  slice: ['USTX', 'NLNH', 'ZANW', 'AUWA', 'RUSA'],
} as const;

/** Provider/router LLM stub: risponde con stati fissi, conta le chiamate. */
const llmCalls = { count: 0 };
const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  generate: (mechanic: string, _system: string, user: string) => {
    if (mechanic !== 'balance') return Promise.resolve({ content: '{}' });
    llmCalls.count += 1;
    const codes = [...String(user).matchAll(/^([A-Z]{3}):/gm)].map(match => match[1]);
    const countries: Record<string, unknown> = {};
    for (const code of codes) {
      countries[code] = {
        population: 20_000_000, gdp: 40, military: 30,
        ideology: 'repubblica', allies: [], enemies: [], status: 'regional',
      };
    }
    return Promise.resolve({ content: JSON.stringify({ countries }) });
  },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache: () => undefined,
};

vi.mock('../src/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm')>();
  return { ...actual, getLLMRouter: () => stubProvider };
});

interface FakeResponse { statusCode: number; body: any }

function fakeRes(): any {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
    send(payload: any) { this.body = payload; return this; },
    setHeader() { return this; },
    end(payload: any) { if (payload !== undefined) this.body = payload; return this; },
  };
  return res;
}

/** Invoca una route del router Express reale: nessun server, nessuna rete. */
async function callRoute(
  router: any,
  method: 'get' | 'post',
  routePath: string,
  input: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<FakeResponse> {
  const layer = router.stack.find((item: any) => item.route?.path === routePath && item.route.methods[method]);
  if (!layer) throw new Error(`route missing: ${method.toUpperCase()} ${routePath}`);
  const res = fakeRes();
  const req: any = {
    method: method.toUpperCase(),
    url: routePath,
    originalUrl: routePath,
    params: input.params ?? {},
    query: {},
    body: input.body ?? {},
    headers: {},
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => { if (res.body !== undefined) { clearInterval(timer); resolve(); } }, 5);
    const bail = setTimeout(() => { clearInterval(timer); reject(new Error(`timeout: ${routePath}`)); }, 900_000);
    try {
      const returned = layer.route.stack[0].handle(req, res, () => { /* next: non usato */ });
      if (returned && typeof returned.then === 'function') {
        returned.catch((error: unknown) => { clearTimeout(bail); clearInterval(timer); reject(error); });
      }
    } catch (error) {
      clearTimeout(bail); clearInterval(timer); reject(error);
    }
  });
  return res;
}

let db: any;
let worldsRouter: any;
let gamesRouter: any;
let gameRepository: any;
let worldRepository: any;
let registry: any;

/** Impronta completa del DB: nomi, conteggi e contenuto di ogni tabella. */
function databaseFingerprint(): string {
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as { name: string }[]).map(row => row.name);
  const digest = crypto.createHash('sha256');
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    digest.update(`${table}:${rows.length}:`);
    digest.update(crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'));
  }
  return digest.digest('hex');
}

let worldId = '';
let homeRegionId = '';
let gameId = '';
let mapFeatures = 0;
let mapPolities = 0;
/**
 * Regioni realmente create dal flusso reale. Le 946 feature della mappa non
 * sono 946 regioni: 4 sono feature **nazionali** di politie che hanno anche le
 * loro province (`ARG`, `VEN`, `ECU`, `BOL`); per quelle politie vince il ramo
 * provinciale, quindi la feature nazionale non produce una seconda regione.
 * Il conto è calcolato dal file reale, non hardcodato.
 */
let expectedRegions = 0;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();

  const repos = await import('../src/repositories');
  gameRepository = repos.gameRepository;
  worldRepository = repos.worldRepository;

  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();

  worldsRouter = (await import('../src/routes/worlds.routes')).worldsRouter;
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;

  const geo = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'map.geojson'), 'utf8'));
  const features = geo.features as Array<{ properties: Record<string, string> }>;
  const isProvinceOf = (feature: { properties: Record<string, string> }) =>
    !!feature.properties.country && feature.properties.country !== feature.properties.code;
  const provinces = features.filter(isProvinceOf);
  const countryLevel = features.filter(feature => !isProvinceOf(feature));
  const parentCodes = new Set(provinces.map(feature => feature.properties.country));
  mapFeatures = features.length;
  mapPolities = new Set(features.map(feature => feature.properties.country || feature.properties.code)).size;
  expectedRegions = provinces.length + countryLevel.filter(feature => !parentCodes.has(feature.properties.code)).length;
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* tmp */ }
});

describe('MAP P6.3 — mondo moderno reale: creazione, binding, endpoint', () => {
  it('1 — POST /worlds/generate crea il mondo provinciale COMPLETO dal preset reale', async () => {
    const res = await callRoute(worldsRouter, 'post', '/generate', {
      body: { templateId: PRESET_ID, playerCountryCode: 'USA', sync: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.error).toBeUndefined();
    worldId = String(res.body.worldId);
    // Il worldId è generato dal flusso reale: non è hardcodato da nessuna parte.
    expect(worldId).toBeTruthy();
    expect(res.body.playerCountryCode).toBe('USA');
    homeRegionId = String(res.body.regionIds?.USA || '');
    expect(homeRegionId.startsWith(`${worldId}_`)).toBe(true);

    const regions = db.prepare('SELECT id, owner, flag FROM world_regions WHERE world_id = ?')
      .all(worldId) as { id: string; owner: string; flag: string }[];
    // Mondo completo: una regione per OGNI provincia della mappa reale.
    expect(regions.length).toBe(expectedRegions);
    expect(expectedRegions).toBeGreaterThan(900);
    // 946 feature = 942 province + 4 feature nazionali «ombraggiate».
    expect(mapFeatures - expectedRegions).toBe(4);
    // Nessun id fuori dalla convenzione `<worldId>_<code>`.
    expect(regions.every(region => region.id.startsWith(`${worldId}_`))).toBe(true);
    // Tutte le politie della mappa esistono davvero (nessun buco).
    expect(new Set(regions.map(region => region.flag || region.owner)).size).toBe(mapPolities);

    // Vertical slice: le regioni del catalogo P6.2 esistono nel mondo creato.
    const ids = new Set(regions.map(region => region.id));
    for (const code of EXPECTED.slice) {
      expect(ids.has(`${worldId}_${code}`), code).toBe(true);
    }

    // Il template resta legato al mondo (server-side, immutabile).
    const world = worldRepository.findById(worldId);
    expect(world.template_id).toBe(PRESET_ID);
  }, 900_000);

  it('2 — POST /games crea la partita sul mondo appena generato', async () => {
    const res = await callRoute(gamesRouter, 'post', '/', {
      body: {
        worldId,
        playerName: 'USA',
        playerRegionId: homeRegionId,
        playerColor: '#FF0000',
        difficulty: 'normal',
      },
    });

    expect(res.statusCode).toBe(200);
    gameId = String(res.body.game_id);
    expect(gameId).toBeTruthy();
    expect(res.body.player_polity_id).toBe('USA');

    // Catena di binding completa: gameId → worldId → templateId → preset.
    const binding = gameRepository.getWorldBinding(gameId);
    expect(binding).toEqual({ worldId, templateId: PRESET_ID });
    expect(registry.getSession(gameId)).toBeTruthy();
  }, 300_000);

  it('3 — GET /map-assets: canonical, risorse e impianti del catalogo reale', async () => {
    const res = await callRoute(gamesRouter, 'get', '/:id/map-assets', { params: { id: gameId } });

    expect(res.statusCode).toBe(200);
    const assets = res.body;
    expect(assets.canonical).toBe(true);
    expect(assets.resources.length).toBeGreaterThan(0);
    expect(assets.facilities.length).toBeGreaterThan(0);

    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(item => [item.id, item]));
    const resources = byId(assets.resources);
    const facilities = byId(assets.facilities);

    // Id canonici richiesti, con il regionId del MONDO REALMENTE CREATO.
    for (const [id, resourceId, code] of EXPECTED.resource) {
      expect(resources.has(id), id).toBe(true);
      expect(resources.get(id)!.resourceId).toBe(resourceId);
      expect(resources.get(id)!.regionId).toBe(`${worldId}_${code}`);
    }
    for (const [id, typeId, code] of EXPECTED.facility) {
      expect(facilities.has(id), id).toBe(true);
      expect(facilities.get(id)!.typeId).toBe(typeId);
      expect(facilities.get(id)!.regionId).toBe(`${worldId}_${code}`);
    }

    // L'impianto non operativo è pubblicato come tale (non nascosto, non finto).
    expect(facilities.get('facility:NLNH:refinery:2')!.operational).toBe(false);
    // `known: null` resta ignoto: mai uno zero inventato.
    expect(resources.get('deposit:USTX:crude_oil:1')!.known).toBe(false);
    expect(resources.get('deposit:USTX:crude_oil:1')!.knownQuantity).toBeNull();

    // Nessun asset orfano: ogni regionId esiste nelle regioni create dal flusso reale.
    const worldRegionIds = new Set(worldRepository.regionIds(worldId));
    for (const asset of [...assets.resources, ...assets.facilities]) {
      expect(worldRegionIds.has(asset.regionId), asset.id).toBe(true);
    }

    // `hidden` non è osservabile: non viene pubblicato.
    expect(resources.has(EXPECTED.hidden)).toBe(false);
    expect(assets.resources.some((item: any) => item.regionId === `${worldId}_RUSA`)).toBe(false);
  }, 300_000);

  it('4 — due GET consecutive sono deterministiche e non scrivono nulla', async () => {
    const before = databaseFingerprint();
    const operationalObjectsBefore = db.prepare('SELECT COUNT(*) AS n FROM game_operational_objects').get().n;
    const gameBefore = db.prepare('SELECT current_date, current_turn FROM games WHERE id = ?').get(gameId);
    const ownBefore = db.prepare('SELECT owner, name FROM world_regions WHERE id = ?').get(`${worldId}_USTX`);

    const first = await callRoute(gamesRouter, 'get', '/:id/map-assets', { params: { id: gameId } });
    const second = await callRoute(gamesRouter, 'get', '/:id/map-assets', { params: { id: gameId } });

    expect(first.body).toEqual(second.body);
    expect(first.body.canonical).toBe(true);

    const after = databaseFingerprint();
    // Nessuna riga, in nessuna tabella, cambia: la GET non materializza stato.
    expect(after).toBe(before);

    // Controlli espliciti sulle entità che una lettura «idratante» toccherebbe:
    // gli stessi valori di prima delle due GET (non «zero», ma «immutati»: gli
    // oggetti operativi della partita sono legittimamente già presenti).
    expect(db.prepare('SELECT COUNT(*) AS n FROM game_operational_objects').get().n).toBe(operationalObjectsBefore);
    expect(db.prepare('SELECT current_date, current_turn FROM games WHERE id = ?').get(gameId)).toEqual(gameBefore);
    expect(db.prepare('SELECT owner, name FROM world_regions WHERE id = ?').get(`${worldId}_USTX`)).toEqual(ownBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM world_regions WHERE world_id = ?').get(worldId).n).toBe(expectedRegions);
  }, 300_000);

  it('5 — il percorso moderno non richiede più province «costruite a mano»', async () => {
    // Prova negativa: un mondo senza le regioni della mappa reale (subset
    // costruito a mano) NON pubblica nulla, perché il binding fallisce.
    const fakeWorld = 'mapp63_fake';
    const fakeGame = 'mapp63_fake_game';
    worldRepository.createWithRegions(
      {
        id: fakeWorld, name: 'Subset', description: '', startDate: '2026-01-01',
        basePrompt: 'test', historicalAccuracy: 0.8, templateId: PRESET_ID,
      },
      [{ id: `${fakeWorld}_USTX`, name: 'Texas', color: '#888888', owner: 'USA', flag: 'USA', objects: [] }],
    );
    db.prepare('INSERT INTO games(id, world_id, current_date, current_turn) VALUES(?,?,?,?)')
      .run(fakeGame, fakeWorld, '2026-01-01', 1);

    const res = await callRoute(gamesRouter, 'get', '/:id/map-assets', { params: { id: fakeGame } });
    expect(res.statusCode).toBe(200);
    expect(res.body.canonical).toBe(true);
    // Solo gli asset delle regioni che esistono davvero: nessun orfano.
    for (const asset of res.body.resources) expect(asset.regionId).toBe(`${fakeWorld}_USTX`);
    expect(res.body.resources.length).toBeLessThan(
      (await callRoute(gamesRouter, 'get', '/:id/map-assets', { params: { id: gameId } })).body.resources.length,
    );
  }, 300_000);

  it('6 — un secondo mondo moderno è completo, con un worldId diverso e zero costo LLM aggiuntivo', async () => {
    const callsBefore = llmCalls.count;
    const res = await callRoute(worldsRouter, 'post', '/generate', {
      body: { templateId: PRESET_ID, playerCountryCode: 'DEU', sync: true },
    });

    expect(res.statusCode).toBe(200);
    const secondWorldId = String(res.body.worldId);
    // Il worldId è generato dal flusso reale: due mondi, due id diversi.
    expect(secondWorldId).not.toBe(worldId);
    const secondRegions = db.prepare('SELECT COUNT(*) AS n FROM world_regions WHERE world_id = ?')
      .get(secondWorldId).n;
    expect(secondRegions).toBe(expectedRegions);

    // La seconda generazione riusa la cache/baseline del preset: nessuna
    // chiamata LLM in più (né a freddo né a caldo la partita la tocca).
    expect(llmCalls.count).toBe(callsBefore);
  }, 900_000);
});
