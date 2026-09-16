/**
 * SimulationCoordinator — lock per-sessione e ciclo di vita del run attivo.
 * Nessun DB: è pura concorrenza/stato.
 */
import { describe, it, expect } from 'vitest';
import { SimulationCoordinator } from '../src/game/SimulationCoordinator';

describe('SimulationCoordinator', () => {
  it('withLock esegue la callback e rilascia il lock', async () => {
    const c = new SimulationCoordinator();
    expect(c.isSimulationInProgress()).toBe(false);
    const result = await c.withLock(async () => {
      expect(c.isProcessing).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(c.isProcessing).toBe(false);
  });

  it('withLock rifiuta un secondo chiamante concorrente con null', async () => {
    const c = new SimulationCoordinator();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = c.withLock(async () => { await gate; return 'primo'; });
    const second = await c.withLock(async () => 'secondo');
    expect(second).toBeNull();
    release();
    expect(await first).toBe('primo');
  });

  it('rilascia il lock anche quando la callback lancia', async () => {
    const c = new SimulationCoordinator();
    await expect(c.withLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(c.isProcessing).toBe(false);
  });

  it('traccia e azzera identità e controller del run attivo', () => {
    const c = new SimulationCoordinator();
    expect(c.activeSimulationRunId).toBeNull();
    c.setActiveRunId('run-1');
    const abort = c.beginAbort();
    expect(c.activeSimulationRunId).toBe('run-1');
    expect(c.activeSimulationAbort).toBe(abort);
    expect(abort.signal.aborted).toBe(false);
    c.abortActive();
    expect(abort.signal.aborted).toBe(true);
    c.clearActiveRun();
    expect(c.activeSimulationRunId).toBeNull();
    expect(c.activeSimulationAbort).toBeNull();
  });

  it('abortActive senza controller non lancia', () => {
    const c = new SimulationCoordinator();
    expect(() => c.abortActive()).not.toThrow();
  });
});
