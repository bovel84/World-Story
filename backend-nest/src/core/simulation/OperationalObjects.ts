/**
 * World Story — OP-OBJECTS: oggetti operativi concreti
 * ====================================================
 *
 * Il giocatore non governa «10 fabbriche» e «84.000 uomini»: governa
 * un'**Acciaieria**, una **1ª Armata**, una **Fregata**, un **cantiere con due
 * scafi in costruzione**. Questo modulo trasforma gli aggregati del motore in
 * **oggetti concreti** con la stessa grammatica ovunque:
 *
 *     STATO · CAPACITÀ · PERSONALE · INPUT · OUTPUT · COSTI · AUTONOMIA · PROBLEMI · AZIONI
 *
 * Regole di ingaggio:
 *  - **nessuna seconda simulazione**: tutto è funzione pura di fatti che il
 *    motore già pubblica (conti nazionali, manpower, copertura, prontezza,
 *    capacità industriale, magazzino, giacimenti, progetti, ordini);
 *  - **i numeri vengono dal motore**: dove un valore non esiste già (contributo
 *    di un giacimento, produzione marginale di un impianto) si richiamano le
 *    funzioni del motore (`advanceStock`, `materialNeeds`,
 *    `projectAllocation`, `militaryManpower`, `equipmentCoverage`,
 *    `militaryReadiness`, `WorldStateEngine.accounts`) su un profilo minimo;
 *  - **attribuzioni dichiarate**: dove il motore non distingue il singolo
 *    oggetto (quale reparto possiede quale fucile) l'attribuzione è una
 *    **convenzione dichiarata e spiegata** (`why`): la somma delle parti resta
 *    il totale del motore.
 *
 * Nessun I/O, nessun LLM, nessun `Math.random`: stessi ingressi ⇒ stessi oggetti.
 */

import {
  equipmentCoverage, establishmentFor, individualWeaponShareFor, militaryManpower, militaryReadiness,
  MILITARY_EPOCH_LABEL, MOBILITY_EQUIPMENT_ID,
  type EquipmentCategoryId, type EquipmentCoverage, type EstablishmentCategory, type MilitaryEpoch,
  type MilitaryManpower, type MilitaryReadiness, type ReadinessTone,
} from './MilitaryDoctrine';
import {
  EQUIPMENT_CATALOG, EQUIPMENT_CREW, equipmentById, equipmentStrength,
  NATURAL_RESOURCE_LABELS, type NaturalEndowment, type NaturalResourceKind,
} from './MilitaryIndustry';
import {
  CAPACITY_PER_FACTORY, CAPACITY_PER_PORT, CAPACITY_PER_UNIVERSITY, projectAllocation,
  type IndustrialAllocation, type IndustrialCapacity, type IndustrialMaintenanceInput, type IndustrialProjectInput,
} from './IndustrialCapacity';
import {
  advanceStock, civilMaterialNeeds, financePurchase, materialNeeds, type MaterialNeeds, type ResourceStock,
} from './MaterialEconomy';
import {
  personnelOverlay, transferMenToArmy, type MilitaryPersonnelState,
} from './PersonnelStock';
import {
  WorldStateEngine,
  type NationalAccount, type WorldStateOptions, type WorldStateRegion,
} from './WorldStateEngine';
import { daysBetween } from './calendar';

// ── 1. La grammatica universale ─────────────────────────────────────────────

export type OperatingKind = 'force' | 'army' | 'unit' | 'front' | 'facility' | 'construction' | 'navy' | 'fleet' | 'ship' | 'mine';

export type OperatingStatus =
  | 'operational' | 'degraded' | 'maintenance' | 'idle' | 'under_construction' | 'critical';

export const OPERATING_STATUS_LABEL: Record<OperatingStatus, string> = {
  operational: 'Operativa',
  degraded: 'Affaticata',
  maintenance: 'In manutenzione',
  idle: 'Ferma',
  under_construction: 'In costruzione',
  critical: 'Critica',
};

/** Le sezioni della grammatica, sempre nello stesso ordine. */
export type FactSection = 'stato' | 'capacita' | 'personale' | 'input' | 'output' | 'costi' | 'autonomia';

export const FACT_SECTION_LABEL: Record<FactSection, string> = {
  stato: 'Stato',
  capacita: 'Capacità',
  personale: 'Personale',
  input: 'Input',
  output: 'Output',
  costi: 'Costi',
  autonomia: 'Autonomia',
};

export type FactUnit = 'numero' | 'pct' | 'mld' | 'mln' | 'per_mese' | 'mesi' | 'data' | 'testo';

export interface OperatingFact {
  section: FactSection;
  label: string;
  /** Valore numerico; `null` quando il fatto è solo descrittivo (`testo`). */
  value: number | null;
  unit: FactUnit;
  text?: string | null;
  tone?: ReadinessTone;
}

export interface OperatingProblem {
  severity: 'critical' | 'warning';
  label: string;
  detail?: string | null;
}

export interface OperatingAction {
  /** Azione del motore che la UI può davvero eseguire. */
  id: 'raise_formation' | 'procure' | 'trade'
    | 'reinforce_unit' | 'reequip_unit' | 'reconstitute_unit' | 'transfer_unit' | 'reassign_unit'
    | 'order_attack' | 'order_defend' | 'order_reserve' | 'order_withdraw';
  label: string;
  enabled: boolean;
  blockedReason?: string | null;
}

export interface OperatingObject {
  id: string;
  kind: OperatingKind;
  label: string;
  subtitle?: string | null;
  status: OperatingStatus;
  statusLabel: string;
  /** Oggetto contenitore (nave → flotta → marina). */
  parentId?: string | null;
  regionId?: string | null;
  regionName?: string | null;
  facts: OperatingFact[];
  problems: OperatingProblem[];
  actions: OperatingAction[];
  /** Spiegazione lunga (sotto «Perché?»): da dove vengono i numeri. */
  why?: string | null;
}

export interface OperatingChainStep {
  label: string;
  value: number;
  unit: FactUnit;
  tone: ReadinessTone;
  detail?: string | null;
}

export interface OperatingChain {
  id: string;
  label: string;
  steps: OperatingChainStep[];
  /** `true` quando un anello è a zero o in sofferenza: l'output finale cala. */
  broken: boolean;
  summary: string;
}

export interface OperatingPicture {
  objects: OperatingObject[];
  chains: OperatingChain[];
  counts: Record<OperatingKind, number>;
  /** Convenzioni di attribuzione applicate, leggibili nel Dossier. */
  conventions: string[];
}

export const fact = (
  section: FactSection, label: string, value: number | null, unit: FactUnit,
  tone?: ReadinessTone, text?: string | null,
): OperatingFact => ({ section, label, value, unit, tone, text: text ?? null });

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const positive = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const n = (value: number, decimals = 0) =>
  new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals }).format(value);

/**
 * Quota della popolazione che lavora nell'industria: **convenzione dichiarata**
 * per dare un *personale* agli impianti. Il numero di impianti è del motore;
 * la somma sugli impianti resta il totale nazionale (nessuna invenzione per
 * singolo stabilimento).
 */
/**
 * Addetti per linea di lavorazione: **convenzione dichiarata**. Il motore non
 * pubblica l'occupazione industriale, quindi la scheda di un impianto non può
 * ricavarla dal PIL senza inventare una cifra enorme (l'11% della popolazione
 * dava 900.000 addetti a una acciaieria). Meglio un numero per linea, plausibile
 * e dichiarato, che un aggregato nazionale spacciato per organico di stabilimento.
 */
export const STAFF_PER_LINE: Record<'factory' | 'shipyard' | 'university', number> = {
  factory: 900, shipyard: 1200, university: 600,
};

/** Addetti di una miniera: convenzione dichiarata, proporzionale al giacimento. */
export const STAFF_PER_MINE_POINT = 340;

/** Mesi di scorta che valgono «serbatoio pieno» (riusa la soglia operativa del motore). */
export const FULL_TANK_MONTHS = 3;

/** Massimo numero di navi rappresentate una per una; il resto resta nei conteggi. */
export const MAX_REPRESENTATIVE_SHIPS = 4;

/** Nomi dichiarati degli impianti: numerazione deterministica. */
const PLANT_NAME_POOL: Record<'factory' | 'shipyard' | 'university', string[]> = {
  factory: ['Acciaieria', 'Officine meccaniche', 'Stabilimento chimico', 'Fabbrica di armamenti', 'Polo industriale', 'Impianti siderurgici'],
  shipyard: ['Cantiere navale', 'Arsenale marittimo', 'Cantiere di riparazioni'],
  university: ['Università e politecnico', 'Istituto di ricerca applicata', 'Accademia tecnica'],
};

// ── 2. Produzione marginale di un impianto (funzioni del motore, scala minima) ─

const EMPTY_STOCK: ResourceStock = {
  money: 0, food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [], debts: [],
};

/**
 * Titolo breve di un'opera: la vista principale non deve contenere paragrafi.
 * Il titolo completo resta disponibile sotto «Perché?».
 */
