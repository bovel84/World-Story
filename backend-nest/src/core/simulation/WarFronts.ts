/**
 * World Story — WarFronts (FrontEngine)
 * =====================================
 * Il livello **strategico** della guerra: un fronte è **territorio conteso +
 * unità + obiettivo**. Non è un wargame tattico (niente esagoni, linee,
 * tenaglie, sbarchi) e non è un secondo motore militare: è un modulo **puro**
 * che legge lo stato persistente dei reparti (uomini, pezzi, fabbisogni,
 * prontezza, ordine) e decide pressione, perdite, ritirata e sfondamento con
 * numeri **centralizzati e testabili**.
 *
 * Regole di progetto
 * ------------------
 * 1. **Player e NPC usano lo stesso motore**: le funzioni non sanno chi è il
 *    giocatore. L'unica differenza è chi scrive `unit.order` (il giocatore, o
 *    la policy deterministica `npcFrontOrder`).
 * 2. **L'LLM non decide numeri**: qui non esiste testo narrativo, solo aritmetica
 *    riproducibile.
 * 3. **Determinismo**: ogni tiro passa da `frontRollSeed({ frontId, date, phase })`
 *    e da `stableRoll` (FNV, stesso motore del tick di produzione). Mai
 *    `Math.random`, mai il solo turno: la coordinata temporale è la data del
 *    periodo simulato.
 * 4. **Conservazione**: le perdite si applicano ai **reparti reali**
 *    (`personnel`, `equipment`) e i consumi alle **scorte reali**; nessun numero
 *    nasce dal nulla e nessun `region.militaryPower -= X` sostituisce la guerra.
 * 5. **Territorio**: la conquista è solo una **decisione** (`advance`), applicata
 *    dal servizio con `transferRegion` esistente, e solo con sfondamento +
 *    difensore in ritirata/crollato + obiettivo raggiungibile nel teatro.
 *
 * Il supporto legacy (`region.militaryPower`) resta un **fallback dichiarato**:
 * quando una parte ha reparti persistenti, il suo contributo legacy vale
 * `LEGACY_SUPPORT_WEIGHT` (25%) — la fonte sono i reparti.
 */

import { arsenalCombatFactor, combatAttrition } from './MilitaryIndustry';
import { militaryManpower, type MilitaryEpoch } from './MilitaryDoctrine';
import { stableRoll } from './MilitaryProduction';
import {
  equipmentQuantity,
  rifleEquipmentId,
  rifleRequirement,
  unitReadiness,
  unitStatusFromCoverage,
  UNIT_ORDER_DEFAULT,
  UNIT_ORDER_INFO,
  type MilitaryUnitState,
  type UnitOrder,
  type WarFrontState,
  type WarFrontStatus,
} from './OperationalState';

// ── 1. Costanti del fronte (un solo posto per ogni numero) ──────────────────

/**
 * Perdite di base per **mese** di fronte in contatto, alla pari di forze:
 * 6% degli uomini e dei pezzi. È il numero della specifica (12.000 → 11.280 in
 * un mese di scontro), scalato dai giorni realmente simulati.
 */
export const COMBAT_LOSS_PER_MONTH = 0.06;
/** Tetto di perdite in un singolo periodo: nessuna unità si dissolve in un tick. */
export const MAX_LOSS_RATIO = 0.35;
/** Pressione minima usata al denominatore: evita divisioni per zero, non è un bonus. */
export const MIN_PRESSURE = 0.25;
/** Vantaggio di pressione che apre uno sfondamento (50%). */
export const BREAKTHROUGH_RATIO = 1.5;
/** Probabilità di sfondamento quando il vantaggio c'è davvero. */
export const BREAKTHROUGH_CHANCE = 0.55;
/** Fascia entro cui il fronte è «in stallo» (15% di differenza di pressione). */
export const STALEMATE_BAND = 0.15;
/** Sotto questa pressione relativa la parte collassa (`collapsed`). */
export const COLLAPSE_RATIO = 0.4;
/** Organico sotto il quale un reparto è `degraded` anche se coperto. */
export const DEPLETED_ORGANIC_RATIO = 0.25;
/** Fondo dell'`arsenalCombatFactor` del motore: serve a normalizzarlo in 0…1. */
export const ARSENAL_FACTOR_FLOOR = 0.6;
/** Peso del supporto legacy (`region.militaryPower`) quando ci sono reparti. */
export const LEGACY_SUPPORT_WEIGHT = 0.25;
/** Potenza dichiarata che vale «1.0» di pressione legacy. */
export const LEGACY_PRESSURE_REFERENCE = 400;
/** Tetto della pressione legacy di una parte. */
export const LEGACY_PRESSURE_CAP = 1.5;
/** Perdite extra di un ripiegamento senza provincia amica valida (resa). */
export const SURRENDER_LOSS_MULTIPLIER = 1.25;

