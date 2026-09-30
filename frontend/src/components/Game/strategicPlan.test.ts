/**
 * WS-GOVOFFICE-07 — test del piano strategico (Parsing + cascata)
 * ==============================================================
 * Verifica le regole della Parte C2 su funzioni **pure**: i nodi sono datati,
 * le dipendenze diventano archi, e il layout riconosce i **rami** e i
 * **ricongiungimenti** di una cascata. Nessuno snapshot: si legge la struttura.
 */
import { describe, expect, it } from 'vitest';
import { cascadeLayout, parseStrategicPlan, STABILIZATION_PLAN_TEXT, stabilizationPlan } from './strategicPlan';

const TEXT = [
  'PIANO: Prova',
  'ESITO: Esito finale.',
  'GEN 2026 | Radice | Il punto di partenza | -',
  'GEN-FEB 2026 | Ramo A | Primo ramo | radice',
  'GEN-FEB 2026 | Ramo B | Secondo ramo | radice',
  'MAR 2026 | Fusione | I rami si uniscono | ramo-a, ramo-b',
].join('\n');

describe('parseStrategicPlan', () => {
  it('legge titolo, esito e nodi datati', () => {
    const plan = parseStrategicPlan(TEXT);
    expect(plan.title).toBe('Prova');
    expect(plan.outcome).toBe('Esito finale.');
    expect(plan.nodes.map(node => node.date)).toEqual(['GEN 2026', 'GEN-FEB 2026', 'GEN-FEB 2026', 'MAR 2026']);
    expect(plan.nodes.map(node => node.title)).toContain('Ramo A');
  });

  it('risolve le dipendenze in id e scarta quelle ignote (radice)', () => {
    const plan = parseStrategicPlan(TEXT);
    const fusion = plan.nodes.find(node => node.title === 'Fusione');
    expect(fusion?.from).toEqual(['ramo-a', 'ramo-b']);
    const ghost = parseStrategicPlan('X 2026 | Solo | desc | non-esiste');
    expect(ghost.nodes[0].from).toEqual([]);
  });

  it('è deterministico: stesso testo ⇒ stesso piano', () => {
    expect(parseStrategicPlan(TEXT)).toEqual(parseStrategicPlan(TEXT));
  });
});

describe('cascadeLayout', () => {
  it('assegna a ogni nodo la sua profondità (nodo iniziale = 0)', () => {
    const layout = cascadeLayout(parseStrategicPlan(TEXT));
    expect(layout.depth.radice).toBe(0);
    expect(layout.depth['ramo-a']).toBe(1);
    expect(layout.depth['ramo-b']).toBe(1);
    expect(layout.depth.fusione).toBe(2);
    expect(layout.lanes.map(lane => lane.level)).toEqual([0, 1, 2]);
  });

  it('riconosce il ramo e il ricongiungimento', () => {
    const layout = cascadeLayout(parseStrategicPlan(TEXT));
    expect(layout.branches).toEqual(['radice']);
    expect(layout.merges).toEqual(['fusione']);
  });
});

describe('stabilizationPlan (contenuto d’esempio, autore)', () => {
  it('ha nodi datati, almeno un ramo e un ricongiungimento', () => {
    const plan = stabilizationPlan();
    const layout = cascadeLayout(plan);
    expect(plan.title).toContain('Stabilizzazione');
    expect(plan.nodes.length).toBeGreaterThanOrEqual(4);
    expect(plan.nodes.every(node => node.date.trim().length > 0)).toBe(true);
    expect(layout.branches.length).toBeGreaterThanOrEqual(1);
    expect(layout.merges.length).toBeGreaterThanOrEqual(1);
    expect(plan.outcome.length).toBeGreaterThan(0);
  });

  it('il testo d’esempio è la fonte del piano (parsing, non un duplicato)', () => {
    expect(parseStrategicPlan(STABILIZATION_PLAN_TEXT)).toEqual(stabilizationPlan());
  });
});
