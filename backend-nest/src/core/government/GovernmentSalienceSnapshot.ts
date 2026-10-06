/** Pure projection of verified measurements into the shared salience policy.
 * Missing measurements are not zero, peace, unchanged, or an investment candidate.
 */
import type { GovernmentAgendaInput } from './GovernmentAgenda';
import type { GovernmentSalienceContext } from './GovernmentSalience';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const readiness = (value: unknown): number | undefined => {
  const result = finite(value);
  return result !== undefined && result >= 0 && result <= 1 ? result : undefined;
};
const measured = (snapshot: VerifiedWorldSnapshot, key: string) => finite(snapshot.facts[key]?.rawValue);
const previous = (snapshot: VerifiedWorldSnapshot, key: string): number | undefined => {
  if (!snapshot.changes.available || !snapshot.changes.comparedKeys.includes(key)) return undefined;
  // The builder only omits a delta for keys actually measured unchanged.
  const change = snapshot.changes.deltas.find(delta => delta.key === key);
  return change ? finite(change.before) : measured(snapshot, key);
};
const ratio = (balance: number | undefined, gdp: number | undefined) =>
  balance !== undefined && gdp !== undefined && gdp > 0 ? balance / gdp * 100 : undefined;
const activeUnit = (status: unknown) => ['operational', 'degraded', 'retreating'].includes(String(status));

/**
 * Prontezza nazionale: media **pesata per personale** dei reparti vivi, non il
 * minimo. Un solo reparto debole tra molti non trascina il paese; distrutti e
 * reparti a personale zero non pesano. Se il personale non è misurabile per
 * nessun reparto si ripiega sulla media semplice: un dato assente non vale zero.
 */
function nationalReadinessPct(
  snapshot: VerifiedWorldSnapshot,
  entries: ReadonlyArray<{ unitId: string; value: number }>,
): number | undefined {
  if (!entries.length) return undefined;
  let weight = 0;
  let weighted = 0;
  let plain = 0;
  for (const entry of entries) {
    plain += entry.value;
    const raw = snapshot.military.units.find(unit => unit.id === entry.unitId)?.raw as { personnel?: unknown } | undefined;
    const personnel = finite(raw?.personnel);
    if (personnel !== undefined && personnel > 0) {
      weight += personnel;
      weighted += entry.value * personnel;
    }
  }
  return weight > 0 ? weighted / weight * 100 : plain / entries.length * 100;
}

