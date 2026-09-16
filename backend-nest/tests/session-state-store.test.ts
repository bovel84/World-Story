/**
 * SessionStateStore — proprietà dello stato di sessione e bridge di restore.
 */
import { describe, it, expect } from 'vitest';
import { SessionStateStore } from '../src/game/SessionStateStore';

function storeWithRegion() {
  const store = new SessionStateStore();
  store.regions.set('r1', { id: 'r1', name: 'Roma', owner: 'ITA', color: '#fff', population: 10, gdp: 10, militaryPower: 10, objects: [], borders: [], status: 'active' } as any);
  store.currentTurn = 5;
  store.currentDate = '1951-05-01';
  store.actions = [{ id: 'a1' } as any];
  store.results = [{ id: 't1' } as any];
  store.pausedRun = { runId: 'run-1' } as any;
  return store;
}

describe('SessionStateStore — captureCore', () => {
  it('copia le regioni in profondità', () => {
    const store = storeWithRegion();
    const core = store.captureCore();
    store.regions.get('r1')!.population = 999;
    expect(core.regions!.get('r1')!.population).toBe(10);
    // la Map è indipendente
    expect(core.regions).not.toBe(store.regions);
  });

  it('porta con sé turno, data, ordini, risultati e run in pausa', () => {
    const store = storeWithRegion();
    const core = store.captureCore();
    expect(core.currentTurn).toBe(5);
    expect(core.currentDate).toBe('1951-05-01');
    expect(core.actions).toEqual([{ id: 'a1' }]);
    expect(core.results).toEqual([{ id: 't1' }]);
    expect(core.pausedRun).toEqual({ runId: 'run-1' });
  });
});

describe('SessionStateStore — applyCore', () => {
  it('ripristina lo stato catturato (rollback)', () => {
    const store = storeWithRegion();
    const core = store.captureCore();
    // mutazione distruttiva
    store.regions.get('r1')!.owner = 'FRA';
    store.currentTurn = 99;
    store.pausedRun = null;
    store.applyCore(core);
    expect(store.regions.get('r1')!.owner).toBe('ITA');
    expect(store.currentTurn).toBe(5);
    expect(store.pausedRun).toEqual({ runId: 'run-1' });
  });

  it('ignora regioni assenti (snapshot legacy senza copia mappa)', () => {
    const store = storeWithRegion();
    store.applyCore({ currentTurn: 7, currentDate: 'x', players: [], actions: [], results: [], consolidatedHistory: '', consolidatedUpTo: 0, difficulty: 'normal', interveneRequested: false, pausedRun: null });
    expect(store.currentTurn).toBe(7);
    expect(store.regions.get('r1')!.owner).toBe('ITA');
  });
});
