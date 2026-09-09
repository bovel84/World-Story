/**
 * F06 µ1 — reducer puro di snapshot/delta/outbox (test PRIMA di collegare React).
 *
 * Regole del piano:
 *  - scope, world revision, queueVersion, jobVersion e sequence ordinano le
 *    applicazioni; a world revision identica una coda/job più vecchi non
 *    sovrascrivono i nuovi;
 *  - il cambio branch avviene soltanto dalla risposta valida del comando
 *    esplicito corrente (branch replacement con anchor);
 *  - le proposte del playback privato non entrano mai in newsQueue/timeline;
 *  - gli stati terminali e pausati sono espliciti;
 *  - replaceCanonicalSnapshot resetta mappa (inclusi objects), coda, history,
 *    news, chat, advisor e reader; l'archivio è scoped al ramo.
 */
import { describe, expect, it } from 'vitest';
import {
  initialSimulationState,
  applyEnvelope,
  replaceCanonicalSnapshot,
  applyBranchReplace,
  type SimulationEnvelope,
} from './simulationStore';
import { useSimulationStore } from './simulationRuntime';

const BASE = initialSimulationState('game-1', 'branch-A', 5);

function timelineEnvelope(overrides: Partial<SimulationEnvelope> = {}): SimulationEnvelope {
  return {
    scope: 'timeline',
    branchId: 'branch-A',
    worldRevision: 6,
    sequence: 6,
    eventId: 'ev-6',
    payload: {
      event: { id: 'ev-6', date: '1951-01-15', headline: 'Svolta', detail: 'Dettaglio', source: 'world' },
      changedRegions: [{ regionId: 'r-A', owner: 'FRA', color: '#00f' }],
    },
    ...overrides,
  };
}

describe('F06 µ1 — ordinamento per revisione/sequence', () => {
  it('un delta con sequence più vecchio a revisione identica è scartato', () => {
    const after6 = applyEnvelope(BASE, timelineEnvelope({ sequence: 6, eventId: 'ev-6', worldRevision: 6 }));
    expect(after6.timeline).toHaveLength(1);

    const older = applyEnvelope(after6, timelineEnvelope({ sequence: 3, eventId: 'ev-3', worldRevision: 6 }));
    expect(older).toBe(after6); // scartato: nessuna mutazione
    expect(older.timeline).toHaveLength(1);

    const newer = applyEnvelope(after6, timelineEnvelope({ sequence: 7, eventId: 'ev-7', worldRevision: 7 }));
    expect(newer.timeline).toHaveLength(2);
    expect(newer.worldRevision).toBe(7);
  });

  it('i duplicati dello stesso eventId (outbox at-least-once) sono scartati', () => {
    const once = applyEnvelope(BASE, timelineEnvelope());
    const twice = applyEnvelope(once, timelineEnvelope());
    expect(twice.timeline).toHaveLength(1);
  });
});

describe('F06 µ1 — coda e job: le versioni più vecchie non sovrascrivono', () => {
  it('una coda con queueVersion più vecchia è scartata', () => {
    const v3 = applyEnvelope(BASE, { scope: 'queue', branchId: 'branch-A', queueVersion: 3, payload: { actions: [{ id: 'a1', text: 'ordine' }] } });
    expect(v3.pendingActions).toHaveLength(1);

    const v2 = applyEnvelope(v3, { scope: 'queue', branchId: 'branch-A', queueVersion: 2, payload: { actions: [] } });
    expect(v2).toBe(v3); // scartata

    const v4 = applyEnvelope(v3, { scope: 'queue', branchId: 'branch-A', queueVersion: 4, payload: { actions: [] } });
    expect(v4.pendingActions).toHaveLength(0);
    expect(v4.queueVersion).toBe(4);
  });

  it('un aggiornamento job con jobVersion più vecchia è scartato; i terminali sono espliciti', () => {
    const running = applyEnvelope(BASE, { scope: 'job', branchId: 'branch-A', jobVersion: 2, payload: { jobId: 'j1', status: 'running' } });
    expect(running.jobStatuses['j1']?.status).toBe('running');

    const older = applyEnvelope(running, { scope: 'job', branchId: 'branch-A', jobVersion: 1, payload: { jobId: 'j1', status: 'queued' } });
    expect(older).toBe(running);

    const done = applyEnvelope(running, { scope: 'job', branchId: 'branch-A', jobVersion: 3, payload: { jobId: 'j1', status: 'completed', runId: 'run-9' } });
    expect(done.jobStatuses['j1']).toMatchObject({ status: 'completed', runId: 'run-9' });
    expect(done.jobStatuses['j1']?.version).toBe(3);
  });
});

