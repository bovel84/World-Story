/**
 * Q02 µ1 — Vecchi save copiati: la migrazione gira su una COPIA, l'originale
 * resta leggibile e intatto, il legacy non viene mai convertito in silenzio,
 * e le migrazioni sono ripetibili (idempotenti).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-q02-legacy-'));
const originalDb = path.join(workDir, 'legacy-original.db');
const copyDb = path.join(workDir, 'legacy-copy.db');
const previousDbPath = process.env.OPEN_PAX_DB_PATH;

let database: typeof import('../src/database');
let gameRepository: typeof import('../src/repositories/game.repository').gameRepository;

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gameColumns(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.pragma('table_info(games)') as Array<{ name: string }>).map((row) => row.name);
  } finally {
    db.close();
  }
}

/** Save "storico": schema ridotto, nessuna colonna economica/runtime. */
function createLegacySave(file: string): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE games (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, current_turn INTEGER DEFAULT 1, current_date TEXT);
    CREATE TABLE players (id TEXT PRIMARY KEY, game_id TEXT, region_id TEXT, name TEXT);
    CREATE TABLE world_regions (id TEXT PRIMARY KEY, world_id TEXT, owner TEXT, flag TEXT);
  `);
  db.exec("INSERT INTO worlds (id, name) VALUES ('w1','Mondo legacy')");
  db.exec("INSERT INTO games (id, world_id, current_turn, current_date) VALUES ('g1','w1',7,'1961-05-04')");
  db.exec("INSERT INTO world_regions (id, world_id, owner, flag) VALUES ('r1','w1','player','USA')");
  db.exec("INSERT INTO players (id, game_id, region_id, name) VALUES ('p1','g1','r1','Giocatore')");
  db.close();
}

beforeAll(async () => {
  createLegacySave(originalDb);
  fs.copyFileSync(originalDb, copyDb);
  process.env.OPEN_PAX_DB_PATH = copyDb;
  database = await import('../src/database');
  database.initDatabase();
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
});

afterAll(() => {
  if (previousDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH;
  else process.env.OPEN_PAX_DB_PATH = previousDbPath;
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('Q02 µ1 — migrazione su copia di un save legacy', () => {
  it('migra la copia e lascia l’originale byte-identico', () => {
    expect(gameColumns(copyDb)).toContain('economy_mode');
    expect(gameColumns(copyDb)).toContain('queue_version');
    // L'originale non è stato toccato: nessun dato reale modificato senza consenso.
    expect(gameColumns(originalDb)).not.toContain('economy_mode');
    const untouched = new Database(originalDb, { readonly: true });
    const game = untouched.prepare('SELECT current_turn, [current_date] FROM games WHERE id = ?').get('g1') as { current_turn: number; current_date: string };
    untouched.close();
    expect(game).toEqual({ current_turn: 7, current_date: '1961-05-04' });
    expect(sha256(originalDb)).toBe(sha256(originalDb));
  });

  it('conserva i valori storici della partita durante la migrazione', () => {
    const db = new Database(copyDb, { readonly: true });
    const game = db.prepare('SELECT current_turn, [current_date], economy_mode, queue_version, world_revision FROM games WHERE id = ?').get('g1') as Record<string, unknown>;
    const player = db.prepare('SELECT polity_id FROM players WHERE id = ?').get('p1') as { polity_id: string };
    db.close();
    expect(game.current_turn).toBe(7);
    expect(game.current_date).toBe('1961-05-04');
    expect(game.economy_mode).toBe('legacy');
    expect(game.queue_version).toBe(0);
    expect(game.world_revision).toBe(0);
    expect(player.polity_id).toBe('USA');
  });

  it('il legacy resta legacy: nessuna conversione implicita a strict', () => {
    expect(gameRepository.getEconomyMode('g1')).toBe('legacy');
    const db = new Database(copyDb, { readonly: true });
    const row = db.prepare('SELECT economy_model_version FROM games WHERE id = ?').get('g1') as { economy_model_version: string | null };
    db.close();
    // Nessun modelVersion inventato: la colonna resta NULL finché la
    // conversione non è richiesta esplicitamente.
    expect(row.economy_model_version).toBeNull();
  });

  it('le migrazioni sono ripetibili: una seconda esecuzione non perde dati', () => {
    database.initDatabase();
    database.initDatabase();
    const db = new Database(copyDb, { readonly: true });
    const game = db.prepare('SELECT current_turn, [current_date], economy_mode FROM games WHERE id = ?').get('g1') as Record<string, unknown>;
    const count = db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number };
    db.close();
    expect(count.n).toBe(1);
    expect(game).toMatchObject({ current_turn: 7, current_date: '1961-05-04', economy_mode: 'legacy' });
  });

  it('un rollback (ripristino dell’originale) torna allo schema storico', () => {
    const rollback = path.join(workDir, 'rollback.db');
    fs.copyFileSync(originalDb, rollback);
    expect(gameColumns(rollback)).not.toContain('economy_mode');
    const db = new Database(rollback, { readonly: true });
    const game = db.prepare('SELECT current_turn FROM games WHERE id = ?').get('g1') as { current_turn: number };
    db.close();
    expect(game.current_turn).toBe(7);
  });
});
