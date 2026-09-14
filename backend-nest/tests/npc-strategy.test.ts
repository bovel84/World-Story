import { describe, expect, it } from 'vitest';
import {
  currentStrategicPriorities,
  personalityForPolity,
  strategicProfileForPolity,
} from '../src/npc-agents';

describe('personalità e priorità strategiche NPC', () => {
  it('mantiene un profilo deterministico fra chiamate e API legacy', () => {
    const first = strategicProfileForPolity('ISR');
    const second = strategicProfileForPolity('ISR');

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      doctrine: 'security_first',
      decisionTempo: 'rapido',
      sovereigntySensitivity: 96,
    });
    expect(personalityForPolity('ISR')).toEqual({
      personality: first.personality,
      aggression: first.aggression,
    });
  });

  it('differenzia gli attori senza hard-codificare alleanze o nemici', () => {
    const unitedStates = strategicProfileForPolity('USA');
    const china = strategicProfileForPolity('CHN');
    const germany = strategicProfileForPolity('DEU');

    expect(unitedStates.doctrine).toBe('coalition_builder');
    expect(china.doctrine).toBe('strategic_patience');
    expect(germany.economicFocus).toBeGreaterThan(germany.riskTolerance);
    for (const profile of [unitedStates, china, germany]) {
      expect(profile.baselinePriorities.join(' ')).not.toMatch(/Russia|Cina|USA|Israele/i);
    }
  });

  it('aggiorna le priorità con minacce e capacità senza mutare il profilo', () => {
    const profile = strategicProfileForPolity('DEU');
    const before = structuredClone(profile);
    const priorities = currentStrategicPriorities(profile, {
      relationshipToPlayer: 'hostile',
      hostileNeighbours: 2,
      militaryPower: 30,
      playerMilitaryPower: 100,
      monthlyBalance: -4,
      stability: 38,
    });

    expect(priorities.join(' ')).toContain('frontiere ostili');
    expect(priorities.join(' ')).toContain('contenimento');
    expect(profile).toEqual(before);
  });

  it('tiene conto di sforzo bellico e tensione sociale nella decisione', () => {
    const profile = strategicProfileForPolity('DEU');
    const priorities = currentStrategicPriorities(profile, {
      monthlyBalance: -6,
      stability: 40,
      mobilized: 5,
      warEffort: 70,
      socialTension: 62,
    });

    expect(priorities.join(' ')).toContain('malcontento interno');
    expect(priorities.join(' ')).toContain('sforzo bellico');
  });
});
