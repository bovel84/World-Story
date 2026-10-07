import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible';
import { AnthropicProvider } from '../src/llm/anthropic';
import { formationImpact } from '../src/core/simulation/OperationalObjects';
import { seedStock, storageCapacity, initialResearchCap } from '../src/core/simulation/MaterialEconomy';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import { buildCountryInitialProfile, validateCountryInitialProfile, generateCountryInitialProfile, infrastructureCaps, militaryValidationReason } from '../src/core/simulation/CountryInitialProfile';
import { EQUIPMENT_CREW } from '../src/core/simulation/MilitaryIndustry';
import { epochForDate, militaryManpower } from '../src/core/simulation/MilitaryDoctrine';
import { referenceDebtToGdpPctForDate, referencePopulationForDate, referenceGdpUsdBillionsForDate, isLandlockedPolity } from '../src/utils/country-facts';
import type { CountryProfileInput, CountryInitialProfile } from '../src/core/simulation/CountryInitialProfile';
import { LLMError } from '../src/llm/types';
const input = (polityId = 'BIH', population = 3_750_000) => ({
  polityId, startDate: '2000-01-01', regions: [{ id: polityId, owner: polityId, population, gdp: 10, militaryPower: 20, coastal: false, objects: [] }],
});

/** Smista un profilo "pieno" nelle tre call sequenziali. Per national-state,
 * quando manca la reference, non ricopia il totale di mappa: usa una stima
 * storica distinta (0.6x), altrimenti l'anti-copy la scarterebbe. */
const testCompleter = (profile: any) => async (_system: string, prompt: string) => {
  const { section, fallback } = JSON.parse(prompt) as { section: string; fallback: any };
  if (section === 'economy') return JSON.stringify({ economy: profile.economy ?? fallback });
  if (section === 'national-state') {
    const population = fallback.population ?? Math.max(1, Math.round((profile.population ?? 1) * 0.6));
    return JSON.stringify({ population, society: profile.society ?? fallback.society, infrastructure: profile.infrastructure ?? fallback.infrastructure });
  }
  return JSON.stringify({ military: profile.military ?? fallback.military, ...(profile.resources ? { resources: profile.resources } : {}) });
};

