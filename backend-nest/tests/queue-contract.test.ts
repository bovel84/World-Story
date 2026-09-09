/** F01: consegna/attuazione e queueVersion senza avanzare il mondo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-queue-contract-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let gameRepository: any;
let initDatabase: () => void;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  initDatabase = database.initDatabase;
  database.initDatabase();
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('queue-world', 'Queue', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES ('queue-game', 'queue-world', 1, '1951-01-01')`).run();
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

describe('F01 queue contract', () => {
  it('separa queued/not_started da issued/in_progress e incrementa queueVersion', () => {
    expect(gameRepository.getQueueVersion('queue-game')).toBe(0);
    gameRepository.queuePendingAction({
      id: 'queue-action', gameId: 'queue-game', text: 'Ordine', createdAt: '1951-01-01T00:00:00.000Z',
    });
    expect(gameRepository.getQueueVersion('queue-game')).toBe(1);
    expect(gameRepository.getPendingActions('queue-game')).toEqual([
      expect.objectContaining({
        id: 'queue-action', status: 'pending', deliveryStatus: 'queued', executionStatus: 'not_started',
      }),
    ]);

    gameRepository.updatePendingActionStatus('queue-game', ['queue-action'], 'processing');
    expect(gameRepository.getQueueVersion('queue-game')).toBe(2);
    expect(gameRepository.getPendingActions('queue-game')).toEqual([
      expect.objectContaining({
        id: 'queue-action', status: 'processing', deliveryStatus: 'issued', executionStatus: 'in_progress',
      }),
    ]);
  });

  it('non incrementa queueVersion quando nessun ordine viene modificato', () => {
    const before = gameRepository.getQueueVersion('queue-game');
    gameRepository.updatePendingActionStatus('queue-game', ['missing-action'], 'pending');
    expect(gameRepository.getQueueVersion('queue-game')).toBe(before);
  });

  it('persistenza backward compatible: le migrazioni additive risanano uno schema pre-F01', () => {
    // Emula un DB creato prima di F01: senza colonne nuove, con righe legacy.
    // Il valore di status è allora l’unica fonte della consegna/attuazione.
    db.exec('ALTER TABLE pending_actions DROP COLUMN delivery_status');
    db.exec('ALTER TABLE pending_actions DROP COLUMN execution_status');
    db.exec('ALTER TABLE games DROP COLUMN queue_version');
    const insertLegacy = db.prepare(`
      INSERT INTO pending_actions (id, game_id, text, created_at, status)
      VALUES (?, 'queue-game', ?, '1951-01-01T00:00:00.000Z', ?)
    `);
    insertLegacy.run('legacy-processing', 'Ordine emesso legacy', 'processing');
    insertLegacy.run('legacy-completed', 'Ordine completato legacy', 'completed');
    insertLegacy.run('legacy-pending', 'Ordine in coda legacy', 'pending');

    // initDatabase è idempotente: reinstalla le colonne e riallinea gli stati.
    initDatabase();

    const rows = db.prepare(
      'SELECT id, status, delivery_status, execution_status FROM pending_actions WHERE game_id = ? ORDER BY id'
    ).all('queue-game') as Array<{ id: string; status: string; delivery_status: string; execution_status: string }>;
    const byId = new Map(rows.map(row => [row.id, row]));
    expect(byId.get('legacy-processing')).toMatchObject({ delivery_status: 'issued', execution_status: 'in_progress' });
    expect(byId.get('legacy-completed')).toMatchObject({ delivery_status: 'issued', execution_status: 'completed' });
    expect(byId.get('legacy-pending')).toMatchObject({ delivery_status: 'queued', execution_status: 'not_started' });
    expect(gameRepository.getQueueVersion('queue-game')).toBe(0);

    // La coda resta operativa dopo la ri-migrazione.
    gameRepository.queuePendingAction({
      id: 'post-migration-action', gameId: 'queue-game', text: 'Ordine post-migrazione', createdAt: '1951-01-02T00:00:00.000Z',
    });
    expect(gameRepository.getQueueVersion('queue-game')).toBe(1);
    expect(gameRepository.getPendingActions('queue-game')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy-processing', deliveryStatus: 'issued', executionStatus: 'in_progress' }),
      expect.objectContaining({ id: 'post-migration-action', deliveryStatus: 'queued', executionStatus: 'not_started' }),
    ]));
  });
});