export function shortTitle(title: string, max = 78): string {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}…`;
}

/**
 * Distribuzione degli ordini sugli impianti dello stesso tipo: ogni ordine va a
 * **un solo** impianto (a rotazione), così le schede non si contraddicono e la
 * somma delle lavorazioni resta quella nazionale. Convenzione dichiarata.
 */
export function plantOrders<T>(orders: readonly T[], index: number, plants: number): T[] {
  const total = Math.max(1, plants);
  return orders.filter((_, position) => position % total === index);
}

/**
 * Produzione **marginale** di un profilo di impianto, con la stessa funzione che
 * avanza il paese (`advanceStock`): `flow` è il saldo netto, quindi
 * `produzione = saldo + fabbisogno` — la stessa aritmetica del bilancio
 * materiale pubblicato dal motore. Nessuna formula riscritta.
 */
export function marginalProduction(
  plant: { factories?: number; ports?: number; universities?: number },
  endowment: NaturalEndowment = {},
  technologies: string[] = [],
): MaterialNeeds & { research: number } {
  const { flow, needs } = marginalPlant(plant, endowment, technologies);
  return {
    food: flow.food + needs.food,
    clothing: flow.clothing + needs.clothing,
    weapons: flow.weapons + needs.weapons,
    fuel: flow.fuel + needs.fuel,
    research: flow.research,
  };
}

/**
 * Un impianto del motore, separato in **quello che produce** e **quello che
 * consuma**: la scheda di un impianto ha bisogno di entrambe le voci, mentre
 * `marginalProduction` è la somma (effetto netto di un impianto in più).
 */
export function marginalPlant(
  plant: { factories?: number; ports?: number; universities?: number },
  endowment: NaturalEndowment = {},
  technologies: string[] = [],
): {
  /** Saldo netto dell'impianto (produce − consuma), come lo calcola il motore. */
  flow: Record<string, number>;
  /** Consumi dell'impianto, militari compresi (il pavimento dei materiali). */
  needs: Record<string, number>;
  /**
   * Produzione **lorda**: saldo + i soli consumi **civili/industriali**
   * dell'impianto. È la voce che sostituisce la formula nazionale: il
   * fabbisogno militare del profilo sintetico (il pavimento di 0,2 armamenti)
   * non è produzione di un impianto e non va sommato al lordo.
   */
  gross: Record<string, number>;
} {
  const account = {
    population: 0, forces: 0, mobilized: 0,
    factories: positive(plant.factories), ports: positive(plant.ports), universities: positive(plant.universities),
  } as NationalAccount;
  const tick = advanceStock({ ...EMPTY_STOCK, technologies }, account, 30, endowment);
  const needs = materialNeeds(account);
  const civil = civilMaterialNeeds(account);
  // Produzione **lorda**: lo stesso calcolo senza il fabbisogno militare del
  // profilo sintetico (il pavimento di 0,2 armamenti è consumo dell'esercito,
  // non produzione di un impianto). Non tocca `flow`/`needs`, che restano la
  // semantica di `marginalProduction`.
  const grossTick = advanceStock({ ...EMPTY_STOCK, technologies }, account, 30, endowment, undefined, undefined, {
    food: 0, clothing: 0, weapons: 0, fuel: 0,
  });
  const flow = {
    food: nonNegative(tick.flow.food), clothing: nonNegative(tick.flow.clothing),
    weapons: nonNegative(tick.flow.weapons), fuel: nonNegative(tick.flow.fuel),
    research: nonNegative(tick.flow.research),
  };
  return {
    flow,
    needs: {
      food: nonNegative(needs.food), clothing: nonNegative(needs.clothing),
      weapons: nonNegative(needs.weapons), fuel: nonNegative(needs.fuel),
    },
    gross: {
      food: nonNegative(grossTick.flow.food), clothing: nonNegative(grossTick.flow.clothing),
      weapons: nonNegative(grossTick.flow.weapons), fuel: nonNegative(grossTick.flow.fuel),
      research: nonNegative(grossTick.flow.research),
    },
  };
}

/** Risorse estratte dal paese: quelle che alimentano una catena industriale. */
const EXTRACTIVE: NaturalResourceKind[] = [
  'oil', 'gas', 'coal', 'iron', 'copper', 'bauxite', 'uranium', 'gold', 'diamonds',
  'lithium', 'rare_earths', 'timber',
];

/** Contributo di **una unità** di giacimento alla produzione nazionale. */
export function endowmentContribution(
  kind: NaturalResourceKind,
  technologies: string[] = [],
): Partial<MaterialNeeds> {
  const without = marginalProduction({ factories: 1 }, {}, technologies);
  const withOne = marginalProduction({ factories: 1 }, { [kind]: 1 }, technologies);
  const delta: Partial<MaterialNeeds> = {};
  for (const key of ['food', 'clothing', 'weapons', 'fuel'] as const) {
    const value = round2((withOne[key] ?? 0) - (without[key] ?? 0));
    if (value > 0) delta[key] = value;
  }
  return delta;
}

/** Come si legge il contributo di un giacimento. */
function contributionView(kind: NaturalResourceKind): { section: FactSection; label: string } {
  if (kind === 'oil' || kind === 'gas' || kind === 'uranium') return { section: 'output', label: 'Carburante' };
  if (kind === 'timber') return { section: 'output', label: 'Vestiario' };
  return { section: 'input', label: 'Acciaio e minerali per armamenti' };
}

// ── 3. Creazione di un reparto: piano e impatto (PRIMA → DOPO) ──────────────

/** Voce di catalogo rappresentativa di una categoria della dotazione. */
export const CATEGORY_EQUIPMENT: Record<EquipmentCategoryId, string> = {
  individualWeapons: 'fucili',
  armoredMobility: MOBILITY_EQUIPMENT_ID,
  supportWeapons: 'sam_corto',
  artillery: 'artiglieria',
  airSupport: 'caccia_3',
  navalSupport: 'pattugliatori',
  missiles: 'missili_corto',
  drones: 'droni_ricognizione',
};

export interface FormationItem {
  equipmentId: string;
  name: string;
  /** Pezzi richiesti per i reparti da formare (dottrina d'epoca). */
  required: number;
  available: number;
  consumed: number;
  missing: number;
  unitCostMln: number;
}

export interface FormationPlan {
  men: number;
  items: FormationItem[];
  riflesRequired: number;
  riflesAvailable: number;
  riflesMissing: number;
  /** Armi individuali **prese dal deposito** (0 se il deposito è vuoto). */
  riflesConsumed: number;
  /** Costo immediato del materiale preso dal deposito (mln USD). */
  initialCostMln: number;
  blocked: boolean;
  blockedReason: string | null;
  basis: string;
}

/**
 * Dotazione dei reparti da formare: stesse categorie e stesse formule della
 * copertura (`establishment` + quota d'epoca delle armi individuali). Un
 * reparto può nascere sotto-equipaggiato — la prontezza lo dirà — ma **non**
 * senza fucili.
 */
export function formationPlan(input: {
  epoch: MilitaryEpoch;
  units: Record<string, number>;
  establishment?: EstablishmentCategory[];
  formations?: number;
}): FormationPlan {
  const epoch = input.epoch;
  const formations = Math.max(1, Math.round(nonNegative(input.formations) || 1));
  const rifleShare = individualWeaponShareFor(epoch);
  const menPerFormation = militaryManpower({
    population: 0, formations: 1, mobilizedFormations: 0, epoch,
  }).menPerFormation;
  const categories = input.establishment ?? establishmentFor(epoch);
  const items: FormationItem[] = [];
  for (const category of categories) {
    const equipmentId = CATEGORY_EQUIPMENT[category.id];
    const equipment = equipmentById(equipmentId);
    if (!equipment) continue;
    const required = category.demand?.kind === 'personnel_share'
      ? Math.round(menPerFormation * rifleShare * formations)
      : Math.ceil((category.perFormation ?? 0) * formations);
    if (required <= 0) continue;
    const available = Math.max(0, Math.floor(nonNegative(input.units?.[equipmentId])));
    const consumed = Math.min(required, available);
    items.push({
      equipmentId,
      name: equipment.name,
      required,
      available,
      consumed,
      missing: Math.max(0, required - consumed),
      unitCostMln: equipment.costMln,
    });
  }
  const rifleId = CATEGORY_EQUIPMENT.individualWeapons;
  const rifles = items.find(item => item.equipmentId === rifleId);
  const riflesRequired = rifles?.required ?? 0;
  const riflesAvailable = rifles?.available ?? 0;
  const riflesMissing = rifles?.missing ?? 0;
  const riflesConsumed = rifles?.consumed ?? 0;
  const initialCostMln = round2(sum(items.map(item => item.consumed * item.unitCostMln)));
  const blocked = riflesRequired > 0 && riflesMissing > 0;
  return {
    men: Math.round(menPerFormation * formations),
    items,
    riflesRequired,
    riflesAvailable,
    riflesMissing,
    riflesConsumed,
    initialCostMln,
    blocked,
    blockedReason: blocked
      ? `Mancano ${n(riflesMissing)} armi individuali: un reparto non si forma senza fucili (${n(riflesAvailable)} in deposito su ${n(riflesRequired)}).`
      : null,
    basis: `Dottrina ${MILITARY_EPOCH_LABEL[epoch]}: ${n(menPerFormation)} uomini per reparto, armi individuali al ${round1(rifleShare * 100)}% degli uomini in armi; le altre categorie sono pezzi per reparto.`,
  };
}

export interface FormationSide {
  formations: number;
  activePersonnel: number;
  reservePersonnel: number;
  availableReserve: number;
  mobilizedPersonnel: number;
  fuelNeed: number;
  weaponsNeed: number;
  foodNeed: number;
  fuelMonths: number | null;
  readinessPct: number;
  individualCoveragePct: number;
  monthlyExpenses: number;
  monthlyBalance: number;
  defenceBurdenPct: number;
  stability: number;
  socialTension: number;
  monthlyMilitaryMld: number;
}

export interface FormationDelta {
  label: string;
  unit: FactUnit;
  before: number;
  after: number;
  tone: ReadinessTone;
}

export interface FormationImpact {
  plan: FormationPlan;
  armyId: string | null;
  armyName: string;
  targetRegionId: string;
  before: FormationSide;
  after: FormationSide;
  deltas: FormationDelta[];
  why: string;
}

/**
 * Impatto della creazione di reparti in una provincia: il «dopo» non è una
 * stima, si aggiunge l'oggetto `army` alla copia delle regioni e si richiamano
 * **le stesse funzioni del motore** (conti nazionali, manpower, fabbisogni,
 * copertura, prontezza).
 */
export function formationImpact(input: {
  epoch: MilitaryEpoch;
  account: NationalAccount;
  units: Record<string, number>;
  stock: ResourceStock;
  qualityIndex?: number;
  regions: WorldStateRegion[];
  options?: WorldStateOptions;
  targetRegionId: string;
  armyName: string;
  armyId?: string | null;
  formations?: number;
  /**
   * OP-OBJECTS PERSISTENT: equipaggiamento **del deposito**. La disponibilità
   * del piano è quella del magazzino (i pezzi già assegnati a un'altra armata
   * non si possono prendere); la copertura si misura sul totale nazionale, che
   * l'assegnazione non cambia. Assente ⇒ si usa `units` (partita legacy).
   */
  depot?: Record<string, number>;
  /**
   * OP-OBJECTS PERSISTENT: stato **reale** del personale militare. Con lo stock
   * la riserva si consuma (86.400 → 74.400); senza, resta la dottrina (legacy).
   */
  personnel?: MilitaryPersonnelState;
  /** Armi individuali già assegnate all'armata che riceve i reparti. */
  assignedRifles?: number;
}): FormationImpact {
  const epoch = input.epoch;
  const formationsToAdd = Math.max(1, Math.round(nonNegative(input.formations) || 1));
  const plan = formationPlan({ epoch, units: input.depot ?? input.units, formations: formationsToAdd });
  // L'equipaggiamento passa dal deposito all'armata: il **totale nazionale non
  // cambia**. Il «prima → dopo» della copertura si muove perché crescono i
  // reparti (la domanda), non perché sia sparito un pezzo.
  const afterUnits: Record<string, number> = { ...input.units };
  const formations = nonNegative(input.account.forces);
  const mobilizedFormations = nonNegative(input.account.mobilized);
  const population = nonNegative(input.account.population);

  const side = (
    extraFormations: number,
    units: Record<string, number>,
    account: NationalAccount,
    personnelState?: MilitaryPersonnelState | null,
  ): FormationSide => {
    const doctrine = militaryManpower({ population, formations: formations + extraFormations, mobilizedFormations, epoch });
    // Con lo stato persistente gli uomini sono quelli registrati: la riserva è
    // uno stock che si consuma, non un rapporto ricalcolato sulla dottrina.
    const manpower = personnelState ? personnelOverlay(personnelState, doctrine) : doctrine;
    const needs = materialNeeds(account);
    const coverage = equipmentCoverage({ units, manpower, epoch, ports: input.account.ports });
    const readiness = militaryReadiness({
      coverage,
      fuel: { stock: input.stock.fuel, need: needs.fuel },
      weapons: { stock: input.stock.weapons, need: needs.weapons },
      qualityIndex: input.qualityIndex ?? null,
      manpower,
    });
    const individual = coverage.find(row => row.category === 'individualWeapons');
    const militaryMld = nonNegative(account.nominalGdpUsdBillions) * nonNegative(account.defenceBurdenPct) / 100 / 12;
    return {
      formations: formations + extraFormations,
      activePersonnel: manpower.activePersonnel,
      reservePersonnel: manpower.reservePersonnel,
      availableReserve: manpower.availableReserve,
      mobilizedPersonnel: manpower.mobilizedPersonnel,
      // I fabbisogni militari sono piccoli per costruzione (0,004 per reparto):
      // tre decimali, altrimenti un incremento reale sparirebbe nell'arrotondamento.
      fuelNeed: round3(needs.fuel),
      weaponsNeed: round3(needs.weapons),
      foodNeed: round3(needs.food),
      fuelMonths: needs.fuel > 0 ? round1(input.stock.fuel / needs.fuel) : null,
      readinessPct: readiness.readinessPct,
      individualCoveragePct: individual ? individual.coveragePct : 0,
      // In miliardi con tre decimali: un paese piccolo spende milioni, e il
      // confronto PRIMA → DOPO deve mostrare la differenza reale.
      monthlyExpenses: round3(nonNegative(account.monthlyExpenses)),
      monthlyBalance: round3(Number(account.monthlyBalance) || 0),
      defenceBurdenPct: round1(nonNegative(account.defenceBurdenPct)),
      stability: Math.round(nonNegative(account.stability)),
      socialTension: Math.round(nonNegative(account.socialTension)),
      monthlyMilitaryMld: round3(militaryMld),
    };
  };

  const before = side(0, input.units, input.account, input.personnel);
  const withArmy: WorldStateRegion[] = input.regions.map(region => region.id === input.targetRegionId
    ? { ...region, objects: [...(region.objects || []), { type: 'army', level: formationsToAdd }] }
    : region);
  const projectedAccount = WorldStateEngine.accounts(withArmy, input.options || {})[input.account.polityId] || input.account;
  // Il «dopo» degli uomini: trasferimento reale dalla riserva (null ⇒ il piano
  // è bloccato e nulla si muove: nessun numero inventato).
  const afterPersonnel = input.personnel
    ? transferMenToArmy(
      input.personnel,
      plan.men,
      militaryManpower({ population, formations, mobilizedFormations, epoch }),
    ) ?? input.personnel
    : null;
  const after = side(formationsToAdd, afterUnits, projectedAccount, afterPersonnel);

  const tone = (beforeValue: number, afterValue: number, higherIsBetter: boolean): ReadinessTone => {
    if (afterValue === beforeValue) return 'neutral';
    const up = afterValue > beforeValue;
    return (higherIsBetter ? up : !up) ? 'positive' : 'warning';
  };
  const deltas: FormationDelta[] = [
    { label: 'Reparti', unit: 'numero', before: before.formations, after: after.formations, tone: 'neutral' },
    { label: 'Uomini in armi', unit: 'numero', before: before.activePersonnel, after: after.activePersonnel, tone: 'neutral' },
    { label: 'Riserva addestrata', unit: 'numero', before: before.reservePersonnel, after: after.reservePersonnel, tone: tone(before.reservePersonnel, after.reservePersonnel, true) },
    { label: 'Riservisti richiamabili', unit: 'numero', before: before.availableReserve, after: after.availableReserve, tone: tone(before.availableReserve, after.availableReserve, true) },
    { label: 'Copertura armi individuali', unit: 'pct', before: before.individualCoveragePct, after: after.individualCoveragePct, tone: tone(before.individualCoveragePct, after.individualCoveragePct, true) },
    { label: 'Pronto operativo', unit: 'pct', before: before.readinessPct, after: after.readinessPct, tone: tone(before.readinessPct, after.readinessPct, true) },
    { label: 'Carburante (scorte)', unit: 'mesi', before: before.fuelMonths ?? 0, after: after.fuelMonths ?? 0, tone: tone(before.fuelMonths ?? 0, after.fuelMonths ?? 0, true) },
    { label: 'Consumo carburante', unit: 'per_mese', before: before.fuelNeed, after: after.fuelNeed, tone: tone(before.fuelNeed, after.fuelNeed, false) },
    { label: 'Consumo armamenti', unit: 'per_mese', before: before.weaponsNeed, after: after.weaponsNeed, tone: tone(before.weaponsNeed, after.weaponsNeed, false) },
    // La quota di difesa pubblicata dal motore è arrotondata allo 0,1% del PIL:
    // per un solo reparto non si muove, quindi la riga non si mostra. Il costo
    // mensile reale si legge nelle spese dello Stato e nel saldo.
    { label: 'Spese dello Stato', unit: 'mld', before: before.monthlyExpenses, after: after.monthlyExpenses, tone: tone(before.monthlyExpenses, after.monthlyExpenses, false) },
    { label: 'Saldo mensile', unit: 'mld', before: before.monthlyBalance, after: after.monthlyBalance, tone: tone(before.monthlyBalance, after.monthlyBalance, true) },
    // OP-OBJECTS PERSISTENT: dove finiscono i pezzi. Il deposito cala, l'armata
    // cresce: il totale nazionale resta quello (`deposito + assegnato`). Se
    // l'azione è bloccata nulla si muove, quindi le righe non si mostrano.
    ...(input.depot && !plan.blocked
      ? [
        {
          label: 'Deposito armi individuali',
          unit: 'numero' as FactUnit,
          before: Math.max(0, Math.floor(nonNegative(input.depot[CATEGORY_EQUIPMENT.individualWeapons]))),
          after: Math.max(0, Math.floor(nonNegative(input.depot[CATEGORY_EQUIPMENT.individualWeapons]) - plan.riflesConsumed)),
          tone: 'neutral' as ReadinessTone,
        },
        {
          label: 'Armi individuali assegnate',
          unit: 'numero' as FactUnit,
          before: Math.max(0, Math.round(nonNegative(input.assignedRifles))),
          after: Math.max(0, Math.round(nonNegative(input.assignedRifles) + plan.riflesConsumed)),
          tone: 'neutral' as ReadinessTone,
        },
      ]
      : []),
  ];
  return {
    plan,
    armyId: input.armyId ?? null,
    armyName: input.armyName,
    targetRegionId: input.targetRegionId,
    before,
    after,
    deltas,
    why: `${plan.basis} L'equipaggiamento preso dal deposito è valorizzato al costo di costruzione del catalogo. Spese dello Stato e saldo del mese sono ricalcolati dal motore sulla nazione com'è, con i reparti in più: è lì che si legge il costo mensile del nuovo reparto. La quota di difesa pubblicata dal motore è arrotondata allo 0,1% del PIL e per un singolo reparto non cambia.`,
  };
}

/**
 * Applica il piano di formazione: prende l'equipaggiamento dal deposito e
 * paga il materiale con cassa e credito (la stessa funzione del commercio di
 * armi). Non tocca il mondo: l'oggetto `army` lo aggiunge il chiamante.
 */
export function applyFormationPlan(input: {
  plan: FormationPlan;
  units: Record<string, number>;
  stock: ResourceStock;
  account?: NationalAccount;
}):
  | { ok: true; units: Record<string, number>; stock: ResourceStock; spentMld: number; financedMln: number }
  | { ok: false; error: string } {
  const spentMld = input.plan.initialCostMln / 1000;
  const financing = financePurchase(input.stock, input.account, spentMld);
  if (!financing.ok) return { ok: false, error: 'credit_exhausted: cassa e credito insufficienti per formare il reparto' };
  const units: Record<string, number> = { ...input.units };
  for (const item of input.plan.items) {
    if (item.consumed <= 0) continue;
    units[item.equipmentId] = Math.max(0, (units[item.equipmentId] || 0) - item.consumed);
  }
  const stock: ResourceStock = { ...input.stock, money: round3(input.stock.money - spentMld) };
  return { ok: true, units, stock, spentMld: round3(spentMld), financedMln: Math.round(financing.debtUsed * 1000) };
}

// ── 4. Eserciti e reparti ───────────────────────────────────────────────────

export interface OperationalRegion {
  id: string;
  name: string;
  /** Polity che controlla la provincia: serve ai movimenti (P1-3). */
  owner?: string;
  population?: number;
  /** Indice di PIL della provincia: serve alla proiezione dei conti del motore. */
  gdp?: number;
  /** Potenza militare della provincia: idem. */
  militaryPower?: number;
  coastal?: boolean;
  /** Province confinanti (geografia della mappa): percorso dei movimenti. */
  borders?: string[];
  objects?: Array<{ id?: string; type?: string; name?: string; level?: number }>;
}

const FORMATION_OBJECT_TYPES = new Set(['army', 'battalion']);
const shareOf = (total: number, part: number, whole: number) => (whole > 0 ? total * (part / whole) : 0);

export interface ArmyShape {
  id: string;
  name: string;
  formations: number;
  regionId: string | null;
  regionName: string | null;
  /** Oggetto reale del mondo (non derivato). */
  objectId: string | null;
}

/**
 * Le armate: gli oggetti `army`/`battalion` **reali** del mondo più, se il
 * profilo del paese dichiara reparti senza nome sulla mappa, i «reparti di
 * guarnigione». La somma dei reparti è sempre `account.forces`.
 */
export function armyShapes(input: { polityId: string; regions: OperationalRegion[]; formations: number }): ArmyShape[] {
  const shapes: ArmyShape[] = [];
  for (const region of input.regions) {
    for (const object of region.objects || []) {
      if (!object || !FORMATION_OBJECT_TYPES.has(String(object.type))) continue;
      const level = Math.max(1, Math.round(nonNegative(object.level) || 1));
      const id = String(object.id || `${region.id}-${object.name || 'reparto'}`);
      shapes.push({
        id,
        name: String(object.name || 'Reparto'),
        formations: level,
        regionId: region.id,
        regionName: region.name,
        objectId: id,
      });
    }
  }
  const remainder = Math.max(0, Math.round(input.formations - sum(shapes.map(shape => shape.formations))));
  if (remainder > 0) {
    shapes.push({
      id: `${input.polityId}-garrison`,
      name: 'Reparti di guarnigione',
      formations: remainder,
      regionId: null,
      regionName: null,
      objectId: null,
    });
  }
  return shapes;
}

const armyStatus = (readinessPct: number): OperatingStatus =>
  readinessPct >= 65 ? 'operational' : readinessPct >= 35 ? 'degraded' : 'critical';

const readinessTone = (readiness: MilitaryReadiness): ReadinessTone =>
  readiness.status === 'critical' || readiness.status === 'fragile' ? 'critical'
    : readiness.status === 'healthy' ? 'positive' : 'warning';

function armyObject(input: {
  shape: ArmyShape;
  totalFormations: number;
  manpower: MilitaryManpower;
  coverage: EquipmentCoverage[];
  readiness: MilitaryReadiness;
  account: NationalAccount;
  needs: MaterialNeeds;
  stock: ResourceStock;
  plan: FormationPlan;
}): OperatingObject {
  const { shape, totalFormations, manpower, coverage, readiness, account, needs, stock, plan } = input;
  const share = totalFormations > 0 ? shape.formations / totalFormations : 0;
  const militaryMld = nonNegative(account.nominalGdpUsdBillions) * nonNegative(account.defenceBurdenPct) / 100 / 12;
  const fuelMonths = needs.fuel > 0 ? round1(stock.fuel / needs.fuel) : null;
  const facts: OperatingFact[] = [
    fact('stato', 'Reparti', shape.formations, 'numero'),
    fact('personale', 'Uomini', Math.round(shape.formations * manpower.menPerFormation), 'numero'),
    fact('capacita', 'Prontezza', readiness.readinessPct, 'pct', readinessTone(readiness)),
    fact('output', 'Potenza di combattimento attribuita', round1(nonNegative(account.militaryPower) * share), 'numero'),
    fact('input', 'Carburante', round3(needs.fuel * share), 'per_mese'),
    fact('input', 'Armamenti', round3(needs.weapons * share), 'per_mese'),
    fact('costi', 'Spesa militare attribuita', round2(militaryMld * share), 'mld'),
    fact('autonomia', 'Carburante (scorte nazionali)', fuelMonths, 'mesi',
      fuelMonths !== null && fuelMonths < FULL_TANK_MONTHS ? 'warning' : 'neutral'),
  ];
  for (const row of coverage) {
    const required = Math.round(row.required * share);
    const available = Math.min(required, Math.round(row.available * share));
    const ratio = required > 0 ? available / required : 1;
    facts.push(fact(
      'output', row.label, required > 0 ? round1(ratio * 100) : 100, 'pct',
      ratio >= 0.85 ? 'positive' : ratio >= 0.6 ? 'warning' : 'critical',
      `${n(available)} su ${n(required)} pezzi`,
    ));
  }
  const problems: OperatingProblem[] = [];
  for (const row of coverage) {
    const missing = Math.round(row.missing * share);
    if (missing <= 0) continue;
    problems.push({
      severity: row.coveragePct < 60 ? 'critical' : 'warning',
      label: `Mancano ${n(missing)} pezzi — ${row.label}`,
      detail: `Copertura nazionale ${round1(row.coveragePct)}%: la quota di questa armata è ${n(Math.round(row.required * share))} pezzi.`,
    });
  }
  if (fuelMonths !== null && fuelMonths < FULL_TANK_MONTHS) {
    problems.push({
      severity: fuelMonths < 1 ? 'critical' : 'warning',
      label: `Carburante ${round1(fuelMonths)} mesi`,
      detail: `Consumo di questa armata: ${round2(needs.fuel * share)}/mese.`,
    });
  }
  const topDriver = readiness.drivers.find(driver => driver.tone === 'critical');
  if (topDriver) problems.push({ severity: 'critical', label: topDriver.label, detail: topDriver.detail ?? null });
  return {
    id: shape.id,
    kind: 'army',
    label: shape.name,
    subtitle: shape.regionName ? `Dislocata in ${shape.regionName}` : 'Reparti dello schieramento nazionale',
    status: armyStatus(readiness.readinessPct),
    statusLabel: OPERATING_STATUS_LABEL[armyStatus(readiness.readinessPct)],
    parentId: 'force',
    regionId: shape.regionId,
    regionName: shape.regionName,
    facts,
    problems: problems.slice(0, 5),
    actions: [{
      id: 'raise_formation',
      label: 'Aggiungi 1 reparto a questa armata',
      enabled: !plan.blocked,
      blockedReason: plan.blocked ? plan.blockedReason : null,
    }],
    why: shape.objectId
      ? 'Armata reale del mondo: i reparti sono quelli dichiarati sulla mappa. Personale, prontezza ed equipaggiamento sono attribuiti in proporzione ai reparti; la somma sulle armate è il totale nazionale del motore.'
      : 'Reparti derivati dal profilo del paese (capacità di base): il motore non ha assegnato loro un nome sulla mappa, quindi il quadro li raggruppa. Personale e dotazioni sono attribuiti in proporzione ai reparti.',
  };
}

// ── 5. Impianti ─────────────────────────────────────────────────────────────

const orderedRegions = (regions: OperationalRegion[]): OperationalRegion[] =>
  [...regions].sort((a, b) => (nonNegative(b.population) - nonNegative(a.population)) || a.id.localeCompare(b.id));

const coastalFirst = (regions: OperationalRegion[]): OperationalRegion[] =>
  [...orderedRegions(regions)].sort((a, b) => Number(Boolean(b.coastal)) - Number(Boolean(a.coastal)));

function plantName(kind: 'factory' | 'shipyard' | 'university', index: number, regionName: string): string {
  const pool = PLANT_NAME_POOL[kind];
  return `${pool[index % pool.length]} ${regionName}`;
}

function projectRemainingMonths(project: IndustrialProjectInput, date: string): number | null {
  if (!project.expected_date) return null;
  const days = daysBetween(date, project.expected_date);
  return days > 0 ? Math.max(0, Math.round(days / 30)) : 0;
}

/**
 * Linee di lavorazione attribuite a un impianto: le lavorazioni riempiono gli
 * impianti **in ordine di elenco**, fino alle linee di ciascuno. `start` è la
 * posizione assoluta dell'impianto nella catena degli impianti (fabbriche,
 * cantieri, atenei) e `perPlant` le sue linee. Convenzione dichiarata: il
 * motore conosce la domanda totale, non la sua distribuzione fra stabilimenti.
 */
export function plantAllocatedLines(
  allocations: readonly IndustrialAllocation[],
  perPlant: number,
  start: number,
): number {
  const plantStart = start;
  const plantEnd = plantStart + perPlant;
  let cursor = 0;
  let overlap = 0;
  for (const allocation of allocations) {
    const from = cursor;
    const to = cursor + allocation.capacityDemand;
    overlap += Math.max(0, Math.min(to, plantEnd) - Math.max(from, plantStart));
    cursor = to;
  }
  return Math.max(0, Math.min(perPlant, Math.round(overlap)));
}

/** Posizione assoluta di ogni impianto nella catena delle linee. */
interface PlantSlot { kind: 'factory' | 'shipyard' | 'university'; perPlant: number; start: number; index: number }

function plantLayout(factories: number, ports: number, universities: number): PlantSlot[] {
  const slots: PlantSlot[] = [];
  let offset = 0;
  const push = (kind: PlantSlot['kind'], count: number, perPlant: number) => {
    for (let index = 0; index < count; index += 1) {
      slots.push({ kind, perPlant, start: offset, index });
      offset += perPlant;
    }
  };
  push('factory', factories, CAPACITY_PER_FACTORY);
  push('shipyard', ports, CAPACITY_PER_PORT);
  push('university', universities, CAPACITY_PER_UNIVERSITY);
  return slots;
}

// ── 6. Il quadro operativo ──────────────────────────────────────────────────

export interface MaterialBalanceLike {
  kind: 'food' | 'clothing' | 'weapons' | 'fuel';
  label: string;
  stock: number;
  capacity: number;
  productionPerMonth: number;
  consumptionPerMonth: number;
  balancePerMonth: number;
}

export interface IndustrialOrderLike {
  id: string;
  equipmentId: string;
  name: string;
  quantity: number;
  progress: number;
  status: string;
  expectedDate?: string | null;
  deliveredUnits?: number;
}

export interface NavalInventoryItem {
  equipmentId: string;
  name: string;
  category: string;
  quantity: number;
  crew: number;
  quality: number;
  strength: number;
}

export interface OperationalInput {
  polityId: string;
  epoch: MilitaryEpoch;
  date: string;
  account: NationalAccount;
  manpower: MilitaryManpower;
  coverage: EquipmentCoverage[];
  readiness: MilitaryReadiness;
  units: Record<string, number>;
  qualityIndex?: number;
  stock: ResourceStock;
  needs: MaterialNeeds;
  balance: MaterialBalanceLike[];
  capacity: IndustrialCapacity;
  orders: readonly IndustrialOrderLike[];
  projects: readonly IndustrialProjectInput[];
  maintenance: readonly IndustrialMaintenanceInput[];
  regions: OperationalRegion[];
  endowment: NaturalEndowment;
  technologies: string[];
  /**
   * OP-OBJECTS PERSISTENT: oggetti reali (armate, impianti, navi, flotte,
   * cantieri) che **sostituiscono** quelli derivati dagli aggregati. Assente ⇒
   * percorso legacy dichiarato (quote proporzionali dell'aggregato).
   */
  persistentObjects?: OperatingObject[];
}

/** Equipaggiamento navale presente nell'arsenale: le unità sono gli scafi. */
export function navalInventory(units: Record<string, number>): NavalInventoryItem[] {
  const items: NavalInventoryItem[] = [];
  for (const equipment of EQUIPMENT_CATALOG) {
    if (equipment.domain !== 'mare') continue;
    const quantity = Math.max(0, Math.floor(nonNegative(units[equipment.id])));
    if (quantity <= 0) continue;
    items.push({
      equipmentId: equipment.id,
      name: equipment.name,
      category: equipment.category,
      quantity,
      crew: Math.max(0, Math.round(nonNegative(EQUIPMENT_CREW[equipment.id]))),
      quality: equipment.quality,
      strength: equipmentStrength(equipment.id, quantity),
    });
  }
  return items;
}

export const navalShips = (units: Record<string, number>) => sum(navalInventory(units).map(item => item.quantity));
const navalCrew = (items: NavalInventoryItem[]) => Math.round(sum(items.map(item => item.quantity * item.crew)));

/** Il quadro operativo completo: oggetti concreti, catene, conteggi, convenzioni. */
export function operatingPicture(input: OperationalInput): OperatingPicture {
  const { account, manpower, coverage, readiness, units, stock, needs, capacity, epoch } = input;
  const regions = input.regions;
  const ordered = orderedRegions(regions);
  const coastal = coastalFirst(regions);
  const totalFormations = Math.max(0, Math.round(nonNegative(account.forces)));
  const plan = formationPlan({ epoch, units });
  const objects: OperatingObject[] = [];
  const conventions: string[] = [
    'Personale di un impianto: convenzione dichiarata del seed — 900 addetti per linea di fabbrica, 1.200 per linea di cantiere, 600 per linea di ricerca. Con gli oggetti persistenti gli addetti sono lo stato dell\'impianto; il motore non pubblica l\'occupazione industriale.',
    'Equipaggiamento per armata: attribuito in proporzione ai reparti (il motore non registra quale reparto possiede quale pezzo); la somma delle armate è il totale nazionale.',
    'Produzione e input di un impianto: contributo marginale calcolato dal motore (`advanceStock`) sullo stesso profilo, non una formula riscritta.',
    'Le navi rappresentate sono derivate dalle unità navali dell\'arsenale: il motore conta gli scafi per tipo, non i singoli esemplari.',
  ];

  // ── Forze armate (contenitore) ed eserciti ────────────────────────────────
  const armyShapesList = armyShapes({ polityId: input.polityId, regions, formations: totalFormations });
  objects.push(...armyShapesList.map(shape => armyObject({
    shape, totalFormations, manpower, coverage, readiness, account, needs, stock, plan,
  })));
  const fuelMonths = needs.fuel > 0 ? round1(stock.fuel / needs.fuel) : null;
  objects.push({
    id: 'force',
    kind: 'force',
    label: 'Forze armate',
    subtitle: `${n(totalFormations)} reparti · ${n(manpower.activePersonnel)} uomini in armi`,
    status: armyStatus(readiness.readinessPct),
    statusLabel: OPERATING_STATUS_LABEL[armyStatus(readiness.readinessPct)],
    parentId: null,
    regionId: null,
    regionName: null,
    facts: [
      fact('personale', 'Uomini in armi', manpower.activePersonnel + manpower.mobilizedPersonnel, 'numero'),
      fact('personale', 'Riserva addestrata', manpower.reservePersonnel, 'numero'),
      fact('personale', 'Riservisti richiamabili', manpower.availableReserve, 'numero'),
      fact('capacita', 'Prontezza', readiness.readinessPct, 'pct', readinessTone(readiness)),
      fact('input', 'Carburante', round3(needs.fuel), 'per_mese'),
      fact('input', 'Armamenti', round3(needs.weapons), 'per_mese'),
      fact('input', 'Cibo', round3(needs.food), 'per_mese'),
      fact('costi', 'Spesa militare', round2(nonNegative(account.nominalGdpUsdBillions) * nonNegative(account.defenceBurdenPct) / 100 / 12), 'mld'),
      fact('autonomia', 'Carburante (scorte)', fuelMonths, 'mesi',
        fuelMonths !== null && fuelMonths < FULL_TANK_MONTHS ? 'warning' : 'neutral'),
    ],
    problems: readiness.drivers
      .filter(driver => driver.tone !== 'positive')
      .slice(0, 4)
      .map(driver => ({ severity: driver.tone === 'critical' ? 'critical' as const : 'warning' as const, label: driver.label, detail: driver.detail ?? null })),
    actions: [{
      id: 'raise_formation',
      label: 'Crea 1 reparto',
      enabled: !plan.blocked,
      blockedReason: plan.blocked ? plan.blockedReason : null,
    }],
    why: plan.basis,
  });

  // ── Impianti ──────────────────────────────────────────────────────────────
  const factories = Math.max(0, Math.round(nonNegative(account.factories)));
  const ports = Math.max(0, Math.round(nonNegative(account.ports)));
  const universities = Math.max(0, Math.round(nonNegative(account.universities)));
  const totalLines = positive(capacity.total)
    || (factories * CAPACITY_PER_FACTORY + ports * CAPACITY_PER_PORT + universities * CAPACITY_PER_UNIVERSITY);
  const layout = plantLayout(factories, ports, universities);
  const slotLines = (kind: PlantSlot['kind'], index: number, allocations: readonly IndustrialAllocation[] = capacity.allocations) => {
    const slot = layout.find(item => item.kind === kind && item.index === index);
    return slot ? plantAllocatedLines(allocations, slot.perPlant, slot.start) : 0;
  };
  const staffOf = (kind: 'factory' | 'shipyard' | 'university', lines: number) =>
    Math.max(0, Math.round(nonNegative(lines) * STAFF_PER_LINE[kind]));
  const civilMonthlyMld = Math.max(0, round2(
    nonNegative(account.monthlyExpenses)
    - nonNegative(account.nominalGdpUsdBillions) * nonNegative(account.defenceBurdenPct) / 100 / 12,
  ));
  const civilCostOf = (lines: number) => (totalLines > 0 ? round2(civilMonthlyMld * (lines / totalLines)) : 0);

  const factoryProfile = marginalProduction({ factories: 1 }, input.endowment, input.technologies);
  const shipyardProfile = marginalProduction({ ports: 1 }, input.endowment, input.technologies);
  const universityProfile = marginalProduction({ universities: 1 }, input.endowment, input.technologies);
  const armsBonus = input.technologies.includes('industria_bellica') ? 1.4 : 1;
  const ironInput = round2(0.12 * armsBonus);
  const coalInput = round2(0.06 * armsBonus);

  const navalOrders = input.orders.filter(order =>
    equipmentById(order.equipmentId)?.domain === 'mare' && order.status === 'in_progress');
  const shipsUnderConstruction = Math.round(sum(navalOrders.map(order => Math.max(0, order.quantity - (order.deliveredUnits || 0)))));
  const landOrders = input.orders.filter(order =>
    order.status === 'in_progress' && equipmentById(order.equipmentId)?.domain !== 'mare');
  const inMaintenanceLines = capacity.byKind.maintenance;

  for (let index = 0; index < factories; index += 1) {
    const region = ordered.length > 0 ? ordered[index % ordered.length] : null;
    const lines = slotLines('factory', index);
    const util = round1(lines / CAPACITY_PER_FACTORY * 100);
    // Lavorazioni davvero assegnate a questo impianto (ordini di terra e progetti).
    const assignedOrders = plantOrders(landOrders, index, factories);
    const productionOrder = assignedOrders[0] ?? null;
    // Attività reale dell'impianto: le linee in lavorazione, rallentate dalla
    // saturazione nazionale (`overflowFactor`). Impianto fermo ⇒ output zero;
    // industria satura ⇒ produzione ridotta per tutti.
    const activity = capacity.blocked ? 0 : (lines / CAPACITY_PER_FACTORY) * capacity.overflowFactor;
    const status: OperatingStatus = lines <= 0 ? 'idle' : util >= 95 ? 'maintenance' : util >= 60 ? 'operational' : 'degraded';
    objects.push({
      id: `factory-${input.polityId}-${index + 1}`,
      kind: 'facility',
      label: plantName('factory', index, region?.name || 'nazionale'),
      subtitle: 'Impianto industriale',
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: null,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      facts: [
        fact('stato', 'Linee di lavorazione', CAPACITY_PER_FACTORY, 'numero'),
        fact('capacita', 'Utilizzo', util, 'pct', util >= 95 ? 'warning' : 'neutral'),
        fact('capacita', 'Ritmo di lavoro', round1(activity * 100), 'pct', activity < 0.5 ? 'warning' : 'neutral'),
        fact('output', 'Armamenti', round2(factoryProfile.weapons * activity), 'per_mese', activity <= 0 ? 'critical' : 'neutral'),
        fact('output', 'Vestiario', round2(factoryProfile.clothing * activity), 'per_mese', activity <= 0 ? 'critical' : 'neutral'),
        fact('input', 'Carburante', round2(factoryProfile.fuel * activity), 'per_mese'),
        fact('input', 'Minerali ferrosi', round2(ironInput * activity), 'per_mese'),
        fact('input', 'Carbone', round2(coalInput * activity), 'per_mese'),
        fact('personale', 'Addetti', staffOf('factory', CAPACITY_PER_FACTORY), 'numero'),
        fact('costi', 'Costo operativo', civilCostOf(CAPACITY_PER_FACTORY), 'mld'),
        // §13: che cosa sta producendo l'impianto, con l'avanzamento reale.
        ...(productionOrder ? [
          fact('output', 'Ordine in lavorazione', null, 'testo', 'neutral',
            `${productionOrder.name} ×${n(productionOrder.quantity - (productionOrder.deliveredUnits || 0))} · ${round1(nonNegative(productionOrder.progress))}%`),
          ...(productionOrder.expectedDate
            ? [fact('autonomia', 'Consegna prevista', null, 'data', 'neutral', String(productionOrder.expectedDate))]
            : []),
        ] : []),
      ],
      problems: [
        ...(lines <= 0 ? [{ severity: 'critical' as const, label: 'Impianto fermo: nessuna lavorazione', detail: 'Le linee sono libere: la produzione dell\'impianto è zero finché non riceve un ordine.' }] : []),
        ...(util >= 95 ? [{ severity: 'warning' as const, label: `Capacità satura (${util}%)`, detail: 'Un nuovo ordine su questo impianto slitta.' }] : []),
        ...(capacity.saturated && !capacity.blocked ? [{ severity: 'warning' as const, label: `Industria satura: lavoro al ${round1(capacity.overflowFactor * 100)}% del ritmo`, detail: `${n(capacity.demand)} linee richieste su ${n(capacity.total)} disponibili nella nazione.` }] : []),
        ...(capacity.blocked ? [{ severity: 'critical' as const, label: 'Produzione bloccata: nessuna capacità industriale', detail: 'Nessuna linea di lavorazione: le consegne restano ferme.' }] : []),
      ],
      actions: [{
        id: 'procure',
        label: 'Avvia una produzione militare',
        enabled: !capacity.blocked,
        blockedReason: capacity.blocked ? 'Nessuna capacità industriale disponibile.' : null,
      }],
      why: 'Impianto derivato dal profilo industriale del paese (il motore conta le fabbriche, non i singoli stabilimenti). Linee e utilizzo vengono dalla capacità industriale del motore; la produzione è il contributo marginale di un impianto calcolato con la funzione del motore.',
    });
  }

  for (let index = 0; index < ports; index += 1) {
    const region = coastal.length > 0 ? coastal[index % coastal.length] : null;
    const lines = slotLines('shipyard', index);
    const assignedNaval = plantOrders(navalOrders, index, ports);
    const util = round1(lines / CAPACITY_PER_PORT * 100);
    const shipyardActivity = capacity.blocked ? 0 : (lines / CAPACITY_PER_PORT) * capacity.overflowFactor;
    const status: OperatingStatus = lines <= 0 ? 'idle' : util >= 95 ? 'maintenance' : 'operational';
    objects.push({
      id: `shipyard-${input.polityId}-${index + 1}`,
      kind: 'facility',
      label: plantName('shipyard', index, region?.name || 'nazionale'),
      subtitle: 'Cantiere navale e porto',
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: null,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      facts: [
        fact('stato', 'Linee di lavorazione', CAPACITY_PER_PORT, 'numero'),
        fact('capacita', 'Utilizzo', util, 'pct', util >= 95 ? 'warning' : 'neutral'),
        fact('output', 'Scafi in costruzione', assignedNaval.length > 0
          ? assignedNaval.reduce((total, order) => total + Math.max(0, order.quantity - (order.deliveredUnits || 0)), 0)
          : shipsUnderConstruction, 'numero',
        (assignedNaval.length > 0 || shipsUnderConstruction > 0) ? 'warning' : 'neutral'),
        ...(assignedNaval.length > 0
          ? [fact('output', 'In costruzione', null, 'testo', 'warning',
            assignedNaval.map(order => `${order.name} ×${n(order.quantity)} · ${round1(nonNegative(order.progress))}%`).join(' · '))]
          : []),
        ...(assignedNaval.find(order => order.expectedDate)
          ? [fact('autonomia', 'Consegna prevista', null, 'data', 'neutral',
            String(assignedNaval.find(order => order.expectedDate)?.expectedDate))]
          : []),
        fact('input', 'Acciaio e componenti', round2(ironInput * 2 * shipyardActivity), 'per_mese'),
        fact('input', 'Carburante movimentato', round2(shipyardProfile.fuel * shipyardActivity), 'per_mese'),
        fact('personale', 'Addetti', staffOf('shipyard', CAPACITY_PER_PORT), 'numero'),
        fact('costi', 'Costo operativo', civilCostOf(CAPACITY_PER_PORT), 'mld'),
        fact('autonomia', 'Unità in manutenzione', inMaintenanceLines > 0 ? inMaintenanceLines : 0, 'numero',
          inMaintenanceLines > 0 ? 'warning' : 'neutral'),
      ],
      problems: [
        ...(shipsUnderConstruction > 0 ? [{ severity: 'warning' as const, label: `${shipsUnderConstruction} scafi in costruzione`, detail: 'La nave entra in servizio solo al completamento: nessuna consegna parziale.' }] : []),
        ...(util >= 95 ? [{ severity: 'warning' as const, label: `Cantiere saturo (${util}%)`, detail: 'Le nuove costruzioni slittano finché non si libera capacità.' }] : []),
      ],
      actions: [{
        id: 'procure',
        label: 'Ordina una nave',
        enabled: !capacity.blocked,
        blockedReason: capacity.blocked ? 'Nessuna capacità industriale disponibile.' : null,
      }],
      why: 'I cantieri sono i porti del paese: senza sbocco al mare non esistono. Lo scafo in costruzione non è una nave: entra nell\'arsenale solo a lavori finiti.',
    });
  }

  for (let index = 0; index < universities; index += 1) {
    const region = ordered.length > 0 ? ordered[index % ordered.length] : null;
    const researchProject = input.projects.find(project => /\bricerc|laborator|radar|tecnolog|aereo|missil|ateneo|universit/i.test(String(project.title || '')));
    const status: OperatingStatus = 'operational';
    const researchLines = slotLines('university', index,
      capacity.allocations.filter(allocation => allocation.kind === 'project'));
    const universityActivity = capacity.blocked ? 0 : 1;
    objects.push({
      id: `university-${input.polityId}-${index + 1}`,
      kind: 'facility',
      label: plantName('university', index, region?.name || 'nazionale'),
      subtitle: 'Ricerca e formazione tecnica',
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: null,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      facts: [
        fact('capacita', 'Linee di ricerca', CAPACITY_PER_UNIVERSITY, 'numero'),
        fact('capacita', 'Linee occupate da progetti', researchLines, 'numero'),
        fact('output', 'Punti ricerca', round2(universityProfile.research * universityActivity), 'per_mese', universityActivity <= 0 ? 'critical' : 'neutral'),
        fact('personale', 'Addetti', staffOf('university', CAPACITY_PER_UNIVERSITY), 'numero'),
        fact('costi', 'Costo operativo', civilCostOf(CAPACITY_PER_UNIVERSITY), 'mld'),
        ...(researchProject ? [
          fact('output', 'Progetto in corso', null, 'testo', 'neutral', String(researchProject.title || '')),
          fact('output', 'Avanzamento', round1(nonNegative(researchProject.progress)), 'pct'),
          fact('autonomia', 'Mesi al completamento', projectRemainingMonths(researchProject, input.date), 'mesi'),
        ] : []),
      ],
      problems: researchProject && nonNegative(researchProject.progress) < 100
        ? [{ severity: 'warning' as const, label: `Ricerca in corso: ${String(researchProject.title || '')}`, detail: 'La tecnologia si sblocca solo a progetto completato.' }]
        : [],
      actions: [],
      why: 'Atenei derivati dal profilo del paese; i punti ricerca crescono con gli atenei (funzione del motore). Un progetto sblocca la tecnologia solo a completamento.',
    });
  }

  // ── Miniere e giacimenti ──────────────────────────────────────────────────
  let mineIndex = 0;
  const mineContributions: Array<{ kind: NaturalResourceKind; value: number; section: FactSection; label: string }> = [];
  for (const kind of EXTRACTIVE) {
    const amount = positive(input.endowment[kind]);
    if (amount <= 0) continue;
    const contribution = endowmentContribution(kind, input.technologies);
    const value = round2(sum(Object.values(contribution)) || 0);
    const view = contributionView(kind);
    const region = ordered.length > 0 ? ordered[mineIndex % ordered.length] : null;
    mineIndex += 1;
    mineContributions.push({ kind, value, section: view.section, label: view.label });
    const status: OperatingStatus = value <= 0 ? 'idle' : 'operational';
    objects.push({
      id: `mine-${input.polityId}-${kind}`,
      kind: 'mine',
      label: `Miniera di ${NATURAL_RESOURCE_LABELS[kind].toLowerCase()}${region ? ` (${region.name})` : ''}`,
      subtitle: `Giacimento ${amount}/5 dal registro del paese`,
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: null,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      facts: [
        fact('stato', 'Giacimento', amount, 'numero'),
        fact(view.section, view.label, value, 'per_mese', value > 0 ? 'positive' : 'critical'),
        fact('capacita', 'Sfruttamento', round1(Math.min(100, amount / 5 * 100)), 'pct'),
        fact('personale', 'Addetti', Math.max(120, Math.round(amount * STAFF_PER_MINE_POINT)), 'numero'),
        fact('costi', 'Costo operativo', round2(civilCostOf(1)), 'mld'),
      ],
      problems: value <= 0
        ? [{ severity: 'critical' as const, label: 'Contributo nullo', detail: 'Il giacimento non alimenta nessuna produzione con la tecnologia attuale.' }]
        : [],
      actions: [{ id: 'trade', label: 'Compra o vendi sul mercato', enabled: true, blockedReason: null }],
      why: `Il contributo del giacimento è il delta di produzione che il motore calcola aggiungendo una unità di ${NATURAL_RESOURCE_LABELS[kind].toLowerCase()}: non è una stima del browser.`,
    });
  }


// ── Costruzioni in corso ──────────────────────────────────────────────────
  for (const project of input.projects) {
    const allocation = projectAllocation(project);
    const months = projectRemainingMonths(project, input.date);
    const region = ordered.length > 0 ? ordered[0] : null;
    const progress = round1(nonNegative(project.progress));
    objects.push({
      id: `construction-${project.id}`,
      kind: 'construction',
      label: shortTitle(String(project.title || 'Lavori in corso')),
      subtitle: region ? `Cantiere in ${region.name}` : 'Cantiere nazionale',
      status: 'under_construction',
      statusLabel: OPERATING_STATUS_LABEL.under_construction,
      parentId: null,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      facts: [
        fact('stato', 'Avanzamento', progress, 'pct'),
        fact('capacita', 'Linee occupate dai lavori', allocation.capacityDemand, 'numero'),
        fact('autonomia', 'Mesi al completamento', months, 'mesi'),
        fact('input', 'Materiali da costruzione', round2(allocation.capacityDemand * 1.5), 'per_mese'),
        fact('costi', 'Spesa in corso', civilCostOf(allocation.capacityDemand), 'mld'),
        fact('output', 'Beneficio', 0, 'numero', 'neutral', 'Nessuno prima del completamento: l\'opera entra nei conti solo a lavori finiti.'),
      ],
      problems: capacity.blocked
        ? [{ severity: 'critical' as const, label: 'Cantiere fermo: nessuna capacità industriale', detail: 'Senza impianti i lavori non avanzano.' }]
        : [],
      actions: [],
      why: `Un\'opera in costruzione occupa linee e materiali ma non produce nulla: il motore non la conta fra gli impianti finché non è completata (il cantiere è un oggetto \`construction_site\`, non una fabbrica).${shortTitle(String(project.title || '')) !== String(project.title || '').trim() ? ` Opera: ${String(project.title || '').replace(/\s+/g, ' ').trim()}` : ''}`,
    });
  }

  // ── Marina: marina → flotte → navi ────────────────────────────────────────
  objects.push(...buildNavy({
    polityId: input.polityId,
    naval: navalInventory(units),
    units,
    manpower,
    account,
    needs,
    stock,
    readiness,
    coverage,
    capacity,
    shipsUnderConstruction,
    regions: coastal,
    date: input.date,
  }));

  // ── Catene produttive ─────────────────────────────────────────────────────
  const chains = buildChains({
    minerals: round2(sum(mineContributions.filter(item => item.section === 'input').map(item => item.value))),
    factoryOutput: factoryProfile,
    navalOrders,
    shipsUnderConstruction,
    capacity,
    coverage,
    shipsOperational: sum(navalInventory(units).map(item => item.quantity)),
  });

  const counts: Record<OperatingKind, number> = {
    force: 0, army: 0, unit: 0, front: 0, facility: 0, construction: 0, navy: 0, fleet: 0, ship: 0, mine: 0,
  };
  // OP-OBJECTS PERSISTENT: con lo stato proprio degli oggetti, le schede di
  // armate, impianti, navi, flotte e cantieri sono quelle reali. Restano del
  // motore i contenitori (forze armate, marina) e le catene produttive.
  if (input.persistentObjects && input.persistentObjects.length > 0) {
    const replaced = new Set<OperatingKind>(['army', 'facility', 'construction', 'fleet', 'ship', 'mine']);
    const kept = objects.filter(object => !replaced.has(object.kind));
    objects.length = 0;
    objects.push(...kept, ...input.persistentObjects);
    conventions.push('Oggetti persistenti: uomini, equipaggiamento, addetti, scafi e cantieri sono lo stato proprio dell\'oggetto, non una quota dell\'aggregato. Il totale nazionale resta la loro somma (deposito + assegnato).');
  }
  for (const object of objects) counts[object.kind] += 1;
  return { objects, chains, counts, conventions };
}

