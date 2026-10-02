/**
 * WS-GOV-DIALOGUE-TO-ACT — Il Decision Workspace, contratto puro
 * =============================================================
 * Difende il requisito centrale: **la conversazione modifica la Tavola, la
 * Tavola rappresenta la proposta corrente, e l'atto nasce dalla proposta
 * corrente**. Copre: workspace vuoto, obiettivo, proposta del ministro,
 * accettazione del Presidente, modifica di percentuale, esclusione, domande
 * aperte, revisioni (e niente revisioni sui no-op), rifiuto dei numeri inventati,
 * dato del motore, valore del Presidente, staleness dell'atto e act dalla
 * proposta.
 */
import { describe, expect, it } from 'vitest';
import {
  activeProposal, actStaleness, applyDecisionAction, applyDecisionBatch, emptyWorkspace,
  isReadyForAct, measureSummary, parseDecisionActions, proposalSummary, stripDecisionFences,
  withEvidenceRefs, workspaceStatus, type DecisionAction, type UpdateProposalAction,
} from './decisionWorkspace';
import { actDraftFor, actDraftFromProposal } from './actDraft';
import type { TreasuryRoad } from './treasuryAct';

const meta = (n: number) => ({ messageId: `tesoro#${n}` });

const objective = (): DecisionAction => ({
  op: 'set-objective', objective: 'Investire l’avanzo nelle infrastrutture', source: 'president',
});

const ministerProposal = (): UpdateProposalAction => ({
  op: 'update-proposal',
  changes: [
    { kind: 'allocation', label: 'Infrastrutture', sharePct: 70, source: 'minister' },
    { kind: 'allocation', label: 'Ammortamento del debito', sharePct: 30, source: 'minister' },
  ],
  unresolvedQuestions: ['ripartizione', 'opere prioritarie'],
});

const presidentSplit = (): UpdateProposalAction => ({
  op: 'update-proposal',
  changes: [
    { kind: 'allocation', label: 'Infrastrutture', sharePct: 80, source: 'president' },
    { kind: 'allocation', label: 'Ammortamento del debito', sharePct: 20, source: 'president' },
  ],
});

/** Il flusso Tesoro accettato: obiettivo → proposta ministro → 80/20 del Presidente. */
function tesoroFlow() {
  let ws = emptyWorkspace('tesoro');
  ws = applyDecisionAction(ws, objective(), meta(1));
  ws = applyDecisionAction(ws, ministerProposal(), meta(2));
  ws = applyDecisionBatch(ws, [presidentSplit(), { op: 'resolve-question', question: 'ripartizione' }, { op: 'resolve-question', question: 'opere' }], meta(3));
  return ws;
}

