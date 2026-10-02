/**
 * WS-GOVUX-P3 — La tela sulla tavola (render)
 * ===========================================
 * La tela cambia la **gerarchia** della tavola, non il dato:
 *  - fino a due evidenze principali visibili (`.seat-table-main` +
 *    `.seat-table-main-second`);
 *  - il confronto **si aggiunge** senza togliere le principali (era il difetto
 *    del P0) e mostra le strade del motore;
 *  - il banner lega la tavola al messaggio della principale.
 * Render statico, come gli altri test dei componenti.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeatTable } from './SeatTable';
import { applyCanvasBatch, emptyCanvas, resolveCanvas, type DirectiveMeta } from './presentation';
import { parseStrategicPlan } from './strategicPlan';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';

const samplePlan = () => parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Il punto | -');

const blocks: SeatCanvasBlock[] = [
  { kind: 'chart', id: 'bilancio', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'strategy', id: 'piano', title: 'Piano', plan: samplePlan() },
  { kind: 'ideas', id: 'idee', title: 'Idee', ideas: [{ title: 'x', detail: 'y' }] },
];

const roads: TreasuryRoad[] = [
  { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', declaredCost: '12,00 mld', expectedGain: '0,54 mld', recommended: false, order: { kind: 'text', text: 'x' } },
  { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'coperta', expectedGain: 'effetto', recommended: true, order: { kind: 'text', text: 'y' } },
];

const act = { seatLabel: 'Ministro del Tesoro', voice: '', figures: [], worksRequest: null, nextMaturity: null, roads } as TreasuryAct;

const meta: DirectiveMeta = { messageId: 'tesoro#2', quote: 'Ecco la tavola.' };

describe('SeatTable — la tela conversazionale (P3)', () => {
  it('mostra due principali: la richiesta e la precedente, separate', () => {
    const canvas = applyCanvasBatch(emptyCanvas(), [
      { op: 'show', evidence: 'spesa' },
      { op: 'focus', evidence: 'piano' },
    ], meta);
    const resolved = resolveCanvas(canvas, blocks, roads);
    const html = renderToStaticMarkup(<SeatTable seat="tesoro" blocks={blocks} act={act} canvas={resolved} onClearPresentation={() => {}} />);
    // La principale è il piano (ultima richiesta), la seconda è il bilancio.
    const main = html.indexOf('seat-table-main');
    const support = html.indexOf('seat-table-support');
    const mainHtml = html.slice(main, support);
    expect(mainHtml).toContain('data-kind="strategy"');
    expect(mainHtml).toContain('seat-table-main-second');
    expect(mainHtml).toContain('data-kind="chart"');
    // Il banner è quello della principale.
    expect(html).toContain('seat-presentation-banner');
    expect(html).toContain('Ecco la tavola.');
  });

  it('il confronto si aggiunge alle principali, non le sostituisce', () => {
    const canvas = applyCanvasBatch(emptyCanvas(), [
      { op: 'show', evidence: 'spesa' },
      { op: 'compare' },
    ], meta);
    const resolved = resolveCanvas(canvas, blocks, roads);
    expect(resolved.mains).toHaveLength(1);
    expect(resolved.comparison).not.toBeNull();
    const html = renderToStaticMarkup(<SeatTable seat="tesoro" blocks={blocks} act={act} canvas={resolved} proposals={roads} onClearPresentation={() => {}} />);
    expect(html).toContain('seat-table-main');
    expect(html).toContain('data-kind="chart"');
    expect(html).toContain('proposal-comparison');
    expect(html).toContain('Ammortamento del debito');
    expect(html).toContain('Investimento');
  });

  it('un’evidenza senza blocco non svuota la tavola: resta la principale valida', () => {
    // `idee` non esiste in questo catalogo ridotto.
    const reduced = blocks.filter(block => block.id !== 'idee');
    const canvas = applyCanvasBatch(emptyCanvas(), [
      { op: 'show', evidence: 'spesa' },
      { op: 'show', evidence: 'idee' },
    ], meta);
    const resolved = resolveCanvas(canvas, reduced, roads);
    expect(resolved.mains).toHaveLength(1);
    const html = renderToStaticMarkup(<SeatTable seat="tesoro" blocks={reduced} act={act} canvas={resolved} onClearPresentation={() => {}} />);
    expect(html).toContain('data-kind="chart"');
  });
});