export function governmentSalienceContext(snapshot: VerifiedWorldSnapshot): GovernmentSalienceContext {
  const context: GovernmentSalienceContext = {};
  const units = (snapshot.military.readiness ?? []).filter(entry => readiness(entry.value) !== undefined
    && snapshot.military.units.find(unit => unit.id === entry.unitId)?.raw.status !== 'destroyed');
  // La prontezza nazionale è la **misura** pesata per personale dei reparti
  // vivi. La stima del profilo è solo un ripiego quando non esiste ancora
  // nessun reparto misurato: non deve mai sostituire il dato reale.
  if (units.length) {
    const measuredPct = nationalReadinessPct(snapshot, units);
    if (measuredPct !== undefined) {
      context.readinessPct = measuredPct;
      // Dettaglio diagnostico: il reparto più debole, mai la cifra nazionale.
      context.minReadinessPct = Math.min(...units.map(entry => entry.value)) * 100;
    }
  }
  if (context.readinessPct === undefined) {
    const initial = measured(snapshot, 'military.initialReadinessPct');
    if (initial !== undefined && initial >= 0 && initial <= 100) {
      context.readinessPct = initial;
      context.initialReadinessEstimate = true;
    }
  }
  if (snapshot.diplomacy.relations !== null) {
    context.hostileRelations = snapshot.diplomacy.relations.filter(relation => relation.relationship === 'hostile').length;
  }
  if (!snapshot.unavailable.includes('military.operationalObjects')) {
    // Un ordine è «in corso» solo per un reparto realmente schierato su un
    // fronte: l'ordine di difesa di default di una guarnigione in pace non è
    // un'operazione. Evita che ogni reparto attivo diventi una voce militare.
    context.ongoingMilitaryOrders = snapshot.military.units.filter(unit =>
      activeUnit(unit.raw.status) && unit.raw.frontId != null).length;
    // A named front alone is not a conflict. Require an operating phase and
    // positive pressure actually committed by the opposing polity.
    context.activeConflicts = snapshot.military.fronts.filter(front => {
      if (!['active', 'stalemate', 'breakthrough'].includes(String(front.raw.status))) return false;
      const enemyPressure = front.raw.attackerPolityId === snapshot.polityId ? front.raw.defenderPressure
        : front.raw.defenderPolityId === snapshot.polityId ? front.raw.attackerPressure : undefined;
      return (finite(enemyPressure) ?? 0) > 0;
    }).length;
  }

  // National food coverage and generic material needs are NOT military supply.
  // Prefer operational units to their aggregate map formations (no double count).
  const consumers = [
    ...(snapshot.military.units.length ? snapshot.military.units.filter(unit => activeUnit(unit.raw.status)).map(unit => unit.raw)
      : snapshot.military.formations.map(formation => formation.raw)),
  ];
  const coverage: number[] = [];
  for (const resource of ['fuel', 'weapons'] as const) {
    const stock = finite(snapshot.military.supply.stock?.[resource]);
    const needs = consumers.map(consumer => {
      const demand = consumer.monthlyNeeds;
      return demand && typeof demand === 'object' ? finite((demand as Record<string, unknown>)[resource]) : undefined;
    });
    // Canonical ships consume monthlyFuel, not land monthlyNeeds or weapons.
    // Missing ship fuel cannot invalidate an independently known weapons bill.
    if (resource === 'fuel') needs.push(...snapshot.military.ships.map(ship => finite(ship.raw.monthlyFuel)));
    if (stock === undefined || stock < 0 || !needs.length || needs.some(need => need === undefined || need < 0)) continue;
    const total = (needs as number[]).reduce((sum, need) => sum + need, 0);
    if (total > 0) coverage.push(stock / total);
  }
  if (coverage.length) context.supplyCoverageMonths = Math.min(...coverage);

  const balance = measured(snapshot, 'monthlyBalance');
  const treasury = measured(snapshot, 'treasury');
  if (balance !== undefined && balance < 0 && treasury !== undefined) {
    context.cashRunwayMonths = Math.max(0, treasury) / -balance;
  }
  const baseline: NonNullable<GovernmentSalienceContext['previous']> = {};
  const balancePct = ratio(previous(snapshot, 'monthlyBalance'), previous(snapshot, 'nominalGdpUsdBillions'));
  if (balancePct !== undefined) baseline.balancePct = balancePct;
  for (const key of ['debtServicePct', 'forces', 'mobilized', 'stability', 'socialTension'] as const) {
    const value = previous(snapshot, key);
    if (value !== undefined) baseline[key] = value;
  }
  const previousUnits = units.map(unit => readiness(previous(snapshot, `military.units.${unit.unitId}.readiness`)));
  // A partial comparison cannot establish the previous national readiness.
  if (!context.initialReadinessEstimate && previousUnits.length && previousUnits.every(value => value !== undefined)
    && !snapshot.changes.comparedKeys.includes('military.initialReadinessPct')) {
    const priorPct = nationalReadinessPct(
      snapshot, units.map((unit, index) => ({ unitId: unit.unitId, value: previousUnits[index] as number })),
    );
    if (priorPct !== undefined) baseline.readinessPct = priorPct;
  }
  if (Object.keys(baseline).length) context.previous = baseline;
  return context;
}

export function governmentSalienceInput(snapshot: VerifiedWorldSnapshot): GovernmentAgendaInput {
  const account = snapshot.economy.account;
  const balance = measured(snapshot, 'monthlyBalance');
  const gdp = measured(snapshot, 'nominalGdpUsdBillions');
  const balancePct = ratio(balance, gdp);
  const forces = measured(snapshot, 'forces') ?? finite(snapshot.military.formationCount);
  // This is the accounted mobilization measurement, never object count ×
  // guessed manpower. Account and map entries must not be added twice.
  const mobilized = measured(snapshot, 'mobilized') ?? finite(snapshot.military.mobilized);
  const tension = measured(snapshot, 'socialTension');
  const stability = measured(snapshot, 'stability');
  return {
    salience: governmentSalienceContext(snapshot),
    deficits: [], factions: [], reserves: [], buildable: [], currencyId: '',
    budget: { balance: String(balance ?? NaN), unit: 'mld USD/mese', effectiveTaxRatePct: finite(account?.taxRatePct) ?? NaN },
    debt: { ratioPct: measured(snapshot, 'debtRatioPct') ?? NaN, servicePct: measured(snapshot, 'debtServicePct') ?? NaN },
    ...(balancePct !== undefined ? { cashFlow: {
      balancePct, balance: String(balance), unit: 'mld USD/mese',
      revenuePct: ratio(measured(snapshot, 'revenue'), gdp) ?? NaN,
    } } : {}),
    ...(forces !== undefined || mobilized !== undefined ? { defence: {
      burdenPct: finite(account?.defenceBurdenPct) ?? NaN,
      forces: forces ?? NaN, mobilized: mobilized ?? NaN, factionSatisfaction: null,
    } } : {}),
    ...(tension !== undefined ? { education: { burdenPct: NaN, universities: finite(account?.universities) ?? NaN, socialTension: tension } } : {}),
    ...(stability !== undefined ? { health: { socialBurdenPct: NaN, population: measured(snapshot, 'population') ?? NaN, stability } } : {}),
  };
}
