/**
 * WS-GOVOFFICE-07 — test della tela (blocchi tipizzati, Parte C)
 * =============================================================
 * Le regole provate su funzioni **pure**:
 *  - i blocchi derivano dal read model (nessun numero nuovo);
 *  - le cifre della sedia arrivano dal suo `items` (con provenienza);
 *  - il blocco `chart` esiste solo se il motore pubblica i dati (mai una figura
 *    vuota spacciata per dato);
 *  - le zone sono le regioni del **giocatore**, ordinate per prodotto;
 *  - `strategy`/`ideas` sono contenuto autore, non generato dal read model.
 */
import { describe, expect, it } from 'vitest';
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import { deriveSeatCanvasBlocks, metricDisplay, seatFigureMetrics, zoneBoard } from './seatCanvasModel';
import { parseStrategicPlan } from './strategicPlan';

/** Un piano di prova, senza date fisse. */
const SAMPLE_PLAN = parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Punto | -');

const picture = {
  economy: {
    debtServicePct: 15.1,
    treasuryMonths: 2.5,
    metrics: [
      { id: 'gdp', label: 'PIL', value: 1000, format: 'mld', tone: 'neutral' },
      { id: 'debtRatio', label: 'Debito / PIL', value: 90, format: 'pct', tone: 'warning' },
    ],
  },
  domains: [
    { id: 'economia', label: 'Economia', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'PIL', value: '1.000 mld' }] },
    { id: 'risorse', label: 'Risorse', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Cibo', value: '10' }] },
    { id: 'industria', label: 'Industria', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Stabilimenti', value: '3' }] },
    { id: 'militare', label: 'Forze armate', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Reparti', value: '7' }] },
  ],
} as unknown as NationalOperatingPicture;

function sources(overrides: Record<string, unknown> = {}) {
  return {
    regions: [
      { id: 'r1', name: 'Alfa', owner: 'p1', gdp: 100, population: 50, svgPath: 'M0 0 L1 0 L1 1 Z' },
      { id: 'r2', name: 'Beta', owner: 'p1', gdp: 40, population: 30 },
      { id: 'r9', name: 'Estera', owner: 'p2', gdp: 999, population: 999 },
    ],
    account: { polityId: 'p1', money: 40 },
    resources: { money: 40 },
    government: { budget: { expense: [{ label: 'Istruzione', amount: 10 }, { label: 'Difesa', amount: 6 }] } },
    commitments: null,
    accountHistory: [{ date: '2026-01', turn: 1, account: { money: 30 } }, { date: '2026-02', turn: 2, account: { money: 40 } }],
    ongoingProcesses: [],
    maintenanceObligations: null,
    crisis: null,
    pressures: null,
    today: '2026-02-01',
    ...overrides,
  } as any;
}

const address: CabinetAddressView = {
  seat: 'tesoro',
  label: 'Ministro del Tesoro',
  reads: 'conti',
  opening: '',
  items: [{
    voiceId: 'v1', need: 'Coprire il disavanzo', because: '', urgency: 'urgente',
    figures: [{ label: 'Fabbisogno', value: '8', unit: 'mld', basis: { kind: 'measured', source: 'Tesoro' } }],
    paths: [],
  }],
};

describe('metricDisplay', () => {
  it('formatta le metriche del quadro economia come il pattern Operating Picture', () => {
    expect(metricDisplay({ id: 'x', label: 'x', value: 90, format: 'pct', tone: 'warning' })).toBe('90,0%');
    expect(metricDisplay({ id: 'y', label: 'y', value: null, format: 'mld', tone: 'neutral' })).toBe('—');
  });
});

describe('seatFigureMetrics', () => {
  it('porta le cifre della sedia con la provenienza nel titolo di aiuto', () => {
    const metrics = seatFigureMetrics(address);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].label).toBe('Fabbisogno');
    expect(metrics[0].display).toBe('8,00 mld');
    expect(metrics[0].hint).toContain('misurato');
  });
});

describe('zoneBoard', () => {
  it('tiene solo le regioni del giocatore e le ordina per prodotto', () => {
    const zones = zoneBoard(sources());
    expect(zones.map(zone => zone.id)).toEqual(['r1', 'r2']);
    expect(zones[0].svgPath).toBeDefined();
  });
});

describe('deriveSeatCanvasBlocks', () => {
  it('il Tesoro riceve metriche, grafici, piano, mappa e idee', () => {
    const blocks = deriveSeatCanvasBlocks({
      seat: 'tesoro', picture, sources: sources(), address,
      authored: { plan: SAMPLE_PLAN, ideas: [{ title: 'Rimborsare', detail: '…' }], target: { label: 'Scuola', detail: 'distinta coperta' } },
    });
    const kinds = blocks.map(block => block.kind);
    expect(kinds).toContain('metrics');
    expect(kinds).toContain('chart');
    expect(kinds).toContain('strategy');
    expect(kinds).toContain('map');
    expect(kinds).toContain('ideas');
    // Le cifre dell'economia entrano nel blocco «Quadro operativo».
    const quadro = blocks.find(block => block.id === 'quadro');
    if (quadro?.kind === 'metrics') {
      expect(quadro.metrics.map(metric => metric.label)).toContain('Debito / PIL');
    }
  });

  it('un grafico vuoto non entra: senza bilancio né storia niente blocchi chart', () => {
    const blocks = deriveSeatCanvasBlocks({
      seat: 'lavori', picture, sources: sources({ government: null, accountHistory: [] }),
    });
    expect(blocks.some(block => block.kind === 'chart')).toBe(false);
    // Per i Lavori restano le cifre del dominio industria.
    expect(blocks.some(block => block.kind === 'metrics')).toBe(true);
  });
});
