import { describe, expect, it } from 'vitest';
import {
  assignBootstrapIndividualWeapons,
  equipmentTotals,
  UNIT_ORDER_DEFAULT,
  type MilitaryUnitState,
} from '../src/core/simulation/OperationalState';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { governmentSalienceContext, governmentSalienceInput } from '../src/core/government/GovernmentSalienceSnapshot';
import { evaluateGovernmentSalience } from '../src/core/government/GovernmentSalience';
import { buildRealitySignals } from '../src/core/government/RealitySignals';

/** A unit as it is born at country bootstrap: men present, rifles still in depot. */
const unit = (id: string, personnel: number, establishmentPersonnel: number): MilitaryUnitState => ({
  id, polityId: 'AAA', armyId: 'army-1', name: id, personnel, establishmentPersonnel,
  equipment: {}, monthlyNeeds: { fuel: 0, weapons: 0, food: 0 }, readiness: 0, status: 'forming',
  regionId: null, regionName: null, updatedDate: '2026-01-01', legacyDerived: true,
  order: UNIT_ORDER_DEFAULT, frontId: null,
});
const bagOf = (units: readonly MilitaryUnitState[]): Record<string, number> => {
  const bag: Record<string, number> = {};
  for (const entry of units) for (const [id, quantity] of Object.entries(entry.equipment)) bag[id] = (bag[id] ?? 0) + quantity;
  return bag;
};

describe('military bootstrap — initial country equipment reaches the units', () => {
  it('A — enough rifles: initial units are equipped, not forming at 25%', () => {
    const { units, depot } = assignBootstrapIndividualWeapons({
      units: [unit('u1', 1_000, 1_000), unit('u2', 1_000, 1_000)],
      declaredStatus: 'operational', depot: { fucili: 3_000 }, epoch: 'moderno',
    });
    // One rifle per man is not required, only the epoch share (75%): 750 each.
    expect(units.map(entry => entry.equipment.fucili)).toEqual([750, 750]);
    expect(units.map(entry => entry.status)).toEqual(['operational', 'operational']);
    expect(units.map(entry => entry.readiness)).toEqual([1, 1]);
    expect(depot).toEqual({ fucili: 1_500 });
    expect(equipmentTotals(depot, bagOf(units))).toEqual({ fucili: 3_000 });
  });

  it('B — not enough rifles: the shortage is real, never a fabricated refill', () => {
    const { units, depot } = assignBootstrapIndividualWeapons({
      units: [unit('u1', 1_000, 1_000), unit('u2', 1_000, 1_000)],
      declaredStatus: 'operational', depot: { fucili: 750 }, epoch: 'moderno',
    });
    expect(units[0].equipment.fucili).toBe(750);
    expect(units[0].status).toBe('operational');
    expect(units[1].equipment.fucili).toBeUndefined();
    expect(units[1].status).toBe('forming');
    expect(depot).toEqual({});
    expect(equipmentTotals(depot, bagOf(units))).toEqual({ fucili: 750 });
  });

  it('C — assigning twice is idempotent: the same total is never moved again', () => {
    const first = assignBootstrapIndividualWeapons({
      units: [unit('u1', 1_000, 1_000), unit('u2', 1_000, 1_000)],
      declaredStatus: 'operational', depot: { fucili: 2_000 }, epoch: 'moderno',
    });
    const second = assignBootstrapIndividualWeapons({
      units: first.units, declaredStatus: 'operational', depot: first.depot, epoch: 'moderno',
    });
    expect(second.units).toEqual(first.units);
    expect(second.depot).toEqual(first.depot);
    expect(equipmentTotals(second.depot, bagOf(second.units))).toEqual({ fucili: 2_000 });
  });
});

function world(): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({ gameData: {
    id: 'bootstrap', playerPolityId: 'ERI', currentTurn: 2, currentDate: '2000-02-01',
    world: { regions: { er: { id: 'er', name: 'Eritrea', owner: 'ERI', objects: [] } } },
    worldState: { accounts: { ERI: {} }, resources: { stock: { money: 2, food: 10 }, needs: { food: 1 } } },
  }, operationalRows: [], commitments: [] });
}
function number(snapshot: VerifiedWorldSnapshot, key: string, rawValue: number) {
  snapshot.facts[key] = { key, rawValue, label: key, value: String(rawValue), source: 'national_economy', sourceRef: `measured.${key}` };
}
function withUnits(snapshot: VerifiedWorldSnapshot, personnel: number[], readiness: number[]) {
  snapshot.military.units = personnel.map((men, index) => ({
    id: `u${index}`, sourceRef: `units.u${index}`, raw: { status: 'operational', personnel: men },
  }));
  snapshot.military.readiness = readiness.map((value, index) => ({ unitId: `u${index}`, value }));
}

describe('military readiness salience — measured national state, not the initial estimate', () => {
  it('D — the initial profile estimate alone never triggers a military crisis', () => {
    const snapshot = world();
    number(snapshot, 'military.initialReadinessPct', 25);
    const context = governmentSalienceContext(snapshot);
    expect(context.initialReadinessEstimate).toBe(true);
    expect(context.readinessPct).toBe(25);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).defence).toBeUndefined();
    expect(buildRealitySignals(snapshot).some(signal => signal.key === 'military-readiness')).toBe(false);
  });

  it('E — a genuinely low measured readiness produces the signal with national wording', () => {
    const snapshot = world();
    withUnits(snapshot, [1_000, 1_000], [0.3, 0.25]);
    number(snapshot, 'military.units.u0.readiness', 0.3);
    number(snapshot, 'military.units.u1.readiness', 0.25);
    expect(governmentSalienceContext(snapshot).readinessPct).toBeCloseTo(27.5, 1);
    const agenda = evaluateGovernmentSalience(governmentSalienceInput(snapshot));
    expect(agenda.defence?.priority).toBe('readiness');
    expect(agenda.defence?.urgency).toBe('critica');
    expect(agenda.defence?.because).toContain('prontezza operativa');
    expect(agenda.defence?.because).not.toContain('prontezza minima');
    const signal = buildRealitySignals(snapshot).find(item => item.key === 'military-readiness');
    expect(signal).toBeTruthy();
    expect(signal?.reason).toContain('prontezza operativa');
  });

  it('F — one weak unit among many does not drag the national readiness to 25%', () => {
    const snapshot = world();
    withUnits(
      snapshot,
      [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000],
      [0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.25],
    );
    const context = governmentSalienceContext(snapshot);
    expect(context.readinessPct).toBeCloseTo(88, 0);
    expect(context.minReadinessPct).toBe(25);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).defence).toBeUndefined();
  });
});
