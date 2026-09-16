/**
 * TimelineService — test di isolamento della read model estratta da GameSession.
 * Non richiede DB: `buildEntries` è puro e riceve il filtro pubblico iniettato.
 */
import { describe, it, expect } from 'vitest';
import { TimelineService } from '../src/game/TimelineService';

/** Filtro pubblico fittizio: marca il testo filtrato, così verifichiamo il wiring. */
const filter = (value: unknown) => `pub{${String(value ?? '')}}`;

describe('TimelineService.buildEntries', () => {
  it('converte i vecchi eventi stringa applicando il filtro pubblico e id stabili', () => {
    const service = new TimelineService('game-1', filter);
    const entries = service.buildEntries([
      {
        id: 'r1',
        turn: 2,
        date: '1951-03-01',
        events: ['Crisi di governo', 'Dazi alla Francia'],
        narration: 'Un trimestre turbolento.',
        simulationId: 'sim-7',
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].narration).toBe('pub{Un trimestre turbolento.}');
    expect(entries[0].events).toEqual([
      expect.objectContaining({ id: 'r1-0', headline: 'pub{Crisi di governo}', detail: 'pub{Un trimestre turbolento.}', source: 'world', simulationId: 'sim-7' }),
      expect.objectContaining({ id: 'r1-1', headline: 'pub{Dazi alla Francia}', detail: 'pub{Un trimestre turbolento.}', source: 'world', simulationId: 'sim-7' }),
    ]);
  });

  it('preferisce gli eventi strutturati e filtra headline/detail', () => {
    const service = new TimelineService('game-1', filter);
    const entries = service.buildEntries([
      {
        id: 'r2',
        turn: 1,
        date: '1951-01-10',
        events: ['evento legacy ignorato'],
        timelineEvents: [
          { id: 'e1', date: '1951-01-05', headline: 'Ultimatum', detail: 'Alla Francia.', source: 'diplomacy' },
        ],
        narration: 'Nota.',
      },
    ]);

    expect(entries[0].events).toHaveLength(1);
    expect(entries[0].events[0]).toMatchObject({
      id: 'e1',
      headline: 'pub{Ultimatum}',
      detail: 'pub{Alla Francia.}',
      source: 'diplomacy',
    });
  });

  it('ordina gli eventi per data e le entry per turno poi data', () => {
    const service = new TimelineService('game-1', filter);
    const entries = service.buildEntries([
      {
        id: 'late', turn: 3, date: '1951-04-01', narration: '',
        timelineEvents: [
          { id: 'b', date: '1951-04-20', headline: 'B', detail: '', source: 'world' },
          { id: 'a', date: '1951-04-02', headline: 'A', detail: '', source: 'world' },
        ],
      },
      { id: 'early', turn: 1, date: '1951-01-01', events: ['Primo'], narration: '' },
    ]);

    expect(entries.map(e => e.turn)).toEqual([1, 3]);
    expect(entries[1].events.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('getTimeline delega a buildEntries', () => {
    const service = new TimelineService('game-1', filter);
    const entries = service.getTimeline([{ id: 'r', turn: 1, events: ['x'], narration: 'y' }]);
    expect(entries[0].events[0].headline).toBe('pub{x}');
  });
});
