/**
 * WS-GOVOFFICE-07 — test dell'aggancio per sedia (la tela è di TUTTI i ministri)
 * =============================================================================
 * `SeatCanvas` è generico; `seatCanvasAuthoring` è la mappa `sedia → contenuto
 * curato`. Questi test difendono la **generalizzabilità**:
 *  - il Tesoro (primo inquilino) porta il piano di stabilizzazione, le idee
 *    (le strade) e l'obiettivo della mappa;
 *  - lo Stato maggiore (sedia `guerra`) porta un **secondo esempio**: un piano
 *    militare a cascata — prova che `strategy` non è cablato al Tesoro;
 *  - una sedia senza voce nel registro non inventa contenuto;
 *  - la derivazione dei blocchi resta indipendente dalla sedia.
 */
import { describe, expect, it } from 'vitest';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { cascadeLayout } from './strategicPlan';
import {
  MILITARY_IDEAS,
  militaryPlan,
  SEAT_CANVAS_AUTHORING,
  seatCanvasAuthoring,
  type SeatCanvasContext,
} from './seatCanvasConfig';
import type { CabinetAddressView } from '../../services/api';
import type { TreasuryAct } from './treasuryAct';

const picture = {
  economy: {
    debtServicePct: 15.1,
    treasuryMonths: 2.5,
    metrics: [{ id: 'gdp', label: 'PIL', value: 1000, format: 'mld', tone: 'neutral' }],
  },
  domains: [
    { id: 'militare', label: 'Forze armate', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Reparti', value: '7' }] },
    { id: 'economia', label: 'Economia', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'PIL', value: '1.000 mld' }] },
  ],
} as unknown as NationalOperatingPicture;

const sources = {
  regions: [{ id: 'r1', name: 'Alfa', owner: 'p1', gdp: 100, population: 50 }],
  account: { polityId: 'p1', money: 40 },
  resources: { money: 40 },
  government: { budget: { expense: [{ label: 'Difesa', amount: 6 }] } },
  accountHistory: [{ date: '2026-01', turn: 1, account: { money: 30 } }, { date: '2026-02', turn: 2, account: { money: 40 } }],
  today: '2026-02-01',
} as any;

const tesoroAct = {
  seatLabel: 'Ministro del Tesoro',
  voice: '',
  figures: [],
  worksRequest: { workId: 'w_school', workName: 'Scuola elementare', need: '', missing: [], figures: [], item: {}, path: {} },
  nextMaturity: null,
  roads: [
    { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', recommended: false, declaredCost: '', expectedGain: '', order: { kind: 'text', text: '' } },
    { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', recommended: true, declaredCost: '', expectedGain: '', order: { kind: 'work', item: {}, path: {} } },
  ],
} as unknown as TreasuryAct;

const context = (seat: CabinetAddressView['seat'], act: TreasuryAct | null = null): SeatCanvasContext => ({
  seat, picture, sources, act,
});

describe('seatCanvasAuthoring', () => {
  it('il Tesoro (primo inquilino) porta piano, idee dalle strade e obiettivo', () => {
    const authored = seatCanvasAuthoring('tesoro', context('tesoro', tesoroAct));
    expect(authored?.plan?.title).toContain('Stabilizzazione');
    expect(authored?.ideas?.map(idea => idea.title)).toEqual(['Ammortamento del debito', 'Investimento']);
    expect(authored?.target?.label).toBe('Scuola elementare');
  });

  it('lo Stato maggiore (sedia guerra) porta un piano a cascata: strategy non è cablato al Tesoro', () => {
    const authored = seatCanvasAuthoring('guerra', context('guerra'));
    expect(authored?.plan?.title).toContain('Difesa');
    const layout = cascadeLayout(authored!.plan!);
    expect(layout.lanes.length).toBeGreaterThanOrEqual(3);
    expect(layout.branches).toContain('riarmo-ordinato');
    expect(layout.merges).toContain('deterrenza-credibile');
    expect(authored?.ideas).toEqual(MILITARY_IDEAS);
  });

  it('una sedia senza voce nel registro non inventa contenuto', () => {
    expect(SEAT_CANVAS_AUTHORING.lavori).toBeUndefined();
    expect(seatCanvasAuthoring('lavori', context('lavori'))).toBeUndefined();
  });

  it('il piano militare d’esempio ha nodi datati e un esito', () => {
    const plan = militaryPlan();
    expect(plan.outcome.length).toBeGreaterThan(0);
    expect(plan.nodes.every(node => node.date.length > 0)).toBe(true);
  });
});

describe('deriveSeatCanvasBlocks con la configurazione per sedia', () => {
  it('la sedia guerra compone i blocchi derivati più il piano del registro', () => {
    const blocks = deriveSeatCanvasBlocks({
      seat: 'guerra',
      picture,
      sources,
      authored: seatCanvasAuthoring('guerra', context('guerra')),
    });
    const kinds = blocks.map(block => block.kind);
    expect(kinds).toContain('strategy');
    expect(kinds).toContain('ideas');
    expect(kinds).toContain('metrics');
    expect(kinds).toContain('map');
    expect(kinds).toContain('chart');
    // Le cifre dell'economia non entrano per una sedia non-Tesoro: resta il dominio.
    const quadro = blocks.find(block => block.id === 'quadro');
    if (quadro?.kind === 'metrics') {
      expect(quadro.metrics.map(metric => metric.label)).toEqual(['Reparti']);
    }
  });
});