/** Seme del tiro di fronte: (fronte, data del periodo, fase). Mai il turno. */
export function frontRollSeed(input: { frontId: string; date: string; phase: string }): string {
  return `${input.frontId}:${input.date}:${input.phase}`;
}

// ── 2. Forza effettiva di un reparto ────────────────────────────────────────

/** Copertura rifornimenti di una parte: scorte del periodo / fabbisogno (0…1,5). */
export interface SideSupply {
  food: number;
  fuel: number;
  weapons: number;
}

export interface UnitStrength {
  unitId: string;
  order: UnitOrder;
  personnelFactor: number;
  equipmentFactor: number;
  readinessFactor: number;
  orderFactor: number;
  supplyFactor: number;
  /** Prodotto dei fattori: 0…~1,8. */
  strength: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const ratio = (value: number, need: number): number => (need <= 0 ? 1 : clamp(value / need, 0, 1.5));
const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Fattori di rifornimento di una parte (P8):
 * - **armamenti** (`weapons`) — munizioni e pezzi di ricambio: riducono la
 *   pressione **offensiva** (nessun attacco senza munizioni);
 * - **carburante** — conta solo per le unità **motorizzate** (tecnologia
 *   `motorizzazione`): senza carburante si marcia a piedi;
 * - **cibo** — la fame toglie efficacia a chiunque.
 */
export function supplyFactors(input: { supply: SideSupply; motorized: boolean }): {
  fuelFactor: number; weaponsFactor: number; foodFactor: number; total: number;
} {
  const fuelFactor = input.motorized ? 0.55 + 0.45 * Math.min(1, input.supply.fuel) : 1;
  const weaponsFactor = 0.6 + 0.4 * Math.min(1, input.supply.weapons);
  const foodFactor = 0.7 + 0.3 * Math.min(1, input.supply.food);
  return {
    fuelFactor: round4(fuelFactor),
    weaponsFactor: round4(weaponsFactor),
    foodFactor: round4(foodFactor),
    total: round4(fuelFactor * weaponsFactor * foodFactor),
  };
}

/**
 * Forza effettiva di **un** reparto:
 * `organico × equipaggiamento × prontezza × ordine × rifornimenti`.
 * L'equipaggiamento riusa `arsenalCombatFactor` del motore (qualità media ×
 * copertura, 0,6…1,6) normalizzato in 0…1: nessuna seconda formula di qualità.
 */
export function unitStrength(input: {
  unit: Pick<MilitaryUnitState, 'id' | 'personnel' | 'equipment' | 'readiness' | 'status' | 'order'>;
  epoch: MilitaryEpoch;
  supply: SideSupply;
  motorized: boolean;
}): UnitStrength {
  const order = (input.unit.order ?? UNIT_ORDER_DEFAULT) as UnitOrder;
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const personnelFactor = menPerFormation > 0 ? clamp(Number(input.unit.personnel || 0) / menPerFormation, 0, 1) : 0;
  const equipmentFactor = clamp(arsenalCombatFactor(input.unit.equipment || {}, Number(input.unit.personnel || 0)) - ARSENAL_FACTOR_FLOOR, 0, 1);
  const readinessFactor = clamp(Number(input.unit.readiness || 0), 0, 1);
  const orderFactor = UNIT_ORDER_INFO[order].pressure;
  const supplyFactor = supplyFactors({ supply: input.supply, motorized: input.motorized }).total;
  const dead = input.unit.status === 'destroyed';
  const strength = dead ? 0 : round4(personnelFactor * equipmentFactor * readinessFactor * orderFactor * supplyFactor);
  return {
    unitId: String(input.unit.id),
    order,
    personnelFactor: round4(personnelFactor),
    equipmentFactor: round4(equipmentFactor),
    readinessFactor: round4(readinessFactor),
    orderFactor,
    supplyFactor,
    strength,
  };
}

/** Pressione di una parte: reparti reali + supporto legacy dichiarato. */
export interface SideStrength {
  units: UnitStrength[];
  persistentUnits: number;
  unitsPressure: number;
  legacyPressure: number;
  /** Potenza dichiarata grezza (dalla mappa): base dell'attrito del fronte. */
  legacyRaw: number;
  pressure: number;
}

export function frontSideStrength(input: {
  units: ReadonlyArray<Pick<MilitaryUnitState, 'id' | 'personnel' | 'equipment' | 'readiness' | 'status' | 'order'>>;
  epoch: MilitaryEpoch;
  supply: SideSupply;
  motorized: boolean;
  /** Potenza dichiarata dalla mappa per il teatro (supporto, non fonte). */
  legacyPower: number;
  /** Ordine della parte quando non ha reparti persistenti (policy NPC). */
  legacyOrder?: UnitOrder;
}): SideStrength {
  const units = input.units.map(unit => unitStrength({
    unit, epoch: input.epoch, supply: input.supply, motorized: input.motorized,
  }));
  const persistentUnits = input.units.filter(unit => unit.status !== 'destroyed').length;
  const unitsPressure = round4(units.reduce((total, item) => total + item.strength, 0));
  const weight = persistentUnits > 0 ? LEGACY_SUPPORT_WEIGHT : 1;
  const legacyRaw = Math.max(0, Number(input.legacyPower || 0)) / LEGACY_PRESSURE_REFERENCE;
  const legacyOrderFactor = UNIT_ORDER_INFO[input.legacyOrder ?? UNIT_ORDER_DEFAULT].pressure;
  const legacyPressure = round4(Math.min(LEGACY_PRESSURE_CAP, legacyRaw) * weight * legacyOrderFactor);
  return {
    units,
    persistentUnits,
    unitsPressure,
    legacyPressure,
    legacyRaw: round4(Math.max(0, Number(input.legacyPower || 0))),
    pressure: round4(unitsPressure + legacyPressure),
  };
}

/** Consumi di guerra di una parte nel periodo (fabbisogni × ordine × giorni). */
export function warConsumption(input: {
  units: ReadonlyArray<Pick<MilitaryUnitState, 'id' | 'status' | 'order' | 'monthlyNeeds'>>;
  stepDays: number;
}): { food: number; fuel: number; weapons: number } {
  const months = Math.max(0, input.stepDays) / 30;
  const total = { food: 0, fuel: 0, weapons: 0 };
  for (const unit of input.units) {
    if (unit.status === 'destroyed') continue;
    const factor = UNIT_ORDER_INFO[(unit.order ?? UNIT_ORDER_DEFAULT) as UnitOrder].consumption;
    total.food += Number(unit.monthlyNeeds?.food || 0) * factor * months;
    total.fuel += Number(unit.monthlyNeeds?.fuel || 0) * factor * months;
    total.weapons += Number(unit.monthlyNeeds?.weapons || 0) * factor * months;
  }
  const round3 = (value: number) => Math.round(value * 1000) / 1000;
  return { food: round3(total.food), fuel: round3(total.fuel), weapons: round3(total.weapons) };
}

/** Copertura dei rifornimenti di una parte: scorte disponibili / fabbisogno. */
export function supplyCoverage(input: {
  stock: { food: number; fuel: number; weapons: number };
  units: ReadonlyArray<Pick<MilitaryUnitState, 'id' | 'status' | 'order' | 'monthlyNeeds'>>;
  stepDays: number;
}): SideSupply {
  const need = warConsumption({ units: input.units, stepDays: input.stepDays });
  return {
    food: ratio(Number(input.stock.food || 0), need.food),
    fuel: ratio(Number(input.stock.fuel || 0), need.fuel),
    weapons: ratio(Number(input.stock.weapons || 0), need.weapons),
  };
}

/**
 * MILITARY/WARFRONT INTEGRITY P0-B — «questo reparto è davvero sul fronte?»
 *
 * La regola vive **una volta sola** e la usano tutti: la sincronizzazione dei
 * fronti, la lettura delle parti (`sides`), lo sgancio fuori teatro e il
 * fabbisogno materiale (`OperationalStateStore.militaryNeeds`). Un reparto
 * partecipa a un fronte **solo se**:
 *
 * 1. il fronte esiste (un `frontId` che punta al nulla non è un ordine);
 * 2. il fronte non è `closed` (la pace non paga l'ultimo mese di guerra);
 * 3. il `frontId` dichiarato è proprio quello del fronte;
 * 4. la provincia del reparto è **nel teatro** del fronte;
 * 5. — quando la polity è nota — il reparto appartiene ancora a una delle due parti.
 *
 * Un reparto **distrutto** non partecipa mai (non preme, non consuma, non torna
 * in vita): è la sua riga di storia, non una forza.
 */
export function unitIsActiveOnFront(input: {
  unit: Pick<MilitaryUnitState, 'frontId' | 'regionId' | 'status'>;
  front: Pick<WarFrontState, 'id' | 'status' | 'regionIds' | 'attackerPolityId' | 'defenderPolityId'> | null | undefined;
  /** Polity del reparto (dalla provincia che lo ospita): se nota si verifica la parte. */
  unitPolityId?: string | null;
}): boolean {
  const front = input.front;
  const unit = input.unit;
  if (!front) return false;
  if (unit.status === 'destroyed') return false;
  if (String(front.status) === 'closed') return false;
  if (String(unit.frontId || '') !== String(front.id)) return false;
  if (!unit.regionId) return false;
  if (!front.regionIds.map(String).includes(String(unit.regionId))) return false;
  const polity = input.unitPolityId == null ? '' : String(input.unitPolityId);
  if (polity && polity !== String(front.attackerPolityId) && polity !== String(front.defenderPolityId)) return false;
  return true;
}

// ── 3. Policy NPC: stessa formula, nessun LLM ───────────────────────────────

/**
 * Ordine deterministico di una parte NPC: vantaggio forte → attacca, equilibrio
 * → difende, molto inferiore → si ritira. È l'**unica** differenza fra NPC e
 * giocatore, che sceglie lo stesso ordine dal pannello del reparto.
 */
export function npcFrontOrder(input: { ownPressure: number; enemyPressure: number }): UnitOrder {
  const balance = Number(input.ownPressure || 0) / Math.max(MIN_PRESSURE, Number(input.enemyPressure || 0));
  if (balance >= 1.4) return 'attack';
  if (balance <= 0.6) return 'withdraw';
  return 'defend';
}

// ── 3-bis. Costo della forza **dichiarata** (legacy) nel periodo ────────────

/** Un impegno della forza dichiarata su un fronte del periodo. */
export interface LegacyWarEngagement {
  /** Ordine del periodo su **quel** fronte (da `npcFrontOrder`, nessun'altra policy). */
  order: UnitOrder;
  /** Potenza dichiarata **impegnata** nel teatro di quel fronte. */
  weight: number;
}

/**
 * P0-D — coefficiente di consumo della forza **dichiarata** (legacy) di una
 * polity nel periodo: `1` = nessuna guerra, `1,8` = attacco su tutta la forza.
 *
 * La forza dichiarata non ha reparti, quindi non ha un ordine per unità: il
 * costo del periodo è la **media pesata** degli ordini dei fronti su cui è
 * impegnata, con la quota non impegnata che resta a ×1.
 *
 * ```
 * factor = 1 + Σ engagedShare(fronte) × (consumption(ordine) − 1)
 * ```
 *
 * - i moltiplicatori sono quelli di `UNIT_ORDER_INFO` (`attack 1,8 · defend 1,2
 *   · reserve 0,8 · withdraw 1,0`): **nessuna costante duplicata**;
 * - il denominatore delle quote è la potenza **nazionale** dichiarata, o quella
 *   impegnata se la supera: la stessa forza non si conta due volte
 *   (`Σ engagedShare ≤ 1`);
 * - esempio: 40% attacco + 20% difesa + 40% non impegnato → `0,4×1,8 +
 *   0,2×1,2 + 0,4×1,0 = 1,36` (non `1,8` su tutta la nazione);
 * - l'ordine restituito è quello della quota maggiore (a parità: costo maggiore,
 *   poi ordine alfabetico): è l'ordine che il combattimento deve usare per la
 *   stessa parte, così costo, pressione e perdite parlano dello stesso piano.
 *
 * Pura e deterministica: nessun `Math.random`, nessuna data, nessun LLM.
 */
export function legacyWarConsumptionFactor(input: {
  engagements: ReadonlyArray<LegacyWarEngagement>;
  /** Potenza dichiarata **totale** della polity (tutte le sue province). */
  nationalPower: number;
}): { factor: number; order: UnitOrder | null } {
  const engagements = input.engagements.filter(engagement =>
    Number.isFinite(Number(engagement.weight)) && Number(engagement.weight) > 0
    && String(engagement.order) in UNIT_ORDER_INFO);
  if (engagements.length === 0) return { factor: 1, order: null };
  const engaged = engagements.reduce((total, engagement) => total + Number(engagement.weight), 0);
  // Potenza non impegnata a ×1; se l'impegno supera la potenza dichiarata, il
  // denominatore è l'impegno stesso: le quote si normalizzano, mai oltre 1.
  const denominator = Math.max(engaged, Math.max(0, Number(input.nationalPower) || 0));
  const raw = engagements.reduce((total, engagement) =>
    total + (Number(engagement.weight) / denominator) * (UNIT_ORDER_INFO[engagement.order].consumption - 1), 1);
  // Il coefficiente resta nella forchetta dei moltiplicatori esistenti.
  const consumption = Object.values(UNIT_ORDER_INFO).map(info => info.consumption);
  const factor = round4(Math.min(Math.max(...consumption), Math.max(Math.min(...consumption), raw)));
  const dominant = [...engagements].sort((a, b) => Number(b.weight) - Number(a.weight)
    || UNIT_ORDER_INFO[b.order].consumption - UNIT_ORDER_INFO[a.order].consumption
    || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))[0];
  return { factor, order: dominant.order };
}

