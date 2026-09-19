/**
 * World Story — OP-OBJECTS PERSISTENT: stato proprio degli oggetti
 * =================================================================
 * La direzione cambia: **OGGETTI REALI → AGGREGAZIONE → STATO NAZIONALE → UI**.
 * Un'armata non riceve più una quota dell'aggregato: **possiede** uomini ed
 * equipaggiamento; una fabbrica **possiede** tipo, capacità, lavoratori, ricetta e
 * ordini; una nave **è** un oggetto con equipaggio, carburante e munizioni; una
 * costruzione **è** un cantiere con requisiti e costo residuo.
 *
 * Questo modulo è **puro**: nessun I/O, nessun database, nessun `Math.random`.
 * Definisce i tipi persistiti, il seed **lazy** dagli aggregati legacy (che non
 * cambia il risultato aggregato), le funzioni di trasferimento (uomini,
 * equipaggiamento, equipaggi), la produzione per impianto e l'aggregazione
 * nazionale come **somma degli oggetti**.
 *
 * Scope: solo `Army · Facility · Ship · Fleet · Construction`. Niente diplomazia,
 * NPC, crisi, playback, fazioni, mercato del lavoro, popolazione individuale.
 */
import type { MilitaryManpower, MilitaryEpoch, ReadinessTone } from './MilitaryDoctrine';
import {
  availableReserveOf as reserveAvailable,
  personnelUnderArms,
  type MilitaryPersonnelState,
} from './PersonnelStock';
import { MILITARY_EPOCH_LABEL, OPERATION_MONTHS, individualWeaponShareFor, militaryManpower } from './MilitaryDoctrine';
import { EQUIPMENT_CATALOG, EQUIPMENT_CREW, equipmentById, NATURAL_RESOURCE_LABELS, type NaturalResourceKind } from './MilitaryIndustry';
import type { MaterialNeeds, ResourceStock } from './MaterialEconomy';
import { materialNeeds } from './MaterialEconomy';
import type { NationalAccount } from './WorldStateEngine';
import {
  CAPACITY_PER_FACTORY, CAPACITY_PER_PORT, CAPACITY_PER_UNIVERSITY,
  type IndustrialProjectInput,
} from './IndustrialCapacity';
import type { IndustrialOrderLike } from './OperationalObjects';
import {
  FULL_TANK_MONTHS, OPERATING_STATUS_LABEL, endowmentContribution, fact, marginalPlant, marginalProduction, shortTitle,
  type OperatingAction, type OperatingObject, type OperatingStatus,
} from './OperationalObjects';

const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const n = (value: number) => Math.round(value).toLocaleString('it-IT');

// ── 1. Tipi degli oggetti persistiti ────────────────────────────────────────

/** Addetti per linea: **seed** dichiarato, non più ricalcolo a ogni lettura. */
export const SEED_WORKERS_PER_LINE: Record<'factory' | 'shipyard' | 'university', number> = {
  factory: 900, shipyard: 1200, university: 600,
};
/** Addetti di una miniera: seed proporzionale al giacimento dichiarato. */
export const SEED_WORKERS_PER_MINE_POINT = 340;

/**
 * Giorni di un mese economico. È il metro con cui le ricette dichiarano i propri
 * fabbisogni (mensili) e con cui si misura la copertura di un **periodo
 * parziale**: 15 giorni sono mezzo mese, 45 giorni un mese e mezzo.
 */
export const MATERIAL_MONTH_DAYS = 30;

/**
 * Tipi di impianto con una **funzione concreta**. Non nomi decorativi: ogni tipo
 * ha una ricetta input → output con le risorse già esistenti nel motore.
 */
export type FacilityKind =
  | 'steel_mill' | 'arms_factory' | 'vehicle_factory' | 'aircraft_factory'
  | 'shipyard' | 'research_center' | 'mine';

export const FACILITY_KIND_LABEL: Record<FacilityKind, string> = {
  steel_mill: 'Acciaieria',
  arms_factory: 'Fabbrica di armamenti',
  vehicle_factory: 'Officine meccaniche',
  aircraft_factory: 'Stabilimento aeronautico',
  shipyard: 'Cantiere navale',
  research_center: 'Centro di ricerca',
  mine: 'Miniera',
};

/**
 * Ricette dichiarate: input dalle **risorse già esistenti** (giacimenti e
 * materiali del motore), output nei materiali del motore. Non sono una seconda
 * formula nazionale: sono la **scomposizione** dell'output che il motore calcola
 * con `advanceStock`, e servono a mostrare dove un impianto si blocca.
 */
export interface FacilityRecipe {
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Tecnologie con cui il profilo è stato calcolato (riaggiornamento lazy). */
  technologies?: string[];
}

/**
 * Ricette **dichiarate** degli impianti.
 *
 * Gli `inputs` di questa tabella sono **coefficienti per unità di produzione
 * mensile**, non quantità assolute: un impianto che produce 1,4 unità al mese e
 * ha coefficiente 0,02 consuma 0,028 di quel materiale. Espressi così, i
 * fabbisogni minerari crescono con l'impianto e restano confrontabili con
 * l'estrazione del paese (che cresce con le infrastrutture): nessuna nazione
 * nasce con una filiera impossibile.
 *
 * Il centro di ricerca non ha una catena di materiali: il costo del denaro è
 * una **spesa** (sezione «costi»), non un collo di bottiglia della produzione.
 */
export const FACILITY_RECIPES: Record<FacilityKind, FacilityRecipe> = {
  steel_mill: { inputs: { iron: 0.02, coal: 0.015 }, outputs: { weapons: 0.6 } },
  arms_factory: { inputs: { iron: 0.01, coal: 0.01 }, outputs: { weapons: 0.8 } },
  vehicle_factory: { inputs: { weapons: 0.008, fuel: 0.01 }, outputs: { weapons: 0.7 } },
  aircraft_factory: { inputs: { weapons: 0.006, fuel: 0.012 }, outputs: { weapons: 0.5 } },
  shipyard: { inputs: { iron: 0.015, coal: 0.008 }, outputs: { weapons: 0.4 } },
  research_center: { inputs: {}, outputs: { research: 0.35 } },
  mine: { inputs: {}, outputs: {} },
};

/** Linee di lavorazione di un tipo di impianto (dal motore, non inventate). */
export function facilityCapacityFor(kind: FacilityKind): number {
  switch (kind) {
    case 'shipyard': return CAPACITY_PER_PORT;
    case 'research_center': return CAPACITY_PER_UNIVERSITY;
    default: return CAPACITY_PER_FACTORY;
  }
}

/**
 * Fattore di **stato** di un impianto: operativo produce, fermo no, in
 * manutenzione lavora a metà. Centralizzato: la stessa regola per il tick
 * aggregato, per la scheda e per gli ordini. Un impianto in manutenzione non
 * può produrre come se fosse a pieno regime.
 */
export function facilityStatusFactor(status: FacilityState['status']): number {
  switch (status) {
    case 'operational': return 1;
    case 'maintenance': return 0.5;
    default: return 0;
  }
}

/**
 * Fattore di consumo di una nave: una nave in servizio consuma, una in
 * manutenzione o danneggiata consuma metà, una in costruzione non consuma
 * carburante operativo.
 */
export function shipConsumptionFactor(status: ShipState['status']): number {
  switch (status) {
    case 'operational': return 1;
    case 'maintenance': return 0.5;
    case 'damaged': return 0.5;
    default: return 0;
  }
}

/**
 * Ricetta di un impianto **dal motore**: gli input sono la catena dichiarata,
 * gli output sono il profilo di `marginalPlant` per un impianto di quel tipo,
 * calcolato **senza giacimenti** (l'estrazione naturale resta una voce a sé del
 * bilancio: la somma degli impianti non deve contenere due volte il paese).
 * La firma delle tecnologie resta nella ricetta: quando il paese ne sblocca una
 * nuova, il profilo si riaggiorna (una sola volta).
 */
export function engineFacilityRecipe(kind: FacilityKind, technologies: readonly string[] = []): FacilityRecipe {
  const base = FACILITY_RECIPES[kind];
  const plant = kind === 'shipyard' ? { ports: 1 }
    : kind === 'research_center' ? { universities: 1 }
      : kind === 'mine' ? null : { factories: 1 };
  if (!plant) return base;
  // Produzione **lorda** dell'impianto (`marginalPlant.gross`): il saldo del
  // motore più i soli consumi industriali dell'impianto. Il motore conta già a
  // livello nazionale i fabbisogni civili e militari: sommarli di nuovo
  // significherebbe un doppio consumo.
  const { gross } = marginalPlant(plant, {}, [...technologies]);
  const outputs: Record<string, number> = {};
  for (const [id, value] of Object.entries(gross)) if (value > 0) outputs[id] = round3(value);
  if (Object.keys(outputs).length === 0) return { ...base, technologies: [...technologies] };
  // Fabbisogno materiale = coefficiente dichiarato × produzione dell'impianto.
  const produced = Object.values(outputs).reduce((total, value) => total + value, 0);
  const inputs: Record<string, number> = {};
  for (const [id, coefficient] of Object.entries(base.inputs || {})) {
    const need = round3(nonNegative(coefficient) * produced);
    if (need > 0) inputs[id] = need;
  }
  return { inputs, outputs, technologies: [...technologies].sort() };
}

/**
 * La ricetta salvata dichiara materiali diversi da quelli del motore: schema
 * vecchio (per esempio la cassa fra gli input, che è un costo e non un collo di
 * bottiglia). Le righe scritte prima di una correzione si riallineano da sole.
 */
export function facilityRecipeDrifted(recipe: FacilityRecipe | undefined, current: FacilityRecipe): boolean {
  const keys = (value?: Record<string, number>) => Object.keys(value || {}).sort().join(',');
  return keys(recipe?.inputs) !== keys(current.inputs) || keys(recipe?.outputs) !== keys(current.outputs);
}

/** La ricetta va rifatta? (tecnologie diverse da quelle con cui è nata) */
export function facilityRecipeStale(recipe: FacilityRecipe | undefined, technologies: readonly string[]): boolean {
  const stamp = [...technologies].sort();
  const current = [...(recipe?.technologies || [])].sort();
  return stamp.length !== current.length || stamp.some((id, index) => id !== current[index]);
}

export interface FacilityState {
  id: string;
  kind: FacilityKind;
  name: string;
  regionId: string | null;
  regionName: string | null;
  /** Linee di lavorazione possedute dall'impianto. */
  capacity: number;
  /** Lavoratori: stato **persistente** (seed iniziale, poi solo trasferimenti). */
  workers: number;
  status: 'operational' | 'idle' | 'maintenance' | 'under_construction';
  recipe?: FacilityRecipe;
  /** Ordini realmente assegnati a questo impianto. */
  activeOrders: string[];
  /** Solo miniere: giacimento di origine dichiarata dal registro del paese. */
  resourceKind?: string | null;
  createdDate: string;
  /** Oggetto materializzato da un aggregato legacy: i dati non sono suoi. */
  legacyDerived: boolean;
}

export interface FleetState {
  id: string;
  name: string;
  shipIds: string[];
  createdDate: string;
  legacyDerived: boolean;
}

export interface ShipState {
  id: string;
  name: string;
  equipmentId: string;
  fleetId: string | null;
  crew: number;
  /** Consumo mensile di carburante della nave (contribuisce all'aggregato). */
  monthlyFuel: number;
  /** Munizionamento imbarcato: id voce → pezzi. */
  ammunition: Record<string, number>;
  status: 'operational' | 'maintenance' | 'damaged' | 'under_construction';
  portId: string | null;
  regionId: string | null;
  createdDate: string;
  legacyDerived: boolean;
}

export interface ConstructionState {
  id: string;
  targetType: FacilityKind | 'ship';
  targetName: string;
  regionId: string | null;
  regionName: string | null;
  progress: number;
  materialRequirements: Record<string, number>;
  capacityDemand: number;
  costRemaining: number;
  expectedDate: string | null;
  createdDate: string;
  legacyDerived: boolean;
}

export interface ArmyOperationalState {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
  formations: number;
  personnel: number;
  /** Equipaggiamento **assegnato** all'armata (sottratto dal deposito). */
  equipment: Record<string, number>;
  monthlyNeeds: { fuel: number; weapons: number; food: number };
  status: 'forming' | 'operational' | 'degraded' | 'maintenance';
  /** Oggetto reale della mappa (armate derivate: `null`). */
  objectId: string | null;
  createdDate: string;
  legacyDerived: boolean;
}

/** Ordine di battaglia di un reparto (P7): persistente, decide i fattori del fronte. */
export type UnitOrder = 'attack' | 'defend' | 'reserve' | 'withdraw';

/** Ordine di un reparto senza fronte: si difende (nessun ordine dato dal giocatore). */
export const UNIT_ORDER_DEFAULT: UnitOrder = 'defend';

export const UNIT_ORDER_LABEL: Record<UnitOrder, string> = {
  attack: 'Attacca',
  defend: 'Difendi',
  reserve: 'Riserva',
  withdraw: 'Ritirati',
};

/**
 * Fattori **minimi e centralizzati** dell'ordine di battaglia (P8): quanto pesa
 * sulla pressione, quanto espone alle perdite, quanto consuma in un fronte
 * attivo. Sono gli stessi numeri per il giocatore e per gli NPC, e li legge sia
 * il `FrontEngine` sia la scheda del reparto: nessuna copia da tenere allineata.
 */
export const UNIT_ORDER_INFO: Record<UnitOrder, { pressure: number; losses: number; consumption: number; note: string }> = {
  attack: { pressure: 1.35, losses: 1.25, consumption: 1.8, note: 'Assalto: più pressione, più perdite, più consumi.' },
  defend: { pressure: 1, losses: 0.85, consumption: 1.2, note: 'Difesa: pressione piena, perdite contenute.' },
  reserve: { pressure: 0.45, losses: 0.5, consumption: 0.8, note: 'Riserva: contributo ridotto, perdite basse.' },
  withdraw: { pressure: 0, losses: 0.7, consumption: 1, note: 'Ritirata: nessuna pressione, ripiegamento verso una provincia amica.' },
};

/** Stato di un fronte: le fasi del combattimento strategico (mai tattico). */
export type WarFrontStatus = 'forming' | 'active' | 'stalemate' | 'breakthrough' | 'collapsed' | 'closed';

export const FRONT_STATUS_LABEL: Record<WarFrontStatus, string> = {
  forming: 'In formazione',
  active: 'Attivo',
  stalemate: 'In stallo',
  breakthrough: 'Sfondamento',
  collapsed: 'Collassato',
  closed: 'Chiuso',
};

/**
 * Un **fronte di guerra** (P6): il livello **strategico** del conflitto —
 * territorio conteso, unità coinvolte, obiettivo, pressione e stato. Non è un
 * wargame tattico: non ha esagoni, linee o battaglie a sé.
 *
 * La fonte autorevole dell'assegnazione è `MilitaryUnit.frontId`: il fronte
 * **deriva** le sue unità da lì, non tiene un secondo elenco.
 */
