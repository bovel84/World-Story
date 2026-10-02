/**
 * WS-GOV-SEAT-BOARDS — La Tavola è generica e seat-aware (B21/B23/B28)
 * ====================================================================
 * Difende il criterio di successo del task: **nessuna hardcodifica sul Tesoro**.
 *  - ogni sedia del gabinetto ha una configurazione di Tavola;
 *  - la composizione (titolo, sezioni, catalogo di evidenze) dipende dalla sedia;
 *  - una sedia **non** mostra automaticamente un blocco di un'altra: la Tavola
 *    dei Lavori non porta il bilancio del Tesoro;
 *  - le misure della proposta si raggruppano con l'etichetta di competenza.
 */
import { describe, expect, it } from 'vitest';
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { availableEvidence } from './presentation';
import { parseStrategicPlan } from './strategicPlan';
import {
  CABINET_SEATS, groupProposalMeasures, seatAllowsEvidence, seatBoardConfig,
} from './seatDecisionBoards';
import type { NegotiatedProposal } from './decisionWorkspace';

const picture = {
  economy: { debtServicePct: 15.1, treasuryMonths: 2.5, metrics: [{ id: 'gdp', label: 'PIL', value: 1000, format: 'mld', tone: 'neutral' }] },
  domains: [
    { id: 'economia', label: 'Economia', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'PIL', value: '1.000 mld' }] },
    { id: 'industria', label: 'Industria', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Stabilimenti', value: '3' }] },
    { id: 'popolo', label: 'Popolo', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Atenei', value: '42' }] },
    { id: 'governo', label: 'Governo', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Relazioni', value: '7' }] },
    { id: 'militare', label: 'Forze armate', status: 'stable', headline: '', summary: '', drivers: [], facts: [{ label: 'Reparti', value: '7' }] },
  ],
} as unknown as NationalOperatingPicture;

const sources = {
  regions: [{ id: 'r1', name: 'Alfa', owner: 'p1', gdp: 100, population: 50 }],
  account: { polityId: 'p1', money: 40 },
  resources: { money: 40 },
  government: { budget: { expense: [{ label: 'Ammortamento del debito', amount: 10 }, { label: 'Difesa', amount: 6 }] } },
  accountHistory: [{ date: '2026-01', turn: 1, account: { money: 30 } }, { date: '2026-02', turn: 2, account: { money: 40 } }],
  today: '2026-02-01',
} as any;

const SAMPLE_PLAN = parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Punto | -');

function blocksFor(seat: CabinetAddressView['seat']) {
  return deriveSeatCanvasBlocks({
    seat,
    picture,
    sources,
    authored: { plan: SAMPLE_PLAN, ideas: [{ title: 'Prova', detail: 'x' }] },
  });
}

describe('SEAT_DECISION_BOARDS — una Tavola per ogni ministro (B21/B23)', () => {
  it('tutte e sette le sedie hanno una configurazione, con titoli diversi', () => {
    expect(CABINET_SEATS).toHaveLength(7);
    const titles = CABINET_SEATS.map(seat => seatBoardConfig(seat).title);
    expect(new Set(titles).size).toBe(7);
    for (const seat of CABINET_SEATS) {
      expect(seatBoardConfig(seat).primarySections.length).toBeGreaterThan(0);
      expect(seatBoardConfig(seat).availableEvidence.length).toBeGreaterThan(0);
    }
  });

  it('solo il Tesoro mostra la ripartizione del bilancio («spesa»)', () => {
    expect(seatAllowsEvidence('tesoro', 'spesa')).toBe(true);
    for (const seat of ['lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra'] as const) {
      expect(seatAllowsEvidence(seat, 'spesa')).toBe(false);
    }
  });

  it('le sezioni primarie differiscono per competenza (lavori vs tesoro vs sanità)', () => {
    const lavori = seatBoardConfig('lavori').primarySections.map(section => section.label);
    const tesoro = seatBoardConfig('tesoro').primarySections.map(section => section.label);
    const sanita = seatBoardConfig('sanita').primarySections.map(section => section.label);
    expect(lavori).toContain('Opera');
    expect(lavori).toContain('Regione');
    expect(tesoro).not.toContain('Opera');
    expect(tesoro).toContain('Copertura e obiettivi');
    expect(sanita).toContain('Bisogno sanitario');
    expect(new Set([lavori.join(), tesoro.join(), sanita.join()]).size).toBe(3);
  });
});

describe('deriveSeatCanvasBlocks — nessun blocco estraneo alla competenza (B28)', () => {
  it('il Tesoro vede il bilancio per voci; i Lavori no', () => {
    const tesoro = availableEvidence(blocksFor('tesoro'));
    expect(tesoro).toContain('spesa');
    const lavori = availableEvidence(blocksFor('lavori'));
    expect(lavori).not.toContain('spesa');
    // I Lavori restano una tavola viva: cifre, andamento, mappa, piano, idee.
    expect(lavori).toContain('cifre');
    expect(lavori).toContain('mappa');
    expect(lavori).toContain('piano');
  });

  it('Sanità e Guerra non mostrano il bilancio del Tesoro', () => {
    for (const seat of ['sanita', 'guerra'] as const) {
      expect(availableEvidence(blocksFor(seat))).not.toContain('spesa');
    }
  });

  it('la sedia dei Lavori non porta «Ammortamento del debito» (nessun blocco bilancio)', () => {
    const lavori = blocksFor('lavori');
    expect(lavori.some(block => block.id === 'bilancio')).toBe(false);
    // Il Tesoro invece lo porta: è la sua materia.
    expect(blocksFor('tesoro').some(block => block.id === 'bilancio')).toBe(true);
  });

  it('l’Esteri non ha la mappa del paese: la sua evidenza è diplomatica', () => {
    expect(availableEvidence(blocksFor('esteri'))).not.toContain('mappa');
    expect(availableEvidence(blocksFor('esteri'))).toContain('cifre');
  });
});

describe('groupProposalMeasures — l’etichetta di sezione è della sedia (B22)', () => {
  const proposal = (kind: NegotiatedProposal['measures'][number]['kind'], label: string): NegotiatedProposal => ({
    id: 'p1', revision: 1, objective: 'Prova', measures: [
      { id: 'm1', label, kind, status: 'accepted', source: 'president' },
    ], constraints: [], assumptions: [], risks: [], expectedEffects: [], unresolvedQuestions: [], sourceMessageIds: [], status: 'negotiating',
  });

  it('la stessa misura «opera» si chiama «Opera» per i Lavori e «Forze e unità» per la Guerra', () => {
    const lavori = groupProposalMeasures(proposal('work', 'Fabbrica siderurgica'), seatBoardConfig('lavori'));
    const guerra = groupProposalMeasures(proposal('work', 'Fabbrica siderurgica'), seatBoardConfig('guerra'));
    expect(lavori[0].section.label).toBe('Opera');
    expect(guerra[0].section.label).toBe('Forze e unità');
  });

  it('una «copertura» si colloca nella sezione di bilancio del Tesoro e in quella sanitaria', () => {
    const tesoro = groupProposalMeasures(proposal('target', 'Copertura finanziaria'), seatBoardConfig('tesoro'));
    const sanita = groupProposalMeasures(proposal('target', 'Copertura finanziaria'), seatBoardConfig('sanita'));
    expect(tesoro[0].section.label).toBe('Copertura e obiettivi');
    expect(sanita[0].section.label).toBe('Bisogno sanitario');
  });

  it('le sezioni senza misure non compaiono', () => {
    const groups = groupProposalMeasures(proposal('work', 'Fabbrica'), seatBoardConfig('lavori'));
    expect(groups).toHaveLength(1);
  });
});
