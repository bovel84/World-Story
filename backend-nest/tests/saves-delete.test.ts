/**
 * DELETE SAVES — cancellazione di un salvataggio, con protezione fail-closed
 * ==========================================================================
 * Prova il contratto della nuova `DELETE /api/saves/:id` sul router reale:
 *
 *  - 200 `{ ok: true, deleted }` e la riga sparisce davvero; un secondo DELETE
 *    risponde 404 (non esiste più);
 *  - 404 su id inesistente;
 *  - 403 `reserved_save` sugli snapshot interni del motore (`__rewind__`,
 *    `__n__`, qualunque `__…__`): la riga **resta**, anche se la richiesta
 *    arriva a mano. La protezione vive nel backend, non nella UI;
 *  - cancellare un salvataggio **non tocca la partita**: `games`,
 *    `game_regions`, `game_operational_objects` restano identici (contenuto
 *    incluso, non solo i conteggi).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-saves-delete-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'saves_delete_world';
const GAME_ID = 'saves_delete_game';
const USER_SAVE_ID = 'save-user-1';
const OTHER_SAVE_ID = 'save-user-2';
const REWIND_SAVE_ID = 'save-rewind';
const LEGACY_INTERNAL_SAVE_ID = 'save-internal-n';

let db: any;
let savesRouter: any;
let gamesRouter: any;
let isReservedSaveName: (name: unknown) => boolean;

interface FakeResponse { statusCode: number; body: any }

/** Invoca una route del router Express reale: nessun server, nessuna rete. */
function callDelete(saveId: string): FakeResponse {
  const layer = savesRouter.stack.find((item: any) => item.route?.path === '/:id' && item.route.methods.delete);
  if (!layer) throw new Error('route missing: DELETE /:id');
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
  layer.route.stack[0].handle({ method: 'DELETE', params: { id: saveId }, body: {}, headers: {}, query: {} }, res);
  if (res.body === undefined) throw new Error('route did not respond');
  return res;
}

const saveRow = (id: string) => db.prepare('SELECT id, name FROM saves WHERE id = ?').get(id);
const savesCount = () => (db.prepare('SELECT COUNT(*) AS n FROM saves').get() as { n: number }).n;

/** Impronta di una tabella: conteggio + contenuto ordinato (nessuna riga nascosta). */
function tableFingerprint(table: string): string {
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
  return crypto.createHash('sha256').update(`${rows.length}:${JSON.stringify(rows)}`).digest('hex');
}

const gameStateFingerprint = () => JSON.stringify({
  games: tableFingerprint('games'),
  gameRegions: tableFingerprint('game_regions'),
  operationalObjects: tableFingerprint('game_operational_objects'),
});

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const routes = await import('../src/routes/saves.routes');
  savesRouter = routes.savesRouter;
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  isReservedSaveName = (await import('../src/game/SaveReservations')).isReservedSaveName;

  db.prepare('INSERT INTO worlds(id, name, start_date, template_id) VALUES(?,?,?,?)')
    .run(WORLD_ID, 'Mondo DELETE SAVES', '2026-01-01', null);
  db.prepare('INSERT INTO games(id, world_id, current_date, current_turn) VALUES(?,?,?,?)')
    .run(GAME_ID, WORLD_ID, '2026-03-01', 7);
  db.prepare('INSERT INTO game_regions(game_id, region_id, owner, color, population, gdp, military_power, objects) VALUES(?,?,?,?,?,?,?,?)')
    .run(GAME_ID, `${WORLD_ID}_USTX`, 'USA', '#609f87', 30_000_000, 1200, 300, '[]');
  db.prepare('INSERT INTO game_operational_objects(game_id, object_id, kind, data, recorded_at) VALUES(?,?,?,?,?)')
    .run(GAME_ID, 'obj-1', 'facility', JSON.stringify({ id: 'obj-1' }), '2026-03-01');

  const insertSave = db.prepare(
    'INSERT INTO saves(id, game_id, name, current_turn, current_date, data, saved_at) VALUES(?,?,?,?,?,?,?)',
  );
  insertSave.run(USER_SAVE_ID, GAME_ID, 'Partita 15/09/2026', 7, '2026-03-01', '{"state":"payload"}', '2026-03-01T10:00:00.000Z');
  insertSave.run(OTHER_SAVE_ID, GAME_ID, 'Partita 12/09/2026', 5, '2026-02-20', '{"state":"payload"}', '2026-02-20T10:00:00.000Z');
  insertSave.run(REWIND_SAVE_ID, GAME_ID, '__rewind__', 7, '2026-03-01', '{"state":"rewind"}', '2026-03-01T11:00:00.000Z');
  insertSave.run(LEGACY_INTERNAL_SAVE_ID, GAME_ID, '__n__', 7, '2026-03-01', '{"state":"internal"}', '2026-03-01T11:30:00.000Z');
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