export interface WarFrontState {
  id: string;
  name: string;
  attackerPolityId: string;
  defenderPolityId: string;
  /** Teatro: le province di confine realmente contese (adiacenza della mappa). */
  regionIds: string[];
  status: WarFrontStatus;
  /** Provincia che l'attaccante vuole conquistare (`null` finché non c'è). */
  objectiveRegionId: string | null;
  attackerPressure: number;
  defenderPressure: number;
  /**
   * PR3 — **read model**: la polity con l'iniziativa nell'ultimo periodo
   * (pressione prevalente). Non è un bonus e non entra in nessun calcolo: serve
   * alla lettura e alla memoria del fronte, niente moltiplicatori nascosti.
   */
  momentumPolityId?: string | null;
  createdDate: string;
  updatedDate: string;
}

/**
 * Un **reparto** (unità militare): la granularità sotto l'armata. È un oggetto
 * persistente con uomini, equipaggiamento e fabbisogni propri; l'armata che lo
 * contiene è la **somma** dei suoi reparti (una sola fonte di verità).
 */
export interface MilitaryUnitState {
  id: string;
  /**
   * P4 — **authority dell'appartenenza nazionale**. La regione dice **dove** sta
   * il reparto; `polityId` dice **a chi appartiene**. Non si deduce mai dalla
   * provincia corrente: una conquista non cambia la nazionalità di chi
   * combatteva lì.
   */
  polityId: string;
  /** Armata di appartenenza (id dell'oggetto dello stato). */
  armyId: string;
  name: string;
  personnel: number;
  /** Equipaggiamento **assegnato al reparto** (sottratto dal deposito). */
  equipment: Record<string, number>;
  monthlyNeeds: { fuel: number; weapons: number; food: number };
  /** Prontezza derivata (`unitReadiness`), 0…1: cache ricalcolabile. */
  readiness: number;
  status: 'forming' | 'operational' | 'degraded' | 'retreating' | 'destroyed';
  regionId: string | null;
  regionName: string | null;
  updatedDate: string;
  /** Materializzato da un aggregato legacy (non deciso dal giocatore). */
  legacyDerived: boolean;
  /** Ordine di battaglia (P7), persistente: decide pressione, perdite e consumi. */
  order: UnitOrder;
  /** Fronte di appartenenza (P6): `null` se il reparto non è impegnato. */
  frontId: string | null;
}

/** Stato persistente completo di una partita (le armate sono oggetti della mappa). */
export interface OperationalStateSnapshot {
  personnel: MilitaryPersonnelState;
  armies: ArmyOperationalState[];
  units: MilitaryUnitState[];
  fronts: WarFrontState[];
  facilities: FacilityState[];
  ships: ShipState[];
  fleets: FleetState[];
  constructions: ConstructionState[];
}

/** Stato vuoto: nessun oggetto persistente (partita legacy). */
export function emptyOperationalState(date: string): OperationalStateSnapshot {
  return {
    personnel: { activePersonnel: 0, trainedReserve: 0, mobilizedPersonnel: 0, shipCrew: 0, updatedDate: date },
    armies: [], units: [], fronts: [], facilities: [], ships: [], fleets: [], constructions: [],
  };
}

/**
 * Normalizza un reparto letto dalla persistenza: `order` e `frontId` sono nati
 * con P7 (MILITARY-UNITS PR2) e i salvataggi precedenti non li hanno. Un reparto
 * senza ordine si difende: nessun ordine d'attacco inventato da una lettura.
 */
export function normalizeUnitState(raw: unknown, fallbackPolityId?: string): MilitaryUnitState {
  const unit = raw as Partial<MilitaryUnitState> & { id: string };
  const order = unit.order && unit.order in UNIT_ORDER_LABEL ? unit.order : UNIT_ORDER_DEFAULT;
  // P4 — retro-compatibilità: i salvataggi PR1–PR3 non hanno `polityId`. Il
  // fallback è la polity **giocante**, mai l'owner corrente della provincia
  // (era la deduzione che rendeva un reparto «nazionale» di chi conquistava).
  const polityId = unit.polityId ? String(unit.polityId) : String(fallbackPolityId || '');
  return {
    ...(unit as MilitaryUnitState),
    polityId,
    order,
    frontId: unit.frontId ? String(unit.frontId) : null,
  };
}

// ── 2. Manpower: dottrina (capacità) vs stock (stato) ───────────────────────
// Le funzioni vivono in `PersonnelStock.ts` (modulo senza dipendenze) e sono
// riesportate qui: il quadro operativo, la formazione e i test usano le stesse.
export {
  personnelUnderArms, personnelOverlay, availableReserveOf, personnelInvariant,
  transferMenToArmy, transferCrewToShip, transferCrewFromShip,
} from './PersonnelStock';
export type { MilitaryPersonnelState } from './PersonnelStock';

// ── 3. Equipaggiamento: deposito vs assegnato ───────────────────────────────

export interface EquipmentTransfer {
  depot: Record<string, number>;
  assigned: Record<string, number>;
}

const addTo = (bag: Record<string, number>, id: string, quantity: number): void => {
  const next = Math.max(0, Math.round((bag[id] || 0) + quantity));
  if (next > 0) bag[id] = next;
  else delete bag[id];
};

/**
 * Sposta i pezzi dal **deposito** all'**armata**. Non crea e non distrugge:
 * `deposito + assegnato` resta il totale nazionale. `null` se il deposito non ha
 * abbastanza pezzi (l'azione viene rifiutata, non forzata).
 */
export function transferEquipment(input: {
  depot: Record<string, number>;
  assigned: Record<string, number>;
  items: Array<{ equipmentId: string; quantity: number }>;
}): EquipmentTransfer | null {
  const depot: Record<string, number> = { ...input.depot };
  const assigned: Record<string, number> = { ...input.assigned };
  for (const item of input.items) {
    const wanted = Math.max(0, Math.round(nonNegative(item.quantity)));
    if (wanted <= 0) continue;
    if (nonNegative(depot[item.equipmentId]) < wanted) return null;
  }
  for (const item of input.items) {
    const wanted = Math.max(0, Math.round(nonNegative(item.quantity)));
    if (wanted <= 0) continue;
    addTo(depot, item.equipmentId, -wanted);
    addTo(assigned, item.equipmentId, wanted);
  }
  return { depot, assigned };
}

/** Totale nazionale per voce: deposito + assegnato (+ oggetti navali). */
export function equipmentTotals(...bags: Array<Record<string, number>>): Record<string, number> {
  const total: Record<string, number> = {};
  for (const bag of bags) {
    for (const [id, quantity] of Object.entries(bag || {})) addTo(total, id, nonNegative(quantity));
  }
  return total;
}

/** Invariante: il totale nazionale è esattamente la somma delle parti. */
export function equipmentInvariant(
  depot: Record<string, number>,
  assigned: Record<string, number>,
  nationalTotal: Record<string, number>,
): boolean {
  const sum = equipmentTotals(depot, assigned);
  const ids = new Set([...Object.keys(sum), ...Object.keys(nationalTotal || {})]);
  for (const id of ids) {
    if (Math.abs(nonNegative(sum[id]) - nonNegative(nationalTotal?.[id])) > 1e-6) return false;
  }
  return true;
}

/** Equipaggiamento assegnato delle armate + munizionamento/ scafi delle navi. */
export function assignedEquipmentOf(input: {
  armies: readonly ArmyOperationalState[];
  ships?: readonly ShipState[];
}): Record<string, number> {
  const total: Record<string, number> = {};
  for (const army of input.armies) {
    for (const [id, quantity] of Object.entries(army.equipment || {})) addTo(total, id, quantity);
  }
  for (const ship of input.ships || []) {
    // Lo scafo è equipaggiamento in servizio, il munizionamento è assegnato.
    addTo(total, ship.equipmentId, 1);
    for (const [id, quantity] of Object.entries(ship.ammunition || {})) addTo(total, id, quantity);
  }
  return total;
}

// ── 4. Fabbriche: produzione dallo stato dell'oggetto ───────────────────────

/**
 * Materiali che vivono **in magazzino** (`ResourceStock`): per gli altri la
 * disponibilità è il **giacimento** dichiarato dal registro del paese. Senza
 * questa distinzione un'acciaieria risulterebbe ferma in un mondo in cui il
 * ferro è un giacimento e non una scorta.
 */
const STOCK_MATERIALS = new Set(['food', 'clothing', 'weapons', 'fuel', 'research', 'money']);

/** Etichette leggibili dei materiali del motore e dei giacimenti. */
const MATERIAL_LABELS: Record<string, string> = {
  food: 'Cibo', clothing: 'Vestiario', weapons: 'Armamenti', fuel: 'Carburante',
  research: 'Punti ricerca', money: 'Cassa',
};

/** Nome leggibile di un materiale/giacimento/voce di catalogo. */
export function materialLabel(id: string): string {
  return MATERIAL_LABELS[id]
    || NATURAL_RESOURCE_LABELS[id as NaturalResourceKind]
    || equipmentById(id)?.name
    || id;
}

/** Disponibilità di un input: scorta se è un materiale, giacimento altrimenti. */
export function inputAvailability(
  id: string,
  stock: Record<string, number> | undefined,
  endowment: Record<string, number> | undefined,
): number {
  return STOCK_MATERIALS.has(id) ? nonNegative(stock?.[id]) : nonNegative(endowment?.[id] ?? stock?.[id]);
}

export interface FacilityProductionResult {
  /** Fattore applicato: `min(attività, disponibilità input)`, sempre 0…1. */
  factor: number;
  outputs: Record<string, number>;
  inputs: Record<string, number>;
  /** Input che limita la produzione (id e copertura %). */
  bottleneck: { id: string; coveragePct: number; required: number; available: number } | null;
}

/**
 * Produzione di un impianto dal suo **stato**: la ricetta dice cosa serve e cosa
 * esce; lo stock reale dice quanto se ne può fare. Input insufficiente ⇒
 * produzione ridotta in proporzione; input assente ⇒ produzione zero.
 */
export function facilityProduction(facility: FacilityState, ctx: {
  stock?: Record<string, number>;
  /** Giacimenti dichiarati (per gli input che non sono scorte materiali). */
  endowment?: Record<string, number>;
  /** Attività delle linee (0…1): impianto fermo ⇒ zero. */
  activity?: number;
}): FacilityProductionResult {
  const recipe = facility.recipe ?? FACILITY_RECIPES[facility.kind];
  const activity = Math.max(0, Math.min(1, ctx.activity === undefined ? 1 : ctx.activity)) * facilityStatusFactor(facility.status);
  if (activity <= 0) {
    return { factor: 0, outputs: {}, inputs: {}, bottleneck: null };
  }
  const stock = ctx.stock || {};
  let inputFactor = 1;
  let bottleneck: FacilityProductionResult['bottleneck'] = null;
  for (const [id, required] of Object.entries(recipe.inputs || {})) {
    const need = nonNegative(required) * activity;
    if (need <= 0) continue;
    const have = inputAvailability(id, stock, ctx.endowment);
    const coverage = Math.min(1, have / need);
    if (coverage < inputFactor) {
      inputFactor = coverage;
      bottleneck = { id, coveragePct: round1(coverage * 100), required: round2(need), available: round2(have) };
    }
  }
  const factor = Math.max(0, Math.min(activity, inputFactor));
  const outputs: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(recipe.outputs || {})) {
    const value = round3(nonNegative(quantity) * factor);
    if (value > 0) outputs[id] = value;
  }
  const inputs: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(recipe.inputs || {})) {
    const value = round3(nonNegative(quantity) * factor);
    if (value > 0) inputs[id] = value;
  }
  return { factor: round3(factor), outputs, inputs, bottleneck };
}

// ── 4-bis. Pass di allocazione: più impianti, **una sola** scorta ───────────

export interface FacilityAllocationEntry {
  facilityId: string;
  kind: FacilityKind;
  /**
   * Fattore realmente applicato: stato × attività × **copertura del fabbisogno
   * del periodo**. È una frazione 0…1 del bisogno del periodo, non del mese:
   * con 15 giorni e il fabbisogno del periodo coperto vale 1 anche se il mese
   * intero non sarebbe coperto (OP-OBJECTS PARTIAL-PERIOD).
   */
  factor: number;
  /**
   * Fattore **materiale** dell'impianto (stato × copertura del periodo), senza
   * il fattore di capacità industriale del paese: gli ordini lo applicano al
   * proprio tempo, che la saturazione delle linee scala già a parte.
   */
  materialFactor: number;
  statusFactor: number;
  /** Quanto l'impianto **prende** davvero, **mensile** (input × fattore). */
  inputs: Record<string, number>;
  /** Quanto l'impianto **produce** davvero, **mensile**. */
  outputs: Record<string, number>;
  /** Causa reale del rallentamento: richiesto, assegnato, copertura. */
  bottleneck: { id: string; required: number; assigned: number; coveragePct: number } | null;
}

/**
 * Risultato del passaggio di allocazione: **un contratto, nessun campo ambiguo**.
 *
 * | campo | unità | chi lo scala |
 * |---|---|---|
 * | `facilities[].factor` / `materialFactor` | frazione 0…1 del **fabbisogno del periodo** coperta | già scala |
 * | `facilities[].inputs` / `facilities[].outputs` | **mensile** | `advanceStock` × `period` |
 * | `totalInputs` / `totalOutputs` | **mensile** | `advanceStock` × `period` |
 * | `naturalInputs` | **quantità del periodo** (già × period × ratio) | nessuno: prelevata dal silo |
 * | `remaining` | quantità del periodo | diagnostica |
 *
 * Il prelievo dai **giacimenti** (`naturalInputs`) è l'unico già scalato dal
 * tempo: passa da `drawResourceStockpile`, non da `advanceStock`. Scalarlo due
 * volte sarebbe un doppio conteggio.
 */
export interface FacilityAllocation {
  facilities: FacilityAllocationEntry[];
  /** **Mensile**: `advanceStock` lo scala per il tempo del periodo. */
  totalInputs: Record<string, number>;
  /** **Mensile**: `advanceStock` lo scala per il tempo del periodo. */
  totalOutputs: Record<string, number>;
  /** Disponibilità non usata dopo l'allocazione (diagnostica). */
  remaining: Record<string, number>;
  /**
   * Materiali presi dai **giacimenti** (estrazione), non dalle scorte: è la
   * quantità **del periodo**, già scalata dal tempo. Nessuno la riscala.
   */
  naturalInputs: Record<string, number>;
  /** Mesi del periodo allocato (`stepDays / 30`): 1 = mese pieno. */
  period: number;
}

const floor3 = (value: number) => Math.floor(value * 1000 + 1e-9) / 1000;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Alloca la produzione di **tutti** gli impianti insieme.
 *
 * Il problema che risolve: ogni impianto non può verificare i propri input
 * contro la stessa scorta nazionale (due acciaierie da 20 su una scorta di 20
 * non possono lavorare entrambe a pieno). La policy è **proporzionale**:
 * la disponibilità di ciascun materiale viene divisa fra gli impianti in
 * proporzione al loro fabbisogno — stabile e indipendente dall'ordine.
 *
 *   domanda 40, disponibilità 20  →  ogni impianto al 50%
 *
 * Gli input usati sono quelli **effettivamente presi**: la somma non supera mai
 * la disponibilità. Un materiale che non è una scorta (ferro, carbone…) è
 * **estrazione del mese**, non giacimento infinito: la disponibilità la decide
 * il chiamante.
 *
 * Il fabbisogno è **mensile**, ma la copertura si misura sul **periodo**
 * (`stepDays`): quindici giorni sono mezzo mese, non un mese intero. Con
 * `stepDays` assente/30 tutto è identico alla lettura del mese pieno.
 */
