/**
 * WS-PREFLIGHT-01 — il preflight da testo libero non deve produrre deficit di
 * schema su una normale bozza del giocatore.
 * =====================================================================
 * Difetto misurato (screenshot giocatore): il pannello «Catena della
 * fattibilità» mostrava sette deficit (`INVALID_ID`, `MISSING_FIELD`,
 * `UNKNOWN_ACTION_KIND`, `INVALID_PRIORITY`, `MISSING_AUTHORIZATION`…) su un
 * ordine in bozza con testo valido.
 *
 * Causa: `checkFeasibilityWithCosts` passava a `normalizeOrderIntent` l'uscita
 * del convertitore LLM (`ConvertedAction`: solo `type`/`text`), che non è un
 * `OrderIntent`. Ogni campo canonico risultava `undefined` e diventava un
 * deficit. Questa suite difende il comportamento corretto: il server completa
 * l'involucro canonico con ciò che possiede e la bozza resta valutabile, senza
 * schema fantasma.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB = path.join(os.tmpdir(), `world-story-ws-preflight-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const WORLD_ID = 'ws-preflight-world';
const REGION_ID = 'ws-preflight-region';
const BAD_WORLD_ID = 'ws-preflight-bad-world';
const BAD_REGION_ID = 'ws-preflight-bad-region';

let router: { stack: unknown[] };
let db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } };
let gameId = '';
let badGameId = '';

/** I codici che il giocatore ha visto come «deficit» e che non devono comparire. */
const SCHEMA_DEFICIT_CODES = [
  'INVALID_ID', 'MISSING_FIELD', 'INVALID_PRIORITY', 'MISSING_AUTHORIZATION', 'UNKNOWN_ACTION_KIND',
];

beforeAll(async () => {
  const d = await import('../src/database');
  db = d.default as unknown as typeof db;
  d.initDatabase();
  const worlds = (await import('../src/repositories/world.repository')).worldRepository;
  worlds.createWithRegions(
    { id: WORLD_ID, name: 'Preflight', templateId: 'realism_test_world' },
    [{ id: REGION_ID, name: 'Alfa', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
  );
  worlds.createWithRegions(
    { id: BAD_WORLD_ID, name: 'Preflight senza catalogo', templateId: 'preset_inesistente' },
    [{ id: BAD_REGION_ID, name: 'Alfa', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
  );
  const registry = await import('../src/session-registry');
  // Il convertitore risponde `{}`: `parseConverterResponse` ricade sul testo
  // originale, esattamente come il convertitore vero — è il caso del difetto.
  registry.initSessionRegistry({
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate() { return { content: '{}' }; },
    async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) { onToken(1); return { content: '{}' }; },
    clearCache() {},
  } as never);
  const sessions = registry.getSessionRegistry();
  gameId = sessions.createSession(WORLD_ID, 'P', REGION_ID).gameId;
  badGameId = sessions.createSession(BAD_WORLD_ID, 'P', BAD_REGION_ID).gameId;
  // Il percorso strict è quello che pretende il catalogo: senza, la partita
  // senza catalogo ricadrebbe nel legacy (che non ha questo errore da dare).
  db.prepare("UPDATE games SET economy_mode = 'strict' WHERE id = ?").run(badGameId);
  router = (await import('../src/routes/games.routes')).gamesRouter as unknown as { stack: unknown[] };
});

afterAll(() => {
  try { fs.rmSync(DB); } catch { /* tmp */ }
});

function checkFeasibility(id: string, body: unknown): Promise<{ status: number; payload: any }> {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', params: { id }, body };
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { resolve({ status: this.statusCode, payload }); return this; },
    };
    for (const raw of router.stack) {
      const layer = raw as { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (a: unknown, b: unknown) => void }> } };
      if (layer.route?.path === '/:id/actions/check-feasibility' && layer.route.methods.post) {
        layer.route.stack[layer.route.stack.length - 1]?.handle(req, res);
        return;
      }
    }
    reject(new Error('route missing'));
  });
}

describe('WS-PREFLIGHT-01 — preflight da testo libero', () => {
  it('una bozza valida non produce deficit di schema', async () => {
    const r = await checkFeasibility(gameId, { text: 'Rinforzare lo strumento militare — programma di riarmo pluriennale' });
    expect(r.status).toBe(200);
    const codes = (r.payload.rawAssessment?.blockers ?? []).map((b: any) => b.code);
    for (const forbidden of SCHEMA_DEFICIT_CODES) {
      expect(codes, `deficit di schema ${forbidden} su una bozza valida`).not.toContain(forbidden);
    }
    // La bozza è valutabile: non è dichiarata «strutturalmente vuota».
    expect(r.payload.feasible).toBe(true);
    // E il motivo del verde è dichiarato: nessun effetto materiale è stato
    // interpretato da un testo libero (ordine qualitativo), non un'assenza muta.
    expect(r.payload.warnings.join(' ')).toMatch(/qualitativ/i);
  });

  it('le cause reali restano specifiche: testo vuoto → 400', async () => {
    const r = await checkFeasibility(gameId, { text: '   ' });
    expect(r.status).toBe(400);
    expect(r.payload.error).toMatch(/Testo ordine obbligatorio/i);
  });

  it('le cause reali restano specifiche: catalogo assente → errore di contratto, non sette deficit', async () => {
    const r = await checkFeasibility(badGameId, { text: 'Costruisci un ponte' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.payload)).toMatch(/catalogo|legacy/i);
    expect(JSON.stringify(r.payload)).not.toContain('INVALID_PRIORITY');
  });
});
