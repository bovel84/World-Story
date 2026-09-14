import { describe, expect, it } from 'vitest';
import { formatChatStamp, formatGameDate, orderChatsByLatest, chatSortKey } from './chatTimeline';

describe('chatTimeline — date e ordinamento delle chat diplomatiche', () => {
  it('formatta la data del mondo senza scostamenti di fuso orario', () => {
    expect(formatGameDate('2026-01-15')).toBe('15 gen 2026');
    expect(formatGameDate('2026-12-03T10:00:00Z')).toBe('3 dic 2026');
    expect(formatGameDate('non-una-data')).toBe('');
    expect(formatGameDate(undefined)).toBe('');
  });

  it('preferisce la data del mondo al timestamp reale', () => {
    expect(formatChatStamp('2026-01-15', '2026-09-14T05:29:52.771Z')).toBe('15 gen 2026');
  });

  it('senza data del mondo ripiega su HH:MM per oggi e «giorno mese HH:MM» altrove', () => {
    const now = new Date(2026, 8, 14, 12, 0, 0); // 14 set 2026, ora locale
    const today = new Date(2026, 8, 14, 5, 29, 0).toISOString();
    const past = new Date(2026, 8, 10, 8, 5, 0).toISOString();
    expect(formatChatStamp(undefined, today, now)).toBe('05:29');
    expect(formatChatStamp(undefined, past, now)).toBe('10 set 08:05');
    expect(formatChatStamp(undefined, undefined, now)).toBe('');
    expect(formatChatStamp(undefined, 'garbage', now)).toBe('');
  });

  it('ordina le chat dalla più recente, senza mutare l’input', () => {
    const chats = [
      { id: 'a', lastMessageAt: '2026-09-10T10:00:00Z' },
      { id: 'b', lastMessageGameDate: '2026-09-12' },
      { id: 'c', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'd', lastMessageAt: '2026-09-14T09:00:00Z' },
    ];
    const ordered = orderChatsByLatest(chats);
    expect(ordered.map(c => c.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(chats.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('usa la data del mondo come chiave quando manca il timestamp', () => {
    expect(chatSortKey({ lastMessageGameDate: '2026-02-01' })).toBe('2026-02-01');
    expect(chatSortKey({})).toBe('');
  });
});