export function allocateFacilityProduction(input: {
  facilities: readonly FacilityState[];
  /** Disponibilità del periodo per materiale (scorte + estrazione). */
  availability?: Record<string, number>;
  /** Scorte reali (fallback se `availability` non è fornita). */
  stock?: Record<string, number>;
  /** Giacimenti dichiarati (solo fallback delle funzioni pure). */
  endowment?: Record<string, number>;
  /** Attività nazionale delle linee (0…1), dal motore. */
  activity?: number;
  /**
   * Giorni del periodo materiale (default 30 = un mese: la lettura del Dossier
   * resta identica). `period = stepDays / 30`.
   */
  stepDays?: number;
}): FacilityAllocation {
  const activity = Math.max(0, Math.min(1, input.activity === undefined ? 1 : input.activity));
  // Mezzo mese è mezzo fabbisogno: la disponibilità si confronta col bisogno
  // **del periodo**, non con quello del mese intero.
  const period = Math.max(0, input.stepDays === undefined ? MATERIAL_MONTH_DAYS : input.stepDays) / MATERIAL_MONTH_DAYS;
  /**
   * Disponibilità di un input.
   *
   * Il chiamante dichiara **solo** ciò che può razionare: le scorte del
   * magazzino e i giacimenti che hanno un silo. Un materiale non dichiarato non
   * è un collo di bottiglia: il motore non ha una filiera estrattiva da
   * limitare (l'approvvigionamento passa dal mercato, che vive altrove) e
   * bloccare la produzione sarebbe inventare un vincolo che non esiste.
   * `Infinity` = nessun razionamento.
   */
  const availability = (id: string): number => {
    if (input.availability) return id in input.availability ? nonNegative(input.availability[id]) : Number.POSITIVE_INFINITY;
    return input.availability === undefined && !input.stock
      ? Number.POSITIVE_INFINITY
      : inputAvailability(id, input.stock, input.endowment) || Number.POSITIVE_INFINITY;
  };
  const plants = input.facilities.filter(facility => facility.kind !== 'mine');
  const prepared = plants.map(facility => {
    const recipe = facility.recipe ?? FACILITY_RECIPES[facility.kind];
    const statusFactor = facilityStatusFactor(facility.status);
    const base = statusFactor * activity;
    const required: Record<string, number> = {};
    const periodNeed: Record<string, number> = {};
    for (const [id, quantity] of Object.entries(recipe.inputs || {})) {
      const need = nonNegative(quantity) * base;
      if (need > 0) {
        required[id] = need;                 // MENSILE: lo scala advanceStock
        periodNeed[id] = need * period;      // FABBISOGNO DEL PERIODO
      }
    }
    return { facility, recipe, statusFactor, base, required, periodNeed };
  });

  // Fabbisogno complessivo **del periodo** per materiale e quota disponibile.
  const demand: Record<string, number> = {};
  for (const item of prepared) {
    for (const [id, need] of Object.entries(item.periodNeed)) demand[id] = (demand[id] || 0) + need;
  }
  const share: Record<string, number> = {};
  for (const [id, need] of Object.entries(demand)) {
    share[id] = need > 0 ? Math.min(1, availability(id) / need) : 1;
  }

  const entries: FacilityAllocationEntry[] = [];
  const totalInputs: Record<string, number> = {};
  const totalOutputs: Record<string, number> = {};
  /** Input **del periodo** (mensile × period): è la quantità davvero tolta alle
   * scorte in `advanceStock` e dai giacimenti in `drawResourceStockpile`. */
  const stepInputs: Record<string, number> = {};
  for (const item of prepared) {
    let ratio = 1;
    let tightest: string | null = null;
    for (const id of Object.keys(item.required)) {
      const value = share[id] ?? 1;
      if (value < ratio) { ratio = value; tightest = id; }
    }
    const factor = item.base * ratio;
    const outputs: Record<string, number> = {};
    for (const [id, quantity] of Object.entries(item.recipe.outputs || {})) {
      const value = round3(nonNegative(quantity) * factor);
      if (value > 0) outputs[id] = value;
      if (value > 0) totalOutputs[id] = round3((totalOutputs[id] || 0) + value);
    }
    const taken: Record<string, number> = {};
    for (const [id, need] of Object.entries(item.required)) {
      const value = floor3(need * ratio);
      if (value > 0) {
        taken[id] = value;
        totalInputs[id] = round3((totalInputs[id] || 0) + value);
        stepInputs[id] = round3((stepInputs[id] || 0) + value * period);
      }
    }
    const bottleneck = tightest
      ? {
        id: tightest,
        required: round2(item.periodNeed[tightest]),
        assigned: round2((taken[tightest] || 0) * period),
        coveragePct: round1((share[tightest] ?? 1) * 100),
      }
      : null;
    entries.push({
      facilityId: item.facility.id,
      kind: item.facility.kind,
      factor: round4(factor),
      materialFactor: round4(item.statusFactor * ratio),
      statusFactor: item.statusFactor,
      inputs: taken,
      outputs,
      bottleneck,
    });
  }

  const remaining: Record<string, number> = {};
  for (const id of Object.keys(demand)) {
    const available = availability(id);
    // La disponibilità è quella **del periodo**: si sottrae ciò che il periodo
    // prende davvero, non il fabbisogno mensile.
    if (Number.isFinite(available)) remaining[id] = round3(Math.max(0, available - (stepInputs[id] || 0)));
  }
  const naturalInputs: Record<string, number> = {};
  for (const [id, value] of Object.entries(stepInputs)) {
    if (!STOCK_MATERIALS.has(id)) naturalInputs[id] = value;
  }
  return { facilities: entries, totalInputs, totalOutputs, remaining, naturalInputs, period };
}

// ── 5. Aggregazione: il paese è la somma degli oggetti ──────────────────────

export interface OperationalAggregate {
  /** Uomini sotto le armi di terra (somma delle armate). */
  soldiers: number;
  /** Equipaggi navali (somma delle navi). */
  crew: number;
  /** Uomini sotto le armi in totale. */
  underArms: number;
  fuelNeed: number;
  weaponsNeed: number;
  foodNeed: number;
  /** Equipaggiamento assegnato agli oggetti (armate + navi). */
  assigned: Record<string, number>;
  /** Capacità industriale posseduta dagli impianti (linee). */
  capacity: number;
  /** Produzione mensile degli impianti (materiali del motore). */
  output: Record<string, number>;
  /** Consumo mensile di input degli impianti. */
  input: Record<string, number>;
  workers: number;
  activeOrders: number;
  ships: number;
  fleets: number;
  constructions: number;
  /** Numero di oggetti derivati da un aggregato legacy (dati non propri). */
  legacyDerived: number;
}

/**
 * Aggregato nazionale come **somma degli oggetti**. I fabbisogni delle armate
 * sono quelli dichiarati sull'oggetto; se un'armata è legacy, il chiamante le
 * assegna un fabbisogno proporzionale (fallback dichiarato) prima di aggregare.
 */
export function aggregateObjects(input: {
  armies: readonly ArmyOperationalState[];
  facilities?: readonly FacilityState[];
  ships?: readonly ShipState[];
  fleets?: readonly FleetState[];
  constructions?: readonly ConstructionState[];
  /** Stock materiale reale (per la produzione effettiva degli impianti). */
  stock?: Record<string, number>;
  /** Giacimenti dichiarati (input non materiali delle ricette). */
  endowment?: Record<string, number>;
  /** Attività nazionale delle linee (0…1), dal motore. */
  activity?: number;
  /** Pass di allocazione già calcolato: gli stessi numeri del tick. */
  allocation?: FacilityAllocation;
}): OperationalAggregate {
  const armies = input.armies || [];
  const facilities = input.facilities || [];
  const ships = input.ships || [];
  const fleets = input.fleets || [];
  const constructions = input.constructions || [];

  const soldiers = Math.round(armies.reduce((total, army) => total + nonNegative(army.personnel), 0));
  const crew = Math.round(ships.reduce((total, ship) => total + nonNegative(ship.crew), 0));
  const fuelNeed = round3(armies.reduce((total, army) => total + nonNegative(army.monthlyNeeds?.fuel), 0)
    + ships.reduce((total, ship) => total + nonNegative(ship.monthlyFuel), 0));
  const weaponsNeed = round3(armies.reduce((total, army) => total + nonNegative(army.monthlyNeeds?.weapons), 0));
  const foodNeed = round3(armies.reduce((total, army) => total + nonNegative(army.monthlyNeeds?.food), 0));

  const output: Record<string, number> = {};
  const consumed: Record<string, number> = {};
  let capacity = 0;
  let workers = 0;
  let activeOrders = 0;
  for (const facility of facilities) {
    // Le miniere non possiedono linee di lavorazione: il giacimento non è
    // capacità industriale (stessa regola di `industrialCapacityTotal`).
    if (facility.kind !== 'mine') capacity += nonNegative(facility.capacity);
    workers += nonNegative(facility.workers);
    activeOrders += (facility.activeOrders || []).length;
    const allocated = input.allocation?.facilities.find(entry => entry.facilityId === facility.id);
    const production = allocated
      ? { outputs: allocated.outputs, inputs: allocated.inputs }
      : facilityProduction(facility, { stock: input.stock, endowment: input.endowment, activity: input.activity ?? 1 });
    for (const [id, quantity] of Object.entries(production.outputs)) addTo(output, id, quantity);
    for (const [id, quantity] of Object.entries(production.inputs)) addTo(consumed, id, quantity);
  }
  const legacyDerived = [...armies, ...facilities, ...ships, ...fleets, ...constructions]
    .filter(object => object.legacyDerived).length;
  return {
    soldiers,
    crew,
    underArms: soldiers + crew,
    fuelNeed,
    weaponsNeed,
    foodNeed,
    assigned: assignedEquipmentOf({ armies, ships }),
    capacity: Math.round(capacity),
    output: Object.fromEntries(Object.entries(output).map(([id, value]) => [id, round3(value)])),
    input: Object.fromEntries(Object.entries(consumed).map(([id, value]) => [id, round3(value)])),
    workers: Math.round(workers),
    activeOrders,
    ships: ships.length,
    fleets: fleets.length,
    constructions: constructions.length,
    legacyDerived,
  };
}

// ── 6. Seed lazy dagli aggregati legacy (non cambia il risultato) ────────────

export interface SeedRegion {
  id: string;
  name?: string;
  population?: number;
  coastal?: boolean;
}

const orderedRegions = (regions: readonly SeedRegion[]): SeedRegion[] =>
  [...regions].sort((a, b) => (nonNegative(b.population) - nonNegative(a.population)) || String(a.id).localeCompare(String(b.id)));
const coastalRegions = (regions: readonly SeedRegion[]): SeedRegion[] =>
  [...regions].sort((a, b) => Number(Boolean(b.coastal)) - Number(Boolean(a.coastal)) || (nonNegative(b.population) - nonNegative(a.population)));

const FACTORY_KIND_CYCLE: FacilityKind[] = ['steel_mill', 'arms_factory', 'vehicle_factory', 'aircraft_factory'];
const FACTORY_NAME_POOL: Record<string, string[]> = {
  steel_mill: ['Acciaieria', 'Impianti siderurgici'],
  arms_factory: ['Fabbrica di armamenti', 'Stabilimento balistico'],
  vehicle_factory: ['Officine meccaniche', 'Fabbrica di veicoli'],
  aircraft_factory: ['Stabilimento aeronautico', 'Officine aeronautiche'],
  shipyard: ['Cantiere navale', 'Arsenale marittimo'],
  research_center: ['Università e politecnico', 'Istituto di ricerca applicata'],
  mine: ['Miniera'],
};

/** Nome dichiarato di un impianto (seed): tipo + provincia. */
export function facilityNameFor(kind: FacilityKind, index: number, regionName: string): string {
  const pool = FACTORY_NAME_POOL[kind] || ['Impianto'];
  return `${pool[index % pool.length]} ${regionName}`.trim();
}

/**
 * Materializza le **fabbriche** dagli aggregati legacy (`factories`, `ports`,
 * `universities`): stesse linee di capacità del motore, tipo e ricetta concreti,
 * lavoratori dal seed dichiarato. Gli aggregati non cambiano: cambia solo chi
 * possiede il dato.
 */
export function seedFacilities(input: {
  polityId: string;
  factories: number;
  ports: number;
  universities: number;
  regions: readonly SeedRegion[];
  date: string;
  endowment?: Record<string, number>;
  /**
   * Ricetta dichiarata dal **motore** per un impianto di quel tipo
   * (`marginalPlant`: produce/consuma): la scomposizione dell'aggregato
   * nazionale diventa così la somma degli impianti. Assente ⇒ ricetta di base.
   */
  recipeOf?: (kind: FacilityKind) => FacilityRecipe | undefined;
}): FacilityState[] {
  const ordered = orderedRegions(input.regions);
  const coastal = coastalRegions(input.regions);
  const facilities: FacilityState[] = [];
  // Ricetta di un impianto: input dichiarati (la catena dei materiali) e output
  // dal profilo del motore, quando disponibile.
  const recipeFor = (kind: FacilityKind): FacilityRecipe =>
    (input.recipeOf ? input.recipeOf(kind) : undefined) || FACILITY_RECIPES[kind];
  let index = 0;
  const push = (kind: FacilityKind, region: SeedRegion | undefined, workers: number) => {
    const capacity = facilityCapacityFor(kind);
    facilities.push({
      id: `${kind}-${input.polityId}-${index + 1}`,
      kind,
      name: facilityNameFor(kind, index, region?.name || 'nazionale'),
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      capacity,
      workers,
      status: 'operational',
      recipe: recipeFor(kind),
      activeOrders: [],
      createdDate: input.date,
      legacyDerived: true,
    });
    index += 1;
  };
  const factories = Math.max(0, Math.round(nonNegative(input.factories)));
  for (let i = 0; i < factories; i += 1) {
    const kind = FACTORY_KIND_CYCLE[i % FACTORY_KIND_CYCLE.length];
    const region = ordered.length > 0 ? ordered[i % ordered.length] : undefined;
    const capacity = facilityCapacityFor(kind);
    facilities.push({
      id: `factory-${input.polityId}-${facilities.length + 1}`,
      kind,
      name: facilityNameFor(kind, i, region?.name || 'nazionale'),
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      capacity,
      workers: SEED_WORKERS_PER_LINE.factory * capacity,
      status: 'operational',
      recipe: recipeFor(kind),
      activeOrders: [],
      createdDate: input.date,
      legacyDerived: true,
    });
  }
  const ports = Math.max(0, Math.round(nonNegative(input.ports)));
  for (let i = 0; i < ports; i += 1) {
    const region = coastal.length > 0 ? coastal[i % coastal.length] : (ordered[i % Math.max(1, ordered.length)]);
    push('shipyard', region, SEED_WORKERS_PER_LINE.shipyard * CAPACITY_PER_PORT);
  }
  const universities = Math.max(0, Math.round(nonNegative(input.universities)));
  for (let i = 0; i < universities; i += 1) {
    const region = ordered.length > 0 ? ordered[i % ordered.length] : undefined;
    push('research_center', region, SEED_WORKERS_PER_LINE.university * CAPACITY_PER_UNIVERSITY);
  }
  // Miniere: un impianto per giacimento **dichiarato** (assente ≠ zero).
  for (const [kind, amount] of Object.entries(input.endowment || {})) {
    const points = nonNegative(amount);
    if (points <= 0) continue;
    const isMine = ['iron', 'coal', 'oil', 'gas', 'copper', 'bauxite', 'uranium', 'gold', 'diamonds', 'lithium', 'rare_earths', 'timber'].includes(kind);
    if (!isMine) continue;
    const region = ordered.length > 0 ? ordered[facilities.length % ordered.length] : undefined;
    facilities.push({
      id: `mine-${input.polityId}-${kind}`,
      kind: 'mine',
      name: `${FACILITY_KIND_LABEL.mine} di ${kind}${region?.name ? ` (${region.name})` : ''}`,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      capacity: Math.max(1, Math.round(points)),
      workers: Math.max(120, Math.round(points * SEED_WORKERS_PER_MINE_POINT)),
      status: 'operational',
      recipe: { inputs: {}, outputs: {} },
      activeOrders: [],
      resourceKind: kind,
      createdDate: input.date,
      legacyDerived: true,
    });
  }
  return facilities;
}