// ── 4. Risoluzione del fronte ───────────────────────────────────────────────

/** Provincia del teatro: la stessa adiacenza della mappa, nient'altro. */
export interface FrontRegion {
  id: string;
  name?: string;
  owner: string;
  borders?: string[];
  militaryPower?: number;
}

export interface FrontOutcome {
  unitId: string;
  side: 'attacker' | 'defender';
  order: UnitOrder;
  personnelLost: number;
  equipmentLost: number;
  personnelAfter: number;
  equipmentAfter: Record<string, number>;
  readinessAfter: number;
  statusAfter: MilitaryUnitState['status'];
  /** Il reparto ripiega: il servizio lo sposta in una provincia amica. */
  routed: boolean;
  strength: number;
}

export interface FrontResolution {
  status: WarFrontStatus;
  attackerPressure: number;
  defenderPressure: number;
  attackerUnitsPressure: number;
  defenderUnitsPressure: number;
  attackerLegacyPressure: number;
  defenderLegacyPressure: number;
  outcomes: FrontOutcome[];
  consumption: { attacker: { food: number; fuel: number; weapons: number }; defender: { food: number; fuel: number; weapons: number } };
  routedDefender: boolean;
  routedAttacker: boolean;
  breakthrough: boolean;
  /** Attrito della forza dichiarata (militaryPower delle province in teatro). */
  legacyLost: { attacker: number; defender: number };
  /** Conquista **decisa** (il servizio la applica con `transferRegion`). */
  advance: { objectiveRegionId: string; regionName: string | null } | null;
  rolls: { attacker: number; defender: number; breakthrough: number };
  events: string[];
}

