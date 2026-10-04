/**
 * Server-side, pure read model of the current game's verified reality.
 * National capacity is NOT an infrastructure inventory. In particular, neither
 * account.ports nor operational legacy shipyards create a port on the map.
 * null means unavailable; [] means an available inventory has no entries.
 * Presentation lives in facts; raw engine numbers are copied without rounding.
 */
import { formatGovernmentNumber, type GovernmentNumberKind } from './GovernmentNumberFormat';
import { coastalFromGeojson } from '../simulation/NationCapacity';
import { canonicalAssetKind } from '../simulation/CanonicalAssetTypes';
import { debtOf, type MaterialNeeds, type ResourceStock } from '../simulation/MaterialEconomy';
import { equipmentById } from '../simulation/MilitaryIndustry';
import { addDays, daysBetween } from '../simulation/calendar';
import { SITUATION_FOLLOW_UP_DAYS } from './GovernmentSituations';
import type { NationalAccount } from '../simulation/WorldStateEngine';
import type { Commitment } from '../simulation/Commitments';
import type { MilitaryPersonnelState } from '../simulation/PersonnelStock';
import type { ActionRecord } from '../../game-session';
import type { TurnResultRecord } from '../../game/TimelineService';
import type { OperationalObjectRow } from '../../repositories/operational-object.repository';

