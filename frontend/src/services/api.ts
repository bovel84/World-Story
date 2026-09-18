/**
 * World Story — API Service
 * =====================
 */

import type {
  CreateWorldRequest,
  CreateWorldResponse,
  CreateGameRequest,
  CreateGameResponse,
  SubmitActionRequest,
  SubmitActionResponse,
  AdvisorResponse,
  Game,
  World,
  Country,
  WorldTemplate
} from '../types';

import { ownerHeaders } from './ownerToken';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/** Caratteristica tecnica di un equipaggiamento (lettura, non calcolo). */
export interface EquipmentSpec { label: string; value: string; }

/** Voce del catalogo militare pubblicata dal motore (con fattibilità). */
export interface ArsenalCatalogItem {
  id: string; name: string; domain: string; category: string;
  quality: number; tier: string; costMln: number; weaponsCost: number;
  /** Che cos'è: ruolo operativo, descrizione estesa e caratteristiche. */
  role: string; description: string; specs: EquipmentSpec[];
  canBuild: boolean; canBuy: boolean; buildCostMln: number; buyCostMln: number; reasons: string[];
}

/** Riga dell'arsenale in servizio, con scheda e contributo alla forza. */
export interface ArsenalLine {
  id: string; name: string; domain: string; domainLabel: string; category: string;
  quality: number; tier: string; quantity: number;
  role: string; description: string; specs: EquipmentSpec[];
  /** Contributo alla forza dell'arsenale (quantità × qualità × peso dominio). */
  strength: number;
  /** Quota percentuale di questa voce sulla forza totale. */
  sharePct: number;
}

/**
 * Manpower pubblicato dal motore: **uomini**, non reparti. `formations` e
 * `mobilizedFormations` sono i reparti del conto nazionale; `activePersonnel`,
 * `reservePersonnel`, `mobilizedPersonnel` e `availableReserve` sono la
 * conversione in personale fatta dal motore con la dottrina dell'epoca.
 */
export interface MilitaryManpowerPayload {
  population: number;
  /** Popolazione in età utile: il bacino teorico. */
  eligiblePopulation: number;
  /** Massimo mobilitabile in extremis. */
  totalMilitaryPool: number;
  activePersonnel: number;
  /** Riservisti addestrati, compresi quelli già richiamati. */
  reservePersonnel: number;
  mobilizedPersonnel: number;
  /** Riservisti non ancora richiamati. */
  availableReserve: number;
  formations: number;
  mobilizedFormations: number;
  menPerFormation: number;
  /** Tetto di richiamo simultaneo deciso dalla dottrina d'epoca. */
  mobilizationCap: number;
  /** Quanti riservisti si possono ancora richiamare dentro il tetto. */
  mobilizationHeadroom: number;
  /** I richiamati dichiarati dal motore superano il tetto d'epoca. */
  overMobilized: boolean;
}

/** Dotazione di riferimento di una categoria, con la sua origine dichiarata. */
export interface EstablishmentCategoryPayload {
  category: string;
  label: string;
  /**
   * Pezzi per reparto: `null` per le categorie a **quota di personale** (armi
   * individuali), che non hanno una dotazione per reparto.
   */
  perFormation: number | null;
  perMobilized: number | null;
  /** Quota d'epoca degli uomini in armi con arma individuale, in %. */
  personnelSharePct: number | null;
  /** Come si calcola il fabbisogno della categoria. */
  demand: 'per_formation' | 'personnel_share';
  weight: number;
  source: 'engine_seed' | 'doctrine';
  basis: string;
}

/** Copertura di una categoria: possesso reale sul fabbisogno del personale. */
export interface EquipmentCoveragePayload {
  category: string;
  label: string;
  required: number;
  available: number;
  coveragePct: number;
  missing: number;
  items: string[];
  weight: number;
}

/** Driver della prontezza operativa, con il tono deciso dal motore. */
export interface ReadinessDriverPayload {
  tone: 'positive' | 'warning' | 'critical' | 'neutral';
  label: string;
  detail?: string;
}

export interface MilitaryReadinessPayload {
  readinessPct: number;
  status: 'healthy' | 'stable' | 'pressure' | 'fragile' | 'critical';
  drivers: ReadinessDriverPayload[];
}

/** Lavorazione che occupa capacità industriale (ordine, progetto o impianto). */
export interface IndustrialAllocationPayload {
  id: string;
  kind: 'military_production' | 'project' | 'maintenance';
  label: string;
  capacityDemand: number;
  sector: string;
  basis: string;
}

/** Capacità industriale calcolata dal motore: totale, occupazione, saturazione. */
export interface IndustrialCapacityPayload {
  total: number;
  used: number;
  free: number;
  utilizationPct: number;
  demand: number;
  satisfactionPct: number;
  /** Fattore di rallentamento applicato quando la domanda supera la capacità. */
  overflowFactor: number;
  saturated: boolean;
  /** Nessuna capacità e lavoro da fare: la produzione è **bloccata** (fattore 0). */
  blocked: boolean;
  allocations: IndustrialAllocationPayload[];
  byKind: Record<string, number>;
  defenceSharePct: number;
  totalBasis: string;
}

/** Legenda di un dominio militare: cosa copre e quanto pesa. */
export interface DomainInfo { domain: string; label: string; weight: number; description: string; }

/** Ordine di produzione militare con percentuale di completamento. */
export interface ProductionOrder {
  id: string;
  equipmentId: string;
  name: string;
  domain: string;
  quantity: number;
  progress: number;
  spentMln: number;
  startedTurn: number;
  startedDate: string;
  status: 'in_progress' | 'completed' | 'failed';
  note: string;
  qualityLoss: number;
  updatedDate: string;
  /** Data di consegna prevista, ricalcolata dal motore sul ritmo reale. */
  expectedDate?: string | null;
}

/** Arsenale, risorse naturali reali e capacità industriale della nazione. */
export interface ArsenalResponse {
  polityId: string;
  units: Record<string, number>;
  strength: number;
  qualityIndex: number;
  combatFactor: number;
  baseMilitaryPower: number;
  effectiveMilitaryPower: number;
  lines: ArsenalLine[];
  naturalResources: Record<string, number>;
  naturalResourcesText: string;
  /** Legenda dei domini militari: cosa sono e quanto pesano nella forza. */
  domains: DomainInfo[];
  /** Debito pubblico (mld USD) e tetto di credito. */
  debt: number;
  creditLimit: number;
  /** Ordini di produzione con percentuale di completamento. */
  production: { orders: ProductionOrder[]; inProgress: number };
  capacity: { factories: number; ports: number; universities: number; money: number; weapons: number; credit: number; technologies: string[] };
  catalog: ArsenalCatalogItem[];
  /** Epoca militare dello scenario (dalla data d'inizio): fissa la dottrina. */
  epoch: 'pre_industriale' | 'grande_guerra' | 'seconda_guerra' | 'guerra_fredda' | 'moderno';
  epochLabel: string;
  /** Dotazioni di riferimento delle sole categorie pertinenti all'epoca. */
  establishment: EstablishmentCategoryPayload[];
  /** Uomini: attivi, riserva addestrata, richiamati. */
  manpower: MilitaryManpowerPayload;
  /** Copertura per categoria dal personale effettivo e dall'arsenale reale. */
  coverage: EquipmentCoveragePayload[];
  /** Prontezza operativa con i suoi driver. */
  readiness: MilitaryReadinessPayload;
  /** Capacità industriale: linee, occupazione, saturazione. */
  industrialCapacity: IndustrialCapacityPayload;
  /** OP-OBJECTS — oggetti concreti e catene produttive (sala di governo). */
  objects: OperatingPicturePayload;
}

// ── OP-OBJECTS: la sala di governo (oggetti concreti) ───────────────────────

/** Le sezioni della grammatica universale degli oggetti. */
export type OperatingFactSection = 'stato' | 'capacita' | 'personale' | 'input' | 'output' | 'costi' | 'autonomia';