/** Sezione militare LLM controllata: economia e stato nazionale validi, military custom. */
const militaryCompleter = (military: Record<string, unknown>) => async (_system: string, prompt: string) => {
  const { section, fallback } = JSON.parse(prompt) as { section: string; fallback: any };
  if (section === 'economy') return JSON.stringify({ economy: { ...fallback, debtRatioPct: 25 } });
  if (section === 'national-state') return JSON.stringify({ population: fallback.population, society: fallback.society, infrastructure: fallback.infrastructure });
  return JSON.stringify({ military });
};
describe('Country/date-agnostic initial Dossier', () => {
  const scenarios = [
    { polityId: 'UGA', countryName: 'Uganda', startDate: '2000-01-01', population: 50_000_000, gdp: 50, factories: 2, armies: 2 },
    { polityId: 'FRA', countryName: 'Francia', startDate: '1940-01-01', population: 68_000_000, gdp: 1500, factories: 8, armies: 8 },
    { polityId: 'KHM', countryName: 'Cambogia', startDate: '1975-01-01', population: 16_000_000, gdp: 30, factories: 1, armies: 3 },
    { polityId: 'ARG', countryName: 'Argentina', startDate: '1982-01-01', population: 45_000_000, gdp: 450, factories: 5, armies: 5 },
    { polityId: 'JPN', countryName: 'Giappone', startDate: '2000-01-01', population: 125_000_000, gdp: 4966, factories: 10, armies: 6 },
  ];
  const specFor = (scenario: typeof scenarios[number]): CountryProfileInput => ({
    polityId: scenario.polityId, countryName: scenario.countryName, startDate: scenario.startDate,
    historicalBaseline: `Fixture ${scenario.countryName} prima di ${scenario.startDate}: capacità e istituzioni documentate nel periodo.`,
    regions: [{ id: `${scenario.polityId}-home`, owner: scenario.polityId, population: scenario.population,
      gdp: scenario.gdp, militaryPower: scenario.armies * 10, coastal: true,
      objects: [{ type: 'factory', level: scenario.factories }, { type: 'university', level: 1 }, { type: 'army', level: scenario.armies }] }],
  });
  // A single fake completion algorithm, driven by the inputs rather than by
  // nation branches. Values are test estimates, NOT a historical database.
  const completeFor = (spec: CountryProfileInput, prompts: Record<string, any>[] = []) => async (_system: string, prompt: string) => {
    const payload = JSON.parse(prompt);
    prompts.push(payload);
    const mapPopulation = spec.regions.reduce((n, region) => n + region.population, 0);
    const population = referencePopulationForDate(spec.polityId, spec.startDate) ?? Math.round(mapPopulation * 0.6);
    const factories = spec.regions[0].objects![0].level!;
    const gdp = referenceGdpUsdBillionsForDate(spec.polityId, spec.startDate) ?? spec.regions[0].gdp / 10;
    const active = Math.floor(population * 0.002);
    if (payload.section === 'economy') return JSON.stringify({ economy: {
      nominalGdpUsdBillions: gdp, debtRatioPct: 30, treasuryUsdBillions: gdp * 0.02,
      taxRatePct: 20, monthlyRevenue: gdp * 20 / 1200, monthlyExpenses: gdp * 0.25 / 12,
    } });
    if (payload.section === 'national-state') return JSON.stringify({ population,
      society: { stability: 50 + factories, socialTension: 50 - factories },
      infrastructure: { factories: factories + 2, universities: 2, ports: isLandlockedPolity(spec.polityId) ? 0 : 1 },
    });
    return JSON.stringify({ military: {
      activePersonnel: active, reservePersonnel: active, formations: Math.ceil(active / 5000),
      readinessPct: 30 + factories * 3, defenceBurdenPct: 3,
      trainingPct: 50, qualityPct: 50, logisticsPct: 50,
      equipmentProfile: { fucili: active, apc: 1, carri_4: 1, droni_attacco: 1 },
    }, resources: { food: 1, clothing: 1, weapons: 1, fuel: 0.5, research: factories } });
  };

  it.each(scenarios)('$polityId@$startDate: missing references do not prevent a complete, valid Dossier', async scenario => {
    const spec = specFor(scenario);
    const prompts: Record<string, any>[] = [];
    const result = await generateCountryInitialProfile(spec, completeFor(spec, prompts), { requireEstimate: true });
    expect(prompts).toHaveLength(3);
    for (const payload of prompts) {
      expect(payload.polityId).toBe(spec.polityId);
      expect(payload.country).toBe(spec.countryName);
      expect(payload.startDate).toBe(spec.startDate);
      expect(payload.historicalBaseline).toBe(spec.historicalBaseline);
    }
    expect(result.population).toBeGreaterThan(0);
    expect(result.economy.nominalGdpUsdBillions).toBeGreaterThan(0);
    expect(result.provenance.source).toBe('llm-estimate');
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
    expect(militaryValidationReason(result.military, spec, result.population)).toBeNull();
    expect(result.military.activePersonnel).toBeLessThanOrEqual(result.population * 0.05);
    expect(result.military.activePersonnel + result.military.reservePersonnel).toBeLessThanOrEqual(result.population * 0.2);
    expect(result.infrastructure.factories).toBeGreaterThanOrEqual(scenario.factories);
    if (isLandlockedPolity(spec.polityId)) expect(result.infrastructure.ports).toBe(0);
    const allowed = prompts[2].allowedEquipmentIds as string[];
    for (const id of Object.keys(result.military.equipmentProfile)) expect(allowed).toContain(id);
    expect(result.military.equipmentProfile.carri_4).toBeUndefined();
    expect(result.military.equipmentProfile.droni_attacco).toBeUndefined();
    expect(result.resources?.food).toBeGreaterThan(0);
    const fallback = buildCountryInitialProfile(spec);
    expect(validateCountryInitialProfile(fallback, spec)).not.toBeNull();
    expect(referencePopulationForDate(spec.polityId, spec.startDate)).toBeNull();
    expect(referenceDebtToGdpPctForDate(spec.polityId, spec.startDate)).toBeNull();
  });

  it('different inputs produce different population, GDP, military, infrastructure and resources without nation templates', async () => {
    const profiles: CountryInitialProfile[] = [];
    for (const scenario of [scenarios[0], scenarios[4]]) {
      const spec = specFor(scenario);
      profiles.push(await generateCountryInitialProfile(spec, completeFor(spec), { requireEstimate: true }));
    }
    const [small, large] = profiles;
    expect(small.population).not.toBe(large.population);
    expect(small.economy.nominalGdpUsdBillions).not.toBe(large.economy.nominalGdpUsdBillions);
    expect(small.military.activePersonnel).not.toBe(large.military.activePersonnel);
    expect(small.military.readinessPct).not.toBe(large.military.readinessPct);
    expect(small.infrastructure).not.toEqual(large.infrastructure);
    expect(small.resources).not.toEqual(large.resources);
  });

  it.each(['BIH', 'USA'])('%s legacy rates/manpower must not seed the normal LLM request', async polityId => {
    const spec = input(polityId, referencePopulationForDate(polityId, '2000-01-01')!);
    const account = WorldStateEngine.accounts(spec.regions, { startDate: spec.startDate, modernFacts: false })[polityId];
    const doctrine = militaryManpower({ population: account.population, formations: account.forces, mobilizedFormations: 0, epoch: epochForDate(spec.startDate) });
    const prompts: Record<string, any>[] = [];
    // Optional partial LLM failure intentionally tests the generic fallback path.
    await generateCountryInitialProfile(spec, async (_system, prompt) => { prompts.push(JSON.parse(prompt)); return '{}'; });
    expect(prompts[0].fallback.taxRatePct).toBe(account.taxRatePct);
    expect(prompts[1].fallback.society.stability).toBe(account.stability);
    expect(prompts[1].fallback.society.socialTension).toBe(account.socialTension);
    expect(prompts[2].fallback.military.activePersonnel).toBe(Math.floor(Math.min(account.population * 0.03, doctrine.activePersonnel)));
    expect(prompts[2].fallback.military.defenceBurdenPct).toBe(account.defenceBurdenPct);
  });

  it('Country X in 1940 vs 2000 gets date-specific baseline, GDP fallback and equipment allowances', async () => {
    const promptsByDate: Record<string, any>[][] = [];
    const profiles: CountryInitialProfile[] = [];
    for (const startDate of ['1940-01-01', '2000-01-01']) {
      const spec = specFor({ ...scenarios[1], polityId: 'COUNTRY_X', countryName: 'Country X', startDate });
      const prompts: Record<string, any>[] = [];
      profiles.push(await generateCountryInitialProfile(spec, completeFor(spec, prompts), { requireEstimate: true }));
      promptsByDate.push(prompts);
    }
    const [early, late] = promptsByDate;
    expect(early[0].historicalBaseline).not.toBe(late[0].historicalBaseline);
    expect(early[0].fallback.nominalGdpUsdBillions).not.toBe(late[0].fallback.nominalGdpUsdBillions);
    expect(early[2].limits.epoch).not.toBe(late[2].limits.epoch);
    expect(early[2].allowedEquipmentIds).not.toContain('caccia_4');
    expect(late[2].allowedEquipmentIds).toContain('caccia_4');
    for (const profile of profiles) expect(profile.military.equipmentProfile.carri_4).toBeUndefined();
  });

  it('a neighbouring-year GDP observation is not an immutable anchor for a different start date', async () => {
    const spec = specFor(scenarios[1]);
    const result = await generateCountryInitialProfile(spec, completeFor(spec), { requireEstimate: true });
    expect(referenceGdpUsdBillionsForDate(spec.polityId, spec.startDate)).toBeNull();
    expect(result.economy.nominalGdpUsdBillions).toBe(spec.regions[0].gdp / 10);
  });
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
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
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
    const result = await generateCountryInitialProfile(spec, testCompleter(estimate));
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
      await vi.advanceTimersByTimeAsync(60_001);
      expect((await pending).provenance.source).toBe('historical+map');
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it.each(['offline', 'not json', '{}', 'null', '{"military":{"activePersonnel":-1}}'])('required player estimate fails closed: %s', async response => {
    const complete = vi.fn(async () => {
      if (response === 'offline') throw new Error('offline');
      return response;
    });
    await expect(generateCountryInitialProfile(input(), complete, { requireEstimate: true })).rejects.toThrow(/profilo iniziale.*partita non creata/i);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(['openai-error', 'anthropic-error', 'reasoning-empty'])('bootstrap singleAttempt disables provider retries: %s', async kind => {
    const fetchMock = vi.fn(async () => kind === 'reasoning-empty'
      ? new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { status: 200 })
      : new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const config = { baseUrl: 'https://example.invalid', apiKey: 'test', model: 'test', retries: 2 };
      const provider = kind === 'anthropic-error' ? new AnthropicProvider(config) : new OpenAICompatibleProvider(config);
      await expect(provider.generate('system', 'prompt', { singleAttempt: true })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('required player estimate accepts a slow completion after 30s but before 60s', async () => {
    vi.useFakeTimers();
    try {
      const spec = input('ZETA', 5_000_000);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const complete = vi.fn(async (_system: string, prompt: string) => {
        await gate;
        const { section, fallback, anchors } = readPrompt(prompt);
        return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 40 } : raw);
      });
      const pending = generateCountryInitialProfile(spec, complete, { requireEstimate: true });
      await vi.advanceTimersByTimeAsync(30_000);
      release();
      const result = await pending;
      expect(result.provenance.source).toBe('llm-estimate');
      expect(result.economy.debtRatioPct).toBe(40);
      expect(complete).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
  it('required player estimate times out at the section deadline without a retry or fallback', async () => {
    vi.useFakeTimers();
    try {
      const complete = vi.fn(async () => new Promise<string>(() => {}));
      const pending = generateCountryInitialProfile(input(), complete, { requireEstimate: true });
      const rejected = expect(pending).rejects.toThrow(/tempo.*partita non creata/i);
      await vi.advanceTimersByTimeAsync(60_001);
      await rejected;
      expect(complete).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(['debtRatioPct', 'nominalGdpUsdBillions', 'treasuryUsdBillions'])('required estimate rejects missing %s instead of inventing economic anchors', async field => {
    const spec = input('ZETA', 5_000_000);
    const base = buildCountryInitialProfile(spec);
    const economy = { ...base.economy, [field]: undefined };
    await expect(generateCountryInitialProfile(spec, testCompleter({ ...base, economy }), { requireEstimate: true })).rejects.toThrow(/profilo iniziale/i);
  });
  it('required estimate rejects the final firewall failure instead of returning fallback', async () => {
    const spec = input('ZETA', 5_000_000);
    const base = buildCountryInitialProfile(spec);
    await expect(generateCountryInitialProfile(spec, testCompleter({ ...base,
      economy: { ...base.economy, nominalGdpUsdBillions: 999_999 } }), { requireEstimate: true })).rejects.toThrow(/profilo iniziale/i);
  });
  it('invalid or throwing optional LLM retains the generic deterministic fallback, without legacy country rates', async () => {
    const base = buildCountryInitialProfile(input(), { legacyHistoricalAnchors: false });
    let calls = 0;
    const result = await generateCountryInitialProfile(input(), async () => { calls++; return '{"military":{"activePersonnel":-1}}'; });
    expect(calls).toBe(3);
    expect(result.economy).toEqual(base.economy);
    expect(result.military).toEqual(base.military);
    expect(result.provenance.source).toBe(base.provenance.source);
    expect((await generateCountryInitialProfile(input(), async () => { throw new Error('offline'); })).economy).toEqual(base.economy);
  });
  it('historical and known map data prevail over an otherwise plausible LLM estimate', async () => {
    const base = buildCountryInitialProfile(input());
    const result = await generateCountryInitialProfile(input(), testCompleter({ ...base, economy: { ...base.economy, nominalGdpUsdBillions: 8 }, population: 4_000_000 }));
    expect(result.economy.nominalGdpUsdBillions).toBe(5.5);
    expect(result.population).toBe(3_750_000);
  });
  it('two different countries in the same year get substantially different profiles and equipment', async () => {
    const usaSpec = input('USA', 282_000_000);
    const bihSpec = input('BIH', 3_750_000);
    const usa = await generateCountryInitialProfile(usaSpec, testCompleter(buildCountryInitialProfile(usaSpec)));
    const bih = await generateCountryInitialProfile(bihSpec, testCompleter(buildCountryInitialProfile(bihSpec)));
    expect(usa.provenance.source).toBe('llm-estimate');
    expect(bih.provenance.source).toBe('llm-estimate');
    expect(usa.economy.nominalGdpUsdBillions / bih.economy.nominalGdpUsdBillions).toBeGreaterThan(100);
    expect(usa.military.activePersonnel / bih.military.activePersonnel).toBeGreaterThan(20);
    expect(usa.military.readinessPct).not.toBe(bih.military.readinessPct);
    expect(usa.military.equipmentProfile).not.toEqual(bih.military.equipmentProfile);
    expect(validateCountryInitialProfile(usa, usaSpec)).not.toBeNull();
    expect(validateCountryInitialProfile(bih, bihSpec)).not.toBeNull();
  });
  it('the same country in 1940 and 2024 cannot receive the same equipment or future technology', () => {
    const spec1940 = { ...input('USA', 131_000_000), startDate: '1940-06-01' };
    const spec2024 = { ...input('USA', 340_000_000), startDate: '2024-01-01' };
    const y1940 = buildCountryInitialProfile(spec1940);
    const y2024 = buildCountryInitialProfile(spec2024);
    expect(validateCountryInitialProfile(y1940, spec1940)).not.toBeNull();
    expect(validateCountryInitialProfile(y2024, spec2024)).not.toBeNull();
    expect(y1940.military.equipmentProfile).not.toEqual(y2024.military.equipmentProfile);
    expect(y1940.military.equipmentProfile.caccia_5 ?? 0).toBe(0);
    expect(y1940.military.equipmentProfile.droni_attacco ?? 0).toBe(0);
    expect(validateCountryInitialProfile({ ...y1940, military: { ...y1940.military, equipmentProfile: { caccia_5: 10 } } }, spec1940)).toBeNull();
  });
  it('a landlocked country gets no invented ports or navy even from the LLM bootstrap', async () => {
    const spec = input('BOL', 8_000_000);
    const base = buildCountryInitialProfile(spec);
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      infrastructure: { ...base.infrastructure, ports: 5 },
      military: { ...base.military, equipmentProfile: { fregate: 3 } } }));
    expect(result.infrastructure.ports).toBe(base.infrastructure.ports);
    // L'asset navale viene scartato, ma la sezione resta quella dell'LLM (non un fallback totale).
    expect(result.military.equipmentProfile).toEqual({});
    expect(result.military.activePersonnel).toBe(base.military.activePersonnel);
    expect(result.military.formations).toBe(base.military.formations);
    expect(result.provenance.source).toBe(base.provenance.source);
  });

  // --- Bootstrap militare: normalizzazione prima della validazione. ---
  const militaryBase = {
    activePersonnel: 45000, reservePersonnel: 30000, formations: 16,
    readinessPct: 45, defenceBurdenPct: 2, trainingPct: 45, qualityPct: 45, logisticsPct: 45,
    equipmentProfile: { fucili: 45000 } as Record<string, number>,
  };

  it('A — averageFormationSize è derivato dal server, non richiesto all LLM', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase }));
    expect(result.military.averageFormationSize).toBeCloseTo(45000 / 16);
    expect(result.military.activePersonnel).toBe(45000);
    expect(result.provenance.notes.join(' ')).toContain('military-resources: llm-estimate');
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('B — un ID equipment sconosciuto viene scartato, non fa fallire la sezione', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, equipmentProfile: { 'MiG-21': 12, fucili: 30000 } }));
    expect(result.military.equipmentProfile['MiG-21']).toBeUndefined();
    expect(result.military.equipmentProfile.fucili).toBe(30000);
    expect(result.provenance.notes.join(' ')).toContain('military-resources: llm-estimate');
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('C — asset navale in paese senza costa viene scartato, sezione valida', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, equipmentProfile: { fregate: 2, fucili: 1000 } }));
    expect(result.military.equipmentProfile.fregate).toBeUndefined();
    expect(result.military.equipmentProfile.fucili).toBe(1000);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('D — equipment fuori epoca viene scartato', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, equipmentProfile: { sciame: 3, fucili: 1000 } }));
    expect(result.military.equipmentProfile.sciame).toBeUndefined();
    expect(result.military.equipmentProfile.fucili).toBe(1000);
  });

  it('E — quantità eccessiva clampata al limite server-side', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, equipmentProfile: { fucili: 10_000_000 } }));
    expect(result.military.equipmentProfile.fucili).toBe(90000);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('F — equipaggio superiore agli effettivi ridotto deterministicamente', async () => {
    const spec = input('USA', 282_000_000);
    spec.regions[0].coastal = true;
    const result = await generateCountryInitialProfile(spec, militaryCompleter({
      ...militaryBase, activePersonnel: 200, reservePersonnel: 0, formations: 1,
      equipmentProfile: { fregate: 10, fucili: 200 },
    }));
    const crew = Object.entries(result.military.equipmentProfile).reduce((sum, [id, quantity]) => sum + (EQUIPMENT_CREW[id] ?? 0) * quantity, 0);
    expect(result.military.activePersonnel).toBe(200);
    expect(crew).toBeLessThanOrEqual(result.military.activePersonnel);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('G — activePersonnel oltre il 5% della popolazione fallisce chiuso', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, activePersonnel: 200_000, formations: 40 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('H — active + reserve oltre il 20% fallisce chiuso', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, activePersonnel: 100_000, reservePersonnel: 700_000, formations: 20 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('I — formazioni impossibili falliscono chiuse', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, activePersonnel: 1000, formations: 0 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('J — diagnostica militare restituisce il motivo corretto', () => {
    const spec = input('BIH', 3_750_000);
    const base = { activePersonnel: 1000, reservePersonnel: 0, formations: 1, averageFormationSize: 1000, readinessPct: 50, defenceBurdenPct: 2, trainingPct: 50, qualityPct: 50, logisticsPct: 50, equipmentProfile: {} };
    expect(militaryValidationReason(base, spec, 3_750_000)).toBeNull();
    expect(militaryValidationReason({ ...base, activePersonnel: 200_000 }, spec, 3_750_000)).toBe('active_share_exceeded');
    expect(militaryValidationReason({ ...base, activePersonnel: 1000, formations: 0, averageFormationSize: 0 }, spec, 3_750_000)).toBe('invalid_formations');
  });

  // --- Campi militari FONDAMENTALI: strict, nessuna coercizione. ---
  it('STRICT-A — activePersonnel non intero non viene arrotondato: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, activePersonnel: 45000.7 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-B — activePersonnel stringa non viene convertito: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, activePersonnel: '45000' }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-C — reservePersonnel non intero: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, reservePersonnel: 30000.5 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-D — formations non intere: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, formations: 16.5 }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-E — readinessPct stringa non viene convertita: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, readinessPct: '45' }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-F — readinessPct null: fail-closed', async () => {
    const spec = input('BIH', 3_750_000);
    await expect(generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, readinessPct: null }), { requireEstimate: true }))
      .rejects.toThrow(/sezione militare non valida/i);
  });

  it('STRICT-G — valori number/interi corretti restano validi', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase }), { requireEstimate: true });
    expect(result.military.activePersonnel).toBe(45000);
    expect(result.military.readinessPct).toBe(45);
    expect(result.provenance.notes.join(' ')).toContain('military-resources: llm-estimate');
  });

  it('STRICT-H — equipment resta sanitizzato (ID ignoto scartato, quantità clampata)', async () => {
    const spec = input('BIH', 3_750_000);
    const result = await generateCountryInitialProfile(spec, militaryCompleter({ ...militaryBase, equipmentProfile: { 'MiG-21': 12, fucili: 10_000_000 } }), { requireEstimate: true });
    expect(result.military.equipmentProfile['MiG-21']).toBeUndefined();
    expect(result.military.equipmentProfile.fucili).toBe(90000);
  });

  it('STRICT-I — diagnostica coerente sui nuovi casi strict', () => {
    const spec = input('BIH', 3_750_000);
    const base = { activePersonnel: 1000, reservePersonnel: 0, formations: 1, averageFormationSize: 1000, readinessPct: 50, defenceBurdenPct: 2, trainingPct: 50, qualityPct: 50, logisticsPct: 50, equipmentProfile: {} };
    expect(militaryValidationReason({ ...base, activePersonnel: 45000.7 }, spec, 3_750_000)).toBe('personnel_not_integer');
    expect(militaryValidationReason({ ...base, activePersonnel: '45000' }, spec, 3_750_000)).toBe('invalid_shape');
    expect(militaryValidationReason({ ...base, formations: 16.5, averageFormationSize: 1000 / 16.5 }, spec, 3_750_000)).toBe('personnel_not_integer');
    expect(militaryValidationReason({ ...base, readinessPct: '45' }, spec, 3_750_000)).toBe('invalid_percentage');
    expect(militaryValidationReason({ ...base, readinessPct: null }, spec, 3_750_000)).toBe('invalid_percentage');
  });

  it('explicit preset/map data is never overwritten, but a valid larger national infrastructure survives', async () => {
    const spec = input('BIH', 3_750_000);
    spec.regions[0].objects = [{ type: 'factory', level: 1 }, { type: 'university', level: 2 }] as never;
    const base = buildCountryInitialProfile(spec);
    const caps = infrastructureCaps(spec);
    expect(base.mapBaseline.factories).toBe(1);
    expect(base.mapBaseline.universities).toBe(2);
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      mapBaseline: { ...base.mapBaseline, gdp: 9_999, militaryPower: 9_999 },
      population: base.population + 500_000,
      infrastructure: { factories: caps.factories, ports: caps.ports, universities: caps.universities } }));
    expect(result.mapBaseline).toEqual(base.mapBaseline);
    expect(result.mapBaseline.gdp).not.toBe(9_999);
    expect(result.population).toBe(base.population);
    expect(result.infrastructure).toEqual({ factories: caps.factories, ports: caps.ports, universities: caps.universities });
    expect(result.infrastructure.factories).toBeGreaterThanOrEqual(base.mapBaseline.factories);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('two countries without hardcoded estimates keep nation-specific LLM profiles and resources', async () => {
    const ugandaSpec = input('UGA', 24_000_000);
    const cambodiaSpec = input('KHM', 12_000_000);
    cambodiaSpec.regions[0].coastal = true;
    const ugandaBase = buildCountryInitialProfile(ugandaSpec);
    const cambodiaBase = buildCountryInitialProfile(cambodiaSpec);
    const uganda = await generateCountryInitialProfile(ugandaSpec, testCompleter({ ...ugandaBase,
      economy: { ...ugandaBase.economy, treasuryUsdBillions: 0.4 },
      military: { ...ugandaBase.military, activePersonnel: 45_000, reservePersonnel: 20_000, formations: 12,
        averageFormationSize: 3_750, readinessPct: 35, trainingPct: 30, logisticsPct: 28,
        equipmentProfile: { fucili: 45_000, apc: 120 } },
      infrastructure: { factories: 6, ports: 0, universities: 4 },
      resources: { food: 1.5, clothing: 1, weapons: 2, fuel: 1.5, research: 30,
        technologies: ['agricoltura_meccanizzata', 'industria_tessile'] } }));
    const cambodia = await generateCountryInitialProfile(cambodiaSpec, testCompleter({ ...cambodiaBase,
      economy: { ...cambodiaBase.economy, treasuryUsdBillions: 1.2 },
      military: { ...cambodiaBase.military, activePersonnel: 90_000, reservePersonnel: 60_000, formations: 20,
        averageFormationSize: 4_500, readinessPct: 52, trainingPct: 48, logisticsPct: 44,
        equipmentProfile: { fucili: 90_000, apc: 300, artiglieria: 60 } },
      infrastructure: { factories: 10, ports: 4, universities: 6 },
      resources: { food: 2, clothing: 1.5, weapons: 4, fuel: 2, research: 90,
        technologies: ['industria_bellica', 'motorizzazione'] } }));
    expect(uganda.provenance.source).toBe('llm-estimate');
    expect(cambodia.provenance.source).toBe('llm-estimate');
    expect(validateCountryInitialProfile(uganda, ugandaSpec)).not.toBeNull();
    expect(validateCountryInitialProfile(cambodia, cambodiaSpec)).not.toBeNull();
    expect(uganda.military.activePersonnel).not.toBe(cambodia.military.activePersonnel);
    expect(uganda.military.reservePersonnel).not.toBe(cambodia.military.reservePersonnel);
    expect(uganda.military.readinessPct).not.toBe(cambodia.military.readinessPct);
    expect(uganda.military.trainingPct).not.toBe(cambodia.military.trainingPct);
    expect(uganda.military.logisticsPct).not.toBe(cambodia.military.logisticsPct);
    expect(uganda.military.equipmentProfile).not.toEqual(cambodia.military.equipmentProfile);
    expect(uganda.infrastructure).not.toEqual(cambodia.infrastructure);
    expect(uganda.economy.treasuryUsdBillions).not.toBe(cambodia.economy.treasuryUsdBillions);
    expect(uganda.resources?.technologies).not.toEqual(cambodia.resources?.technologies);
    expect(uganda.resources?.research).not.toBe(cambodia.resources?.research);
  });
  it('anachronistic technology is refused by the firewall and stripped without discarding the profile', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    expect(validateCountryInitialProfile({ ...base, resources: { technologies: ['intelligenza_artificiale'] } }, spec)).toBeNull();
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      resources: { research: 10, technologies: ['intelligenza_artificiale'] } }));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.resources?.technologies ?? []).not.toContain('intelligenza_artificiale');
    expect(result.resources?.research).toBe(10);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('unknown technology ids are refused by the firewall and stripped without discarding the profile', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    expect(validateCountryInitialProfile({ ...base, resources: { technologies: ['tecnologia_fantasma'] } }, spec)).toBeNull();
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      resources: { research: 5, technologies: ['tecnologia_fantasma'] } }));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.resources?.technologies ?? []).toEqual([]);
    expect(result.resources?.research).toBe(5);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('material stocks far beyond storage capacity are clamped to the warehouse ceiling', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    const account = WorldStateEngine.accounts(spec.regions, { startDate: spec.startDate, modernFacts: false }).UGA;
    const cap = storageCapacity(account);
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      resources: { food: cap.food * 1000, clothing: cap.clothing * 1000, weapons: cap.weapons * 1000, fuel: cap.fuel * 1000 } }));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.resources?.food).toBeCloseTo(cap.food, 3);
    expect(result.resources?.clothing).toBeCloseTo(cap.clothing, 3);
    expect(result.resources?.weapons).toBeCloseTo(cap.weapons, 3);
    expect(result.resources?.fuel).toBeCloseTo(cap.fuel, 3);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
    // Una semina legacy (senza resources) resta identica alla deterministica.
    const baseline = seedStock(account);
    const legacy = seedStock(account, {}, '', base.economy.treasuryUsdBillions, base.resources);
    expect(legacy.food).toBe(baseline.food);
    expect(legacy.clothing).toBe(baseline.clothing);
    expect(legacy.weapons).toBe(baseline.weapons);
    expect(legacy.fuel).toBe(baseline.fuel);
    expect(legacy.research).toBe(baseline.research);
    expect(legacy.technologies).toEqual(baseline.technologies);
  });
  it('research far beyond the national cap is clamped before validation and seeding', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    const account = WorldStateEngine.accounts(spec.regions, { startDate: spec.startDate, modernFacts: false }).UGA;
    const cap = initialResearchCap(account);
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      resources: { research: 999_999_999 } }));
    expect(result.provenance.source).toBe('llm-estimate');
    expect(result.resources?.research).toBe(cap);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
    // Un profilo persistito/manomesso resta fail-closed sopra il cap.
    expect(validateCountryInitialProfile({ ...base, resources: { research: cap + 1 } }, spec)).toBeNull();
    // La semina riceve il valore clampato, non quello enorme.
    const seeded = seedStock(account, {}, '', result.economy.treasuryUsdBillions, result.resources);
    expect(seeded.research).toBe(cap);
  });
  it('a small country cannot claim hundreds of factories', () => {
    const spec = input('BIH', 3_750_000);
    const base = buildCountryInitialProfile(spec);
    expect(validateCountryInitialProfile({ ...base, infrastructure: { ...base.infrastructure, factories: 900 } }, spec)).toBeNull();
  });
  it('a large power with high but plausible infrastructure is accepted', () => {
    const spec = input('USA', 282_000_000);
    spec.regions[0].coastal = true;
    spec.regions[0].objects = [{ type: 'factory', level: 3 }, { type: 'port', level: 2 }] as never;
    const base = buildCountryInitialProfile(spec);
    const caps = infrastructureCaps(spec);
    const infra = { factories: Math.min(caps.factories, 200), ports: Math.min(caps.ports, 40), universities: Math.min(caps.universities, 90) };
    expect(infra.factories).toBeGreaterThan(100);
    expect(validateCountryInitialProfile({ ...base, infrastructure: infra }, spec)).not.toBeNull();
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
  it('keeps a valid LLM debt/treasury when another economy field is invalid (missing reference debt stays unknown, not 0)', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    expect(referenceDebtToGdpPctForDate('UGA', '2000-01-01')).toBeNull();
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      economy: { ...base.economy, debtRatioPct: 42, treasuryUsdBillions: 0.4, taxRatePct: 25, monthlyExpenses: 999_999 } }), { requireEstimate: true });
    expect(result.economy.debtRatioPct).toBe(42);
    expect(result.economy.treasuryUsdBillions).toBe(0.4);
    expect(result.economy.taxRatePct).toBe(25);
    expect(result.economy.monthlyExpenses).toBe(base.economy.monthlyExpenses);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('an incoherent revenue/expenses only falls back on that field, keeping the other LLM economy fields', async () => {
    const spec = input('UGA', 24_000_000);
    const base = buildCountryInitialProfile(spec);
    const result = await generateCountryInitialProfile(spec, testCompleter({ ...base,
      economy: { ...base.economy, debtRatioPct: 42, treasuryUsdBillions: 0.4, taxRatePct: 25,
        monthlyRevenue: 999_999, monthlyExpenses: 999_999 } }));
    expect(result.economy.debtRatioPct).toBe(42);
    expect(result.economy.treasuryUsdBillions).toBe(0.4);
    expect(result.economy.taxRatePct).toBe(25);
    expect(result.economy.monthlyRevenue).not.toBe(999_999);
    expect(Math.abs(result.economy.monthlyRevenue - result.economy.nominalGdpUsdBillions * 25 / 1200)).toBeLessThan(1e-5);
    expect(result.economy.monthlyExpenses).toBe(base.economy.monthlyExpenses);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });
  it('geography: North Korea is not landlocked, Bolivia and Uganda are', () => {
    expect(isLandlockedPolity('PRK')).toBe(false);
    expect(isLandlockedPolity('BOL')).toBe(true);
    expect(isLandlockedPolity('UGA')).toBe(true);
  });

  // --- Split bootstrap: tre completion sequenziali per sezione (economia →
  // stato nazionale → militare/risorse), merge e fail-closed del player. ---
  const readPrompt = (prompt: string) => JSON.parse(prompt) as { section: string; fallback: any; anchors?: any };
  /** Risposta per sezione; per national-state senza reference inietta una
   * popolazione storica distinta dalla mappa (altrimenti l'anti-copy scarta). */
  const profileReply = (section: string, fallback: any, anchors: any, patch: (raw: any) => any = raw => raw) => {
    if (section === 'economy') return JSON.stringify({ economy: patch(fallback) });
    if (section === 'national-state') {
      const raw = fallback.population == null
        ? { ...fallback, population: Math.max(1, Math.round((anchors?.mapPopulation ?? 1) * 0.6)) }
        : fallback;
      return JSON.stringify(patch(raw));
    }
    return JSON.stringify(patch(fallback));
  };

  it('A — three sections run as three sequential completions and merge into a valid profile', async () => {
    const spec = input('UGA', 24_000_000);
    const order: string[] = [];
    let active = 0, maxConcurrent = 0;
    const complete = vi.fn(async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      active++; maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      active--; order.push(section);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(order).toEqual(['economy', 'national-state', 'military-resources']);
    expect(maxConcurrent).toBe(1);
    expect(result.economy.debtRatioPct).toBe(30);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('B — a valid LLM debt estimate fills a missing historical reference (never 0)', async () => {
    const spec = input('UGA', 24_000_000);
    expect(referenceDebtToGdpPctForDate('UGA', '2000-01-01')).toBeNull();
    const complete = async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 42 } : raw);
    };
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(result.economy.debtRatioPct).toBe(42);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('C — an LLM population estimate is used only when no historical reference exists', async () => {
    const spec = input('UGA', 24_000_000);
    expect(referencePopulationForDate('UGA', '2000-01-01')).toBeNull();
    const complete = async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 42 }
        : section === 'national-state' ? { ...raw, population: 16_000_000 } : raw);
    };
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(result.population).toBe(16_000_000);
    // Il riferimento storico (BIH 2000) vince su qualunque stima LLM.
    const bih = input('BIH', 3_750_000);
    const bihResult = await generateCountryInitialProfile(bih, async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 42 }
        : section === 'national-state' ? { ...raw, population: 9_000_000 } : raw);
    }, { requireEstimate: true });
    expect(bihResult.population).toBe(3_750_000);
  });

  it('D — a transient CALL 3 failure retries only the failed section', async () => {
    const spec = input('UGA', 24_000_000);
    const calls: string[] = [];
    let militaryAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      calls.push(section);
      if (section === 'military-resources' && ++militaryAttempts === 1) {
        throw new LLMError('openai-compatible: HTTP 503 — unavailable', { provider: 'openai-compatible', status: 503, retriable: true });
      }
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(calls).toEqual(['economy', 'national-state', 'military-resources', 'military-resources']);
    expect(result.economy.debtRatioPct).toBe(30);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('E — an invalid CALL 2 JSON is not retried and fails closed for the player', async () => {
    const spec = input('UGA', 24_000_000);
    const calls: string[] = [];
    const complete = vi.fn(async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      calls.push(section);
      if (section === 'national-state') return 'non-json';
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    await expect(generateCountryInitialProfile(spec, complete, { requireEstimate: true })).rejects.toThrow(/profilo iniziale.*partita non creata/i);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['economy', 'national-state']);
  });

  it('F — a sanitized provider error is preserved as the readable cause', async () => {
    const complete = vi.fn(async () => {
      throw new LLMError('openai-compatible: HTTP 503 — upstream unavailable', { provider: 'openai-compatible', status: 503, retriable: true });
    });
    await expect(generateCountryInitialProfile(input('UGA', 24_000_000), complete, { requireEstimate: true }))
      .rejects.toThrow(/openai-compatible: HTTP 503/);
    // Un errore transitorio viene ritentato una sola volta, poi surface.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('G — an invalid required section never falls back to the deterministic profile for the player', async () => {
    const spec = input('UGA', 24_000_000);
    const complete = async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 }
        : section === 'military-resources' ? { ...raw, military: { ...raw.military, activePersonnel: 10_000_000 } } : raw);
    };
    await expect(generateCountryInitialProfile(spec, complete, { requireEstimate: true })).rejects.toThrow(/militare/i);
  });

  it('C2 — without a reference, a population that copies the modern map is rejected', async () => {
    const mapPopulation = 50_000_000;
    const spec = input('UGA', mapPopulation);
    expect(referencePopulationForDate('UGA', '2000-01-01')).toBeNull();
    const copied = async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 }
        : section === 'national-state' ? { ...raw, population: mapPopulation } : raw);
    };
    await expect(generateCountryInitialProfile(spec, copied, { requireEstimate: true }))
      .rejects.toThrow(/stato nazionale/i);
    // Una stima storica distinta e plausibile, invece, è accettata.
    const distinct = async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 }
        : section === 'national-state' ? { ...raw, population: 30_000_000 } : raw);
    };
    const result = await generateCountryInitialProfile(spec, distinct, { requireEstimate: true });
    expect(result.population).toBe(30_000_000);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('H — the total bootstrap budget bounds three slow sections inside one POST', async () => {
    vi.useFakeTimers();
    try {
      const spec = input('UGA', 24_000_000);
      // Ogni sezione risponde dopo 30s (< 35s): 3 × 30s = 90s > budget 80s.
      const complete = vi.fn((_system: string, prompt: string) => new Promise<string>(resolve => {
        setTimeout(() => {
          const { section, fallback, anchors } = readPrompt(prompt);
          resolve(profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw));
        }, 30_000);
      }));
      const pending = generateCountryInitialProfile(spec, complete, { requireEstimate: true });
      const rejected = expect(pending).rejects.toThrow(/tempo limite|stato nazionale|profilo iniziale/i);
      await vi.advanceTimersByTimeAsync(86_000);
      await rejected;
    } finally { vi.useRealTimers(); }
  });

  // --- Repair della risposta vuota: max 2 tentativi per sezione, il secondo
  // con budget maggiore (reasoning che esaurisce il budget del primo). ---
  const EMPTY = () => new LLMError('openai-compatible: risposta vuota dal modello', { provider: 'openai-compatible', retriable: true });
  const HTTP = () => new LLMError('openai-compatible: HTTP 503 — unavailable', { provider: 'openai-compatible', status: 503, retriable: true });

  it('EMPTY-A — empty economy is repaired and succeeds with budgets [1200, 3000]', async () => {
    const spec = input('UGA', 24_000_000);
    const budgets: number[] = [];
    let economyAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string, _signal: AbortSignal, options?: { maxTokens?: number }) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      budgets.push(options?.maxTokens ?? 0);
      if (section === 'economy' && ++economyAttempts === 1) throw EMPTY();
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(economyAttempts).toBe(2);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(budgets.slice(0, 2)).toEqual([1_200, 3_000]);
    expect(result.economy.debtRatioPct).toBe(30);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('EMPTY-B — empty national-state is repaired with budgets [1200, 3000]', async () => {
    const spec = input('UGA', 24_000_000);
    const budgets: number[] = [];
    let stateAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string, _signal: AbortSignal, options?: { maxTokens?: number }) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      budgets.push(options?.maxTokens ?? 0);
      if (section === 'national-state' && ++stateAttempts === 1) throw EMPTY();
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(stateAttempts).toBe(2);
    expect(budgets).toEqual([1_200, 1_200, 3_000, 1_800]);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('EMPTY-C — empty military-resources is repaired with budgets [1800, 4500]', async () => {
    const spec = input('UGA', 24_000_000);
    const budgets: number[] = [];
    let militaryAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string, _signal: AbortSignal, options?: { maxTokens?: number }) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      budgets.push(options?.maxTokens ?? 0);
      if (section === 'military-resources' && ++militaryAttempts === 1) throw EMPTY();
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(spec, complete, { requireEstimate: true });
    expect(militaryAttempts).toBe(2);
    expect(budgets).toEqual([1_200, 1_200, 1_800, 4_500]);
    expect(validateCountryInitialProfile(result, spec)).not.toBeNull();
  });

  it('EMPTY-D — empty on both attempts fails closed with exactly two calls', async () => {
    const complete = vi.fn(async () => { throw EMPTY(); });
    await expect(generateCountryInitialProfile(input('UGA', 24_000_000), complete, { requireEstimate: true }))
      .rejects.toThrow(/risposta vuota dal modello/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('EMPTY-E — a transient HTTP 503 is retried once (max two calls)', async () => {
    let economyAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      if (section === 'economy' && ++economyAttempts === 1) throw HTTP();
      return profileReply(section, fallback, anchors, raw => section === 'economy' ? { ...raw, debtRatioPct: 30 } : raw);
    });
    const result = await generateCountryInitialProfile(input('UGA', 24_000_000), complete, { requireEstimate: true });
    expect(economyAttempts).toBe(2);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(validateCountryInitialProfile(result, input('UGA', 24_000_000))).not.toBeNull();
  });

  it('EMPTY-F — 503 then empty never becomes a third attempt', async () => {
    let economyAttempts = 0;
    const complete = vi.fn(async (_system: string, prompt: string) => {
      const { section, fallback, anchors } = readPrompt(prompt);
      if (section === 'economy') {
        economyAttempts++;
        throw economyAttempts === 1 ? HTTP() : EMPTY();
      }
      return profileReply(section, fallback, anchors);
    });
    await expect(generateCountryInitialProfile(input('UGA', 24_000_000), complete, { requireEstimate: true }))
      .rejects.toThrow(/risposta vuota dal modello/);
    expect(economyAttempts).toBe(2);
  });

  it('EMPTY-G — invalid JSON is not retried', async () => {
    const complete = vi.fn(async (_system: string, prompt: string, _signal: AbortSignal, _options?: unknown) => {
      const { section } = readPrompt(prompt) as { section: string };
      return section === 'economy' ? 'non-json' : '{}';
    });
    await expect(generateCountryInitialProfile(input('UGA', 24_000_000), complete, { requireEstimate: true }))
      .rejects.toThrow(/JSON|profilo iniziale/i);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