/**
 * I reparti che combattono: un reparto **distrutto** non è più una forza (non
 * preme, non consuma, non torna in vita al periodo successivo). La sua riga
 * resta nello stato del paese: la storia non si cancella.
 */
const sideUnits = (
  units: ReadonlyArray<MilitaryUnitState>,
): ReadonlyArray<MilitaryUnitState> => units.filter(unit => unit.status !== 'destroyed');

/**
 * Un **periodo** di fronte: legge i reparti, calcola le pressioni, applica
 * perdite reali a uomini e pezzi, aggiorna prontezza e stato, decide
 * ritirata/sfondamento/conquista. Puro: nessuna scrittura, nessun testo.
 */
export function resolveFront(input: {
  front: WarFrontState;
  epoch: MilitaryEpoch;
  date: string;
  stepDays: number;
  theatre: readonly FrontRegion[];
  attacker: {
    units: ReadonlyArray<MilitaryUnitState>;
    legacyPower: number;
    supply: SideSupply;
    motorized: boolean;
    /** Ordine impresso alle unità legacy (policy NPC) quando non ci sono reparti. */
    legacyOrder?: UnitOrder;
  };
  defender: {
    units: ReadonlyArray<MilitaryUnitState>;
    legacyPower: number;
    supply: SideSupply;
    motorized: boolean;
    legacyOrder?: UnitOrder;
  };
}): FrontResolution {
  const rollAttacker = stableRoll(frontRollSeed({ frontId: input.front.id, date: input.date, phase: 'combat-attacker' }));
  const rollDefender = stableRoll(frontRollSeed({ frontId: input.front.id, date: input.date, phase: 'combat-defender' }));
  const rollBreakthrough = stableRoll(frontRollSeed({ frontId: input.front.id, date: input.date, phase: 'breakthrough' }));
  // Il tiro è una **variazione** (±25%), non il fattore dominante: la forza
  // effettiva resta quella dei reparti e dei rifornimenti.
  const jitter = (roll: number) => 0.75 + 0.5 * roll;

  const attacker = frontSideStrength({
    units: sideUnits(input.attacker.units), epoch: input.epoch, supply: input.attacker.supply,
    motorized: input.attacker.motorized, legacyPower: input.attacker.legacyPower,
    legacyOrder: input.attacker.legacyOrder,
  });
  const defender = frontSideStrength({
    units: sideUnits(input.defender.units), epoch: input.epoch, supply: input.defender.supply,
    motorized: input.defender.motorized, legacyPower: input.defender.legacyPower,
    legacyOrder: input.defender.legacyOrder,
  });

  const attackerPressure = round4(attacker.pressure * jitter(rollAttacker));
  const defenderPressure = round4(defender.pressure * jitter(rollDefender));
  const months = Math.max(0, input.stepDays) / 30;

  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const requiredRifles = rifleRequirement(input.epoch, 1);

  const applySide = (side: 'attacker' | 'defender'): FrontOutcome[] => {
    const own = side === 'attacker' ? attackerPressure : defenderPressure;
    const enemy = side === 'attacker' ? defenderPressure : attackerPressure;
    const units = sideUnits(side === 'attacker' ? input.attacker.units : input.defender.units);
    // Chi ha meno pressione subisce più perdite: il rapporto è il moltiplicatore.
    const pressureRatio = enemy / Math.max(MIN_PRESSURE, own);
    const collapsed = own < enemy * COLLAPSE_RATIO;
    return units.map(unit => {
      const order = (unit.order ?? UNIT_ORDER_DEFAULT) as UnitOrder;
      const strength = unitStrength({ unit, epoch: input.epoch, supply: side === 'attacker' ? input.attacker.supply : input.defender.supply, motorized: side === 'attacker' ? input.attacker.motorized : input.defender.motorized }).strength;
      const rawLoss = COMBAT_LOSS_PER_MONTH * months
        * pressureRatio
        * UNIT_ORDER_INFO[order].losses
        * jitter(side === 'attacker' ? rollAttacker : rollDefender);
      const lossRatio = clamp(rawLoss, 0, MAX_LOSS_RATIO);
      const before = Math.round(Math.max(0, Number(unit.personnel || 0)));
      const personnelLost = Math.min(before, Math.round(before * lossRatio));
      const personnelAfter = Math.max(0, before - personnelLost);
      const attrition = combatAttrition(unit.equipment || {}, lossRatio);
      const riflesAfter = equipmentQuantity(attrition.units, rifleEquipmentId());
      const routed = order === 'withdraw' || collapsed;
      const organic = menPerFormation * DEPLETED_ORGANIC_RATIO;
      const status: MilitaryUnitState['status'] = personnelAfter <= 0
        ? 'destroyed'
        : routed && personnelAfter < organic
          // Reparto in rotta sotto la soglia organica: si sbanda (uomini
          // perduti o catturati). Evita reparti fantasma da cento uomini.
          ? 'destroyed'
          : routed
            ? 'retreating'
            : unitStatusFromCoverage({ assigned: riflesAfter, required: requiredRifles }) === 'degraded' || personnelAfter < organic
              ? 'degraded'
              : unitStatusFromCoverage({ assigned: riflesAfter, required: requiredRifles });
      const readinessAfter = personnelAfter <= 0 ? 0 : unitReadiness({
        unit: { personnel: personnelAfter, equipment: attrition.units, status },
        epoch: input.epoch,
      });
      return {
        unitId: String(unit.id),
        side,
        order,
        personnelLost,
        equipmentLost: attrition.lost,
        personnelAfter,
        equipmentAfter: personnelAfter <= 0 ? {} : attrition.units,
        readinessAfter: round4(readinessAfter),
        statusAfter: status,
        routed,
        strength,
      };
    });
  };

  const outcomes = [...applySide('attacker'), ...applySide('defender')];

  /**
   * Attrito della forza **dichiarata** (quella che sta sulla mappa, non ancora
   * ordinata in reparti): perde la stessa quota di chi combatte. Senza questo,
   * una provincia con molta `militaryPower` e nessun reparto sarebbe
   * invulnerabile, e il fronte non potrebbe mai concludersi.
   */
  const legacyLossRatio = (side: 'attacker' | 'defender'): number => {
    const own = side === 'attacker' ? attackerPressure : defenderPressure;
    const enemy = side === 'attacker' ? defenderPressure : attackerPressure;
    const hasUnits = (side === 'attacker' ? input.attacker.units : input.defender.units)
      .filter(unit => unit.status !== 'destroyed').length > 0;
    const order = side === 'attacker' ? input.attacker.legacyOrder : input.defender.legacyOrder;
    const factor = UNIT_ORDER_INFO[(order ?? UNIT_ORDER_DEFAULT) as UnitOrder].losses;
    const raw = COMBAT_LOSS_PER_MONTH * months * (enemy / Math.max(MIN_PRESSURE, own)) * factor
      * jitter(side === 'attacker' ? rollAttacker : rollDefender);
    // Con reparti schierati la forza dichiarata è solo un supporto (peso minore).
    return clamp(raw, 0, MAX_LOSS_RATIO) * (hasUnits ? LEGACY_SUPPORT_WEIGHT : 1);
  };
  const legacyLost = {
    attacker: round4(attacker.legacyRaw * legacyLossRatio('attacker')),
    defender: round4(defender.legacyRaw * legacyLossRatio('defender')),
  };
  const defenderAlive = outcomes.filter(item => item.side === 'defender' && item.statusAfter !== 'destroyed');
  const attackerAlive = outcomes.filter(item => item.side === 'attacker' && item.statusAfter !== 'destroyed');
  const routedDefender = defenderPressure <= 0 || (defenderAlive.length > 0 && defenderAlive.every(item => item.routed));
  const routedAttacker = attackerPressure <= 0 || (attackerAlive.length > 0 && attackerAlive.every(item => item.routed));

  const advantage = attackerPressure / Math.max(MIN_PRESSURE, defenderPressure);
  const defenderAdvantage = defenderPressure / Math.max(MIN_PRESSURE, attackerPressure);
  const bothZero = attackerPressure <= 0 && defenderPressure <= 0;
  // Sfondamento: vantaggio reale, tiro passato, difensore che non tiene.
  const breakthrough = !bothZero
    && advantage >= BREAKTHROUGH_RATIO
    && !routedAttacker
    && routedDefender
    && rollBreakthrough < BREAKTHROUGH_CHANCE;
  const collapse = !bothZero
    && defenderAdvantage >= BREAKTHROUGH_RATIO
    && !routedDefender
    && routedAttacker;
  const stalemate = !bothZero && !breakthrough && !collapse
    && Math.abs(attackerPressure - defenderPressure) <= STALEMATE_BAND * Math.max(attackerPressure, defenderPressure);

  const status: WarFrontStatus = breakthrough
    ? 'breakthrough'
    : collapse
      ? 'collapsed'
      : stalemate
        ? 'stalemate'
        : 'active';

  // Conquista: **solo** con sfondamento, difensore che non tiene più e obiettivo
  // nel teatro, raggiungibile via adiacenza reale dalla parte attaccante.
  const objectiveId = input.front.objectiveRegionId;
  const objective = objectiveId ? input.theatre.find(region => String(region.id) === String(objectiveId)) : undefined;
  const objectiveReachable = Boolean(objective)
    && Boolean(objective && String(objective.owner) === String(input.front.defenderPolityId))
    && Boolean(objective && (objective.borders || []).some(id => input.theatre.some(region => String(region.id) === String(id) && String(region.owner) === String(input.front.attackerPolityId))));
  const advance = status === 'breakthrough' && routedDefender && objectiveReachable && objective
    ? { objectiveRegionId: String(objective.id), regionName: objective.name ?? null }
    : null;

  return {
    status,
    attackerPressure,
    defenderPressure,
    attackerUnitsPressure: attacker.unitsPressure,
    defenderUnitsPressure: defender.unitsPressure,
    attackerLegacyPressure: attacker.legacyPressure,
    defenderLegacyPressure: defender.legacyPressure,
    outcomes,
    consumption: {
      attacker: warConsumption({ units: input.attacker.units, stepDays: input.stepDays }),
      defender: warConsumption({ units: input.defender.units, stepDays: input.stepDays }),
    },
    routedDefender,
    routedAttacker,
    breakthrough,
    advance,
    legacyLost,
    rolls: { attacker: round4(rollAttacker), defender: round4(rollDefender), breakthrough: round4(rollBreakthrough) },
    events: [],
  };
}

