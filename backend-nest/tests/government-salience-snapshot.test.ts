import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { governmentSalienceContext, governmentSalienceInput } from '../src/core/government/GovernmentSalienceSnapshot';
import { evaluateGovernmentSalience } from '../src/core/government/GovernmentSalience';
import { buildRealitySignals } from '../src/core/government/RealitySignals';

function world(): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({ gameData: {
    id: 'salience', playerPolityId: 'ERI', currentTurn: 2, currentDate: '2000-02-01',
    world: { regions: { er: { id: 'er', name: 'Eritrea', owner: 'ERI', objects: [] } } },
    worldState: { accounts: { ERI: {} }, resources: { stock: { money: 2, food: 10 }, needs: { food: 1 } } },
  }, operationalRows: [], commitments: [] });
}
function number(snapshot: VerifiedWorldSnapshot, key: string, rawValue: number) {
  snapshot.facts[key] = { key, rawValue, label: key, value: String(rawValue), source: 'national_economy', sourceRef: `measured.${key}` };
}
function comparison(snapshot: VerifiedWorldSnapshot, key: string, before: number) {
  snapshot.changes.available = true;
  snapshot.changes.reason = null;
  snapshot.changes.comparedKeys.push(key);
  const after = snapshot.facts[key].rawValue as number;
  if (before !== after) snapshot.changes.deltas.push({ key, before, after, delta: after - before, sourceRef: `measured.${key}`, previousSourceRef: `previous.${key}` });
}