describe('WS-GOV-DIALOGUE-TO-ACT — workspace e revisioni', () => {
  it('il workspace vuoto non ha proposte e non ha revisioni', () => {
    const ws = emptyWorkspace('tesoro');
    expect(ws.revision).toBe(0);
    expect(ws.history).toEqual([]);
    expect(ws.status).toBe('exploring');
    expect(activeProposal(ws)).toBeNull();
  });

  it('crea l’obiettivo e apre la proposta (shaping)', () => {
    const ws = applyDecisionAction(emptyWorkspace('tesoro'), objective(), meta(1));
    expect(ws.objective).toBe('Investire l’avanzo nelle infrastrutture');
    expect(ws.revision).toBe(1);
    expect(activeProposal(ws)?.objective).toBe('Investire l’avanzo nelle infrastrutture');
    expect(ws.status).toBe('shaping');
  });

  it('la proposta del ministro resta `proposed`, non diventa decisione', () => {
    let ws = applyDecisionAction(emptyWorkspace('tesoro'), objective(), meta(1));
    ws = applyDecisionAction(ws, ministerProposal(), meta(2));
    const proposal = activeProposal(ws)!;
    expect(proposal.measures.every(measure => measure.status === 'proposed')).toBe(true);
    expect(proposal.unresolvedQuestions).toEqual(['ripartizione', 'opere prioritarie']);
    expect(ws.status).toBe('negotiating');
    expect(isReadyForAct(ws)).toBe(false);
    expect(proposalSummary(proposal)).toBe('70% Infrastrutture / 30% Ammortamento del debito');
  });

  it('il valore esplicito del Presidente è accettato e chiude la ripartizione', () => {
    const ws = tesoroFlow();
    const proposal = activeProposal(ws)!;
    const infrastructures = proposal.measures.find(measure => measure.label === 'Infrastrutture')!;
    expect(infrastructures.sharePct).toBe(80);
    expect(infrastructures.status).toBe('accepted');
    expect(infrastructures.source).toBe('president');
    expect(proposal.unresolvedQuestions).toEqual([]);
    expect(isReadyForAct(ws)).toBe(true);
    expect(ws.status).toBe('ready-for-act');
    expect(proposalSummary(proposal)).toBe('80% Infrastrutture / 20% Ammortamento del debito');
  });

  it('ogni modifica sostanziale incrementa la revisione; il no-op non la tocca', () => {
    const ws = tesoroFlow();
    expect(ws.revision).toBe(3);
    expect(ws.history.map(entry => entry.revision)).toEqual([1, 2, 3]);
    // Ripetere la stessa azione non cambia nulla: stessa istanza, stessa revisione.
    const again = applyDecisionAction(ws, presidentSplit(), meta(4));
    expect(again).toBe(ws);
    expect(again.revision).toBe(3);
    // Una modifica di percentuale, invece, apre la revisione 4.
    const modified = applyDecisionAction(ws, {
      op: 'update-proposal',
      changes: [{ kind: 'allocation', label: 'Infrastrutture', sharePct: 65, source: 'president' }],
    }, meta(4));
    expect(modified.revision).toBe(4);
    expect(activeProposal(modified)?.measures.find(m => m.label === 'Infrastrutture')?.sharePct).toBe(65);
  });

  it('esclude una voce senza cancellarla', () => {
    let ws = tesoroFlow();
    ws = applyDecisionAction(ws, { op: 'reject-measure', label: 'Ammortamento del debito' }, meta(4));
    const excluded = activeProposal(ws)!.measures.find(measure => measure.label === 'Ammortamento del debito')!;
    expect(excluded.status).toBe('rejected');
    expect(measureSummary(excluded)).toBe('Ammortamento del debito (esclusa)');
  });

  it('una misura non definita resta `unresolved` e blocca l’atto', () => {
    let ws = applyDecisionAction(emptyWorkspace('tesoro'), objective(), meta(1));
    ws = applyDecisionAction(ws, {
      op: 'update-proposal',
      changes: [{ kind: 'target', label: 'Copertura', source: 'president', status: 'unresolved' }],
    }, meta(2));
    expect(activeProposal(ws)!.measures[0].status).toBe('unresolved');
    expect(isReadyForAct(ws)).toBe(false);
    expect(ws.status).toBe('negotiating');
  });

  it('il dato del motore entra come accettato, non come proposta', () => {
    const ws = applyDecisionAction(emptyWorkspace('tesoro'), {
      op: 'update-proposal',
      changes: [{ kind: 'target', label: 'Interessi passivi', value: '0,54', unit: 'mld', source: 'engine' }],
    }, meta(1));
    const measure = activeProposal(ws)!.measures[0];
    expect(measure.source).toBe('engine');
    expect(measure.status).toBe('accepted');
  });

  it('le evidenze sono riferimenti, non revisioni: non aprono una revisione', () => {
    const ws = tesoroFlow();
    const linked = withEvidenceRefs(ws, ['spesa', 'mappa', 'spesa']);
    expect(linked.evidenceIds).toEqual(['spesa', 'mappa']);
    expect(linked.revision).toBe(ws.revision);
    expect(withEvidenceRefs(linked, ['spesa', 'mappa'])).toBe(linked);
  });
});

