/**
 * F04 passo 2+5 — rami di mondo al restore.
 *
 * Ogni partita nasce sul ramo 'main'; il restore di un checkpoint apre un
 * ramo figlio (parent = ramo abbandonato, origin = checkpoint ripristinato)
 * nella stessa transazione delle collezioni ripristinate. L'API risponde con
 * gameId/branch/anchor: il client non indovina cosa sia stato caricato.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-branches-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;
let gamesRouter: any;

const WORLD_ID = 'branch-world';
const REGION_ID = `${WORLD_ID}-A`;

function callRoute(method: string, url: string, body?: any) {
  return new Promise<any>((resolve, reject) => {
    const pathPart = (url.replace(/^\/games/, '') || '/');
    const req: any = { method, url, params: {}, body: body || {}, get: () => undefined, query: {} };
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

function provider() {
  return {
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate(mechanic: string) {
      if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
      return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
    },
    async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
      if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
      const content = JSON.stringify({
        events: [
          { headline: 'Svolta del periodo', description: 'Evento del percorso ordinario.', date: '1951-01-15', mapChanges: [] },
        ],
        narration: 'Fixture',
        worldChanges: { regionOwners: { [REGION_ID]: 'FRA' }, regionColors: {} },
        voided: [], startChat: [], relationshipChanges: [],
      });
      onToken(content.length);
      return { content };
    },
    clearCache() {},
  };
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  const registry = await import('../src/session-registry');
  initSessionRegistry = registry.initSessionRegistry;
  getSessionRegistry = registry.getSessionRegistry;
  const routes = await import('../src/routes/games.routes');
  gamesRouter = routes.gamesRouter;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Branch fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
    [{ id: REGION_ID, name: 'A', color: '#123456', owner: 'POL', population: 1_000, gdp: 1, militaryPower: 1, flag: 'A' }],
  );
  initSessionRegistry(provider() as any);
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${TEST_DB}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* fixture temporanea */ }
});

describe('F04 passo 2+5 — rami al restore', () => {
  it('l’inizializzazione apre il ramo principale', () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    const head = gameRepository.getHeadBranch(session.id);
    expect(head).toBeTruthy();
    const branch = db.prepare('SELECT * FROM game_branches WHERE id = ?').get(head) as any;
    expect(branch).toMatchObject({ game_id: session.id, name: 'main', parent_branch_id: null, origin_checkpoint_id: null });
  });

  it('il restore di un checkpoint crea il ramo figlio e aggiorna head', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);

    const run = gameRepository.getLatestSimulationRun(session.id);
    const oldHead = gameRepository.getHeadBranch(session.id);
    const branchCountBefore = Number((db.prepare('SELECT COUNT(*) AS n FROM game_branches WHERE game_id = ?').get(session.id) as any).n);

    const restored = await callRoute('POST', `/games/${session.id}/simulations/${run.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.gameId).toBe(session.id);
    expect(restored.body.branchId).toBeTruthy();
    expect(restored.body.branchId).not.toBe(oldHead);
    expect(restored.body.anchor).toMatchObject({ checkpointId: run.checkpoint_id });

    const newBranch = db.prepare('SELECT * FROM game_branches WHERE id = ?').get(restored.body.branchId) as any;
    expect(newBranch).toMatchObject({
      game_id: session.id,
      parent_branch_id: oldHead,
      origin_checkpoint_id: run.checkpoint_id,
    });
    expect(gameRepository.getHeadBranch(session.id)).toBe(restored.body.branchId);
    const branchCountAfter = Number((db.prepare('SELECT COUNT(*) AS n FROM game_branches WHERE game_id = ?').get(session.id) as any).n);
    expect(branchCountAfter).toBe(branchCountBefore + 1);
  });

  it('un restore fallito a metà non muta il DB né crea rami', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);
    const run = gameRepository.getLatestSimulationRun(session.id);
    const checkpoint = gameRepository.getSimulationCheckpoint(session.id, run.checkpoint_id);
    const turnBefore = (db.prepare('SELECT current_turn, "current_date" AS d FROM games WHERE id = ?').get(session.id) as any).current_turn;
    const branchCountBefore = Number((db.prepare('SELECT COUNT(*) AS n FROM game_branches WHERE game_id = ?').get(session.id) as any).n);

    const boom = new Error('boom a metà restore');
    const spy = vi.spyOn(gameRepository, 'replaceHistory').mockImplementation(() => { throw boom; });
    expect(() => session.loadFromSave(
      JSON.parse(checkpoint.data), checkpoint.content_hash ?? undefined,
      { newBranch: { originCheckpointId: checkpoint.id } },
    )).toThrow('boom a metà restore');
    spy.mockRestore();

    // Nessuna collezione ripristinata, nessun ramo creato: transazione unica.
    expect(gameRepository.getHeadBranch(session.id)).toBeTruthy();
    const branchCountAfter = Number((db.prepare('SELECT COUNT(*) AS n FROM game_branches WHERE game_id = ?').get(session.id) as any).n);
    expect(branchCountAfter).toBe(branchCountBefore);
    const game = db.prepare('SELECT current_turn, "current_date" AS d FROM games WHERE id = ?').get(session.id) as any;
    expect(game.current_turn).toBe(turnBefore);
  });

  it('il ramo abbandonato resta solo in archivio privato: l’outbox pendente non è ripubblicato', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);
    const run = gameRepository.getLatestSimulationRun(session.id);
    const pendingBefore = Number((db.prepare(
      'SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ? AND delivery_state = \'pending\''
    ).get(session.id) as any).n);
    expect(pendingBefore).toBeGreaterThan(0);

    const restored = await callRoute('POST', `/games/${session.id}/simulations/${run.id}/restore`);
    expect(restored.status).toBe(200);
    const pendingAfter = Number((db.prepare(
      'SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ? AND delivery_state = \'pending\''
    ).get(session.id) as any).n);
    expect(pendingAfter).toBe(0);
    // Le righe restano consultabili come audit privato.
    const archived = Number((db.prepare(
      'SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ? AND delivery_state = \'published\''
    ).get(session.id) as any).n);
    expect(archived).toBe(pendingBefore);
  });

  it('E1 dopo riavvio: la sessione ricostruita dal DB ripristina il checkpoint di un run chiuso', async () => {
    const created = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    const session = created.session;
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);
    const run = gameRepository.getLatestSimulationRun(session.id);
    const gameId: string = created.gameId;

    // Riavvio: la sessione cade dalla memoria, il registry la ricostruisce dal DB.
    getSessionRegistry().removeSession(gameId);
    const oldHead = gameRepository.getHeadBranch(gameId);

    const restored = await callRoute('POST', `/games/${gameId}/simulations/${run.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.gameId).toBe(gameId);
    expect(restored.body.branchId).toBeTruthy();
    expect(restored.body.branchId).not.toBe(oldHead);
    expect(restored.body.anchor).toMatchObject({ checkpointId: run.checkpoint_id });
    expect(gameRepository.getHeadBranch(gameId)).toBe(restored.body.branchId);
  });
});