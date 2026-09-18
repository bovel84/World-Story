/**
 * CRISIS-RESIDUAL — migrazione additiva dello stato di crisi per ramo.
 *
 * I salvataggi precedenti tenevano la crisi sulla partita (PK `game_id`). Qui si
 * verifica, su uno schema realmente costruito dal modulo, che la migrazione:
 *  - aggiunga `branch_id` senza perdere una sola riga;
 *  - porti la riga legacy sul **ramo corrente** della partita;
 *  - conservi giorni critici, avvertimenti ed epilogo;
 *  - continui a mostrare una riga rimasta su `main` quando il ramo corrente non
 *    ha ancora il proprio stato (retrocompatibilità di lettura).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-crisis-migration-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let initDatabase: () => void;
const HEAD_BRANCH = 'branch-head-legacy';
const MAIN_ONLY_GAME = 'game-main-only';

/** Forma **precedente** della tabella: la crisi era identificata dal solo game_id. */
const LEGACY_TABLE = `
  CREATE TABLE game_crisis_state (
    game_id TEXT PRIMARY KEY,
    revolt_streak INTEGER NOT NULL DEFAULT 0,
    insolvency_streak INTEGER NOT NULL DEFAULT 0,
    invasion_streak INTEGER NOT NULL DEFAULT 0,
    overall TEXT NOT NULL DEFAULT 'calm',
    ending_kind TEXT,
    ending_dimension TEXT,
    ending_title TEXT,
    ending_summary TEXT,
    ending_date TEXT,
    ending_turn INTEGER,
    updated_turn INTEGER NOT NULL DEFAULT 0,
    updated_date TEXT,
    revolt_episodes INTEGER NOT NULL DEFAULT 0,
    insolvency_episodes INTEGER NOT NULL DEFAULT 0,
    invasion_episodes INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  )
`;

beforeAll(async () => {
  const module = await import('../src/database');
  db = module.default;
  initDatabase = module.initDatabase;
  initDatabase();

  // 1. Torna alla forma precedente e inserisci due partite con la loro crisi.
  db.exec('DROP TABLE game_crisis_state');
  db.exec(LEGACY_TABLE);
  db.exec("INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('w1', 'W', '', '1951-01-01', 'p')");
  db.prepare("INSERT INTO games (id, world_id, current_turn, current_date, head_branch_id) VALUES (?, 'w1', 10, '1951-04-10', ?)").run('game-legacy', HEAD_BRANCH);
  db.prepare("INSERT INTO games (id, world_id, current_turn, current_date, head_branch_id) VALUES (?, 'w1', 3, '1951-01-10', NULL)").run(MAIN_ONLY_GAME);
  db.prepare(`
    INSERT INTO game_crisis_state
      (game_id, revolt_streak, insolvency_streak, invasion_streak, overall,
       ending_kind, ending_dimension, ending_title, ending_summary, ending_date, ending_turn,
       updated_turn, updated_date, revolt_episodes, insolvency_episodes, invasion_episodes)
    VALUES ('game-legacy', 55, 0, 3, 'critical',
       'revolution', 'revolt', 'Il governo è caduto', 'La piazza ha travolto il governo.', '1951-04-10', 10,
       10, '1951-04-10', 2, 0, 1)
  `).run();
  db.prepare(`
    INSERT INTO game_crisis_state
      (game_id, revolt_streak, insolvency_streak, invasion_streak, overall, updated_turn, updated_date)
    VALUES (?, 12, 0, 0, 'watch', 3, '1951-01-10')
  `).run(MAIN_ONLY_GAME);

  // 2. La migrazione gira all'avvio del database.
  initDatabase();
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch { /* tmp */ }
});

describe('CRISIS-RESIDUAL — migrazione additiva dello stato di crisi', () => {
  it('la tabella è per (partita, ramo) e nessuna riga è andata perduta', () => {
    const columns = db.prepare('PRAGMA table_info(game_crisis_state)').all() as Array<{ name: string; pk: number }>;
    expect(columns.some(column => column.name === 'branch_id')).toBe(true);
    const pk = columns.filter(column => column.pk > 0).map(column => column.name).sort();
    expect(pk).toEqual(['branch_id', 'game_id']);
    expect(Number(db.prepare('SELECT COUNT(*) AS n FROM game_crisis_state').get().n)).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'game_crisis_state_legacy'").get().n).toBe(0);
  });

  it('la crisi legacy passa al ramo corrente con giorni, avvertimenti ed epilogo intatti', async () => {
    const repos = await import('../src/repositories');
    const row = repos.gameRepository.getCrisisState('game-legacy')!;
    expect(row.branchId).toBe(HEAD_BRANCH);
    expect(row.criticalDays).toEqual({ revolt: 55, insolvency: 0, invasion: 3 });
    expect(row.episodes).toEqual({ revolt: 2, insolvency: 0, invasion: 1 });
    expect(row.overall).toBe('critical');
    expect(row.updatedDate).toBe('1951-04-10');
    expect(row.updatedTurn).toBe(10);
    expect(row.ending?.title).toBe('Il governo è caduto');
  });

  it('una riga rimasta su main resta leggibile finché il ramo non scrive la sua', async () => {
    const repos = await import('../src/repositories');
    // La partita non aveva un ramo al momento della migrazione: la riga vive su main.
    expect((db.prepare("SELECT branch_id FROM game_crisis_state WHERE game_id = ?").get(MAIN_ONLY_GAME) as any).branch_id).toBe('main');
    const row = repos.gameRepository.getCrisisState(MAIN_ONLY_GAME)!;
    expect(row.criticalDays.revolt).toBe(12);
    expect(row.branchId).toBe('main');
  });
});
