/** P5 — ricevuta durevole: HTTP reale, GameSession e SQLite temporaneo. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const databasePath = path.join(os.tmpdir(), `govux-p5-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = databasePath;
const stub: any = { consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, generate: async () => ({ content: 'ok' }), stream: async () => ({ content: 'ok' }) };
let db: any, initDatabase: any, registry: any, repository: any;
let server: http.Server, base: string, gameId: string, session: any;
let sequence = 0;

async function boot(createWorld = false) {
  const database = await import('../src/database');
  db = database.default; initDatabase = database.initDatabase; initDatabase();
  const { worldRepository } = await import('../src/repositories/world.repository');
  repository = (await import('../src/repositories/game.repository')).gameRepository;
  const { initSessionRegistry } = await import('../src/session-registry');
  if (createWorld) worldRepository.createWithRegions({ id: 'p5-world', name: 'P5', startDate: '2000-01-01' }, [{ id: 'r1', name: 'Regione', owner: 'p1', color: '#333333', population: 1000, economy: 100, army: 10, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }]);
  registry = initSessionRegistry(stub);
  const { registerActionsRoutes } = await import('../src/routes/games/actions.routes');
  const router = express.Router(); registerActionsRoutes(router);
  const app = express(); app.use(express.json()); app.use('/api/games', router);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/games`;
}
beforeAll(() => boot(true));
beforeEach(() => {
  const created = registry.createSession('p5-world', `P5-${++sequence}`, 'r1');
  gameId = created.gameId; session = registry.getSessionOrThrow(gameId);
});
afterAll(async () => {
  if (server?.listening) await new Promise<void>(resolve => { server.close(resolve); server.closeAllConnections(); });
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(databasePath + suffix, { force: true });
});
async function sign(key?: string, text = 'Ordine firmato', game = gameId, extra: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/${game}/actions/queue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) }, body: JSON.stringify({ text, ...extra }),
  });
  return { status: response.status, body: await response.json() as any };
}
function receiptCount(game = gameId) {
  return db.prepare('SELECT count(*) AS n FROM action_signature_receipts WHERE game_id = ?').get(game).n;
}
function pendingCount() { return repository.getPendingActions(gameId).length; }

describe('P5 firma durevole', () => {
  it('stessa key: due POST concorrenti, un actionId, un ordine, una ricevuta, un solo bump', async () => {
    const before = repository.getQueueVersion(gameId);
    const [first, second] = await Promise.all([sign('firma-1'), sign('firma-1')]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.id).toBe(second.body.id);
    expect([first.body.replayed, second.body.replayed].sort()).toEqual([false, true]);
    expect(pendingCount()).toBe(1); expect(session.getPendingActions()).toHaveLength(1);
    expect(receiptCount()).toBe(1); expect(repository.getQueueVersion(gameId)).toBe(before + 1);
  });
  it('risposta persa e nuova sessione: replica la conferma anche con nuova connessione SQLite', async () => {
    const accepted = await sign('persa'); // il client non usa la conferma
    await new Promise<void>(resolve => { server.close(resolve); server.closeAllConnections(); });
    db.close();
    vi.resetModules();
    await boot();
    session = registry.getSessionOrThrow(gameId);
    const Database = (await import('better-sqlite3')).default;
    const restartedConnection = new Database(databasePath);
    try { expect(restartedConnection.prepare('SELECT action_id FROM action_signature_receipts WHERE game_id=? AND request_key=?').get(gameId, 'persa')).toEqual({ action_id: accepted.body.id }); }
    finally { restartedConnection.close(); }
    const retry = await sign('persa');
    expect(retry.body).toEqual({ ...accepted.body, replayed: true });
    expect(pendingCount()).toBe(1); expect(receiptCount()).toBe(1);
  });
  it('stessa key e payload diverso: conflitto, nessuna nuova firma', async () => {
    const accepted = await sign('immutabile');
    const version = repository.getQueueVersion(gameId);
    const retry = await sign('immutabile', 'Altro testo');
    expect(retry.status).toBe(409); expect(retry.body.code).toBe('idempotency_conflict');
    expect(repository.getQueueVersion(gameId)).toBe(version);
    expect(repository.getPendingActions(gameId).map((a: any) => a.id)).toEqual([accepted.body.id]);
  });
  it('hash canonico comprende la distinta e non dipende dall’ordine delle proprietà', async () => {
    const work = { workId: 'road', payerActorId: 'state', materialActorId: 'state', funded: true };
    const first = await sign('opera', 'Opera', gameId, { work });
    const retry = await sign('opera', 'Opera', gameId, { work: { funded: true, materialActorId: 'state', payerActorId: 'state', workId: 'road' } });
    expect(retry.body.id).toBe(first.body.id); expect(retry.body.replayed).toBe(true);
    expect((await sign('opera', 'Opera', gameId, { work: { ...work, funded: false } })).status).toBe(409);
    expect(repository.getPendingActions(gameId)[0].workOrder).toEqual(work);
  });
  it('nuova key con stesso testo è una firma intenzionalmente distinta', async () => {
    const first = await sign('a'); const second = await sign('b');
    expect(first.body.id).not.toBe(second.body.id); expect(pendingCount()).toBe(2); expect(receiptCount()).toBe(2);
  });
  it('replay dopo revoca non resuscita l’ordine e non incrementa la versione', async () => {
    const first = await sign('revocata');
    expect((await fetch(`${base}/${gameId}/actions/queue/${first.body.id}`, { method: 'DELETE' })).status).toBe(200);
    const version = repository.getQueueVersion(gameId);
    const retry = await sign('revocata');
    expect(retry.body.id).toBe(first.body.id); expect(retry.body.replayed).toBe(true);
    expect(pendingCount()).toBe(0); expect(session.getPendingActions()).toHaveLength(0);
    expect(receiptCount()).toBe(1); expect(repository.getQueueVersion(gameId)).toBe(version);
  });
  it('eliminazione da esecuzione/restore non elimina la ricevuta', async () => {
    const first = await sign('storica');
    repository.removePendingActions(gameId, [first.body.id]);
    repository.replacePendingActions(gameId, []);
    registry.removeSession(gameId); session = registry.getSessionOrThrow(gameId);
    const version = repository.getQueueVersion(gameId);
    expect((await sign('storica')).body.id).toBe(first.body.id);
    expect(pendingCount()).toBe(0); expect(receiptCount()).toBe(1); expect(repository.getQueueVersion(gameId)).toBe(version);
  });
  it('la modifica del testo in coda non altera l’hash originale della firma', async () => {
    const first = await sign('editata');
    expect(session.updatePendingAction(first.body.id, 'Testo corretto nel registro')).not.toBeNull();
    expect((await sign('editata')).body.id).toBe(first.body.id);
    expect(repository.getPendingActions(gameId)[0].text).toBe('Testo corretto nel registro');
  });
  it('chiave isolata per partita e client legacy senza key compatibile', async () => {
    await sign('globale');
    const other = registry.createSession('p5-world', 'Altro', 'r1').gameId;
    expect((await sign('globale', 'Ordine firmato', other)).status).toBe(200);
    expect(receiptCount(other)).toBe(1);
    const legacy = await sign(); expect(legacy.status).toBe(200); expect(legacy.body.replayed).toBeUndefined();
    expect(receiptCount()).toBe(1); expect(pendingCount()).toBe(2);
  });
  it('key vuota o troppo lunga: 400 prima di mutare la coda', async () => {
    expect((await sign(' ')).status).toBe(400);
    expect((await sign('x'.repeat(129))).status).toBe(400);
    expect(pendingCount()).toBe(0); expect(receiptCount()).toBe(0);
  });
  it('failure tra ordine e ricevuta: rollback DB, versione e coda RAM; retry possibile', async () => {
    const version = repository.getQueueVersion(gameId);
    db.exec("CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON action_signature_receipts BEGIN SELECT RAISE(ABORT, 'fault receipt'); END");
    try {
      expect((await sign('rollback')).status).toBe(500);
      expect(pendingCount()).toBe(0); expect(receiptCount()).toBe(0);
      expect(session.getPendingActions()).toHaveLength(0); expect(repository.getQueueVersion(gameId)).toBe(version);
    } finally { db.exec('DROP TRIGGER fail_receipt'); }
    expect((await sign('rollback')).status).toBe(200); expect(pendingCount()).toBe(1); expect(receiptCount()).toBe(1);
  });
  it('failure nell’inserimento dell’ordine: RAM e DB tornano alla coda precedente', async () => {
    const previous = await sign('preesistente');
    const version = repository.getQueueVersion(gameId);
    db.exec("CREATE TEMP TRIGGER fail_pending BEFORE INSERT ON pending_actions BEGIN SELECT RAISE(ABORT, 'fault pending'); END");
    try {
      expect((await sign('pending-failure')).status).toBe(500);
      expect(session.getPendingActions().map((a: any) => a.id)).toEqual([previous.body.id]);
      expect(repository.getPendingActions(gameId).map((a: any) => a.id)).toEqual([previous.body.id]);
      expect(receiptCount()).toBe(1); expect(repository.getQueueVersion(gameId)).toBe(version);
    } finally { db.exec('DROP TRIGGER fail_pending'); }
  });
  it('failure al COMMIT: rollback anche della pubblicazione RAM', async () => {
    const version = repository.getQueueVersion(gameId);
    db.exec("CREATE TABLE test_deferred_failure (game_id TEXT REFERENCES games(id) DEFERRABLE INITIALLY DEFERRED); CREATE TEMP TRIGGER fail_commit AFTER INSERT ON action_signature_receipts BEGIN INSERT INTO test_deferred_failure VALUES ('missing'); END");
    try {
      expect((await sign('commit-failure')).status).toBe(500);
      expect(pendingCount()).toBe(0); expect(receiptCount()).toBe(0);
      expect(session.getPendingActions()).toHaveLength(0); expect(repository.getQueueVersion(gameId)).toBe(version);
    } finally { db.exec('DROP TRIGGER fail_commit; DROP TABLE test_deferred_failure'); }
  });
  it('migrazione del database legacy lascia intatti ordini e queueVersion', async () => {
    const legacy = await sign(); const version = repository.getQueueVersion(gameId);
    db.exec('DROP TABLE action_signature_receipts'); // solo DB temporaneo del test
    initDatabase();
    expect(repository.getPendingActions(gameId)[0].id).toBe(legacy.body.id);
    expect(repository.getQueueVersion(gameId)).toBe(version); expect(receiptCount()).toBe(0);
    expect((await sign('post-migration')).status).toBe(200);
  });
  it('migrazione ripetibile, ricevuta eliminata solo con la partita', async () => {
    await sign('migrazione'); initDatabase(); initDatabase();
    expect(receiptCount()).toBe(1);
    db.prepare('DELETE FROM games WHERE id=?').run(gameId);
    expect(receiptCount()).toBe(0);
  });
});
