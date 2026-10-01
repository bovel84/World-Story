/**
 * WS-MINISTER-UX-01 — render della nuova gerarchia della seduta
 * ============================================================
 * Difende ciò che UX-01 cambia rispetto a WS-GOVOFFICE-07:
 *  - il fascicolo della sedia è un riepilogo espandibile, **chiuso** di default:
 *    la chat non ha più un dossier davanti;
 *  - la tavola dà una gerarchia: una visualizzazione principale (il piano a
 *    cascata), fino a due supporti (mappa, grafico) e gli approfondimenti
 *    (cifre, idee) dentro un `<details>`.
 * Render statico, come gli altri test dei componenti: si difende il markup.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeatBrief } from './SeatBrief';
import { SeatTable } from './SeatTable';
import { parseStrategicPlan } from './strategicPlan';
import type { CabinetAddressView } from '../../services/api';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryAct } from './treasuryAct';

/** Un piano di prova, senza date fisse. */
const SAMPLE_PLAN = parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Punto | -\nT0 | Ramo A | d | radice\nT0 | Ramo B | d | radice\nT1 | Fusione | d | ramo-a, ramo-b');

const address: CabinetAddressView = {
  seat: 'tesoro',
  label: 'Ministro del Tesoro',
  reads: 'Cassa, debito e bilancio',
  opening: 'La cassa regge.',
  items: [
    {
      voiceId: 'v-1',
      need: 'Coprire il disavanzo.',
      because: 'Le uscite superano le entrate.',
      urgency: 'urgente',
      figures: [
        { label: 'Fabbisogno', value: '8', unit: 'mld', basis: { kind: 'measured', source: 'Tesoro' } },
      ],
      paths: [],
    },
  ],
};

const act = {
  seatLabel: 'Ministro del Tesoro',
  voice: '',
  figures: [],
  worksRequest: null,
  nextMaturity: null,
  roads: [],
} as unknown as TreasuryAct;

const blocks: SeatCanvasBlock[] = [
  { kind: 'metrics', id: 'm', title: 'Cifre', metrics: [{ id: 'a', label: 'Debito', display: '90%', tone: 'warning' }] },
  { kind: 'chart', id: 'c', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'strategy', id: 's', title: 'Piano', plan: SAMPLE_PLAN },
  { kind: 'map', id: 'g', title: 'Zone', note: '', zones: [{ id: 'r1', name: 'Alfa', detail: '100', tone: 'positive' }], target: null },
  { kind: 'ideas', id: 'i', title: 'Idee', ideas: [{ title: 'Rimborsare', detail: '…' }] },
];

describe('SeatBrief', () => {
  it('è un riepilogo espandibile, chiuso di default, con le cifre e la provenienza', () => {
    const html = renderToStaticMarkup(<SeatBrief address={address} />);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Fascicolo della sedia');
    expect(html).toContain('Coprire il disavanzo.');
    expect(html).toContain('misurato · Tesoro');
  });

  it('senza questioni non compare: la chat non ha un fascicolo vuoto', () => {
    const html = renderToStaticMarkup(<SeatBrief address={{ ...address, items: [] }} />);
    expect(html).toBe('');
  });
});

describe('SeatTable', () => {
  it('dà gerarchia: principale (piano), supporti (mappa, grafico), approfondimenti (cifre, idee)', () => {
    const html = renderToStaticMarkup(<SeatTable seat="tesoro" blocks={blocks} act={act} />);
    expect(html).toContain('La tavola');
    const mainStart = html.indexOf('seat-table-main');
    const supportStart = html.indexOf('seat-table-support');
    const moreStart = html.indexOf('seat-table-more');
    expect(mainStart).toBeGreaterThanOrEqual(0);
    expect(supportStart).toBeGreaterThan(mainStart);
    expect(moreStart).toBeGreaterThan(supportStart);
    // La visualizzazione principale è il piano a cascata.
    expect(html.slice(mainStart, supportStart)).toContain('data-kind="strategy"');
    // I supporti portano mappa e grafico.
    expect(html.slice(supportStart, moreStart)).toContain('data-kind="map"');
    expect(html.slice(supportStart, moreStart)).toContain('data-kind="chart"');
    // Gli approfondimenti (chiusi) portano cifre e idee.
    expect(html.slice(moreStart)).toContain('Approfondimenti');
    expect(html.slice(moreStart)).toContain('data-kind="metrics"');
    expect(html.slice(moreStart)).toContain('data-kind="ideas"');
  });

  it('senza blocchi la tavola dice che è vuota, non finge contenuto', () => {
    const html = renderToStaticMarkup(<SeatTable seat="lavori" blocks={[]} act={act} />);
    expect(html).toContain('Nessuna evidenza pubblicata');
  });
});