export interface VerifiedMapObject {
  id?: string;
  name?: string;
  type?: string;
  owner?: string;
  level?: number;
  formations?: number;
  personnel?: number;
  equipment?: Record<string, number>;
  monthlyNeeds?: { fuel: number; food: number; weapons: number };
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface VerifiedMapRegion {
  id: string;
  name: string;
  owner: string;
  coastal?: boolean;
  geojson?: string | null;
  borders?: string[];
  objects?: VerifiedMapObject[];
}

/** Typed subset of GameDataService.build(), not a new engine state. */
export interface VerifiedWorldGameData {
  id: string;
  currentDate?: string;
  currentTurn?: number;
  playerPolityId: string;
  playerPolityName?: string;
  polityNames?: Record<string, string>;
  world?: { regions?: Record<string, VerifiedMapRegion> };
  worldState?: {
    accounts?: Record<string, Partial<NationalAccount>>;
    resources?: {
      stock?: Partial<ResourceStock>;
      account?: Partial<NationalAccount>;
      natural?: unknown;
      debt?: number;
      needs?: Partial<MaterialNeeds>;
    };
    arsenal?: { units?: Record<string, number> };
    production?: VerifiedProject[];
  };
  relationships?: Record<string, Record<string, string>> | null;
  actions?: ActionRecord[];
  results?: TurnResultRecord[];
  ongoingProcesses?: VerifiedProject[];
}

export interface VerifiedProject {
  id: string;
  title?: string;
  name?: string;
  sourceActionId?: string;
  summary?: string;
  startedDate?: string;
  expectedDate?: string;
  progress?: number;
  progressNote?: string;
  quantity?: number;
  note?: string;
}

export interface VerifiedWorldFact {
  key: string;
  label: string;
  /** Human-readable Italian presentation, never written back to engine state. */
  value: string;
  rawValue: number | boolean | string | string[];
  source: 'world_map' | 'national_economy' | 'military_inventory' | 'diplomatic_registry';
  sourceRef: string;
}

export interface VerifiedMapAsset {
  /** No canonical ID/name is fabricated for anonymous map objects. */
  id: string | null;
  name: string | null;
  type: string;
  regionId: string;
  regionName: string;
  sourceRef: string;
  raw: VerifiedMapObject;
}

export interface VerifiedPolity { polityId: string; polityName: string | null }
export interface VerifiedRelation extends VerifiedPolity {
  relationship: string;
  sourceRef: string;
}
export interface VerifiedOperationalRecord {
  id: string;
  sourceRef: string;
  raw: Record<string, unknown>;
}
export interface VerifiedDecision {
  id: string;
  title: string;
  status: string;
  resolution?: string | null;
  resolvedDate?: string | null;
  createdTurn?: number;
}
export interface VerifiedReport {
  id: string;
  sourceDecisionId: string;
  sourceRef: string;
  label: string;
  dueDate: string;
  daysLeft: number;
  /** Current measured facts, not a claim that the decision caused a delta. */
  factKeys: string[];
}
export interface VerifiedRecentEvent {
  id: string | null;
  date: string | null;
  headline: string;
  detail: string | null;
  sourceRef: string;
  sourceActionIds: string[];
}
export interface VerifiedWorldDelta {
  key: string;
  before: number;
  after: number;
  delta: number;
  sourceRef: string;
  previousSourceRef: string;
}

export interface VerifiedWorldSnapshot {
  schemaVersion: 1;
  gameId: string;
  branchId: string | null;
  date: string | null;
  turn: number | null;
  polityId: string;
  polityName: string | null;
  geography: {
    ownedRegions: Array<{ id: string; name: string; coastal: boolean | null; sourceRef: string }>;
    /** Unknown when map flags/GeoJSON are missing, independent of port count. */
    coastal: boolean | null;
    landlocked: boolean | null;
    borderingPolities: VerifiedPolity[] | null;
  };
  infrastructure: {
    /** null: at least one owned region's object inventory is unavailable. */
    ports: VerifiedMapAsset[] | null;
    airfields: VerifiedMapAsset[] | null;
    railways: VerifiedMapAsset[] | null;
    roads: VerifiedMapAsset[] | null;
    factories: VerifiedMapAsset[] | null;
    constructionSites: VerifiedMapAsset[] | null;
    other: VerifiedMapAsset[] | null;
  };
  military: {
    formations: VerifiedMapAsset[];
    formationCount: number | null;
    mobilized: number | null;
    mobilizations: VerifiedMapAsset[];
    manpower: Partial<MilitaryPersonnelState> | null;
    equipment: Record<string, number> | null;
    navalUnits: Array<{ equipmentId: string | null; name: string | null; quantity: number; sourceRef: string }>;
    units: VerifiedOperationalRecord[];
    ships: VerifiedOperationalRecord[];
    fleets: VerifiedOperationalRecord[];
    fronts: VerifiedOperationalRecord[];
    locations: Array<{ id: string | null; regionId: string; regionName: string | null; sourceRef: string }>;
    readiness: Array<{ unitId: string; value: number }> | null;
    supply: { stock: Partial<ResourceStock> | null; monthlyNeeds: Partial<MaterialNeeds> | null };
  };
  economy: {
    treasury: number | null;
    monthlyBalance: number | null;
    debt: number | null;
    revenue: number | null;
    expenditure: number | null;
    foodCoverageMonths: number | null;
    resources: Partial<ResourceStock> | null;
    naturalResources: unknown;
    account: Partial<NationalAccount> | null;
    ongoingProjects: VerifiedProject[] | null;
  };
  diplomacy: {
    relations: VerifiedRelation[] | null;
    commitments: Commitment[] | null;
    /** Registered ally relationships, NOT inferred treaty terms. */
    alliances: VerifiedRelation[] | null;
    /** No dedicated canonical registries exist for these yet. */
    wars: null;
    sanctions: null;
    activeNegotiations: null;
  };
  recent: {
    events: VerifiedRecentEvent[];
    orders: ActionRecord[];
    consequences: TurnResultRecord[];
    decisions: VerifiedDecision[] | null;
    followUps: VerifiedReport[] | null;
  };
  changes: {
    available: boolean;
    reason: 'previous_snapshot_unavailable' | 'previous_snapshot_not_comparable' | null;
    previousDate: string | null;
    previousTurn: number | null;
    /** Numeric facts actually measured in both states, including zero deltas. */
    comparedKeys: string[];
    /** Missing comparisons are unknown, NOT unchanged. Military as a whole
     * is not established by comparing a few numeric account/unit fields. */
    unavailableKeys: string[];
    deltas: VerifiedWorldDelta[];
  };
  /** Missing facts are deliberately absent, never filled with invented zeros. */
  facts: Record<string, VerifiedWorldFact>;
  unavailable: string[];
}

export interface VerifiedWorldSnapshotInput {
  gameData: VerifiedWorldGameData;
  branchId?: string | null;
  /** Only rows already registered: do not invoke a lazy materializing getter. */
  operationalRows?: readonly OperationalObjectRow[] | null;
  commitments?: readonly Commitment[] | null;
  decisions?: readonly VerifiedDecision[] | null;
  /** Canonical engine coverage, including real operational material demand. */
  foodCoverageMonths?: number | null;
  /** Explicit real baseline; repeated reads are NOT previous-turn snapshots. */
  previousSnapshot?: VerifiedWorldSnapshot | null;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

function coast(region: VerifiedMapRegion): boolean | null {
  if (typeof region.coastal === 'boolean') return region.coastal;
  // The canonical helper returns false even for missing GeoJSON. Missing data
  // is NOT evidence of landlocked geography, so guard before calling it.
  return region.geojson && /"surface_type"\s*:\s*"[^"]+"/.test(region.geojson)
    ? coastalFromGeojson(region.id, region.geojson) : null;
}

/**
 * WS-GOV-REALITY-ADVISOR-HARDENING — gli asset usano la fonte unica
 * `canonicalAssetKind`; qui restano solo i tipi non-asset.
 */
const INFRASTRUCTURE_BUCKET: Readonly<Record<string, keyof VerifiedWorldSnapshot['infrastructure']>> = {
  port: 'ports', railway: 'railways', road: 'roads', airfield: 'airfields', factory: 'factories',
};
const OTHER_INFRASTRUCTURE_TYPES = new Set([
  'construction_site', 'infrastructure', 'university', 'power_plant', 'naval_base',
  'base', 'fortification', 'radar', 'missile_site',
  // Delivered assets use the actual facility IDs in simulation/facilities.json.
  'ft_mine', 'ft_farm', 'ft_school', 'ft_university', 'ft_hospital', 'ft_bridge',
  'ft_water', 'ft_power', 'ft_housing', 'ft_barracks', 'ft_fortification',
]);
function infrastructureBucket(type: string): keyof VerifiedWorldSnapshot['infrastructure'] | undefined {
  const kind = canonicalAssetKind(type);
  if (kind) return INFRASTRUCTURE_BUCKET[kind];
  return OTHER_INFRASTRUCTURE_TYPES.has(type) ? (type === 'construction_site' ? 'constructionSites' : 'other') : undefined;
}
const FORMATION_TYPES = new Set(['army', 'battalion', 'fleet', 'missile']);

export function buildVerifiedWorldSnapshot(input: VerifiedWorldSnapshotInput): VerifiedWorldSnapshot {
  // Detach every raw value so advancing the engine cannot alter a baseline.
  const game = structuredClone(input.gameData);
  const { playerPolityId: polityId } = game;
  const regions = game.world?.regions ?? {};
  const regionsById = new Map(Object.values(regions).map(region => [region.id, region]));
  const owned = Object.entries(regions).filter(([, region]) => region.owner === polityId)
    .sort(([a], [b]) => a.localeCompare(b));
  const ownedRegions = owned.map(([key, region]) => ({ id: region.id, name: region.name,
    coastal: coast(region), sourceRef: `world.regions.${key}` }));
  const coastal = ownedRegions.some(region => region.coastal === true) ? true
    : ownedRegions.length > 0 && ownedRegions.every(region => region.coastal === false) ? false : null;
  let bordersKnown = owned.length > 0;
  const neighbourIds = new Set<string>();
  for (const [, region] of owned) {
    if (!Array.isArray(region.borders)) { bordersKnown = false; continue; }
    for (const id of region.borders) {
      const neighbour = regions[id] ?? regionsById.get(id);
      if (!neighbour) { bordersKnown = false; continue; }
      if (neighbour.owner && neighbour.owner !== polityId && neighbour.owner !== 'neutral') neighbourIds.add(neighbour.owner);
    }
  }
  const mapInventoryKnown = game.world?.regions != null && owned.every(([, region]) => Array.isArray(region.objects));
  const inventory: Record<keyof VerifiedWorldSnapshot['infrastructure'], VerifiedMapAsset[]> = {
    ports: [], airfields: [], railways: [], roads: [], factories: [], constructionSites: [], other: [],
  };
  const formations: VerifiedMapAsset[] = [];
  const mobilizations: VerifiedMapAsset[] = [];
  for (const [key, region] of owned) {
    for (const [index, object] of (Array.isArray(region.objects) ? region.objects : []).entries()) {
      if (!object || (object.owner && object.owner !== polityId)) continue;
      const type = text(object.type);
      if (!type) continue;
      const meta = object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata) ? object.metadata as Record<string, unknown> : {};
      const status = text(object.status) ?? text(meta.status);
      // Planned/under-construction/destroyed assets are not usable inventory.
      if (status && ['planned', 'under_construction', 'destroyed', 'decommissioned', 'cancelled'].includes(status)) continue;
      const asset: VerifiedMapAsset = { id: text(object.id), name: text(object.name), type,
        regionId: region.id, regionName: region.name, sourceRef: `world.regions.${key}.objects.${index}`, raw: object };
      const category = infrastructureBucket(type);
      if (category) inventory[category].push(asset);
      if (FORMATION_TYPES.has(type)) formations.push(asset);
      if (type === 'mobilization') mobilizations.push(asset);
    }
  }

