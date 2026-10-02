/**
 * WS-GOV-SEAT-BOARDS — La Tavola resa per sedia (B21/B22/B28)
 * ==========================================================
 * Difende la regola finale: la Tavola è un'infrastruttura del Governo. Titolo,
 * sezioni e catalogo di evidenze cambiano con la sedia, e una sedia non mostra
 * il blocco di un'altra.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionBoard } from './DecisionBoard';
import { applyDecisionAction, emptyWorkspace, type DecisionWorkspace, type MeasureInput } from './decisionWorkspace';

function build(seat: string, changes: MeasureInput[]): DecisionWorkspace {
  let ws = emptyWorkspace(seat);
  ws = applyDecisionAction(ws, { op: 'set-objective', objective: `Obiettivo ${seat}`, source: 'president' }, { messageId: `${seat}#1` });
  ws = applyDecisionAction(ws, { op: 'update-proposal', changes }, { messageId: `${seat}#2` });
  return ws;
}

describe('DecisionBoard seat-aware — ogni sedia ha la sua Tavola', () => {
  it('il titolo e le sezioni sono quelli della sedia', () => {
    const lavori = renderToStaticMarkup(
      <DecisionBoard workspace={build('lavori', [{ kind: 'work', label: 'Fabbrica siderurgica', source: 'president' }])} seat="lavori" />,
    );
    expect(lavori).toContain('La tavola dei Lavori');
    expect(lavori).toContain('Opera');
    expect(lavori).not.toContain('La tavola del Tesoro');

    const tesoro = renderToStaticMarkup(
      <DecisionBoard workspace={build('tesoro', [{ kind: 'work', label: 'Fabbrica siderurgica', source: 'president' }])} seat="tesoro" />,
    );
    expect(tesoro).toContain('La tavola del Tesoro');
    // Il Tesoro chiama la stessa misura con l'etichetta della sua competenza.
    expect(tesoro).toContain('Opere finanziate');
    expect(tesoro).not.toContain('>Opera<');
  });

  it('l’obiettivo porta l’etichetta di competenza', () => {
    const sanita = renderToStaticMarkup(
      <DecisionBoard workspace={build('sanita', [{ kind: 'target', label: 'Copertura', source: 'president' }])} seat="sanita" />,
    );
    expect(sanita).toContain('Obiettivo sanitario');
    expect(sanita).toContain('Bisogno sanitario');
  });

  it('la Guerra raggruppa le forze e mostra la sua competenza', () => {
    const guerra = renderToStaticMarkup(
      <DecisionBoard workspace={build('guerra', [{ kind: 'work', label: 'Reggimento', source: 'president' }])} seat="guerra" />,
    );
    expect(guerra).toContain('La tavola della Guerra');
    expect(guerra).toContain('Forze e unità');
    expect(guerra).toContain('Forze, arsenali, fronti e logistica');
  });

  it('una sedia senza competenza finanziaria non mostra l’evidenza «spesa»', () => {
    const lavori = { ...build('lavori', [{ kind: 'work', label: 'Fabbrica', source: 'president' }]), evidenceIds: ['spesa', 'mappa'] };
    const htmlLavori = renderToStaticMarkup(<DecisionBoard workspace={lavori} seat="lavori" />);
    expect(htmlLavori).not.toContain('Dove va la spesa');
    expect(htmlLavori).toContain('Le zone del paese');

    const tesoro = { ...build('tesoro', [{ kind: 'allocation', label: 'Infrastrutture', sharePct: 50, source: 'president' }]), evidenceIds: ['spesa'] };
    const htmlTesoro = renderToStaticMarkup(<DecisionBoard workspace={tesoro} seat="tesoro" />);
    expect(htmlTesoro).toContain('Dove va la spesa');
  });

  it('senza il prop `seat`, usa la sedia del workspace (retro-compatibile)', () => {
    const html = renderToStaticMarkup(
      <DecisionBoard workspace={build('tesoro', [{ kind: 'allocation', label: 'Scuole', sharePct: 60, source: 'minister' }])} />,
    );
    expect(html).toContain('La tavola del Tesoro');
  });
});

describe('DecisionBoard — promozione al Consiglio (B26)', () => {
  it('offre «Porta la proposta in Consiglio» e «Convoca il Tesoro» per una sedia non-Tesoro', () => {
    const html = renderToStaticMarkup(
      <DecisionBoard
        workspace={build('lavori', [{ kind: 'work', label: 'Fabbrica', source: 'president' }])}
        seat="lavori"
        onPromoteToCouncil={() => {}}
        onConveneSeat={() => {}}
      />,
    );
    expect(html).toContain('Porta la proposta in Consiglio');
    expect(html).toContain('Convoca il Tesoro');
  });

  it('il Tesoro non si convoca da solo', () => {
    const html = renderToStaticMarkup(
      <DecisionBoard
        workspace={build('tesoro', [{ kind: 'allocation', label: 'Scuole', sharePct: 60, source: 'president' }])}
        seat="tesoro"
        onPromoteToCouncil={() => {}}
        onConveneSeat={() => {}}
      />,
    );
    expect(html).toContain('Porta la proposta in Consiglio');
    expect(html).not.toContain('Convoca il Tesoro');
  });
});
