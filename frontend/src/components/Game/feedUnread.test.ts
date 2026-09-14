import { describe, expect, it } from 'vitest';
import { countUnread, markAllRead, markItemRead } from './feedUnread';

describe('feedUnread — dispacci nuovi vs letti', () => {
  const items = [
    { id: 'a', read: true },
    { id: 'b' },
    { id: 'c' },
  ];

  it('conta i dispacci senza flag read come da leggere', () => {
    expect(countUnread(items)).toBe(2);
    expect(countUnread([])).toBe(0);
    expect(countUnread([{ id: 'x', read: true }])).toBe(0);
  });

  it('marca letto un solo dispaccio e conserva gli altri', () => {
    const next = markItemRead(items, 'b');
    expect(next.map(i => i.read)).toEqual([true, true, undefined]);
    expect(countUnread(next)).toBe(1);
    // L'id sconosciuto o già letto non cambia l'array (nessun re-render inutile).
    expect(markItemRead(items, 'zzz')).toBe(items);
    expect(markItemRead(items, 'a')).toBe(items);
  });

  it('marca tutti i dispacci come letti una volta sola', () => {
    const next = markAllRead(items);
    expect(countUnread(next)).toBe(0);
    expect(next).not.toBe(items);
    // Già tutti letti: stessa referenza, nessun aggiornamento.
    expect(markAllRead(next)).toBe(next);
  });
});
