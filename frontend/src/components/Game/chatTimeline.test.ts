import { describe, expect, it } from 'vitest';
import {
  formatChatStamp,
  formatGameDate,
  orderChatsByLatest,
  chatSortKey,
  participantSetKey,
  archiveSiblingThreads,
  orderChatMessages,
  compareChatMessages,
  lastChatMessage,
} from './chatTimeline';

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

  it('una nuova discussione archivia le precedenti con gli stessi interlocutori', () => {
    const chats = [
      { id: 'old', participants: [{ id: 'DEU', role: 'player' }, { id: 'POL', role: 'polity' }] },
      { id: 'group', participants: [{ id: 'DEU', role: 'player' }, { id: 'POL', role: 'polity' }, { id: 'CZE', role: 'polity' }] },
      { id: 'new', participants: [{ id: 'POL', role: 'polity' }, { id: 'DEU', role: 'player' }] },
    ];
    const next = archiveSiblingThreads(chats, 'new');
    expect(next.find(c => c.id === 'old')?.archived).toBe(true);
    // Il gruppo ha interlocutori diversi: non è la stessa discussione.
    expect(next.find(c => c.id === 'group')?.archived).toBeUndefined();
    expect(next.find(c => c.id === 'new')?.archived).toBeUndefined();
  });

  it('canonicalizza l’insieme dei partecipanti indipendentemente dall’ordine', () => {
    expect(participantSetKey([{ id: 'POL' }, { id: 'DEU' }, { id: 'POL' }])).toBe('DEU|POL');
    expect(participantSetKey([])).toBe('');
    expect(participantSetKey(undefined)).toBe('');
  });
});

describe('chatTimeline — ordine dei messaggi di un thread', () => {
  /** Messaggio minimo: `seq` è la sequenza di inserimento del server. */
  const msg = (over: Partial<{
    id: string; role: string; gameDate: string | null; turn: number | null;
    seq: number | null; createdAt: string | null;
  }> = {}) => ({
    id: 'm1', role: 'polity', gameDate: '1815-09-08', turn: 4, seq: 1,
    createdAt: '2026-09-17T19:14:00.000Z', ...over,
  });

  it('ordina una sequenza disordinata secondo la timeline del mondo', () => {
    const messages = [
      msg({ id: 'c', gameDate: '1815-09-10', turn: 5, seq: 3 }),
      msg({ id: 'a', gameDate: '1815-09-01', turn: 3, seq: 1 }),
      msg({ id: 'b', gameDate: '1815-09-08', turn: 4, seq: 2 }),
    ];
    expect(orderChatMessages(messages).map(m => m.id)).toEqual(['a', 'b', 'c']);
    // L'input non viene mutato.
    expect(messages.map(m => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('stessa data del mondo: il turno decide (più turni nello stesso giorno)', () => {
    const messages = [
      msg({ id: 'turno4', gameDate: '1815-09-08', turn: 4, seq: 2 }),
      msg({ id: 'turno3', gameDate: '1815-09-08', turn: 3, seq: 1 }),
    ];
    expect(orderChatMessages(messages).map(m => m.id)).toEqual(['turno3', 'turno4']);
  });

  it('stessa data e stesso turno: il tie-breaker è la sequenza del server, non l’arrivo', () => {
    const arrival = [
      msg({ id: 'terzo', seq: 30, createdAt: '2026-09-17T19:14:03.000Z' }),
      msg({ id: 'primo', seq: 10, createdAt: '2026-09-17T19:14:01.000Z' }),
      msg({ id: 'secondo', seq: 20, createdAt: '2026-09-17T19:14:02.000Z' }),
    ];
    expect(orderChatMessages(arrival).map(m => m.id)).toEqual(['primo', 'secondo', 'terzo']);
  });

  it('stessa data, stesso turno e stessa sequenza: decide il timestamp del server, poi l’id', () => {
    const same = [
      msg({ id: 'b', seq: 5, createdAt: '2026-09-17T19:14:02.000Z' }),
      msg({ id: 'a', seq: 5, createdAt: '2026-09-17T19:14:01.000Z' }),
    ];
    expect(orderChatMessages(same).map(m => m.id)).toEqual(['a', 'b']);
    // Timestamp identici: l'ordine resta deterministico (per id).
    const tie = [msg({ id: 'z', seq: 5 }), msg({ id: 'a', seq: 5 })];
    expect(orderChatMessages(tie).map(m => m.id)).toEqual(['a', 'z']);
  });

  it('senza `seq` usa il timestamp del server: mai il timestamp locale né l’arrivo', () => {
    const messages = [
      msg({ id: 'tardi', seq: null, createdAt: '2026-09-17T19:14:09.000Z' }),
      msg({ id: 'presto', seq: null, createdAt: '2026-09-17T19:14:02.000Z' }),
    ];
    expect(orderChatMessages(messages).map(m => m.id)).toEqual(['presto', 'tardi']);
  });

  it('è deterministico: stesso input, stesso output (due esecuzioni)', () => {
    const messages = [
      msg({ id: 'x', gameDate: '1815-09-08', turn: 4, seq: 7 }),
      msg({ id: 'y', gameDate: '1815-09-08', turn: 4, seq: 7 }),
      msg({ id: 'z', gameDate: null, turn: null, seq: null, createdAt: null }),
      msg({ id: 'w', gameDate: '1815-09-08', turn: 4, seq: 6 }),
    ];
    const first = orderChatMessages(messages).map(m => m.id);
    const second = orderChatMessages(messages).map(m => m.id);
    const shuffled = orderChatMessages([...messages].reverse()).map(m => m.id);
    expect(first).toEqual(second);
    expect(first).toEqual(shuffled);
  });

  it('messaggio senza data del mondo o senza turno va in fondo, non davanti a tutti', () => {
    const messages = [
      msg({ id: 'senza-data', gameDate: null, turn: 9, seq: 99 }),
      msg({ id: 'con-data', gameDate: '1815-09-08', turn: 4, seq: 1 }),
      msg({ id: 'senza-turno', gameDate: '1815-09-08', turn: null, seq: 50 }),
    ];
    expect(orderChatMessages(messages).map(m => m.id)).toEqual(['con-data', 'senza-turno', 'senza-data']);
  });

  it('elenchi vuoti, nulli o con un solo messaggio restano tali', () => {
    expect(orderChatMessages([])).toEqual([]);
    expect(orderChatMessages(null)).toEqual([]);
    expect(orderChatMessages(undefined)).toEqual([]);
    const one = [msg({ id: 'solo' })];
    expect(orderChatMessages(one).map(m => m.id)).toEqual(['solo']);
  });

  it('l’ultimo messaggio è il più recente della timeline, non l’ultimo arrivato', () => {
    const late = msg({ id: 'vecchio', gameDate: '1815-09-01', turn: 3, seq: 40 });
    const thread = [msg({ id: 'nuovo', gameDate: '1815-09-08', turn: 4, seq: 12 }), late];
    expect(lastChatMessage(thread)?.id).toBe('nuovo');
    expect(lastChatMessage([])).toBeNull();
  });

  it('il confronto è coerente (a<b, b>a, a=a)', () => {
    const a = msg({ id: 'a', seq: 1 });
    const b = msg({ id: 'b', seq: 2 });
    expect(compareChatMessages(a, b)).toBeLessThan(0);
    expect(compareChatMessages(b, a)).toBeGreaterThan(0);
    expect(compareChatMessages(a, msg({ id: 'a', seq: 1 }))).toBe(0);
  });
});
