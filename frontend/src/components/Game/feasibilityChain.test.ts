import { describe, expect, it } from 'vitest';
import { explainFeasibility } from './feasibilityExplanation';
import { buildFeasibilityChain } from './feasibilityChain';

const baseCosts = {
  basis: 'recipe' as const,
  timeDays: 30,
  inputs: [{ resourceId: 'steel', name: 'Acciaio', quantity: '60000', unit: 't' }],
  upkeep: [],
};
const noDeficit = explainFeasibility({ status: 'feasible', blockers: [], alternatives: [] });

describe('U02 passo 2 — buildFeasibilityChain', () => {
  it('proietta i costi di catalogo con la loro fonte, senza inventare cifre', () => {
    const view = buildFeasibilityChain({ orderText: 'Costruisci acciaieria', costs: baseCosts, prerequisites: [], explanation: noDeficit });
    const cost = view.nodes.find(n => n.kind === 'costo')!;
    expect(cost.label).toBe('Acciaio');
    expect(cost.detail).toBe('60000 t');
    expect(cost.source).toContain('Catalogo');
    expect(view.hasCosts).toBe(true);
    expect(view.hasDeficit).toBe(false);
  });

  it('un ordine senza consumi dichiarati non inventa costi', () => {
    const view = buildFeasibilityChain({
      orderText: 'Discorso',
      costs: { basis: 'none', timeDays: 0, inputs: [], upkeep: [] },
      prerequisites: [],
      explanation: noDeficit,
    });
    expect(view.hasCosts).toBe(false);
    expect(view.nodes.some(n => n.label === 'Nessun consumo materiale')).toBe(true);
  });

  it('mappa i deficit dai blocker con ciò che manca', () => {
    const explanation = explainFeasibility({
      status: 'blocked',
      blockers: [{ code: 'KNOWLEDGE_MISSING', detail: 'serve la tecnologia X', missing: ['tech.x'] }],
    });
    const view = buildFeasibilityChain({ orderText: 'Ordine', costs: baseCosts, prerequisites: [], explanation });
    const deficit = view.nodes.find(n => n.kind === 'deficit')!;
    expect(deficit.label).toBe('Conoscenza mancante');
    expect(deficit.detail).toBe('tech.x');
    expect(view.hasDeficit).toBe(true);
  });

  it('aggiunge i prerequisiti non già coperti dai blocker, senza duplicati', () => {
    const explanation = explainFeasibility({ status: 'blocked', blockers: [] });
    const view = buildFeasibilityChain({
      orderText: 'Ordine',
      costs: baseCosts,
      prerequisites: ['tecnologia Y', 'tecnologia Y'],
      explanation,
    });
    const deficits = view.nodes.filter(n => n.kind === 'deficit');
    expect(deficits).toHaveLength(1);
    expect(deficits[0].detail).toBe('tecnologia Y');
  });

  it('descrive il mantenimento periodico come costo di catalogo', () => {
    const view = buildFeasibilityChain({
      orderText: 'Manutieni',
      costs: { basis: 'upkeep', timeDays: 0, inputs: [], upkeep: [{ line: { resourceId: 'steel', name: 'Acciaio', quantity: '10', unit: 't' }, periodDays: 90 }] },
      prerequisites: [],
      explanation: noDeficit,
    });
    const node = view.nodes.find(n => n.kind === 'costo')!;
    expect(node.label).toBe('Mantenimento Acciaio');
    expect(node.detail).toContain('ogni 90 giorni');
  });

  it('ogni nodo ha testo e fonte: leggibile senza colore', () => {
    const explanation = explainFeasibility({ status: 'needs_data', blockers: [{ code: 'DATA_UNAVAILABLE', detail: 'giacimento non censito' }] });
    const view = buildFeasibilityChain({ orderText: 'Ordine', costs: baseCosts, prerequisites: ['x'], explanation });
    expect(view.nodes.length).toBeGreaterThan(0);
    for (const node of view.nodes) {
      expect(node.label.trim().length).toBeGreaterThan(0);
      expect(node.detail.trim().length).toBeGreaterThan(0);
      expect(node.source.trim().length).toBeGreaterThan(0);
    }
    expect(view.sources).toContain('Catalogo (ricetta di produzione)');
  });
});
