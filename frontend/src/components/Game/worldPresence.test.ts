/**
 * LW05 — Presenza del mondo: osservabilità delle variazioni estere già simulate.
 */
import { describe, expect, it } from 'vitest';
import { deriveWorldPresence } from './worldPresence';
import type { Region } from '../../types';
import { RegionStatus } from '../../types';

function region(id: string, owner: string, over: Partial<Region> = {}): Region {
  return {
    id, name: id, color: '#000', owner, population: 1000, gdp: 10, militaryPower: 1,
    objects: [], borders: [], status: RegionStatus.ACTIVE, metadata: {}, ...over,
  };
}

describe('LW05 — deriveWorldPresence', () => {
  const regions = {
    ita: region('ita', 'ITA', { polityName: 'Italia' }),
    tur: region('tur', 'TUR', { polityName: 'Turchia' }),
    tur2: region('tur2', 'TUR', { polityName: 'Turchia' }),
    sun: region('sun', 'SUN', { polityName: 'Unione Sovietica' }),
  };

  it('raggruppa le regioni estere cambiate per proprietario', () => {
    const presence = deriveWorldPresence({
      regions,
      changedRegionIds: ['tur', 'tur2', 'sun'],
      playerPolityId: 'ITA',
    });
    expect(presence.changedForeignCount).toBe(3);
    const owners = presence.facts.map(f => f.id);
    expect(owners).toContain('world-owner-TUR');
    expect(owners).toContain('world-owner-SUN');
    expect(presence.facts.find(f => f.id === 'world-owner-TUR')?.detail).toContain('2 regioni aggiornate');
  });

  it('ignora le regioni del giocatore e quelle neutrali', () => {
    const presence = deriveWorldPresence({
      regions: { ita: regions.ita, n: region('n', 'neutral') },
      changedRegionIds: ['ita', 'n'],
      playerPolityId: 'ITA',
    });
    expect(presence.facts).toHaveLength(0);
    expect(presence.changedForeignCount).toBe(0);
  });

  it('segnala una potenza ostile con tono di attenzione', () => {
    const presence = deriveWorldPresence({
      regions,
      changedRegionIds: ['sun'],
      playerPolityId: 'ITA',
      relationships: { ITA: { SUN: 'hostile' } },
    });
    expect(presence.facts[0].severity).toBe('warning');
    expect(presence.facts[0].detail).toContain('potenza ostile');
  });

  it('estrae dal feed solo scontri e diplomazia', () => {
    const presence = deriveWorldPresence({
      regions,
      changedRegionIds: [],
      playerPolityId: 'ITA',
      feedItems: [
        { id: 'a', text: 'Battaglia alla frontiera tra le due armate' },
        { id: 'b', text: 'Vertice diplomatico a Ginevra' },
        { id: 'c', text: 'Il raccolto è stato abbondante' },
      ],
    });
    const ids = presence.facts.map(f => f.id);
    expect(ids).toContain('world-feed-a');
    expect(ids).toContain('world-feed-b');
    expect(ids).not.toContain('world-feed-c');
  });

  it('non inventa fatti quando non c’è nulla da osservare', () => {
    const presence = deriveWorldPresence({ regions: {}, changedRegionIds: [], playerPolityId: 'ITA' });
    expect(presence.facts).toHaveLength(0);
  });
});