// ── 7. Marina: marina, flotte, navi ────────────────────────────────────────

function buildNavy(input: {
  polityId: string;
  naval: NavalInventoryItem[];
  /** Arsenale completo: i missili sono una voce dell'arsenale, non una flotta. */
  units: Record<string, number>;
  manpower: MilitaryManpower;
  account: NationalAccount;
  needs: MaterialNeeds;
  stock: ResourceStock;
  readiness: MilitaryReadiness;
  coverage: EquipmentCoverage[];
  capacity: IndustrialCapacity;
  shipsUnderConstruction: number;
  regions: OperationalRegion[];
  date: string;
}): OperatingObject[] {
  const { naval } = input;
  if (naval.length === 0 && input.shipsUnderConstruction === 0) return [];
  const totalShips = sum(naval.map(item => item.quantity));
  const crewTotal = navalCrew(naval);
  const inMaintenance = Math.min(totalShips, Math.round(input.capacity.byKind.maintenance));
  const operational = Math.max(0, totalShips - inMaintenance);
  const navalCoverage = input.coverage.find(row => row.category === 'navalSupport');
  const navyShare = input.manpower.activePersonnel > 0 ? Math.min(1, crewTotal / input.manpower.activePersonnel) : 0;
  const militaryMld = nonNegative(input.account.nominalGdpUsdBillions) * nonNegative(input.account.defenceBurdenPct) / 100 / 12;
  const fuelMonths = input.needs.fuel > 0 ? round1(input.stock.fuel / input.needs.fuel) : null;
  // Munizionamento: somma delle voci missilistiche presenti in arsenale.
  const missilePool = Math.max(0, Math.floor(
    nonNegative(input.units['antinave']) + nonNegative(input.units['cruise'])
    + nonNegative(input.units['missili_corto']) + nonNegative(input.units['missili_medio']),
  ));
  const status: OperatingStatus = totalShips === 0 ? 'idle'
    : inMaintenance >= totalShips ? 'maintenance'
      : input.readiness.readinessPct < 35 ? 'critical'
        : input.readiness.readinessPct < 65 ? 'degraded' : 'operational';
  const objects: OperatingObject[] = [];

  objects.push({
    id: 'navy',
    kind: 'navy',
    label: 'Marina',
    subtitle: `${n(totalShips)} navi · ${n(crewTotal)} uomini di equipaggio`,
    status,
    statusLabel: OPERATING_STATUS_LABEL[status],
    parentId: null,
    regionId: null,
    regionName: null,
    facts: [
      fact('stato', 'Navi in servizio', totalShips, 'numero', totalShips > 0 ? 'positive' : 'warning'),
      fact('stato', 'Operative', operational, 'numero', 'positive'),
      fact('stato', 'In manutenzione', inMaintenance, 'numero', inMaintenance > 0 ? 'warning' : 'neutral'),
      fact('stato', 'In costruzione', input.shipsUnderConstruction, 'numero', input.shipsUnderConstruction > 0 ? 'warning' : 'neutral'),
      fact('personale', 'Equipaggi', crewTotal, 'numero'),
      fact('capacita', 'Prontezza', input.readiness.readinessPct, 'pct', readinessTone(input.readiness)),
      fact('output', 'Copertura navale', navalCoverage ? round1(navalCoverage.coveragePct) : 0, 'pct',
        navalCoverage && navalCoverage.coveragePct < 85 ? 'warning' : 'positive'),
      fact('input', 'Carburante', round2(input.needs.fuel * navyShare), 'per_mese'),
      fact('costi', 'Spesa della marina', round2(militaryMld * navyShare), 'mld'),
      fact('autonomia', 'Carburante (scorte)', fuelMonths, 'mesi',
        fuelMonths !== null && fuelMonths < FULL_TANK_MONTHS ? 'warning' : 'neutral'),
      fact('stato', 'Composizione', null, 'testo', 'neutral', naval.map(item => `${item.name} ${item.quantity}`).join(' · ') || 'nessuna unità in servizio'),
    ],
    problems: [
      ...(navalCoverage && navalCoverage.coveragePct < 85
        ? [{
          severity: navalCoverage.coveragePct < 60 ? 'critical' as const : 'warning' as const,
          label: `Copertura navale ${round1(navalCoverage.coveragePct)}%`,
          detail: `${n(navalCoverage.available)} unità su ${n(navalCoverage.required)} della dotazione di riferimento.`,
        }]
        : []),
      ...(inMaintenance > 0
        ? [{ severity: 'warning' as const, label: `${inMaintenance} navi in manutenzione`, detail: 'Consumano cassa e capacità del cantiere e non sono pienamente operative.' }]
        : []),
      ...(input.shipsUnderConstruction > 0
        ? [{ severity: 'warning' as const, label: `${input.shipsUnderConstruction} scafi in costruzione`, detail: 'Nessuna nave prima del completamento dei lavori.' }]
        : []),
    ],
    actions: [],
    why: 'La marina è letta dall\'arsenale navale del motore: le unità sono equipaggiamento reale, non una flotta inventata. L\'equipaggio usa gli organici di catalogo; la spesa è la quota militare attribuita agli equipaggi.',
  });

  const fleetGroups = new Map<string, NavalInventoryItem[]>();
  for (const item of naval) {
    const group = fleetGroups.get(item.category) || [];
    group.push(item);
    fleetGroups.set(item.category, group);
  }
  let fleetIndex = 0;
  const fleetIds = new Map<NavalInventoryItem, string>();
  for (const [category, items] of [...fleetGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fleetIndex += 1;
    const fleetId = `fleet-${input.polityId}-${fleetIndex}`;
    for (const item of items) fleetIds.set(item, fleetId);
    const ships = sum(items.map(item => item.quantity));
    const crew = navalCrew(items);
    const fleetShare = crewTotal > 0 ? crew / crewTotal : 0;
    const fleetMaintenance = Math.min(ships, fleetIndex === 1 ? inMaintenance : 0);
    const fleetStatus: OperatingStatus = ships === 0 ? 'idle'
      : fleetMaintenance >= ships ? 'maintenance'
        : input.readiness.readinessPct < 50 ? 'degraded' : 'operational';
    const surface = category === 'Navale di superficie' || category === 'Navale leggera' || category === 'Proiezione';
    objects.push({
      id: fleetId,
      kind: 'fleet',
      label: `${fleetIndex}ª Flotta — ${category}`,
      subtitle: items.map(item => `${item.quantity} × ${item.name.toLowerCase()}`).join(', ') || 'nessuna unità',
      status: fleetStatus,
      statusLabel: OPERATING_STATUS_LABEL[fleetStatus],
      parentId: 'navy',
      regionId: null,
      regionName: null,
      facts: [
        fact('stato', 'Navi', ships, 'numero'),
        fact('personale', 'Equipaggi', crew, 'numero'),
        fact('capacita', 'Prontezza', input.readiness.readinessPct, 'pct', readinessTone(input.readiness)),
        fact('input', 'Carburante', round2(input.needs.fuel * navyShare * fleetShare), 'per_mese'),
        fact('output', 'Missili disponibili', surface ? Math.round(missilePool * fleetShare) : 0, 'numero',
          surface && missilePool === 0 ? 'critical' : 'neutral'),
        fact('costi', 'Spesa della flotta', round2(militaryMld * navyShare * fleetShare), 'mld'),
        fact('autonomia', 'Carburante (scorte)', fuelMonths, 'mesi'),
      ],
      problems: [
        ...(fleetMaintenance > 0 ? [{ severity: 'warning' as const, label: `${fleetMaintenance} unità in manutenzione`, detail: 'Non sono pienamente operative finché i lavori non finiscono.' }] : []),
        ...(surface && missilePool === 0 && ships > 0 ? [{ severity: 'critical' as const, label: 'Munizionamento assente', detail: 'Nessun missile in arsenale per questa flotta.' }] : []),
      ],
      actions: [],
      why: 'Il motore conta le unità per tipo, non le squadre: il raggruppamento in flotte per categoria è una convenzione dichiarata, così si legge una forza navale concreta senza inventare scafi.',
    });

    for (const item of items) {
      const represented = Math.min(item.quantity, MAX_REPRESENTATIVE_SHIPS);
      for (let shipIndex = 0; shipIndex < represented; shipIndex += 1) {
        const ordinal = item.quantity > 1 ? ` ${shipIndex + 1}ª` : '';
        const shipMaintenance = inMaintenance > 0 && (fleetIndex + shipIndex) % Math.max(1, inMaintenance) === 0;
        const shipStatus: OperatingStatus = shipMaintenance ? 'maintenance' : item.quality >= 66 ? 'operational' : 'degraded';
        const tankPct = fuelMonths === null ? null : Math.min(100, round1(fuelMonths / FULL_TANK_MONTHS * 100));
        const shipMissiles = surface ? Math.min(item.quantity, Math.round(missilePool * fleetShare / Math.max(1, ships))) : 0;
        objects.push({
          id: `ship-${input.polityId}-${item.equipmentId}-${shipIndex + 1}`,
          kind: 'ship',
          label: `${item.name}${ordinal}`,
          subtitle: `${item.category} · ${fleetIndex}ª Flotta`,
          status: shipStatus,
          statusLabel: OPERATING_STATUS_LABEL[shipStatus],
          parentId: fleetId,
          regionId: null,
          regionName: null,
          facts: [
            fact('personale', 'Equipaggio', item.crew, 'numero'),
            fact('capacita', 'Prontezza', input.readiness.readinessPct, 'pct', readinessTone(input.readiness)),
            fact('output', 'Armamento — missili', shipMissiles, 'numero', surface && shipMissiles === 0 ? 'critical' : 'neutral'),
            fact('input', 'Carburante', round3(input.needs.fuel * navyShare * fleetShare / Math.max(1, ships)), 'per_mese'),
            // Il costo di un singolo scafo è una frazione di miliardo: si legge in milioni.
            fact('costi', 'Costo operativo', round2(militaryMld * navyShare * fleetShare / Math.max(1, ships) * 1000), 'mln'),
            fact('autonomia', 'Carburante', tankPct, 'pct', tankPct !== null && tankPct < 40 ? 'warning' : 'neutral',
              fuelMonths !== null ? `${round1(fuelMonths)} mesi di scorte nazionali` : null),
            fact('stato', 'Manutenzione', null, 'testo', shipMaintenance ? 'critical' : 'neutral',
              shipMaintenance ? 'In manutenzione: non pienamente operativa.' : 'Nessun lavoro in corso.'),
          ],
          problems: [
            ...(shipMaintenance ? [{ severity: 'warning' as const, label: 'In manutenzione', detail: 'Consuma cassa e capacità del cantiere: non è pienamente operativa.' }] : []),
            ...(surface && shipMissiles === 0 ? [{ severity: 'critical' as const, label: 'Senza munizionamento', detail: 'Nessun missile assegnabile a questa unità.' }] : []),
            ...(tankPct !== null && tankPct < 40 ? [{ severity: 'warning' as const, label: `Carburante al ${tankPct}%`, detail: 'Autonomia ridotta rispetto alle operazioni.' }] : []),
          ],
          actions: [],
          why: 'Nave derivata dalle unità navali dell\'arsenale (il motore conta gli scafi per tipo). Equipaggio e qualità vengono dal catalogo; la manutenzione è attribuita alle unità quando il motore ha lavori di manutenzione aperti.',
        });
      }
    }
  }
  return objects;
}

// ── 8. Catene produttive ────────────────────────────────────────────────────

function buildChains(input: {
  minerals: number;
  factoryOutput: MaterialNeeds;
  navalOrders: readonly IndustrialOrderLike[];
  shipsUnderConstruction: number;
  capacity: IndustrialCapacity;
  coverage: EquipmentCoverage[];
  shipsOperational: number;
}): OperatingChain[] {
  const weapons = round2(input.factoryOutput.weapons);
  const individual = input.coverage.find(row => row.category === 'individualWeapons');
  const armored = input.coverage.find(row => row.category === 'armoredMobility');
  const armyCoverage = armored ? round1(armored.coveragePct) : individual ? round1(individual.coveragePct) : 0;
  const industrial: OperatingChain = {
    id: 'armamenti',
    label: 'Minerali → acciaio → armamenti → esercito',
    steps: [
      {
        label: 'Minerali ferrosi e carbone',
        value: input.minerals,
        unit: 'per_mese',
        tone: input.minerals <= 0 ? 'critical' : input.minerals < 0.4 ? 'warning' : 'positive',
        detail: 'Contributo dei giacimenti alla produzione nazionale.',
      },
      {
        label: 'Produzione di armamenti',
        value: weapons,
        unit: 'per_mese',
        tone: weapons <= 0 ? 'critical' : weapons < 0.3 ? 'warning' : 'positive',
        detail: 'Impianti del paese (funzione del motore avanzata sul profilo di un impianto).',
      },
      {
        label: 'Linee industriali impegnate',
        value: input.capacity.byKind.military_production,
        unit: 'numero',
        tone: input.capacity.blocked ? 'critical' : input.capacity.saturated ? 'warning' : 'neutral',
        detail: input.capacity.blocked
          ? 'Nessuna capacità: le lavorazioni non avanzano.'
          : `Su ${n(input.capacity.total)} linee totali.`,
      },
      {
        label: 'Copertura dell\'esercito',
        value: armyCoverage,
        unit: 'pct',
        tone: armyCoverage >= 85 ? 'positive' : armyCoverage >= 60 ? 'warning' : 'critical',
        detail: individual ? `Armi individuali ${round1(individual.coveragePct)}%, mobilità ${round1(armored?.coveragePct ?? 0)}%.` : null,
      },
    ],
    broken: input.minerals <= 0 || weapons <= 0 || input.capacity.blocked || armyCoverage < 60,
    summary: '',
  };
  industrial.summary = chainSummary(industrial);

  const naval: OperatingChain = {
    id: 'navale',
    label: 'Cantieri → navi → marina',
    steps: [
      {
        label: 'Ordini navali aperti',
        value: input.navalOrders.length,
        unit: 'numero',
        tone: input.navalOrders.length > 0 ? 'neutral' : 'neutral',
        detail: 'Costruzioni in lavorazione nei cantieri.',
      },
      {
        label: 'Scafi in costruzione',
        value: input.shipsUnderConstruction,
        unit: 'numero',
        tone: input.shipsUnderConstruction > 0 ? 'warning' : 'neutral',
        detail: 'Nessuna nave entra in servizio prima del completamento.',
      },
      {
        label: 'Navi in servizio',
        value: input.shipsOperational,
        unit: 'numero',
        tone: input.shipsOperational > 0 ? 'positive' : 'warning',
        detail: 'Unità già consegnate all\'arsenale.',
      },
    ],
    broken: input.shipsOperational <= 0 && input.shipsUnderConstruction > 0,
    summary: '',
  };
  naval.summary = chainSummary(naval);
  return [industrial, naval];
}

function chainSummary(chain: OperatingChain): string {
  const weak = chain.steps.find(step => step.tone === 'critical') || chain.steps.find(step => step.tone === 'warning');
  if (!weak) return 'Tutti gli anelli tengono: la catena consegna al ritmo previsto.';
  return `Anello debole: ${weak.label} (${n(weak.value, 2)}). Se cala ancora, l'output finale scende.`;
}

/** Etichetta dell'epoca militare (riuso dell'etichetta del motore). */
export const EPOCH_LABEL = MILITARY_EPOCH_LABEL;
