/**
 * LW06 — Presenza diplomatica: lettura deterministica della matrice relazioni.
 */
import { describe, expect, it } from 'vitest';
import { deriveDiplomacyPresence } from './diplomacyPresence';
import type { Region } from '../../types';
import { RegionStatus } from '../../types';

function region(id: string, name: string, owner: string, isCapital = false): Region {
  return {
    id, name, color: '#000', owner, population: 1, gdp: 1, militaryPower: 1,
    objects: [], borders: [], status: RegionStatus.ACTIVE, metadata: isCapital ? { isCapitalProvince: true } : {},
  };
}

const regions = [
  region('paris', 'Parigi', 'FRA', true),
  region('normandia', 'Normandia', 'FRA'),
  region('mosca', 'Mosca', 'SUN', true),
  region('roma', 'Roma', 'ITA', true),
];

describe('LW06 — deriveDiplomacyPresence', () => {
  it('separa alleati, ostili e neutrali', () => {
    const presence = deriveDiplomacyPresence({
      regionOwner: 'ITA',
      regions,
      relationships: { ITA: { FRA: 'ally', SUN: 'hostile', ESP: 'neutral' } },
    });
    expect(presence.allies.map(a => a.id)).toEqual(['FRA']);
    expect(presence.hostiles.map(h => h.id)).toEqual(['SUN']);
    expect(presence.neutrals).toBe(1);
    expect(presence.total).toBe(3);
    expect(presence.summary).toBe('1 alleato · 1 ostile');
  });

  it('preferisce la regione capitale come nome del paese', () => {
    const presence = deriveDiplomacyPresence({
      regionOwner: 'ITA', regions, relationships: { ITA: { FRA: 'ally' } },
    });
    expect(presence.allies[0].name).toBe('Parigi');
  });

  it('usa l’id quando non trova una regione', () => {
    const presence = deriveDiplomacyPresence({
      regionOwner: 'ITA', regions, relationships: { ITA: { XYZ: 'ally' } },
    });
    expect(presence.allies[0].name).toBe('XYZ');
  });

  it('dichiara l’assenza di relazioni senza inventarle', () => {
    const presence = deriveDiplomacyPresence({ regionOwner: 'ITA', regions, relationships: {} });
    expect(presence.total).toBe(0);
    expect(presence.summary).toBe('nessuna relazione registrata');
  });

  it('con soli neutrali lo dichiara', () => {
    const presence = deriveDiplomacyPresence({
      regionOwner: 'ITA', regions, relationships: { ITA: { FRA: 'neutral' } },
    });
    expect(presence.summary).toBe('1 partner neutrali');
  });
});
