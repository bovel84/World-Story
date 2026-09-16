import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { validateBody } from '../src/routes/validation';
import { createGameSchema, timeSkipSchema, queueActionSchema } from '../src/routes/games/schemas';

/** Fake minimale di `res` che cattura status + payload. */
function fakeRes(): { res: Response; result: () => { status: number; payload: unknown } } {
  let status = 200;
  let payload: unknown = undefined;
  const res = {
    status(code: number) { status = code; return this; },
    json(body: unknown) { payload = body; return this; },
  } as unknown as Response;
  return { res, result: () => ({ status, payload }) };
}

describe('Fase 6 — validateBody', () => {
  it('restituisce i dati normalizzati quando il body è valido', () => {
    const { res, result } = fakeRes();
    const parsed = validateBody(res, queueActionSchema, { text: '  Costruisci una scuola  ' });
    expect(parsed).toEqual({ text: 'Costruisci una scuola' });
    expect(result().payload).toBeUndefined();
  });

  it('risponde 400 invalid_body con i dettagli sugli errori', () => {
    const { res, result } = fakeRes();
    const parsed = validateBody(res, queueActionSchema, { text: '' });
    expect(parsed).toBeNull();
    const { status, payload } = result();
    expect(status).toBe(400);
    expect(payload).toMatchObject({ code: 'invalid_body' });
    expect((payload as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it('considera `undefined` come corpo vuoto, non come crash', () => {
    const { res, result } = fakeRes();
    expect(validateBody(res, queueActionSchema, undefined)).toBeNull();
    expect(result().status).toBe(400);
  });
});

describe('Fase 6 — schemi games', () => {
  it('createGameSchema accetta gli alias snake_case e rifiuta la partita senza mondo', () => {
    expect(createGameSchema.safeParse({ world_id: 'w', player_region_id: 'r' }).success).toBe(true);
    expect(createGameSchema.safeParse({ player_region_id: 'r' }).success).toBe(false);
    expect(createGameSchema.safeParse({ world_id: 'w' }).success).toBe(false);
  });

  it('timeSkipSchema accetta solo jump_days numerici e mode canonici', () => {
    expect(timeSkipSchema.safeParse({ jump_days: 30 }).success).toBe(true);
    expect(timeSkipSchema.safeParse({ mode: 'next_event' }).success).toBe(true);
    expect(timeSkipSchema.safeParse({ jump_days: '30' }).success).toBe(false);
    expect(timeSkipSchema.safeParse({ mode: 'altro' }).success).toBe(false);
  });
});

describe('Fase 6 — validazione cablata nelle route', () => {
  interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (a: unknown, b: unknown) => void }> } }
  function callRoute(method: 'post' | 'put', routePath: string, body: unknown): Promise<{ status: number; payload: any }> {
    return new Promise(async (resolve, reject) => {
      const router = (await import('../src/routes/games.routes')).gamesRouter as unknown as { stack: Layer[] };
      const req = { method: method.toUpperCase(), params: { id: 'missing-game' }, body, get: () => undefined };
      const res = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: unknown) { resolve({ status: this.statusCode, payload }); },
        set() { return this; },
      };
      for (const layer of router.stack) {
        if (layer.route?.path === routePath && layer.route.methods[method]) {
          layer.route.stack[layer.route.stack.length - 1]?.handle(req, res);
          return;
        }
      }
      reject(new Error(`route mancante: ${method} ${routePath}`));
    });
  }

  it('POST /games senza mondo → 400 invalid_body prima di toccare il DB', async () => {
    const r = await callRoute('post', '/', {});
    expect(r.status).toBe(400);
    expect(r.payload).toMatchObject({ code: 'invalid_body' });
  });

  it('POST /:id/time-skip con jump_days non numerico → 400 invalid_body', async () => {
    const r = await callRoute('post', '/:id/time-skip', { jump_days: 'novanta' });
    expect(r.status).toBe(400);
    expect(r.payload).toMatchObject({ code: 'invalid_body' });
  });
});