  const infrastructure = Object.fromEntries(Object.entries(inventory).map(([key, assets]) =>
    [key, mapInventoryKnown ? assets : null])) as VerifiedWorldSnapshot['infrastructure'];
  const account = game.worldState?.accounts?.[polityId] ?? game.worldState?.resources?.account ?? null;
  const resourceData = game.worldState?.resources;
  const stock = resourceData?.stock ?? null;
  const needs = resourceData?.needs ?? null;
  const equipment = game.worldState?.arsenal?.units ?? null;
  const food = finite(stock?.food);
  const foodNeed = finite(needs?.food);
  const foodCoverageMonths = input.foodCoverageMonths !== undefined ? finite(input.foodCoverageMonths)
    : food !== null && foodNeed !== null && foodNeed > 0 ? food / foodNeed : null;
  // debtOf is the canonical engine calculation. GameData's presentation debt
  // is rounded further; prefer the real debt portfolio whenever available.
  const debt = stock && finite(stock.money) !== null && Array.isArray(stock.debts)
    ? debtOf(stock as ResourceStock) : finite(resourceData?.debt);

  const rows = structuredClone(input.operationalRows ?? []);
  const records = (kind: OperationalObjectRow['kind'], predicate: (data: Record<string, unknown>) => boolean = () => true) =>
    rows.filter(row => row.kind === kind && predicate(row.data)).map(row => ({ id: row.id,
      sourceRef: `operational_objects.${row.kind}.${row.id}`, raw: row.data }));
  // Unit nationality is registered, not inferred from the current province.
  const units = records('unit', data => data.polityId === polityId);
  const fronts = records('front', data => data.attackerPolityId === polityId || data.defenderPolityId === polityId);
  const isUnavailable = (data: Record<string, unknown>): boolean => {
    const meta = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {};
    const status = text(data.status) ?? text(meta.status);
    return Boolean(status && ['planned', 'under_construction', 'destroyed', 'decommissioned', 'cancelled'].includes(status));
  };
  const ships = records('ship', data => (!data.polityId || data.polityId === polityId) && !isUnavailable(data));
  const shipIds = new Set(ships.map(ship => ship.id));
  // An empty fleet container (no registered ships) is not a deployable navy.
  const fleets = records('fleet', data => (!data.polityId || data.polityId === polityId)
    && Array.isArray(data.shipIds) && (data.shipIds as unknown[]).some(id => shipIds.has(String(id))));
  const personnel = rows.find(row => row.kind === 'personnel' && row.id === polityId);
  const navalUnits: VerifiedWorldSnapshot['military']['navalUnits'] = [
    ...Object.entries(equipment ?? {}).flatMap(([equipmentId, quantity]) => {
      const entry = equipmentById(equipmentId);
      return entry?.domain === 'mare' && finite(quantity) !== null && quantity > 0
        ? [{ equipmentId, name: entry.name, quantity, sourceRef: `worldState.arsenal.units.${equipmentId}` }] : [];
    }),
    // Registered ships live outside the depot: materialization transfers the
    // hull out of the arsenal, so an empty depot is not proof of no navy.
    ...ships.map(ship => ({ equipmentId: text(ship.raw.equipmentId), name: text(ship.raw.name), quantity: 1, sourceRef: ship.sourceRef })),
  ];
  const relations: VerifiedRelation[] | null = game.relationships == null ? null
    : Object.entries(game.relationships[polityId] ?? {}).filter(([id]) => id !== polityId)
      .map(([id, relationship]) => ({ polityId: id, polityName: game.polityNames?.[id] ?? null,
        relationship, sourceRef: `relationships.${polityId}.${id}` }));
  const commitments = input.commitments == null ? null : structuredClone(input.commitments.filter(commitment =>
    commitment.actor === polityId || commitment.counterparty === polityId
      || commitment.actor === 'PLAYER' || commitment.counterparty === 'PLAYER'));
  const results = (game.results ?? []).sort((a, b) => a.turn - b.turn || (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id)).slice(-8);
  const events = results.flatMap<VerifiedRecentEvent>(result => result.timelineEvents?.length
    ? result.timelineEvents.map(event => ({ id: event.id, date: event.date || result.date || null,
      headline: event.headline, detail: event.detail, sourceActionIds: event.sourceActionIds ?? [], sourceRef: `results.${result.id}.timelineEvents.${event.id}` }))
    : result.events.map((headline, index) => ({ id: null, date: result.date ?? null, headline,
      detail: result.narration || null, sourceActionIds: [], sourceRef: `results.${result.id}.events.${index}` })));
  const recordedDecisions = input.decisions == null ? null : structuredClone(input.decisions.filter(decision => decision.status !== 'active'))
    .sort((a, b) => (a.resolvedDate ?? '').localeCompare(b.resolvedDate ?? '') || (a.createdTurn ?? 0) - (b.createdTurn ?? 0) || a.id.localeCompare(b.id));
  const decisions = recordedDecisions?.slice(-8) ?? null;

