import { describe, expect, it } from 'vitest';
import type { ChatSummaryData } from '../../services/api';
import { findActiveBilateralChat, pickDiplomaticTargetIds, isNewDiplomaticMessagePersisted } from './diplomaticChatNavigation';

const chat = (id: string, others: string[], archived = false): ChatSummaryData => ({
  id, polityId: others[0] || 'RWA', polityName: others[0] || 'RWA',
  polityColor: '#fff', archived, unread: 0,
  participants: [
    { id: 'UGA', name: 'Uganda', color: '#111', role: 'player' },
    ...others.map(id => ({ id, name: id, color: '#999', role: 'polity' as const })),
  ],
} as ChatSummaryData);

describe('DIPLOMACY — reuse the right live bilateral conversation', () => {
  it('resumes a live negotiation by polity ID and never mixes similarly named provinces', () => {
    const rows = [chat('kigali', ['RWA']), chat('congo', ['COD'])];
    expect(findActiveBilateralChat(rows, 'UGA', 'COD')?.id).toBe('congo');
    expect(findActiveBilateralChat(rows, 'UGA', 'RWA')?.id).toBe('kigali');
  });
  it('never opens an archived thread or an unrelated group discussion', () => {
    const rows = [chat('old', ['RWA'], true), chat('group', ['RWA', 'COD'])];
    expect(findActiveBilateralChat(rows, 'UGA', 'RWA')).toBeUndefined();
  });
  it('does not select conversations with a different player or the player themself', () => {
    const wrong = { ...chat('wrong', ['RWA']),
      participants: [{ id: 'FRA', role: 'player' as const, name: 'Francia', color: '#111' },
        { id: 'RWA', role: 'polity' as const, name: 'Rwanda', color: '#fff' }] };
    expect(findActiveBilateralChat([wrong], 'UGA', 'RWA')).toBeUndefined();
    expect(findActiveBilateralChat([chat('a', ['UGA'])], 'UGA', 'UGA')).toBeUndefined();
  });
});
describe('DIPLOMACY — canonical targets for new chats', () => {
  it('sends polity IDs, never province or display names', () => {
    const targets = [
      { id: 'RWA', name: 'Kigali' },
      { id: 'COD', name: 'Kigali' },
      { id: 'KEN', name: 'Kenya' },
    ];
    expect(pickDiplomaticTargetIds(targets, new Set(['COD', 'KEN']))).toEqual(['COD', 'KEN']);
    expect(pickDiplomaticTargetIds(targets, new Set<string>())).toEqual([]);
  });
});

describe('DIPLOMACY — persisted messages after failed LLM reply', () => {
  it('recognizes a newly saved diplomatic note and avoids sending it twice', () => {
    const before = new Set(['old']);
    const messages = [
      { id: 'old', role: 'player' as const, content: 'Ripetiamo la richiesta' },
      { id: 'new', role: 'player' as const, content: 'Ripetiamo la richiesta' },
    ];
    expect(isNewDiplomaticMessagePersisted(before, messages, 'Ripetiamo la richiesta')).toBe(true);
    expect(isNewDiplomaticMessagePersisted(new Set(['old', 'new']), messages, 'Ripetiamo la richiesta')).toBe(false);
    expect(isNewDiplomaticMessagePersisted(before, [{ id: 'npc', role: 'polity', content: 'Ripetiamo la richiesta' }], 'Ripetiamo la richiesta')).toBe(false);
  });
});
