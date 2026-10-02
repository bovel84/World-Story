/**
 * WS-GOV-SEAT-BOARDS — La Tavola comune del Consiglio (B25/B26)
 * ============================================================
 * Difende la regola: la proposta del singolo ministro si **promuove** al
 * Consiglio senza duplicazione. Il Consiglio legge il workspace **vivo** delle
 * sedie convocate — non una copia che può divergere — e la Tavola del Tesoro non
 * è la Tavola comune.
 */
import { describe, expect, it } from 'vitest';
import { applyDecisionAction, emptyWorkspace, type DecisionWorkspace } from './decisionWorkspace';
import {
  canPromoteToCouncil, conveneSeat, councilContributions, councilLines,
  councilReadyForAct, councilStatus, promoteToCouncil, seatsNotConvened,
} from './councilWorkspace';

function lavoriProposal(): DecisionWorkspace {
  let ws = emptyWorkspace('lavori');
  ws = applyDecisionAction(ws, { op: 'set-objective', objective: 'Costruire una fabbrica siderurgica', source: 'president' }, { messageId: 'lavori#1' });
  ws = applyDecisionAction(ws, {
    op: 'update-proposal',
    changes: [
      { kind: 'work', label: 'Fabbrica siderurgica', source: 'president' },
      { kind: 'region', label: 'Sarajevo', source: 'president' },
      { kind: 'constraint', label: 'Acciaio mancante', source: 'minister', status: 'unresolved' },
    ],
    unresolvedQuestions: ['copertura finanziaria'],
  }, { messageId: 'lavori#2' });
  return ws;
}

function tesoroProposal(): DecisionWorkspace {
  let ws = emptyWorkspace('tesoro');
  ws = applyDecisionAction(ws, {
    op: 'update-proposal',
    changes: [{ kind: 'target', label: 'Copertura finanziaria', value: '2,00 mld', source: 'minister' }],
  }, { messageId: 'tesoro#1' });
  return ws;
}

describe('promozione e convocazione (B26)', () => {
  it('si promuove solo con un obiettivo o una proposta', () => {
    expect(canPromoteToCouncil(emptyWorkspace('lavori'))).toBe(false);
    expect(canPromoteToCouncil(lavoriProposal())).toBe(true);
  });

  it('promuovere conserva obiettivo, riferimento alla proposta e lineage di revisione', () => {
    const ws = lavoriProposal();
    const council = promoteToCouncil(ws, 'lavori');
    expect(council.objective).toBe('Costruire una fabbrica siderurgica');
    expect(council.originSeat).toBe('lavori');
    expect(council.seats).toEqual(['lavori']);
    expect(council.promotedProposalIds).toHaveLength(1);
    expect(council.revision).toBe(ws.revision);
  });

  it('convocare una sedia è idempotente e non muta il Consiglio di partenza', () => {
    const council = promoteToCouncil(lavoriProposal(), 'lavori');
    const withTesoro = conveneSeat(council, 'tesoro');
    expect(withTesoro.seats).toEqual(['lavori', 'tesoro']);
    expect(council.seats).toEqual(['lavori']); // immutabile
    expect(conveneSeat(withTesoro, 'tesoro')).toBe(withTesoro);
  });

  it('elenca le sedie ancora da convocare', () => {
    const council = conveneSeat(promoteToCouncil(lavoriProposal(), 'lavori'), 'tesoro');
    expect(seatsNotConvened(council)).not.toContain('lavori');
    expect(seatsNotConvened(council)).not.toContain('tesoro');
    expect(seatsNotConvened(council)).toContain('guerra');
  });
});

describe('la Tavola comune aggrega le contribuzioni vive (B25)', () => {
  it('ogni sedia convocata porta la sua competenza e le sue misure', () => {
    const council = conveneSeat(promoteToCouncil(lavoriProposal(), 'lavori'), 'tesoro');
    const contributions = councilContributions(council, seat => (seat === 'lavori' ? lavoriProposal() : seat === 'tesoro' ? tesoroProposal() : null));
    expect(contributions.map(contribution => contribution.seat)).toEqual(['lavori', 'tesoro']);
    expect(contributions[0].label).toBe('La tavola dei Lavori');
    expect(contributions[0].measures.map(measure => measure.label)).toContain('Sarajevo');
    expect(contributions[1].label).toBe('La tavola del Tesoro');
    expect(contributions[1].measures.map(measure => measure.label)).toContain('Copertura finanziaria');
  });

  it('la proposta promossa non è una copia: se il workspace vive, il Consiglio lo vede', () => {
    const council = promoteToCouncil(lavoriProposal(), 'lavori');
    // Il workspace della sedia avanza dopo la promozione.
    const advanced = applyDecisionAction(lavoriProposal(), {
      op: 'update-proposal', changes: [{ kind: 'target', label: 'Tempi', value: '18 mesi', source: 'minister' }],
    }, { messageId: 'lavori#3' });
    const lines = councilLines(council, seat => (seat === 'lavori' ? advanced : null));
    expect(lines[0].measures.join(' / ')).toContain('Tempi: 18 mesi');
  });

  it('il Consiglio resta aperto finché una sedia convocata non porta la sua parte', () => {
    const council = conveneSeat(promoteToCouncil(lavoriProposal(), 'lavori'), 'tesoro');
    expect(councilStatus(council, seat => (seat === 'lavori' ? lavoriProposal() : null))).toBe('open');
    expect(councilReadyForAct(council, seat => (seat === 'lavori' ? lavoriProposal() : null))).toBe(false);
  });

  it('con ogni competenza al suo posto e senza domande aperte, il Consiglio è pronto', () => {
    let lavori = emptyWorkspace('lavori');
    lavori = applyDecisionAction(lavori, { op: 'set-objective', objective: 'Fabbrica a Sarajevo', source: 'president' }, { messageId: 'lavori#1' });
    lavori = applyDecisionAction(lavori, {
      op: 'update-proposal',
      changes: [
        { kind: 'work', label: 'Fabbrica', source: 'president' },
        { kind: 'region', label: 'Sarajevo', source: 'president' },
      ],
    }, { messageId: 'lavori#2' });
    let tesoro = emptyWorkspace('tesoro');
    tesoro = applyDecisionAction(tesoro, {
      op: 'update-proposal', changes: [{ kind: 'target', label: 'Copertura finanziaria', source: 'president' }],
    }, { messageId: 'tesoro#1' });

    const council = conveneSeat(promoteToCouncil(lavori, 'lavori'), 'tesoro');
    const lookup = (seat: string) => (seat === 'lavori' ? lavori : seat === 'tesoro' ? tesoro : null);
    expect(councilStatus(council, lookup)).toBe('ready-for-act');
    expect(councilReadyForAct(council, lookup)).toBe(true);
  });
});
