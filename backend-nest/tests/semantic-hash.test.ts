/**
 * F04 passo 1–2 — snapshot versionato con hash semantico (§9.4.1).
 *
 * L'hash copre tutti i sottosistemi canonici dello snapshot, esclude i
 * metadati; il restore valida PRIMA di mutare e lo stato restaurato ha lo
 * stesso hash del checkpoint scelto (DoD C12).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-semantic-hash-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;
let gamesRouter: any;

const WORLD_ID = 'hash-world';
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
    { id: WORLD_ID, name: 'Hash fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
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

describe('F04 passo 1–2 — hash semantico dello snapshot', () => {
  it('il save registra l’hash; il restore legittimo ripristina lo stesso hash', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);

    const saved = session.save('hash-save');
    const row = db.prepare('SELECT content_hash, data FROM saves WHERE id = ?').get(saved.saveId) as any;
    expect(row.content_hash).toBeTruthy();

    // Restore legittimo: lo stato restaurato ha lo stesso hash semantico.
    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    expect(session.semanticHash()).toBe(row.content_hash);
  });

  it('uno snapshot manomesso viene rifiutato prima di mutare la sessione', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);
    const saved = session.save('tamper-save');
    const row = db.prepare('SELECT content_hash, data FROM saves WHERE id = ?').get(saved.saveId) as any;

    const tampered = JSON.parse(row.data);
    tampered.regions = (tampered.regions as [string, any][]).map(([id, region]) =>
      id === REGION_ID ? [id, { ...region, owner: 'FRA' }] : [id, region]);
    const dateBefore = session.getCurrentDate();

    expect(() => session.loadFromSave(tampered, row.content_hash))
      .toThrow('snapshot_hash_mismatch');
    // Validazione prima della mutazione (§9.4.1): la sessione è intatta.
    expect(session.getCurrentDate()).toBe(dateBefore);
  });

  it('anche i checkpoint portano l’hash e il restore di route lo verifica', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.queueAction('direttiva di prova');
    await session.processAllPendingActions(30);
    // Restore di un checkpoint di un run già completato (piano F04 passo 4: E1 dopo E2).
    const run = gameRepository.getLatestSimulationRun(session.id) as any;
    const runId = run.id;
    const cpRow = db.prepare('SELECT content_hash, data FROM simulation_checkpoints WHERE id = ?').get(run.checkpoint_id) as any;
    expect(cpRow.content_hash).toBeTruthy();

    // Restore legittimo via route.
    const ok = await callRoute('POST', `/games/${session.id}/simulations/${runId}/restore`);
    expect(ok.status).toBe(200);
    expect(ok.body.type).toBe('checkpoint_restored');

    // Manomissione del checkpoint → il restore di route rifiuta.
    const tampered = JSON.parse(cpRow.data);
    tampered.currentDate = '1999-12-31';
    db.prepare('UPDATE simulation_checkpoints SET data = ? WHERE id = ?').run(JSON.stringify(tampered), run.checkpoint_id);
    const rejected = await callRoute('POST', `/games/${session.id}/simulations/${runId}/restore`);
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(rejected.body)).toContain('snapshot_hash_mismatch');
    // La sessione non è mutata dalla manomissione.
    expect(session.getCurrentDate()).not.toBe('1999-12-31');
  });
});