/** Come si legge un fatto: numero, percentuale, miliardi, milioni, flusso, mesi, testo. */
export type OperatingFactUnit = 'numero' | 'pct' | 'mld' | 'mln' | 'per_mese' | 'mesi' | 'data' | 'testo';

export interface OperatingFactPayload {
  section: OperatingFactSection;
  label: string;
  value: number | null;
  unit: OperatingFactUnit;
  text?: string | null;
  tone?: 'positive' | 'warning' | 'critical' | 'neutral';
}

export interface OperatingProblemPayload {
  severity: 'critical' | 'warning';
  label: string;
  detail?: string | null;
}

export interface OperatingActionPayload {
  id: 'raise_formation' | 'procure' | 'trade';
  label: string;
  enabled: boolean;
  blockedReason?: string | null;
}

export type OperatingKindPayload =
  | 'force' | 'army' | 'facility' | 'construction' | 'navy' | 'fleet' | 'ship' | 'mine';

/** Un oggetto concreto del paese: armata, impianto, cantiere, nave, miniera. */
export interface OperatingObjectPayload {
  id: string;
  kind: OperatingKindPayload;
  label: string;
  subtitle?: string | null;
  status: 'operational' | 'degraded' | 'maintenance' | 'idle' | 'under_construction' | 'critical';
  statusLabel: string;
  parentId?: string | null;
  regionId?: string | null;
  regionName?: string | null;
  facts: OperatingFactPayload[];
  problems: OperatingProblemPayload[];
  actions: OperatingActionPayload[];
  why?: string | null;
}

export interface OperatingChainPayload {
  id: string;
  label: string;
  steps: Array<{ label: string; value: number; unit: OperatingFactUnit; tone: string; detail?: string | null }>;
  broken: boolean;
  summary: string;
}

/** Quadro operativo pubblicato dal motore dentro `/arsenal`. */
export interface OperatingPicturePayload {
  objects: OperatingObjectPayload[];
  chains: OperatingChainPayload[];
  counts: Record<string, number>;
  conventions: string[];
}

/** Una riga PRIMA → DOPO della creazione di reparti (numeri del motore). */
export interface FormationDeltaPayload {
  label: string;
  unit: OperatingFactUnit;
  before: number;
  after: number;
  tone: 'positive' | 'warning' | 'critical' | 'neutral';
}

export interface FormationPlanItemPayload {
  equipmentId: string;
  name: string;
  required: number;
  available: number;
  consumed: number;
  missing: number;
  unitCostMln: number;
}

export interface FormationImpactPayload {
  plan: {
    men: number;
    items: FormationPlanItemPayload[];
    riflesRequired: number;
    riflesAvailable: number;
    riflesMissing: number;
    initialCostMln: number;
    blocked: boolean;
    blockedReason: string | null;
    basis: string;
  };
  armyId: string | null;
  armyName: string;
  targetRegionId: string;
  target: { regionId: string; regionName: string; armyName: string; armyId: string | null };
  before: Record<string, number>;
  after: Record<string, number>;
  deltas: FormationDeltaPayload[];
  why: string;
}

/** Esito reale della creazione di reparti (il motore ha già applicato tutto). */
export interface RaiseFormationResult extends FormationImpactPayload {
  applied: boolean;
  formations: number;
  name: string;
  regionId: string;
  regionName: string;
  spentMln: number;
  financedMln: number;
  impact: FormationImpactPayload;
}

/** Titolo del debito pubblico: capitale, tasso annuo e scadenza. */
export interface SovereignDebtTranche {
  id: string;
  label: string;
  principal: number;
  annualRatePct: number;
  issuedDate: string;
  maturityDate: string;
  termYears: number;
}

/** Stato dinamico di una risorsa naturale: giacimento, riserva, magazzino. */
export interface NaturalResourceSummary {
  kind: string;
  label: string;
  renewable: boolean;
  endowment: number;
  reserve: number;
  maxReserve: number;
  stockpile: number;
  extractionPerMonth: number;
  depletionPct: number;
  depleted: boolean;
}

/** Quotazione di mercato di una risorsa naturale. */
export interface ResourceQuote {
  kind: string;
  label: string;
  base: number;
  mid: number;
  bid: number;
  ask: number;
  scarcityPct: number;
}

/** Voce del bilancio nazionale: importo mensile (mld) e quota sul totale. */
export interface BudgetLine {
  id: string;
  label: string;
  amount: number;
  sharePct: number;
}

/** Dettaglio del bilancio pubblicato dal motore (somma delle voci = totale). */
export interface NationalBudgetDetail {
  currency: 'mld';
  revenue: BudgetLine[];
  expense: BudgetLine[];
  revenueTotal: number;
  expenseTotal: number;
  balance: number;
  effectiveTaxRatePct: number;
  defenceBurdenPct: number;
  socialBurdenPct: number;
  educationBurdenPct: number;
}

/** Politica fiscale corrente del giocatore (aliquota scelta, % del PIL). */
export interface FiscalPolicyInfo {
  taxRatePct: number;
  label: string;
  minPct: number;
  maxPct: number;
  effects: string[];
  /** Aliquota calcolata dal profilo, usata finché il giocatore non sceglie. */
  defaultPct: number;
  /** True se il giocatore ha scelto esplicitamente l'aliquota. */
  configured: boolean;
}

export type FactionStance = 'alleato' | 'favorevole' | 'neutrale' | 'critico' | 'ostile';

/** Sfida di pace: interna o esterna, con le opzioni di risposta. */
export interface PeacetimePressure {
  id: string;
  kind: 'internal' | 'external';
  template: string;
  title: string;
  detail: string;
  severity: number;
  source: string;
  options: Array<{
    id: string;
    label: string;
    detail: string;
    effect?: { moneyDeltaMld?: number; note?: string };
  }>;
  status: 'active' | 'resolved' | 'expired' | string;
  createdDate: string;
  createdTurn: number;
  /**
   * GAMEPLAY-LONG: finestra di decisione in GIORNI di calendario. Una sfida nei
   * termini resta aperta; oltre la scadenza il motore applica l'inerzia.
   */
  durationDays?: number;
  deadlineDate?: string | null;
  escalated?: boolean;
  window?: {
    daysElapsed: number;
    daysLeft: number;
    expired: boolean;
    escalationDue: boolean;
    urgency: 'scaduta' | 'imminente' | 'prossima' | 'aperta';
  };
  /** P2: peso della questione per il briefing. */
  priority?: 'critica' | 'rilevante' | 'ordinaria';
  /** Merita attenzione adesso (max 2 per volta, salvo crisi). */
  highlighted?: boolean;
  resolvedOption?: string | null;
  resolution?: string | null;
}

/** Dimensione della crisi nazionale: rivolta, default o invasione. */
export type CrisisDimension = 'revolt' | 'insolvency' | 'invasion';
export type CrisisLevel = 'calm' | 'watch' | 'critical';

/** Rischio calcolato dal motore su una delle tre strade del collasso. */
export interface CrisisRisk {
  dimension: CrisisDimension;
  level: CrisisLevel;
  /** Punteggio 0-100: deterministico, non un giudizio del modello. */
  score: number;
  title: string;
  detail: string;
  /** Fattori reali che hanno prodotto il punteggio. */
  drivers: string[];
}

/** Epilogo: la nazione è caduta e la partita è finita. */
export interface GameEnding {
  kind: 'revolution' | 'default' | 'invasion';
  dimension: CrisisDimension;
  title: string;
  summary: string;
  date: string;
  turn: number;
  criticalDimensions: CrisisDimension[];
}

export interface NationCrisisState {
  level: CrisisLevel;
  risks: CrisisRisk[];
  headline: string;
  summary: string;
  /**
   * GAMEPLAY-LONG: giorni di criticità accumulati per dimensione. La crisi
   * progredisce sul TEMPO CALENDARIO trascorso, non sul numero di turni: un
   * avanzamento di 7 giorni e uno di 365 non pesano uguale.
   */
  criticalDays: Record<CrisisDimension, number>;
  /** Avanzamenti in cui la dimensione è stata vista critica (avvertimenti). */
  episodes?: Record<CrisisDimension, number>;
  /** Giorni di criticità piena che portano al collasso. */
  collapseDays?: number;
  ending: GameEnding | null;
}

