/**
 * WS-GOVUX-P6 — La memoria del Consiglio (lato client)
 * ===================================================
 * Difende le quattro regole della fase, tutte pure e verificabili:
 *  1. le quattro **famiglie** (decisione confermata / preferenza dichiarata /
 *     questione aperta / ipotesi esplorata) sono derivate dal genere;
 *  2. la **revoca conserva la storia**: il ricordo resta, smette di riemergere;
 *  3. il **tempo del ricordo è il turno** del mondo, non il timestamp tecnico;
 *  4. lo scope resta la **partita**, e il retrieval resta **poche memorie**
 *     pertinenti, mai l'archivio intero.
 */
import { describe, expect, it } from 'vitest';
import {
  FAMILY_LABEL, MINISTER_MEMORY_LIMIT, declaredPreference, discussedProposal, memoryFamily,
  memorySection, openQuestion, queuedDecision, recordMemory, relevantMemory, revokedMemory,
  revokeMemory, withSeatRecords, type MinisterMemoryKind, type MinisterMemoryRecord,
} from './ministerMemory';

const ref = { messageId: 'tesoro#2', gameDate: '1951-03-01', turn: 4 };

function record(overrides: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'r1', kind: 'proposal-discussed', summary: 'Proposta', state: 'discussed', refs: ref,
    ...overrides,
  };
}

const ALL_KINDS: MinisterMemoryKind[] = [
  'objective', 'proposal-discussed', 'proposal-rejected', 'open-question', 'queued-decision', 'verified-outcome',
];

describe('WS-GOVUX-P6 — le quattro famiglie', () => {
  it('ogni genere cade in una famiglia, e solo in una', () => {
    const families = new Set(ALL_KINDS.map(kind => memoryFamily({ kind })));
    expect([...families].sort()).toEqual(Object.keys(FAMILY_LABEL).sort());
  });

  it('le decisioni confermate sono gli atti accodati o verificati', () => {
    expect(memoryFamily({ kind: 'queued-decision' })).toBe('confirmed-decision');
    expect(memoryFamily({ kind: 'verified-outcome' })).toBe('confirmed-decision');
  });

  it('la preferenza dichiarata è l’obiettivo esplicitato, non una decisione', () => {
    expect(memoryFamily({ kind: 'objective' })).toBe('declared-preference');
    const preference = declaredPreference('tesoro', 'Ammortamento del debito', ref);
    expect(preference.kind).toBe('objective');
    expect(preference.state).toBe('open');
    expect(memoryFamily(preference)).toBe('declared-preference');
  });

  it('la questione aperta e l’ipotesi esplorata restano distinte', () => {
    expect(memoryFamily({ kind: 'open-question' })).toBe('open-question');
    expect(memoryFamily({ kind: 'proposal-discussed' })).toBe('explored-hypothesis');
    expect(memoryFamily({ kind: 'proposal-rejected' })).toBe('explored-hypothesis');
  });

  it('ogni famiglia ha un’etichetta italiana', () => {
    expect(FAMILY_LABEL['confirmed-decision']).toBe('decisione confermata');
    expect(FAMILY_LABEL['declared-preference']).toBe('preferenza dichiarata');
    expect(FAMILY_LABEL['open-question']).toBe('questione aperta');
    expect(FAMILY_LABEL['explored-hypothesis']).toBe('ipotesi esplorata');
  });
});

describe('WS-GOVUX-P6 — la revoca conserva la storia', () => {
  it('revocare marca il ricordo, non lo cancella', () => {
    const base = queuedDecision('tesoro', 'Rimborsa i titoli', ref);
    const revoked = revokeMemory([base], base.id);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].state).toBe('revoked');
    expect(revoked[0].summary).toBe(base.summary);
    expect(revoked[0].refs).toEqual(base.refs);
    expect(revokedMemory(revoked)).toHaveLength(1);
  });

  it('la nota di revoca si conserva accanto al motivo precedente', () => {
    const base = record({ id: 'respinta', kind: 'proposal-rejected', state: 'rejected', reason: 'manca l’acciaio' });
    const revoked = revokeMemory([base], 'respinta', 'il vincolo è caduto');
    expect(revoked[0].reason).toContain('manca l’acciaio');
    expect(revoked[0].reason).toContain('revocata: il vincolo è caduto');
  });

  it('un ricordo revocato non riemerge nel retrieval né nel prompt', () => {
    const base = discussedProposal('tesoro', { id: 'repay', title: 'Ammortamento' }, ref);
    const revoked = revokeMemory([base], base.id);
    expect(relevantMemory(revoked)).toHaveLength(0);
    expect(memorySection(revoked)).toBe('');
  });

  it('revocare un id assente non cambia nulla', () => {
    const base = discussedProposal('tesoro', { id: 'repay', title: 'Ammortamento' }, ref);
    expect(revokeMemory([base], 'inesistente')).toEqual([base]);
  });

  it('revocare due volte è idempotente', () => {
    const base = queuedDecision('tesoro', 'Rimborsa i titoli', ref);
    const once = revokeMemory([base], base.id, 'prima');
    const twice = revokeMemory(once, base.id, 'seconda');
    expect(twice[0].reason).toContain('prima');
    expect(twice[0].reason).not.toContain('seconda');
  });
});

describe('WS-GOVUX-P6 — il turno è il tempo del ricordo', () => {
  it('la provenienza nel prompt porta il turno, non un timestamp', () => {
    const records = recordMemory([], record({ refs: { gameDate: '1951-03-01', turn: 4 } }));
    const section = memorySection(records);
    expect(section).toContain('turno 4');
    expect(section).toContain('1951-03-01');
  });

  it('un ricordo senza turno resta ancorato alla data', () => {
    const records = recordMemory([], record({ refs: { gameDate: '1951-03-01' } }));
    expect(memorySection(records)).toContain('1951-03-01');
    expect(memorySection(records)).not.toContain('turno');
  });
});

describe('WS-GOVUX-P6 — scope e retrieval', () => {
  it('lo store è per sedia: una sedia non vede i ricordi dell’altra', () => {
    const store = withSeatRecords(
      withSeatRecords({}, 'tesoro', [record({ id: 'a' })]),
      'lavori',
      [record({ id: 'b' })],
    );
    expect(store.tesoro.map(r => r.id)).toEqual(['a']);
    expect(store.lavori.map(r => r.id)).toEqual(['b']);
  });

  it('il retrieval resta breve anche con un archivio lungo', () => {
    let records: MinisterMemoryRecord[] = [];
    for (let i = 0; i < MINISTER_MEMORY_LIMIT; i++) records = recordMemory(records, record({ id: `m${i}` }));
    expect(relevantMemory(records, 5)).toHaveLength(5);
    expect(relevantMemory(records).length).toBeLessThan(records.length);
  });

  it('le questioni aperte entrano nel retrieval, le ipotesi restano dopo', () => {
    const open: MinisterMemoryRecord = openQuestion('tesoro', 'Porto da decidere', ref);
    const hypothesis = discussedProposal('tesoro', { id: 'a', title: 'Ospedale' }, ref);
    const ordered = relevantMemory(recordMemory(recordMemory([], hypothesis), open));
    expect(ordered[0].kind).toBe('open-question');
  });
});
