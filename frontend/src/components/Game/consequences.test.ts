/**
 * WS-MINISTER-UX-04 — Le conseguenze di una proposta (modulo puro)
 * ================================================================
 * Difende la tassonomia del confronto e, soprattutto, i confini: dove il motore
 * non dichiara una dimensione, la tavola lo dice; l'incertezza si legge dalla
 * provenienza delle cifre; gli effetti sociali non si calcolano. Nessuna cifra
 * è introdotta qui.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPARISON_DIMENSIONS, SOCIAL_EFFECTS_NOTE, compareRoads, countUnavailable,
} from './consequences';
import type { CabinetItemView } from '../../services/api';
import type { TreasuryRoad } from './treasuryAct';

function workItem(overrides: Partial<CabinetItemView> = {}): CabinetItemView {
  return {
    voiceId: 'rail',
    need: 'Ferrovia transnazionale',
    because: 'Il nord resta isolato.',
    urgency: 'urgente',
    figures: [{ label: 'Fabbisogno', value: '8', unit: 'mld', basis: { kind: 'measured', source: 'Tesoro' } }],
    paths: [{
      id: 'rail-transnational', title: 'Aprire il cantiere', detail: 'Opera prioritaria.',
      prerequisites: ['acciaio', 'manodopera'], expected: 'Il nord si collega.', recommended: true,
    }],
    work: { workId: 'rail-transnational', name: 'Ferrovia' },
    declaration: { workId: 'rail-transnational', payerActorId: 'lavori', materialActorId: 'industria', funded: true },
    ...overrides,
  };
}

const workRoad = (item: CabinetItemView): TreasuryRoad => ({
  id: 'invest',
  title: item.paths[0].title,
  voice: 'Aprire il cantiere.',
  declaredCost: '12,00 mld',
  expectedGain: 'effetto dichiarato al completamento',
  recommended: true,
  order: { kind: 'work', path: item.paths[0], item },
});

const repayRoad: TreasuryRoad = {
  id: 'repay',
  title: 'Ammortamento del debito',
  voice: 'Rimborsare i titoli.',
  declaredCost: '12,00 mld',
  expectedGain: '0,54 mld di interessi in meno',
  recommended: false,
  order: { kind: 'text', text: 'Ordina al Tesoro di rimborsare i titoli in scadenza.' },
};

describe('compareRoads — stesse dimensioni, provenienza dichiarata', () => {
  it('confronta ogni strada su tutte le dimensioni previste', () => {
    const [comparison] = compareRoads([workRoad(workItem())]);
    expect(Object.keys(comparison.cells).sort()).toEqual(
      COMPARISON_DIMENSIONS.map(dimension => dimension.id).sort(),
    );
    expect(comparison.cells.initial).toEqual({ value: '12,00 mld', basis: 'declared' });
    expect(comparison.cells.benefit.value).toContain('effetto dichiarato');
  });

  it('ciò che il motore non dichiara è «non dichiarato», non un numero inventato', () => {
    const [comparison] = compareRoads([workRoad(workItem())]);
    expect(comparison.cells.recurring).toEqual({ value: 'Spesa ricorrente: non dichiarato dal motore', basis: 'unavailable' });
    expect(comparison.cells.timing.basis).toBe('unavailable');
    expect(comparison.cells.coverage).toEqual({ value: 'distinta coperta', basis: 'declared' });
  });

  it('la copertura scoperta nomina i materiali mancanti', () => {
    const item = workItem({
      declaration: {
        workId: 'rail-transnational', payerActorId: 'lavori', materialActorId: null, funded: false,
        missingMaterials: [{ resourceId: 'acciaio', missing: '400 t' }],
      },
    });
    const [comparison] = compareRoads([workRoad(item)]);
    expect(comparison.cells.coverage.basis).toBe('declared');
    expect(comparison.cells.coverage.value).toContain('acciaio (400 t)');
  });

  it('l’incertezza si legge dalle cifre: misurata, stimata, mancante', () => {
    const measured = compareRoads([workRoad(workItem())])[0];
    expect(measured.cells.uncertainty.basis).toBe('measured');

    const estimated = compareRoads([workRoad(workItem({
      figures: [{ label: 'Fabbisogno', value: '8', unit: 'mld', basis: { kind: 'estimated', source: 'Tesoro' } }],
    }))])[0];
    expect(estimated.cells.uncertainty.basis).toBe('estimated');

    const missing = compareRoads([workRoad(workItem({
      figures: [{ label: 'Costo acciaio', value: '', unit: '', basis: { kind: 'unknown', missing: 'non letto' } }],
    }))])[0];
    expect(missing.cells.uncertainty.basis).toBe('unavailable');
    expect(missing.cells.uncertainty.value).toContain('Costo acciaio');
  });

  it('i vincoli vengono dai prerequisiti dichiarati; se non ce ne sono, lo dice', () => {
    expect(compareRoads([workRoad(workItem())])[0].cells.constraints.value).toBe('acciaio, manodopera');
    const noPrereq = workItem({ paths: [{ ...workItem().paths[0], prerequisites: [] }] });
    expect(compareRoads([workRoad(noPrereq)])[0].cells.constraints.value).toBe('nessun prerequisito dichiarato');
  });

  it('la catena distingue simulato, dichiarato e non simulato', () => {
    const work = compareRoads([workRoad(workItem())])[0];
    expect(work.flow.map(step => step.kind)).toEqual(['simulated', 'simulated', 'declared', 'not-simulated']);
    expect(work.flow[3].detail).toBe(SOCIAL_EFFECTS_NOTE);

    const repay = compareRoads([repayRoad])[0];
    expect(repay.flow.map(step => step.kind)).toEqual(['declared', 'declared', 'declared', 'not-simulated']);
    expect(repay.flow[3].kind).toBe('not-simulated');
  });

  it('conta le dimensioni non dichiarate per dirlo nel contesto', () => {
    const comparison = compareRoads([workRoad(workItem()), repayRoad]);
    // Opera: spesa ricorrente e tempi = 2. Rimborso: anche la copertura, che per
    // una pura movimentazione di cassa il motore non dichiara = 3. Totale 5.
    expect(countUnavailable(comparison)).toBe(5);
  });

  it('senza strade non inventa un confronto', () => {
    expect(compareRoads([])).toEqual([]);
  });
});