/**
 * Materializza le **navi** dagli scafi in arsenale: una nave per scafo, con
 * equipaggio di catalogo e consumo di carburante attribuito. Le flotte
 * raggruppano gli scafi per categoria (una flotta per categoria).
 */
export function seedShips(input: {
  polityId: string;
  units: Record<string, number>;
  crewShareOfReserve?: boolean;
  date: string;
  regions?: readonly SeedRegion[];
  regionId?: string | null;
}): { ships: ShipState[]; fleets: FleetState[] } {
  const ships: ShipState[] = [];
  const fleets: FleetState[] = [];
  const portRegions = coastalRegions(input.regions || []);
  const naval = EQUIPMENT_CATALOG.filter(equipment => equipment.domain === 'mare');
  let fleetIndex = 0;
  for (const equipment of naval) {
    const quantity = Math.max(0, Math.floor(nonNegative(input.units[equipment.id])));
    if (quantity <= 0) continue;
    const crew = Math.max(0, Math.round(nonNegative(EQUIPMENT_CREW[equipment.id])));
    fleetIndex += 1;
    const fleet: FleetState = {
      id: `fleet-${input.polityId}-${fleetIndex}`,
      name: `${fleetIndex}ª Flotta — ${equipment.category}`,
      shipIds: [],
      createdDate: input.date,
      legacyDerived: true,
    };
    for (let i = 0; i < quantity; i += 1) {
      const port = portRegions.length > 0 ? portRegions[i % portRegions.length] : undefined;
      const ship: ShipState = {
        id: `ship-${input.polityId}-${equipment.id}-${i + 1}`,
        name: quantity > 1 ? `${equipment.name} ${i + 1}ª` : equipment.name,
        equipmentId: equipment.id,
        fleetId: fleet.id,
        crew,
        monthlyFuel: round3(equipment.domain === 'mare' ? Math.max(0.02, crew * 0.004) : 0),
        ammunition: {},
        status: 'operational',
        portId: port?.id ?? null,
        regionId: input.regionId ?? port?.id ?? null,
        createdDate: input.date,
        legacyDerived: true,
      };
      ships.push(ship);
      fleet.shipIds.push(ship.id);
    }
    fleets.push(fleet);
  }
  return { ships, fleets };
}

/** Materializza i **cantieri** dai progetti in corso del motore. */
export function seedConstructions(input: {
  projects: readonly IndustrialProjectInput[];
  regions: readonly SeedRegion[];
  date: string;
  capacityOf?: (project: IndustrialProjectInput) => number;
}): ConstructionState[] {
  const ordered = orderedRegions(input.regions);
  return input.projects.map((project, index) => {
    const region = ordered.length > 0 ? ordered[index % ordered.length] : undefined;
    const title = String(project.title || 'Lavori in corso').replace(/\s+/g, ' ').trim();
    return {
      id: `construction-${project.id}`,
      targetType: targetTypeForProject(title),
      targetName: title,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
      progress: round1(nonNegative(project.progress)),
      materialRequirements: materialRequirementsForProject(title),
      capacityDemand: Math.max(1, Math.round(input.capacityOf ? input.capacityOf(project) : 4)),
      costRemaining: round2(materialRequirementsForProject(title).money ?? 0),
      expectedDate: project.expected_date ?? null,
      createdDate: project.started_date || input.date,
      legacyDerived: true,
    };
  });
}

/** Tipo di impianto che nascerà da un'opera: dal titolo, con regola dichiarata. */
export function targetTypeForProject(title: string): FacilityKind | 'ship' {
  const text = String(title || '').toLowerCase();
  if (/ferrovia|strada|porto|ponte|diga|canale|rete/.test(text)) return 'steel_mill';
  if (/acciaier|siderurg|minier|estraz/.test(text)) return 'steel_mill';
  if (/cantiere|arsenale|navale|flotta|nave/.test(text)) return 'shipyard';
  if (/universit|ateneo|ricerc|laborator|scuol|istituto/.test(text)) return 'research_center';
  if (/aereo|aeronaut|aviazione/.test(text)) return 'aircraft_factory';
  if (/carro|meccanizz|automezz|veicol/.test(text)) return 'vehicle_factory';
  return 'arms_factory';
}

/** Materiali richiesti da un'opera: dal tipo di impianto che nascerà. */
export function materialRequirementsForProject(title: string): Record<string, number> {
  const target = targetTypeForProject(title);
  if (target === 'ship') return { iron: 40, coal: 12, money: 6 };
  const recipe = FACILITY_RECIPES[target];
  const inputs: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(recipe.inputs)) inputs[id] = round2(quantity * 12);
  inputs.money = round2((FACILITY_RECIPES[target].outputs.weapons || 0.5) * 18);
  return inputs;
}

/** Personale iniziale: dallo stato dottrinale, una volta sola. */
export function seedPersonnel(manpower: MilitaryManpower, date: string): MilitaryPersonnelState {
  return {
    activePersonnel: Math.round(nonNegative(manpower.activePersonnel)),
    trainedReserve: Math.round(nonNegative(manpower.reservePersonnel)),
    mobilizedPersonnel: Math.round(nonNegative(manpower.mobilizedPersonnel)),
    shipCrew: 0,
    updatedDate: date,
  };
}

export interface SeedArmyInput {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
  formations: number;
  objectId: string | null;
  /**
   * MILITARY/WARFRONT INTEGRITY P1-2: reparti **reali** dell'ultima
   * materializzazione, scritti sull'oggetto della mappa. `formations` resta il
   * livello dichiarato dal mondo (è ciò che alimenta `accounted` e quindi la
   * guarnigione): questo campo dice invece quanti reparti persistiti esistono.
   * Serve a non ricrearli dal livello della mappa dopo un ricaricamento.
   */
  persistedFormations?: number;
}

/**
 * Materializza le **armate** dagli oggetti `army` della mappa più lo schieramento
 * di guarnigione per i reparti senza nome. `personnel` = reparti × uomini per
 * reparto (somma = attivi di terra): l'aggregato non cambia, cambia chi lo possiede.
 * L'equipaggiamento resta **nel deposito** finché non viene assegnato davvero.
 */
export function seedArmies(input: {
  polityId: string;
  armies: readonly SeedArmyInput[];
  accountedFormations: number;
  totalFormations: number;
  epoch: MilitaryEpoch;
  date: string;
  regionNameFor?: (regionId: string | null) => string | null;
}): ArmyOperationalState[] {
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const needsPerFormation = monthlyNeedsPerFormation(input.epoch);
  const state: ArmyOperationalState[] = input.armies.map(army => ({
    id: army.objectId || army.id,
    name: army.name,
    regionId: army.regionId,
    regionName: army.regionName,
    formations: Math.max(0, Math.round(nonNegative(army.formations))),
    personnel: Math.round(Math.max(0, Math.round(nonNegative(army.formations))) * menPerFormation),
    equipment: {},
    monthlyNeeds: {
      fuel: round3(needsPerFormation.fuel * Math.max(0, Math.round(nonNegative(army.formations)))),
      weapons: round3(needsPerFormation.weapons * Math.max(0, Math.round(nonNegative(army.formations)))),
      food: round3(needsPerFormation.food * Math.max(0, Math.round(nonNegative(army.formations)))),
    },
    status: 'operational',
    objectId: army.objectId,
    createdDate: input.date,
    legacyDerived: true,
  }));
  const leftover = Math.max(0, Math.round(input.totalFormations) - Math.round(input.accountedFormations));
  if (leftover > 0) {
    state.push({
      id: `${input.polityId}-garrison`,
      name: 'Reparti di guarnigione',
      regionId: null,
      regionName: null,
      formations: leftover,
      personnel: Math.round(leftover * menPerFormation),
      equipment: {},
      monthlyNeeds: {
        fuel: round3(needsPerFormation.fuel * leftover),
        weapons: round3(needsPerFormation.weapons * leftover),
        food: round3(needsPerFormation.food * leftover),
      },
      status: 'operational',
      objectId: null,
      createdDate: input.date,
      legacyDerived: true,
    });
  }
  return state;
}

/**
 * P4 — materializzazione **lazy** dei reparti di una polity NPC.
 *
 * Stesse regole e stessi numeri del giocatore (`militaryManpower`,
 * `monthlyNeedsPerFormation`, `transferEquipment`, `unitStatusFromCoverage`):
 * qui non si inventa nulla. È una **conversione** della forza dichiarata in
 * reparti persistenti, non una produzione: nessun impianto, nessuna coda, nessun
 * uomo creato oltre `menPerFormation × formations`.
 *
 * Pura e deterministica: la distribuzione geografica dipende solo dalla potenza
 * dichiarata e dall'ordine degli id (nessun `Math.random`), e ogni reparto ha
 * una provincia **reale** (mai `regionId = null`: chi combatte deve stare da
 * qualche parte).
 */
export interface NpcMilitarySeedInput {
  polityId: string;
  epoch: MilitaryEpoch;
  date: string;
  /** Formazioni dichiarate dal conto nazionale (`account.forces`). */
  formations: number;
  /** Regioni **proprie**: il peso è la `militaryPower` dichiarata. */
  regions: ReadonlyArray<{ id: string; name?: string | null; militaryPower?: number }>;
  /** Province del teatro dei fronti aperti: priorità di schieramento. */
  frontRegionIds?: readonly string[];
  /** Pezzi disponibili nel deposito della polity: da qui, mai inventati. */
  depot?: Record<string, number>;
  /** Reparti già esistenti della polity (idempotenza e no-resurrection). */
  existing: readonly MilitaryUnitState[];
}

export interface NpcMilitarySeedResult {
  /** Insieme **completo** dei reparti della polity (esistenti + creati). */
  units: MilitaryUnitState[];
  /** Deposito dopo l'assegnazione dei pezzi (conservazione). */
  depot: Record<string, number>;
  createdUnitIds: string[];
}

/** Distribuzione deterministica delle formazioni fra le regioni proprie. */
function npcRegionSlots(input: {
  count: number;
  regions: NpcMilitarySeedInput['regions'];
  frontRegionIds?: readonly string[];
}): Array<{ id: string; name: string | null }> {
  const front = new Set((input.frontRegionIds || []).map(String));
  const regions = [...input.regions]
    .filter(region => Boolean(region.id))
    // Teatro prima (priorità dichiarata), poi potenza decrescente, poi id: nessun
    // pareggio ambiguo e nessuna dipendenza dall'ordine di arrivo.
    .sort((a, b) => Number(front.has(String(b.id))) - Number(front.has(String(a.id)))
      || Math.max(0, Number(b.militaryPower || 0)) - Math.max(0, Number(a.militaryPower || 0))
      || String(a.id).localeCompare(String(b.id)));
  if (regions.length === 0) return [];
  // Peso = potenza dichiarata, con pavimento 1: una provincia a potenza zero può
  // comunque ospitare reparti (mai un reparto senza provincia), e la somma è
  // **esatta** (riparto a maggior resto).
  const weights = regions.map(region => Math.max(1, Math.round(Number(region.militaryPower || 0))));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const quota = weights.map(weight => (input.count * weight) / total);
  const slots = quota.map(value => Math.floor(value));
  let assigned = slots.reduce((sum, value) => sum + value, 0);
  const order = quota
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of order) {
    if (assigned >= input.count) break;
    slots[entry.index] += 1;
    assigned += 1;
  }
  const placed: Array<{ id: string; name: string | null }> = [];
  for (let index = 0; index < regions.length; index += 1) {
    for (let unit = 0; unit < slots[index]; unit += 1) {
      placed.push({ id: String(regions[index].id), name: regions[index].name ? String(regions[index].name) : null });
    }
  }
  // Se il conteggio è più alto della distribuzione (arrotondamenti), l'ultima
  // regione assorbe il resto: la somma resta quella dichiarata.
  while (placed.length < input.count) {
    placed.push({ id: String(regions[0].id), name: regions[0].name ? String(regions[0].name) : null });
  }
  return placed.slice(0, Math.max(0, input.count));
}

