/**
 * WS-GOV-DIALOGUE-TO-ACT — La proposta corrente resa (render)
 * ==========================================================
 * Difende ciò che il Presidente vede sulla tavola: obiettivo, proposta corrente
 * con la provenienza, «da decidere», revisioni, e — quando la proposta è
 * pronta — il comando «Trasforma questa proposta in atto». E quando la proposta
 * avanza dopo la preparazione, l'atto si dichiara **non più attuale**.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionBoard } from './DecisionBoard';
import {
  applyDecisionAction, applyDecisionBatch, emptyWorkspace, type DecisionWorkspace,
} from './decisionWorkspace';

const meta = (n: number) => ({ messageId: `tesoro#${n}` });

function ready(): DecisionWorkspace {
  let ws = emptyWorkspace('tesoro');
  ws = applyDecisionAction(ws, { op: 'set-objective', objective: 'Investire l’avanzo nelle infrastrutture', source: 'president' }, meta(1));
  ws = applyDecisionAction(ws, {
    op: 'update-proposal',
    changes: [
      { kind: 'allocation', label: 'Infrastrutture', sharePct: 70, source: 'minister' },
      { kind: 'allocation', label: 'Ammortamento del debito', sharePct: 30, source: 'minister' },
    ],
    unresolvedQuestions: ['ripartizione'],
  }, meta(2));
  ws = applyDecisionBatch(ws, [
    { op: 'update-proposal', changes: [
      { kind: 'allocation', label: 'Infrastrutture', sharePct: 80, source: 'president' },
      { kind: 'allocation', label: 'Ammortamento del debito', sharePct: 20, source: 'president' },
    ] },
    { op: 'resolve-question', question: 'ripartizione' },
  ], meta(3));
  return ws;
}

describe('WS-GOV-DIALOGUE-TO-ACT — la proposta corrente sulla tavola', () => {
  it('mostra obiettivo, proposta corrente, valori e provenienza', () => {
    const html = renderToStaticMarkup(<DecisionBoard workspace={ready()} question="Come usare l’avanzo?" />);
    expect(html).toContain('Obiettivo');
    expect(html).toContain('Investire l’avanzo nelle infrastrutture');
    expect(html).toContain('Proposta corrente');
    expect(html).toContain('80%');
    expect(html).toContain('20%');
    expect(html).toContain('scelta del Presidente');
    expect(html).toContain('Come usare l’avanzo?');
  });

  it('quando la proposta è pronta, il comando è «Trasforma questa proposta in atto»', () => {
    const html = renderToStaticMarkup(<DecisionBoard workspace={ready()} onPrepareAct={() => {}} />);
    expect(html).toContain('pronta per l’atto');
    expect(html).toContain('Trasforma questa proposta in atto');
    expect(html).not.toContain('Rigenera atto');
  });

  it('la proposta del ministro resta «proposta», non decisione', () => {
    let ws = applyDecisionAction(emptyWorkspace('tesoro'), { op: 'set-objective', objective: 'Priorità', source: 'president' }, meta(1));
    ws = applyDecisionAction(ws, {
      op: 'update-proposal',
      changes: [{ kind: 'allocation', label: 'Scuole', sharePct: 60, source: 'minister' }],
      unresolvedQuestions: ['quanto al resto'],
    }, meta(2));
    const html = renderToStaticMarkup(<DecisionBoard workspace={ws} />);
    expect(html).toContain('proposta del ministro');
    expect(html).toContain('Da decidere');
    expect(html).toContain('Continua la discussione');
  });

  it('quando la proposta avanza dopo la preparazione, l’atto è «non più attuale»', () => {
    const ws = ready();
    const html = renderToStaticMarkup(
      <DecisionBoard workspace={ws} actRevision={ws.revision - 1} onRegenerateAct={() => {}} />,
    );
    expect(html).toContain('Atto non più attuale');
    expect(html).toContain('Rigenera atto');
    expect(html).not.toContain('Trasforma questa proposta in atto');
  });

  it('con l’atto allineato, la tavola dichiara l’atto preparato', () => {
    const ws = ready();
    const html = renderToStaticMarkup(<DecisionBoard workspace={ws} actRevision={ws.revision} />);
    expect(html).toContain('atto preparato');
    expect(html).toContain('Atto preparato sulla proposta corrente');
  });

  it('mostra le revisioni in una cronologia', () => {
    const html = renderToStaticMarkup(<DecisionBoard workspace={ready()} />);
    expect(html).toContain('Revisioni');
    expect(html).toContain('v1');
    expect(html).toContain('v3');
  });
});