export interface CrisisSnapshot {
  state: NationCrisisState;
  ending: GameEnding | null;
  finished: boolean;
  /** Giorni di criticità piena che portano al collasso. */
  collapseDays: number;
}
export type FactionLever = 'difesa' | 'tasse' | 'welfare' | 'istruzione' | 'infrastrutture' | 'debito' | 'ordine';

/** Richiesta concreta di una fazione del governo. */
export interface FactionDemand {
  lever: FactionLever;
  title: string;
  detail: string;
  direction: 'alza' | 'abbassa' | 'mantieni';
  urgency: number;
}

/** Un'anima del governo: interesse, influenza, umore e richiesta. */
export interface GovernmentFaction {
  id: string;
  name: string;
  interest: string;
  powerPct: number;
  satisfaction: number;
  stance: FactionStance;
  pressure: number;
  demand: FactionDemand;
  footprint: string;
  /**
   * GAMEPLAY-LONG: come il governo ha **trattato** questa fazione (fiducia,
   * risentimento, tendenza, ultima decisione). Assente se non è mai successo
   * nulla di politicamente rilevante.
   */
  politicalMemory?: {
    trust: number;
    resentment: number;
    trend: 'in ripresa' | 'stabile' | 'in calo';
    lastEvent: { kind: string; turn: number; gameDate: string; text: string; weight: number } | null;
    favors: number;
    grievances: number;
    pressure: number;
  };
}

/** Snapshot del governo: anime attive + dettaglio del bilancio. */
export interface GovernmentSnapshot {
  factions: GovernmentFaction[];
  dominantId: string | null;
  angriestId: string | null;
  cohesion: number;
  pressureIndex: number;
  headline: string;
  budget: NationalBudgetDetail;
  /** Debito pubblico: rapporto sul PIL e peso degli interessi sulle entrate. */
  debt?: { ratioPct: number; servicePct: number };
  /** Fazioni che si sentono tradite (memoria politica), dalla più risentita. */
  resentful?: { factionId: string; name: string; resentment: number; trust: number; trend: string; text: string }[];
  /** Fiducia politica media verso il governo (0-100); `null` senza memoria. */
  trustIndex?: number | null;
}

/** GAMEPLAY-LONG: un impegno registrato dal motore (trattato, promessa…). */
export interface Commitment {
  id: string;
  type: string;
  actor: string;
  counterparty: string | null;
  description: string;
  createdDate: string;
  createdTurn: number;
  status: 'active' | 'fulfilled' | 'broken' | 'expired' | 'superseded' | string;
  deadline: string | null;
  sourceEventId: string | null;
  importance: number;
  updatedDate: string;
  updatedTurn: number;
  note: string;
}

/** GAMEPLAY-LONG: obiettivo strategico di una polity non giocante. */
export interface StrategicObjective {
  id: string;
  description: string;
  type: string;
  priority: number;
  progress: number;
  since: string;
  reviewDate: string;
  reason: string;
}

/** Che cosa sta inseguendo una potenza del teatro, da quando e a che punto è. */
export interface PowerAgenda {
  polityId: string;
  name: string;
  objectives: StrategicObjective[];
}

/** Voci del consiglio generate dall'LLM sulle fazioni del motore. */
export interface GovernmentVoicesResponse {
  /** Sintesi scorrevole del consiglio. */
  council: string;
  /** Petizione per id di fazione. */
  voices: Record<string, string>;
  /** False quando il modello non ha risposto: la UI usa la richiesta deterministica. */
  generated: boolean;
}


class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...ownerHeaders(),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const rawError = await response.text();
    const isHtml = response.headers.get('content-type')?.includes('text/html')
      || /^\s*<!doctype html/i.test(rawError);
    const errorText = isHtml && [502, 503, 504].includes(response.status)
      ? 'Backend temporaneamente non raggiungibile attraverso il proxy. Riprova tra pochi secondi.'
      : rawError.slice(0, 1000);
    // Evita di riversare in console intere pagine HTML del proxy: il
    // messaggio compatto resta leggibile anche durante un riavvio del backend.
    console.error('[API Error]', response.status, endpoint, errorText);
    throw new ApiError(response.status, `API Error: ${response.statusText || response.status} - ${errorText}`);
  }
  
  return response.json();
}


// ============================================================================
// World API
// ============================================================================

