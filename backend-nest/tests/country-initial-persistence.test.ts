import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
const file = `/tmp/country-profile-persist-${process.pid}.db`;
process.env.OPEN_PAX_DB_PATH = file;
let db: any, registry: any, profiles: any;
let providerCalls = 0;
const provider = { generate: async () => { providerCalls++; return { content: '{"invalid":true}' }; },
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
    const pausedProvider = { ...provider, generate: () => new Promise<{ content: string }>(resolve => { release = resolve; }) };
    const { initSessionRegistry } = await import('../src/session-registry');
    const pendingRegistry = initSessionRegistry(pausedProvider as never);
    const pending = pendingRegistry.createSession('profile-world', '', 'profile-BIH', '#112233', undefined, true);
    expect(pendingRegistry.getSession(pending.gameId)).toBeNull();
    expect(profiles.get(pending.gameId, 'BIH')).toBeNull();
    release({ content: '{}' });
    await pending.ready;
    expect(pendingRegistry.getSession(pending.gameId)).toBe(pending.session);
    expect(profiles.get(pending.gameId, 'BIH')).toBeTruthy();
  });
  it('mock-only estimate once; reads/reload never generate; separate games bootstrap independently', async () => {
    const first = registry.createSession('profile-world', 'ignored', 'profile-BIH', '#112233', undefined, true);
    await first.ready;
    expect(providerCalls).toBe(1);
    const saved = profiles.get(first.gameId, 'BIH');
    expect(saved.economy.nominalGdpUsdBillions).toBe(5.5);
    expect(profiles.get(first.gameId, 'USA').economy.debtRatioPct).toBe(55);
    for (let i = 0; i < 3; i++) first.session.getNationalAccounts();
    const { GameSession } = await import('../src/game-session');
    const rebuilt = new GameSession(first.gameId, 'profile-world', provider as never);
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(first.gameId);
    rebuilt.reconstructFromDB({ currentTurn: game.current_turn, currentDate: game.current_date, players: [first.session.getPlayer()] });
    expect(profiles.get(first.gameId, 'BIH')).toEqual(saved);
    expect(providerCalls).toBe(1);
    const second = registry.createSession('profile-world', 'ignored', 'profile-BIH', '#112233', undefined, true);
    await second.ready;
    expect(second.gameId).not.toBe(first.gameId);
    expect(providerCalls).toBe(2);
    expect(profiles.get(second.gameId, 'BIH').economy).toEqual(saved.economy);
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