describe('WS-GOV-DIALOGUE-TO-ACT — parser `decision`: mai numeri inventati', () => {
  const block = (json: string) => `Testo del ministro.\n\`\`\`decision\n${json}\n\`\`\`\n`;

  it('accetta una misura con provenienza valida e la toglie dal testo visibile', () => {
    const text = block('{"op":"update-proposal","changes":[{"kind":"allocation","label":"Infrastrutture","sharePct":80,"source":"president"}]}');
    const actions = parseDecisionActions(text);
    expect(actions).toHaveLength(1);
    expect(stripDecisionFences(text).trim()).toBe('Testo del ministro.');
  });

  it('rifiuta una percentuale fuori scala', () => {
    expect(parseDecisionActions(block('{"op":"update-proposal","changes":[{"label":"X","sharePct":150,"source":"president"}]}'))).toEqual([]);
  });

  it('rifiuta una provenienza inventata', () => {
    expect(parseDecisionActions(block('{"op":"update-proposal","changes":[{"label":"X","sharePct":50,"source":"model"}]}'))).toEqual([]);
    expect(parseDecisionActions(block('{"op":"update-proposal","changes":[{"label":"X","sharePct":50}]}'))).toEqual([]);
  });

  it('rifiuta markup e codice', () => {
    expect(parseDecisionActions(block('{"op":"set-objective","objective":"<b>ciao</b>","source":"president"}'))).toEqual([]);
    expect(parseDecisionActions(block('{"op":"set-objective","objective":"javascript:alert(1)","source":"president"}'))).toEqual([]);
  });

  it('accetta obiettivo, accettazione e domanda risolta', () => {
    expect(parseDecisionActions(block('{"op":"set-objective","objective":"Una priorità","source":"president"}'))[0]).toEqual({ op: 'set-objective', objective: 'Una priorità', source: 'president' });
    expect(parseDecisionActions(block('{"op":"accept-proposal"}'))[0]).toEqual({ op: 'accept-proposal' });
    expect(parseDecisionActions(block('{"op":"resolve-question","question":"ripartizione"}'))[0]).toEqual({ op: 'resolve-question', question: 'ripartizione' });
  });
});

describe('WS-GOV-DIALOGUE-TO-ACT — l’atto dalla proposta corrente', () => {
  const road: TreasuryRoad = {
    id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', declaredCost: '12,00 mld',
    expectedGain: '0,54 mld in meno', recommended: true, order: { kind: 'text', text: 'Rimborso titoli: 12,00 mld in scadenza.' },
  };

  it('la proposta concordata produce l’atto, con i valori della revisione corrente', () => {
    const ws = tesoroFlow();
    const draft = actDraftFromProposal(activeProposal(ws)!, { seat: 'tesoro' });
    expect(draft.text).toContain('80%');
    expect(draft.text).toContain('20%');
    expect(draft.text).toContain('Infrastrutture');
    // Non contiene i valori della strada iniziale del Tesoro.
    expect(draft.text).not.toContain('Rimborso titoli');
    expect(draft.capability).toBe('text-order');
  });

  it('una nuova revisione cambia l’atto: i valori vecchi non restano', () => {
    let ws = tesoroFlow();
    ws = applyDecisionAction(ws, {
      op: 'update-proposal',
      changes: [{ kind: 'allocation', label: 'Infrastrutture', sharePct: 90, source: 'president' }],
    }, meta(4));
    const draft = actDraftFromProposal(activeProposal(ws)!, { seat: 'tesoro' });
    expect(draft.text).toContain('90%');
    expect(draft.text).not.toContain('80%');
  });

  it('l’atto preparato diventa stale quando la proposta avanza', () => {
    const ws = tesoroFlow();
    expect(workspaceStatus(ws, ws.revision)).toBe('act-prepared');
    expect(actStaleness(ws, ws.revision)).toBeNull();
    const advanced = applyDecisionAction(ws, {
      op: 'update-proposal',
      changes: [{ kind: 'allocation', label: 'Infrastrutture', sharePct: 55, source: 'president' }],
    }, meta(4));
    expect(actStaleness(advanced, ws.revision)).toEqual({ from: ws.revision, to: advanced.revision });
  });

  it('`actDraftFor(road)` resta il fallback compatibile per le proposte non negoziate', () => {
    const draft = actDraftFor(road, 'tesoro');
    expect(draft.roadId).toBe('repay');
    expect(draft.text).toBe(road.order.kind === 'text' ? road.order.text : '');
    expect(draft.capability).toBe('text-order');
  });
});
