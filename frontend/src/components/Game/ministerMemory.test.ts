/**
 * WS-MINISTER-UX-05 — La memoria del ministro sul client (tappa intermedia)
 * ========================================================================
 * Difende la derivazione dagli eventi espliciti, l'ordine dei ricordi nel
 * prompt, la potatura al rewind e la persistenza nel browser. La persistenza
 * server-side resta l'innesto documentato: qui si prova la parte che vivrà.
 */
import { describe, expect, it } from 'vitest';
import {
  MINISTER_MEMORY_LIMIT, clientMandate, discussedProposal, loadMemory, memorySection, memoryScopeKey,
  openQuestion, pruneMemoryByDate, queuedDecision, recordMemory, relevantMemory, saveMemory,
  seatRecords, withSeatRecords, type MinisterMemoryRecord, type MinisterMemoryScope,
} from './ministerMemory';

const SCOPE: MinisterMemoryScope = { gameId: 'game-1', branchId: 'main', mandate: 'p1:ind' };

const ref = { messageId: 'tesoro#2', gameDate: '1951-03-01' };

function discussed(id: string, date = '1951-03-01'): MinisterMemoryRecord {
  return {
    id, kind: 'proposal-discussed', summary: `Proposta ${id}`, state: 'discussed',
    refs: { gameDate: date },
  };
}

