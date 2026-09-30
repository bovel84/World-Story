/**
 * WS-MINISTER-UX-03 — La tavola guidata dalla conversazione (render)
 * =================================================================
 * La presentazione cambia la **gerarchia** della tavola, non il dato:
 *  - un'evidenza richiesta sale in cima (`.seat-table-main`);
 *  - il confronto sostituisce la principale con le due strade del motore;
 *  - senza presentazione resta la tavola predefinita di UX-01.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeatTable } from './SeatTable';
import { resolvePresentation } from './presentation';
import { stabilizationPlan } from './strategicPlan';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';

const blocks: SeatCanvasBlock[] = [
  { kind: 'metrics', id: 'cifre-sedia', title: 'Le cifre della sedia', metrics: [{ id: 'a', label: 'Cassa', display: '12,40 mld', tone: 'neutral' }] },
  { kind: 'chart', id: 'bilancio', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'strategy', id: 'piano', title: 'Piano', plan: stabilizationPlan() },
  { kind: 'map', id: 'zone', title: 'Zone', note: '', zones: [{ id: 'r1', name: 'Alfa', detail: '100', tone: 'positive' }], target: null },
  { kind: 'ideas', id: 'idee', title: 'Idee', ideas: [{ title: 'x', detail: 'y' }] },
];

const roads: TreasuryRoad[] = [
  { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare i titoli.', declaredCost: '12,00 mld', expectedGain: '0,54 mld di interessi in meno', recommended: false, order: { kind: 'text', text: 'x' } },
  { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'distinta coperta', expectedGain: 'effetto dichiarato al completamento', recommended: true, order: { kind: 'text', text: 'y' } },
];

const act = { seatLabel: 'Ministro del Tesoro', voice: '', figures: [], worksRequest: null, nextMaturity: null, roads } as TreasuryAct;

const render = (presentation: ReturnType<typeof resolvePresentation>) =>
  renderToStaticMarkup(
    <SeatTable seat="tesoro" blocks={blocks} act={act} presentation={presentation} onClearPresentation={() => {}} />,
  );

describe('SeatTable — presentazione dalla conversazione', () => {
  it('senza presentazione la tavola resta quella predefinita (piano in cima)', () => {
    const html = render(null);
    const main = html.indexOf('seat-table-main');
    const support = html.indexOf('seat-table-support');
    expect(html.slice(main, support)).toContain('data-kind="strategy"');
    expect(html).not.toContain('seat-presentation-banner');
    expect(html).not.toContain('proposal-comparison');
  });

  it('un’evidenza richiesta sale in cima alla tavola', () => {
    const presentation = resolvePresentation(
      { directive: { op: 'focus', evidence: 'spesa' }, seat: 'tesoro', messageId: 'tesoro#3', quote: 'Guardi il grafico.' },
      blocks,
      roads,
    );
    const html = render(presentation);
    const main = html.indexOf('seat-table-main');
    const support = html.indexOf('seat-table-support');
    expect(html.slice(main, support)).toContain('data-kind="chart"');
    expect(html.slice(main, support)).not.toContain('data-kind="strategy"');
    // Il banner lega l'evidenza al messaggio e offre il ritorno.
    expect(html).toContain('seat-presentation-banner');
    expect(html).toContain('Guardi il grafico.');
    expect(html).toContain('Tavola predefinita');
  });

  it('il confronto mostra le due strade dichiarate dal motore', () => {
    const presentation = resolvePresentation(
      { directive: { op: 'compare' }, seat: 'tesoro', messageId: 'tesoro#4', quote: 'Confronti le due strade.' },
      blocks,
      roads,
    );
    const html = render(presentation);
    expect(html).toContain('proposal-comparison');
    expect(html).toContain('Ammortamento del debito');
    expect(html).toContain('Investimento');
    expect(html).toContain('raccomandata');
    expect(html).toContain('Costo immediato');
    expect(html).toContain('Guadagno atteso');
  });
});
