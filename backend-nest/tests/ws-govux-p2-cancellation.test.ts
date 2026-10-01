import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http, { type Server, type ServerResponse } from 'node:http';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LLMRouter } from '../src/llm/router';
import { ALL_MECHANICS } from '../src/llm/types';
import type { LLMConfig } from '../src/llm/config';

// Set before importing database, registry or routes; never use the working DB.
const TEST_DB = path.join(os.tmpdir(), `ws-govux-p2-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

type Exchange = {
  res: ServerResponse;
  body: any;
  closed: boolean;
  finished: boolean;
};
const exchanges: Exchange[] = [];
const routeRequests: Array<{ req: any; res: any; abortedListeners: number; closeListeners: number; lateWrites: number }> = [];
let providerServer: Server;
let apiServer: Server;
let apiUrl: string;
let providerUrl: string;
let db: any;
let session: any;
let gameId: string;
let holdHeaders = false;
let finishImmediately = false;
let silentSSE = false;
let providerHeaders = 0;
const providerSignals: AbortSignal[] = [];
const callerSignals: AbortSignal[] = [];

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(predicate(), label).toBe(true);
}
function sendFrame(res: ServerResponse, text: string): void {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}
function startRequest(stream = true) {
  const request = http.request(`${apiUrl}/${gameId}/government/minister/tesoro${stream ? '/stream' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  });
  const completed = new Promise<{ status: number; text: string }>((resolve, reject) => {
    request.on('response', response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, text }));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
  // An intentional disconnect rejects the client, not the test runner.
  void completed.catch(() => {});
  request.end(JSON.stringify({ message: 'Come procede?', history: [] }));
  return { request, completed };
}
function expectRouteClean(index: number): void {
  const observed = routeRequests[index];
  expect(observed.req.listenerCount('aborted')).toBe(observed.abortedListeners);
  expect(observed.res.listenerCount('close')).toBe(observed.closeListeners);
  expect(observed.lateWrites).toBe(0);
}

beforeAll(async () => {
  providerServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const exchange: Exchange = { res, body: JSON.parse(raw), closed: false, finished: false };
      exchanges.push(exchange);
      res.on('close', () => { exchange.closed = true; });
      res.on('finish', () => { exchange.finished = true; });
      if (holdHeaders) return;
      res.setHeader('Content-Type', exchange.body.stream ? 'text/event-stream' : 'application/json');
      res.flushHeaders();
      if (exchange.body.stream) {
        if (!silentSSE) sendFrame(res, 'Consiglio verificato');
        if (finishImmediately) res.end('data: [DONE]\n\n');
      } else if (finishImmediately) {
        res.end(JSON.stringify({ choices: [{ message: { content: 'Consiglio verificato' }, finish_reason: 'stop' }] }));
      } else {
        // A JSON body that has started but never completes, like a live SSE body.
        res.write('{"choices":[');
      }
    });
  });
  providerUrl = await listen(providerServer);
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const local = String(input).startsWith(providerUrl);
    if (local && init?.signal) providerSignals.push(init.signal);
    return realFetch(input, init).then(response => {
      if (local) providerHeaders++;
      return response;
    });
  });

  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  const mechanics = Object.fromEntries(ALL_MECHANICS.map(mechanic => [mechanic, {
    provider: 'openai-compatible', baseUrl: `${providerUrl}/v1`, apiKey: '', model: 'local-fixture',
    timeoutMs: 10_000, retries: 2, stream: true, cache: false,
  }])) as LLMConfig;
  const llm = new LLMRouter({ mechanics, consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 } });
  const generate = llm.generate.bind(llm);
  vi.spyOn(llm, 'generate').mockImplementation((...args) => {
    if (args[3]?.signal) callerSignals.push(args[3].signal);
    return generate(...args);
  });
  const stream = llm.stream.bind(llm);
  vi.spyOn(llm, 'stream').mockImplementation((...args) => {
    if (args[4]?.signal) callerSignals.push(args[4].signal);
    return stream(...args);
  });
  registryModule.initSessionRegistry(llm);
  repos.worldRepository.createWithRegions(
    { id: 'govux_p2_world', name: 'P2 World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{ id: 'govux_p2_world_ITA', name: 'Italia', color: '#FF0000', owner: 'ITA', population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true, borders: [], objects: [] }],
  );
  ({ session, gameId } = registryModule.getSessionRegistry().createSession('govux_p2_world', 'Player', 'govux_p2_world_ITA', '#FF0000'));
  repos.gameRepository.ensureMainBranch(gameId);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const observed = { req, res, abortedListeners: req.listenerCount('aborted'), closeListeners: res.listenerCount('close'), lateWrites: 0 };
    routeRequests.push(observed);
    for (const method of ['write', 'end', 'json'] as const) {
      const original = (res as any)[method];
      (res as any)[method] = function (...args: any[]) {
        if (res.destroyed && !res.writableFinished) observed.lateWrites++;
        return original.apply(this, args);
      };
    }
    next();
  });
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const router = express.Router();
  registerAdvisorRoutes(router);
  app.use(router);
  apiServer = http.createServer(app);
  apiUrl = await listen(apiServer);
});

