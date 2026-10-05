import { describe, it, expect, vi } from 'vitest';
import { formationImpact } from '../src/core/simulation/OperationalObjects';
import { seedStock } from '../src/core/simulation/MaterialEconomy';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import { buildCountryInitialProfile, validateCountryInitialProfile, generateCountryInitialProfile } from '../src/core/simulation/CountryInitialProfile';
const input = (polityId = 'BIH', population = 3_750_000) => ({
  polityId, startDate: '2000-01-01', regions: [{ id: polityId, owner: polityId, population, gdp: 10, militaryPower: 20, coastal: false, objects: [] }],
});
describe('CountryInitialProfile', () => {
  it('Bosnia 2000 never inherits the 2024 GDP/debt; USA and Bosnia have different economies/armies/readiness', () => {
    const bosnia = buildCountryInitialProfile(input());
    const usa = buildCountryInitialProfile(input('USA', 282_000_000));
    expect(bosnia.economy.nominalGdpUsdBillions).toBe(5.5);
    expect(bosnia.economy.nominalGdpUsdBillions * bosnia.economy.debtRatioPct / 100).not.toBeCloseTo(8.73, 2);
    expect(usa.economy.nominalGdpUsdBillions / bosnia.economy.nominalGdpUsdBillions).toBeGreaterThan(1000);
    expect(usa.military.activePersonnel / bosnia.military.activePersonnel).toBeGreaterThan(20);
    expect(usa.military.readinessPct).not.toBe(bosnia.military.readinessPct);
    expect(bosnia.military.activePersonnel % 12000).not.toBe(0);
  });
  it('explicit 2000 date also prevents 2024 debt in raw engine consumers without a profile', () => {
    const account = WorldStateEngine.accounts(input().regions, { startDate: '2000-01-01', modernFacts: true }).BIH;
    expect(account.nominalGdpUsdBillions).toBe(5.5);
    expect(account.debtBurdenPct).toBe(0);
  });
  it('a map-authored microstate with small companies produces a valid reloadable fallback', () => {
    const spec = input('MICRO', 10_000);
    spec.regions[0].objects = [{ type: 'army', level: 4 }] as never;
    const profile = buildCountryInitialProfile(spec);
    expect(profile.military.formations).toBe(4);
    expect(profile.military.averageFormationSize).toBe(75);
    expect(validateCountryInitialProfile(profile, spec)).not.toBeNull();
  });
  it('an authored inland/river port remains canonical, but no extra coastal or naval inventory can be estimated', () => {
    const spec = input('ZETA', 1_000_000);
    spec.regions[0].objects = [{ type: 'port', level: 1 }] as never;
    const profile = buildCountryInitialProfile(spec);
    expect(validateCountryInitialProfile(profile, spec)).not.toBeNull();
    expect(validateCountryInitialProfile({ ...profile, infrastructure: { ...profile.infrastructure, ports: 2 } }, spec)).toBeNull();
    expect(validateCountryInitialProfile({ ...profile, military: { ...profile.military, equipmentProfile: { fregate: 1 } } }, spec)).toBeNull();
  });
  it('very small authored maps never persist a profile with fewer people than populated formations', () => {
    for (const population of [100, 50, 1]) {
      const spec = input('MICRO', population);
      spec.regions[0].objects = [{ type: 'army', level: 4 }] as never;
      const profile = buildCountryInitialProfile(spec);
      expect(validateCountryInitialProfile(profile, spec)).not.toBeNull();
    }
  });
  it('living units outrank initial formation counts, including a known zero after destruction', () => {
    const spec = input(); const profile = buildCountryInitialProfile(spec);
    const options = { startDate: spec.startDate, initialProfiles: { BIH: profile }, forceCountsByPolity: { BIH: 0 } };
    expect(WorldStateEngine.accounts(spec.regions, options).BIH.forces).toBe(0);
  });
  it('recruitment projects the same canonical profile/fiscal rates, not the legacy account', () => {
    const spec = input(); const profile = buildCountryInitialProfile(spec);
    const options = { startDate: spec.startDate, modernFacts: false, initialProfiles: { BIH: profile }, forceCountsByPolity: { BIH: 12 } };
    const account = WorldStateEngine.accounts(spec.regions, options).BIH;
    const impact = formationImpact({ epoch: 'moderno', account, units: {}, stock: seedStock(account), regions: spec.regions, options, targetRegionId: 'BIH', armyName: 'Army' });
    const expected = WorldStateEngine.accounts(spec.regions, { ...options, forceCountsByPolity: { BIH: 13 } }).BIH;
    expect(impact.after.monthlyExpenses).toBeCloseTo(expected.monthlyExpenses, 3);
    expect(impact.after.socialTension).toBe(expected.socialTension);
  });
  it('a small country does not inherit seven brigades from the same map index', () => {
    const small = buildCountryInitialProfile(input('SMALL', 100_000));
    expect(small.military.formations).toBeLessThan(7);
    expect(small.military.activePersonnel).toBeLessThanOrEqual(5000);
  });
  it('invalid estimates fail closed: NaN, personnel/population, bad formations/readiness, inland naval asset, future tech', () => {
    const base = buildCountryInitialProfile(input());
    for (const patch of [
      { economy: {} },
      { infrastructure: {} },
      { economy: { ...base.economy, treasuryUsdBillions: Number.NaN } },
      { military: { ...base.military, activePersonnel: 4_000_000 } },
      { military: { ...base.military, formations: 9999 } },
      { military: { ...base.military, readinessPct: 101 } },
      { military: { ...base.military, equipmentProfile: { fregata: 10 } } },
      { military: { ...base.military, equipmentProfile: { intelligenza_artificiale: 1 } } },
    ]) expect(validateCountryInitialProfile({ ...base, ...patch }, input())).toBeNull();
  });
  it('a valid completion fills unknown rates/readiness once without changing map assets', async () => {
    const spec = input('ZETA', 5_000_000);
    const base = buildCountryInitialProfile(spec);
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
      military: { ...base.military, readinessPct: 66, trainingPct: 82 } }));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.military.readinessPct).toBe(66);
    expect(result.military.trainingPct).toBe(82);
    expect(result.infrastructure).toEqual(base.infrastructure);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it.each(['BIH', 'USA'])('historical fallback does not override valid non-authoritative completion for %s 2000', async polityId => {
    const spec = input(polityId, polityId === 'USA' ? 282_000_000 : 3_750_000);
    const base = buildCountryInitialProfile(spec);
    const activePersonnel = Math.round(base.military.activePersonnel * 0.9);
    const estimate = { ...base,
      population: base.population + 100_000,
      economy: { ...base.economy, nominalGdpUsdBillions: base.economy.nominalGdpUsdBillions * 2,
        monthlyRevenue: base.economy.monthlyRevenue * 2, monthlyExpenses: base.economy.monthlyExpenses * 2,
        treasuryUsdBillions: base.economy.treasuryUsdBillions * 1.5, debtRatioPct: 20 },
      military: { ...base.military, activePersonnel,
        averageFormationSize: activePersonnel / base.military.formations,
        readinessPct: 68, trainingPct: 82, logisticsPct: 71, reservePersonnel: 10_000 },
    };
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify(estimate));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.military.activePersonnel).toBe(activePersonnel);
    expect(result.military.readinessPct).toBe(68);
    expect(result.military.trainingPct).toBe(82);
    expect(result.military.logisticsPct).toBe(71);
    expect(result.military.reservePersonnel).toBe(10_000);
    expect(result.economy.treasuryUsdBillions).toBe(estimate.economy.treasuryUsdBillions);
    expect(result.economy.nominalGdpUsdBillions).toBe(base.economy.nominalGdpUsdBillions);
    expect(result.population).toBe(base.population);
    expect(result.economy.debtRatioPct).toBe(polityId === 'USA' ? 55 : 20);
    expect(result.infrastructure).toEqual(base.infrastructure);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('a stuck completion is aborted at its deadline with no retry', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const pending = generateCountryInitialProfile(input(), async (_system, _prompt, currentSignal) => {
        signal = currentSignal; return new Promise<string>(() => {});
      });
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await pending).provenance.source).toBe('historical+map');
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('invalid or throwing LLM makes one attempt then returns exactly deterministic fallback', async () => {
    const base = buildCountryInitialProfile(input());
    let calls = 0;
    const result = await generateCountryInitialProfile(input(), async () => { calls++; return '{"military":{"activePersonnel":-1}}'; });
    expect(calls).toBe(1);
    expect(result.economy).toEqual(base.economy);
    expect(result.military).toEqual(base.military);
    expect(result.provenance.source).toBe(base.provenance.source);
    expect((await generateCountryInitialProfile(input(), async () => { throw new Error('offline'); })).economy).toEqual(base.economy);
  });
  it('historical and known map data prevail over an otherwise plausible LLM estimate', async () => {
    const base = buildCountryInitialProfile(input());
    const result = await generateCountryInitialProfile(input(), async () => JSON.stringify({ ...base, economy: { ...base.economy, nominalGdpUsdBillions: 8 }, population: 4_000_000 }));
    expect(result.economy.nominalGdpUsdBillions).toBe(5.5);
    expect(result.population).toBe(3_750_000);
  });
  it('profile rates are initial anchors, not frozen numbers: map growth evolves GDP and newly built assets still count', () => {
    const spec = input();
    const profile = buildCountryInitialProfile(spec);
    const options = { startDate: spec.startDate, modernFacts: false, initialProfiles: { BIH: profile } };
    const before = WorldStateEngine.accounts(spec.regions, options).BIH;
    const grown = [{ ...spec.regions[0], gdp: 20, objects: [{ type: 'factory', level: 1 }] }];
    const after = WorldStateEngine.accounts(grown, options).BIH;
    expect(after.nominalGdpUsdBillions).toBeCloseTo(before.nominalGdpUsdBillions * 2);
    expect(after.factories).toBe(before.factories + 1);
    expect(after.monthlyRevenue).toBeGreaterThan(before.monthlyRevenue);
  });
});
