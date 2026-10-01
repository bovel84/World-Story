/**
 * WS-MINISTER-UX-08 (2) — Le proposte della sedia aperta
 * ======================================================
 * Difende il difetto corretto: il confronto non usa più `act.roads` del Tesoro
 * per tutte le sedie. Le proposte derivano dalle voci della **sedia aperta** e
 * la conversazione decide quale proposta sale in testa.
 */
import { describe, expect, it } from 'vitest';
import type { CabinetAddressView } from '../../services/api';
import { focusedProposals, proposalMentionScore, seatRoads } from './seatProposals';
import type { TreasuryAct } from './treasuryAct';

function seat(overrides: Partial<CabinetAddressView> = {}): CabinetAddressView {
  return {
    seat: 'sanita',
    label: 'Ministro della Sanità',
    reads: 'ospedali e personale',
    opening: '',
    items: [{
      voiceId: 'ospedali',
      need: 'Aprire un reparto.',
      because: 'Le liste di attesa crescono.',
      urgency: 'urgente',
      figures: [{ label: 'Costo stimato', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'Sanità' } }],
      paths: [
        { id: 'subito', title: 'Riparare il reparto', detail: 'Intervenire ora.', prerequisites: [], expected: 'Il reparto riapre.', recommended: true },
        { id: 'rinvio', title: 'Rinviare al prossimo anno', detail: 'Aspettare.', prerequisites: [], expected: 'Nessun costo ora.', recommended: false },
      ],
    }],
    ...overrides,
  };
}

const tesoroAct = {
  seatLabel: 'Ministro del Tesoro',
  voice: '',
  figures: [],
  worksRequest: null,
  nextMaturity: null,
  roads: [
    { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', declaredCost: 'x', expectedGain: 'y', recommended: false, order: { kind: 'text', text: 'r' } },
  ],
} as unknown as TreasuryAct;

describe('seatRoads', () => {
  it('per una sedia non-Tesoro deriva i percorsi delle sue voci, non le strade del Tesoro', () => {
    const roads = seatRoads(seat(), tesoroAct);
    expect(roads.map(road => road.title)).toEqual(['Riparare il reparto', 'Rinviare al prossimo anno']);
    expect(roads.map(road => road.id)).toEqual(['ospedali:subito', 'ospedali:rinvio']);
    expect(roads.some(road => road.title.includes('debito'))).toBe(false);
    // La strada consigliata resta consigliata; il costo cita la cifra del motore.
    expect(roads[0].recommended).toBe(true);
    expect(roads[0].declaredCost).toContain('Costo stimato');
  });

  it('per il Tesoro unisce le strade dell’atto e i percorsi gemelli, senza duplicarli', () => {
    const tesoro: CabinetAddressView = {
      seat: 'tesoro', label: 'Ministro del Tesoro', reads: '', opening: '',
      items: [{
        voiceId: 'treasury_condition', need: 'Che fare dell’avanzo?', because: '', urgency: 'ordinaria', figures: [],
        paths: [
          { id: 'repay', title: 'Ridurre il debito', detail: '', prerequisites: [], expected: '', recommended: false },
          { id: 'invest', title: 'Investire l’avanzo', detail: '', prerequisites: [], expected: '', recommended: true },
        ],
      }],
    };
    const roads = seatRoads(tesoro, tesoroAct);
    // `repay` resta quella dell'atto (id combacia), `invest` arriva dall'agenda:
    // non si duplica la stessa scelta.
    expect(roads.map(road => road.id)).toEqual(['repay', 'invest']);
    expect(roads.find(road => road.id === 'repay')?.title).toContain('Ammortamento');
    expect(roads.find(road => road.id === 'invest')?.title).toBe('Investire l’avanzo');
  });

  it('una sedia senza percorsi non produce proposte inventate', () => {
    const roads = seatRoads(seat({ items: [{ voiceId: 'v', need: 'x', because: 'y', urgency: 'ordinaria', figures: [], paths: [] }] }), null);
    expect(roads).toEqual([]);
  });

  it('una voce senza distinta coperta produce un ordine in prosa, non un cantiere', () => {
    const roads = seatRoads(seat(), null);
    expect(roads[0].order.kind).toBe('text');
  });
});

describe('focusedProposals — il confronto appartiene alla proposta discussa', () => {
  it('la proposta nominata nel discorso sale in testa, le altre restano ordinate', () => {
    const roads = seatRoads(seat(), null);
    const focused = focusedProposals(roads, 'Confronta i tempi del rinvio al prossimo anno');
    expect(focused[0].title).toBe('Rinviare al prossimo anno');
    expect(focused.map(road => road.title)).toHaveLength(2);
  });

  it('senza menzione l’ordine del motore non cambia', () => {
    const roads = seatRoads(seat(), null);
    expect(focusedProposals(roads, 'Mostrami le cifre')).toEqual(roads);
  });

  it('il punteggio di menzione è deterministico e zero senza discorso', () => {
    const road = { title: 'Riparare il reparto', voice: 'd' };
    expect(proposalMentionScore(road, '')).toBe(0);
    expect(proposalMentionScore(road, 'il reparto va riparato')).toBeGreaterThan(0);
    expect(proposalMentionScore(road, 'Riparare il reparto')).toBe(5);
  });
});