describe('F06 µ1 — playback privato fuori dai canali pubblici', () => {
  it('le proposte sigillate non entrano mai in newsQueue/timeline', () => {
    const proposed = applyEnvelope(BASE, {
      scope: 'timeline',
      branchId: 'branch-A',
      worldRevision: 6,
      sequence: 6,
      eventId: 'ev-6',
      payload: {
        event: { id: 'ev-6', date: '1951-01-15', headline: 'Svolta', source: 'world' },
        pendingState: { sealedProposals: [{ headline: 'PROPOSTA SEGRETA' }], processingOrders: ['ordine-privato'] },
        changedRegions: [],
      },
    });
    expect(proposed.timeline).toHaveLength(1);
    expect(proposed.timeline[0]).toMatchObject({ id: 'ev-6', headline: 'Svolta' });
    expect(JSON.stringify(proposed.timeline)).not.toContain('PROPOSTA SEGRETA');
    expect(JSON.stringify(proposed.timeline)).not.toContain('ordine-privato');
    expect(proposed.newsQueue.map(n => n.headline)).toEqual(['Svolta']);
  });
});

describe('F06 µ1 — cambio branch solo da comando esplicito', () => {
  it('un envelope di un altro ramo è scartato', () => {
    const alien = applyEnvelope(BASE, timelineEnvelope({ branchId: 'branch-B', worldRevision: 9, sequence: 9 }));
    expect(alien).toBe(BASE);
  });

  it('applyBranchReplace (risposta valida del restore) resetta tutto con il nuovo anchor', () => {
    const before = applyEnvelope(BASE, timelineEnvelope());
    const restored = applyBranchReplace(before, {
      gameId: 'game-1',
      branchId: 'branch-B',
      anchor: { checkpointId: 'cp-1', revision: 4 },
      snapshot: {
        date: '1951-01-01',
        mapRegions: { 'r-A': { owner: 'POL', color: '#fff' } },
        pendingActions: [{ id: 'a2', text: 'ordine del checkpoint' }],
        history: [],
        news: [],
        chats: [],
      },
    });
    expect(restored.branchId).toBe('branch-B');
    expect(restored.worldRevision).toBe(4);
    expect(restored.timeline).toHaveLength(0);
    expect(restored.pendingActions).toHaveLength(1);
    // La mappa è resettata INCLUSI gli objects: l'owner del ramo nuovo parte dallo snapshot.
    expect(restored.mapRegions['r-A']).toMatchObject({ owner: 'POL' });
    expect(restored.archiveKey).toBe('game-1:branch-B');
  });
});

describe('F06 µ1 — snapshot canonico e stati pausati/terminali', () => {
  it('replaceCanonicalSnapshot resetta mappa inclusi objects, coda, history, news, chat, advisor e reader', () => {
    const dirty = applyEnvelope(BASE, timelineEnvelope({ eventId: 'ev-old', sequence: 6 }));
    const snap = replaceCanonicalSnapshot(dirty, {
      branchId: 'branch-A',
      worldRevision: 8,
      queueVersion: 2,
      snapshot: {
        date: '1951-02-01',
        mapRegions: { 'r-A': { owner: 'DEU', color: '#111' }, 'r-B': { owner: 'POL', color: '#222' } },
        pendingActions: [],
        history: [{ turn: 2, action: 'x', result: 'y' }],
        news: [{ id: 'n1', headline: 'Notizia' }],
        chats: [{ id: 'c1' }],
        advisor: { content: 'consiglio' },
        reader: { checkpointId: 'cp-2' },
      },
    });
    expect(snap.worldRevision).toBe(8);
    expect(snap.queueVersion).toBe(2);
    expect(snap.timeline).toHaveLength(0);
    expect(snap.pendingActions).toHaveLength(0);
    expect(snap.newsQueue).toHaveLength(1);
    expect(snap.history).toHaveLength(1);
    expect(snap.mapRegions['r-B']).toMatchObject({ owner: 'POL' });
    expect(snap.advisor).toMatchObject({ content: 'consiglio' });
    expect(snap.reader).toMatchObject({ checkpointId: 'cp-2' });
    expect(snap.archiveKey).toBe('game-1:branch-A');
  });

  it('awaitingNext segna la pausa; il terminale la cancella', () => {
    const paused = applyEnvelope(BASE, timelineEnvelope({ payload: { event: { id: 'ev-6', date: '1951-01-15', headline: 'Svolta', source: 'world' }, awaitingNext: { remaining: 1, destination: '1951-03-01' }, changedRegions: [] } }));
    expect(paused.pausedRun).toMatchObject({ simulationId: undefined, remaining: 1 });
    expect(paused.pausedRun?.checkpointId ?? null).toBeNull();

    const withRun = applyEnvelope(paused, { scope: 'job', branchId: 'branch-A', jobVersion: 1, payload: { jobId: 'j-1', status: 'running', runId: 'run-1' } });
    expect(withRun.pausedRun?.simulationId).toBe('run-1');

    const terminal = applyEnvelope(withRun, { scope: 'job', branchId: 'branch-A', jobVersion: 2, payload: { jobId: 'j-1', status: 'completed', runId: 'run-1' } });
    expect(terminal.pausedRun).toBeNull();
    expect(terminal.jobStatuses['j-1']).toMatchObject({ status: 'completed' });
  });

  it('sequenza uguale con eventId diverso è accettata (più eventi dello stesso checkpoint)', () => {
    const first = applyEnvelope(BASE, timelineEnvelope({ sequence: 6, eventId: 'ev-6a', worldRevision: 6, payload: { event: { id: 'ev-6a', date: '1951-01-15', headline: 'Prima', source: 'world' }, changedRegions: [] } }));
    const second = applyEnvelope(first, timelineEnvelope({ sequence: 6, eventId: 'ev-6b', worldRevision: 6, payload: { event: { id: 'ev-6b', date: '1951-01-15', headline: 'Seconda', source: 'world' }, changedRegions: [] } }));
    expect(second.timeline.map(e => e.id)).toEqual(['ev-6a', 'ev-6b']);
  });
});

