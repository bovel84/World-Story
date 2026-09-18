/**
 * COUNTRY-CLARITY — scheda Governo e società: chi sostiene, chi preme e perché,
 * promesse mantenute o tradite, dati mancanti.
 */
import { describe, it, expect } from 'vitest';
import { governmentOperatingPicture, promiseSummary } from './governmentOperatingPicture';
import type { Commitment, GovernmentFaction } from '../../services/api';

function faction(overrides: Partial<GovernmentFaction> = {}): GovernmentFaction {
  return {
    id: 'f1', name: 'Industriali', interest: 'Profitto e ordine pubblico', powerPct: 40,
    satisfaction: 80, stance: 'alleato', pressure: 10,
    demand: { lever: 'revenue', title: 'Meno tasse', detail: 'Taglio della pressione fiscale', direction: 'up', urgency: 5 } as any,
    footprint: 'Crescita', ...overrides,
  } as GovernmentFaction;
}

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: 'c1', type: 'promise', actor: 'ITA', counterparty: 'FRA', description: 'Ridurre le tariffe',
    createdDate: '2026-01-01', createdTurn: 1, status: 'active', deadline: null,
    sourceEventId: null, importance: 3, updatedDate: '2026-01-01', updatedTurn: 1, note: '',
    ...overrides,
  };
}

describe('COUNTRY-CLARITY · governo e società', () => {
  it('chi sostiene, chi è insoddisfatto e perché', () => {
    const picture = governmentOperatingPicture({
      government: {
        factions: [
          faction(),
          faction({ id: 'f2', name: 'Sindacati', satisfaction: 68, powerPct: 35, stance: 'favorevole' }),
          faction({
            id: 'f3', name: 'Nazionalisti', satisfaction: 22, powerPct: 25, stance: 'critico',
            demand: { lever: 'military', title: 'Riarmo', detail: 'Più spesa militare', direction: 'up', urgency: 8 } as any,
            politicalMemory: { trust: 20, resentment: 70, trend: 'in calo', lastEvent: { kind: 'broken_promise', turn: 3, gameDate: '2026-03-01', text: 'Promessa sul riarmo non mantenuta', weight: 4 }, favors: 0, grievances: 2, pressure: 60 } as any,
          }),
        ],
        dominantId: 'f1', angriestId: 'f3', cohesion: 62, pressureIndex: 48,
        trustIndex: 44, headline: 'Consiglio diviso', resentful: [], budget: {} as any,
        debt: { ratioPct: 40, servicePct: 6 },
      },
      commitments: { commitments: [commitment(), commitment({ id: 'c2', status: 'fulfilled' })], attention: [] },
      stability: 60, socialTension: 42, today: '2026-04-01',
    });
    expect(picture.supporting.map(item => item.name)).toEqual(['Industriali', 'Sindacati']);
    expect(picture.unsatisfied).toHaveLength(1);
    expect(picture.unsatisfied[0].name).toBe('Nazionalisti');
    expect(picture.unsatisfied[0].grievance).toContain('riarmo');
    expect(picture.dominant?.id).toBe('f1');
    expect(picture.angriest?.id).toBe('f3');
    expect(picture.promises.kept).toBe(1);
    expect(picture.promises.open).toBe(1);
    expect(picture.status).toBe('pressure');
    expect(picture.drivers.some(driver => driver.label.includes('insoddisfatta'))).toBe(true);
    expect(picture.drivers.some(driver => driver.label.includes('sosteng'))).toBe(true);
  });

  it('pressione alta e molte fazioni insoddisfatte: stato fragile o critico', () => {
    const picture = governmentOperatingPicture({
      government: {
        factions: [faction({ satisfaction: 20 }), faction({ id: 'f2', satisfaction: 25, name: 'B' }), faction({ id: 'f3', satisfaction: 30, name: 'C' })],
        dominantId: 'f1', angriestId: 'f1', cohesion: 24, pressureIndex: 74, trustIndex: 20,
        headline: '', resentful: [], budget: {} as any, debt: { ratioPct: 120, servicePct: 24 },
      },
      stability: 30, socialTension: 72, today: '2026-04-01',
    });
    expect(picture.status).toBe('critical');
    expect(picture.drivers.some(driver => driver.tone === 'critical')).toBe(true);
    expect(picture.headline).toContain('Pressione politica');
  });

  it('governo senza memoria politica: nessun rimprovero inventato', () => {
    const picture = governmentOperatingPicture({
      government: {
        factions: [faction({ satisfaction: 40, politicalMemory: undefined })],
        dominantId: 'f1', angriestId: 'f1', cohesion: 40, pressureIndex: 30, trustIndex: null,
        headline: '', resentful: [], budget: {} as any, debt: { ratioPct: 0, servicePct: 0 },
      },
    });
    expect(picture.unsatisfied[0].grievance).toBeNull();
    expect(picture.unsatisfied[0].trust).toBeNull();
    expect(picture.trustIndex).toBeNull();
  });

  it('dati mancanti: nessuna fazione, nessun giudizio', () => {
    const picture = governmentOperatingPicture({});
    expect(picture.supporting).toEqual([]);
    expect(picture.unsatisfied).toEqual([]);
    expect(picture.dominant).toBeNull();
    expect(picture.promises).toEqual({ kept: 0, broken: 0, open: 0, dueSoon: 0, highlights: [] });
    expect(picture.headline).toContain('non pubblica');
    expect(picture.status).toBe('stable');
  });

  it('promesse: mantenute, tradite, aperte e in scadenza', () => {
    const summary = promiseSummary([
      commitment(),
      commitment({ id: 'c2', status: 'fulfilled' }),
      commitment({ id: 'c3', status: 'broken' }),
      commitment({ id: 'c4', deadline: '2026-04-20', importance: 5 }),
    ], '2026-04-01');
    expect(summary).toMatchObject({ kept: 1, broken: 1, open: 2, dueSoon: 1 });
    expect(summary.highlights[0].importance).toBe(5);
  });

  it('scenario storico: fazioni di corte senza memoria né numeri moderni', () => {
    const picture = governmentOperatingPicture({
      government: {
        factions: [faction({ id: 'corte', name: 'Corte', satisfaction: 90, powerPct: 100, stance: 'alleato' })],
        dominantId: 'corte', angriestId: 'corte', cohesion: 90, pressureIndex: 10, trustIndex: null,
        headline: '', resentful: [], budget: {} as any, debt: { ratioPct: 0, servicePct: 0 },
      },
      stability: 70, socialTension: 12, today: '1815-06-01',
    });
    expect(picture.status).toBe('healthy');
    expect(picture.supporting[0].name).toBe('Corte');
    expect(picture.promises.open).toBe(0);
  });
});