export const worldApi = {
  /**
* Crea un nuovo mondo
   */
  create: (data: CreateWorldRequest): Promise<CreateWorldResponse> => {
    return fetchApi('/worlds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Crea un mondo da una mappa
   */
  createFromMap: (data: {
    mapId: string;
    name: string;
    description?: string;
    startDate?: string;
    basePrompt?: string;
    historicalAccuracy?: number;
    initialOwners?: { id: string; owner: string }[];
  }): Promise<{
    world_id: string;
    name: string;
    regions_count: number;
    regions: { id: string; name: string; color: string; owner: string }[];
  }> => {
    return fetchApi('/worlds/from-map', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Ottieni il mondo per ID
   */
  get: (worldId: string): Promise<World> => {
    return fetchApi(`/worlds/${worldId}`);
  },

  /**
* Aggiungi una regione alla mappa del mondo
   */
  addRegion: (worldId: string, region: {
    id: string;
    name: string;
    svg_path: string;
    color: string;
  }): Promise<{ id: string; name: string }> => {
    return fetchApi(`/worlds/${worldId}/regions`, {
      method: 'POST',
      body: JSON.stringify(region),
    });
  },

  /**
* Aggiorna il prompt del mondo
   */
  updatePrompt: (worldId: string, basePrompt: string): Promise<{ success: boolean; basePrompt: string }> => {
    return fetchApi(`/worlds/${worldId}/prompt`, {
      method: 'PATCH',
      body: JSON.stringify({ basePrompt }),
    });
  },

  /**
   * Genera un mondo da un template (tramite Balance Agent).
   *
   * Flusso ASINCRONO: il POST risponde subito con { jobId } e il client
   * interroga GET /worlds/jobs/:jobId finché il job non è completato.
   * Necessario perché la generazione può durare minuti e i proxy
   * interrompono le richieste oltre ~100s con un errore 524.
   *
   * onProgress (opzionale) riceve { done, total, stage } dal backend per
   * mostrare l'avanzamento reale nel loader.
   */
  generateFromTemplate: async (
    templateId: string,
    playerCountryCode: string,
    onProgress?: (p: { done: number; total: number; stage: string }) => void
  ): Promise<{
    templateId: string;
    worldId: string;
    date: string;
    countries: Record<string, any>;
    regions: Record<string, any>;
    regionIds?: Record<string, string>;
    playerCountryCode: string;
  }> => {
    const start = await fetchApi<{ jobId: string; status: string }>('/worlds/generate', {
      method: 'POST',
      body: JSON.stringify({ templateId, playerCountryCode }),
    });

    let pollMs = 250;
    const MAX_WAIT_MS = 20 * 60 * 1000; // tetto di sicurezza: 20 minuti
    const deadline = Date.now() + MAX_WAIT_MS;
    // Reti flottanti (backend in riavvio, tunnel che salta): 4 tentativi
    // consecutivi falliti = errore reale. Un singolo buco NON uccide la generazione.
    const MAX_TRANSIENT_FAILURES = 6;
    let transientFailures = 0;

    for (;;) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      let job: {
        status: 'queued' | 'running' | 'completed' | 'failed';
        progress?: { done: number; total: number; stage: string };
        result?: any;
        error?: string;
      };
      try {
        job = await fetchApi<{
          status: 'queued' | 'running' | 'completed' | 'failed';
          progress?: { done: number; total: number; stage: string };
          result?: any;
          error?: string;
        }>(`/worlds/jobs/${start.jobId}`);
        transientFailures = 0;
      } catch (e) {
        // Errore di rete/momentaneo: riprova con pazienza (il backend può
        // riavviarsi durante la generazione, es. redeploy)
        transientFailures++;
        if (transientFailures > MAX_TRANSIENT_FAILURES) {
          throw new Error('Generazione mondo: backend non raggiungibile. Riprova tra poco.');
        }
        onProgress?.({ done: 0, total: 0, stage: `Connessione instabile, riprovo… (${transientFailures}/${MAX_TRANSIENT_FAILURES})` });
        continue;
      }

      if (job.progress) onProgress?.(job.progress);
      if (job.status === 'completed') return job.result;
      // Poll rapido per i mondi in cache, poi più rilassato durante l'LLM.
      pollMs = Math.min(1200, pollMs + 150);
      if (job.status === 'failed') {
        throw new Error(job.error || 'World generation failed');
      }
      if (Date.now() > deadline) {
        throw new Error('World generation timed out');
      }
    }
  },
};


// ============================================================================
// Game API
// ============================================================================

export const gameApi = {
  /**
* Inizia una nuova partita
   */
  create: (data: CreateGameRequest): Promise<CreateGameResponse> => {
    return fetchApi('/games', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  /**
* Ottieni lo stato della partita
   */
  get: (gameId: string): Promise<Game> => {
    return fetchApi(`/games/${gameId}`);
  },
  
  /**
   * Invia l'azione del giocatore
   */
  submitAction: (data: SubmitActionRequest): Promise<SubmitActionResponse> => {
    return fetchApi(`/games/${data.game_id}/action`, {
      method: 'POST',
      body: JSON.stringify({
        game_id: data.game_id,
        player_id: data.player_id,
        text: data.text,
      }),
    });
  },
  
  /**
* Ottieni consigli dal consulente
   */
  getAdvisor: (gameId: string, playerId: string): Promise<AdvisorResponse> => {
    return fetchApi(`/games/${gameId}/advisor?player_id=${playerId}`);
  },

  /**
* Ottieni i suggerimenti (actions.md)
   */
  getSuggestions: (gameId: string): Promise<{ suggestions: any[] }> => {
    return fetchApi(`/games/${gameId}/suggestions`);
  },

  /**
   * Salva partita
   */
  saveGame: (gameId: string, name?: string): Promise<any> => {
    return fetchApi(`/games/${gameId}/save`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  /**
* Carica una partita salvata
   */
  loadSave: (saveId: string): Promise<any> => {
    return fetchApi(`/saves/${saveId}/load`, {
      method: 'POST',
    });
  },

  /**
 * Toggle della simulazione live (battito del mondo)
   */
  setLiveSim: (gameId: string, enabled: boolean): Promise<{ enabled: boolean }> => {
    return fetchApi(`/games/${gameId}/live-sim`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  nationalState: (gameId: string): Promise<{
    accounts: Record<string, any>;
    /** Storico dei conti del paese giocatore, dal più vecchio al più recente. */
    history?: Array<{ date: string; turn?: number; account: Record<string, any> }>;
    /** Anime del governo e dettaglio del bilancio, calcolati dal motore. */
    government?: GovernmentSnapshot | null;
    /** Politica fiscale corrente del giocatore (aliquota, limiti, effetti). */
    fiscalPolicy?: FiscalPolicyInfo | null;
    /** Crisi nazionale: rischi di collasso ed eventuale epilogo. */
    crisis?: CrisisSnapshot | null;
    /** GAMEPLAY-LONG: obiettivi persistenti delle potenze del teatro. */
    strategicAgenda?: { powers: PowerAgenda[] } | null;
    /** Registro strutturato degli impegni: ciò che la partita ha firmato. */
    commitments?: { commitments: Commitment[]; attention: Commitment[] } | null;
    /** Magazzino materiale del giocatore (legacy): stock, conto e risorse naturali. */
    resources?: {
      stock?: { money?: number; debt?: number; food?: number; clothing?: number; weapons?: number; fuel?: number; research?: number; technologies?: string[] };
      account?: Record<string, any>;
      natural?: NaturalResourceSummary[];
      market?: ResourceQuote[];
      debt?: number;
      creditLimit?: number;
      creditHeadroom?: number;
      modifiers?: { stability?: number; socialTension?: number; warEffort?: number; revenueMultiplier?: number; growthModifier?: number };
    };
  }> =>
    fetchApi(`/games/${gameId}/national-state`),

  /** Anime del governo: voci generate dall'LLM (on-demand, per il turno corrente). */
  governmentVoices: (gameId: string): Promise<GovernmentVoicesResponse> =>
    fetchApi(`/games/${gameId}/government/voices`),

  /** Magazzino materiale e risorse naturali dinamiche del giocatore. */
  resources: (gameId: string): Promise<{
    stock: { money?: number; debt?: number; food?: number; clothing?: number; weapons?: number; fuel?: number; research?: number; technologies?: string[] };
    account?: Record<string, any>;
    natural: NaturalResourceSummary[];
    market: ResourceQuote[];
    debt: number;
    /** Portafoglio del debito: titoli con tasso e scadenza. */
    debts?: SovereignDebtTranche[];
    /** Scoperto di cassa puro, distinto dai titoli emessi. */
    overdraft?: number;
    /** Interessi passivi annui sull'intero debito (mld). */
    annualInterest?: number;
    /** Scadenza media ponderata residua dei titoli (anni). */
    averageMaturityYears?: number;
    debtRatioPct?: number;
    creditLimit: number;
    creditHeadroom: number;
    /** Capacità di stoccaggio e fabbisogno mensile del magazzino materiale. */
    capacity?: { food?: number; clothing?: number; weapons?: number; fuel?: number };
    needs?: { food?: number; clothing?: number; weapons?: number; fuel?: number };
    /** Tasso di mercato oggi per una nuova emissione. */
    marketRatePct?: number;
    modifiers?: { stability?: number; socialTension?: number; warEffort?: number; revenueMultiplier?: number; growthModifier?: number };
  }> =>
    fetchApi(`/games/${gameId}/resources`),

  /**
   * La nazione fa debito: emette titoli per incassare cassa oggi, con interessi
   * e scadenza. Il motore fissa tasso di mercato e tetto di credito.
   */
  borrowDebt: (gameId: string, amountMld: number, termYears: number): Promise<{
    ok: boolean;
    tranche: SovereignDebtTranche;
    debt: number;
    annualInterest: number;
    debtRatioPct: number;
    creditHeadroom: number;
  }> =>
    fetchApi(`/games/${gameId}/finance/borrow`, {
      method: 'POST',
      body: JSON.stringify({ amountMld, termYears }),
    }),

  /** Ordini di produzione militare con percentuale di completamento. */
  production: (gameId: string): Promise<{ orders: ProductionOrder[]; inProgress: number }> =>
    fetchApi(`/games/${gameId}/production`),

  /** Politica fiscale: aliquota scelta dal giocatore e suoi effetti. */
  fiscalPolicy: (gameId: string): Promise<{ policy: FiscalPolicyInfo }> =>
    fetchApi(`/games/${gameId}/fiscal-policy`),

  /**
   * Cambia la pressione fiscale. Il motore ricalcola entrate, saldo, stabilità,
   * tensione e crescita; una manovra brusca lascia un costo politico transitorio.
   */
  setFiscalPolicy: (gameId: string, taxRatePct: number): Promise<{
    policy: FiscalPolicyInfo;
    note: string;
    account?: Record<string, any>;
  }> =>
    fetchApi(`/games/${gameId}/fiscal-policy`, {
      method: 'PUT',
      body: JSON.stringify({ taxRatePct }),
    }),

  /** Sfide di pace attive e ultime chiuse: le pressioni del turno. */
  peacetimePressures: (gameId: string): Promise<{
    pressures: PeacetimePressure[];
    recent: PeacetimePressure[];
    foodCoverageMonths: number | null;
  }> =>
    fetchApi(`/games/${gameId}/pressures`),

  /** Crisi nazionale: rischi di rivolta, default, invasione ed epilogo. */
  crisis: (gameId: string): Promise<CrisisSnapshot> =>
    fetchApi(`/games/${gameId}/crisis`),

  /** Risponde a una sfida: il motore applica modificatori, cassa e relazioni. */
  resolvePeacetimePressure: (gameId: string, pressureId: string, optionId: string): Promise<{
    pressure: PeacetimePressure;
    effect: { note?: string; moneyDeltaMld?: number };
    account?: Record<string, any>;
  }> =>
    fetchApi(`/games/${gameId}/pressures/${encodeURIComponent(pressureId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  /** Vende (`sell`) o compra (`buy`) una risorsa naturale sul mercato mondiale. */
  tradeResource: (gameId: string, mode: 'sell' | 'buy', resourceId: string, quantity: number): Promise<{
    ok: boolean; mode: string; kind: string; quantity: number; unitPrice: number; total: number; quote: ResourceQuote;
  }> =>
    fetchApi(`/games/${gameId}/resources/trade`, {
      method: 'POST',
      body: JSON.stringify({ mode, resourceId, quantity }),
    }),

  /** Arsenale militare, risorse naturali reali e catalogo con fattibilità. */
  arsenal: (gameId: string): Promise<ArsenalResponse> =>
    fetchApi(`/games/${gameId}/arsenal`),

  /** OP-OBJECTS — anteprima della creazione di reparti: PRIMA → DOPO, sola lettura. */
  formationPreview: (gameId: string, options: { formations?: number; armyId?: string | null; name?: string } = {}): Promise<FormationImpactPayload> => {
    const params = new URLSearchParams();
    if (options.formations) params.set('formations', String(options.formations));
    if (options.armyId) params.set('armyId', options.armyId);
    if (options.name) params.set('name', options.name);
    const query = params.toString();
    return fetchApi(`/games/${gameId}/military/formation${query ? `?${query}` : ''}`);
  },

  /**
   * OP-OBJECTS — crea davvero i reparti: il motore paga il materiale, lo toglie
   * dal deposito e aggiunge l'armata al mondo. La risposta porta il PRIMA → DOPO.
   */
  raiseFormation: (gameId: string, options: { formations?: number; armyId?: string | null; name?: string } = {}): Promise<RaiseFormationResult> =>
    fetchApi(`/games/${gameId}/military/formation`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  /** Costruisce (`build`) o importa (`buy`) equipaggiamento militare. */
  procure: (gameId: string, mode: 'build' | 'buy', equipmentId: string, quantity = 1): Promise<{
    mode: string; equipmentId: string; name: string; quantity: number; spentMln: number;
    financedMln: number; debtMld: number; complete: boolean; order?: ProductionOrder;
    units: Record<string, number>; strength: number;
  }> =>
    fetchApi(`/games/${gameId}/arsenal/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ equipmentId, quantity }),
    }),

  /** M07/G5-C — eccezioni di mandato già aperte dal tick canonico (sola lettura). */  mandateDecisions: (gameId: string): Promise<{ decisions: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>; decisionRequired: boolean; maintenance: Array<{ facilityId: string; typeId: string; typeName: string; regionId: string; operational: boolean; resourceId: string; baseUnits: string; periodDays: number; available: string; sufficient: boolean; shortfall: string }>; maintenanceRequired: boolean }> =>
    fetchApi(`/games/${gameId}/mandates/decisions`),

  acknowledgeMandateDecision: (gameId: string, mandateId: string, kind: string): Promise<{ decision: any }> =>
    fetchApi(`/games/${gameId}/mandates/${encodeURIComponent(mandateId)}/decisions/${encodeURIComponent(kind)}/acknowledge`, { method: 'POST' }),

  // =========================================================================
  // Pending Actions Queue (Phase 2)
  // =========================================================================

  /**
   * Add action to queue (without processing)
   */
  queueAction: (gameId: string, text: string): Promise<{
    id: string;
    text: string;
    status: string;
    createdAt: string;
  }> => {
    return fetchApi(`/games/${gameId}/actions/queue`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  /**
   * Get pending actions
   */
  getPendingActions: (gameId: string): Promise<{ pendingActions: any[] }> => {
    return fetchApi(`/games/${gameId}/actions/queue`);
  },

  /** Remove an action that has not started processing yet. */
  removePendingAction: (gameId: string, actionId: string): Promise<{ removed: boolean }> => {
    return fetchApi(`/games/${gameId}/actions/queue/${encodeURIComponent(actionId)}`, {
      method: 'DELETE',
    });
  },

  /** Modify the text of a queued order before it is taken in charge (G04). */
  updatePendingAction: (gameId: string, actionId: string, text: string): Promise<{ action: any }> => {
    return fetchApi(`/games/${gameId}/actions/queue/${encodeURIComponent(actionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    });
  },

  /** G24 — anteprima riformulata di un ordine libero (non accoda, non simula). */
  enhanceAction: (gameId: string, text: string): Promise<{ original: string; enhanced: string }> => {
    return fetchApi(`/games/${gameId}/actions/enhance`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  /** G4-B — verifica fattibilità ordine da testo libero. */
  /** G4-B/G4-D — verifica fattibilità ordine da testo libero, con stima
   *  costi da catalogo (consumi materiali e durata autorevoli). */
  checkFeasibility: (gameId: string, text: string): Promise<{
    feasible: boolean;
    costs: {
      timeDays: number;
      inputs: Array<{ resourceId: string; name: string; quantity: string; unit: string }>;
      upkeep: Array<{ line: { resourceId: string; name: string; quantity: string; unit: string }; periodDays: number }>;
      basis: 'recipe' | 'upkeep' | 'request' | 'none';
    };
    prerequisites: string[];
    risks: string[];
    warnings: string[];
    summary: string;
    rawAssessment?: unknown;
  }> => {
    return fetchApi(`/games/${gameId}/actions/check-feasibility`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  ongoingProcesses: (gameId: string): Promise<{
    processes: Array<{
      id: string;
      source_action_id: string;
      source_run_id: string;
      title: string;
      summary: string;
      status: 'ongoing';
      started_date: string;
      expected_date?: string | null;
      /** Percentuale di completamento calcolata dal motore (0-100). */
      progress?: number | null;
      /** Nota del motore sull'avanzamento (ritardi, vincoli, difetti). */
      progress_note?: string | null;
      updated_at: string;
    }>;
    /** Progetti chiusi di recente: restano consultabili nel Dossier. */
    completed?: Array<{
      id: string;
      title: string;
      summary: string;
      status: 'completed';
      started_date: string;
      expected_date?: string | null;
      progress?: number | null;
      completed_date?: string | null;
    }>;
  }> => {
    return fetchApi(`/games/${gameId}/ongoing-processes`);
  },

  /**
   * Process one action from queue
   */
  processNextAction: (gameId: string, jumpDays?: number): Promise<{
    id: string;
    text: string;
    status: string;
    result?: {
      narration: string;
      countryResponse: string;
      events: string[];
      eventDetails?: Array<{ id: string; date: string; headline: string; detail: string; source: 'world' | 'diplomacy' }>;
      outcome?: { status: 'accepted' | 'partial' | 'rejected'; summary: string };
      /** DECISION-IMPACT: addebito che il motore ha applicato a questo ordine. */
      settlement?: {
        kind: 'charged' | 'partial' | 'unfunded';
        requestedMld: number;
        chargedMld: number;
        label: string;
      };
      objects: any[];
      turn: number;
      periodStart: string;
      periodEnd: string;
    };
  }> => {
    return fetchApi(`/games/${gameId}/actions/process`, {
      method: 'POST',
      // `0` is the legacy auto-jump value; do not silently turn it into 30.
      body: JSON.stringify({ jump_days: jumpDays ?? 30 }),
    });
  },

  /**
   * Process all pending actions
   */
  processAllActions: (gameId: string, jumpDays?: number): Promise<{
    simulationId?: string;
    processedCount: number;
    actions: any[];
  }> => {
    return fetchApi(`/games/${gameId}/actions/process-all`, {
      method: 'POST',
      body: JSON.stringify({ jump_days: jumpDays ?? 30 }),
    });
  },

  /**
   * Time-skip: process pending actions OR just advance date
   */
  timeSkip: async (gameId: string, jumpDays?: number, idempotencyKey?: string): Promise<{
    type: 'actions_processed' | 'date_advanced' | 'world_advanced' | 'no_event_found' | 'simulation_replayed' | 'awaiting_next';
    paused?: boolean;
    event?: { id: string; date: string; headline: string; detail: string; source: string; sourceActionIds?: string[] };
    remaining?: number;
    destination?: string;
    /** G22: ancora del checkpoint mostrato dal lettore. */
    checkpointId?: string;
    revision?: number;
    changedRegions?: any[];
    status?: 'completed' | 'no_event' | 'failed';
    simulationId?: string;
    processedCount?: number;
    actions?: any[];
    result?: {
      simulationId?: string;
      turn: number;
      narration: string;
      events: string[];
      eventDetails?: Array<{ id: string; date: string; headline: string; detail: string; source: 'world' | 'diplomacy' }>;
      periodStart: string;
      periodEnd: string;
    };
    newDate?: string;
    newTurn?: number;
    jumpDays?: number;
    startDate?: string;
    searchedUntil?: string;
  }> => {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
    const body = jumpDays === 0
      ? { mode: 'next_event' }
      : { mode: 'fixed', jump_days: jumpDays ?? 30 };

    // Il provider può impiegare minuti: la POST accetta il lavoro subito e il
    // browser interroga richieste brevi, evitando i timeout del proxy.
    const accepted = await fetchApi<{ jobId: string; status: string }>(`/games/${gameId}/simulation-jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!accepted.jobId) throw new ApiError(500, 'Il server non ha restituito l’identificativo della simulazione');

    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      try {
        const job = await fetchApi<{ status: string; error?: string }>(`/games/${gameId}/simulation-jobs/${accepted.jobId}`);
        if (job.status === 'completed' || job.status === 'failed') {
          // Su failed questa chiamata restituisce il 424/500 con il dettaglio;
          // su completed ricostruisce lo stesso contratto del vecchio time-skip.
          return await fetchApi(`/games/${gameId}/simulation-jobs/${accepted.jobId}/result`);
        }
      } catch (error) {
        const transient = error instanceof ApiError && [502, 503, 504].includes(error.status);
        if (!transient || Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) {
        throw new ApiError(408, 'La simulazione è ancora in corso. Riapri la partita per sincronizzare i dispacci.');
      }
      await new Promise(resolve => window.setTimeout(resolve, 1500));
    }
  },

  /**
* Fase 2: ritorno al turno precedente
   */
  rewind: (gameId: string): Promise<{ type: string; newTurn: number; newDate: string }> => {
    return fetchApi(`/games/${gameId}/rewind`, { method: 'POST' });
  },

  /**
* Fase 2: Intervene — interrompere l'applicazione degli eventi rimanenti del blocco
   */
  intervene: (gameId: string, simulationId?: string, anchor?: { eventId: string; revision: number }): Promise<{
    ok: boolean;
    simulationId?: string;
    /** §9.3: esito della chiusura affidabile di un run in pausa. */
    intervened?: boolean;
    type?: 'intervened';
    newDate?: string;
    newTurn?: number;
    actions?: any[];
    result?: { turn: number; narration: string; events: string[]; eventDetails: any[]; periodStart: string; periodEnd: string };
  }> => {
    return fetchApi(`/games/${gameId}/intervene`, {
      method: 'POST',
      body: JSON.stringify(simulationId ? { simulationId, ...anchor } : {}),
    });
  },

  /** §9.3 — «Continua»: autorizza il checkpoint per-evento successivo del
   * salto fisso sospeso; l'ultimo Continua porta il mondo a destinazione. */
  continueSimulation: (gameId: string, runId: string): Promise<{
    paused?: boolean;
    type: 'awaiting_next' | 'run_completed' | 'paused_budget' | 'intervened';
    simulationId: string;
    event?: { id: string; date: string; headline: string; detail: string; source: string; sourceActionIds?: string[] };
    remaining?: number;
    destination?: string;
    checkpointId?: string;
    revision?: number;
    changedRegions?: any[];
    actions?: any[];
    result?: { turn: number; narration: string; events: string[]; eventDetails: any[]; periodStart: string; periodEnd: string };
    newDate: string;
    newTurn: number;
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${runId}/next`, {
      method: 'POST',
    });
  },

  /** §9.3: stato del run sospeso, per ricostruire il lettore dopo refresh. */
  getSimulationRun: (gameId: string, runId: string): Promise<{
    run: { id: string; status: string; checkpoint_date?: string; target_date?: string };
    awaitingNext?: { simulationId: string; remaining: number; destination: string; date: string; turn: number; eventId?: string; checkpointId?: string; revision?: number } | null;
    events: Array<{ id: string; checkpointId: string; date: string; headline: string; detail: string; source: string }>;
    actionOutcomes: any[];
    ongoingProcesses: any[];
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${runId}`);
  },

  restoreSimulationCheckpoint: (gameId: string, simulationId: string): Promise<{
    type: 'checkpoint_restored';
    simulationId: string;
    checkpointId: string;
    revision: number;
    newTurn: number;
    newDate: string;
    /** F06 µ2: ramo nuovo + anchor per il reset del client. */
    branchId?: string | null;
    anchor?: { checkpointId: string; revision: number };
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${encodeURIComponent(simulationId)}/restore`, {
      method: 'POST',
    });
  },

  /**
   * Get diplomatic relationships for a game
   */
  getRelationships: (gameId: string): Promise<Record<string, Record<string, string>>> => {
    return fetchApi(`/games/${gameId}/relationships`);
  },

  /**
   * Timeline del mondo: cronaca turno per turno (eventi + data di gioco)
   */
  timeline: (gameId: string, opts?: { after?: number; limit?: number }): Promise<{
    timeline: TimelineEntry[];
    currentDate: string;
    hasMore?: boolean;
    nextAfter?: number;
  }> => {
    const qs = new URLSearchParams();
    if (opts?.after != null) qs.set('after', String(opts.after));
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return fetchApi(`/games/${gameId}/timeline${suffix}`);
  },
};

// ============================================================================
// Chats API (Fase 3: chat diplomatiche)
// ============================================================================

/** Riepilogo della chat con la politia (riga dell'elenco chat) */
export interface ChatSummaryData {
  id: string;
  polityId: string;
  polityName: string;
  polityColor: string;
  /** Partecipanti della chat (chat di gruppo: più nazioni) */
  participants?: { id: string; name: string; color: string; role?: 'player' | 'polity' }[];
  createdAt?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  /** Data del mondo dell'ultimo messaggio (es. «2026-03-04») — per datare l'elenco. */
  lastMessageGameDate?: string;
  /** Titolo breve della discussione (tema dell'evento che l'ha aperta). */
  subject?: string | null;
  /** Una discussione archiviata esce dall'elenco attivo ma resta consultabile. */
  archived?: boolean;
  archivedAt?: string | null;
  unread: number;
}

/** Messaggio in una chat diplomatica */
export interface ChatMessageData {
  id: string;
  role: 'player' | 'polity' | 'system';
  content: string;
  turn?: number;
  /** Chi ha parlato: nome del giocatore o della nazione */
  senderName?: string;
  /** Data del mondo in cui il messaggio è stato inviato. */
  gameDate?: string;
  createdAt?: string;
  /**
   * Sequenza di inserimento del server (rowid): tie-breaker stabile per
   * ordinare i messaggi che condividono la stessa data del mondo e lo stesso
   * turno. `null`/assente sui payload più vecchi.
   */
  seq?: number | null;
}

export interface TimelineEvent {
  id: string;
  date: string;
  headline: string;
  detail: string;
  source: 'world' | 'diplomacy';
  simulationId?: string;
  sourceActionIds?: string[];
  chatId?: string;
  speakerName?: string;
}

/** Voce della Timeline del mondo (cronaca turno per turno). */
export interface TimelineEntry {
  turn: number;
  date: string;
  events: TimelineEvent[];
  narration: string;
}

export const chatsApi = {
  /**
   * Elenco delle chat diplomatiche della partita.
   * `includeArchived` aggiunge le discussioni chiuse (mostrate a parte nella UI).
   */
  list: (gameId: string, includeArchived = false): Promise<{ chats: ChatSummaryData[] }> => {
    const query = includeArchived ? '?includeArchived=1' : '';
    return fetchApi(`/games/${gameId}/chats${query}`);
  },

  /**
   * Apre una NUOVA discussione con una o più politie. Le precedenti con gli
   * stessi interlocutori vengono archiviate dal backend. `dedupeKey` rende
   * idempotente la riapertura della stessa riunione.
   */
  create: (
    gameId: string,
    polityNames: string[],
    options: { subject?: string; dedupeKey?: string } = {},
  ): Promise<{ chat: ChatSummaryData }> => {
    return fetchApi(`/games/${gameId}/chats`, {
      method: 'POST',
      body: JSON.stringify({ polityNames, ...options }),
    });
  },

  /** Archivia una discussione: esce dall'elenco attivo, resta consultabile. */
  archive: (gameId: string, chatId: string): Promise<{ chat: ChatSummaryData | null }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/archive`, { method: 'POST' });
  },

  /** Riapre una discussione archiviata. */
  unarchive: (gameId: string, chatId: string): Promise<{ chat: ChatSummaryData | null }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/unarchive`, { method: 'POST' });
  },

  /**
   * «Lascia che parlino»: le nazioni della chat proseguono la trattativa
   * tra loro per N repliche senza intervento del giocatore.
   */
  auto: (gameId: string, chatId: string, exchanges: number = 2): Promise<{ replies: ChatMessageData[] }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/auto`, {
      method: 'POST',
      body: JSON.stringify({ exchanges }),
    });
  },

  /**
* Messaggi della chat (sul backend segna la chat come letta)
   */
  messages: (gameId: string, chatId: string): Promise<{ messages: ChatMessageData[] }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/messages`);
  },

  /** Segna i messaggi ricevuti come letti, anche dopo un evento SSE. */
  markRead: (gameId: string, chatId: string): Promise<{ ok: boolean }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/read`, { method: 'POST' });
  },

  /**
   * Invia un messaggio alla politia; reply = risposta della politia dall'LLM
   */
  send: (gameId: string, chatId: string, content: string): Promise<{
    message: ChatMessageData;
    reply: ChatMessageData;
  }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },
};

// ============================================================================
// Advisor API (Fase 3: Consulente live)
// ============================================================================

/** Messaggio della cronaca del dialogo con il consulente */
export interface AdvisorHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export const advisorApi = {
  /**
* Chiedi al consulente (dialogo multi-turno — history inviata a ogni richiesta)
   */
  ask: (gameId: string, message: string, history: AdvisorHistoryItem[]): Promise<{ reply: string }> => {
    return fetchApi(`/games/${gameId}/advisor`, {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    });
  },

  /**
* Streaming della risposta del consulente (text/plain chunked).
* onToken viene chiamato per ogni frammento di testo; restituisce la risposta completa.
* In caso di errore di rete dello stream — fallback sul normale POST /advisor.
   */
  askStream: async (
    gameId: string,
    message: string,
    history: AdvisorHistoryItem[],
    onToken: (token: string) => void
  ): Promise<string> => {
    const url = `${API_BASE}/games/${gameId}/advisor/stream`;
    const body = JSON.stringify({ message, history });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { ...ownerHeaders(), 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      // La rete non ha permesso di aprire lo stream — torniamo alla richiesta normale
      console.warn('[Advisor] Stream non disponibile, fallback su POST /advisor:', e);
      const data = await advisorApi.ask(gameId, message, history);
      onToken(data.reply);
      return data.reply;
    }

    if (!response.ok || !response.body) {
      console.warn('[Advisor] Stream ha restituito', response.status, '— fallback su POST /advisor');
      const data = await advisorApi.ask(gameId, message, history);
      onToken(data.reply);
      return data.reply;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          full += chunk;
          onToken(chunk);
        }
      }
    } catch (e) {
      // Interruzione a metà stream: se non abbiamo ricevuto nulla — fallback, altrimenti restituiamo ciò che abbiamo
      if (!full) {
        console.warn('[Advisor] Stream interrotto, fallback su POST /advisor:', e);
        const data = await advisorApi.ask(gameId, message, history);
        onToken(data.reply);
        return data.reply;
      }
      console.warn('[Advisor] Stream interrotto a metà, uso la risposta parziale:', e);
    }
    return full;
  },
};

