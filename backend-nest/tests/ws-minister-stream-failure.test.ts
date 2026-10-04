import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MinisterMemoryRecord, MinisterMemoryScope } from '../src/core/government/MinisterMemory';

// Configure an isolated database before importing routes, repositories or sessions.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-minister-stream-failure-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
const originalJev = process.env.JEV_MEMORY_ENABLED;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'test.sqlite');
process.env.JEV_MEMORY_ENABLED = 'true';

const message = 'Confrontiamo la tutela dei porti.';
const decisionReply = 'Propongo prima una verifica delle coperture.\n\n```decision\n'
  + JSON.stringify({ objective: 'Tutelare i porti', constraints: ['Nessuna spesa autorizzata'], unresolved: ['Verificare le coperture'] })
  + '\n```';
const requestMemory: MinisterMemoryRecord = {
  id: 'existing-request-objective', kind: 'objective', state: 'open',
  summary: 'Il presidente vuole discutere la tutela dei porti.',
  refs: { messageId: 'earlier-message', gameDate: '1951-01-01', turn: 1 },
};
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { throw new Error('Unexpected provider generation'); },
  async stream() { throw new Error('Unexpected provider stream'); },
  clearCache() {},
};
let db: any;
let session: any;
let server: Server;
let url: string;
let scope: MinisterMemoryScope;
let ministerMemory: typeof import('../src/repositories/minister-memory.repository').ministerMemoryRepository;
let jevMemory: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function post(signal?: AbortSignal) {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: [], memory: [requestMemory] }), signal,
  });
}
function expectOnlyRequestMemory(): void {
  // Request memories are saved before generation; a failed reply must not add any.
  expect(ministerMemory.listMemory(scope)).toEqual([requestMemory]);
  expect(jevMemory.listMemory({ kind: 'minister', ...scope })).toEqual([]);
  expect(session.getMinisterReply).not.toHaveBeenCalled();
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repositories = await import('../src/repositories');
  ministerMemory = repositories.ministerMemoryRepository;
  jevMemory = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  repositories.worldRepository.createWithRegions(
    { id: 'stream-failure-world', name: 'Stream Failure World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{ id: 'stream-failure-world-ITA', name: 'Italia', color: '#112233', owner: 'ITA', population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true, borders: [], objects: [] }],
  );
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession('stream-failure-world', 'Player', 'stream-failure-world-ITA', '#112233'));
  repositories.gameRepository.ensureMainBranch(session.id);
  const { mandateFor } = await import('../src/core/government/MinisterMemory');
  scope = {
    gameId: session.id, branchId: session.fenceContext().branchId, seat: 'tesoro',
    mandate: mandateFor('tesoro', session.getGovernment(), session.getPlayer()?.polityId ?? null),
  };
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerAdvisorRoutes(router);
  app.use('/api/games', router);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}/api/games/${session.id}/government/minister/tesoro/stream`;
});

beforeEach(() => {
  db.prepare('DELETE FROM minister_memory WHERE game_id = ?').run(session.id);
  db.prepare('DELETE FROM jev_memory WHERE game_id = ?').run(session.id);
  vi.spyOn(session, 'getMinisterReply').mockResolvedValue({ reply: 'Unexpected fallback success', seat: 'tesoro' });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalJev === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalJev;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('minister stream HTTP failure contract', () => {
  it('buffers a complete-looking decision block until provider success, without persisting a failed reply', async () => {
    const failProvider = latch();
    const tokenEmitted = latch();
    vi.spyOn(session, 'getMinisterStream').mockImplementation(async (
      _seat: string, _message: string, _history: unknown[], onToken: (text: string) => void,
    ) => {
      onToken(decisionReply);
      tokenEmitted.resolve();
      await failProvider.promise;
      throw new Error('Provider failed after the decision block');
    });
    let settled = false;
    const pending = post().then(response => { settled = true; return response; });
    await tokenEmitted.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    failProvider.resolve();
    const response = await pending;
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(decisionReply);
    expectOnlyRequestMemory();
  });

  it('keeps normal streamed completion and persists only the completed JEV exchange', async () => {
    let providerSignal: AbortSignal | undefined;
    vi.spyOn(session, 'getMinisterStream').mockImplementation(async (
      _seat: string, _message: string, _history: unknown[], onToken: (text: string) => void, signal: AbortSignal,
    ) => {
      providerSignal = signal;
      onToken(decisionReply.slice(0, 30));
      onToken(decisionReply.slice(30));
      return decisionReply;
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(decisionReply);
    expect(providerSignal?.aborted).toBe(false);
    expect(session.getMinisterReply).not.toHaveBeenCalled();
    expect(ministerMemory.listMemory(scope)).toEqual([requestMemory]);
    const records = jevMemory.listMemory({ kind: 'minister', ...scope });
    expect(records).toHaveLength(1);
    expect(records[0].text).toContain(message);
    expect(records[0].text).toContain(decisionReply);
  });

  it('still propagates client cancellation and ignores late tokens and replies without persisting them', async () => {
    const providerCancelled = latch();
    const tokenEmitted = latch();
    let providerSignal: AbortSignal | undefined;
    vi.spyOn(session, 'getMinisterStream').mockImplementation(async (
      _seat: string, _message: string, _history: unknown[], onToken: (text: string) => void, signal: AbortSignal,
    ) => {
      providerSignal = signal;
      onToken(decisionReply);
      tokenEmitted.resolve();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      onToken('Late token must not be sent');
      providerCancelled.resolve();
      return decisionReply;
    });
    const controller = new AbortController();
    const pending = post(controller.signal);
    await tokenEmitted.promise;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await providerCancelled.promise;
    // Drain the route continuation after the provider returns its late reply.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(providerSignal?.aborted).toBe(true);
    expectOnlyRequestMemory();
  });

  it('keeps an ordinary JSON error when the provider fails before emitting text', async () => {
    vi.spyOn(session, 'getMinisterStream').mockRejectedValue(new Error('Provider failed before any token'));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to stream minister reply' });
    expectOnlyRequestMemory();
  });
});
