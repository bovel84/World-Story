/**
 * Q02 µ2 — Protezione single-owner: accesso di un utente diverso, game ID
 * indovinato (enumerazione), settings provider.
 *
 * Il middleware è testato in isolamento (nessun server): verifica che
 * l'handler NON venga mai raggiunto quando il token è richiesto e assente.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  extractOwnerToken,
  getOwnerToken,
  isOwnerRequest,
  ownerAuthMode,
  ownerGuard,
  OWNER_TOKEN_ENV,
} from '../src/security/owner-guard';

const TOKEN = 'owner-token-super-segreto';
const previousToken = process.env[OWNER_TOKEN_ENV];

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function mockRes(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function mockReq(init: { path: string; method?: string; headers?: Record<string, string>; query?: Record<string, unknown> }) {
  return {
    path: init.path,
    method: init.method || 'GET',
    headers: init.headers || {},
    query: init.query || {},
  } as never;
}

describe('Q02 µ2 — guardia single-owner', () => {
  beforeEach(() => {
    delete process.env[OWNER_TOKEN_ENV];
  });
  afterEach(() => {
    if (previousToken === undefined) delete process.env[OWNER_TOKEN_ENV];
    else process.env[OWNER_TOKEN_ENV] = previousToken;
  });

  it('senza token configurato la modalità resta aperta (uso locale invariato)', () => {
    expect(getOwnerToken({})).toBeNull();
    expect(ownerAuthMode({})).toBe('open-single-user');
    const next = vi.fn();
    ownerGuard(mockReq({ path: '/api/games/whatever', method: 'POST' }), mockRes() as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('con token configurato un utente diverso (nessun token) riceve 403 e non tocca l’handler', () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    const next = vi.fn();
    const res = mockRes();
    ownerGuard(mockReq({ path: '/api/games/known-game', method: 'POST' }), res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'owner_token_required' });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('game ID indovinato: la risposta è identica per id esistente e inesistente (niente enumerazione)', () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    const probe = (gameId: string) => {
      const res = mockRes();
      const next = vi.fn();
      ownerGuard(mockReq({ path: `/api/games/${gameId}`, method: 'GET' }), res as never, next);
      return { status: res.statusCode, body: res.body, reached: next.mock.calls.length };
    };
    const existing = probe('1f0d3e2c-real-game');
    const guessed = probe('aaaaaaaa-guessed');
    expect(existing).toEqual(guessed);
    expect(existing.reached).toBe(0);
  });

  it('settings provider: GET e POST su /api/llm/config sono protetti senza token', () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    for (const method of ['GET', 'POST']) {
      const res = mockRes();
      const next = vi.fn();
      ownerGuard(mockReq({ path: '/api/llm/config', method }), res as never, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });

  it('token errato → 403; token corretto (header, Bearer, query SSE) → passa', () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    const wrong = mockRes();
    ownerGuard(
      mockReq({ path: '/api/games/x', method: 'DELETE', headers: { 'x-owner-token': 'sbagliato' } }),
      wrong as never,
      vi.fn(),
    );
    expect(wrong.statusCode).toBe(403);

    for (const req of [
      mockReq({ path: '/api/games/x', method: 'POST', headers: { 'x-owner-token': TOKEN } }),
      mockReq({ path: '/api/games/x', method: 'PATCH', headers: { authorization: `Bearer ${TOKEN}` } }),
      mockReq({ path: '/api/games/x/events', method: 'GET', query: { owner_token: TOKEN } }),
    ]) {
      const next = vi.fn();
      const res = mockRes();
      ownerGuard(req, res as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }
  });

  it('health e risorse statiche restano raggiungibili per i probe di readiness', () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    for (const req of [
      mockReq({ path: '/health' }),
      mockReq({ path: '/api/health' }),
      mockReq({ path: '/assets/index-abc.js' }),
      mockReq({ path: '/' }),
    ]) {
      const next = vi.fn();
      ownerGuard(req, mockRes() as never, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('estrazione del token: header dedicato, Bearer, query; null se assente', () => {
    expect(extractOwnerToken({ headers: { 'x-owner-token': ' abc ' } as never })).toBe('abc');
    expect(extractOwnerToken({ headers: { authorization: 'Bearer  xyz ' } as never })).toBe('xyz');
    expect(extractOwnerToken({ headers: {}, query: { owner_token: 'q1' } } as never)).toBe('q1');
    expect(extractOwnerToken({ headers: {} } as never)).toBeNull();
    expect(isOwnerRequest({ headers: { authorization: 'Basic nope' } as never }, { [OWNER_TOKEN_ENV]: TOKEN } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('la guardia è installata prima dei router (source-contract su index.ts)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
    const guardAt = source.indexOf('app.use(ownerGuard)');
    const routesAt = source.indexOf('registerRoutes(app)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(routesAt).toBeGreaterThan(guardAt);
  });
});

describe('Q02 µ2 — prova integrativa su HTTP reale', () => {
  let server: import('node:http').Server;
  let base: string;
  const handled: string[] = [];

  beforeAll(async () => {
    process.env[OWNER_TOKEN_ENV] = TOKEN;
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use(ownerGuard);
    app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
    app.post('/api/games/:id/actions/process', (req, res) => {
      handled.push(req.params.id);
      res.json({ ok: true, id: req.params.id });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousToken === undefined) delete process.env[OWNER_TOKEN_ENV];
    else process.env[OWNER_TOKEN_ENV] = previousToken;
  });

  it('senza token: 403 sull’endpoint mutante e handler mai raggiunto', async () => {
    const res = await fetch(`${base}/api/games/1f0d3e2c-real/actions/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'owner_token_required' });
    expect(handled).toEqual([]);
  });

  it('game ID indovinato e id esistente sono indistinguibili (nessuna enumerazione)', async () => {
    const request = (id: string) => fetch(`${base}/api/games/${id}/actions/process`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const [guessed, existing] = await Promise.all([request('aaaaaaaa'), request('1f0d3e2c-real')]);
    expect(guessed.status).toBe(403);
    expect(existing.status).toBe(403);
    expect(await guessed.json()).toEqual(await existing.json());
    expect(handled).toEqual([]);
  });

  it('con token corretto l’handler risponde; /health resta aperto', async () => {
    const ok = await fetch(`${base}/api/games/1f0d3e2c-real/actions/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-token': TOKEN },
      body: '{}',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, id: '1f0d3e2c-real' });
    expect(handled).toEqual(['1f0d3e2c-real']);

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
  });
});