// ============================================================================
// Saves API
// ============================================================================

export const savesApi = {
  /**
* Ottieni l'elenco dei salvataggi
   */
  list: (): Promise<{ saves: any[] }> => {
    return fetchApi('/saves');
  },
};


// ============================================================================
// Health Check
// ============================================================================

export const healthApi = {
  check: (): Promise<{ status: string; timestamp: string }> => {
    return fetchApi('/health');
  },
};


// ============================================================================
// Countries API
// ============================================================================

export const countriesApi = {
  /**
   * Ottieni tutti i paesi
   */
  getAll: (): Promise<{ countries: Country[] }> => {
    return fetchApi('/countries');
  },

  /**
   * Ottieni il paese per codice
   */
  getByCode: (code: string): Promise<Country> => {
    return fetchApi(`/countries/${code}`);
  },
};


// ============================================================================
// Templates API
// ============================================================================

/** Info sul template nell'elenco (Fase 5: preset come pacchetti) */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  start_date: string;
  country_count: number;
/** preset = pacchetto da data/presets, legacy = vecchio template da data/templates */
  source: 'preset' | 'legacy';
/** Regole di simulazione personalizzate presenti */
  has_rules: boolean;
/** Mappa propria presente (map.geojson) */
  has_map: boolean;
/** Numero di bandiere nel pacchetto */
  flags_count: number;
}