describe('snapshot salience adapter (pure, no providers)', () => {
  it('keeps unknown quantities unknown and does not invent investments or national readiness', () => {
    const snapshot = world();
    const input = governmentSalienceInput(snapshot);
    expect(input.cashFlow).toBeUndefined();
    expect(input.debt.servicePct).toBeNaN();
    expect(input.debt.ratioPct).toBeNaN();
    expect(input.buildable).toEqual([]);
    expect(input.factions).toEqual([]);
    expect(governmentSalienceContext(snapshot).readinessPct).toBeUndefined();
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBeUndefined();
    expect(evaluateGovernmentSalience(input).treasury).toBeUndefined();
  });

  it('uses unrounded monthly balance / annual nominal GDP, never monthly revenue or annualized deficit', () => {
    const snapshot = world();
    number(snapshot, 'nominalGdpUsdBillions', 10252);
    number(snapshot, 'monthlyBalance', -10252 * 0.003);
    number(snapshot, 'debtRatioPct', 55);
    number(snapshot, 'debtServicePct', 8);
    number(snapshot, 'treasury', 500); // Adequate runway: deficit ratio alone is routine.
    const input = governmentSalienceInput(snapshot);
    expect(input.cashFlow!.balancePct).toBeCloseTo(-0.3);
    expect(input.debt.ratioPct).toBe(55);
    expect(evaluateGovernmentSalience(input).treasury).toBeUndefined();
    number(snapshot, 'monthlyBalance', -10252 * 0.021);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).treasury?.urgency).toBe('critica');
  });

  it('weights national readiness by personnel, so one weak unit cannot define the country', () => {
    const snapshot = world();
    snapshot.military.units = [
      { id: 'a', sourceRef: 'units.a', raw: { status: 'operational', personnel: 9_000 } },
      { id: 'b', sourceRef: 'units.b', raw: { status: 'degraded', personnel: 1_000 } },
      { id: 'zero', sourceRef: 'units.zero', raw: { status: 'forming', personnel: 0 } },
      { id: 'bad', sourceRef: 'units.bad', raw: { status: 'operational', personnel: 500 } },
      { id: 'negative', sourceRef: 'units.negative', raw: { status: 'operational', personnel: 500 } },
    ];
    snapshot.military.readiness = [
      { unitId: 'a', value: 0.82 }, { unitId: 'b', value: 0.31 }, { unitId: 'zero', value: 0.1 },
      { unitId: 'bad', value: 85 }, { unitId: 'negative', value: -0.1 },
    ];
    const context = governmentSalienceContext(snapshot);
    // (0.82 × 9000 + 0.31 × 1000) / 10000 = 76.9%: the weak unit is one among many,
    // the zero-personnel formation carries no weight, invalid values are dropped.
    expect(context.readinessPct).toBeCloseTo(76.9, 1);
    expect(context.minReadinessPct).toBe(10);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).defence).toBeUndefined();
  });

  it('only derives previous values from comparable measured keys (including explicitly unchanged keys)', () => {
    const snapshot = world();
    number(snapshot, 'nominalGdpUsdBillions', 2);
    number(snapshot, 'monthlyBalance', -0.01);
    number(snapshot, 'forces', 500);
    number(snapshot, 'mobilized', 1500);
    number(snapshot, 'debtServicePct', 12);
    comparison(snapshot, 'nominalGdpUsdBillions', 1);
    comparison(snapshot, 'monthlyBalance', -0.02);
    comparison(snapshot, 'forces', 300);
    comparison(snapshot, 'debtServicePct', 12);
    const context = governmentSalienceContext(snapshot);
    expect(context.previous).toEqual({ balancePct: -2, forces: 300, debtServicePct: 12 });
    expect(context.previous?.mobilized).toBeUndefined();
    snapshot.changes.available = false;
    expect(governmentSalienceContext(snapshot).previous).toBeUndefined();
  });

  it('weights the previous baseline by the same personnel; a partial comparison is not unchanged', () => {
    const snapshot = world();
    snapshot.military.units = [
      { id: 'a', sourceRef: 'units.a', raw: { status: 'operational', personnel: 8_000 } },
      { id: 'b', sourceRef: 'units.b', raw: { status: 'operational', personnel: 2_000 } },
    ];
    snapshot.military.readiness = [{ unitId: 'a', value: 0.8 }, { unitId: 'b', value: 0.7 }];
    number(snapshot, 'military.units.a.readiness', 0.8);
    number(snapshot, 'military.units.b.readiness', 0.7);
    comparison(snapshot, 'military.units.a.readiness', 0.4);
    expect(governmentSalienceContext(snapshot).previous?.readinessPct).toBeUndefined();
    comparison(snapshot, 'military.units.b.readiness', 0.7);
    // (0.4 × 8000 + 0.7 × 2000) / 10000 = 46%
    expect(governmentSalienceContext(snapshot).previous?.readinessPct).toBeCloseTo(46, 1);
  });

  it('reads operational battle orders, not signed text, historical actions or destroyed units', () => {
    const snapshot = world();
    snapshot.recent.signedActs = [{ id: 'pending', text: 'attaccare', status: 'signed_pending_execution', createdAt: '2000-01-01' }];
    snapshot.military.units = [
      { id: 'a', sourceRef: 'units.a', raw: { status: 'operational', order: 'attack', frontId: 'f1' } },
      { id: 'b', sourceRef: 'units.b', raw: { status: 'degraded', order: 'defend', frontId: 'f1' } },
      { id: 'c', sourceRef: 'units.c', raw: { status: 'retreating', order: 'withdraw', frontId: 'f1' } },
      { id: 'd', sourceRef: 'units.d', raw: { status: 'destroyed', order: 'attack', frontId: 'f1' } },
      { id: 'e', sourceRef: 'units.e', raw: { status: 'forming', order: 'attack', frontId: 'f1' } },
      { id: 'f', sourceRef: 'units.f', raw: { order: 'attack', frontId: 'f1' } },
      // Standing units keep a default defensive order but are not deployed:
      // a garrison at rest is not an ongoing military operation.
      { id: 'g', sourceRef: 'units.g', raw: { status: 'operational', order: 'defend' } },
      { id: 'h', sourceRef: 'units.h', raw: { status: 'operational', order: 'attack' } },
    ];
    expect(governmentSalienceContext(snapshot).ongoingMilitaryOrders).toBe(3);
  });

  it('does not turn hostility into war, nor inactive/empty fronts into active conflicts', () => {
    const snapshot = world();
    snapshot.diplomacy.relations = [{ polityId: 'ETH', polityName: 'Ethiopia', relationship: 'hostile', sourceRef: 'relations.ETH' }, { polityId: 'OTHER', polityName: null, relationship: 'war', sourceRef: 'relations.OTHER' }];
    expect(governmentSalienceContext(snapshot).hostileRelations).toBe(1);
    expect(governmentSalienceContext(snapshot).activeConflicts).toBe(0);
    snapshot.military.fronts = [
      { id: 'active', sourceRef: 'front.active', raw: { status: 'active', attackerPolityId: 'ERI', defenderPolityId: 'ETH', attackerPressure: 1, defenderPressure: 1 } },
      { id: 'empty', sourceRef: 'front.empty', raw: { status: 'active', attackerPolityId: 'ERI', defenderPolityId: 'ETH', attackerPressure: 1, defenderPressure: 0 } },
      { id: 'closed', sourceRef: 'front.closed', raw: { status: 'closed', attackerPolityId: 'ERI', defenderPolityId: 'ETH', attackerPressure: 1, defenderPressure: 1 } },
    ];
    expect(governmentSalienceContext(snapshot).activeConflicts).toBe(1);
    expect(snapshot.diplomacy.wars).toBeNull();
  });

  it('only derives military supply from known positive operational fuel/weapons needs, not generic food coverage', () => {
    const snapshot = world();
    snapshot.military.supply = { stock: { fuel: 0.2, weapons: 2, food: 10 }, monthlyNeeds: { fuel: 100, weapons: 100, food: 1 } };
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBeUndefined();
    snapshot.military.units = [{ id: 'u', sourceRef: 'units.u', raw: { status: 'operational', monthlyNeeds: { fuel: 0.4, weapons: 1 } } }];
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBe(0.5);
    delete snapshot.military.supply.stock!.fuel;
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBe(2);
    delete snapshot.military.supply.stock!.weapons;
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBeUndefined();
  });

  it('uses canonical ships monthlyFuel without suppressing measured land weapons shortages', () => {
    const snapshot = world();
    snapshot.military.supply.stock = { fuel: 0.6, weapons: 0.1 };
    snapshot.military.units = [{ id: 'u', sourceRef: 'units.u', raw: { status: 'operational', monthlyNeeds: { fuel: 0.4, weapons: 5 } } }];
    snapshot.military.ships = [{ id: 's', sourceRef: 'ships.s', raw: { status: 'operational', monthlyFuel: 1 } }];
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBeCloseTo(0.02);
    const refs = buildRealitySignals(snapshot).find(signal => signal.domain === 'military')?.sourceRefs;
    expect(refs).toEqual(expect.arrayContaining(['ships.s.monthlyFuel', 'units.u.monthlyNeeds.weapons']));
    delete snapshot.military.ships[0].raw.monthlyFuel;
    // Unknown ship fuel does not make the known land weapons shortage unknown.
    expect(governmentSalienceContext(snapshot).supplyCoverageMonths).toBeCloseTo(0.02);
  });

  it('shares social delta selection between Consultant and Agenda, including previous provenance', () => {
    const snapshot = world();
    number(snapshot, 'socialTension', 30);
    comparison(snapshot, 'socialTension', 10);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).education).toBeDefined();
    const signal = buildRealitySignals(snapshot).find(signal => signal.domain === 'social');
    expect(signal?.reason).toContain('10');
    expect(signal?.sourceRefs).toContain('previous.socialTension');
  });

  it('treats losses proportionally for small armies instead of requiring 100 missing formations', () => {
    const snapshot = world();
    number(snapshot, 'forces', 2); comparison(snapshot, 'forces', 4);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).defence?.priority).toBe('change');
  });

  it('maps explicitly accounted mobilization without inventing manpower from object count', () => {
    const snapshot = world();
    number(snapshot, 'mobilized', 1200);
    snapshot.military.mobilizations = [{ id: 'm', name: null, type: 'mobilization', regionId: 'er', regionName: 'Eritrea', sourceRef: 'world.er.m', raw: { type: 'mobilization', level: 1200 } }];
    expect(governmentSalienceInput(snapshot).defence?.mobilized).toBe(1200);
    expect(evaluateGovernmentSalience(governmentSalienceInput(snapshot)).defence?.priority).toBe('mobilization');
  });
});