  const snapshot: VerifiedWorldSnapshot = {
    schemaVersion: 1, gameId: game.id, branchId: input.branchId ?? null,
    date: game.currentDate ?? null, turn: finite(game.currentTurn), polityId, polityName: game.playerPolityName ?? game.polityNames?.[polityId] ?? null,
    geography: { ownedRegions, coastal, landlocked: coastal === null ? null : !coastal,
      borderingPolities: bordersKnown ? [...neighbourIds].sort().map(id => ({ polityId: id, polityName: game.polityNames?.[id] ?? null })) : null },
    infrastructure,
    military: { formations, formationCount: finite(account?.forces), mobilized: finite(account?.mobilized), mobilizations,
      manpower: personnel ? personnel.data as Partial<MilitaryPersonnelState> : null,
      equipment, navalUnits, units, ships, fleets, fronts,
      locations: [
        ...formations.map(asset => ({ id: asset.id, regionId: asset.regionId, regionName: asset.regionName, sourceRef: asset.sourceRef })),
        ...[...units, ...ships].flatMap(record => text(record.raw.regionId) ? [{ id: record.id,
          regionId: record.raw.regionId as string, regionName: text(record.raw.regionName) ?? regionsById.get(record.raw.regionId as string)?.name ?? null,
          sourceRef: record.sourceRef }] : []),
      ],
      readiness: input.operationalRows == null ? null : units.flatMap(unit => finite(unit.raw.readiness) !== null
        ? [{ unitId: unit.id, value: unit.raw.readiness as number }] : []),
      supply: { stock, monthlyNeeds: needs },
    },
    economy: { treasury: finite(stock?.money), monthlyBalance: finite(account?.monthlyBalance), debt,
      revenue: finite(account?.monthlyRevenue), expenditure: finite(account?.monthlyExpenses), foodCoverageMonths,
      resources: stock, naturalResources: resourceData?.natural ?? null, account,
      ongoingProjects: game.ongoingProcesses || game.worldState?.production
        ? [...(game.ongoingProcesses ?? []), ...(game.worldState?.production ?? [])] : null },
    diplomacy: { relations, commitments, alliances: relations?.filter(relation => relation.relationship === 'ally') ?? null,
      wars: null, sanctions: null, activeNegotiations: null },
    recent: { events, orders: (game.actions ?? []).sort((a, b) => a.turn - b.turn || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-12),
      consequences: results, decisions, followUps: null },
    changes: { available: false, reason: 'previous_snapshot_unavailable', previousDate: null, previousTurn: null,
      comparedKeys: [], unavailableKeys: [], deltas: [] },
    facts: {}, unavailable: ['diplomacy.wars', 'diplomacy.sanctions', 'diplomacy.activeNegotiations'],
  };
  const fact = (key: string, label: string, rawValue: VerifiedWorldFact['rawValue'], value: string,
    source: VerifiedWorldFact['source'], sourceRef: string) => {
    snapshot.facts[key] = { key, label, rawValue, value, source, sourceRef };
  };
  const numberFact = (key: string, label: string, value: number | null, kind: GovernmentNumberKind, unit: string, sourceRef: string) => {
    if (value !== null) fact(key, label, value, `${formatGovernmentNumber(value, kind)}${unit}`, 'national_economy', sourceRef);
    else snapshot.unavailable.push(key);
  };
  numberFact('treasury', 'Tesoreria', snapshot.economy.treasury, 'money', ' mld USD', 'worldState.resources.stock.money');
  numberFact('monthlyBalance', 'Saldo mensile', snapshot.economy.monthlyBalance, 'money', ' mld USD/mese', `worldState.accounts.${polityId}.monthlyBalance`);
  numberFact('debt', 'Debito', debt, 'money', ' mld USD', 'worldState.resources.stock.debts+overdraft');
  numberFact('revenue', 'Entrate mensili', snapshot.economy.revenue, 'money', ' mld USD/mese', `worldState.accounts.${polityId}.monthlyRevenue`);
  numberFact('expenditure', 'Spese mensili', snapshot.economy.expenditure, 'money', ' mld USD/mese', `worldState.accounts.${polityId}.monthlyExpenses`);
  numberFact('foodCoverageMonths', 'Copertura alimentare', foodCoverageMonths, 'percent', ' mesi', input.foodCoverageMonths !== undefined
    ? 'national_economy.foodCoverageMonths' : 'worldState.resources.stock.food/worldState.resources.needs.food');
  numberFact('socialTension', 'Tensione sociale', finite(account?.socialTension), 'percent', ' / 100', `worldState.accounts.${polityId}.socialTension`);
  numberFact('stability', 'Stabilità', finite(account?.stability), 'percent', ' / 100', `worldState.accounts.${polityId}.stability`);
  numberFact('population', 'Popolazione', finite(account?.population), 'integer', ' abitanti', `worldState.accounts.${polityId}.population`);
  for (const [key, assets] of Object.entries(infrastructure)) {
    if (assets === null) { snapshot.unavailable.push(`infrastructure.${key}`); continue; }
    const labels: Record<string, [string, string]> = {
      ports: ['Porti posseduti', 'nessuno'], airfields: ['Basi aeree possedute', 'nessuna'],
      railways: ['Ferrovie possedute', 'nessuna'], roads: ['Strade possedute', 'nessuna'],
      factories: ['Fabbriche possedute', 'nessuna'], constructionSites: ['Cantieri posseduti', 'nessuno'],
      other: ['Altre infrastrutture registrate', 'nessuna'],
    };
    const [label, absent] = labels[key];
    fact(key, label, assets.map(asset => asset.id ?? asset.sourceRef), `${label}: ${assets.length ? assets.map(asset => `${asset.name ?? asset.type} (${asset.regionName})`).join('; ') : absent}`,
      'world_map', `infrastructure.${key}`);
  }
  if (coastal !== null) {
    fact('coastal', 'Accesso al mare', coastal, coastal ? 'Costa verificata nella mappa' : 'Nessuna costa nella mappa', 'world_map', 'geography.ownedRegions.coastal');
    fact('landlocked', 'Paese senza accesso al mare', !coastal, coastal ? 'No' : 'Sì', 'world_map', 'geography.ownedRegions.coastal');
  } else snapshot.unavailable.push('geography.coastal', 'geography.landlocked');
  for (const [key, label] of Object.entries({ food: 'Scorte alimentari', clothing: 'Vestiario', weapons: 'Armamenti', fuel: 'Carburante', research: 'Ricerca' })) {
    numberFact(`resources.${key}`, label, finite(stock?.[key as keyof ResourceStock]), 'money', ' (indice del motore)', `worldState.resources.stock.${key}`);
  }
  for (const unit of units) {
    const readiness = finite(unit.raw.readiness);
    const personnel = finite(unit.raw.personnel);
    if (readiness !== null) fact(`military.units.${unit.id}.readiness`, `Prontezza: ${text(unit.raw.name) ?? unit.id}`, readiness,
      `${formatGovernmentNumber(readiness * 100, 'percent')}%`, 'military_inventory', `${unit.sourceRef}.readiness`);
    if (personnel !== null) fact(`military.units.${unit.id}.personnel`, `Personale: ${text(unit.raw.name) ?? unit.id}`, personnel,
      `${formatGovernmentNumber(personnel, 'integer')} uomini`, 'military_inventory', `${unit.sourceRef}.personnel`);
  }
  const mapFleets = formations.filter(asset => asset.type === 'fleet');
  const navalLabels = [
    ...navalUnits.map(unit => `${unit.name ?? unit.equipmentId ?? unit.sourceRef}: ${formatGovernmentNumber(unit.quantity, 'integer')}`),
    ...mapFleets.map(asset => `${asset.name ?? 'Flotta registrata'} (${asset.regionName})`),
  ];
  fact('navalUnits', 'Unità navali registrate', [...navalUnits.map(unit => unit.equipmentId ?? unit.sourceRef), ...mapFleets.map(asset => asset.id ?? asset.sourceRef)],
    `Unità navali registrate: ${navalLabels.length ? navalLabels.join('; ') : 'nessuna'}`,
    'military_inventory', 'military.navalUnits+military.formations');
  if (!mapInventoryKnown) snapshot.unavailable.push('military.formations', 'military.mobilizations');
  if (input.operationalRows == null) snapshot.unavailable.push('military.operationalObjects');
  if (equipment === null) snapshot.unavailable.push('military.equipment');
  // An empty depot alone cannot prove absence: fleets may live on the map,
  // or ships in the operational registry. Positive registered units remain facts.
  if (!navalLabels.length && (!mapInventoryKnown || input.operationalRows == null || equipment === null)) {
    delete snapshot.facts.navalUnits;
    snapshot.unavailable.push('military.navalUnits');
  }
  if (snapshot.diplomacy.commitments === null) snapshot.unavailable.push('diplomacy.commitments');
  if (relations === null) snapshot.unavailable.push('diplomacy.relations');