/** M01 µ4: issue del validatore di catalogo con percorso JSON preciso. */
export interface ScenarioIssueView {
  path: string;
  code: string;
  message: string;
  severity: 'blocking' | 'warning';
}

/** Anteprima di copertura delle filiere (§4.4). */
export interface ScenarioCoverageView {
  justified: string[];
  missing: string[];
  unknownDeposits: number;
}

export interface ScenarioReportView {
  presetId: string;
  ok: boolean;
  errors: ScenarioIssueView[];
  warnings: ScenarioIssueView[];
  catalogHashes: Record<string, string>;
  coverage: ScenarioCoverageView;
}

export interface PresetEditorData {
  id: string;
  name: string;
  description: string;
  start_date: string;
  country_codes: string[];
  base_prompt: string;
  historical_accuracy?: number;
  /** Paesi del preset con nome/colore (override del registro se presente). */
  countries?: Array<{ code: string; name: string; color?: string }>;
  lore?: string;
  simulation_rules?: string;
  /** Override avanzati dei prompt IA; il contratto di simulazione resta invariabile. */
  prompts?: Record<string, string>;
  author?: string;
  version?: string;
  /** Livello di dettaglio della mappa: nations | grouped | full (opzionale). */
  map_detail?: PresetMapDetail;
  /** Proprietà GeoJSON usata per raggruppare le province in `grouped`. */
  map_grouping?: string;
  /** Mappa nativa di riferimento (usata se non c'è un map.geojson proprio). */
  map_base?: PresetMapBase;
  map_geojson?: any;
}

