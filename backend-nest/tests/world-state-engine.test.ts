import { describe, expect, it } from 'vitest';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';

describe('WorldStateEngine', () => {
  it('derives national accounts only from provinces and real map objects', () => {
    const accounts = WorldStateEngine.accounts([
      { id: 'a', owner: 'AAA', population: 100, gdp: 200, militaryPower: 30,
        objects: [{ type: 'factory', level: 2 }, { type: 'port', level: 1 }] },
      { id: 'b', owner: 'AAA', population: 50, gdp: 100, militaryPower: 10,
        objects: [{ type: 'university', level: 1 }, { type: 'army', level: 1 }] },
      { id: 'c', owner: 'BBB', population: 80, gdp: 90, militaryPower: 20 },
    ]);

    expect(accounts.AAA.provinces).toBe(2);
    expect(accounts.AAA.gdp).toBe(300);
    expect(accounts.AAA.factories).toBe(2);
    expect(accounts.AAA.monthlyRevenue).toBeGreaterThan(0);
    expect(accounts.AAA.monthlyExpenses).toBeGreaterThan(0);
    expect(accounts.BBB.factories).toBe(0);
  });

  it('advances slow state deterministically without changing neutral or destroyed provinces', () => {
    const regions = [
      { id: 'active', owner: 'AAA', population: 1000, gdp: 1000, militaryPower: 100, objects: [{ type: 'factory', level: 1 }] },
      { id: 'neutral', owner: 'neutral', population: 1000, gdp: 1000, militaryPower: 100 },
      { id: 'ruin', owner: 'AAA', status: 'destroyed', population: 1000, gdp: 1000, militaryPower: 100 },
    ];

    const tick = WorldStateEngine.advance(regions, 365);
    expect(regions[0].gdp).toBeGreaterThan(1000);
    expect(regions[0].population).toBeGreaterThan(1000);
    expect(regions[0].militaryPower).toBeLessThan(100);
    expect(regions[1]).toMatchObject({ gdp: 1000, population: 1000, militaryPower: 100 });
    expect(regions[2]).toMatchObject({ gdp: 1000, population: 1000, militaryPower: 100 });
    expect(tick.changedRegions).toContain('active');
    expect(WorldStateEngine.playerBulletin(tick.accounts.AAA)).toContain('Bilancio mensile');
  });
});
