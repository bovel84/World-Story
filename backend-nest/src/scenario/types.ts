/**
 * World Story — M01 µ1: tipi del catalogo di scenario (maestro §4).
 * =============================================================
 * Frammenti concettuali del maestro trasformati in schemi runtime
 * discriminati. Convenzioni numeriche §4.1: quantità additive come
 * IntString (stringhe decimali canoniche), MAI numeri IEEE-754;
 * ratei come razionali numerator/denominator; capacità DISTINTA dalle
 * quantità (MW ≠ MWh, persone ≠ ore-lavoro).
 */

/** Stringa decimale canonica: /^-?(0|[1-9][0-9]*)$/, no -0, no zero pilota. */
export type IntString = string;
// M02 µ1: il codec canonico vive in domain/quantities (§4.1); il catalogo
// di scenario riusa ESATTAMENTE le stesse regole (limite anti-abuso incluso).
export { INT_STRING_RE, isIntString } from '../domain/quantities';

/** Qualità della fonte: mai fabbricare dati (maestro §4.2). */
export type SourceQuality = 'sourced' | 'estimated' | 'authored' | 'unknown';

export interface Evidence {
  quality: SourceQuality;
  sourceRefs: string[];
  /** ISO-8601 date: momento in cui il dato è valido. */
  validAt: string;
  methodVersion?: string;
}

/** Intervalli stimati low/base/high con provenienza; non sono probabilità. */
export interface EstimatedRange {
  low: IntString;
  base: IntString;
  high: IntString;
  evidence: Evidence;
}

export type StrictnessMode = 'strict' | 'authored';
/** Dichiarazione del catalogo: fixture tecnica, storico rigoroso o ucronia. */
export type CatalogDeclaration = 'synthetic' | 'historical_rigorous' | 'historical_estimated' | 'ucronia';

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface ScenarioManifest {
  id: string;
  version: number;
  schemaVersion: 1;
  /** Data corrente autorevole della partita, distinta da creazione/versione. */
  startDate: string;
  mode: StrictnessMode;
  declaration: CatalogDeclaration;
  /** Catalogo valuta (maestro §4.1: unità monetarie minime dal catalogo).
   *  Valuta di conto primaria del catalogo. */
  currency: { id: string; minorUnitName: string };
  /**
   * µ2-bis: valute AMMESSE per i treasury delle polities (es. USD e SUR nel
   * pilota). Opzionale e retrocompatibile: se assente, vale solo `currency`.
   * Ogni treasury.currencyId DEVE appartenere a questo insieme (o a `currency`).
   */
  currencies?: Array<{ id: string; minorUnitName: string }>;
  sources: string[];
  /** Compilato dal loader: hash di contenuto per catalogo (basis cache MAT18). */
  catalogHashes?: Record<string, string>;
}

// ─── Risorse, conoscenze, ricette, impianti ─────────────────────────────────

export type UnitKind = 'mass' | 'volume' | 'energy' | 'power' | 'work' | 'count';

export interface ResourceDefinition {
  id: string;
  name: string;
  unit: { kind: UnitKind; symbol: string };
  transportable: boolean;
  conserved: boolean;
  deteriorates?: boolean;
  discrete?: boolean;
}

export interface Quantity {
  resourceId: string;
  baseUnits: IntString;
}

/** Nodi conoscenza/capacità: DAG (niente cicli a tempo zero, §4.4). */
export interface KnowledgeNode {
  id: string;
  domain: string;
  requires: string[];
  validFrom?: string;
}

export interface Recipe {
  id: string;
  name: string;
  facilityTypeId: string;
  inputs: Quantity[];
  outputs: Quantity[];
  durationDays: number;
  /**
   * Riciclo a durata positiva con perdite/consumi espliciti è ammesso
   * (§4.4); un ciclo amplificatore a tempo zero non è mai valido.
   */
  allowsRecycle?: boolean;
  evidence?: Evidence;
}

export interface FacilityType {
  id: string;
  name: string;
  /** Capacità NON si somma alle quantità (§4.1.7). */
  capacity: { unit: string; perDay: IntString };
  maintenance?: { resourceId: string; baseUnits: IntString; periodDays: number };
}

// ─── Attori, autorità R1, polities ──────────────────────────────────────────

export type ActorType = 'treasury' | 'public_enterprise' | 'private_sector' | 'bank' | 'carrier' | 'household';

/** EconomicActor distinto da Polity (§4.3.1): il settore privato non è
 *  magazzino del governo; il totale nazionale è proiezione. */
export interface EconomicActor {
  actorId: string;
  polityId: string;
  type: ActorType;
  name: string;
}

export type ApprovalKind = 'user' | 'institutional' | 'counterparty';

/** Matrice minima di autorità R1 (§4.3.1): decisore, attività, limiti,
 *  approvazioni. Tre consensi separati: utente, istituzionale, controparte. */
export interface AuthorityRule {
  id: string;
  actorType: ActorType;
  activity: string;
  limits?: Array<{
    resourceId?: string;
    currencyId?: string;
    maxPerPeriod?: IntString;
    periodDays?: number;
  }>;
  requiresApprovals: ApprovalKind[];
}

export interface Polity {
  id: string;
  name: string;
  governmentFormAtStart: string;
}

// ─── Stato iniziale ─────────────────────────────────────────────────────────

export interface Deposit {
  id: string;
  resourceId: string;
  regionId: string;
  /** Quantità conosciuta: null = il dato autorevole manca (needs_data),
   *  NON assenza del giacimento (§4.2: ignoranza distinta da assenza). */
  known: Quantity | null;
  estimated?: EstimatedRange;
  accessibility: 'open' | 'requires_extraction' | 'hidden';
  yieldRate?: { numerator: IntString; denominator: IntString };
}

export interface InventoryLot {
  id: string;
  ownerActorId: string;
  custodianActorId?: string;
  regionId: string;
  quantity: Quantity;
  constraints?: string[];
}

export interface TreasuryAccount {
  id: string;
  actorId: string;
  currencyId: string;
  balanceMinorUnits: IntString;
}

export interface WorkforcePool {
  id: string;
  regionId: string;
  qualification: string;
  /** Persone intere: non ore di lavoro (§4.1.7). */
  persons: IntString;
}

export interface FacilityInstance {
  id: string;
  typeId: string;
  ownerActorId: string;
  controllerActorId: string;
  regionId: string;
  operational: boolean;
}

export interface InitialState {
  treasuries: TreasuryAccount[];
  inventory: InventoryLot[];
  deposits: Deposit[];
  workforce: WorkforcePool[];
  facilities: FacilityInstance[];
}

/** Catalogo completo caricato e validato. */
export interface SimulationCatalog {
  manifest: ScenarioManifest;
  polities: Polity[];
  resources: ResourceDefinition[];
  technologies: KnowledgeNode[];
  recipes: Recipe[];
  facilityTypes: FacilityType[];
  actors: EconomicActor[];
  authorities: AuthorityRule[];
  initialState: InitialState;
}