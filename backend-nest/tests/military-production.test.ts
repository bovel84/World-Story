/**
 * Produzione militare: percentuale di completamento, rischio deterministico e
 * avanzamento dei progetti. Nessuna casualità non riproducibile.
 */
import { describe, it, expect } from 'vitest';
import {
  DOMAIN_MONTHS, advanceOrder, productionRate, projectProgress, setbackChance, stableRoll,
  type ProductionContext, type ProductionOrder,
} from '../src/core/simulation/MilitaryProduction';
import { equipmentById } from '../src/core/simulation/MilitaryIndustry';

const context = (over: Partial<ProductionContext> = {}): ProductionContext => ({
  factories: 4, ports: 2, universities: 3, stability: 60, socialTension: 20,
  technologies: ['industria_bellica'], ...over,
});

const order = (over: Partial<ProductionOrder> = {}): ProductionOrder => ({
  id: 'ord-test', equipmentId: 'fucili', name: 'Fucili', domain: 'terra', quantity: 100,
  progress: 0, spentMln: 100, startedTurn: 1, startedDate: '2026-01-01', status: 'in_progress',
  note: '', qualityLoss: 0, updatedDate: '2026-01-01', ...over,
});

/** Trova un seed il cui tiro cade in un intervallo: per test deterministici. */
function seedWithRoll(predicate: (roll: number) => boolean, prefix = 'seed'): string {
  for (let index = 0; index < 5000; index += 1) {
    const seed = `${prefix}:${index}`;
    if (predicate(stableRoll(seed))) return seed;
  }
  throw new Error('nessun seed trovato');
}

describe('tassi e rischio', () => {
  it('stableRoll è deterministico e in [0,1)', () => {
    expect(stableRoll('abc')).toBe(stableRoll('abc'));
    expect(stableRoll('abc')).not.toBe(stableRoll('abd'));
    for (const seed of ['a', 'b', 'c', 'turn:12']) {
      const roll = stableRoll(seed);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
  });

  it('la produzione è più lenta per voci avanzate e domini pesanti', () => {
    const fucili = equipmentById('fucili')!;
    const carri = equipmentById('carri_4')!;
    expect(productionRate(fucili, context())).toBeGreaterThan(0);
    expect(productionRate(carri, context())).toBeLessThan(productionRate(fucili, context()));
    // Più infrastrutture = più veloce.
    expect(productionRate(fucili, context({ factories: 12, universities: 8 })))
      .toBeGreaterThan(productionRate(fucili, context()));
    expect(DOMAIN_MONTHS.mare).toBeGreaterThan(DOMAIN_MONTHS.terra);
  });

  it('il rischio cresce con instabilità e tensione ed è limitato', () => {
    const equipment = equipmentById('carri_4')!;
    const calm = setbackChance(context({ stability: 80, socialTension: 10 }), equipment);
    const unstable = setbackChance(context({ stability: 25, socialTension: 70 }), equipment);
    expect(unstable).toBeGreaterThan(calm);
    expect(calm).toBeGreaterThanOrEqual(0.06);
    expect(setbackChance(context({ stability: 0, socialTension: 100 }), equipment)).toBeLessThanOrEqual(0.6);
  });
});

describe('avanzamento degli ordini', () => {
  it('senza imprevisto la percentuale cresce e a 100% consegna', () => {
    const equipment = equipmentById('fucili')!;
    const chance = setbackChance(context(), equipment);
    const seed = seedWithRoll(roll => roll >= chance);
    let current = order();
    let completed = false;
    for (let month = 0; month < 20 && !completed; month += 1) {
      const result = advanceOrder(current, context(), 1, seed);
      current = result.order;
      completed = result.completed;
      if (completed) expect(result.delivered).toBeGreaterThan(0);
      else expect(result.setbackPct).toBe(0);
    }
    expect(completed).toBe(true);
    expect(current.progress).toBe(100);
    expect(current.status).toBe('completed');
  });

  it('un imprevisto fa arretrare la percentuale e introduce difetti', () => {
    const equipment = equipmentById('fucili')!;
    const chance = setbackChance(context(), equipment);
    const seed = seedWithRoll(roll => roll < chance && roll >= chance * 0.25, 'setback');
    const result = advanceOrder(order({ progress: 50 }), context({ stability: 20, socialTension: 80 }), 1, seed);
    expect(result.setbackPct).toBeGreaterThanOrEqual(6);
    expect(result.order.progress).toBeLessThan(50 + productionRate(equipment, context()) - 5);
    expect(result.order.qualityLoss).toBeGreaterThan(0);
    expect(result.order.note).toMatch(/imprevisto/);
  });

  it('un tiro catastrofico fa fallire la produzione', () => {
    const equipment = equipmentById('fucili')!;
    const chance = setbackChance(context({ stability: 10, socialTension: 90 }), equipment);
    // Primo tiro sotto chance*0.25 e secondo tiro di fallimento sotto 0.5.
    let found: string | null = null;
    for (let index = 0; index < 20000 && !found; index += 1) {
      const seed = `fail:${index}`;
      const roll = stableRoll(seed);
      if (roll < chance * 0.25 && stableRoll(`${seed}:fail`) < 0.5) found = seed;
    }
    expect(found).not.toBeNull();
    const result = advanceOrder(order(), context({ stability: 10, socialTension: 90 }), 1, found!);
    expect(result.failed).toBe(true);
    expect(result.delivered).toBe(0);
    expect(result.order.status).toBe('failed');
  });

  it('lo stesso seed dà sempre lo stesso esito', () => {
    const first = advanceOrder(order(), context(), 2, 'fixed-seed');
    const second = advanceOrder(order(), context(), 2, 'fixed-seed');
    expect(first).toEqual(second);
  });

  it('le unità consegnate scontano i difetti accumulati', () => {
    const equipment = equipmentById('fucili')!;
    const chance = setbackChance(context(), equipment);
    const seed = seedWithRoll(roll => roll >= chance);
    const result = advanceOrder(order({ progress: 100, quantity: 100, qualityLoss: 20 }), context(), 0.01, seed);
    expect(result.completed).toBe(true);
    expect(result.delivered).toBe(80);
  });
});

describe('avanzamento dei progetti', () => {
  it('calcola la percentuale dalle date e tocca il 100% solo alla scadenza', () => {
    expect(projectProgress('2026-01-01', '2026-03-01', '2026-01-01')).toBe(0);
    expect(projectProgress('2026-01-01', '2026-03-01', '2026-02-01')).toBeGreaterThanOrEqual(50);
    // Prima della scadenza il progetto non è mai dato per chiuso.
    expect(projectProgress('2026-01-01', '2026-03-01', '2026-02-28')).toBeLessThanOrEqual(99);
    // Alla scadenza e oltre il progetto è completato.
    expect(projectProgress('2026-01-01', '2026-03-01', '2026-03-01')).toBe(100);
    expect(projectProgress('2026-01-01', '2026-03-01', '2026-05-01')).toBe(100);
    // Senza scadenza: stima prudente, non certezza.
    expect(projectProgress('2026-01-01', null, '2026-06-01')).toBe(35);
    expect(projectProgress(null, '2026-03-01', '2026-02-01')).toBe(0);
  });
});
