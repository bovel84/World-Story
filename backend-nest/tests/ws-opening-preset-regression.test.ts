/**
 * WS-OPENING-PRESET-REGRESSION — Il contratto `GET /games/:id` non perde il preset
 * =================================================================================
 * La causa radice: `GET /games/:id` costruiva `world` con soli id/name/regions,
 * quindi `currentWorld.basePrompt` era `undefined` e il fallback locale
 * dell'apertura nasceva vuoto finché `opening-narrative` non rispondeva.
 *
 * Qui si difende il contratto dati: `basePrompt` e `simulationRules` arrivano dal
 * record canonico (`worlds.base_prompt`/`simulation_rules`), sia alla creazione
 * (Test A) sia riaprendo una partita già persistita (Test D, refresh/resume).
 *
 * Solo SQLite temporaneo e provider stub: nessun backend, nessuna rete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-opening-preset-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'preset.sqlite');

const BASE_PROMPT_MARKER = 'BASE_PROMPT_MARKER: il paese si rialza dalle macerie e cerca un posto nel nuovo ordine.';
const SIMULATION_RULES_MARKER = 'SIMULATION_RULES_MARKER: le crisi impiegano mesi e le alleanze si pagano.';
const WORLD_ID = 'ws_preset_world';
const REGION_ID = `${WORLD_ID}_ITA`;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, _system?: string, prompt?: string) {
    // Il bootstrap del giocatore pretende una stima valida: lo stub la fornisce.
    if (typeof prompt === 'string' && prompt.includes('"fallback"')) {
      const { section, fallback, anchors } = JSON.parse(prompt);
      if (section === 'economy') return { content: JSON.stringify({ economy: { ...fallback, debtRatioPct: 30 } }) };
      if (section === 'national-state' && fallback.population == null) {
        return { content: JSON.stringify({ ...fallback, population: Math.max(1, Math.round((anchors?.mapPopulation ?? 1) * 0.6)) }) };
      }
      return { content: JSON.stringify(fallback) };
    }
    return { content: '{}' };
  },
  async stream(_m: string, _s: string, _u: string, onToken: (n: number) => void) { onToken(2); return { content: '{}' }; },
  clearCache() {},
};

let db: any;
let worldRepository: any;
let gameRepository: any;
let gamesRouter: any;
let initSessionRegistry: (provider: unknown) => unknown;

function callRoute(method: string, url: string, body?: any) {
  return new Promise<any>((resolve, reject) => {
    const pathPart = (url.replace(/^\/games/, '') || '/');
    const req: any = { method, url, params: {}, body: body || {}, get: () => undefined, query: {} };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      set() { return this; },
      json(payload: any) { this.body = payload; resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const stack = (gamesRouter as any).stack.filter((layer: any) => layer.route && layer.route.methods[method.toLowerCase()]);
    for (const layer of stack) {
      const routePath: string = layer.route.path;
      const names = [...routePath.matchAll(/:([^/]+)/g)].map(m => m[1]);
      const pattern = new RegExp('^' + routePath.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/') + '$');
      const groups = pathPart.match(pattern);
      if (!groups) continue;
      names.forEach((name, index) => { req.params[name] = decodeURIComponent(groups[index + 1]); });
      layer.route.stack[0].handle(req, res, (err: any) => err ? reject(err) : reject(new Error('next() called')));
      return;
    }
    reject(new Error(`Route not found: ${method} ${pathPart}`));
  });
}

async function createGame(regionId: string): Promise<string> {
  const created = await callRoute('POST', '/games', { world_id: WORLD_ID, player_name: 'Player', player_region_id: regionId });
  const gameId = created.body.game_id || created.body.id;
  expect(gameId).toBeTruthy();
  // POST /games non attende più il Dossier: si aspetta il bootstrap async.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const status = await callRoute('GET', `/games/${gameId}/bootstrap-status`);
    if (status.status === 200 && status.body.status !== 'initializing') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return gameId;
}

beforeAll(async () => {
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  gameRepository = repos.gameRepository;
  const registry = await import('../src/session-registry');
  initSessionRegistry = registry.initSessionRegistry;
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Preset fixture', description: 'Mondo di prova', startDate: '1946-01-01', basePrompt: BASE_PROMPT_MARKER, historicalAccuracy: 0.9, simulationRules: SIMULATION_RULES_MARKER },
    [
      { id: REGION_ID, name: 'Italia', color: '#009246', owner: 'ITA', population: 45_000_000, gdp: 900, militaryPower: 120, flag: 'ITA' },
      { id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0055A4', owner: 'FRA', population: 40_000_000, gdp: 850, militaryPower: 130, flag: 'FRA' },
    ],
  );
  initSessionRegistry(stubProvider);
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.OPEN_PAX_DB_PATH + suffix, { force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  } finally {
    if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH;
    else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  }
});

describe('WS-OPENING-PRESET-REGRESSION — Test A: contratto alla creazione', () => {
  it('GET /games/:id espone basePrompt e simulationRules dal record canonico', async () => {
    const gameId = await createGame(REGION_ID);
    const response = await callRoute('GET', `/games/${gameId}`);
    expect(response.status).toBe(200);
    expect(response.body.world.basePrompt).toContain('BASE_PROMPT_MARKER');
    expect(response.body.world.simulationRules).toContain('SIMULATION_RULES_MARKER');
    for (const value of [response.body.world.basePrompt, response.body.world.simulationRules]) {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
      expect(value).not.toBe('');
    }
    // La stessa GET non deve inventare né modificare il record persistito.
    const persisted = gameRepository.findById(gameId).world;
    expect(persisted.base_prompt).toBe(BASE_PROMPT_MARKER);
    expect(persisted.simulation_rules).toBe(SIMULATION_RULES_MARKER);
  });
});

describe('WS-OPENING-PRESET-REGRESSION — Test D: refresh/resume di una partita esistente', () => {
  it('dopo un riavvio in memoria, i campi canonici restano nella GET', async () => {
    const gameId = await createGame(`${WORLD_ID}_FRA`);
    // Simula il refresh del browser / resume di un salvataggio: nessuna sessione
    // in memoria, il record è riletto dal database.
    initSessionRegistry(stubProvider);
    const response = await callRoute('GET', `/games/${gameId}`);
    expect(response.status).toBe(200);
    expect(response.body.world.basePrompt).toBe(BASE_PROMPT_MARKER);
    expect(response.body.world.simulationRules).toBe(SIMULATION_RULES_MARKER);
    expect(response.body.world.startDate).toBe('1946-01-01');
    expect(response.body.world.description).toBe('Mondo di prova');
  });
});
