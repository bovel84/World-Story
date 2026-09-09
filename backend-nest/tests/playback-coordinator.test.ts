import { describe, expect, it } from 'vitest';
import {
  SimulationStaleCheckpointError,
  assertPlaybackAnchor,
  buildPausedBatchResult,
  createPausedRunState,
  pausedRunInfo,
  resolvePlaybackCloseReason,
  revivePausedRunState,
  takeNextValidPlaybackEvent,
} from '../src/core/playback/PlaybackCoordinator';
import type { SimulationEvent } from '../src/prompts/types';

const event = (date: string, headline = date): SimulationEvent => ({
  date,
  headline,
  description: `Evento ${headline}`,
  mapChanges: [],
});

function baseState() {
  return createPausedRunState({
    runId: 'run-1',
    periodStart: '1951-01-01',
    destination: '1951-03-01',
    currentTurn: 4,
    proposedEvents: [event('1951-01-10'), event('1951-02-10')],
    batchActionIds: ['a1'],
    headlineToActionIds: { '1951-01-10': ['a1'] },
    promptResult: { narration: 'ok', effects: [], incomplete: false },
  });
}

describe('PlaybackCoordinator', () => {
  it('crea lo stato durevole senza condividere gli array di input', () => {
    const proposed = [event('1951-01-10')];
    const state = createPausedRunState({
      runId: 'r', periodStart: '1951-01-01', destination: '1951-02-01', currentTurn: 7,
      proposedEvents: proposed, batchActionIds: ['a'], headlineToActionIds: {},
      promptResult: { narration: 'n', relationshipChanges: null, effects: null },
    });
    proposed.length = 0;
    expect(state.remainingEvents).toHaveLength(1);
    expect(state.jumpTurn).toBe(7);
    expect(state.revisionBase).toBe(8);
    expect(state.completion.relationshipChanges).toEqual([]);
    expect(state.completion.effects).toEqual([]);
  });

  it('chiude per budget prima della destinazione quando lo stream è incompleto', () => {
    const state = baseState();
    state.incomplete = true;
    expect(resolvePlaybackCloseReason(state, '1951-02-10', 0)).toBe('paused_budget');
  });

  it('chiude completed solo quando non restano eventi e la destinazione è raggiunta', () => {
    const state = baseState();
    expect(resolvePlaybackCloseReason(state, '1951-03-01', 0)).toBe('completed');
    expect(resolvePlaybackCloseReason(state, '1951-02-28', 0)).toBeNull();
    expect(resolvePlaybackCloseReason(state, '1951-03-01', 1)).toBeNull();
  });

  it('scarta proposte stantie e restituisce la prima data valida', () => {
    const state = baseState();
    state.remainingEvents = [event('1950-12-31'), event('1951-01-05'), event('1951-02-05')];
    expect(takeNextValidPlaybackEvent(state, '1951-01-10')?.date).toBe('1951-02-05');
    expect(state.remainingEvents).toHaveLength(0);
  });

  it('rifiuta ancore event/revision stantie', () => {
    const state = baseState();
    state.currentEventId = 'ev-2';
    state.revision = 9;
    expect(() => assertPlaybackAnchor(state, 'ev-1', 9)).toThrow(SimulationStaleCheckpointError);
    expect(() => assertPlaybackAnchor(state, 'ev-2', 8)).toThrow(SimulationStaleCheckpointError);
    expect(() => assertPlaybackAnchor(state, 'ev-2', 9)).not.toThrow();
  });

  it('costruisce il DTO pubblico del checkpoint senza esporre il futuro', () => {
    const state = baseState();
    const e = state.remainingEvents.shift()!;
    const dto = buildPausedBatchResult({
      state, event: e, eventId: 'ev-1', sourceActionIds: ['a1'], remaining: 1,
      checkpointId: 'cp-1', revision: 5, newTurn: 5, changedRegions: [],
    });
    expect(dto).toMatchObject({
      paused: true, simulationId: 'run-1', remaining: 1, checkpointId: 'cp-1', revision: 5,
      event: { id: 'ev-1', sourceActionIds: ['a1'] },
    });
    expect(JSON.stringify(dto)).not.toContain('remainingEvents');
    expect(JSON.stringify(dto)).not.toContain('completion');
  });

  it('proietta le sole informazioni pubbliche del run sospeso', () => {
    const state = baseState();
    state.currentEventId = 'ev-1';
    state.checkpointId = 'cp-1';
    state.revision = 3;
    expect(pausedRunInfo(state, '1951-01-10', 5)).toEqual({
      simulationId: 'run-1', remaining: 2, destination: '1951-03-01', date: '1951-01-10', turn: 5,
      incomplete: false, eventId: 'ev-1', checkpointId: 'cp-1', revision: 3,
    });
  });

  it('ripristina pending_state malformato in modo fail-closed e normalizzato', () => {
    expect(revivePausedRunState(null, 4)).toBeNull();
    expect(revivePausedRunState({ runId: 'x', periodStart: 1, destination: '1951-02-01', remainingEvents: [] }, 4)).toBeNull();
    const revived = revivePausedRunState({
      runId: 'x', periodStart: '1951-01-01', destination: '1951-02-01',
      remainingEvents: [event('1951-01-10'), { date: 'bad' }],
      completion: { effects: 'bad' },
    }, 4);
    expect(revived?.remainingEvents).toHaveLength(1);
    expect(revived?.jumpTurn).toBe(4);
    expect(revived?.revisionBase).toBe(5);
    expect(revived?.completion.effects).toEqual([]);
  });
});
