import { afterEach, describe, expect, it, vi } from 'vitest';
import { ministerApi } from './api';

const currentDecision = { objective: 'Use the surplus', revision: 2, measures: [{ id: 'debt', label: 'Debt', kind: 'allocation' as const, sharePct: 40, status: 'proposed' as const, source: 'minister' as const }], unresolved: ['And the rest?'], constraints: ['Protect cash'] };
afterEach(() => vi.unstubAllGlobals());

describe('minister currentDecision transport', () => {
  it('sends optional context on POST while preserving legacy callers', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ reply: 'Va bene.' })));
    vi.stubGlobal('fetch', fetchMock);
    await ministerApi.ask('game', 'tesoro', 'E il resto?', [], [], undefined, currentDecision);
    await ministerApi.ask('game', 'tesoro', 'Perché?', []);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'E il resto?', history: [], memory: [], currentDecision });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('currentDecision');
  });

  it('sends the same snapshot with a successful streaming request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('La quota resta aperta.'));
    vi.stubGlobal('fetch', fetchMock);
    const token = vi.fn();
    expect(await ministerApi.askStream('game', 'tesoro', 'E il resto?', [], token, [], undefined, currentDecision)).toBe('La quota resta aperta.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'E il resto?', history: [], memory: [], currentDecision });
    expect(token).toHaveBeenCalledWith('La quota resta aperta.');
  });

  it.each([404, 405, 501])('preserves context and signal on unsupported stream route (%s) fallback', async status => {
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reply: 'La quota resta aperta.' })));
    vi.stubGlobal('fetch', fetchMock);
    const token = vi.fn();
    const history = [{ role: 'assistant' as const, content: 'Io non spenderei tutto.' }, { role: 'user' as const, content: 'Perché?' }];
    expect(await ministerApi.askStream('game', 'tesoro', 'E il resto?', history, token, [], controller.signal, currentDecision)).toBe('La quota resta aperta.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/games\/game\/government\/minister\/tesoro\/stream$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/games\/game\/government\/minister\/tesoro$/);
    for (const [, init] of fetchMock.mock.calls) {
      const payload = JSON.parse(init.body);
      expect(init.method).toBe('POST');
      expect(payload).toEqual({ message: 'E il resto?', history, memory: [], currentDecision });
      expect(payload.currentDecision.measures[0]).toMatchObject({ source: 'minister', status: 'proposed' });
      expect(init.signal).toBe(controller.signal);
    }
    expect(token).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledWith('La quota resta aperta.');
  });

  it.each(['network', 'missing-body', 'reader', 500, 502, 503] as const)('does not retry an ambiguous %s stream failure that may already have generated', async failure => {
    const controller = new AbortController();
    const fetchMock = vi.fn();
    const transportError = new Error(failure === 'network' ? 'Offline' : 'Broken reader');
    if (failure === 'network') fetchMock.mockRejectedValueOnce(transportError);
    if (failure === 'missing-body') fetchMock.mockResolvedValueOnce(new Response(null));
    if (failure === 'reader') {
      fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
        start(target) { target.error(transportError); },
      })));
    }
    if (typeof failure === 'number') fetchMock.mockResolvedValueOnce(new Response('', { status: failure }));
    // A retry would succeed, so the rejection and single fetch prove no second generation is attempted.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reply: 'Must not be generated.' })));
    vi.stubGlobal('fetch', fetchMock);
    const token = vi.fn();
    const request = ministerApi.askStream('game', 'tesoro', 'E il resto?', [], token, [], controller.signal, currentDecision);
    if (failure === 'network' || failure === 'reader') {
      await expect(request).rejects.toBe(transportError);
    } else {
      await expect(request).rejects.toThrow(`Risposta ministeriale non disponibile (${failure === 'missing-body' ? 200 : failure}). Riprova esplicitamente.`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(token).not.toHaveBeenCalled();
  });
});