describe('F06 µ2 — store runtime e guardia anti-stale', () => {
  it('initGame resetta lo stato e invalida i comandi in volo', () => {
    const store = useSimulationStore.getState();
    const token = store.beginCommand();
    store.initGame('g-1', 'b-1', 5);
    const after = useSimulationStore.getState();
    expect(after.state).toMatchObject({ gameId: 'g-1', branchId: 'b-1', worldRevision: 5 });
    expect(after.isStale(token)).toBe(true);
  });

  it('dispatch applica solo envelope accettati; le risposte con token vecchio sono scartabili', () => {
    const store = useSimulationStore.getState();
    store.initGame('g-2', 'b-2', 1);
    store.dispatch(timelineEnvelope({ branchId: 'b-2', worldRevision: 2, sequence: 2, eventId: 'e-2' }));
    expect(useSimulationStore.getState().state?.timeline).toHaveLength(1);

    // Risposta vecchia: token preso prima di un game switch è scaduto.
    const staleToken = useSimulationStore.getState().beginCommand();
    useSimulationStore.getState().initGame('g-3', 'b-3', 1);
    expect(useSimulationStore.getState().isStale(staleToken)).toBe(true);
    // Un comando iniziato DOPO lo switch è valido.
    const freshToken = useSimulationStore.getState().beginCommand();
    expect(useSimulationStore.getState().isStale(freshToken)).toBe(false);
  });

  it('branchReplace dal runtime sostituisce ramo e anchor', () => {
    const store = useSimulationStore.getState();
    store.initGame('g-4', 'b-4', 9);
    useSimulationStore.getState().branchReplace({
      gameId: 'g-4',
      branchId: 'b-5',
      anchor: { checkpointId: 'cp-9', revision: 3 },
      snapshot: { mapRegions: { 'r-1': { owner: 'FRA' } }, pendingActions: [], history: [], news: [], chats: [] },
    });
    const state = useSimulationStore.getState().state!;
    expect(state).toMatchObject({ gameId: 'g-4', branchId: 'b-5', worldRevision: 3 });
    expect(state.archiveKey).toBe('g-4:b-5');
  });

  it('caricamento esplicito di un save: oggetti mappa inclusi, pausa azzerata, comandi invalidati (passo 4)', () => {
    const store = useSimulationStore.getState();
    store.initGame('g-5', 'b-5', 7);
    // Sessione precedente: un run in pausa e un comando in volo.
    useSimulationStore.getState().dispatch(timelineEnvelope({ branchId: 'b-5', worldRevision: 8, sequence: 8, payload: { event: { id: 'ev-8', date: '1951-02-01', headline: 'Crisi', source: 'world' }, awaitingNext: { remaining: 2, destination: '1951-04-01' }, changedRegions: [] } }));
    expect(useSimulationStore.getState().state?.pausedRun).not.toBeNull();
    const token = useSimulationStore.getState().beginCommand();

    // Il flusso di handleResumeSave: branchReplace con lo snapshot del save
    // (mappa INCLUSI oggetti) + invalidazione esplicita dei comandi.
    useSimulationStore.getState().branchReplace({
      gameId: 'g-5',
      branchId: 'b-9',
      anchor: { revision: 4 },
      snapshot: {
        date: '1951-01-01',
        mapRegions: { 'r-1': { owner: 'GER', color: '#333', objects: [{ id: 'obj-1', type: 'factory' }] } },
        pendingActions: [],
        history: [],
        news: [],
        chats: [],
      },
    });
    useSimulationStore.getState().invalidateCommand();

    const state = useSimulationStore.getState().state!;
    expect(state).toMatchObject({ gameId: 'g-5', branchId: 'b-9', worldRevision: 4 });
    expect(state.mapRegions['r-1']).toMatchObject({ owner: 'GER', objects: [{ id: 'obj-1', type: 'factory' }] });
    expect(state.pausedRun).toBeNull();
    expect(state.reader).toEqual({ checkpointId: null });
    expect(state.timeline).toHaveLength(0);
    expect(useSimulationStore.getState().isStale(token)).toBe(true);
  });
});