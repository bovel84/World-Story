import { afterEach, describe, expect, it, vi } from 'vitest';
import { advisorApi } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('verified advisor transport', () => {
  it('fetches authoritative context independently of conversation history', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reply: 'Presidente', issues: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await advisorApi.context('g1');
    expect(fetch.mock.calls[0][0]).toContain('/games/g1/advisor/context');
    expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
  });
  it('transports focus through a dedicated payload, not a forged user turn', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reply: 'Verificato', issues: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const issue = { id: 'i', title: 'Grano', question: 'Che fare?', verifiedFacts: [], suggestedMinisters: ['interno'] as const, origin: 'advisor' as const, sourceRefs: [], createdDate: '1951-01-01' };
    await advisorApi.reality('g1', 'Esaminiamo', [{ role: 'assistant', content: 'Conversazione precedente' }], { ...issue, suggestedMinisters: [...issue.suggestedMinisters] });
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.history).toEqual([{ role: 'assistant', content: 'Conversazione precedente' }]);
    expect(payload.advisorContext.focusIssue.id).toBe('i');
    expect(payload.advisorContext.verifiedWorldSnapshot).toBeUndefined();
  });
  it('does not retry ambiguous failed requests or accept partial facts', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await expect(advisorApi.reality('g1', 'Domanda', [])).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
