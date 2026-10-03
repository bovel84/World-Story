import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameApi, ministerApi } from './api';
afterEach(() => vi.unstubAllGlobals());

describe('GOVUX trasporto firma/cancellazione', () => {
  it('due retry conservano la stessa identità di firma e dichiarazione di lavoro', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'accepted' })));
    vi.stubGlobal('fetch', fetchMock);
    const work = { workId: 'road', payerActorId: 'state', materialActorId: 'state', funded: true };
    await gameApi.queueAction('game', 'Testo', work, 'signature-key');
    await gameApi.queueAction('game', 'Testo', work, 'signature-key');
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({ 'Idempotency-Key': 'signature-key' });
      expect(JSON.parse(init.body as string)).toEqual({ text: 'Testo', work });
    }
  });
  it('il client legacy non inventa una chiave di firma', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetchMock);
    await gameApi.queueAction('game', 'Testo');
    expect((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });
  it('pre-abort non avvia HTTP né fallback', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(ministerApi.askStream('game', 'tesoro', 'Domanda', [], vi.fn(), [], controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('abort prima degli header cancella il fetch e non ripiega su POST', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(init.signal).toBe(controller.signal);
      init.signal!.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    })); vi.stubGlobal('fetch', fetchMock);
    const pending = ministerApi.askStream('game', 'tesoro', 'Domanda', [], vi.fn(), [], controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('abort dopo il primo chunk: niente token tardivi, niente risposta parziale risolta, niente fallback', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(target) { target.enqueue(new TextEncoder().encode('primo')); target.enqueue(new TextEncoder().encode('tardivo')); target.close(); } });
    const fetchMock = vi.fn(async () => new Response(stream)); vi.stubGlobal('fetch', fetchMock);
    const tokens = vi.fn(() => controller.abort());
    await expect(ministerApi.askStream('game', 'tesoro', 'Domanda', [], tokens, [], controller.signal)).rejects.toThrow();
    expect(tokens).toHaveBeenCalledTimes(1); expect(tokens).toHaveBeenCalledWith('primo');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it('un errore di rete non avvia una seconda generazione ambigua', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockRejectedValue(new Error('rete'));
    vi.stubGlobal('fetch', fetchMock);
    const token = vi.fn();
    await expect(ministerApi.askStream('game', 'tesoro', 'Domanda', [], token, [], controller.signal)).rejects.toThrow('rete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(token).not.toHaveBeenCalled();
  });
});
