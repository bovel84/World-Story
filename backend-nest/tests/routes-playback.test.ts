/**
 * Smoke §9.3 — wiring delle rotte del playback «un evento alla volta».
 * Verifica il contratto HTTP end-to-end con router Express e stub LLM:
 * /time-skip → awaiting_next, /simulations/:runId/next → run_completed,
 * /intervene in pausa, conflitto 409 simulation_paused su nuovo salto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `open-pax-routes93-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let gameRepository: any;
let worldRepository: any;
let initSessionRegistry: any;
let getSessionRegistry: any;
let gamesRouter: any;

const WORLD_ID = 'routes93_world';

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Действие игрока' }) };
    }
    if (mechanic === 'jump') {
      return { content: JSON.stringify({
        events: [
          { headline: 'Evento alpha', description: 'Prima svolta.', date: '1951-01-20', mapChanges: [] },
          { headline: 'Evento beta', description: 'Seconda svolta.', date: '1951-02-10', mapChanges: [] },
        ],
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

/** Invoca un handler del router con req/res minimi e cattura la risposta. */
function callRoute(method: string, url: string, body?: any, headers?: Record<string, string>) {
  return new Promise<any>((resolve, reject) => {
    // Il router è montato sotto /games: lavora con percorsi relativi.
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
    { id: WORLD_ID, name: 'Routes93', description: '', startDate: '1951-01-01', basePrompt: 'Lore', historicalAccuracy: 0.8 },
    [
      { id: `${WORLD_ID}_DEU`, name: 'ФРГ', color: '#FF0000', owner: 'DEU', population: 5000000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${WORLD_ID}_POL`, name: 'Польша', color: '#00FF00', owner: 'POL', population: 3000000, gdp: 100, militaryPower: 100, flag: 'POL' },
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

describe('Rotte HTTP del playback scaglionato (§9.3)', () => {
  it('time-skip → awaiting_next → next → run_completed; 409 su nuovo salto in pausa', async () => {
    const created = await callRoute('POST', '/games', { world_id: WORLD_ID, player_name: 'Player', player_region_id: `${WORLD_ID}_DEU` });
    const gameId = created.body.game_id || created.body.game?.id || created.body.id;

    // Registra un ordine: nessun tempo passa (G04).
    const queued = await callRoute('POST', `/games/${gameId}/actions/queue`, { text: 'Direttiva di prova' });
    expect(queued.status).toBe(200);

    // Salto fisso di 90 giorni con due eventi: si ferma al primo checkpoint.
    const skip = await callRoute('POST', `/games/${gameId}/time-skip`, { jump_days: 90 });
    expect(skip.body.type).toBe('awaiting_next');
    expect(skip.body.event.headline).toBe('Evento alpha');
    expect(skip.body.remaining).toBe(1);
    expect(skip.body.destination).toBe('1951-04-01');
    const runId = skip.body.simulationId;

    // Il run è in pausa: un nuovo salto è un conflitto esplicito (§9.2).
    const conflict = await callRoute('POST', `/games/${gameId}/time-skip`, { jump_days: 30 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('simulation_paused');

    // «Continua»: secondo evento, sempre in pausa (destinazione non raggiunta).
    const second = await callRoute('POST', `/games/${gameId}/simulations/${runId}/next`);
    expect(second.body.type).toBe('awaiting_next');
    expect(second.body.event.headline).toBe('Evento beta');
    expect(second.body.remaining).toBe(0);

    // Ultimo «Continua»: avanzamento a destinazione e chiusura.
    const done = await callRoute('POST', `/games/${gameId}/simulations/${runId}/next`);
    expect(done.body.type).toBe('run_completed');
    expect(done.body.newDate).toBe('1951-04-01');
    expect(done.body.actions).toHaveLength(1);
    expect(done.body.actions[0].result.events).toContain('Evento alpha');

    // Il run chiuso non accetta più «Continua».
    const stale = await callRoute('POST', `/games/${gameId}/simulations/${runId}/next`);
    expect(stale.status).toBe(409);

    // GET /games/:id espone lo stato del playback (null a run chiuso).
    const game = await callRoute('GET', `/games/${gameId}`);
    expect(game.body.pausedSimulation).toBeNull();
  });

  it('intervene in pausa chiude il run al checkpoint mostrato', async () => {
    const created = await callRoute('POST', '/games', { world_id: WORLD_ID, player_name: 'Player', player_region_id: `${WORLD_ID}_DEU` });
    const gameId = created.body.game_id || created.body.game?.id || created.body.id;
    await callRoute('POST', `/games/${gameId}/actions/queue`, { text: 'Direttiva da interrompere' });

    const skip = await callRoute('POST', `/games/${gameId}/time-skip`, { jump_days: 90 });
    expect(skip.body.type).toBe('awaiting_next');
    expect(skip.body.checkpointId).toEqual(expect.any(String));
    expect(skip.body.revision).toEqual(expect.any(Number));
    const runId = skip.body.simulationId;

    // G22: un controllo riferito a una pagina superata non può chiudere il
    // run. Intervene è ancorato a simulationId + eventId + revisione.
    const stale = await callRoute('POST', `/games/${gameId}/intervene`, {
      simulationId: runId, eventId: 'evento-non-corrente', revision: skip.body.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('stale_checkpoint');
    const unanchored = await callRoute('POST', `/games/${gameId}/intervene`, { simulationId: runId });
    expect(unanchored.status).toBe(409);
    expect(unanchored.body.code).toBe('checkpoint_anchor_required');

    const outcome = await callRoute('POST', `/games/${gameId}/intervene`, {
      simulationId: runId, eventId: skip.body.event.id, revision: skip.body.revision,
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.intervened).toBe(true);
    expect(outcome.body.type).toBe('intervened');
    expect(outcome.body.newDate).toBe('1951-01-20');
    expect(outcome.body.actions[0].result.events).toContain('Evento alpha');
    expect(outcome.body.actions[0].result.events).not.toContain('Evento beta');

    // Dopo Intervene il tempo riprende a essere comandabile dal giocatore.
    const game = await callRoute('GET', `/games/${gameId}`);
    expect(game.body.pausedSimulation).toBeNull();
  });
});