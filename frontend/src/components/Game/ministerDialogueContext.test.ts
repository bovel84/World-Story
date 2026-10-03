import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MinisterChat } from './MinisterChat';
import { emptyWorkspace, type DecisionWorkspace, type NegotiatedProposal } from './decisionWorkspace';
import { buildMinisterHistory, projectCurrentDecision } from './ministerDialogueContext';
import type { AdvisorHistoryItem } from '../../services/api';

function proposal(overrides: Partial<NegotiatedProposal> = {}): NegotiatedProposal {
  return { id: 'current', revision: 4, objective: 'Use the surplus', measures: [], constraints: [], assumptions: [], risks: [], expectedEffects: [], unresolvedQuestions: [], sourceMessageIds: [], status: 'negotiating', ...overrides };
}

function workspace(current: NegotiatedProposal): DecisionWorkspace {
  return { ...emptyWorkspace('tesoro'), objective: 'Workspace objective', revision: 4, activeProposalId: current.id, proposals: [proposal({ id: 'old', objective: 'Superseded' }), current] };
}

describe('minister dialogue read-only context', () => {
  it('projects the active minister proposal and subsequent president choice without mutation or promotion', () => {
    const minister = workspace(proposal({ measures: [
      { id: 'debt', label: 'Reduce debt', kind: 'allocation', value: '40%', sharePct: 40, amount: 3.04, unit: 'mld', status: 'proposed', source: 'minister' },
      { id: 'fund', label: 'Available funds', kind: 'other', status: 'unresolved', source: 'engine' },
    ], constraints: ['Protect cash'], unresolvedQuestions: ['And the rest?'] }));
    const president = workspace(proposal({ measures: [{ ...minister.proposals[1].measures[0], status: 'accepted', source: 'president' }] }));
    const before = JSON.stringify([minister, president]);
    const recommendation = projectCurrentDecision(minister)!;
    const choice = projectCurrentDecision(president)!;
    expect(recommendation).toEqual({ objective: 'Use the surplus', revision: 4, measures: minister.proposals[1].measures, constraints: ['Protect cash'], unresolved: ['And the rest?'] });
    expect(choice.measures![0]).toMatchObject({ status: 'accepted', source: 'president' });
    expect(recommendation.measures![0]).toMatchObject({ status: 'proposed', source: 'minister' });
    expect(recommendation.measures).not.toBe(minister.proposals[1].measures);
    expect(recommendation.measures![0]).not.toBe(minister.proposals[1].measures[0]);
    expect(JSON.stringify([minister, president])).toBe(before);
  });

  it('preserves rejected measures and uses only the active proposal, not a stale alternative', () => {
    const current = workspace(proposal({ measures: [{ id: 'old-work', label: 'Factory', kind: 'work', status: 'rejected', source: 'president' }] }));
    expect(projectCurrentDecision(current)?.measures).toEqual(current.proposals[1].measures);
    expect(projectCurrentDecision({ ...current, activeProposalId: 'missing' })).toEqual({ objective: 'Workspace objective', revision: 4, measures: [], constraints: [], unresolved: [] });
    expect(projectCurrentDecision({ ...current, activeProposalId: 'missing', objective: null })).toBeUndefined();
  });

  it('bounds the snapshot to the backend schema even for long or invalid stale fields', () => {
    expect(projectCurrentDecision(null)).toBeUndefined();
    expect(projectCurrentDecision(emptyWorkspace('tesoro'))).toBeUndefined();
    const current = workspace(proposal({ objective: 'o'.repeat(5000), measures: Array.from({ length: 100 }, () => ({ id: 'a'.repeat(500), label: 'b'.repeat(5000), kind: 'other', value: 'c'.repeat(5000), unit: 'd'.repeat(500), status: 'rejected', source: 'minister', amount: Infinity, sharePct: 101 })), constraints: Array(100).fill('e'.repeat(5000)), unresolvedQuestions: Array(100).fill('f'.repeat(5000)) }));
    const before = JSON.stringify(current);
    const result = projectCurrentDecision(current)!;
    expect(result.objective).toHaveLength(400);
    expect(result.measures).toHaveLength(30);
    expect(result.measures![0]).toEqual({ id: 'a'.repeat(400), label: 'b'.repeat(400), kind: 'other', value: 'c'.repeat(400), unit: 'd'.repeat(400), status: 'rejected', source: 'minister' });
    expect(result.constraints).toHaveLength(20);
    expect(result.unresolved).toHaveLength(20);
    expect(result.constraints![0]).toHaveLength(400);
    expect(result.unresolved![0]).toHaveLength(400);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('includes the opening once on first and second sends, including histories already containing it', () => {
    const opening = 'Io non spenderei tutto.';
    const firstHistory = buildMinisterHistory([], opening);
    expect(firstHistory).toEqual([{ role: 'assistant', content: opening }]);
    const turns: AdvisorHistoryItem[] = [{ role: 'user', content: 'Perché?' }, { role: 'assistant', content: 'Proteggiamo la cassa.' }];
    const secondHistory = buildMinisterHistory(turns, opening);
    expect(secondHistory).toEqual([...firstHistory, ...turns]);
    expect(buildMinisterHistory(secondHistory, opening)).toEqual(secondHistory);
    expect(secondHistory.filter(message => message.content === opening)).toHaveLength(1);
    expect(buildMinisterHistory([{ role: 'user', content: opening }], opening)).toHaveLength(2);
  });

  it('preserves all subsequent messages verbatim, including repeated and empty turns', () => {
    const messages: AdvisorHistoryItem[] = [
      { role: 'user', content: 'Perché?', turn: 2 },
      { role: 'assistant', content: 'Proteggiamo la cassa.', speaker: 'Tesoro' },
      { role: 'user', content: 'Perché?' },
      { role: 'assistant', content: '' },
      ...Array.from({ length: 25 }, () => ({ role: 'user' as const, content: 'E il resto?' })),
    ];
    const before = JSON.stringify(messages);
    expect(buildMinisterHistory(messages, 'Saluto.')).toEqual([{ role: 'assistant', content: 'Saluto.' }, ...messages]);
    expect(buildMinisterHistory(messages, '')).toEqual(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('renders a retained opening once without copying it into engine memory', () => {
    const opening = 'Io non spenderei tutto.';
    const add = vi.fn();
    const props = { gameId: 'game', sessionId: 'turn-1', address: { seat: 'tesoro' as const, label: 'Tesoro', reads: 'Conti', opening: 'Fallback', items: [] }, retainedOpening: opening, streaming: false, onAddMessage: add, onAppendToken: vi.fn(), onStreamingChange: vi.fn() };
    const messages: AdvisorHistoryItem[] = [{ role: 'user', content: 'Perché?' }];
    const html = renderToStaticMarkup(createElement(MinisterChat, { ...props, messages }));
    expect(html).toContain(opening);
    expect(html).toContain('minister-greeting');
    const withOpening = renderToStaticMarkup(createElement(MinisterChat, { ...props, messages: [{ role: 'assistant', content: opening }, ...messages] }));
    expect(withOpening).not.toContain('minister-greeting');
    expect(add).not.toHaveBeenCalled();
  });
});
