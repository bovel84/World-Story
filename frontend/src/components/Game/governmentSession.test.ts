/**
 * WS-GOV-TURN-SESSIONS — La seduta appartiene al turno (A1/A2/A3/A6)
 * =================================================================
 * Difende il criterio di successo: avanzando il turno T, la seduta T+1 riparte
 * da zero; la proposta del turno T **non** è lo stato operativo di T+1, ma
 * diventa **memoria**. E l'atto porta con sé turno e revisione di origine.
 */
import { describe, expect, it } from 'vitest';
import {
  actIdentity, consolidateSessionMemory, governmentSessionId, isFreshSession,
  previousSessionMemory, seatFromSessionSeatKey, sessionSeatKey,
} from './governmentSession';
import { activeProposal, applyDecisionAction, emptyWorkspace } from './decisionWorkspace';

function confirmedWorkspace() {
  let ws = emptyWorkspace('lavori');
  ws = applyDecisionAction(ws, { op: 'set-objective', objective: 'Fabbrica a Sarajevo', source: 'president' }, { messageId: 'lavori#1' });
  ws = applyDecisionAction(ws, {
    op: 'update-proposal',
    changes: [
      { kind: 'work', label: 'Fabbrica siderurgica', source: 'president' },
      { kind: 'region', label: 'Sarajevo', source: 'president' },
    ],
    unresolvedQuestions: ['materiali mancanti'],
  }, { messageId: 'lavori#2' });
  return ws;
}

describe('GovernmentSessionKey — due turni, due sedute (A1)', () => {
  it('l’identità distingue gioco, ramo, turno, tipo e sedia', () => {
    const base = { gameId: 'g1', branchId: 'b1', turn: 5, kind: 'minister' as const, seat: 'lavori' as const };
    const a = governmentSessionId(base);
    expect(governmentSessionId(base)).toBe(a);
    expect(governmentSessionId({ ...base, turn: 6 })).not.toBe(a);
    expect(governmentSessionId({ ...base, seat: 'tesoro' })).not.toBe(a);
    expect(governmentSessionId({ ...base, kind: 'council' })).not.toBe(a);
    expect(governmentSessionId({ ...base, branchId: null })).not.toBe(a);
  });

  it('la chiave dello stato di sedia è dentro la seduta', () => {
    const session = governmentSessionId({ gameId: 'g1', branchId: null, turn: 3, kind: 'minister', seat: 'lavori' });
    const key = sessionSeatKey(session, 'lavori');
    expect(key).toContain('lavori');
    expect(seatFromSessionSeatKey(key)).toBe('lavori');
    // La stessa sedia in un altro turno è un'altra chiave.
    const other = governmentSessionId({ gameId: 'g1', branchId: null, turn: 4, kind: 'minister', seat: 'lavori' });
    expect(sessionSeatKey(other, 'lavori')).not.toBe(key);
  });

  it('una seduta appena aperta riparte da revisione 0', () => {
    expect(isFreshSession(emptyWorkspace('lavori'))).toBe(true);
    expect(isFreshSession(confirmedWorkspace())).toBe(false);
  });
});

describe('Consolidamento della seduta in memoria (A3)', () => {
  it('estrae la decisione confermata e le domande rimaste aperte', () => {
    const records = consolidateSessionMemory(confirmedWorkspace(), 'lavori', { gameDate: '1926-04-02', turn: 5 });
    expect(records.some(record => record.kind === 'queued-decision')).toBe(true);
    expect(records.some(record => record.kind === 'open-question')).toBe(true);
    const decision = records.find(record => record.kind === 'queued-decision');
    expect(decision?.summary).toContain('Fabbrica siderurgica');
    expect(decision?.summary).toContain('Sarajevo');
  });

  it('una seduta senza nulla di fatto non produce ricordi', () => {
    expect(consolidateSessionMemory(emptyWorkspace('tesoro'), 'tesoro', { gameDate: '1926-04-02', turn: 5 })).toEqual([]);
  });

  it('non porta mai la proposta come stato attivo: solo memoria narrativa', () => {
    const records = consolidateSessionMemory(confirmedWorkspace(), 'lavori', { gameDate: '1926-04-02', turn: 5 });
    // I record sono ricordi tipizzati, non un workspace.
    for (const record of records) {
      expect(record).not.toHaveProperty('proposals');
      expect(record).not.toHaveProperty('revision');
    }
  });
});

