/**
 * WS-GOV-POLITY-BASELINE-HARDENING — l'apertura LLM è primaria, il briefing
 * verificato deterministico è un fallback NON bloccante. Una cancellazione
 * della richiesta principale non deve produrre una seconda chiamata.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advisorApi } from '../../services/api';
import { fetchAdvisorOpening } from './advisorOpening';

vi.mock('../../services/api', () => ({
  advisorApi: { opening: vi.fn(), context: vi.fn() },
}));

const snapshot = (date: string) => ({ advisorContext: { verifiedWorldSnapshot: { date } } } as never);
const issue = { id: 'i1', title: 'Approvvigionamento', question: 'Come?', verifiedFacts: [], suggestedMinisters: [], origin: 'advisor', sourceRefs: [], createdDate: '1951-03-01' } as never;

describe('fetchAdvisorOpening', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('usa l’apertura LLM quando disponibile e non chiama mai il fallback', async () => {
    vi.mocked(advisorApi.opening).mockResolvedValueOnce({ reply: 'Apertura LLM', issues: [issue], ...snapshot('1951-03-01') } as never);
    const opening = await fetchAdvisorOpening('g1');
    expect(opening).toEqual({ reply: 'Apertura LLM', issues: [issue], date: '1951-03-01' });
    expect(advisorApi.context).not.toHaveBeenCalled();
  });

  it('se l’apertura è irraggiungibile ricade sul briefing verificato deterministico', async () => {
    vi.mocked(advisorApi.opening).mockRejectedValueOnce(new Error('network'));
    vi.mocked(advisorApi.context).mockResolvedValueOnce({ reply: 'Copertura alimentare 0,8 mesi', issues: [], ...snapshot('1951-03-01') } as never);
    const opening = await fetchAdvisorOpening('g1');
    expect(opening.reply).toContain('0,8 mesi');
    expect(opening.date).toBe('1951-03-01');
    expect(advisorApi.context).toHaveBeenCalledWith('g1', undefined);
  });

  it('una richiesta annullata non innesca il fallback', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(advisorApi.opening).mockRejectedValueOnce(new Error('aborted'));
    await expect(fetchAdvisorOpening('g1', controller.signal)).rejects.toThrow('aborted');
    expect(advisorApi.context).not.toHaveBeenCalled();
  });
});