afterEach(() => {
  holdHeaders = false;
  finishImmediately = false;
  silentSSE = false;
  for (const exchange of exchanges) if (!exchange.closed) exchange.res.destroy();
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const server of [apiServer, providerServer]) {
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

describe('WS-GOVUX P2: real HTTP disconnect cancels the minister provider', () => {
  it.each(['before headers', 'after SSE headers and first token', 'after headers with an empty live SSE body'] as const)('closes the provider socket %s, without retry, LLM fallback or response writes', async phase => {
    holdHeaders = phase === 'before headers';
    silentSSE = phase === 'after headers with an empty live SSE body';
    const headersIndex = providerHeaders;
    const exchangeIndex = exchanges.length;
    const routeIndex = routeRequests.length;
    let tokens = 0;
    let settled = false;
    const original = session.getMinisterStream.bind(session);
    const spy = vi.spyOn(session, 'getMinisterStream').mockImplementation(async (...args: any[]) => {
      const onToken = args[3];
      args[3] = (...tokenArgs: any[]) => { tokens++; onToken(...tokenArgs); };
      try { return await original(...args); } finally { settled = true; }
    });
    try {
      const client = startRequest();
      await until(() => exchanges.length > exchangeIndex, 'local provider received the real minister prompt');
      expect(exchanges[exchangeIndex].body.messages[1].content).toContain('Come procede?');
      if (!holdHeaders) {
        await until(() => providerHeaders > headersIndex, 'real fetch returned provider headers');
        if (!silentSSE) await until(() => tokens > 0, 'real adapter consumed SSE after fetch returned headers');
      }
      client.request.destroy();
      await until(() => exchanges[exchangeIndex].closed, 'provider body/socket closed by client cancellation');
      await until(() => settled, 'real minister promise settled after cancellation');
      expect(exchanges[exchangeIndex].finished).toBe(false);
      expect(exchanges.length).toBe(exchangeIndex + 1);
      expectRouteClean(routeIndex);
    } finally { spy.mockRestore(); }
  });

  it.each([false, true])('cancels a live JSON provider body (legacy streaming fallback: %s)', async legacyFallback => {
    const original = session.getMinisterStream;
    if (legacyFallback) session.getMinisterStream = undefined;
    const exchangeIndex = exchanges.length;
    const routeIndex = routeRequests.length;
    try {
      const client = startRequest(legacyFallback);
      await until(() => exchanges.length > exchangeIndex, 'JSON provider started');
      expect(exchanges[exchangeIndex].body.stream).toBeUndefined();
      await until(() => providerSignals.length > 0, 'fetch started');
      // Give the JSON reader time to consume the incomplete body after headers.
      await new Promise(resolve => setTimeout(resolve, 30));
      client.request.destroy();
      await until(() => exchanges[exchangeIndex].closed, 'JSON provider body closed');
      await until(() => routeRequests[routeIndex].req.listenerCount('aborted') === routeRequests[routeIndex].abortedListeners, 'request cleanup completed');
      expect(exchanges.length).toBe(exchangeIndex + 1);
      expectRouteClean(routeIndex);
    } finally { session.getMinisterStream = original; }
  });

  it('pre-aborted minister calls never reach the provider, for stream and generate', async () => {
    const controller = new AbortController();
    controller.abort();
    const count = exchanges.length;
    const calls = [
      () => session.getMinisterStream('tesoro', 'Annullata', [], () => {}, controller.signal),
      () => session.getMinisterReply('tesoro', 'Annullata', [], controller.signal),
    ];
    for (const call of calls) {
      const outcome = call().then(() => 'resolved', () => 'rejected');
      expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('still running'), 100))])).toBe('rejected');
    }
    expect(exchanges.length).toBe(count);
  });

  it('a disconnected stream does not cancel another live request on the same session', async () => {
    const exchangeIndex = exchanges.length;
    const routeIndex = routeRequests.length;
    const first = startRequest();
    await until(() => exchanges.length === exchangeIndex + 1, 'first provider request started');
    const second = startRequest();
    await until(() => exchanges.length === exchangeIndex + 2, 'second provider request started');
    first.request.destroy();
    await until(() => exchanges[exchangeIndex].closed, 'only disconnected provider closed');
    expect(exchanges[exchangeIndex + 1].closed).toBe(false);
    exchanges[exchangeIndex + 1].res.end('data: [DONE]\n\n');
    expect(await second.completed).toEqual({ status: 200, text: 'Consiglio verificato' });
    await until(() => routeRequests[routeIndex].req.listenerCount('aborted') === routeRequests[routeIndex].abortedListeners, 'cancelled request cleanup completed');
    expectRouteClean(routeIndex);
    expectRouteClean(routeIndex + 1);
  });

  it('normal completion keeps callbacks, cleans listeners and does not abort this or the next request', async () => {
    finishImmediately = true;
    const index = routeRequests.length;
    const signalIndex = providerSignals.length;
    const callerIndex = callerSignals.length;
    for (const stream of [true, false, true]) {
      const client = startRequest(stream);
      const response = await client.completed;
      expect(response.status).toBe(200);
      expect(response.text).toContain('Consiglio verificato');
    }
    await new Promise(resolve => setImmediate(resolve));
    for (let i = index; i < routeRequests.length; i++) expectRouteClean(i);
    expect(providerSignals.length).toBe(signalIndex + 3);
    for (const signal of providerSignals.slice(signalIndex)) {
      expect(signal.aborted).toBe(false);
    }
    // Count application-owned listeners on the caller signal. Node 22's
    // native fetch keeps its own listener on the composed transport signal
    // until GC, unlike Node 26; that is not a listener installed by our code.
    expect(callerSignals.length).toBe(callerIndex + 3);
    for (const signal of callerSignals.slice(callerIndex)) {
      expect(signal.aborted).toBe(false);
      expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    }
  });
});
