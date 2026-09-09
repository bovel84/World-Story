import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationEngine } from '../src/core/simulation/SimulationEngine';
import type { RegionState, ValidatedAction } from '../src/core/simulation/types';

function region(
  id: string,
  owner: string,
  borders: string[],
  militaryPower = 300,
  gdp = 200,
): RegionState {
  return {
    id,
    name: id.toUpperCase(),
    color: owner === 'NPC' ? '#111111' : '#222222',
    owner,
    population: 2_000_000,
    gdp,
    militaryPower,
    objects: [],
    borders,
    status: 'active',
  };
}

function world(reverse = false): Map<string, RegionState> {
  const regions = [
    region('a', 'NPC', ['b', 'c'], 500, 300),
    region('b', 'RIVAL', ['a'], 220, 140),
    region('c', 'RIVAL_2', ['a'], 180, 120),
  ];
  if (reverse) regions.reverse();
  return new Map(regions.map(item => [item.id, item]));
}

const attack: ValidatedAction = {
  type: 'attack',
  sourceRegionId: 'a',
  targetRegionId: 'b',
  description: 'Attacca la regione B',
  cost: { gdp: 20, population: 0, militaryPower: 60 },
  expectedOutcome: {
    successProbability: 0.8,
    expectedCaptures: ['b'],
    expectedLosses: { gdp: 100, population: 10_000, militaryPower: 30 },
    duration: 30,
  },
};

afterEach(() => vi.restoreAllMocks());

describe('SimulationEngine deterministic replay', () => {
  it('replays the same player combat with the same outcome', () => {
    const first = new SimulationEngine(world()).applyAction(attack, 30);
    const second = new SimulationEngine(world()).applyAction(attack, 30);

    expect(second).toEqual(first);
  });

  it('keeps NPC decisions stable when Map insertion order changes', () => {
    const config = { aggressionMultiplier: 1 };
    const first = new SimulationEngine(world(false), config).processNPCTurn('NPC', 30);
    const second = new SimulationEngine(world(true), config).processNPCTurn('NPC', 30);

    expect(second).toEqual(first);
  });

  it('does not depend on Math.random', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('global RNG must not be used by SimulationEngine');
    });

    expect(() => new SimulationEngine(world()).applyAction(attack, 30)).not.toThrow();
    expect(() => new SimulationEngine(world(), { aggressionMultiplier: 1 }).processNPCTurn('NPC', 30)).not.toThrow();
    expect(random).not.toHaveBeenCalled();
  });
});
