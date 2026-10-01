/**
 * WS-GOVOFFICE-07 — test del piano strategico (Parsing + cascata)
 * ==============================================================
 * Verifica le regole della Parte C2 su funzioni **pure**: i nodi sono datati,
 * le dipendenze diventano archi, e il layout riconosce i **rami** e i
 * **ricongiungimenti** di una cascata. Nessuno snapshot: si legge la struttura.
 */
import { describe, expect, it } from 'vitest';
import { cascadeLayout, parseStrategicPlan, planDateLabel, planFromProposal } from './strategicPlan';

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

describe('WS-MINISTER-UX-08 — planFromProposal (niente date fisse)', () => {
  it('deriva il piano dalla proposta e ancora i nodi alla data di gioco', () => {
    const plan = planFromProposal({
      id: 'lavori-w1', title: 'Scuola elementare', need: 'Manca una scuola.', outcome: 'La scuola apre.',
      today: '2026-01-05',
      steps: [
        { id: 's1', title: 'Appalto', detail: 'Bandire la gara.' },
        { id: 's2', title: 'Cantiere', detail: 'Aprire il cantiere.', requires: ['s1'] },
      ],
    });
    expect(plan?.title).toBe('Scuola elementare');
    expect(plan?.outcome).toBe('La scuola apre.');
    expect(plan?.nodes.map(node => node.date)).toEqual(['5 GEN 2026', '5 GEN 2026', '5 GEN 2026']);
    expect(plan?.nodes[0].from).toEqual([]);
    expect(plan?.nodes[1].from).toEqual(['questione']);
    expect(plan?.nodes[2].from).toEqual(['s1']);
    // Nessuna data fissa di un altro calendario: il piano non contiene «GEN 2026»
    // se non come etichetta derivata dalla data di gioco.
    expect(JSON.stringify(plan)).not.toContain('1951');
  });

  it('con date di gioco diverse il piano cambia di conseguenza', () => {
    const base = { id: 'x', title: 'Piano', need: 'Bisogno', today: '2026-01-05', steps: [{ id: 's1', title: 'A', detail: 'd' }] } as const;
    expect(planDateLabel('2026-01-05')).toBe('5 GEN 2026');
    expect(planDateLabel('2030-07-21')).toBe('21 LUG 2030');
    expect(planFromProposal(base)?.nodes[0].date).toBe('5 GEN 2026');
    expect(planFromProposal({ ...base, today: '2030-07-21' })?.nodes[0].date).toBe('21 LUG 2030');
  });

  it('senza data di gioco o senza strade il piano resta mancante', () => {
    const base = { id: 'x', title: 'Piano', need: 'Bisogno', today: '2026-01-05', steps: [{ id: 's1', title: 'A', detail: 'd' }] } as const;
    expect(planDateLabel(null)).toBeNull();
    expect(planFromProposal({ ...base, today: null })).toBeNull();
    expect(planFromProposal({ ...base, today: '' })).toBeNull();
    expect(planFromProposal({ ...base, steps: [] })).toBeNull();
  });
});