/** Uno storage in memoria: i test non toccano il browser. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe('WS-MINISTER-UX-05 (client) — derivazione degli eventi', () => {
  it('una proposta discussa ha un id stabile e non si duplica', () => {
    const first = recordMemory([], discussedProposal('tesoro', { id: 'repay', title: 'Ammortamento' }, ref));
    const again = recordMemory(first, discussedProposal('tesoro', { id: 'repay', title: 'Ammortamento' }, ref));
    expect(again).toHaveLength(1);
    expect(again[0].kind).toBe('proposal-discussed');
    expect(again[0].state).toBe('discussed');
  });

  it('un atto accodato è una decisione, non una proposta', () => {
    const record = queuedDecision('tesoro', 'Rimborsa i titoli', { gameDate: '1951-04-01' });
    expect(record.kind).toBe('queued-decision');
    expect(record.state).toBe('queued');
    expect(record.summary).toContain('Rimborsa i titoli');
  });

  it('una seduta senza ordine lascia una questione aperta', () => {
    const record = openQuestion('tesoro', 'Seduta chiusa senza ordine', { gameDate: '1951-04-01' });
    expect(record.kind).toBe('open-question');
    expect(record.state).toBe('open');
  });

  it('un ricordo senza sintesi non entra', () => {
    expect(recordMemory([], { ...discussed('x'), summary: '  ' })).toHaveLength(0);
  });
});

describe('WS-MINISTER-UX-05 (client) — selezione e prompt', () => {
  it('le respinte e le accodate precedono le discussioni', () => {
    let records = recordMemory([], discussed('a'));
    records = recordMemory(records, { id: 'b', kind: 'queued-decision', summary: 'Atto', state: 'queued', refs: ref });
    records = recordMemory(records, { id: 'c', kind: 'proposal-rejected', summary: 'No', reason: 'manca l’acciaio', state: 'rejected', refs: ref });
    expect(relevantMemory(records).map(r => r.kind)).toEqual(['proposal-rejected', 'queued-decision', 'proposal-discussed']);
  });

  it('il prompt dichiara il confine e porta motivo e provenienza', () => {
    const records = recordMemory([], { id: 'c', kind: 'proposal-rejected', summary: 'Ospedale', reason: 'manca l’acciaio', state: 'rejected', refs: ref });
    const section = memorySection(records);
    expect(section).toContain('MEMORIA DELLA SEDUTA');
    expect(section).toContain('non è una seconda contabilità');
    expect(section).toContain('vincono i fatti aggiornati');
    expect(section).toContain('motivo: manca l’acciaio');
    expect(section).toContain('messaggio tesoro#2');
  });

  it('a memoria vuota non produce rumore', () => {
    expect(memorySection([])).toBe('');
  });

  it('la potatura tiene i ricordi più significativi oltre il limite', () => {
    let records: MinisterMemoryRecord[] = [];
    for (let i = 0; i < MINISTER_MEMORY_LIMIT; i++) records = recordMemory(records, discussed(`m${i}`));
    records = recordMemory(records, { id: 'respinta', kind: 'proposal-rejected', summary: 'No', state: 'rejected', refs: ref });
    expect(records.length).toBeLessThanOrEqual(MINISTER_MEMORY_LIMIT);
    expect(records.some(r => r.id === 'respinta')).toBe(true);
  });
});

describe('WS-MINISTER-UX-05 (client) — rewind e persistenza', () => {
  it('al rewind si potano i ricordi oltre la data corrente', () => {
    const records = [discussed('ieri', '1951-01-01'), discussed('domani', '1951-06-01')];
    expect(pruneMemoryByDate(records, '1951-03-01').map(r => r.id)).toEqual(['ieri']);
    expect(pruneMemoryByDate(records, null)).toHaveLength(2);
  });

  it('lo store per sedia non muta l’originale', () => {
    const store = withSeatRecords({}, 'tesoro', [discussed('a')]);
    const next = withSeatRecords(store, 'lavori', [discussed('b')]);
    expect(store.lavori).toBeUndefined();
    expect(next.tesoro).toHaveLength(1);
    expect(seatRecords(next, 'lavori', null)).toHaveLength(1);
  });

  it('la memoria sopravvive a una nuova lettura dello storage', () => {
    const storage = fakeStorage();
    const store = withSeatRecords({}, 'tesoro', [discussed('a')]);
    saveMemory(SCOPE, store, storage);
    expect(loadMemory(SCOPE, storage)).toEqual(store);
  });

  it('due partite non si scambiano ricordi', () => {
    const storage = fakeStorage();
    saveMemory(SCOPE, withSeatRecords({}, 'tesoro', [discussed('a')]), storage);
    expect(loadMemory({ ...SCOPE, gameId: 'game-2' }, storage)).toEqual({});
  });

  it('WS-MINISTER-UX-08 (4) — un ricordo di un altro ramo non riappare', () => {
    const storage = fakeStorage();
    saveMemory({ ...SCOPE, branchId: 'fork-b' }, withSeatRecords({}, 'tesoro', [discussed('ramo-b')]), storage);
    expect(loadMemory({ ...SCOPE, branchId: 'main' }, storage)).toEqual({});
    expect(loadMemory({ ...SCOPE, branchId: 'fork-b' }, storage).tesoro[0].id).toBe('ramo-b');
  });

  it('WS-MINISTER-UX-08 (4) — cambiando mandato cambia lo scope', () => {
    const storage = fakeStorage();
    saveMemory({ ...SCOPE, mandate: 'p1:ind' }, withSeatRecords({}, 'tesoro', [discussed('governo-1')]), storage);
    expect(loadMemory({ ...SCOPE, mandate: 'p1:naz' }, storage)).toEqual({});
    expect(memoryScopeKey({ ...SCOPE, mandate: 'p1:ind' })).not.toBe(memoryScopeKey({ ...SCOPE, mandate: 'p1:naz' }));
    expect(memoryScopeKey(SCOPE)).toContain('game-1');
    expect(memoryScopeKey(SCOPE)).toContain('main');
  });

  it('WS-MINISTER-UX-08 (4) — il mandato è polity + fazione dominante, come il server', () => {
    expect(clientMandate({ dominantId: 'industriali' }, 'p1')).toBe('p1:industriali');
    expect(clientMandate(null, 'p1')).toBe('p1:council');
    expect(clientMandate({ dominantId: 'x' }, null)).toBe('unknown:x');
  });

  it('uno storage rotto non rompe la seduta', () => {
    const broken = { ...fakeStorage(), getItem: () => '{not json' } as Storage;
    expect(loadMemory(SCOPE, broken)).toEqual({});
    const failing = { ...fakeStorage(), setItem: () => { throw new Error('quota'); } } as Storage;
    expect(() => saveMemory(SCOPE, {}, failing)).not.toThrow();
  });
});
