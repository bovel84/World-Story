import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `government-dossier-integration-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;
let db: typeof import('../src/database').default;
let registry: import('../src/session-registry').SessionRegistry;
let repositories: typeof import('../src/repositories');
const generate = vi.fn(async () => { throw new Error('Salience must not call a provider'); });
const provider: any = { generate, stream: generate, clearCache() {}, consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 } };

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default; database.initDatabase();
  repositories = await import('../src/repositories');
  const sessions = await import('../src/session-registry');
  sessions.initSessionRegistry(provider); registry = sessions.getSessionRegistry();
  repositories.worldRepository.createWithRegions(
    { id: 'dossier-2000', name: 'Dossier 2000', startDate: '2000-01-01', basePrompt: 'Mock only' },
    ['USA', 'ERI'].map(polityId => ({ id: `region-${polityId}`, name: polityId, owner: polityId, flag: polityId,
      population: polityId === 'USA' ? 282_200_000 : 3_000_000, gdp: polityId === 'USA' ? 1000 : 10,
      militaryPower: polityId === 'USA' ? 100 : 10, coastal: true, borders: [], objects: [], color: '#000' })),
  );
});
afterAll(() => { db?.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true }); });
const create = (polityId: string) => registry.createSession('dossier-2000', 'Presidente', `region-${polityId}`).session;

describe('canonical Dossier → salience → agenda, no second simulation', () => {
  it('keeps USA 2000 normal accounts/army visible without a fabricated readiness crisis', async () => {
    const { readGovernmentAgenda, readCabinetSession } = await import('../src/game/GovernmentReadings');
    const session = create('USA');
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.facts.nominalGdpUsdBillions.rawValue).toBe(10_252);
    expect(snapshot.facts.debtRatioPct.rawValue).toBeCloseTo(55, 0);
    expect(snapshot.facts.forces.rawValue).toBeGreaterThan(0);
    // Respect the existing country-sized initial readiness projection instead
    // of turning each generic seed unit's placeholder 25% into a crisis.
    expect(snapshot.facts['military.initialReadinessPct'].rawValue).toBeGreaterThan(50);
    expect(snapshot.dossier?.after.facts.monthlyBalance.rawValue).toBe(snapshot.economy.monthlyBalance);
    const input = { gameId: session.id, branchId: snapshot.branchId, playerPolityId: 'USA',
      government: session.getGovernment(), account: session.getNationalAccounts().USA, snapshot };
    const before = db.prepare('SELECT total_changes() AS n').get();
    const agenda = readGovernmentAgenda(input);
    expect(agenda.voices.map(voice => voice.id)).not.toContain('treasury_condition');
    // No readiness crisis is fabricated from the placeholder 25%: the initial
    // projection is not a `Prontezza` condition. Any remaining defence voice is
    // driven by a real operational fact of this mock, never by the estimate.
    const defence = agenda.voices.find(voice => voice.id === 'defence_condition');
    expect(defence?.because ?? '').not.toContain('prontezza');
    expect(defence?.figures.some(figure => figure.label === 'Prontezza')).toBe(false);
    const cabinet = readCabinetSession(input);
    expect(cabinet.addresses.every(address => address.items.length > 0)).toBe(true);
    expect(readGovernmentAgenda(input)).toEqual(agenda);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(generate).not.toHaveBeenCalled();
  });

  it('reads a real active front and supply pressure without letting one weak unit define the nation', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const session = create('ERI');
    repositories.operationalObjectRepository.upsert(session.id, 'unit', 'eri-unit', {
      id: 'eri-unit', polityId: 'ERI', status: 'degraded', readiness: 0.3, order: 'defend',
      personnel: 1000, regionId: 'region-ERI', monthlyNeeds: { fuel: 1, food: 1, weapons: 1 },
    });
    repositories.operationalObjectRepository.upsert(session.id, 'front', 'eri-front', {
      id: 'eri-front', attackerPolityId: 'ETH', defenderPolityId: 'ERI', status: 'active', attackerPressure: 10, defenderPressure: 5,
    });
    const snapshot = session.getVerifiedWorldSnapshot();
    const agenda = readGovernmentAgenda({ gameId: session.id, branchId: snapshot.branchId, playerPolityId: 'ERI',
      government: session.getGovernment(), account: session.getNationalAccounts().ERI, snapshot });
    const defence = agenda.voices.find(voice => voice.id === 'defence_condition');
    expect(defence?.urgency).toBe('critica');
    expect(defence?.because).toContain('conflitti attivi');
    // One degraded unit among the standing force does not become the national
    // readiness figure: the personnel-weighted measure keeps the country above
    // the threshold and no `Prontezza` condition is fabricated from its 0.3.
    expect(snapshot.facts['military.units.eri-unit.readiness'].rawValue).toBe(0.3);
    expect(defence?.because).not.toContain('prontezza');
    expect(defence?.figures.some(figure => figure.label === 'Prontezza')).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not turn a strategic direction into available men or equipment: impossible reinforcement stays blocked', () => {
    const session = create('USA');
    const before = session.getVerifiedWorldSnapshot();
    const unit = before.military.units.find(unit => unit.raw.status !== 'destroyed')!;
    const preview = session.unitAction({ action: 'reinforce', unitId: unit.id, men: 1_000_000_000, dryRun: true });
    expect(preview.blocked).toBe(true);
    const after = session.getVerifiedWorldSnapshot();
    expect(after.military.manpower).toEqual(before.military.manpower);
    expect(after.military.equipment).toEqual(before.military.equipment);
    expect(after.economy.resources).toEqual(before.economy.resources);
    expect(generate).not.toHaveBeenCalled();
  });

  it('invalidates initial readiness on the same date after actual personnel/unit mutations', () => {
    const session = create('USA');
    const initial = session.getVerifiedWorldSnapshot();
    expect(initial.military.initialReadinessPct).toBeGreaterThan(50);
    const own = initial.military.units[0];
    repositories.operationalObjectRepository.upsert(session.id, 'unit', own.id, { ...own.raw, readiness: 0.1 });
    const changed = session.getVerifiedWorldSnapshot();
    expect(changed.date).toBe(initial.date);
    expect(changed.military.initialReadinessPct).toBeNull();
    expect(changed.facts['military.initialReadinessPct']).toBeUndefined();
    expect(changed.facts[`military.units.${own.id}.readiness`].rawValue).toBe(0.1);
    expect(generate).not.toHaveBeenCalled();
  });

  it('reconstructs persisted Dossier facts and signed≠executed after reload, without LLM calls', async () => {
    const { GameSession } = await import('../src/game-session');
    const session = create('USA');
    const action = session.queueAction('Valutare un programma di formazione');
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.dossier?.decisions.find(decision => decision.id === action.id)?.status).toBe('signed_pending_execution');
    expect(snapshot.dossier?.appliedEffects).toBeNull();
    const state = structuredClone((session as any).captureCheckpointData());
    const reloaded = new GameSession(session.id, 'dossier-2000', provider);
    reloaded.loadFromSave(state);
    expect(reloaded.getVerifiedWorldSnapshot().dossier).toEqual(snapshot.dossier);
    expect(generate).not.toHaveBeenCalled();
  });
});
