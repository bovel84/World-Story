/**
 * WS-GOVOFFICE-07 — render dei componenti della tela e dell'atto
 * ==============================================================
 * Il progetto non ha un DOM nei test: i componenti si verificano con
 * `renderToStaticMarkup` (stessa disciplina di `governmentOfficeMobile.test.tsx`).
 * Qui si difende il **markup**, non la geometria: l'atto mostra cifre, richiesta
 * in attesa e strade; la tela rende i cinque tipi di blocco; il diagramma a
 * cascata rende i nodi datati e l'esito.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeatCanvas } from './SeatCanvas';
import { TreasuryActPanel } from './TreasuryActPanel';
import { StrategicPlanDiagram } from './StrategicPlanDiagram';
import { stabilizationPlan } from './strategicPlan';
import type { TreasuryAct } from './treasuryAct';
import type { SeatCanvasBlock } from './seatCanvasModel';

const act: TreasuryAct = {
  seatLabel: 'Ministro del Tesoro',
  voice: 'Signor Presidente, gli interessi assorbono il 15,1% delle entrate.',
  figures: [{ label: 'Debito / PIL', display: '90%', basis: 'misurato · conti nazionali', tone: 'warning' }],
  worksRequest: {
    workId: 'w_school', workName: 'Scuola elementare', need: 'Costruire: Scuola elementare', missing: [],
    figures: [{ label: 'Copertura', display: '1 opera', basis: 'misurato · distinta', tone: 'neutral' }],
    item: { voiceId: 'v', need: 'Costruire: Scuola elementare', because: '', urgency: 'ordinaria', figures: [], paths: [] },
    path: { id: 'build_now', title: 'Avviare il cantiere', detail: '', prerequisites: [], expected: '', recommended: true },
  },
  nextMaturity: null,
  roads: [
    { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare i 20 mld.', declaredCost: '20 mld', expectedGain: '0,60 mld', recommended: false, order: { kind: 'text', text: 'Rimborso titoli' } },
    { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'distinta coperta', expectedGain: 'l’opera consegna il suo effetto', recommended: true, order: { kind: 'work', item: { voiceId: 'v', need: '', because: '', urgency: 'ordinaria', figures: [], paths: [] }, path: { id: 'build_now', title: 'Avviare il cantiere', detail: '', prerequisites: [], expected: '', recommended: true } } },
  ],
};

describe('TreasuryActPanel', () => {
  it('mostra la voce, le cifre e la richiesta in attesa', () => {
    const html = renderToStaticMarkup(<TreasuryActPanel act={act} />);
    expect(html).toContain('15,1%');
    expect(html).toContain('misurato · conti nazionali');
    expect(html).toContain('Richiesta in attesa');
    expect(html).toContain('Scuola elementare');
  });

  it('le due strade hanno costo immediato, guadagno atteso e pulsante di preparazione', () => {
    const html = renderToStaticMarkup(<TreasuryActPanel act={act} />);
    expect(html).toContain('Ammortamento del debito');
    expect(html).toContain('Investimento');
    expect(html).toContain('Costo immediato:');
    expect(html).toContain('Guadagno atteso:');
    expect(html.split('Prepara l’atto').length - 1).toBe(2);
  });
});

describe('SeatCanvas', () => {
  const blocks: SeatCanvasBlock[] = [
    { kind: 'metrics', id: 'm', title: 'Quadro', metrics: [{ id: 'a', label: 'Debito', display: '90%', tone: 'warning' }] },
    { kind: 'chart', id: 'c', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
    { kind: 'strategy', id: 's', title: 'Piano', plan: stabilizationPlan() },
    { kind: 'map', id: 'g', title: 'Zone', note: '', zones: [{ id: 'r1', name: 'Alfa', detail: '100 · 50 ab.', tone: 'positive' }], target: { label: 'Scuola', detail: 'distinta coperta' } },
    { kind: 'ideas', id: 'i', title: 'Idee', ideas: [{ title: 'Rimborsare', detail: '…' }] },
  ];

  it('rende tutti i cinque tipi di blocco', () => {
    const html = renderToStaticMarkup(<SeatCanvas blocks={blocks} />);
    for (const kind of ['metrics', 'chart', 'strategy', 'map', 'ideas']) {
      expect(html).toContain(`data-kind="${kind}"`);
    }
    expect(html).toContain('Debito');
    expect(html).toContain('Dove va il denaro');
    expect(html).toContain('Esito');
  });

  it('senza blocchi lo dice, non finge contenuto', () => {
    const html = renderToStaticMarkup(<SeatCanvas blocks={[]} />);
    expect(html).toContain('Nessun dato pubblicato');
  });
});

describe('StrategicPlanDiagram', () => {
  it('rende i nodi datati, i rami, il ricongiungimento e l’esito', () => {
    const html = renderToStaticMarkup(<StrategicPlanDiagram plan={stabilizationPlan()} defaultExpanded />);
    expect(html).toContain('GEN 2026');
    expect(html).toContain('si apre in rami');
    expect(html).toContain('i rami si ricongiungono');
    expect(html).toContain('Esito');
    expect(html).toContain('plan-diagram-expanded');
  });
});