// ── 5. Ritirata e territorio ────────────────────────────────────────────────

/**
 * Prima **provincia amica valida** dove ripiegare: adiacente a quella del
 * reparto, dello stesso proprietario, fuori dal teatro conteso e dall'obiettivo.
 * Riusa l'adiacenza della mappa (`borders`): nessuna geografia nuova.
 */
export function retreatRegionFor(input: {
  unit: Pick<MilitaryUnitState, 'regionId'>;
  side: string;
  /** Province note al servizio: la geografia è quella della mappa. */
  regions: readonly FrontRegion[];
  /** Da evitare: il teatro conteso e l'obiettivo (si ripiega **via** dal fronte). */
  avoid?: readonly string[];
}): FrontRegion | null {
  const from = input.unit.regionId ? input.regions.find(region => String(region.id) === String(input.unit.regionId)) : undefined;
  const avoid = new Set((input.avoid || []).map(String));
  const neighbours = [...(from?.borders || [])].map(String).sort();
  for (const id of neighbours) {
    if (avoid.has(id)) continue;
    const region = input.regions.find(item => String(item.id) === id);
    if (!region) continue;
    if (String(region.owner) !== String(input.side)) continue;
    return region;
  }
  return null;
}

/** Id del fronte: **non direzionale** (lo stesso conflitto è un solo fronte). */
export function frontIdFor(a: string, b: string): string {
  return `front-${[String(a), String(b)].sort().join('-')}`;
}

