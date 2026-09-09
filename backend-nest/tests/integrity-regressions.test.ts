/**
 * F00 — regressioni di integrità scoperte dall'audit 2026-09-08.
 *
 * I casi `fails` sono riproduzioni intenzionalmente rosse della fotografia
 * iniziale: F01/F03/F04 dovranno convertirli in test verdi quando sostituiranno
 * i percorsi legacy. Non sono una certificazione E2E del flusso R1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-f00-${process.pid}-${Date.now()}.db`);
const REAL_DB = path.resolve(__dirname, '../data/world-story.db');
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let initDatabase: () => void;
let gameRepository: any;
let gamesRouter: any;

function callRoute(method: string, url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const pathPart = url.replace(/^\/games/, '') || '/';
    const req: any = { method, url, params: {}, body: {}, query: {}, get: () => undefined };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      set(_name: string, _value: string) { return this; },
      json(payload: any) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const layer = (gamesRouter as any).stack.find((candidate: any) => {
      if (!candidate.route || !candidate.route.methods[method.toLowerCase()]) return false;
      const routePath = candidate.route.path as string;
      const pattern = new RegExp(`^${routePath.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/')}$`);
      const matches = pathPart.match(pattern);
      if (!matches) return false;
      [...routePath.matchAll(/:([^/]+)/g)].forEach((match, index) => {
        req.params[match[1]] = decodeURIComponent(matches[index + 1]);
      });
      return true;
    });
    if (!layer) return reject(new Error(`Route not found: ${method} ${pathPart}`));
    layer.route.stack[0].handle(req, res, reject);
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  initDatabase = database.initDatabase;
  initDatabase();
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;

  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES (?, ?, '', ?, '')`)
    .run('f00-world', 'F00 fixture', '1951-01-01');
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, ?, 1, ?)`)
    .run('f00-game', 'f00-world', '1951-01-01');
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${TEST_DB}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* fixture temporanea: non toccare DB reali */ }
});

describe('F00 — isolamento e riproduzioni audit', () => {
  it('usa esclusivamente una SQLite temporanea, mai il salvataggio reale', () => {
    const activePath = (db.prepare('PRAGMA database_list').all() as any[])
      .find(row => row.name === 'main')?.file;
    // macOS espone /var anche come /private/var: confrontare i path reali.
    expect(fs.realpathSync(activePath)).toBe(fs.realpathSync(TEST_DB));
    expect(fs.realpathSync(activePath)).not.toBe(REAL_DB);
  });

  it('A03/C03: GET run non deve serializzare pending_state sigillato', async () => {
    gameRepository.createSimulationRun({
      id: 'f00-secret-run', gameId: 'f00-game', mode: 'fixed', startDate: '1951-01-01', targetDate: '1951-02-01',
    });
    const secret = 'E2_SECRET_DO_NOT_LEAK';
    db.prepare(`UPDATE simulation_runs SET pending_state = ?, status = 'awaiting_next' WHERE id = ?`)
      .run(JSON.stringify({ remainingEvents: [{ headline: secret }]}), 'f00-secret-run');

    const response = await callRoute('GET', '/games/f00-game/simulations/f00-secret-run');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it('A05/C05: restore della coda conserva gli ordini processing', () => {
    gameRepository.replacePendingActions('f00-game', [{
      id: 'f00-processing-action', text: 'Ordine già emesso', createdAt: '1951-01-01T00:00:00.000Z', status: 'processing',
    }]);

    const row = db.prepare('SELECT status FROM pending_actions WHERE id = ?').get('f00-processing-action') as any;
    expect(row).toEqual({ status: 'processing' });
  });

  it('A01/C01: il percorso canonico non associa outcome tramite indice o testo', async () => {
    const source = await fs.promises.readFile(path.join(__dirname, '../src/game-session.ts'), 'utf8');
    expect(source).not.toMatch(/actionOutcomes\?\.\[index\]/);
    expect(source).not.toMatch(/result\.action === action\.text/);
  });

  it('A07/C07: la chiusura di un processo non usa il titolo', async () => {
    const source = await fs.promises.readFile(path.join(__dirname, '../src/repositories/game.repository.ts'), 'utf8');
    expect(source).not.toContain('WHERE game_id = ? AND title = ? AND status = \'ongoing\'');
  });

  it('A10/C10: il salto senza eventi non inferisce l’esito dall’ultima cronaca', async () => {
    const source = await fs.promises.readFile(path.join(__dirname, '../src/game-session.ts'), 'utf8');
    expect(source).not.toContain('return this.results.at(-1) || null;');
  });
});