describe('provenienza temporale della seduta precedente (punto 17)', () => {
  it('turno 5 data D5, consolidato al turno 6: il ricordo porta turno 5 e data D5, non 6', () => {
    const session5 = governmentSessionId({ gameId: 'g1', branchId: null, turn: 5, kind: 'minister' });
    const session6 = governmentSessionId({ gameId: 'g1', branchId: null, turn: 6, kind: 'minister' });
    const workspaces = {
      [sessionSeatKey(session5, 'lavori')]: confirmedWorkspace(),
    };
    const consolidated = previousSessionMemory({
      previous: { sessionId: session5, turn: 5, date: 'D5' },
      workspaces,
      seatOf: key => seatFromSessionSeatKey(key) as 'lavori' | null,
    });
    const records = consolidated.flatMap(entry => entry.records);
    const decision = records.find(record => record.kind === 'queued-decision');
    expect(decision).toBeDefined();
    // La provenienza è quella della decisione, non del turno nuovo.
    expect(decision?.refs.turn).toBe(5);
    expect(decision?.refs.gameDate).toBe('D5');
    expect(decision?.refs.turn).not.toBe(6);
    // E il nuovo workspace parte davvero da turno 6 / revisione 0: la chiave 6
    // non esiste ancora, quindi non si legge lo stato del turno 5.
    expect(workspaces[sessionSeatKey(session6, 'lavori')]).toBeUndefined();
  });

  it('senza data di origine il ricordo resta datato con la sua provenienza (mai il turno nuovo)', () => {
    const session5 = governmentSessionId({ gameId: 'g1', branchId: null, turn: 5, kind: 'minister' });
    const consolidated = previousSessionMemory({
      previous: { sessionId: session5, turn: 5, date: null },
      workspaces: { [sessionSeatKey(session5, 'lavori')]: confirmedWorkspace() },
      seatOf: key => seatFromSessionSeatKey(key) as 'lavori' | null,
    });
    const decision = consolidated.flatMap(entry => entry.records).find(record => record.kind === 'queued-decision');
    expect(decision?.refs.turn).toBe(5);
    expect(decision?.refs.gameDate).toBe('');
  });
});

describe('Identità dell’atto (A6)', () => {
  it('porta turno, revisione, sedia e seduta; due turni distinguono Atto A e Atto B', () => {
    const a = actIdentity('g1|main|5|minister|lavori', 5, 'lavori', 3);
    const b = actIdentity('g1|main|6|minister|lavori', 6, 'lavori', 3);
    expect(a).toEqual({ sourceTurn: 5, sourceRevision: 3, sourceSeat: 'lavori', sourceSessionId: 'g1|main|5|minister|lavori' });
    expect(a.sourceTurn).not.toBe(b.sourceTurn);
    expect(a.sourceSessionId).not.toBe(b.sourceSessionId);
  });

  it('la proposta del turno T resta nel workspace della sua chiave (non di T+1)', () => {
    const session5 = governmentSessionId({ gameId: 'g1', branchId: null, turn: 5, kind: 'minister', seat: 'lavori' });
    const session6 = governmentSessionId({ gameId: 'g1', branchId: null, turn: 6, kind: 'minister', seat: 'lavori' });
    const store: Record<string, ReturnType<typeof confirmedWorkspace>> = {
      [sessionSeatKey(session5, 'lavori')]: confirmedWorkspace(),
    };
    expect(activeProposal(store[sessionSeatKey(session5, 'lavori')])).not.toBeNull();
    // Il turno nuovo non vede alcun workspace: è ripartito da zero.
    expect(store[sessionSeatKey(session6, 'lavori')]).toBeUndefined();
  });
});