/** Nome leggibile del fronte dai nomi delle due parti. */
export function frontNameFor(attackerLabel: string, defenderLabel: string): string {
  return `Fronte ${attackerLabel}–${defenderLabel}`;
}

/**
 * Obiettivo del fronte: la provincia del difensore nel teatro adiacente a una
 * provincia dell'attaccante, scelta in modo **deterministico** (la meno
 * difesa, poi l'id). Nessun algoritmo geografico complesso.
 */
export function frontObjectiveFor(input: {
  theatre: readonly FrontRegion[];
  attackerPolityId: string;
  defenderPolityId: string;
}): FrontRegion | null {
  const candidates = input.theatre
    .filter(region => String(region.owner) === String(input.defenderPolityId))
    .filter(region => (region.borders || []).some(id => input.theatre.some(item => String(item.id) === String(id) && String(item.owner) === String(input.attackerPolityId))))
    .sort((a, b) => (Math.max(0, Number(a.militaryPower || 0)) - Math.max(0, Number(b.militaryPower || 0)))
      || String(a.id).localeCompare(String(b.id)));
  return candidates[0] ?? null;
}

/** Etichetta di un esito del fronte, per i dispacci deterministici. */
export function frontStatusSummary(status: WarFrontStatus): string {
  switch (status) {
    case 'breakthrough': return 'sfonda il fronte';
    case 'collapsed': return 'vede il proprio fronte collassare';
    case 'stalemate': return 'resta in stallo';
    case 'forming': return 'si sta formando';
    case 'closed': return 'si chiude';
    default: return 'resta in contatto';
  }
}
