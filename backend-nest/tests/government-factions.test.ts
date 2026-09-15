import { describe, expect, it } from 'vitest';
import { governmentSnapshot, stanceFor } from '../src/core/simulation/GovernmentFactions';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';

const accountFor = (objects: Array<{ type: string; level?: number }> = []) =>
  WorldStateEngine.accounts([
    { id: 'p1', owner: 'ITA', population: 60_000_000, gdp: 2000, militaryPower: 40, objects },
  ]).ITA;

describe('GovernmentFactions — le anime del governo', () => {
  it('ogni fazione ha influenza, soddisfazione, posizione e richiesta', () => {
    const snapshot = governmentSnapshot(accountFor([{ type: 'factory', level: 3 }, { type: 'university', level: 2 }]));
    expect(snapshot.factions.length).toBeGreaterThanOrEqual(6);
    for (const faction of snapshot.factions) {
      expect(faction.name).toBeTruthy();
      expect(faction.interest).toBeTruthy();
      expect(faction.powerPct).toBeGreaterThanOrEqual(0);
      expect(faction.satisfaction).toBeGreaterThanOrEqual(0);
      expect(faction.satisfaction).toBeLessThanOrEqual(100);
      expect(faction.pressure).toBeGreaterThanOrEqual(0);
      expect(faction.pressure).toBeLessThanOrEqual(100);
      expect(faction.demand.title).toBeTruthy();
      expect(faction.demand.detail).toBeTruthy();
      expect(['alleato', 'favorevole', 'neutrale', 'critico', 'ostile']).toContain(faction.stance);
    }
  });

  it('l’influenza somma a 100 e il consiglio ha un dominante', () => {
    const snapshot = governmentSnapshot(accountFor([{ type: 'factory', level: 4 }]));
    const sum = snapshot.factions.reduce((total, faction) => total + faction.powerPct, 0);
    expect(sum).toBeCloseTo(100, 0);
    expect(snapshot.dominantId).toBeTruthy();
    expect(snapshot.factions.some((faction) => faction.id === snapshot.dominantId)).toBe(true);
  });

  it('è deterministico: stesso conto, stesso governo', () => {
    const account = accountFor([{ type: 'army', level: 3 }, { type: 'mobilization', level: 2 }]);
    expect(JSON.stringify(governmentSnapshot(account))).toBe(JSON.stringify(governmentSnapshot(account)));
  });

  it('la mobilitazione rafforza le forze armate e alza la loro pressione', () => {
    const peaceful = governmentSnapshot(accountFor([{ type: 'army', level: 2 }]));
    const mobilizing = governmentSnapshot(accountFor([
      { type: 'army', level: 2 }, { type: 'mobilization', level: 4 },
    ]));
    const military = (snapshot: ReturnType<typeof governmentSnapshot>) =>
      snapshot.factions.find((faction) => faction.id === 'militari')!;
    expect(military(mobilizing).powerPct).toBeGreaterThan(military(peaceful).powerPct);
  });

  it('in disavanzo la finanza è critica e chiede di ridurre il disavanzo', () => {
    // Un esercito enorme porta la spesa oltre le entrate: saldo negativo.
    const account = accountFor([
      { type: 'army', level: 40 }, { type: 'mobilization', level: 40 },
    ]);
    expect(account.monthlyBalance).toBeLessThan(0);
    const snapshot = governmentSnapshot(account);
    const finance = snapshot.factions.find((faction) => faction.id === 'finanza')!;
    expect(finance.demand.lever).toBe('debito');
    expect(finance.demand.direction).toBe('abbassa');
    expect(finance.satisfaction).toBeLessThan(50);
  });

  it('la sintesi nomina chi domina e chi preme di più', () => {
    const snapshot = governmentSnapshot(accountFor([{ type: 'factory', level: 3 }]));
    expect(snapshot.headline.length).toBeGreaterThan(20);
    expect(snapshot.cohesion).toBeGreaterThanOrEqual(0);
    expect(snapshot.cohesion).toBeLessThanOrEqual(100);
    expect(snapshot.pressureIndex).toBeGreaterThanOrEqual(0);
    expect(snapshot.pressureIndex).toBeLessThanOrEqual(100);
  });

  it('stanceFor mappa la soddisfazione in una posizione leggibile', () => {
    expect(stanceFor(90)).toBe('alleato');
    expect(stanceFor(70)).toBe('favorevole');
    expect(stanceFor(50)).toBe('neutrale');
    expect(stanceFor(35)).toBe('critico');
    expect(stanceFor(10)).toBe('ostile');
  });

  it('un debito pubblico molto alto mette in allarme la finanza anche in pareggio', () => {
    const base = accountFor([{ type: 'factory', level: 3 }]);
    const low = governmentSnapshot({ ...base, debtBurdenPct: 40, monthlyBalance: 0 });
    const high = governmentSnapshot({ ...base, debtBurdenPct: 150, monthlyBalance: 0 });
    const finance = (snapshot: ReturnType<typeof governmentSnapshot>) =>
      snapshot.factions.find((faction) => faction.id === 'finanza')!;
    expect(finance(high).satisfaction).toBeLessThan(finance(low).satisfaction);
    expect(finance(high).demand.lever).toBe('debito');
    expect(finance(high).demand.title).toMatch(/debito/i);
  });

  it('lo snapshot espone debito e servizio, e la finanza reagisce al rapporto effettivo', () => {
    const base = accountFor([{ type: 'factory', level: 3 }]);
    const snapshot = governmentSnapshot({ ...base, debtRatioPct: 95, debtServicePct: 22 });
    expect(snapshot.debt).toEqual({ ratioPct: 95, servicePct: 22 });
    // Il rapporto effettivo prevale su quello ereditato di partenza.
    const inherited = governmentSnapshot({ ...base, debtBurdenPct: 40, debtRatioPct: 130, monthlyBalance: 0 });
    expect(inherited.debt.ratioPct).toBe(130);
    const finance = inherited.factions.find((faction) => faction.id === 'finanza')!;
    expect(finance.demand.lever).toBe('debito');
  });
});
