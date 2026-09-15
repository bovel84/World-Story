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

  it('la mobilitazione delle riserve pesa su bilancio, stabilità e crescita', () => {
    const peaceful = WorldStateEngine.accounts([
      { id: 'p', owner: 'AAA', population: 1_000_000, gdp: 200, militaryPower: 30,
        objects: [{ type: 'factory', level: 1 }, { type: 'battalion', level: 1 }] },
    ]).AAA;
    const mobilizing = WorldStateEngine.accounts([
      { id: 'p', owner: 'AAA', population: 1_000_000, gdp: 200, militaryPower: 30,
        objects: [
          { type: 'factory', level: 1 },
          { type: 'battalion', level: 1 },
          { type: 'mobilization', level: 3 },
        ] },
    ]).AAA;

    expect(mobilizing.mobilized).toBe(3);
    expect(mobilizing.monthlyExpenses).toBeGreaterThan(peaceful.monthlyExpenses);
    expect(mobilizing.monthlyBalance).toBeLessThan(peaceful.monthlyBalance);
    expect(mobilizing.stability).toBeLessThan(peaceful.stability);
    expect(mobilizing.warEffort).toBeGreaterThan(peaceful.warEffort);
    expect(mobilizing.socialTension).toBeGreaterThan(peaceful.socialTension);
    expect(mobilizing.annualGrowthRate).toBeLessThan(peaceful.annualGrowthRate);
  });

  it('il bollettino espone riserve, sforzo bellico e tensione sociale', () => {
    const account = WorldStateEngine.accounts([
      { id: 'p', owner: 'AAA', population: 500_000, gdp: 100, militaryPower: 10,
        objects: [{ type: 'mobilization', level: 2 }] },
    ]).AAA;
    const bulletin = WorldStateEngine.playerBulletin(account) || '';
    expect(bulletin).toContain('Riserve mobilitate');
    expect(bulletin).toContain('sforzo bellico');
    expect(bulletin).toContain('tensione sociale');
  });

  it('esclude i fatti 2024 dai mondi storici e usa la tabella di conversione', () => {
    const regions = [{ id: 'roma', owner: 'ITA', population: 47_000_000, gdp: 120, militaryPower: 40 }];
    const modern = WorldStateEngine.accounts(regions).ITA;
    const historical = WorldStateEngine.accounts(regions, { modernFacts: false, startDate: '1951-01-01' }).ITA;
    // Il mondo moderno usa il registro reale: PIL 2024 e debito pubblico.
    expect(modern.nominalGdpUsdBillions).toBeGreaterThan(1_000);
    expect(modern.debtBurdenPct).toBeGreaterThan(100);
    // Il mondo storico legge la tabella 1951 (Italia 12 mld) e nessun debito 2024.
    expect(historical.nominalGdpUsdBillions).toBe(12);
    expect(historical.debtBurdenPct).toBe(0);
  });
});