export function materializeNpcMilitary(input: NpcMilitarySeedInput): NpcMilitarySeedResult {
  const existing = [...input.existing]
    .filter(unit => String(unit.polityId) === String(input.polityId))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const target = Math.max(0, Math.round(nonNegative(input.formations)));
  // Idempotenza e **no resurrection**: se i reparti esistono già (anche tutti
  // `destroyed`) non se ne creano altri dal numero dichiarato.
  if (target === 0 || existing.length >= target) {
    return { units: existing, depot: { ...(input.depot || {}) }, createdUnitIds: [] };
  }
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const needs = monthlyNeedsPerFormation(input.epoch);
  const required = rifleRequirement(input.epoch, 1);
  const slots = npcRegionSlots({
    count: target - existing.length,
    regions: input.regions,
    frontRegionIds: input.frontRegionIds,
  });
  let depot = { ...(input.depot || {}) };
  const created: MilitaryUnitState[] = [];
  slots.forEach((slot, offset) => {
    const index = existing.length + offset + 1;
    const equipment: Record<string, number> = {};
    // I pezzi escono dal **deposito** della polity e non vengono inventati:
    // `depot + assegnato` resta il totale (come per il giocatore).
    const transfer = transferEquipment({
      depot,
      assigned: equipment,
      items: [{ equipmentId: rifleEquipmentId(), quantity: required }],
    });
    if (transfer) {
      depot = transfer.depot;
      Object.assign(equipment, transfer.assigned);
    }
    const rifles = equipmentQuantity(equipment, rifleEquipmentId());
    const status = unitStatusFromCoverage({ assigned: rifles, required });
    created.push({
      // Namespace non collidente con i reparti del giocatore.
      id: `npc-${input.polityId}-unit-${String(index).padStart(3, '0')}`,
      polityId: String(input.polityId),
      armyId: `npc-${input.polityId}-army-${slot.id}`,
      name: unitNameFor(input.epoch, index),
      personnel: menPerFormation,
      equipment,
      monthlyNeeds: { fuel: needs.fuel, weapons: needs.weapons, food: needs.food },
      readiness: 0,
      status,
      regionId: slot.id,
      regionName: slot.name,
      updatedDate: input.date,
      legacyDerived: true,
      order: UNIT_ORDER_DEFAULT,
      frontId: null,
    });
  });
  const units = [...existing, ...created]
    .map(unit => ({ ...unit, readiness: unitReadiness({ unit, epoch: input.epoch }) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { units, depot, createdUnitIds: created.map(unit => unit.id) };
}

/**
 * Fabbisogni mensili di **un reparto** (carburante, armamenti, cibo). Stessa
 * aritmetica del motore: `materialNeeds` su un conto con un solo reparto.
 */
export function monthlyNeedsPerFormation(epoch: MilitaryEpoch): MaterialNeeds {
  void epoch; // la dottrina d'epoca non cambia i consumi unitari del motore
  // `materialNeeds` del motore sui soli reparti: popolazione e fabbriche a zero,
  // quindi restano i consumi militari di **un** reparto. Nessun numero inventato.
  const synthetic = { population: 0, forces: 1, mobilized: 0, factories: 0 } as unknown as NationalAccount;
  const needs = materialNeeds(synthetic);
  return {
    food: round3(needs.food),
    clothing: round3(needs.clothing),
    weapons: round3(needs.weapons),
    fuel: round3(needs.fuel),
  };
}

// ── 7. Ordini → impianto ────────────────────────────────────────────────────

/**
 * Assegna un ordine a un impianto **reale**, in modo deterministico: il primo
 * impianto con capacità libera sufficiente e meno lavoro già assegnato. Non è
 * più una rotazione decisa al momento della lettura.
 */
export function assignOrderToFacility(input: {
  order: IndustrialOrderLike;
  facilities: readonly FacilityState[];
  capacityDemand: number;
}): string | null {
  const candidates = input.facilities
    .filter(facility => facility.kind !== 'mine' && facility.status !== 'under_construction')
    .map(facility => ({
      facility,
      assigned: (facility.activeOrders || []).length,
      free: Math.max(0, nonNegative(facility.capacity) * 4 - (facility.activeOrders || []).length * Math.max(1, nonNegative(input.capacityDemand))),
    }))
    .filter(candidate => candidate.free >= Math.max(1, nonNegative(input.capacityDemand)));
  const pool: Array<{ facility: FacilityState; assigned: number; free: number }> = candidates.length > 0
    ? candidates
    : input.facilities.filter(facility => facility.kind !== 'mine').map(facility => ({ facility, assigned: (facility.activeOrders || []).length, free: 1 }));
  if (pool.length === 0) return null;
  pool.sort((a, b) => (a.assigned - b.assigned) || String(a.facility.id).localeCompare(String(b.facility.id)));
  return pool[0].facility.id;
}

// ── 8. Costruzioni: completamento → oggetto finale ──────────────────────────

export interface ConstructionAdvance {
  constructions: ConstructionState[];
  /** Impianti nati dal completamento (nessun beneficio prima). */
  created: FacilityState[];
  /** Navi nate dal completamento di un cantiere navale. */
  createdShips: ShipState[];
  completed: string[];
}

/**
 * Avanzamento dei cantieri: le opere ancora in corso restano; quelle **finite**
 * vengono chiuse e nasce l'oggetto finale (impianto). Nessun beneficio prima del
 * completamento: finché l'opera è in corso non esiste alcun impianto.
 */
export function advanceConstructions(input: {
  polityId: string;
  constructions: readonly ConstructionState[];
  /** Id dei progetti ancora in corso per il motore. */
  ongoingProjectIds: readonly string[];
  facilities: readonly FacilityState[];
  date: string;
  /** Capacità industriale disponibile per i lavori (fattore 0…1). */
  activity?: number;
  /** Tecnologie del paese: la ricetta dell'impianto nasce dal profilo del motore. */
  technologies?: readonly string[];
}): ConstructionAdvance {
  const ongoing = new Set(input.ongoingProjectIds.map(String));
  const constructions: ConstructionState[] = [];
  const created: FacilityState[] = [];
  const completed: string[] = [];
  for (const construction of input.constructions) {
    const projectId = construction.id.replace(/^construction-/, '');
    if (ongoing.has(projectId) || ongoing.has(construction.id)) {
      constructions.push(construction);
      continue;
    }
    // Il progetto non è più in corso: l'opera è finita (chiusa dal motore).
    completed.push(construction.id);
    if (construction.targetType === 'ship') continue;
    const kind = construction.targetType as FacilityKind;
    const capacity = facilityCapacityFor(kind);
    created.push({
      id: `${kind}-${input.polityId}-${input.facilities.length + created.length + 1}`,
      kind,
      name: construction.targetName,
      regionId: construction.regionId,
      regionName: construction.regionName,
      capacity,
      workers: SEED_WORKERS_PER_LINE.factory * capacity,
      status: 'operational',
      recipe: engineFacilityRecipe(kind, input.technologies || []),
      activeOrders: [],
      createdDate: input.date,
      legacyDerived: false,
    });
  }
  return { constructions, created, createdShips: [], completed };
}

// ── 9. Etichette per la UI (stessa grammatica) ──────────────────────────────

/** Stato dell'armata dalla copertura reale dell'equipaggiamento assegnato. */
export function armyStatusFromCoverage(input: { assigned: number; required: number; hasRifles: boolean }): ArmyOperationalState['status'] {
  if (!input.hasRifles) return 'forming';
  if (input.required <= 0) return 'operational';
  const coverage = input.assigned / input.required;
  if (coverage >= 0.95) return 'operational';
  if (coverage >= 0.6) return 'degraded';
  return 'degraded';
}

// ── 8-bis. Reparti: l'unità sotto l'armata ──────────────────────────────────

/**
 * Fattore di prontezza dello **stato dichiarato** del reparto: tabella
 * dichiarata (come i fattori di impianto e nave), non una regola nascosta.
 */
export const UNIT_STATUS_FACTOR: Record<MilitaryUnitState['status'], number> = {
  forming: 0.5,
  operational: 1,
  degraded: 0.7,
  retreating: 0.45,
  destroyed: 0,
};

/** Come si legge lo stato del reparto (etichetta propria, non quella d'impianto). */
export const UNIT_STATUS_LABEL: Record<MilitaryUnitState['status'], string> = {
  forming: 'In formazione',
  operational: 'Operativa',
  degraded: 'Affaticata',
  retreating: 'In ritirata',
  destroyed: 'Distrutta',
};

/** Classificazione d'epoca del livello sotto l'armata (il **nome** del reparto). */
const UNIT_CLASS: Record<MilitaryEpoch, { label: string; ordinal: string }> = {
  pre_industriale: { label: 'Reggimento', ordinal: '°' },
  grande_guerra: { label: 'Divisione', ordinal: 'ª' },
  seconda_guerra: { label: 'Divisione', ordinal: 'ª' },
  guerra_fredda: { label: 'Reggimento', ordinal: '°' },
  moderno: { label: 'Brigata', ordinal: 'ª' },
};

/** Nome deterministico del reparto: «1ª Brigata», «2° Reggimento». */
export function unitNameFor(epoch: MilitaryEpoch, index: number): string {
  const order = Math.max(1, Math.round(nonNegative(index) || 1));
  const style = UNIT_CLASS[epoch];
  return style ? `${order}${style.ordinal} ${style.label}` : `${order}° Reparto`;
}

/** Id del reparto: figlio dell'armata, numerazione a tre cifre (stabile). */
export function unitIdFor(armyId: string, index: number): string {
  const order = Math.max(1, Math.round(nonNegative(index) || 1));
  return `${armyId}-unit-${String(order).padStart(3, '0')}`;
}

/** Numero del reparto letto dall'id (`…-unit-007`): 0 se non numerato. */
export function unitNumberOf(unit: Pick<MilitaryUnitState, 'id'>): number {
  const match = /-unit-(\d+)$/.exec(String(unit.id || ''));
  return match ? Number(match[1]) : 0;
}

/**
 * Prontezza di un reparto: media di **organico** e **dotazione d'armi
 * individuali**, modulata dallo **stato dichiarato**. Riusa le grandezze del
 * motore (`menPerFormation`, `rifleRequirement`); un dato assente vale 1, come in
 * `militaryReadiness`.
 *
 * Il carburante **non** entra in questo numero: la prontezza è persistita e un
 * fattore che dipende da ogni litro consumato la farebbe oscillare a ogni
 * lettura. Il carburante resta un **fatto** del reparto (mesi di scorta) e un
 * **problema** quando la scorta è sotto un mese.
 */
export function unitReadiness(input: {
  unit: Pick<MilitaryUnitState, 'personnel' | 'equipment' | 'status'>;
  epoch: MilitaryEpoch;
}): number {
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const staffing = menPerFormation > 0 ? Math.min(1, nonNegative(input.unit.personnel) / menPerFormation) : 1;
  const required = rifleRequirement(input.epoch, 1);
  const assigned = equipmentQuantity(input.unit.equipment, rifleEquipmentId());
  const equipped = required > 0 ? Math.min(1, assigned / required) : 1;
  const value = (staffing * 0.5 + equipped * 0.5) * UNIT_STATUS_FACTOR[input.unit.status];
  return round3(Math.max(0, Math.min(1, value)));
}

/** Stato del reparto dai **fatti**: senza pezzi è in formazione, sotto il 95% affaticato. */
export function unitStatusFromCoverage(input: {
  assigned: number;
  required: number;
  /** Stato dichiarato dall'armata (materializzazione): «in formazione» resta tale. */
  declared?: ArmyOperationalState['status'];
}): MilitaryUnitState['status'] {
  if (input.declared === 'forming') return 'forming';
  if (nonNegative(input.assigned) <= 0) return 'forming';
  if (input.declared === 'degraded' || input.declared === 'maintenance') return 'degraded';
  if (input.required <= 0) return 'operational';
  return input.assigned / input.required >= 0.95 ? 'operational' : 'degraded';
}

/**
 * Divide un totale dichiarato in `parts` parti **senza cambiarne la somma**: le
 * parti sono uguali e l'ultima assorbe il resto (l'aggregato non si muove).
 */
export function splitExact(total: number, parts: number, decimals = 0): number[] {
  const count = Math.max(1, Math.round(nonNegative(parts) || 1));
  const scale = 10 ** decimals;
  const target = nonNegative(total);
  const step = Math.floor((target / count) * scale) / scale;
  const values = new Array<number>(count).fill(step);
  values[count - 1] = Math.round((target - step * (count - 1)) * scale) / scale;
  return values;
}

/** Stato **vuoto** di un reparto (nessun uomo, nessun pezzo: solo il quadro). */
export function emptyUnit(input: {
  id: string;
  armyId: string;
  epoch: MilitaryEpoch;
  date: string;
  /** P4 — a chi appartiene il reparto (mai dedotto dalla provincia). */
  polityId: string;
  regionId?: string | null;
  regionName?: string | null;
  name?: string;
  index?: number;
}): MilitaryUnitState {
  return {
    id: input.id,
    polityId: String(input.polityId),
    armyId: input.armyId,
    name: input.name || unitNameFor(input.epoch, input.index ?? 1),
    personnel: 0,
    equipment: {},
    monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
    readiness: 0,
    status: 'forming',
    regionId: input.regionId ?? null,
    regionName: input.regionName ?? null,
    updatedDate: input.date,
    legacyDerived: false,
    order: UNIT_ORDER_DEFAULT,
    frontId: null,
  };
}

export interface MaterializeUnitsInput {
  army: ArmyOperationalState;
  epoch: MilitaryEpoch;
  date: string;
  /** P4 — nazionalità dei reparti creati (authority, non dedotta). */
  polityId: string;
  /** Reparti dichiarati dal **mondo** (livello dell'oggetto della mappa). */
  formations?: number;
  existing: readonly MilitaryUnitState[];
}

/**
 * Materializza i reparti di un'armata: **lazy** (alla prima lettura) e
 * **idempotente** (la seconda volta non cambia nulla). La prima volta divide
 * l'aggregato dell'armata fra i suoi reparti **senza cambiarne la somma**; se il
 * mondo dichiara più reparti di quelli esistenti, i nuovi nascono **senza
 * uomini** (`forming`): nessun uomo viene creato dal nulla (la riserva si muove
 * solo con `transferMenToArmy`).
 */
export function materializeUnitsForArmy(input: MaterializeUnitsInput): MilitaryUnitState[] {
  const existing = [...input.existing].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const target = Math.max(0, Math.round(nonNegative(input.formations ?? input.army.formations)));
  if (target === 0 || existing.length >= target) {
    return existing.map(unit => ({ ...unit, readiness: unitReadiness({ unit, epoch: input.epoch }) }));
  }
  const created: MilitaryUnitState[] = [];
  if (existing.length === 0) {
    const men = splitExact(input.army.personnel, target, 0);
    const needs = {
      fuel: splitExact(input.army.monthlyNeeds.fuel, target, 3),
      weapons: splitExact(input.army.monthlyNeeds.weapons, target, 3),
      food: splitExact(input.army.monthlyNeeds.food, target, 3),
    };
    const bags = Object.entries(input.army.equipment || {})
      .map(([id, quantity]) => [id, splitExact(quantity, target, 0)] as const);
    for (let index = 1; index <= target; index += 1) {
      const equipment: Record<string, number> = {};
      for (const [id, values] of bags) if (values[index - 1] > 0) equipment[id] = values[index - 1];
      const rifles = equipmentQuantity(equipment, rifleEquipmentId());
      created.push({
        id: unitIdFor(input.army.id, index),
        polityId: String(input.polityId),
        armyId: input.army.id,
        name: unitNameFor(input.epoch, index),
        personnel: men[index - 1],
        equipment,
        monthlyNeeds: {
          fuel: needs.fuel[index - 1],
          weapons: needs.weapons[index - 1],
          food: needs.food[index - 1],
        },
        readiness: 0,
        // Senza armi individuali il reparto è **in formazione**: la sua quota di
        // pezzi è nel deposito, non in mano ai soldati.
        status: unitStatusFromCoverage({
          assigned: rifles,
          required: rifleRequirement(input.epoch, 1),
          declared: input.army.status,
        }),
        regionId: input.army.regionId,
        regionName: input.army.regionName,
        updatedDate: input.date,
        legacyDerived: true,
        order: UNIT_ORDER_DEFAULT,
        frontId: null,
      });
    }
  } else {
    for (let index = existing.length + 1; index <= target; index += 1) {
      created.push(emptyUnit({
        id: unitIdFor(input.army.id, index),
        armyId: input.army.id,
        epoch: input.epoch,
        date: input.date,
        polityId: String(input.polityId),
        index,
        regionId: input.army.regionId,
        regionName: input.army.regionName,
      }));
    }
  }
  return [...existing, ...created]
    .map(unit => ({ ...unit, readiness: unitReadiness({ unit, epoch: input.epoch }) }));
}

/**
 * L'armata è la **somma** dei suoi reparti: uomini, equipaggiamento, fabbisogni
 * e numero di reparti si derivano, non si dichiarano. Senza reparti l'armata
 * resta com'è (percorso legacy dichiarato). I reparti distrutti non contano.
 */
export function aggregateArmyFromUnits(
  army: ArmyOperationalState,
  units: readonly MilitaryUnitState[],
): ArmyOperationalState {
  // Un'armata **già materializzata** che perde tutti i reparti è la somma di
  // zero reparti — zero uomini, zero pezzi. Prima si conservava l'aggregato di
  // prima, e il numero vecchio risaliva sull'oggetto della mappa facendo
  // rinascere i reparti al reload. Un'armata ancora legacy (mai materializzata,
  // o dichiarata con `formations = 0` e un fabbisogno proprio) conserva invece
  // il valore dichiarato: è la base della materializzazione iniziale.
  if (units.length === 0) {
    if (army.legacyDerived || army.formations <= 0) return army;
    return {
      ...army,
      formations: 0,
      personnel: 0,
      equipment: {},
      monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
      legacyDerived: false,
    };
  }
  const active = units.filter(unit => unit.status !== 'destroyed');
  const personnel = Math.round(active.reduce((total, unit) => total + nonNegative(unit.personnel), 0));
  const equipment: Record<string, number> = {};
  for (const unit of active) {
    for (const [id, quantity] of Object.entries(unit.equipment || {})) {
      addTo(equipment, id, Math.round(nonNegative(quantity)));
    }
  }
  const needsOf = (key: keyof ArmyOperationalState['monthlyNeeds']) =>
    round3(active.reduce((total, unit) => total + nonNegative(unit.monthlyNeeds?.[key]), 0));
  return {
    ...army,
    formations: active.length,
    personnel,
    equipment,
    monthlyNeeds: { fuel: needsOf('fuel'), weapons: needsOf('weapons'), food: needsOf('food') },
    legacyDerived: false,
  };
}

/** Legenda leggibile dei tipi di oggetto persistente (per il report e i test). */
export const PERSISTENT_KIND_LABEL: Record<string, string> = {
  army: 'Armata',
  unit: 'Reparto',
  front: 'Fronte',
  facility: 'Impianto',
  ship: 'Nave',
  fleet: 'Flotta',
  construction: 'Cantiere',
  personnel: 'Personale militare',
};

/** Descrizione a una riga dell'aggregato (diagnostica e test). */
export function aggregateSummary(aggregate: OperationalAggregate): string {
  return `${n(aggregate.underArms)} uomini sotto le armi (${n(aggregate.soldiers)} terra + ${n(aggregate.crew)} equipaggi) · `
    + `${n(aggregate.capacity)} linee · ${n(aggregate.workers)} lavoratori · ${aggregate.ships} navi · ${aggregate.constructions} cantieri`;
}

/** Le armi individuali richieste da un reparto (quota d'epoca degli uomini). */
export function rifleRequirement(epoch: MilitaryEpoch, formations: number): number {
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch }).menPerFormation;
  return Math.round(menPerFormation * individualWeaponShareFor(epoch) * Math.max(0, Math.round(nonNegative(formations))));
}

/** Voce di catalogo corrispondente alle armi individuali d'epoca. */
export function rifleEquipmentId(): string {
  return 'fucili';
}

/** Equipaggiamento di una voce presente in arsenale (0 se assente). */
export function equipmentQuantity(units: Record<string, number> | undefined, equipmentId: string): number {
  return Math.max(0, Math.floor(nonNegative(units?.[equipmentId])));
}

/** Esiste la voce nel catalogo militare? (evita id inventati nello stato) */
export function isKnownEquipment(equipmentId: string): boolean {
  return Boolean(equipmentById(equipmentId));
}

/** Etichetta d'epoca per il report. */
export function epochLabel(epoch: MilitaryEpoch): string {
  return MILITARY_EPOCH_LABEL[epoch];
}

/** Risorse materiali di un impianto come mappa id → quantità (per la UI). */
export function facilityStockView(facility: FacilityState, stock: ResourceStock | undefined): Array<{ id: string; available: number; required: number }> {
  const recipe = facility.recipe ?? FACILITY_RECIPES[facility.kind];
  return Object.entries(recipe.inputs || {}).map(([id, required]) => ({
    id,
    available: round2(nonNegative((stock as unknown as Record<string, number>)?.[id])),
    required: round2(nonNegative(required)),
  }));
}

// ── 10. Oggetti del quadro operativo letti dallo stato persistente ──────────

export interface PersistentObjectsInput {
  polityId: string;
  date: string;
  epoch: MilitaryEpoch;
  armies: readonly ArmyOperationalState[];
  /** Reparti (unità) delle armate: la granularità sotto l'armata. */
  units?: readonly MilitaryUnitState[];
  /** Fronti aperti: le unità arrivano dal loro `frontId`, non da un secondo elenco. */
  fronts?: readonly WarFrontState[];
  facilities: readonly FacilityState[];
  ships: readonly ShipState[];
  fleets: readonly FleetState[];
  constructions: readonly ConstructionState[];
  personnel: MilitaryPersonnelState;
  /** Ordini di produzione in corso, per id: le lavorazioni **assegnate**. */
  ordersById?: Record<string, IndustrialOrderLike>;
  /** Prontezza nazionale dal motore (per l'armata senza calcoli locali). */
  readinessPct?: number;
  /** Copertura armi individuali nazionale dal motore, in percentuale. */
  individualCoveragePct?: number;
  /** Attività nazionale delle linee (0…1) e blocco: dal motore. */
  activity?: number;
  blocked?: boolean;
  /** Stock materiale reale: decide quanto un impianto può davvero produrre. */
  stock?: Record<string, number>;
  /** Giacimenti dichiarati: alimentano gli input non materiali delle ricette. */
  endowment?: Record<string, number>;
  /** Tecnologie possedute: servono al contributo estrattivo delle miniere. */
  technologies?: readonly string[];
  /** Spese civili mensili da attribuire agli impianti (mld). */
  civilMonthlyMld?: number;
  /** Spese militari mensili da attribuire alle armate (mld). */
  militaryMonthlyMld?: number;
  /** Mesi di carburante disponibili (scorta nazionale / consumo). */
  fuelMonths?: number | null;
  /** Riserva addestrata disponibile: decide se il rinforzo è eseguibile. */
  availableReserve?: number;
  /** Pezzi **in deposito** (non assegnati): decide se il riequipaggiamento è eseguibile. */
  depotUnits?: Record<string, number>;
  /**
   * Province del mondo per nome leggibile (teatro dei fronti). Il fronte usa la
   * stessa adiacenza della mappa: nessuna geografia riscritta qui.
   */
  regions?: readonly { id: string; name: string }[];
  /**
   * Pass di allocazione degli impianti (lo **stesso** usato dal tick): la
   * scheda non ricalcola nulla, mostra la simulazione che modifica lo stato.
   */
  allocation?: FacilityAllocation;
}

const tone = (value: number, good: number, warn: number): ReadinessTone =>
  value >= good ? 'positive' : value >= warn ? 'neutral' : value < warn / 2 ? 'critical' : 'warning';

/** Stato dell'oggetto equivalente per il tono visivo (l'etichetta è del reparto). */
const UNIT_OPERATING_STATUS: Record<MilitaryUnitState['status'], OperatingStatus> = {
  forming: 'under_construction',
  operational: 'operational',
  degraded: 'degraded',
  retreating: 'critical',
  destroyed: 'critical',
};

/**
 * Azioni **reali** del reparto: abilitate solo se il motore ha ciò che serve
 * (riserva addestrata, pezzi in deposito, una seconda armata). Il motivo del
 * blocco è dichiarato, così la UI non inventa nulla.
 */
function unitActions(input: {
  unit: MilitaryUnitState;
  epoch: MilitaryEpoch;
  availableReserve?: number;
  depotUnits?: Record<string, number>;
  armies: readonly ArmyOperationalState[];
  /** Fronte del reparto (`null` se non è impegnato): senza fronte non ci sono ordini. */
  front?: WarFrontState;
}): OperatingAction[] {
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  const required = rifleRequirement(input.epoch, 1);
  const assigned = equipmentQuantity(input.unit.equipment, rifleEquipmentId());
  const reserve = Math.max(0, Math.floor(nonNegative(input.availableReserve)));
  const depot = equipmentQuantity(input.depotUnits, rifleEquipmentId());
  const missingMen = Math.max(0, menPerFormation - Math.round(nonNegative(input.unit.personnel)));
  const missingRifles = Math.max(0, required - assigned);
  const otherArmies = input.armies.filter(army => String(army.id) !== String(input.unit.armyId)).length;
  return [
    {
      id: 'reinforce_unit',
      label: missingMen > 0 ? `Rinforza (${n(Math.min(missingMen, reserve))} uomini)` : 'Rinforza',
      enabled: missingMen > 0 && reserve > 0,
      blockedReason: missingMen <= 0
        ? `Organico già completo: ${n(menPerFormation)} uomini per reparto.`
        : reserve <= 0 ? 'Riserva addestrata esaurita: nessun uomo richiamabile.' : null,
    },
    {
      id: 'reequip_unit',
      label: missingRifles > 0 ? `Riequipaggia (${n(Math.min(missingRifles, depot))} pezzi)` : 'Riequipaggia',
      enabled: missingRifles > 0 && depot > 0,
      blockedReason: missingRifles <= 0
        ? 'Dotazione già completa per un reparto.'
        : depot <= 0 ? 'Deposito senza armi individuali: la dotazione va costruita o comprata.' : null,
    },
    {
      // PR3 — **ricostituzione**: uomini dalla riserva + fucili dal deposito in
      // una sola azione (orchestrazione delle primitive esistenti). Fuori dal
      // fronte, o in riserva: un reparto schierato non si ricostituisce.
      id: 'reconstitute_unit',
      label: missingMen > 0 && missingRifles > 0 && reserve > 0 && depot > 0
        ? `Ricostituisci (${n(Math.min(missingMen, reserve))} uomini · ${n(Math.min(missingRifles, depot))} pezzi)`
        : 'Ricostituisci',
      enabled: input.unit.status !== 'destroyed'
        && (!input.front || input.unit.order === 'reserve')
        && ((missingMen > 0 && reserve > 0) || (missingRifles > 0 && depot > 0)),
      blockedReason: input.unit.status === 'destroyed'
        ? "Reparto distrutto: l'identità è storia. Per una nuova forza serve una nuova formazione."
        : input.front && input.unit.order !== 'reserve'
          ? `Il reparto è schierato sul ${input.front.name}: la ricostituzione completa si fa fuori dal fronte (o in riserva).`
          : missingMen <= 0 && missingRifles <= 0
            ? "Reparto già completo: organico e dotazione sono quelli d'epoca."
            : reserve <= 0 && depot <= 0
              ? "Né riserva addestrata né deposito: non c'è nulla da assegnare."
              : null,
    },
    {
      id: 'transfer_unit',
      label: 'Trasferisci',
      enabled: true,
      blockedReason: null,
    },
    {
      id: 'reassign_unit',
      label: 'Cambia armata',
      enabled: otherArmies > 0,
      blockedReason: otherArmies > 0 ? null : 'Serve una seconda armata per spostare il reparto.',
    },
    // P7 — le quattro mosse del fronte. Sono lo **stesso** motore per il
    // giocatore e per gli NPC: `unit.order` è persistente e decide pressione,
    // perdite e consumi. Nessuna tenaglia, nessuno sbarco: il fronte è
    // strategico.
    ...UNIT_ORDER_ACTIONS.map(action => ({
      id: action.id,
      label: UNIT_ORDER_LABEL[action.order],
      enabled: input.unit.status !== 'destroyed' && Boolean(input.front) && input.unit.order !== action.order,
      blockedReason: input.unit.status === 'destroyed'
        ? 'Reparto distrutto: non ha più ordini da eseguire.'
        : !input.front
          ? 'Il reparto non è assegnato a un fronte: non ci sono ordini da dare.'
          : input.unit.order === action.order
            ? `Il reparto ha già l'ordine «${UNIT_ORDER_LABEL[action.order]}».`
            : null,
    })),
  ];
}

const textList = (bag: Record<string, number>): string =>
  Object.entries(bag).filter(([, quantity]) => nonNegative(quantity) > 0)
    .map(([id, quantity]) => `${equipmentById(id)?.name || id} ×${n(quantity)}`).join(' · ');

/** Le quattro mosse del fronte, nell'ordine in cui la UI le mostra. */
const UNIT_ORDER_ACTIONS: Array<{ id: OperatingAction['id']; order: UnitOrder }> = [
  { id: 'order_attack', order: 'attack' },
  { id: 'order_defend', order: 'defend' },
  { id: 'order_reserve', order: 'reserve' },
  { id: 'order_withdraw', order: 'withdraw' },
];

/** Stato dell'oggetto equivalente per il tono visivo del fronte. */
const FRONT_OPERATING_STATUS: Record<WarFrontStatus, OperatingStatus> = {
  forming: 'under_construction',
  active: 'operational',
  stalemate: 'degraded',
  breakthrough: 'operational',
  collapsed: 'critical',
  closed: 'idle',
};

/**
 * Oggetti del quadro operativo costruiti **dallo stato persistente**: le armate
 * hanno i loro uomini e il loro equipaggiamento, gli impianti i loro addetti e le
 * loro lavorazioni, le navi il loro equipaggio. Nessun dato derivato da una quota
 * dell'aggregato: dove lo stato non c'è (partita legacy) resta il percorso
 * dichiarato del motore.
 */
export function persistentObjects(input: PersistentObjectsInput): OperatingObject[] {
  const objects: OperatingObject[] = [];
  const activity = Math.max(0, Math.min(1, input.activity === undefined ? 1 : input.activity));
  const underArms = personnelUnderArms(input.personnel);
  const fuelMonths = input.fuelMonths ?? null;

  // ── Armate ────────────────────────────────────────────────────────────────
  for (const army of input.armies) {
    const required = rifleRequirement(input.epoch, army.formations);
    const assigned = equipmentQuantity(army.equipment, rifleEquipmentId());
    const coveragePct = required > 0 ? round1(Math.min(100, assigned / required * 100)) : 100;
    const equipmentTotal = Math.round(sum(Object.values(army.equipment || {})));
    const status: OperatingStatus = required > 0 && assigned <= 0
      ? 'operational'
      : coveragePct >= 95 ? 'operational' : coveragePct >= 60 ? 'degraded' : 'critical';
    const share = underArms > 0 ? army.personnel / underArms : 0;
    const armyFuelMonths = army.monthlyNeeds.fuel > 0 && fuelMonths !== null
      ? fuelMonths
      : null;
    objects.push({
      id: army.id,
      kind: 'army',
      label: army.name,
      subtitle: `${n(army.formations)} reparti · ${n(army.personnel)} uomini${army.regionName ? ` · ${army.regionName}` : ''}`,
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: 'force',
      regionId: army.regionId,
      regionName: army.regionName,
      facts: [
        fact('stato', 'Reparti', army.formations, 'numero'),
        fact('stato', 'Uomini', army.personnel, 'numero'),
        fact('stato', 'Equipaggiamento assegnato', equipmentTotal, 'numero', 'neutral', textList(army.equipment) || 'Nessun pezzo assegnato: la dotazione è ancora nel deposito nazionale.'),
        fact('capacita', 'Copertura armi individuali', coveragePct, 'pct',
          tone(coveragePct, 95, 80), `${n(assigned)} fucili assegnati su ${n(required)} richiesti.`),
        fact('personale', 'Riserva addestrata', input.personnel.trainedReserve, 'numero',
          'neutral', `Riserva nazionale disponibile: ${n(reserveAvailable(input.personnel, { totalMilitaryPool: input.personnel.trainedReserve + underArms } as MilitaryManpower))} uomini.`),
        fact('input', 'Carburante', army.monthlyNeeds.fuel, 'per_mese'),
        fact('input', 'Armamenti', army.monthlyNeeds.weapons, 'per_mese'),
        fact('input', 'Cibo', army.monthlyNeeds.food, 'per_mese'),
        ...(input.militaryMonthlyMld !== undefined
          ? [fact('costi', 'Spese dell\'armata', round3(nonNegative(input.militaryMonthlyMld) * share), 'mld',
            'neutral', 'Quota delle spese militari mensili, in proporzione agli uomini dell\'armata.')]
          : []),
        ...(armyFuelMonths !== null
          ? [fact('autonomia', 'Carburante (scorte)', round1(armyFuelMonths), 'mesi',
            armyFuelMonths < FULL_TANK_MONTHS ? 'warning' : 'neutral', 'Scorta nazionale divisa per il consumo del paese.')]
          : []),
      ],
      problems: [
        ...(required > 0 && assigned <= 0
          ? [{ severity: 'critical' as const, label: 'Nessuna arma individuale assegnata', detail: `Servono ${n(required)} fucili: il deposito non è stato ancora assegnato a questa armata.` }]
          : []),
        ...(coveragePct < 95 && assigned > 0
          ? [{ severity: coveragePct < 60 ? 'critical' as const : 'warning' as const, label: `Copertura armi individuali ${coveragePct}%`, detail: `Mancano ${n(Math.max(0, required - assigned))} fucili alla dotazione d'epoca.` }]
          : []),
      ],
      actions: [],
      why: 'Armata come oggetto reale: uomini ed equipaggiamento **assegnati** sono suoi, non una quota dell\'aggregato. L\'equipaggiamento è stato tolto dal deposito nazionale (deposito + assegnato = totale).',
    });
  }

  // ── Reparti: la granularità sotto l'armata ────────────────────────────────
  // Ogni reparto ha uomini, pezzi e fabbisogni **propri**: l'armata che li
  // contiene è la loro somma (una sola fonte di verità).
  const armyById = new Map(input.armies.map(army => [String(army.id), army]));
  const frontById = new Map((input.fronts || []).map(front => [String(front.id), front]));
  const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: input.epoch }).menPerFormation;
  for (const unit of input.units || []) {
    // P4 — le schede reparto del quadro operativo sono quelle del **giocatore**:
    // i reparti delle altre polity compaiono nel read model del fronte, non
    // sotto «Forze armate del giocatore».
    if (String(unit.polityId) !== String(input.polityId)) continue;
    const army = armyById.get(String(unit.armyId));
    const required = rifleRequirement(input.epoch, 1);
    const assigned = equipmentQuantity(unit.equipment, rifleEquipmentId());
    const coveragePct = required > 0 ? round1(Math.min(100, assigned / required * 100)) : 100;
    const staffingPct = menPerFormation > 0 ? round1(Math.min(100, nonNegative(unit.personnel) / menPerFormation * 100)) : 100;
    const readinessPct = round1(unitReadiness({ unit, epoch: input.epoch }) * 100);
    const status = UNIT_OPERATING_STATUS[unit.status];
    const front = unit.frontId ? frontById.get(String(unit.frontId)) : undefined;
    const orderInfo = UNIT_ORDER_INFO[unit.order ?? UNIT_ORDER_DEFAULT];
    const unitFuelMonths = unit.monthlyNeeds.fuel > 0 && fuelMonths !== null ? fuelMonths : null;
    const share = underArms > 0 ? nonNegative(unit.personnel) / underArms : 0;
    const equipmentTotal = Math.round(sum(Object.values(unit.equipment || {})));
    objects.push({
      id: unit.id,
      kind: 'unit',
      label: unit.name,
      subtitle: `${army?.name || 'Armata'}${unit.regionName ? ` · ${unit.regionName}` : ''} · ${n(nonNegative(unit.personnel))} uomini`,
      status,
      statusLabel: UNIT_STATUS_LABEL[unit.status],
      parentId: String(unit.armyId),
      regionId: unit.regionId,
      regionName: unit.regionName,
      facts: [
        fact('stato', 'Uomini', Math.round(nonNegative(unit.personnel)), 'numero',
          tone(staffingPct, 95, 60), `Organico d'epoca: ${n(menPerFormation)} uomini per reparto.`),
        fact('stato', 'Equipaggiamento assegnato', equipmentTotal, 'numero', 'neutral',
          textList(unit.equipment) || 'Nessun pezzo assegnato: la dotazione è nel deposito nazionale.'),
        fact('capacita', 'Organico', staffingPct, 'pct', tone(staffingPct, 95, 60)),
        fact('capacita', 'Copertura armi individuali', coveragePct, 'pct', tone(coveragePct, 95, 80),
          `${n(assigned)} armi individuali assegnate su ${n(required)} richieste.`),
        fact('capacita', 'Prontezza', readinessPct, 'pct', tone(readinessPct, 80, 60),
          'Organico e dotazione, modulati da stato e carburante disponibile.'),
        fact('stato', 'Ordine', null, 'testo', 'neutral',
          `${UNIT_ORDER_LABEL[unit.order ?? UNIT_ORDER_DEFAULT]} — ${orderInfo.note} Pressione ×${orderInfo.pressure} · perdite ×${orderInfo.losses} · consumi di guerra ×${orderInfo.consumption}.`),
        fact('stato', 'Fronte', null, 'testo', 'neutral',
          front ? `${front.name} (${FRONT_STATUS_LABEL[front.status]})` : 'Nessun fronte: il reparto non è impegnato.'),
        fact('input', 'Carburante', unit.monthlyNeeds.fuel, 'per_mese'),
        fact('input', 'Armamenti', unit.monthlyNeeds.weapons, 'per_mese'),
        fact('input', 'Cibo', unit.monthlyNeeds.food, 'per_mese'),
        ...(input.militaryMonthlyMld !== undefined
          ? [fact('costi', 'Spese del reparto', round3(nonNegative(input.militaryMonthlyMld) * share), 'mld',
            'neutral', 'Quota delle spese militari mensili, in proporzione agli uomini del reparto.')]
          : []),
        ...(unitFuelMonths !== null
          ? [fact('autonomia', 'Carburante (scorte)', round1(unitFuelMonths), 'mesi',
            unitFuelMonths < FULL_TANK_MONTHS ? 'warning' : 'neutral', 'Scorta nazionale divisa per il consumo del paese.')]
          : []),
      ],
      problems: [
        ...(nonNegative(unit.personnel) <= 0
          ? [{ severity: 'critical' as const, label: 'Reparto senza uomini', detail: 'Nessun uomo assegnato: è un quadro organico, non una forza.' }]
          : []),
        ...(required > 0 && assigned <= 0
          ? [{ severity: 'critical' as const, label: 'Nessuna arma individuale assegnata', detail: `Servono ${n(required)} armi individuali: il deposito non è stato ancora assegnato a questo reparto.` }]
          : []),
        ...(coveragePct < 95 && assigned > 0
          ? [{ severity: coveragePct < 60 ? 'critical' as const : 'warning' as const, label: `Copertura armi individuali ${coveragePct}%`, detail: `Mancano ${n(Math.max(0, required - assigned))} armi individuali alla dotazione d'epoca del reparto.` }]
          : []),
        ...(nonNegative(unit.personnel) > 0 && staffingPct < 95
          ? [{ severity: 'warning' as const, label: `Organico incompleto ${staffingPct}%`, detail: `Mancano ${n(Math.max(0, menPerFormation - Math.round(nonNegative(unit.personnel))))} uomini per completare il reparto.` }]
          : []),
        ...(unitFuelMonths !== null && unitFuelMonths < OPERATION_MONTHS
          ? [{ severity: 'warning' as const, label: `Carburante: ${round1(unitFuelMonths)} mesi di operazioni`, detail: `Sotto i ${OPERATION_MONTHS} mesi la mobilità del reparto è limitata: il movimento paga cibo e carburante dal magazzino nazionale.` }]
          : []),
        ...(unit.status === 'destroyed'
          ? [{ severity: 'critical' as const, label: 'Reparto distrutto', detail: 'Non conta più nell\'armata (la somma è dei reparti attivi) e non ha ordini da eseguire.' }]
          : []),
        ...(unit.status === 'retreating'
          ? [{ severity: 'warning' as const, label: 'Reparto in ritirata', detail: 'Il ripiegamento lo porta in una provincia amica adiacente: se non ne esiste una, le perdite crescono.' }]
          : []),
        ...(front && front.status === 'stalemate'
          ? [{ severity: 'warning' as const, label: `Fronte ${front.name}: in stallo`, detail: 'Pressioni quasi pari: nessuno sfonda. Cambiare ordine o rinforzare sposta l\'equilibrio.' }]
          : []),
        ...(front && front.status === 'collapsed'
          // PR3 — il collasso non dice **quale** parte cede: senza il dato, il
          // testo non la inventa (anche una controffensiva può farlo collassare).
          ? [{ severity: 'critical' as const, label: `Fronte ${front.name}: collassato`, detail: "Il fronte è collassato: una delle parti non tiene più il contatto (pressione nettamente sbilanciata). Il reparto può ripiegare o essere distrutto." }]
          : []),
      ],
      actions: unitActions({
        unit,
        epoch: input.epoch,
        availableReserve: input.availableReserve,
        depotUnits: input.depotUnits,
        armies: input.armies,
        front,
      }),
      why: `Reparto dell'armata «${army?.name || unit.armyId}»: uomini, equipaggiamento e fabbisogni sono suoi, non una quota dell'aggregato. L'armata che lo contiene è la somma dei suoi reparti.`,
    });
  }

  // ── Fronti di guerra (P6–P9) ──────────────────────────────────────────────
  // Il fronte è il livello **strategico**: territorio conteso, unità coinvolte,
  // obiettivo, pressione. Le unità arrivano dal loro `frontId` (fonte unica):
  // qui si leggono, non si tiene un secondo elenco.
  for (const front of input.fronts || []) {
    // P4 — reparti **persistenti** del fronte, per lato (dal loro `frontId`: una
    // sola fonte). Prima i reparti del giocatore erano gli unici possibili;
    // adesso entrambe le parti possono averne, e vanno letti **entrambi**.
    const onFront = (input.units || []).filter(unit => String(unit.frontId) === String(front.id)
      && unit.status !== 'destroyed');
    const attacker = onFront;
    const attackerUnits = onFront.filter(unit => String(unit.polityId) === String(front.attackerPolityId));
    const defenderUnits = onFront.filter(unit => String(unit.polityId) === String(front.defenderPolityId));
    const ordersOf = (list: readonly MilitaryUnitState[]): string => {
      const counts = new Map<string, number>();
      for (const unit of list) {
        const order = UNIT_ORDER_LABEL[(unit.order ?? UNIT_ORDER_DEFAULT) as UnitOrder] || String(unit.order);
        counts.set(order, (counts.get(order) || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([order, count]) => `${count} ${order.toLowerCase()}`).join(' · ');
    };
    const status = FRONT_OPERATING_STATUS[front.status];
    const attackerPct = round1(nonNegative(front.attackerPressure) * 100);
    const defenderPct = round1(nonNegative(front.defenderPressure) * 100);
    const regionNames = front.regionIds
      .map(id => input.regions?.find?.(region => String(region.id) === String(id))?.name)
      .filter(Boolean) as string[];
    const objective = front.objectiveRegionId
      ? input.regions?.find?.(region => String(region.id) === String(front.objectiveRegionId))
      : undefined;
    objects.push({
      id: front.id,
      kind: 'front',
      label: front.name,
      subtitle: `${FRONT_STATUS_LABEL[front.status]} · ${attacker.length} ${attacker.length === 1 ? 'reparto' : 'reparti'}${objective ? ` · obiettivo ${objective.name}` : ''}`,
      status,
      statusLabel: FRONT_STATUS_LABEL[front.status],
      parentId: 'force',
      regionId: front.regionIds[0] ?? null,
      regionName: regionNames[0] ?? null,
      facts: [
        // PR3 — due cose diverse, con due campi diversi: i **ruoli storici** del
        // fronte (chi l'ha aperto) e l'**iniziativa reale** del periodo (chi
        // preme di più). `Iniziativa` è sola lettura (`momentumPolityId`): non
        // entra in pressioni, perdite, sfondamenti, rifornimenti o consumi.
        fact('stato', 'Attaccante', null, 'testo', 'neutral', `${front.attackerPolityId} · ruolo storico del fronte (non è «chi avanza»: vedi Iniziativa)`),
        fact('stato', 'Difensore', null, 'testo', 'neutral', `${front.defenderPolityId} · ruolo storico del fronte (non è «chi arretra»: vedi Iniziativa)`),
        fact('stato', 'Iniziativa', null, 'testo', 'neutral', front.momentumPolityId
          ? `${front.momentumPolityId} · pressione prevalente nell'ultimo periodo (sola lettura)`
          : "Nessuna iniziativa netta: pressioni pari nell'ultimo periodo"),
        fact('capacita', 'Pressione attaccante', attackerPct, 'pct', 'neutral', 'Somma delle forze effettive dei reparti attaccanti (forza × ordine × rifornimenti).'),
        fact('capacita', 'Pressione difensore', defenderPct, 'pct', 'neutral', 'Forze effettive della difesa: reparti persistenti più il supporto dichiarato dalla mappa.'),
        fact('stato', `Reparti persistenti · ${front.attackerPolityId}`, attackerUnits.length, 'numero', 'neutral', attackerUnits.length > 0
          ? `Reparti con questo fronte come \`frontId\`, del lato attaccante storico (${front.attackerPolityId}). Ordini: ${ordersOf(attackerUnits)}.`
          : `Nessun reparto **persistente** per ${front.attackerPolityId} su questo fronte: quella parte combatte con la forza dichiarata dalla mappa.`),
        fact('stato', `Reparti persistenti · ${front.defenderPolityId}`, defenderUnits.length, 'numero', 'neutral', defenderUnits.length > 0
          ? `Reparti con questo fronte come \`frontId\`, del lato difensore storico (${front.defenderPolityId}). Ordini: ${ordersOf(defenderUnits)}.`
          : `Nessun reparto **persistente** per ${front.defenderPolityId} su questo fronte: quella parte combatte con la forza dichiarata dalla mappa.`),
        fact('stato', 'Teatro', null, 'testo', 'neutral', regionNames.join(' · ') || 'Nessuna provincia di confine risolta'),
        fact('stato', 'Obiettivo dichiarato', null, 'testo', 'neutral', objective
          ? `${objective.name} · obiettivo dell'attaccante storico; una controffensiva calcola il proprio obiettivo sul confine corrente`
          : 'Nessun obiettivo raggiungibile dal teatro'),
        fact('costi', 'Consumi di guerra', null, 'testo', 'neutral', 'Attacco ×1,8 · Difesa ×1,2 · Riserva ×0,8 · Ritirata ×1,0 sui fabbisogni dei reparti.'),
      ],
      problems: [
        ...(attacker.length === 0
          ? [{ severity: 'critical' as const, label: 'Fronte senza reparti', detail: 'Nessuna unità assegnata: il fronte non produce pressione.' }]
          : []),
        ...(front.status === 'stalemate'
          ? [{ severity: 'warning' as const, label: 'Fronte in stallo', detail: 'Pressioni quasi pari: nessuno sfonda senza rinforzi o un cambio di ordine.' }]
          : []),
        ...(front.status === 'collapsed'
          // Collasso **simmetrico** (PR3): senza il dato della parte che cede,
          // il testo resta neutro.
          ? [{ severity: 'critical' as const, label: 'Fronte collassato', detail: "Il fronte è collassato: una delle parti non tiene più il contatto (pressione nettamente sbilanciata)." }]
          : []),
      ],
      actions: [],
      why: "Fronte di guerra: territorio conteso, unità (dal loro `frontId`) e obiettivo. Le conquiste passano solo da `transferRegion`, quando una parte ha intento offensivo, vantaggio di pressione sufficiente, avversario che non tiene più e un obiettivo adiacente valido — l'attaccante storico **o** il difensore che contrattacca. Il combattimento è risolto dal `FrontEngine` una volta per periodo materiale: gli ordini si danno ai reparti.", 
    });
  }

  // ── Impianti e miniere ────────────────────────────────────────────────────
  const totalLines = input.facilities.filter(facility => facility.kind !== 'mine')
    .reduce((total, facility) => total + nonNegative(facility.capacity), 0);
  const technologies = [...(input.technologies || [])];
  for (const facility of input.facilities) {
    if (facility.kind === 'mine') {
      const amount = nonNegative(facility.capacity);
      // Contributo del giacimento: la **differenza del motore** fra un impianto
      // con un punto di giacimento e uno senza, moltiplicata per i punti
      // dichiarati dal registro del paese. Nessuna formula riscritta qui.
      const contribution = facility.resourceKind
        ? endowmentContribution(facility.resourceKind as NaturalResourceKind, technologies)
        : {};
      objects.push({
        id: facility.id,
        kind: 'mine',
        label: facility.name,
        subtitle: `Giacimento ${amount}/5 dal registro del paese`,
        status: facility.status === 'idle' ? 'idle' : 'operational',
        statusLabel: OPERATING_STATUS_LABEL[facility.status === 'idle' ? 'idle' : 'operational'],
        parentId: null,
        regionId: facility.regionId,
        regionName: facility.regionName,
        facts: [
          fact('stato', 'Giacimento', amount, 'numero'),
          fact('capacita', 'Sfruttamento', round1(Math.min(100, amount / 5 * 100)), 'pct'),
          fact('personale', 'Addetti', facility.workers, 'numero'),
          ...Object.entries(contribution)
            .filter(([, perPoint]) => perPoint > 0)
            .map(([id, perPoint]) => fact(
              'output', `${materialLabel(id)} (a pieno regime)`, round3(perPoint * amount), 'per_mese', 'neutral',
              `Contributo di un punto di giacimento ×${amount} punti dichiarati dal registro del paese.`,
            )),
          // Per le risorse che il motore non fa entrare in una voce separata non
          // si mostra nulla: un contributo inventato sarebbe peggio del silenzio.
        ],
        problems: [],
        actions: [{ id: 'trade', label: 'Compra o vendi sul mercato', enabled: true, blockedReason: null }],
        why: `Miniera persistente sullo stesso giacimento dichiarato dal registro del paese${facility.resourceKind ? ` (${facility.resourceKind})` : ''}; il contributo produttivo resta quello calcolato dal motore.`,
      });
      continue;
    }
    const allocated = input.allocation?.facilities.find(entry => entry.facilityId === facility.id);
    const production: FacilityProductionResult = allocated
      ? {
        factor: allocated.factor,
        outputs: allocated.outputs,
        inputs: allocated.inputs,
        bottleneck: allocated.bottleneck
          ? {
            id: allocated.bottleneck.id,
            coveragePct: allocated.bottleneck.coveragePct,
            required: allocated.bottleneck.required,
            available: allocated.bottleneck.assigned,
          }
          : null,
      }
      : facilityProduction(facility, { stock: input.stock, endowment: input.endowment, activity });
    const lines = nonNegative(facility.capacity);
    const utilization = totalLines > 0 ? round1(Math.min(100, (facility.activeOrders.length * 4) / Math.max(1, lines) * 100)) : 0;
    const status: OperatingStatus = facility.status !== 'operational'
      ? facility.status === 'idle' ? 'idle' : facility.status === 'maintenance' ? 'maintenance' : 'operational'
      : production.factor <= 0 ? 'idle' : production.factor < 0.5 ? 'degraded' : 'operational';
    const assignedOrders = facility.activeOrders
      .map(id => input.ordersById?.[id])
      .filter((order): order is IndustrialOrderLike => Boolean(order));
    objects.push({
      id: facility.id,
      kind: 'facility',
      label: facility.name,
      subtitle: `${FACILITY_KIND_LABEL[facility.kind]}${facility.regionName ? ` · ${facility.regionName}` : ''}`,
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: null,
      regionId: facility.regionId,
      regionName: facility.regionName,
      facts: [
        fact('stato', 'Tipo', null, 'testo', 'neutral', FACILITY_KIND_LABEL[facility.kind]),
        fact('stato', 'Linee di lavorazione', lines, 'numero'),
        fact('stato', 'Stato impianto', null, 'testo', 'neutral', facility.status === 'operational' ? 'In funzione' : facility.status),
        fact('capacita', 'Utilizzo', utilization, 'pct', utilization >= 95 ? 'warning' : 'neutral'),
        fact('capacita', 'Ritmo di lavoro', round1(production.factor * 100), 'pct',
          production.factor <= 0 ? 'critical' : production.factor < 0.5 ? 'warning' : 'neutral'),
        fact('personale', 'Addetti', facility.workers, 'numero', 'neutral',
          facility.legacyDerived ? 'Addetti dal seed dichiarato (900 per linea di fabbrica, 1.200 di cantiere, 600 di ricerca).' : 'Addetti dell\'impianto, stato persistente.'),
        ...Object.entries(production.outputs).map(([id, quantity]) =>
          fact('output', materialLabel(id), quantity, 'per_mese', production.factor <= 0 ? 'critical' : 'neutral')),
        ...Object.entries(production.inputs).map(([id, quantity]) =>
          fact('input', materialLabel(id), quantity, 'per_mese')),
        ...(production.bottleneck
          ? [fact('input', `Input limitante: ${materialLabel(production.bottleneck.id)}`, production.bottleneck.coveragePct, 'pct',
            production.bottleneck.coveragePct < 50 ? 'critical' : 'warning',
            allocated
              ? `Assegnato ${n(production.bottleneck.available)} su ${n(production.bottleneck.required)} richiesti questo mese: la scorta è divisa fra gli impianti che chiedono lo stesso materiale.`
              : `Disponibile ${n(production.bottleneck.available)} su ${n(production.bottleneck.required)} richiesti questo mese.`)]
          : []),
        ...(input.civilMonthlyMld !== undefined && totalLines > 0
          ? [fact('costi', 'Costo operativo', round2(nonNegative(input.civilMonthlyMld) * (lines / totalLines)), 'mld',
            'neutral', 'Quota dei costi civili mensili, in proporzione alle linee dell\'impianto.')]
          : []),
        ...assignedOrders.flatMap(order => [
          fact('output', 'Ordine in lavorazione', null, 'testo', 'neutral',
            `${order.name} ×${n(order.quantity)} · ${Math.round(nonNegative(order.progress))}%`),
          ...(order.expectedDate ? [fact('autonomia', 'Consegna prevista', null, 'data', 'neutral', order.expectedDate)] : []),
        ]),
      ],
      problems: [
        ...(facility.status === 'idle'
          ? [{ severity: 'critical' as const, label: 'Impianto fermo', detail: 'Nessuna linea attiva: la produzione è zero.' }]
          : []),
        ...(production.factor > 0 && production.factor < 0.6 && !facility.legacyDerived
          ? [{ severity: 'warning' as const, label: `Produzione al ${round1(production.factor * 100)}%`, detail: production.bottleneck ? `Input insufficiente: ${production.bottleneck.id} al ${production.bottleneck.coveragePct}%.` : 'Attività delle linee ridotta.' }]
          : []),
      ],
      actions: [],
      why: `Impianto come oggetto: tipo e ricetta sono dichiarati, capacità, addetti e lavorazioni sono **suoi**. Output e input sono la scomposizione per impianto del profilo che il motore calcola con \`advanceStock\`; con input insufficiente la produzione si riduce in proporzione.`,
    });
  }

  // ── Marina: flotte e navi ─────────────────────────────────────────────────
  const shipById = new Map(input.ships.map(ship => [String(ship.id), ship]));
  for (const fleet of input.fleets) {
    const fleetShips = fleet.shipIds.map(id => shipById.get(String(id))).filter((ship): ship is ShipState => Boolean(ship));
    const crew = Math.round(fleetShips.reduce((total, ship) => total + nonNegative(ship.crew), 0));
    const fleetFuel = round3(fleetShips.reduce((total, ship) => total + nonNegative(ship.monthlyFuel), 0));
    const status: OperatingStatus = fleetShips.length === 0 ? 'idle' : fleetShips.every(ship => ship.status === 'operational') ? 'operational' : 'degraded';
    objects.push({
      id: fleet.id,
      kind: 'fleet',
      label: fleet.name,
      subtitle: `${fleetShips.length} navi · ${n(crew)} marinai`,
      status,
      statusLabel: OPERATING_STATUS_LABEL[status],
      parentId: 'navy',
      regionId: null,
      regionName: null,
      facts: [
        fact('stato', 'Navi', fleetShips.length, 'numero'),
        fact('personale', 'Equipaggi', crew, 'numero'),
        fact('input', 'Carburante', fleetFuel, 'per_mese'),
        ...(fuelMonths !== null ? [fact('autonomia', 'Carburante (scorte)', round1(fuelMonths), 'mesi', 'neutral', 'Scorta nazionale.')] : []),
      ],
      problems: [],
      actions: [],
      why: 'Flotta persistente: raggruppa navi reali, non una quota dell\'arsenale.',
    });
    for (const ship of fleetShips) {
      const equipment = equipmentById(ship.equipmentId);
      const status: OperatingStatus = ship.status === 'operational' ? 'operational' : ship.status === 'maintenance' ? 'maintenance' : 'critical';
      objects.push({
        id: ship.id,
        kind: 'ship',
        label: ship.name,
        subtitle: `${equipment?.name || ship.equipmentId}${equipment ? ` · ${equipment.category}` : ''}`,
        status,
        statusLabel: OPERATING_STATUS_LABEL[status],
        parentId: fleet.id,
        regionId: ship.regionId,
        regionName: null,
        facts: [
          fact('stato', 'Tipo', null, 'testo', 'neutral', equipment?.name || ship.equipmentId),
          fact('stato', 'Stato', null, 'testo', 'neutral', ship.status === 'operational' ? 'In servizio' : ship.status),
          fact('personale', 'Equipaggio', ship.crew, 'numero', 'neutral', 'Marinai imbarcati: uomini usciti dalla riserva addestrata.'),
          fact('input', 'Carburante', ship.monthlyFuel, 'per_mese'),
          fact('output', 'Munizionamento imbarcato', Math.round(sum(Object.values(ship.ammunition || {}))), 'numero',
            'neutral', textList(ship.ammunition) || 'Nessun munizionamento assegnato alla nave.'),
          ...(fuelMonths !== null ? [fact('autonomia', 'Carburante (scorte)', round1(fuelMonths), 'mesi', 'neutral', 'Scorta nazionale divisa per il consumo del paese.')] : []),
        ],
        problems: ship.crew <= 0
          ? [{ severity: 'critical' as const, label: 'Nessun equipaggio', detail: 'Una nave senza equipaggio non è operativa.' }]
          : [],
        actions: [],
        why: 'Nave persistente: scafo e equipaggio sono suoi, non una riga dell\'arsenale. Lo scafo è uscito dal deposito all\'ingresso in servizio.',
      });
    }
  }

  // ── Cantieri ──────────────────────────────────────────────────────────────
  for (const construction of input.constructions) {
    objects.push({
      id: construction.id,
      kind: 'construction',
      label: shortTitle(construction.targetName),
      subtitle: construction.regionName ? `Cantiere in ${construction.regionName}` : 'Cantiere nazionale',
      status: 'under_construction',
      statusLabel: OPERATING_STATUS_LABEL.under_construction,
      parentId: null,
      regionId: construction.regionId,
      regionName: construction.regionName,
      facts: [
        fact('stato', 'Avanzamento', round1(nonNegative(construction.progress)), 'pct'),
        fact('stato', 'Diventerà', null, 'testo', 'neutral',
          construction.targetType === 'ship' ? 'Nave' : FACILITY_KIND_LABEL[construction.targetType]),
        fact('capacita', 'Linee occupate dai lavori', construction.capacityDemand, 'numero'),
        fact('input', 'Materiali richiesti', null, 'testo', 'neutral',
          Object.entries(construction.materialRequirements).map(([id, quantity]) => `${id} ${n(quantity)}`).join(' · ') || 'Nessun requisito dichiarato'),
        fact('costi', 'Costo residuo', construction.costRemaining, 'mld'),
        ...(construction.expectedDate ? [fact('autonomia', 'Consegna prevista', null, 'data', 'neutral', construction.expectedDate)] : []),
        fact('output', 'Beneficio', 0, 'numero', 'neutral', 'Nessuno prima del completamento: l\'opera entra nei conti solo a lavori finiti.'),
      ],
      problems: input.blocked
        ? [{ severity: 'critical' as const, label: 'Cantiere fermo: nessuna capacità industriale', detail: 'Senza impianti i lavori non avanzano.' }]
        : [],
      actions: [],
      why: `Cantiere persistente: progresso, requisiti e costo residuo sono **suoi**.${shortTitle(construction.targetName) !== construction.targetName.trim() ? ` Opera: ${construction.targetName}` : ''} A lavori finiti diventa un impianto a sé, con la sua capacità.`,
    });
  }

  return objects;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + nonNegative(value), 0);
