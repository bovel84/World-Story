/**
 * WS-GOVUX-P6 — La memoria del Consiglio (contratto puro)
 * ======================================================
 * Difende le quattro regole della fase sul contratto del backend:
 *  1. le quattro **famiglie** (decisione confermata / preferenza dichiarata /
 *     questione aperta / ipotesi esplorata) sono derivate dal genere, senza
 *     toccare i vecchi salvataggi;
 *  2. la **revoca conserva la storia**: il ricordo resta, smette di riemergere;
 *  3. il **tempo del ricordo è il turno** del mondo, non il timestamp tecnico;
 *  4. lo scope resta la **partita** e il retrieval resta **poche memorie**
 *     pertinenti, mai l'archivio intero.
 */
import { describe, expect, it } from 'vitest';
import {
  MINISTER_MEMORY_FAMILIES, MINISTER_MEMORY_LIMIT, emptyMinisterMemory, memoryFamily,
  memoryFamilyLabel, memorySection, normalizeMinisterMemory, recordMinisterMemory,
  relevantMinisterMemory, revokedMinisterMemory, revokeMinisterMemory,
  type MinisterMemory, type MinisterMemoryKind, type MinisterMemoryRecord, type MinisterMemoryScope,
} from '../src/core/government/MinisterMemory';

const scope: MinisterMemoryScope = { gameId: 'g1', branchId: 'main', seat: 'tesoro', mandate: 'tesoro@ITA:ind' };

const ALL_KINDS: MinisterMemoryKind[] = [
  'objective', 'proposal-discussed', 'proposal-rejected', 'open-question', 'queued-decision', 'verified-outcome',
];

function record(overrides: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'm1', kind: 'proposal-discussed', summary: 'Copertura dell’ospedale del sud', state: 'discussed',
    refs: { messageId: 'tesoro#2', gameDate: '1951-03-01', turn: 4 },
    ...overrides,
  };
}

describe('WS-GOVUX-P6 — le quattro famiglie', () => {
  it('ogni genere cade in una sola delle quattro famiglie', () => {
    const families = new Set(ALL_KINDS.map(kind => memoryFamily({ kind })));
    expect([...families].sort()).toEqual([...MINISTER_MEMORY_FAMILIES].sort());
  });

  it('decisione confermata = atto accodato o esito verificato', () => {
    expect(memoryFamily({ kind: 'queued-decision' })).toBe('confirmed-decision');
    expect(memoryFamily({ kind: 'verified-outcome' })).toBe('confirmed-decision');
    expect(memoryFamilyLabel('confirmed-decision')).toBe('decisione confermata');
  });

  it('preferenza dichiarata = obiettivo esplicitato dal Presidente', () => {
    expect(memoryFamily({ kind: 'objective' })).toBe('declared-preference');
    expect(memoryFamilyLabel('declared-preference')).toBe('preferenza dichiarata');
  });

  it('questione aperta e ipotesi esplorata restano distinte', () => {
    expect(memoryFamily({ kind: 'open-question' })).toBe('open-question');
    expect(memoryFamily({ kind: 'proposal-discussed' })).toBe('explored-hypothesis');
    expect(memoryFamily({ kind: 'proposal-rejected' })).toBe('explored-hypothesis');
  });
});

describe('WS-GOVUX-P6 — la revoca conserva la storia', () => {
  it('revocare marca il ricordo, non lo cancella', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const revoked = revokeMinisterMemory(memory, 'm1');
    expect(revoked.records).toHaveLength(1);
    expect(revoked.records[0].state).toBe('revoked');
    expect(revoked.records[0].summary).toBe('Copertura dell’ospedale del sud');
    expect(revoked.records[0].refs.turn).toBe(4);
    expect(revokedMinisterMemory(revoked)).toHaveLength(1);
  });

  it('la nota di revoca si conserva accanto al motivo precedente', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record({
      kind: 'proposal-rejected', state: 'rejected', reason: 'manca l’acciaio',
    }));
    const revoked = revokeMinisterMemory(memory, 'm1', 'il vincolo è caduto');
    expect(revoked.records[0].reason).toContain('manca l’acciaio');
    expect(revoked.records[0].reason).toContain('revocata: il vincolo è caduto');
  });

  it('un ricordo revocato non riemerge nel retrieval né nel prompt', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const revoked = revokeMinisterMemory(memory, 'm1');
    expect(relevantMinisterMemory(revoked)).toHaveLength(0);
    expect(memorySection(revoked)).toBe('');
  });

  it('revocare due volte è idempotente', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const once = revokeMinisterMemory(memory, 'm1', 'prima');
    const twice = revokeMinisterMemory(once, 'm1', 'seconda');
    expect(twice.records[0].reason).toContain('prima');
    expect(twice.records[0].reason).not.toContain('seconda');
  });
});

describe('WS-GOVUX-P6 — il turno è il tempo del ricordo', () => {
  it('il prompt porta il turno e la data, mai un timestamp tecnico', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const section = memorySection(memory);
    expect(section).toContain('turno 4');
    expect(section).toContain('1951-03-01');
  });

  it('senza turno il ricordo resta ancorato alla data', () => {
    const memory = recordMinisterMemory(emptyMinisterMemory(scope), record({ refs: { gameDate: '1951-03-01' } }));
    const section = memorySection(memory);
    expect(section).toContain('1951-03-01');
    expect(section).not.toContain('turno');
  });
});

describe('WS-GOVUX-P6 — validazione, scope e retrieval', () => {
  it('il vocabolario accoglie lo stato «revoked» ma scarta ciò che non conosce', () => {
    const kept = normalizeMinisterMemory([{ ...record(), state: 'revoked' }]);
    expect(kept).toHaveLength(1);
    expect(kept[0].state).toBe('revoked');
    expect(normalizeMinisterMemory([{ ...record(), state: 'magari' }])).toHaveLength(0);
  });

  it('due partite restano isolate', () => {
    const g1 = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const g2 = recordMinisterMemory(emptyMinisterMemory({ ...scope, gameId: 'g2' }), record({ id: 'altro' }));
    expect(g1.scope.gameId).toBe('g1');
    expect(g2.scope.gameId).toBe('g2');
    expect(g1.records.map(r => r.id)).toEqual(['m1']);
    expect(g2.records.map(r => r.id)).toEqual(['altro']);
  });

  it('il retrieval resta breve anche con un archivio lungo', () => {
    let memory: MinisterMemory = emptyMinisterMemory(scope);
    for (let i = 0; i < MINISTER_MEMORY_LIMIT; i++) memory = recordMinisterMemory(memory, record({ id: `m${i}` }));
    expect(relevantMinisterMemory(memory, 5)).toHaveLength(5);
    expect(relevantMinisterMemory(memory).length).toBeLessThan(memory.records.length);
  });
});
