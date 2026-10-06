import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible';
import { AnthropicProvider } from '../src/llm/anthropic';
import { formationImpact } from '../src/core/simulation/OperationalObjects';
import { seedStock, storageCapacity, initialResearchCap } from '../src/core/simulation/MaterialEconomy';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import { buildCountryInitialProfile, validateCountryInitialProfile, generateCountryInitialProfile, infrastructureCaps } from '../src/core/simulation/CountryInitialProfile';
import { referenceDebtToGdpPctForDate, isLandlockedPolity } from '../src/utils/country-facts';
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
      await vi.advanceTimersByTimeAsync(20_001);
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
  it('required player estimate times out after 20s without a retry or fallback', async () => {
    vi.useFakeTimers();
    try {
      const complete = vi.fn(async () => new Promise<string>(() => {}));
      const pending = generateCountryInitialProfile(input(), complete, { requireEstimate: true });
      const rejected = expect(pending).rejects.toThrow(/tempo.*partita non creata/i);
      await vi.advanceTimersByTimeAsync(20_001);
      await rejected;
      expect(complete).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(['debtRatioPct', 'nominalGdpUsdBillions', 'treasuryUsdBillions'])('required estimate rejects missing %s instead of inventing economic anchors', async field => {
    const spec = input('ZETA', 5_000_000);
    const base = buildCountryInitialProfile(spec);
    const economy = { ...base.economy, [field]: undefined };
    await expect(generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base, economy }), { requireEstimate: true })).rejects.toThrow(/profilo iniziale/i);
  });
  it('required estimate rejects the final firewall failure instead of returning fallback', async () => {
    const spec = input('ZETA', 5_000_000);
    const base = buildCountryInitialProfile(spec);
    await expect(generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
      economy: { ...base.economy, nominalGdpUsdBillions: 999_999 } }), { requireEstimate: true })).rejects.toThrow(/profilo iniziale/i);
  });
  it('invalid or throwing optional LLM retains the deterministic NPC/internal path', async () => {
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
  it('two different countries in the same year get substantially different profiles and equipment', async () => {
    const usaSpec = input('USA', 282_000_000);
    const bihSpec = input('BIH', 3_750_000);
    const usa = await generateCountryInitialProfile(usaSpec, async () => JSON.stringify(buildCountryInitialProfile(usaSpec)));
    const bih = await generateCountryInitialProfile(bihSpec, async () => JSON.stringify(buildCountryInitialProfile(bihSpec)));
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
      infrastructure: { ...base.infrastructure, ports: 5 },
      military: { ...base.military, equipmentProfile: { fregate: 3 } } }));
    expect(result.infrastructure.ports).toBe(base.infrastructure.ports);
    expect(result.military).toEqual(base.military);
    expect(result.provenance.source).toBe(base.provenance.source);
  });
  it('explicit preset/map data is never overwritten, but a valid larger national infrastructure survives', async () => {
    const spec = input('BIH', 3_750_000);
    spec.regions[0].objects = [{ type: 'factory', level: 1 }, { type: 'university', level: 2 }] as never;
    const base = buildCountryInitialProfile(spec);
    const caps = infrastructureCaps(spec);
    expect(base.mapBaseline.factories).toBe(1);
    expect(base.mapBaseline.universities).toBe(2);
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const uganda = await generateCountryInitialProfile(ugandaSpec, async () => JSON.stringify({ ...ugandaBase,
      economy: { ...ugandaBase.economy, treasuryUsdBillions: 0.4 },
      military: { ...ugandaBase.military, activePersonnel: 45_000, reservePersonnel: 20_000, formations: 12,
        averageFormationSize: 3_750, readinessPct: 35, trainingPct: 30, logisticsPct: 28,
        equipmentProfile: { fucili: 45_000, apc: 120 } },
      infrastructure: { factories: 6, ports: 0, universities: 4 },
      resources: { food: 1.5, clothing: 1, weapons: 2, fuel: 1.5, research: 30,
        technologies: ['agricoltura_meccanizzata', 'industria_tessile'] } }));
    const cambodia = await generateCountryInitialProfile(cambodiaSpec, async () => JSON.stringify({ ...cambodiaBase,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
    const result = await generateCountryInitialProfile(spec, async () => JSON.stringify({ ...base,
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
});
