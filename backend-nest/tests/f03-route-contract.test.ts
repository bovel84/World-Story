/**
 * F03 — A03: la route del run non espone lo stato interno (pending_state con
 * le proposte future non applicate, chiavi di idempotenza); A10: il salto
 * senza eventi non inferisce l'esito dall'ultima cronaca (niente fallback
 * per posizione).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-f03-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: any;
let getSessionRegistry: any;
let gamesRouter: any;

const WORLD_ID = 'f03_world';

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Ordine convertito' }) };
    }
    if (mechanic === 'jump') {
      const events = jumpEvents;
      return { content: JSON.stringify({
        events,
        narration: 'Periodo completo.',
        voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
      }) };
    }
    return { content: JSON.stringify({ type: 'develop', description: 'x', priority: 5 }) };
  },
  async stream(mechanic: string, system: string, user: string, onToken: any, options?: any) {
    const r = await this.generate(mechanic, system, user, options);
    onToken(r.content.length);
    return r;
  },
  clearCache() {},
};

/** Eventi proposti dal prossimo jump: vuoto = nessun evento (ramo no_event). */
let jumpEvents: any[] = [];

function callRoute(method: string, url: string, body?: any, headers?: Record<string, string>) {
  return new Promise<any>((resolve, reject) => {
    const pathPart = (url.replace(/^\/games/, '') || '/');
    const [, queryPart] = url.split('?');
    const req: any = {
      method, url, params: {}, body: body || {},
      get: (name: string) => headers?.[name.toLowerCase()],
      query: Object.fromEntries(new URLSearchParams(queryPart || '')),
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      set(_name: string, _value: string) { return this; },
      json(payload: any) { this.body = payload; resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const stack = (gamesRouter as any).stack.filter((layer: any) =>
      layer.route && layer.route.methods[method.toLowerCase()]
    );
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

beforeAll(async () => {
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  gameRepository = repos.gameRepository;
  const registryModule = await import('../src/session-registry');
  initSessionRegistry = registryModule.initSessionRegistry;
  getSessionRegistry = registryModule.getSessionRegistry;
  const routes = await import('../src/routes/games.routes');
  gamesRouter = routes.gamesRouter;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'F03 fixture', description: '', startDate: '1951-01-01', basePrompt: 'Lore', historicalAccuracy: 0.8 },
    [
      { id: `${WORLD_ID}_DEU`, name: 'DEU', color: '#FF0000', owner: 'DEU', population: 5_000_000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${WORLD_ID}_POL`, name: 'POL', color: '#00FF00', owner: 'POL', population: 3_000_000, gdp: 100, militaryPower: 100, flag: 'POL' },
    ]
  );
  initSessionRegistry(stubProvider);
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('A03 — GET /simulations/:runId non espone lo stato interno', () => {
  it('il run in pausa non restituisce pending_state né chiavi di idempotenza', async () => {
    jumpEvents = [
      { headline: 'Evento alpha', description: 'Prima svolta.', date: '1951-01-20', mapChanges: [] },
      { headline: 'Evento beta', description: 'Seconda svolta.', date: '1951-02-10', mapChanges: [] },
    ];
    const created = await callRoute('POST', '/games', { world_id: WORLD_ID, player_name: 'Player', player_region_id: `${WORLD_ID}_DEU` });
    const gameId = created.body.game_id || created.body.game?.id || created.body.id;
    await callRoute('POST', `/games/${gameId}/actions/queue`, { text: 'Direttiva di prova' });
    const skip = await callRoute('POST', `/games/${gameId}/time-skip`, { jump_days: 90 }, { 'idempotency-key': 'test-key-a03' });
    const runId = skip.body.simulationId || skip.body.simulation_id;
    expect(runId).toBeTruthy();

    // Precondizione: il DB contiene davvero lo stato interno da nascondere.
    const raw = gameRepository.getSimulationRun(gameId, runId);
    expect(raw.pending_state).toBeTruthy();
    expect(raw.idempotency_key).toBe('test-key-a03');

    const response = await callRoute('GET', `/games/${gameId}/simulations/${runId}`);
    expect(response.status).toBe(200);
    const run = response.body.run;
    expect(run.id).toBe(runId);
    expect(run.status).toBeTruthy();
    expect(run.mode).toBeTruthy();
    expect(run).not.toHaveProperty('pending_state');
    expect(run).not.toHaveProperty('idempotency_key');
    expect(run).not.toHaveProperty('idempotency_hash');
    // Il contratto pubblico resta integro: attesa di conferma ed eventi visibili.
    expect(response.body.awaitingNext?.simulationId).toBe(runId);
    expect(response.body.events.length).toBeGreaterThan(0);
  });
});

describe('A10 — il salto senza eventi non inferisce l’esito dall’ultima cronaca', () => {
  it('un run senza eventi risponde no_event_found, non con la cronaca precedente', async () => {
    const created = await callRoute('POST', '/games', { world_id: WORLD_ID, player_name: 'Player', player_region_id: `${WORLD_ID}_POL` });
    const gameId = created.body.game_id || created.body.game?.id || created.body.id;

    // Run 1: un evento → cronaca esistente nel gioco.
    jumpEvents = [{ headline: 'Evento', description: 'Svolta.', date: '1951-01-20', mapChanges: [] }];
    const first = await callRoute('POST', `/games/${gameId}/time-skip`, { jump_days: 30 });
    expect(first.body.type).toBe('world_advanced');
    const firstRunId = first.body.simulationId;
    expect(firstRunId).toBeTruthy();

    // Run 2: nessun evento (mode next_event) → nessun esito inventato dal
    // run precedente: il ramo no_event chiude il run senza cronaca.
    jumpEvents = [];
    const second = await callRoute('POST', `/games/${gameId}/time-skip`, { mode: 'next_event' });
    const runs = gameRepository.getSimulationRuns ? null : null; 
    expect(second.body.type).toBe('no_event_found');
    expect(second.body.simulationId).not.toBe(firstRunId);
    expect(second.body.result).toBeUndefined();
  });
});