describe('DELETE SAVES — la regola dei salvataggi riservati', () => {
  it('riconosce gli snapshot interni del motore, ovunque siano scritti', () => {
    expect(isReservedSaveName('__rewind__')).toBe(true);
    expect(isReservedSaveName('__n__')).toBe(true);
    expect(isReservedSaveName('  __rewind__  ')).toBe(true);
    expect(isReservedSaveName('__qualsiasi__')).toBe(true);
    expect(isReservedSaveName('')).toBe(true);
    expect(isReservedSaveName(undefined)).toBe(true);
    expect(isReservedSaveName('Partita 15/09/2026')).toBe(false);
    expect(isReservedSaveName('_rewind_')).toBe(false);
  });
});

describe('DELETE SAVES — lo spazio dei nomi riservati è del motore', () => {
  it('la creazione di un salvataggio con nome riservato è rifiutata (400)', () => {
    const layer = gamesRouter.stack.find((item: any) => item.route?.path === '/:id/save' && item.route.methods.post);
    expect(layer).toBeTruthy();
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { this.body = payload; return this; },
    };
    layer.route.stack[0].handle({
      method: 'POST', params: { id: GAME_ID }, body: { name: '__rewind__' }, headers: {}, query: {},
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'Nome riservato: scegli un nome senza doppi underscore',
      code: 'reserved_save_name',
    });
  });
});

describe('DELETE SAVES — DELETE /api/saves/:id', () => {
  it('cancella un salvataggio esistente e la riga sparisce dal DB', () => {
    const before = savesCount();
    const reservedBefore = saveRow(REWIND_SAVE_ID);

    const res = callDelete(USER_SAVE_ID);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: USER_SAVE_ID });
    expect(saveRow(USER_SAVE_ID)).toBeUndefined();
    expect(savesCount()).toBe(before - 1);
    // Lo snapshot di rewind della stessa partita è ancora lì.
    expect(saveRow(REWIND_SAVE_ID)).toEqual(reservedBefore);
  });

  it('un secondo DELETE sullo stesso id risponde 404 (non esiste più)', () => {
    const again = callDelete(USER_SAVE_ID);
    expect(again.statusCode).toBe(404);
    expect(again.body).toEqual({ error: 'Save not found' });
    expect(saveRow(USER_SAVE_ID)).toBeUndefined();
  });

  it('un id inesistente risponde 404 senza toccare nulla', () => {
    const before = savesCount();
    const res = callDelete('save-che-non-esiste');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Save not found' });
    expect(savesCount()).toBe(before);
  });

  it('FAIL-CLOSED: lo snapshot di rewind NON è cancellabile, riga ancora presente', () => {
    const before = savesCount();
    const rowBefore = saveRow(REWIND_SAVE_ID);

    const res = callDelete(REWIND_SAVE_ID);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Salvataggio riservato: non cancellabile', code: 'reserved_save' });
    expect(saveRow(REWIND_SAVE_ID)).toEqual(rowBefore);
    expect(savesCount()).toBe(before);
  });

  it('FAIL-CLOSED: anche il nome interno storico `__n__` è protetto', () => {
    const res = callDelete(LEGACY_INTERNAL_SAVE_ID);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('reserved_save');
    expect(saveRow(LEGACY_INTERNAL_SAVE_ID)).toBeTruthy();
  });

  it('cancellare un salvataggio NON tocca la partita né il suo stato persistente', () => {
    const fingerprintBefore = gameStateFingerprint();
    const gameBefore = db.prepare('SELECT * FROM games WHERE id = ?').get(GAME_ID);

    const res = callDelete(OTHER_SAVE_ID);

    expect(res.statusCode).toBe(200);
    expect(saveRow(OTHER_SAVE_ID)).toBeUndefined();
    // Partita, regioni di gioco e oggetti operativi: identici, contenuto incluso.
    expect(gameStateFingerprint()).toBe(fingerprintBefore);
    expect(db.prepare('SELECT * FROM games WHERE id = ?').get(GAME_ID)).toEqual(gameBefore);
    // Lo snapshot di rewind resta utilizzabile per il rewind della partita.
    expect(saveRow(REWIND_SAVE_ID)).toBeTruthy();
  });
});