  // Legacy decisions remain recorded history/reports, never quest options.
  snapshot.recent.followUps = recordedDecisions === null ? null : recordedDecisions.flatMap(decision => {
    // An expired/unresolved Pressure is not a report that arrived: only a
    // resolved decision has a follow-up window to read.
    if (decision.status !== 'resolved' || !decision.resolvedDate || !snapshot.date) return [];
    let dueDate: string;
    try { dueDate = addDays(decision.resolvedDate, SITUATION_FOLLOW_UP_DAYS); }
    catch { snapshot.unavailable.push(`recent.followUps.${decision.id}`); return []; }
    const daysLeft = snapshot.date >= dueDate ? -daysBetween(dueDate, snapshot.date) : daysBetween(snapshot.date, dueDate);
    return daysLeft <= 0 ? [{ id: `follow-up:${decision.id}`, sourceDecisionId: decision.id,
      sourceRef: `decisions.${decision.id}`, label: decision.resolution ?? decision.title, dueDate, daysLeft,
      factKeys: ['treasury', 'foodCoverageMonths', 'socialTension', 'monthlyBalance'].filter(key => key in snapshot.facts) }] : [];
  }).slice(-8);

  const previous = input.previousSnapshot;
  if (previous) {
    const comparable = previous.gameId === snapshot.gameId && previous.polityId === polityId && previous.branchId === snapshot.branchId
      && previous.turn !== null && snapshot.turn !== null && Number.isInteger(previous.turn) && Number.isInteger(snapshot.turn)
      && previous.turn === snapshot.turn - 1
      && previous.date !== null && snapshot.date !== null && previous.date < snapshot.date;
    snapshot.changes.reason = comparable ? null : 'previous_snapshot_not_comparable';
    if (comparable) {
      snapshot.changes.available = true;
      snapshot.changes.previousDate = previous.date;
      snapshot.changes.previousTurn = previous.turn;
      for (const [key, current] of Object.entries(snapshot.facts)) {
        const before = finite(previous.facts[key]?.rawValue);
        const after = finite(current.rawValue);
        if (before !== null && after !== null) {
          snapshot.changes.comparedKeys.push(key);
          if (before !== after) snapshot.changes.deltas.push({ key, before, after, delta: after - before,
            sourceRef: current.sourceRef, previousSourceRef: previous.facts[key].sourceRef });
        }
      }
    }
  }
  // No overall military comparison is performed here. Never interpret an
  // available economic baseline or an empty delta list as an unchanged military.
  const comparisonKeys = new Set(['treasury', 'monthlyBalance', 'foodCoverageMonths', 'socialTension', 'military',
    ...Object.entries(snapshot.facts).filter(([, fact]) => finite(fact.rawValue) !== null).map(([key]) => key)]);
  snapshot.changes.unavailableKeys = [...comparisonKeys].filter(key => !snapshot.changes.comparedKeys.includes(key));
  if (!snapshot.changes.available) snapshot.unavailable.push('changes');
  return snapshot;
}
