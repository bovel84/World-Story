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
import { parseStrategicPlan } from './strategicPlan';
import { seatRoads } from './seatProposals';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';
import type { CabinetAddressView } from '../../services/api';

/** Un piano di prova, senza date fisse. */
const samplePlan = () => parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Punto | -\nT0 | Ramo A | d | radice\nT0 | Ramo B | d | radice\nT1 | Fusione | d | ramo-a, ramo-b');

const blocks: SeatCanvasBlock[] = [
  { kind: 'metrics', id: 'cifre-sedia', title: 'Le cifre della sedia', metrics: [{ id: 'a', label: 'Cassa', display: '12,40 mld', tone: 'neutral' }] },
  { kind: 'chart', id: 'bilancio', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'strategy', id: 'piano', title: 'Piano', plan: samplePlan() },
  { kind: 'map', id: 'zone', title: 'Zone', note: '', zones: [{ id: 'r1', name: 'Alfa', detail: '100', tone: 'positive', svgPath: 'M0,0 L100,0 L100,100 L0,100 Z' }], target: null },
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

  it('il confronto mostra le stesse dimensioni per ogni strada, con la provenienza', () => {
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
    // Le dimensioni dichiarate, non solo costo e guadagno.
    expect(html).toContain('Costo immediato');
    expect(html).toContain('Spesa ricorrente');
    expect(html).toContain('Copertura');
    expect(html).toContain('Incertezza');
    expect(html).toContain('Benefici attesi');
    // Ciò che il motore non dichiara è detto, non inventato.
    expect(html).toContain('non dichiarato dal motore');
    // E la catena distingue simulato, dichiarato e non simulato.
    expect(html).toContain('proposal-flow-step');
    expect(html).toContain('non simulato');
  });

  it('WS-MINISTER-UX-07 (A2) — la spesa discute una voce, non il saldo', () => {
    const expenseBlocks: SeatCanvasBlock[] = [
      {
        kind: 'chart', id: 'bilancio', title: 'Dove va il denaro',
        figure: {
          kind: 'bilancio', title: 'Dove va il denaro', note: '', unit: 'uscita mensile (mld)',
          bars: [
            { label: 'Difesa', value: 34, display: '34', tone: 'warning' },
            { label: 'Amministrazione pubblica', value: 60, display: '60', tone: 'neutral' },
            { label: 'Sanità e assistenza', value: 45, display: '45', tone: 'positive' },
          ],
        },
      },
    ];
    const presentation = resolvePresentation(
      {
        directive: { op: 'focus', evidence: 'spesa' },
        seat: 'tesoro', messageId: 'tesoro#6', quote: 'Ecco la tavola.',
        discussion: 'Mi mostri la spesa per la sanità?',
      },
      expenseBlocks,
      roads,
    );
    expect(presentation?.focusLabel).toBe('Sanità e assistenza');
    expect(presentation?.label).toContain('Dove va la spesa');
    expect(presentation?.label).toContain('Sanità e assistenza');
    const html = render(presentation);
    // La voce discussa è marcata e sale in cima: l'evidenza è quella voce.
    const main = html.indexOf('seat-table-main');
    const support = html.indexOf('seat-table-support');
    const mainHtml = html.slice(main, support);
    const sanita = mainHtml.indexOf('Sanità e assistenza');
    const difesa = mainHtml.indexOf('Difesa');
    expect(sanita).toBeGreaterThanOrEqual(0);
    expect(sanita).toBeLessThan(difesa);
    expect(mainHtml).toContain('focused');
    // Il saldo non compare come evidenza principale.
    expect(mainHtml).not.toContain('Saldo di bilancio');
  });

  it('WS-MINISTER-UX-07 (A2) — senza voce pertinente non si evidenzia nulla', () => {
    const presentation = resolvePresentation(
      {
        directive: { op: 'focus', evidence: 'spesa' },
        seat: 'tesoro', messageId: 'tesoro#7', quote: 'Ecco la tavola.',
        discussion: 'Mostrami il saldo del bilancio',
      },
      blocks,
      roads,
    );
    expect(presentation?.focusLabel).toBeUndefined();
    expect(render(presentation)).not.toContain('focused');
  });

  it('la mappa si inquadra sulla geometria e mette in evidenza le zone richieste', () => {
    const presentation = resolvePresentation(
      { directive: { op: 'focus', evidence: 'mappa', regionIds: ['r1'] }, seat: 'tesoro', messageId: 'tesoro#5', quote: 'Ecco le province.' },
      blocks,
      roads,
    );
    const html = render(presentation);
    expect(html).toContain('data-kind="map"');
    // Il viewBox non è più fisso: è misurato dai path (padding 4).
    expect(html).toContain('viewBox="-4 -4 108 108"');
    expect(html).toContain('zone-map-shape');
    expect(html).toContain('focused');
    expect(html).toContain('zone-map-legend');
    expect(html).toContain('Alfa');
  });

  it('WS-MINISTER-UX-07 (C) — l’evidenza fissata resta e si può sbloccare', () => {
    const presentation = resolvePresentation(
      {
        directive: { op: 'focus', evidence: 'spesa' },
        seat: 'tesoro', messageId: 'tesoro#8', quote: 'Ecco la tavola.', pinned: true,
      },
      blocks,
      roads,
    );
    const html = renderToStaticMarkup(
      <SeatTable
        seat="tesoro"
        blocks={blocks}
        act={act}
        presentation={presentation}
        onClearPresentation={() => {}}
        onTogglePin={() => {}}
      />,
    );
    expect(html).toContain('data-pinned="true"');
    expect(html).toContain('Evidenza fissata');
    expect(html).toContain('aria-pressed="true"');
    // Il controllo del fissaggio è un vero pulsante.
    expect(html).toContain('seat-presentation-pin');
  });

  it('WS-MINISTER-UX-08 (1) — l’atto non precede l’evidenza richiesta; senza direttiva resta prima (UX-01)', () => {
    const defaultHtml = renderToStaticMarkup(<SeatTable seat="tesoro" blocks={blocks} act={act} proposals={roads} />);
    const defaultAct = defaultHtml.indexOf('treasury-act');
    const defaultMain = defaultHtml.indexOf('seat-table-main');
    expect(defaultAct).toBeGreaterThanOrEqual(0);
    // Comportamento di sicurezza UX-01: senza direttiva l'atto è in cima.
    expect(defaultAct).toBeLessThan(defaultMain);

    const presentation = resolvePresentation(
      { directive: { op: 'focus', evidence: 'mappa' }, seat: 'tesoro', messageId: 'tesoro#11', quote: 'Ecco le province.' },
      blocks,
      roads,
    );
    const html = renderToStaticMarkup(
      <SeatTable seat="tesoro" blocks={blocks} act={act} presentation={presentation} proposals={roads} onClearPresentation={() => {}} />,
    );
    const main = html.indexOf('seat-table-main');
    const support = html.indexOf('seat-table-support');
    const actPanel = html.indexOf('treasury-act');
    expect(html.slice(main, support)).toContain('data-kind="map"');
    // L'atto del Tesoro non sta davanti alla mappa richiesta: viene dopo.
    expect(actPanel).toBeGreaterThan(main);
    expect(html.slice(main, support)).not.toContain('treasury-act');
  });

  it('WS-MINISTER-UX-08 (2) — un confronto alla Sanità non mostra strade del Tesoro', () => {
    const sanita: CabinetAddressView = {
      seat: 'sanita', label: 'Ministro della Sanità', reads: '', opening: '',
      items: [{
        voiceId: 'ospedali', need: 'Aprire un reparto.', because: '', urgency: 'urgente', figures: [],
        paths: [
          { id: 'subito', title: 'Riparare il reparto', detail: 'Intervenire ora.', prerequisites: [], expected: 'Riapre.', recommended: true },
          { id: 'rinvio', title: 'Rinviare al prossimo anno', detail: 'Aspettare.', prerequisites: [], expected: 'Nessun costo ora.', recommended: false },
        ],
      }],
    };
    const sanitaRoads = seatRoads(sanita, act);
    const presentation = resolvePresentation(
      { directive: { op: 'compare' }, seat: 'sanita', messageId: 'sanita#1', quote: 'Confronta le due strade.' },
      [],
      sanitaRoads,
    );
    const html = renderToStaticMarkup(
      <SeatTable seat="sanita" blocks={[]} act={act} presentation={presentation} proposals={sanitaRoads} />,
    );
    expect(html).toContain('Riparare il reparto');
    expect(html).toContain('Rinviare al prossimo anno');
    expect(html).not.toContain('Ammortamento del debito');
    expect(html).not.toContain('Investimento');
  });

  it('WS-MINISTER-UX-08 (5) — le fonti stanno nei dettagli e l’ordine nasce dalla proposta concreta', () => {
    const hinted: SeatCanvasBlock[] = [{
      kind: 'metrics', id: 'm', title: 'Cifre',
      metrics: [{ id: 'a', label: 'Cassa', display: '12,40 mld', hint: 'misurato · conti nazionali', tone: 'neutral' }],
    }];
    const html = renderToStaticMarkup(
      <SeatTable seat="sanita" blocks={hinted} act={act} proposals={roads} onPrepareRoad={() => {}} />,
    );
    expect(html).toContain('seat-sources');
    expect(html).toContain('Provenienza delle cifre');
    expect(html).toContain('misurato · conti nazionali');
    expect(html).toContain('seat-proposal');
    expect(html).toContain('treasury-act-prepare');
  });
});