export type PresetMapDetail = 'nations' | 'grouped' | 'full';

/** Mappe native scegliibili nell'editor (whitelist applicata dal backend). */
export type PresetMapBase =
  | 'standard'
  | 'modern_world_provinces'
  | 'pax_modern_provinces'
  | 'paxh_ww2_provinces';

export interface NativeMapInfo {
  id: PresetMapBase;
  label: string;
  hasProvinces: boolean;
  features: number;
  /** Codici ISO-A3 dei paesi coperti dalla mappa. */
  codes: string[];
}

export const templatesApi = {
  /**
* Ottieni tutti i template
   */
  list: (): Promise<{ templates: TemplateInfo[] }> => {
    return fetchApi('/templates');
  },

  /**
* Ottieni il template per ID
   */
  get: (templateId: string): Promise<WorldTemplate> => {
    return fetchApi(`/templates/${templateId}`);
  },

  getEditable: (templateId: string): Promise<PresetEditorData> => {
    return fetchApi(`/templates/${templateId}/edit`);
  },

  /**
   * MAP-NATIVE: elenco delle mappe native scegliibili (id, nome, province).
   * Read-only, whitelist rigida lato backend.
   */
  getNativeMaps: (): Promise<{ maps: NativeMapInfo[] }> => {
    return fetchApi('/templates/maps/native');
  },

  /**
   * M01 µ4: rapporto del catalogo simulation/ per l'editor del preset
   * (checklist, errori per campo con percorsi JSON, copertura delle filiere).
   */
  getScenarioReport: (templateId: string): Promise<{
    presetId: string;
    hasCatalog: boolean;
    report: ScenarioReportView | null;
  }> => {
    return fetchApi(`/templates/${templateId}/scenario`);
  },

  assistPreset: (brief: string, draft: PresetEditorData): Promise<{ preset: Partial<PresetEditorData> }> => {
    return fetchApi('/templates/assist', {
      method: 'POST',
      body: JSON.stringify({ brief, draft }),
    });
  },

  createPreset: (preset: PresetEditorData): Promise<{ template: PresetEditorData }> => {
    return fetchApi('/templates', { method: 'POST', body: JSON.stringify(preset) });
  },

  updatePreset: (templateId: string, preset: PresetEditorData): Promise<{ template: PresetEditorData }> => {
    return fetchApi(`/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(preset) });
  },

  /**
* Esporta il preset come archivio zip: otteniamo il blob e avviamo il download
   */
  exportPreset: async (templateId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/templates/${templateId}/export`, {
      headers: ownerHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('[API Error]', response.status, `/templates/${templateId}/export`, text);
      throw new Error(text || `Errore esportazione (${response.status})`);
    }
    const blob = await response.blob();
    // Nome file — da Content-Disposition, altrimenti <id>.zip
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `${templateId}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Importa uno scenario da archivio zip (body = byte del file).
* Su 409 (già esistente) lancia un errore con code === 'EXISTS' —
* il chiamante mostra un confirm e ripete con overwrite = true.
   */
  importPreset: async (file: File, overwrite = false): Promise<{ template: TemplateInfo }> => {
    const response = await fetch(
      `${API_BASE}/templates/import${overwrite ? '?overwrite=1' : ''}`,
      {
        method: 'POST',
        headers: { ...ownerHeaders(), 'Content-Type': 'application/zip' },
        body: file,
      }
    );
    if (response.status === 409) {
      const error = new Error('Esiste già uno scenario con questo ID') as Error & { code?: string };
      error.code = 'EXISTS';
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      console.error('[API Error]', response.status, '/templates/import', text);
      throw new Error(text || `Errore importazione (${response.status})`);
    }
    return response.json();
  },
};


// ============================================================================
// Geo API (Fase 4: geometria reale Natural Earth)
// ============================================================================

/** Proprietà del paese nel GeoJSON da /api/geo/countries */
export interface GeoCountryProperties {
  code: string;
  name: string;
  nameEn?: string;
}

/** GeoJSON Feature di un paese (Polygon o MultiPolygon) */
export interface GeoCountryFeature {
  type: 'Feature';
  properties: GeoCountryProperties;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

/** GeoJSON FeatureCollection con i paesi del mondo */
export interface GeoCountriesCollection {
  type: 'FeatureCollection';
  features: GeoCountryFeature[];
}

/** Capitale del paese da /api/geo/capitals */
export interface GeoCapital {
  capital: string;
  lat: number;
  lng: number;
}

export const geoApi = {
  /**
   * Confini reali dei paesi (Natural Earth) — GeoJSON FeatureCollection.
* Il backend può restituire la collezione direttamente o avvolta in { countries }.
   * Memoizzata: mappa di selezione e altri componenti condividono la stessa
   * promessa invece di riscaricare il GeoJSON a ogni montaggio.
   */
  getCountries: (() => {
    let pending: Promise<GeoCountriesCollection> | null = null;
    return (): Promise<GeoCountriesCollection> => {
      if (pending) return pending;
      pending = fetchApi<GeoCountriesCollection | { countries: GeoCountriesCollection }>('/geo/countries')
        .then((data) => {
          // Normalizza: accetta sia la FeatureCollection nuda sia l'involucro
          if ((data as GeoCountriesCollection).type === 'FeatureCollection') {
            return data as GeoCountriesCollection;
          }
          return (data as { countries: GeoCountriesCollection }).countries;
        })
        .catch(e => { pending = null; throw e; }); // fallita → riprova al prossimo mount
      return pending;
    };
  })(),

  /**
   * Capitali dei paesi: { code: { capital, lat, lng } }
   */
  getCapitals: (): Promise<Record<string, GeoCapital>> => {
    return fetchApi('/geo/capitals');
  },
};

// ============================================================================
// Map API
// ============================================================================

export interface MapRegionData {
  id: string;
  name: string;
  color: string;
  path: string;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  regions: MapRegionData[];
}

export interface MapListItem {
  id: string;
  name: string;
  regions_count: number;
  created_at: string;
}

export const mapApi = {
  /**
* Crea una nuova mappa
   */
  create: (data: {
    name: string;
    width: number;
    height: number;
    regions: MapRegionData[];
  }): Promise<{ id: string; name: string }> => {
    return fetchApi('/maps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Elenco di tutte le mappe
   */
  list: (): Promise<MapListItem[]> => {
    return fetchApi('/maps');
  },

  /**
* Ottieni la mappa per ID
   */
  get: (mapId: string): Promise<MapData> => {
    return fetchApi(`/maps/${mapId}`);
  },

  /**
* Elimina la mappa
   */
  delete: (mapId: string): Promise<{ status: string; id: string }> => {
    return fetchApi(`/maps/${mapId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// LLM API (scelta del modello IA a runtime)
// ============================================================================

/** Preset di un provider supportato (Ollama, OpenRouter, NVIDIA…) */
export interface LLMProviderPreset {
  id: string;
  label: string;
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  needsKey: boolean;
  docsUrl?: string;
  description?: string;
  defaultModel?: string;
}

export interface LLMStatusMechanicInfo {
  provider: string;
  model: string;
  baseUrl: string;
}

export interface LLMConfigView {
  configPath: string;
  configFileExists: boolean;
  default: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKeySet: boolean;
    apiKeySource: 'file' | 'env' | 'browser' | null;
  };
  mechanics: Record<string, {
    provider: string;
    baseUrl: string;
    model: string;
    overridden: boolean;
    hasKeyOverride: boolean;
  }>;
}

export interface LLMModelItem {
  id: string;
  name?: string;
}

export interface LLMTestResult {
  ok: boolean;
  reply: string;
  latencyMs: number;
}

export interface LLMSavePayload {
  default: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  mechanics?: Record<string, { model?: string; apiKey?: string; baseUrl?: string; provider?: string }>;
  /** true → la chiave può essere scritta su disco; omesso/false → resta solo in memoria server (default opt-in). */
  persistApiKey?: boolean;
}

export const llmApi = {
  status: (): Promise<{ mechanics: Record<string, LLMStatusMechanicInfo> }> => {
    return fetchApi('/llm/status');
  },

  providers: (): Promise<{ providers: LLMProviderPreset[] }> => {
    return fetchApi('/llm/providers');
  },

  config: (): Promise<LLMConfigView> => {
    return fetchApi('/llm/config');
  },

  save: (payload: LLMSavePayload): Promise<{ ok: boolean } & LLMConfigView & { status: { mechanics: Record<string, LLMStatusMechanicInfo> } }> => {
    return fetchApi('/llm/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  models: (params: { provider: string; baseUrl?: string; apiKey?: string }): Promise<{ models: LLMModelItem[]; warning?: string }> => {
    return fetchApi('/llm/models', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  test: (params: { provider: string; baseUrl: string; apiKey?: string; model: string }): Promise<LLMTestResult> => {
    return fetchApi('/llm/test', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};
