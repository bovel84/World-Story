import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { HISTORICAL_BASELINE_SYSTEM } from '../src/core/government/HistoricalBaseline';
import type { CountryInitialProfile } from '../src/core/simulation/CountryInitialProfile';
const background = 'Gli accordi di Dayton del novembre 1995 posero fine alla guerra in Bosnia ed Erzegovina iniziata nel 1992. Sarajevo era stata al centro del conflitto; il nuovo ordinamento mantenne la Bosnia ed Erzegovina come Stato articolato nella Federazione di Bosnia ed Erzegovina e nella Republika Srpska. La ricostruzione delle istituzioni e il ritorno degli sfollati rimasero questioni centrali dopo la pace.';
const historyResponse = { content: JSON.stringify({ entries: [{ date: '1995-12-14', text: background, confidence: 'high' }] }) };
const file = `/tmp/country-profile-persist-${process.pid}.db`;
process.env.OPEN_PAX_DB_PATH = file;
let db: any, registry: any, profiles: any;
let providerCalls = 0;
const profileResponse = (prompt: string) => {
  const { fallback } = JSON.parse(prompt);
  return { content: JSON.stringify({ ...fallback, economy: { ...fallback.economy, debtRatioPct: 40 } }) };
};
const provider = { generate: async (_mechanic: string, system: string, prompt: string) => {
  providerCalls++;
  return system === HISTORICAL_BASELINE_SYSTEM ? historyResponse : profileResponse(prompt);
},
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} };
beforeAll(async () => {
  const database = await import('../src/database'); db = database.default; database.initDatabase();
  const { worldRepository } = await import('../src/repositories/world.repository');
  worldRepository.createWithRegions({ id: 'profile-world', name: '2000', startDate: '2000-01-01' }, [
    { id: 'profile-BIH', name: 'Bosnia', color: '#112233', owner: 'BIH', population: 3_750_000, gdp: 10, militaryPower: 20, objects: [], flag: 'BIH' },
    { id: 'profile-USA', name: 'USA', color: '#445566', owner: 'USA', population: 282_000_000, gdp: 10000, militaryPower: 1000, objects: [], flag: 'USA' },
  ]);
  ({ countryInitialProfiles: profiles } = await import('../src/repositories/country-initial-profile.repository'));
  const m = await import('../src/session-registry'); registry = m.initSessionRegistry(provider as never);
});
afterAll(() => { db?.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true }); });
describe('bootstrap canonical persistence', () => {
  it('a pending estimate cannot be reconstructed/read before the final profile is persisted', async () => {
    let release!: (result: { content: string }) => void;
    let started!: () => void;
    const profileStarted = new Promise<void>(resolve => { started = resolve; });
    const pausedProvider = { ...provider, generate: (_mechanic: string, system: string) => system === HISTORICAL_BASELINE_SYSTEM
      ? Promise.resolve(historyResponse) : new Promise<{ content: string }>(resolve => { release = resolve; started(); }) };
    const { initSessionRegistry } = await import('../src/session-registry');
    const pendingRegistry = initSessionRegistry(pausedProvider as never);
    const pending = pendingRegistry.createSession('profile-world', '', 'profile-BIH', '#112233', undefined, true);
    expect(pendingRegistry.getSession(pending.gameId)).toBeNull();
    expect(profiles.get(pending.gameId, 'BIH')).toBeNull();
    await profileStarted;
    release({ content: '{}' });
    await expect(pending.ready).rejects.toThrow(/profilo iniziale/i);
    expect(pendingRegistry.getSession(pending.gameId)).toBeNull();
    expect(profiles.get(pending.gameId, 'BIH')).toBeNull();
    expect(db.prepare('SELECT id FROM games WHERE id=?').get(pending.gameId)).toBeUndefined();
  });
  it('mock-only estimate once; reads/reload never generate; separate games bootstrap independently', async () => {
    const callsBefore = providerCalls;
    const first = registry.createSession('profile-world', 'ignored', 'profile-BIH', '#112233', undefined, true);
    await first.ready;
    expect(providerCalls).toBe(callsBefore + 2);
    const saved = profiles.get(first.gameId, 'BIH');
    expect(saved.economy.nominalGdpUsdBillions).toBe(5.5);
    expect(profiles.get(first.gameId, 'USA').economy.debtRatioPct).toBe(55);
    for (let i = 0; i < 3; i++) first.session.getNationalAccounts();
    const { GameSession } = await import('../src/game-session');
    const rebuilt = new GameSession(first.gameId, 'profile-world', provider as never);
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(first.gameId);
    rebuilt.reconstructFromDB({ currentTurn: game.current_turn, currentDate: game.current_date, players: [first.session.getPlayer()] });
    expect(profiles.get(first.gameId, 'BIH')).toEqual(saved);
    expect(providerCalls).toBe(callsBefore + 2);
    const second = registry.createSession('profile-world', 'ignored', 'profile-BIH', '#112233', undefined, true);
    await second.ready;
    expect(second.gameId).not.toBe(first.gameId);
    expect(providerCalls).toBe(callsBefore + 4);
    expect(profiles.get(second.gameId, 'BIH').economy).toEqual(saved.economy);
  });
  it('new Bosnia persists history before profile completion, reuses it on reads/reload, and makes no NPC calls', async () => {
    const calls: string[] = [];
    let profileInput: { historicalBaseline: string; fallback: CountryInitialProfile } | undefined;
    const mock = { ...provider, generate: async (_mechanic: string, system: string, prompt: string, options: { singleAttempt?: boolean }) => {
      if (system === HISTORICAL_BASELINE_SYSTEM) { calls.push('history'); return historyResponse; }
      calls.push('profile');
      expect(options.singleAttempt).toBe(true);
      profileInput = JSON.parse(prompt);
      const persisted = db.prepare("SELECT historical_background FROM game_polity_historical_baselines WHERE polity_id='BIH' ORDER BY rowid DESC LIMIT 1").get()?.historical_background;
      expect(persisted).toBe(profileInput!.historicalBaseline);
      const fallback = profileInput!.fallback;
      return { content: JSON.stringify({ ...fallback, economy: { ...fallback.economy, debtRatioPct: 40 }, military: { ...fallback.military, readinessPct: 64 } }) };
    } };
    const { initSessionRegistry } = await import('../src/session-registry');
    const localRegistry = initSessionRegistry(mock as never);
    const first = localRegistry.createSession('profile-world', '', 'profile-BIH', '#112233', undefined, true);
    await first.ready;
    expect(calls).toEqual(['history', 'profile']);
    expect(profileInput?.historicalBaseline).toBe(background);
    expect(profiles.get(first.gameId, 'BIH').military.readinessPct).toBe(64);
    expect(profiles.get(first.gameId, 'USA').provenance.source).not.toBe('llm-estimate');
    expect(await first.session.getHistoricalBaseline()).toBe(background);
    first.session.getNationalAccounts();
    const { GameSession } = await import('../src/game-session');
    const rebuilt = new GameSession(first.gameId, 'profile-world', mock as never);
    rebuilt.reconstructFromDB({ currentTurn: 1, currentDate: '2000-01-01', players: [first.session.getPlayer()] });
    expect(await rebuilt.getHistoricalBaseline()).toBe(background);
    expect(profiles.get(first.gameId, 'BIH').military.readinessPct).toBe(64);
    expect(calls).toEqual(['history', 'profile']);
  });
  it('bootstrap resources seed the national stock once and survive reload without new calls', async () => {
    const calls: string[] = [];
    const mock = { ...provider, generate: async (_mechanic: string, system: string, prompt: string) => {
      if (system === HISTORICAL_BASELINE_SYSTEM) { calls.push('history'); return historyResponse; }
      calls.push('profile');
      const fallback = (JSON.parse(prompt) as { fallback: CountryInitialProfile }).fallback;
      return { content: JSON.stringify({ ...fallback, economy: { ...fallback.economy, debtRatioPct: 40 },
        resources: { food: 2, clothing: 1, weapons: 3, fuel: 1.5, research: 42, technologies: ['industria_tessile'] } }) };
    } };
    const { initSessionRegistry } = await import('../src/session-registry');
    const localRegistry = initSessionRegistry(mock as never);
    const first = localRegistry.createSession('profile-world', '', 'profile-BIH', '#112233', undefined, true);
    await first.ready;
    expect(calls).toEqual(['history', 'profile']);
    const { resourceRepository } = await import('../src/repositories/resource.repository');
    const stock = resourceRepository.get(first.gameId, 'BIH').stock;
    expect(stock.food).toBeCloseTo(2, 3);
    expect(stock.clothing).toBeCloseTo(1, 3);
    expect(stock.weapons).toBeCloseTo(3, 3);
    expect(stock.fuel).toBeCloseTo(1.5, 3);
    expect(stock.research).toBe(42);
    expect(stock.technologies).toEqual(['industria_tessile']);
    const { GameSession } = await import('../src/game-session');
    const rebuilt = new GameSession(first.gameId, 'profile-world', mock as never);
    rebuilt.reconstructFromDB({ currentTurn: 1, currentDate: '2000-01-01', players: [first.session.getPlayer()] });
    expect(resourceRepository.get(first.gameId, 'BIH').stock).toEqual(stock);
    expect(calls).toEqual(['history', 'profile']);
  });
  it('an existing persisted baseline is reused without a history generation', async () => {
    const { gameRepository } = await import('../src/repositories/game.repository');
    const gameId = 'profile-cached-history';
    gameRepository.create({ id: gameId, worldId: 'profile-world', currentTurn: 1, maxTurns: 100, status: 'playing' });
    gameRepository.storePolityHistoricalBaseline(gameId, { polityId: 'BIH', countryName: 'Bosnia', startDate: '2000-01-01', historicalBackground: background, version: 2, generatedAt: new Date().toISOString() });
    const calls: string[] = [];
    const mock = { ...provider, generate: async (_mechanic: string, system: string, prompt: string) => {
      calls.push(system === HISTORICAL_BASELINE_SYSTEM ? 'history' : 'profile');
      const input = JSON.parse(prompt);
      expect(input.historicalBaseline).toBe(background);
      return profileResponse(prompt);
    } };
    const { GameSession } = await import('../src/game-session');
    const session = new GameSession(gameId, 'profile-world', mock as never);
    await session.initialize('profile-BIH', 'President', '#112233', undefined, true);
    expect(calls).toEqual(['profile']);
    expect(await session.getHistoricalBaseline()).toBe(background);
    expect(calls).toEqual(['profile']);
  });
  it('player profile failure persists no false profile and leaves no reloadable game', async () => {
    const calls: string[] = [];
    const mock = { ...provider, generate: async (_mechanic: string, system: string) => {
      calls.push(system === HISTORICAL_BASELINE_SYSTEM ? 'history' : 'profile');
      throw new Error('mock provider unavailable');
    } };
    const { initSessionRegistry } = await import('../src/session-registry');
    const localRegistry = initSessionRegistry(mock as never);
    const first = localRegistry.createSession('profile-world', '', 'profile-BIH', '#112233', undefined, true);
    await expect(first.ready).rejects.toThrow(/profilo iniziale.*partita non creata/i);
    expect(calls).toEqual(['history', 'profile']);
    expect(profiles.get(first.gameId, 'BIH')).toBeNull();
    expect(localRegistry.getSession(first.gameId)).toBeNull();
    expect(db.prepare('SELECT id FROM games WHERE id=?').get(first.gameId)).toBeUndefined();
  });
  it('removing all mapless units is a durable known empty registry, not a new bootstrap', async () => {
    const first = registry.createSession('profile-world', '', 'profile-BIH'); await first.ready;
    first.session.getArsenal();
    const store = (first.session as any).operationalStoreFor();
    expect(store.units().length).toBeGreaterThan(0);
    store.savePersonnel({ ...store.personnel(), activePersonnel: 0 });
    store.saveUnits([]);
    expect(first.session.getNationalAccounts().BIH.forces).toBe(0);
    const { GameSession } = await import('../src/game-session');
    const rebuilt = new GameSession(first.gameId, 'profile-world', provider as never);
    rebuilt.reconstructFromDB({ currentTurn: 1, currentDate: '2000-01-01', players: [first.session.getPlayer()] });
    expect((rebuilt as any).operationalStoreFor().units()).toEqual([]);
    expect(rebuilt.getNationalAccounts().BIH.forces).toBe(0);
    expect(rebuilt.getArsenal().manpower.activePersonnel).toBe(0);
    expect(profiles.get(first.gameId, 'BIH').military.formations).toBe(12);
  });
  it('snapshots include the canonical profile and restore it without a completion call', async () => {
    const first = registry.createSession('profile-world', '', 'profile-BIH'); await first.ready;
    const { saveId } = first.session.save('initial profile');
    const data = JSON.parse(db.prepare('SELECT data FROM saves WHERE id=?').get(saveId).data);
    expect(data.countryInitialProfiles.profiles).toHaveLength(2);
    const original = profiles.get(first.gameId, 'BIH');
    // Import/restore must restore the profile, not silently leave a different anchor.
    db.prepare('DELETE FROM game_country_initial_profiles WHERE game_id=?').run(first.gameId);
    const calls = providerCalls;
    first.session.loadFromSave(data);
    expect(profiles.get(first.gameId, 'BIH')).toEqual(original);
    expect(providerCalls).toBe(calls);
    expect((first.session as any).captureCheckpointData().countryInitialProfiles).toEqual(data.countryInitialProfiles);
  });
  it('historical profile debt and initial treasury survive account/resource reload', async () => {
    const first = registry.createSession('profile-world', '', 'profile-USA'); await first.ready;
    const p = profiles.get(first.gameId, 'USA');
    const stock = db.prepare('SELECT * FROM game_resource_stocks WHERE game_id=? AND polity_id=?').get(first.gameId, 'USA');
    expect(stock).toBeTruthy();
    const { resourceRepository } = await import('../src/repositories/resource.repository');
    const material = resourceRepository.get(first.gameId, 'USA').stock;
    expect(material.money).toBeCloseTo(p.economy.treasuryUsdBillions);
    expect(material.debts.reduce((n: number, d: any) => n + d.principal, 0)).toBeCloseTo(10252 * .55);
    const a = first.session.getNationalAccounts().USA;
    expect(a.debtRatioPct).toBeCloseTo(55);
    expect(profiles.get(first.gameId, 'USA')).toEqual(p);
  });
});
