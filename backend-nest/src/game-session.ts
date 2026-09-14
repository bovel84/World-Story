/**
 * World Story — Game Session
 * ========================
 * Per-game session that encapsulates all game state and logic.
 * Each game gets its own GameSession instance via SessionRegistry.
 */

import { shortId } from './utils/short-id';
import { constructionProgressPatch } from './utils/construction-progress';
import { LLMRouter } from './llm';
import { GameController } from './agents';
import { PromptEngine } from './prompt-builder';
import { worldRepository, gameRepository, relationshipRepository, chatRepository, nationalAccountRepository, resourceRepository, arsenalRepository, naturalResourceRepository, productionRepository } from './repositories';
import { captureEconomicSnapshot, invalidateStrictEffectStaging, restoreEconomicSnapshot, validateEconomicSnapshot } from './repositories/economy-snapshot.repository';
import { withCanonicalTransaction } from './database';
import { semanticStateHash } from './domain/semantic-hash';
import type { ChatRecord, ChatSummary, ChatMessageRecord, ChatParticipant, GameChatSnapshot } from './repositories';
import db from './database';
import { RelationshipMatrix } from './core/RelationshipMatrix';
import { WorldStateEngine, type NationalAccount } from './core/simulation/WorldStateEngine';
import { advanceStock, creditHeadroom, creditLimit, debtOf, describeStock, financePurchase, movementCost, normalizeStock, payMovement, seedStock, type ResourceStock } from './core/simulation/MaterialEconomy';
import {
  advanceOrder, projectProgress, stableRoll,
  type ProductionContext, type ProductionOrder,
} from './core/simulation/MilitaryProduction';
import { arsenalCombatFactor, arsenalQualityIndex, arsenalStrength, combatAttrition, describeArsenal, describeEndowment, equipmentById, EQUIPMENT_CATALOG, NATURAL_RESOURCE_KINDS, naturalResourcesFor, procurementOption, type NationCapacity, type NaturalEndowment, type NaturalResourceKind } from './core/simulation/MilitaryIndustry';
import {
  advanceLedger, applyGlobalExtraction, describeLedger, effectiveEndowment, emptyMarket, executeTrade,
  marketQuote, seedLedger, seedMarket, summarizeLedger, tradePressureDelta,
  type ResourceLedger, type WorldMarket,
} from './core/simulation/ResourceMarket';
import { addDays, dateInPeriod, explicitDays, jumpHorizon, resolvePeriod } from './core/simulation/calendar';
import {
  validateStrictMapChanges,
  validateStrictWorldChanges,
  validateStrictResultSafe,
  rejectDirectMaterialCommand,
  type StrictEffect,
} from './core/simulation/EffectValidator';
import { applyStagedStrictEffects, assertExecutableStrictEffects, promotePlaybackEffectAnchors, runStrictTick } from './core/simulation/TurnOrchestrator';
import { bootstrapCatalogEconomy } from './services/StrictEffectProducerService';
import { refreshMandateStockDecisions } from './services/MandateDecisionService';
import { withinDeadline } from './core/simulation/deadline';
import { canNpcCapture, indexPolities, npcRepresentatives } from './core/simulation/npc-policy';
import { normalizeName, RegionResolver, PolityResolver } from './utils/name-resolver';
import { exactMovementRegion, MovementIntent, parseMovementOrder, resolveMovementRegion, UNIT_TYPES, unitMatchesType, unitNameMatchesPrefix } from './utils/movement-orders';
import { colorForPolity, normalizeHexColor } from './utils/color';
import path from 'path';
import { loadSimulationCatalog } from './scenario/loader';
import { AssessmentStatus, ReasonCode, Blocker, Requirement, FeasibilityFacts, AlternativeProposal, OrderAssessment } from "./core/feasibility/FeasibilityService";
import { normalizeOrderIntent } from "./core/feasibility/intent";
import { FeasibilityService } from "./core/feasibility/FeasibilityService";
import { estimateIntentCosts, type CostEstimate } from "./core/feasibility/costs";
import { Difficulty, difficultyPromptBlock, normalizeDifficulty } from './prompts/difficulty';
import { currentStrategicPriorities, strategicProfileForPolity } from './npc-agents';
import { countryRepository } from './repositories/country.repository';
import { polityDisplayNameIt } from './utils/country-facts';
import { publicNarrativeText } from './utils/public-narrative';
import {
  buildChatPrompt,
  buildNextSpeakerPrompt,
  parseChatResponse,
  parseNextSpeakerResponse,
} from './prompts/chat';
import type { ActionOutcome, ConvertedAction, MapChange, MapFeature, SimulationChatStart, SimulationEvent } from './prompts/types';
import type { RelationshipType } from './core/RelationshipMatrix';
import type { SSEEventType } from './sse';

export interface RegionState {
  id: string;
  name: string;
  color: string;
  owner: string;
  population: number;
  gdp: number;
  militaryPower: number;
  objects: any[];
  svgPath?: string;
  borders: string[];
  status: 'active' | 'occupied' | 'destroyed' | 'independent';
}

export interface PlayerInfo {
  id: string;
  name: string;
  regionId: string;
  color: string;
  /** Полития игрока (код страны для шаблонов, 'player' для кастомных карт) */
  polityId?: string;
}

export interface ActionRecord {
  id: string;
  playerId: string;
  turn: number;
  text: string;
  createdAt: string;
}

export interface TimelineEventRecord {
  id: string;
  date: string;
  headline: string;
  detail: string;
  source: 'world' | 'diplomacy';
  /** Run/checkpoint che ha prodotto l'evento, per lettore e ripresa. */
  simulationId?: string;
  /** Ordini del lotto che il server ha associato all'evento. */
  sourceActionIds?: string[];
  chatId?: string;
  speakerName?: string;
}

export interface TurnResultRecord {
  id: string;
  turn: number;
  narration: string;
  countryResponse: string;
  events: string[];
  /** Run persistito che ha prodotto questo checkpoint. */
  simulationId?: string;
  timelineEvents?: TimelineEventRecord[];
  /** Data di gioco raggiunta alla fine del periodo (per la Timeline) */
  date?: string;
}

export class SimulationInProgressError extends Error {
  constructor() {
    super('A simulation is already in progress for this game');
    this.name = 'SimulationInProgressError';
  }
}

/** Il salto non può partire mentre un playback attende una decisione. */
export class SimulationPausedError extends Error {
  constructor(public runId: string) {
    super('Un salto in pausa attende una decisione: Continua o Intervieni prima di avanzare di nuovo');
    this.name = 'SimulationPausedError';
  }
}

/** F04 passo 3: risposta tardiva rispetto a ramo/revisione — mai write-back
 * sul ramo nuovo con il contesto del ramo vecchio. */
export class ContextChangedError extends Error {
  constructor(public capturedBranchId: string | null, public capturedRevision: number) {
    super(`context_changed: ramo/revisione cambiati durante l'attesa (catturato ${capturedBranchId ?? 'n/d'}@${capturedRevision})`);
    this.name = 'ContextChangedError';
  }
}

/** G22: Intervene deve riferirsi al preciso evento/checkpoint in lettura,
 * non soltanto a un run generico o a un booleano senza contesto. */
export class SimulationStaleCheckpointError extends Error {
  constructor(public runId: string, public eventId?: string, public revision?: number) {
    super('Il checkpoint indicato non è più quello attivo: rileggi il lettore di sessione');
    this.name = 'SimulationStaleCheckpointError';
  }
}

/**
 * §9.3 — stato durevole del playback «un evento alla volta» per i salti
 * fissi. Le proposte future non applicate non sono canoniche: restano nel run
 * (colonna pending_state) finché il giocatore non autorizza il checkpoint
 * successivo con «Continua», oppure chiude il salto con «Intervieni qui».
 */
export interface PausedRunState {
  runId: string;
  periodStart: string;
  /** Data di destinazione richiesta dal giocatore. */
  destination: string;
  /** Turno logico del salto: cresce una sola volta, non per evento. */
  jumpTurn: number;
  /**
   * Legato per compatibilità dello stato persistito (pending_state di run
   * creati prima di F02): da F02 la revisione dei checkpoint proviene dal
   * contatore monotono games.world_revision e non viene più derivata da qui.
   */
  revisionBase: number;
  /** Eventi proposti e non ancora applicati (non canonici). */
  remainingEvents: SimulationEvent[];
  /** ID degli ordini presi in carico dal run (non vanno reinviati). */
  batchActionIds: string[];
  /** Pre-event movement intents survive playback/restart; absent legacy state never guesses. */
  movementIntents?: MovementIntent[];
  movementChanges?: MapChange[];
  /** Titolo evento → ordini che l'hanno causato. */
  headlineToActionIds: Record<string, string[]>;
  /** Lo stream è terminato senza record complete: budget esaurito (T36). */
  incomplete: boolean;
  /** Delta mappa cumulativo dei checkpoint applicati (per turn_complete). */
  changedRegions: Array<{
    id: string; owner: string; color: string; name: string;
    population: number; gdp: number; militaryPower: number; objects: any[];
  }>;
  /** Payload di chiusura della risposta LLM, applicato solo a fine salto. */
  completion: {
    narration: string;
    convertedActions: any[];
    actionOutcomes: any[];
    voided: any[];
    worldChanges: any;
    relationshipChanges: any;
    startChat: any;
    effects: StrictEffect[];
  };
  /** Indice del prossimo checkpoint per-evento (revisione = base + questo). */
  appliedCount: number;
  /** Ancora del checkpoint mostrato nel lettore G22. */
  currentEventId?: string;
  checkpointId?: string;
  revision?: number;
}

/** Esito del batch quando il salto fisso si ferma a un checkpoint. */
export interface PausedBatchResult {
  paused: true;
  type: 'awaiting_next';
  simulationId: string;
  event: {
    id: string;
    date: string;
    headline: string;
    detail: string;
    source: string;
    sourceActionIds?: string[];
  };
  remaining: number;
  destination: string;
  /** Ancora durevole del checkpoint mostrato (G22). */
  checkpointId: string;
  revision: number;
  newDate: string;
  newTurn: number;
  changedRegions: Array<Record<string, any>>;
}

/** Risposta di chiusura del playback: il run è terminato. */
export interface CompletedBatchResult {
  paused?: false;
  type: 'run_completed' | 'paused_budget' | 'intervened';
  simulationId: string;
  actions: PendingAction[];
  result: {
    turn: number;
    narration: string;
    events: string[];
    eventDetails: any[];
    periodStart: string;
    periodEnd: string;
  };
  newDate: string;
  newTurn: number;
  destination?: string;
}

export interface PendingAction {
  id: string;
  text: string;
  createdAt: string;
  /** Adapter UI legacy; le due dimensioni sotto sono autorevoli per F01. */
  status: 'pending' | 'processing' | 'completed';
  deliveryStatus?: 'queued' | 'issued' | 'cancelled';
  executionStatus?: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  result?: {
    narration: string;
    countryResponse: string;
    events: string[];
    /** Eventi canonici, con ID persistito e data propria. */
    eventDetails?: TimelineEventRecord[];
    simulationId?: string;
    outcome?: {
      status: 'accepted' | 'partial' | 'rejected';
      summary: string;
      expectedDate?: string;
      completesProjectId?: string;
    };
    objects: any[];
    turn: number;
    periodStart: string;  // Date before processing this action
    periodEnd: string;    // Date after processing this action
  };
}

export interface WorldChanges {
  regionOwners?: Record<string, string>;
  regionColors?: Record<string, string>;
  regionGDP?: Record<string, number>;
  regionMilitary?: Record<string, number>;
  regionPopulation?: Record<string, number>;
}

export interface SaveData {
  currentTurn: number;
  currentDate: string;
  players: PlayerInfo[];
  regions: [string, RegionState][]; // [regionId, state] pairs
  relationships?: Record<string, Record<string, string>>;
  /** Этап 2: история ходов — иначе rewind/лоад теряет контекст для LLM */
  actions?: ActionRecord[];
  results?: TurnResultRecord[];
  /** Этап 2: консолидированная история и граница её покрытия */
  consolidatedHistory?: string;
  consolidatedUpTo?: number;
  /** Этап 2: сложность игры */
  difficulty?: Difficulty;
  /** Ordini futuri: un salvataggio deve ripristinare anche la coda. Con
   * un playback in pausa include anche quelli presi in carico dal run. */
  pendingActions?: PendingAction[];
  /** Run «awaiting_next» a cui appartiene questo checkpoint: il playback
   * scaglionato sopravvive a save/load/restore (§9.3). */
  pausedSimulationId?: string;
  /** Chat e messaggi del ramo al checkpoint. */
  chats?: GameChatSnapshot[];
  /** Processi in corso/completati nel ramo del checkpoint. */
  ongoingProcesses?: any[];
  /** M02 µ5: ledger, riserve e finanza del ramo; legacy/ignoto resta inattivo. */
  economicState?: unknown;
}

/**
 * Conti nazionali delle province INIZIALI, memorizzati per mondo. I dati di
 * partenza di un mondo sono statici: ricostruire 4475 regioni per ognuna delle
 * decine di sessioni attive sarebbe uno spreco. La cache è per processo.
 */
const worldInitialAccountsCache = new Map<string, Record<string, NationalAccount>>();
function worldInitialAccounts(worldId: string): Record<string, NationalAccount> {
  const cached = worldInitialAccountsCache.get(worldId);
  if (cached) return cached;
  let accounts: Record<string, NationalAccount> = {};
  try {
    const regions = (worldRepository.getRegions(worldId) as any[]).map(region => ({
      id: region.id,
      owner: region.owner,
      population: region.population,
      gdp: region.gdp,
      militaryPower: region.militaryPower,
      objects: region.objects || [],
      status: region.status,
    }));
    accounts = WorldStateEngine.accounts(regions);
  } catch (error) {
    console.warn('[GameSession] Dati iniziali del mondo non disponibili:', error);
  }
  worldInitialAccountsCache.set(worldId, accounts);
  return accounts;
}

export class GameSession {
  public readonly id: string;
  public readonly worldId: string;

  // Full region state - source of truth during gameplay
  private regions: Map<string, RegionState> = new Map();

  // Session-specific agents (not shared!)
  private gameController: GameController;
  private promptEngine: PromptEngine;
  private llm: LLMRouter;

  // Game state
  private players: PlayerInfo[] = [];
  private currentTurn: number = 1;
  private currentDate: string = '1951-01-01';
  private maxTurns: number = 100;
  /**
   * F03/A10: risultato del batch appena committato, associato all'ID alla
   * creazione. Mai letto per posizione: un salto senza eventi lo lascia null.
   */
  private lastCommittedResult: TurnResultRecord | null = null;

  // World metadata cached at init/reconstruct (bug fix: buildGameData used to
  // send basePrompt: '' to every prompt, so the world's custom lore never
  // reached the LLM; STARTING_ROUND_DATE also "floated" each turn because
  // startDate was set to the current date).
  private worldName: string = '';
  private worldBasePrompt: string = '';
  private worldStartDate: string = '';
  /** Этап 5: кастомные правила симуляции мира (rules.md пресет-пакета) */
  private worldSimulationRules: string | undefined = undefined;

  /** Полития игрока по конвенции polityId (см. utils/name-resolver.ts) */
  private playerPolityId: string = 'player';
  /** Сложность игры (Этап 2) */
  private difficulty: Difficulty = 'normal';
  /** Консолидированная история ранних раундов и граница её покрытия (Этап 2) */
  private consolidatedHistory: string = '';
  private consolidatedUpTo: number = 0;
  /** Флаг «Intervene»: остановить применение оставшихся событий пачки (Этап 2) */
  private interveneRequested: boolean = false;
  private actions: ActionRecord[] = [];
  private results: TurnResultRecord[] = [];
  private status: 'waiting' | 'playing' | 'finished' = 'playing';

  // Pending actions queue (Phase 2)
  private pendingActions: PendingAction[] = [];

  /**
   * Per-session mutex around any read-modify-write sequence that mutates
   * `this.regions` / `this.currentTurn` / `this.currentDate` (processNextAction,
   * processNextAction, processAllPendingActions, syncRegionsToDB after a
   * write, etc.).
   *
   * Two concurrent POST /actions/process calls previously both flipped
   * the same PendingAction.status='processing', both ran the LLM call,
   * both applied the delta, both incremented currentTurn, and both
   * wrote the same action row to the DB. This lock collapses them
   * to one effective execution; the second caller gets `null` back
   * and can retry or surface "another turn in progress" to the client.
   *
   * KISS: a single boolean + an awaited promise. No external
   * dependency on `async-mutex`. Sufficient because there's exactly
   * one writer path (this class) — if that ever changes, switch to
   * a real semaphore.
   */
  private isProcessing: boolean = false;
  /** ID del run mutante attualmente proprietario del checkpoint. */
  private activeSimulationRunId: string | null = null;
  /** Cancella il fetch LLM del run attivo quando arriva Intervene. */
  private activeSimulationAbort: AbortController | null = null;
  /** §9.3: playback «un evento alla volta» sospeso su un checkpoint per-evento. */
  private pausedRun: PausedRunState | null = null;

  /**
   * Run `fn` under the per-session lock. If another caller already
   * holds the lock, return `null` immediately (no waiting — the
   * queue may run for many minutes and we don't want a second HTTP
   * request to block that long). On success or thrown error, the
   * lock is always released before this function resolves.
   */
  /** True while a mutable simulation owns this session checkpoint. */
  isSimulationInProgress(): boolean {
    return this.isProcessing;
  }

  /** F04 passo 3: un run è «attivo» anche quando il playback è in pausa in
   * lettura (§9.5: paused è uno stato del run). Chat e advisor non scrivono
   * nel contesto di un run attivo o sospeso. */
  hasActiveRun(): boolean {
    return this.isProcessing || this.pausedRun !== null;
  }

  /** F05 µ2: arresto controllato — abort del run attivo fino agli adattatori
   * (il signal è già propagato a stream e convertitore). */
  abortActiveSimulation(): void {
    this.activeSimulationAbort?.abort();
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.isProcessing) {
      console.warn('[GameSession] Concurrent turn attempt rejected (lock held)');
      return null;
    }
    this.isProcessing = true;
    try {
      return await fn();
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Simulazione live (battito del mondo) ─────────────────────────────────
  // Il mondo continua a vivere anche senza azioni del giocatore: ogni tick
  // avanza la data, processa un pizzico di paesi NPC (round-robin, costo LLM
  // limitato) e applica eventi casuali. Tutto viene trasmesso via SSE come
  // «world_event». Il tick parte solo con client collegati (nessuno guarda →
  // nessuna spesa). Le azioni del giocatore restano prioritarie: il lock salta
  // il tick se un turno è in elaborazione.
  // Il tempo è comandato dal giocatore: non deve avanzare in background.
  // La modalità live resta opzionale per eventuali sessioni sperimentali,
  // ma nasce spenta e non viene mai avviata automaticamente.
  private liveSimEnabled: boolean = false;
  private worldTickTimer: ReturnType<typeof setInterval> | null = null;
  private npcCursor: number = 0;
  private static readonly LIVE_TICK_MS = 30000;
  private static readonly LIVE_TICK_DAYS = 7;
  private readonly npcInFlight = new Set<string>();
  /** Reazioni NPC per turno giocatore: round-robin, per non congelare la
   * simulazione mentre decine di richieste LLM vengono eseguite in serie. */
  private static readonly TURN_NPC_LIMIT = 3;
  private static readonly NPC_TURN_TIMEOUT_MS = 12_000;

  startLiveSim(): void {
    if (!this.liveSimEnabled || this.worldTickTimer) return;
    this.worldTickTimer = setInterval(() => {
      this.worldTick().catch(e =>
        console.error('[GameSession] Live sim tick failed:', e)
      );
    }, GameSession.LIVE_TICK_MS);
    console.log('[GameSession] Live sim avviata (tick ogni', GameSession.LIVE_TICK_MS, 'ms)');
  }

  stopLiveSim(): void {
    if (this.worldTickTimer) {
      clearInterval(this.worldTickTimer);
      this.worldTickTimer = null;
      console.log('[GameSession] Live sim fermata');
    }
  }

  setLiveSim(enabled: boolean): void {
    this.liveSimEnabled = enabled;
    if (enabled) this.startLiveSim();
    else this.stopLiveSim();
  }

  isLiveSim(): boolean {
    return this.liveSimEnabled;
  }

  /**
   * Un tick del mondo: data in avanti, NPC (sottoinsieme) + eventi casuali.
   * Non tocca la coda delle azioni del giocatore; se un turno è in corso, skip.
   */
  async worldTick(): Promise<void> {
    if (this.isStrictGame()) throw new Error('strict_legacy_path_forbidden: worldTick');
    if (this.isProcessing) return;

    await this.withLock(async () => {
      // Snapshot owner/colore per il diff (regioni cambiate)
      const before = new Map<string, Pick<RegionState, 'owner' | 'color' | 'population' | 'gdp' | 'militaryPower'>>();
      for (const r of this.regions.values()) {
        before.set(r.id, { owner: r.owner, color: r.color, population: r.population,
          gdp: r.gdp, militaryPower: r.militaryPower });
      }

      // Avanza il tempo (nessuna azione del giocatore)
      this.currentTurn++;
      this.currentDate = addDays(this.currentDate, GameSession.LIVE_TICK_DAYS);

      // Il battito live non deve attendere una chiamata LLM: una risposta lenta
      // degli NPC bloccava il lock, quindi data, dispacci e mappa sembravano
      // fermi. Le reazioni NPC ragionate restano nel turno degli ordini; qui
      // registriamo esclusivamente fatti deterministici e immediati.
      const randomEvents = this.applyRandomEvents();
      // Anche senza ordini il tempo ha un costo/effetto: economia, popolazione
      // e prontezza vengono aggiornate dal motore, non dal narratore.
      const tick = WorldStateEngine.advance(this.regions.values(), GameSession.LIVE_TICK_DAYS);

      const playerAccount = tick.accounts[this.playerPolityId];
      const playerName = this.publicPolityName(this.playerPolityId);
      const balance = playerAccount?.monthlyBalance || 0;
      // Il titolo resta una notizia breve; cifre e qualifiche appartengono al
      // corpo del dispaccio, non alla riga che deve essere letta sulla mappa.
      const quietHeadline = playerAccount
        ? `${playerName}: aggiornamento dei conti nazionali`
        : 'Settimana senza svolte nel teatro di gioco';
      const quietDispatch = playerAccount
        ? `Il ministero delle Finanze di ${playerName} stima una crescita annua del ${(playerAccount.annualGrowthRate * 100).toFixed(1)}%. Il saldo pubblico mensile resta ${balance >= 0 ? 'positivo' : 'negativo'} per ${Math.abs(balance).toFixed(2)} miliardi di dollari.`
        : 'I governi mantengono le posizioni e non emergono nuove svolte politiche o territoriali.';
      const events = (randomEvents.length > 0 ? randomEvents : [quietHeadline]).map(event => this.publicText(event));
      const id = shortId();
      const narration = randomEvents.length > 0
        ? `Il mondo procede: ${randomEvents.length} ${randomEvents.length === 1 ? 'evento' : 'eventi'} registrati in questo periodo.`
        : quietDispatch;

      const turnResult: TurnResultRecord = {
        id,
        turn: this.currentTurn - 1,
        narration,
        countryResponse: '',
        events,
        date: this.currentDate,
        timelineEvents: events.map((headline, index) => ({
          id: `${id}-${index}`,
          date: this.currentDate,
          headline,
          detail: randomEvents.length > 0
            ? 'Le autorità locali confermano lo sviluppo e ne valutano le conseguenze immediate.'
            : quietDispatch,
          source: 'world' as const,
        })),
      };
      this.results.push(turnResult);

      await this.syncRegionsToDB();
      gameRepository.addTurnResult({
        id: turnResult.id,
        gameId: this.id,
        turn: turnResult.turn,
        narration: turnResult.narration,
        countryResponse: '',
        events: turnResult.events,
        timelineEvents: turnResult.timelineEvents,
        date: turnResult.date,
      });
      gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);

      // Regioni cambiate (owner/colore) — il client le merge nello stato locale
      const changedRegions: any[] = [];
      for (const r of this.regions.values()) {
        const prev = before.get(r.id);
        if (prev && (prev.owner !== r.owner || prev.color !== r.color || prev.population !== r.population
          || prev.gdp !== r.gdp || prev.militaryPower !== r.militaryPower)) {
          changedRegions.push({
            id: r.id,
            owner: r.owner,
            color: r.color,
            population: r.population,
            gdp: r.gdp,
            militaryPower: r.militaryPower,
          });
        }
      }

      this.broadcast('world_event', {
        narration,
        events,
        eventDetails: turnResult.timelineEvents,
        newTurn: this.currentTurn,
        newDate: this.currentDate,
        changedRegions,
      });
      console.log('[GameSession] Live tick →', this.currentDate, `(${events.length} eventi)`);
    });
  }

  /** Registra il punto storico dei conti nazionali del giocatore per la data
   * indicata. Best-effort: un errore di persistenza non deve interrompere il
   * tick economico, ma non deve nemmeno produrre una tendenza inventata. */
  private recordAccountSnapshot(date: string, accounts?: Record<string, NationalAccount>): void {
    try {
      const branchId = gameRepository.getHeadBranch(this.id);
      if (!branchId) return;
      const account = (accounts ?? WorldStateEngine.accounts(this.regions.values()))[this.playerPolityId];
      if (!account) return;
      nationalAccountRepository.append(this.id, branchId, this.playerPolityId, this.currentTurn, date, account as unknown as Record<string, unknown>);
    } catch (error) {
      console.warn('[GameSession] Impossibile registrare lo storico dei conti:', error);
    }
  }

  /** Serie storica dei conti del paese giocatore sul ramo corrente. */
  getNationalHistory(limit = 24) {
    const branchId = gameRepository.getHeadBranch(this.id);
    if (!branchId) return [];
    return nationalAccountRepository.list(this.id, branchId, this.playerPolityId, limit);
  }

  /** Avanza le variabili lente del mondo e restituisce un fatto verificabile
   * per il bollettino del paese giocatore. */
  private advanceWorldState(days: number, asOfDate: string = this.currentDate): string[] {
    if (this.isStrictGame()) {
      // Il tick strict è idempotente e consuma anche le scadenze odierne
      // (due_date <= asOfDate): non saltare mai il confine corrente.
      const branchId = gameRepository.getHeadBranch(this.id);
      if (!branchId) throw new Error('strict_branch_missing');
      const tick = runStrictTick(this.id, branchId, gameRepository.getWorldRevision(this.id), asOfDate);
      const worldRow = worldRepository.findById(this.worldId) as { template_id?: unknown } | undefined;
      const templateId = worldRow?.template_id;
      if (typeof templateId !== 'string' || !templateId) throw new Error('strict_catalog_binding_missing');
      const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
      if (!loaded.catalog) throw new Error(`strict_catalog_invalid: ${templateId}`);
      // M07 µ4: scorte possedute da attori della polity, non dai custodi.
      // Binding catalogo server: un LLM/client non può cambiare l'owner set.
      const ownerActorRefs = loaded.catalog.actors
        .filter(actor => actor.polityId === this.playerPolityId)
        .map(actor => actor.actorId);
      const mandateDecisions = refreshMandateStockDecisions(this.id, branchId, asOfDate, ownerActorRefs);
      this.recordAccountSnapshot(asOfDate);
      return [
        ...tick.settledCashflows.map(flow => `Una scadenza finanziaria è stata regolata con stato ${this.publicText(flow.status)} e un pagamento di ${flow.paid}.`),
        ...mandateDecisions.map(decision => `Le scorte di ${decision.resourceId} sono pari a ${decision.availableStock}, sotto la soglia di ${decision.minStock}. Il governo di ${this.publicPolityName(this.playerPolityId)} deve autorizzare ${decision.kind === 'stock_shortfall_outside_authorization' ? 'un acquisto straordinario' : 'prezzo e quantità dell’intervento'}.`),
      ];
    }
    const tick = WorldStateEngine.advance(this.regions.values(), days);
    this.recordAccountSnapshot(asOfDate, tick.accounts);
    const lines: string[] = [];
    const bulletin = WorldStateEngine.playerBulletin(tick.accounts[this.playerPolityId]);
    if (bulletin) lines.push(`📊 ${bulletin}`);
    lines.push(...this.advanceResources(days, tick.accounts));
    lines.push(...this.advanceProduction(days, tick.accounts[this.playerPolityId]));
    lines.push(...this.advanceProjects(days, asOfDate));
    return lines;
  }

  /** Magazzino materiale della polity: cache → DB → seed dai dati iniziali. */
  private resourceStock(polityId: string): ResourceStock {
    const cached = this.resourceStocks.get(polityId);
    if (cached) return cached;
    try {
      const stored = resourceRepository.get(this.id, polityId);
      if (stored) {
        this.resourceStocks.set(polityId, stored.stock);
        return stored.stock;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura magazzino non disponibile:', error);
    }
    // Il magazzino nasce dai dati di partenza della nazione (province iniziali
    // del mondo), non dallo stato corrente di una partita già avanzata.
    const account = this.initialAccounts()[polityId]
      ?? WorldStateEngine.accounts(this.regions.values())[polityId];
    const seeded = account ? seedStock(account, naturalResourcesFor(polityId)) : normalizeStock({});
    this.saveResourceStock(polityId, seeded);
    return seeded;
  }

  /** Conto nazionale delle province iniziali del mondo, per polity. */
  private initialAccounts(): Record<string, NationalAccount> {
    if (!this.initialAccountsCache) this.initialAccountsCache = worldInitialAccounts(this.worldId);
    return this.initialAccountsCache;
  }

  /**
   * Crea — se mancante — il magazzino della polity controllata dai suoi dati di
   * partenza. Le altre nazioni vengono seminate al primo tick che le riguarda
   * (`advanceResources`), sempre dai dati iniziali del mondo. Lazy di proposito:
   * un seed eager di tutte le nazioni costerebbe decine di secondi all'avvio.
   */
  seedInitialResources(): void {
    if (this.isStrictGame() || !this.playerPolityId) return;
    if (this.resourceStocks.has(this.playerPolityId)) return;
    try {
      if (resourceRepository.get(this.id, this.playerPolityId)) return;
    } catch { /* tabella non ancora pronta: si semina comunque */ }
    const account = this.initialAccounts()[this.playerPolityId];
    if (!account || account.provinces === 0) return;
    this.saveResourceStock(this.playerPolityId, seedStock(account));
  }

  private saveResourceStock(polityId: string, stock: ResourceStock): void {
    this.resourceStocks.set(polityId, stock);
    try {
      resourceRepository.upsert(this.id, polityId, stock, this.currentTurn, this.currentDate);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare il magazzino:', error);
    }
  }

  /**
   * Avanza il magazzino di ogni polity del periodo indicato. Le scorte sono
   * persistenti: qui maturano produzione, consumi, ricerca e tecnologie.
   */
  private advanceResources(days: number, accounts?: Record<string, NationalAccount>): string[] {
    if (this.isStrictGame() || days <= 0) return [];
    const snapshot = accounts ?? WorldStateEngine.accounts(this.regions.values());
    const lines: string[] = [];
    for (const [polityId, account] of Object.entries(snapshot)) {
      if (!polityId || polityId === 'neutral' || account.provinces === 0) continue;
      // Risorse naturali dinamiche: estrazione, esaurimento, accumulo in magazzino.
      const ledger = this.resourceLedger(polityId);
      const natural = advanceLedger(ledger, account, days);
      this.saveResourceLedger(polityId, natural.ledger);
      applyGlobalExtraction(this.ensureMarket(), natural.extracted);
      // Una risorsa esaurita smette di dare i bonus di produzione del giacimento.
      const effective = effectiveEndowment(natural.ledger, naturalResourcesFor(polityId));
      const tick = advanceStock(this.resourceStock(polityId), account, days, effective);
      this.saveResourceStock(polityId, tick.stock);
      if (polityId !== this.playerPolityId) continue;
      for (const tech of tick.unlocked) {
        lines.push(`🔬 Nuova tecnologia sbloccata: ${tech.name} — ${tech.effects}.`);
      }
      for (const shortage of tick.flow.shortages) lines.push(`⚠️ Carenza materiale — ${shortage}.`);
      lines.push(`🏭 ${describeStock(tick.stock, account)}`);
      const extractedKinds = NATURAL_RESOURCE_KINDS.filter(kind => (natural.extracted[kind] || 0) > 0);
      if (extractedKinds.length > 0) {
        lines.push(`⛏️ Estrazione risorse: ${extractedKinds.map(kind => `${natural.extracted[kind]} ${kind}`).join(', ')}.`);
      }
      for (const kind of natural.depleted) {
        lines.push(`🪫 Risorsa esaurita: ${kind} — le produzioni che ne dipendevano perdono il bonus del giacimento.`);
      }
    }
    return lines;
  }

  /** Magazzino del paese giocatore, per API e dossier. */
  getResources() {
    const account = WorldStateEngine.accounts(this.regions.values())[this.playerPolityId];
    const ledger = this.resourceLedger(this.playerPolityId);
    const market = this.ensureMarket();
    const natural = summarizeLedger(ledger, account);
    const stock = this.resourceStock(this.playerPolityId);
    return {
      stock,
      account,
      natural,
      market: natural.map(summary => marketQuote(market, summary.kind)),
      debt: Math.round(debtOf(stock) * 100) / 100,
      creditLimit: creditLimit(account),
      creditHeadroom: Math.round(creditHeadroom(stock, account) * 100) / 100,
    };
  }

  /** Compravendita di risorse naturali: cassa ↔ magazzino, prezzo di mercato. */
  tradeResource(mode: 'sell' | 'buy', kind: string, quantity: number) {
    if (mode !== 'sell' && mode !== 'buy') throw new Error('trade_mode_invalid');
    if (!NATURAL_RESOURCE_KINDS.includes(kind as NaturalResourceKind)) throw new Error('unknown_resource');
    const resourceKind = kind as NaturalResourceKind;
    const ledger = this.resourceLedger(this.playerPolityId);
    const stock = this.resourceStock(this.playerPolityId);
    const market = this.ensureMarket();
    const result = executeTrade(ledger, stock, market, resourceKind, quantity, mode);
    if (!result.ok) throw new Error(result.error || 'trade_failed');
    this.saveResourceLedger(this.playerPolityId, result.ledger);
    this.saveResourceStock(this.playerPolityId, result.stock);
    const qty = Math.floor(quantity);
    market.pressure[resourceKind] = Math.max(-0.4, Math.min(0.8,
      (market.pressure[resourceKind] || 0) + tradePressureDelta(resourceKind, qty, mode)));
    return { ok: true, mode, kind: resourceKind, quantity: qty, unitPrice: result.unitPrice, total: result.total, quote: marketQuote(market, resourceKind) };
  }

  /** Riserva naturale: cache → DB → semina dal giacimento immutabile. */
  private resourceLedger(polityId: string): ResourceLedger {
    const cached = this.resourceLedgers.get(polityId);
    if (cached) return cached;
    try {
      const stored = naturalResourceRepository.get(this.id, polityId);
      if (stored) {
        this.resourceLedgers.set(polityId, stored.ledger);
        return stored.ledger;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura risorse naturali non disponibile:', error);
    }
    const seeded = seedLedger(naturalResourcesFor(polityId));
    this.saveResourceLedger(polityId, seeded);
    return seeded;
  }

  private saveResourceLedger(polityId: string, ledger: ResourceLedger): void {
    this.resourceLedgers.set(polityId, ledger);
    try {
      naturalResourceRepository.upsert(this.id, polityId, ledger, this.currentTurn, this.currentDate);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare le risorse naturali:', error);
    }
  }

  /** Mercato mondiale: riserve globali e pressione di prezzo. Una volta per partita. */
  private ensureMarket(): WorldMarket {
    if (this.marketSeeded) return this.market;
    const endowments: Record<string, NaturalEndowment> = {};
    for (const polityId of Object.keys(this.initialAccounts())) {
      if (!polityId || polityId === 'neutral') continue;
      endowments[polityId] = naturalResourcesFor(polityId);
    }
    this.market = seedMarket(endowments);
    try {
      for (const record of naturalResourceRepository.list(this.id)) {
        const extracted: Partial<Record<NaturalResourceKind, number>> = {};
        for (const [kind, node] of Object.entries(record.ledger)) {
          extracted[kind as NaturalResourceKind] = node.extractedTotal;
        }
        applyGlobalExtraction(this.market, extracted);
      }
    } catch (error) {
      console.warn('[GameSession] Mercato risorse non ricostruibile:', error);
    }
    this.marketSeeded = true;
    return this.market;
  }

  /** Arsenale della polity: cache → DB → seed dal suo esercito di partenza. */
  private arsenalUnits(polityId: string): Record<string, number> {
    const cached = this.arsenals.get(polityId);
    if (cached) return cached;
    try {
      const stored = arsenalRepository.get(this.id, polityId);
      if (stored) {
        this.arsenals.set(polityId, stored.units);
        return stored.units;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura arsenale non disponibile:', error);
    }
    const account = this.initialAccounts()[polityId];
    const troops = Math.max(0, account?.forces || 0) + Math.max(0, account?.mobilized || 0);
    const forces = Math.max(0, account?.forces || 0);
    const units: Record<string, number> = {};
    // Dotazione di partenza: armi individuali e trasporti per le forze esistenti.
    if (troops > 0) units.fucili = Math.round(troops * 40 + (account?.mobilized || 0) * 10);
    if (forces > 0) units.apc = Math.round(forces * 1.5);
    this.saveArsenal(polityId, units);
    return units;
  }

  private saveArsenal(polityId: string, units: Record<string, number>): void {
    this.arsenals.set(polityId, units);
    try {
      arsenalRepository.upsert(this.id, polityId, units, this.currentTurn, this.currentDate);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare l’arsenale:', error);
    }
  }

  /** Capacità industriale e tecnologica corrente della polity giocatore. */
  private nationCapacity(polityId = this.playerPolityId): NationCapacity {
    const account = WorldStateEngine.accounts(this.regions.values())[polityId];
    const stock = this.resourceStock(polityId);
    return {
      factories: Math.max(0, account?.factories || 0),
      ports: Math.max(0, account?.ports || 0),
      universities: Math.max(0, account?.universities || 0),
      technologies: stock.technologies,
      money: stock.money,
      weapons: stock.weapons,
      credit: creditHeadroom(stock, account),
      endowment: naturalResourcesFor(polityId),
    };
  }

  /**
   * Potenza militare effettiva = potenza della mappa × fattore dell'arsenale
   * (qualità media delle armi e copertura rispetto alle forze). È il valore che
   * pesa sui combattimenti narrati dal modello e sull'attrito delle conquiste.
   */
  effectiveMilitaryPower(polityId = this.playerPolityId): number {
    return this.nationalEffectiveMilitaryPower(polityId);
  }

  /**
   * Arsenale, risorse naturali, capacità industriale e catalogo completo con la
   * fattibilità di costruzione/acquisto per ogni voce.
   */
  getArsenal() {
    const polityId = this.playerPolityId;
    const capacity = this.nationCapacity(polityId);
    const units = this.arsenalUnits(polityId);
    const account = WorldStateEngine.accounts(this.regions.values())[polityId];
    const combatFactor = arsenalCombatFactor(units, Number(account?.forces || 0) + Number(account?.mobilized || 0));
    const endowment = capacity.endowment;
    const lines = describeArsenal(units).map(line => ({
      id: line.equipment.id,
      name: line.equipment.name,
      domain: line.equipment.domain,
      category: line.equipment.category,
      quality: line.equipment.quality,
      tier: line.equipment.tier,
      quantity: line.quantity,
    }));
    const catalog = EQUIPMENT_CATALOG.map(equipment => {
      const option = procurementOption(equipment, capacity);
      return {
        ...equipment,
        canBuild: option.canBuild,
        canBuy: option.canBuy,
        buildCostMln: option.buildCostMln,
        buyCostMln: option.buyCostMln,
        resourceFactor: option.resourceFactor,
        reasons: option.reasons,
      };
    });
    return {
      polityId,
      units,
      strength: arsenalStrength(units),
      qualityIndex: arsenalQualityIndex(units),
      combatFactor,
      baseMilitaryPower: Math.round(Number(account?.militaryPower || 0)),
      effectiveMilitaryPower: Math.round(Number(account?.militaryPower || 0) * combatFactor * 10) / 10,
      lines,
      naturalResources: endowment,
      naturalResourcesText: describeEndowment(endowment),
      debt: Math.round(debtOf(this.resourceStock(polityId)) * 100) / 100,
      creditLimit: creditLimit(account),
      production: this.getProduction(),
      capacity: {
        factories: capacity.factories,
        ports: capacity.ports,
        universities: capacity.universities,
        money: capacity.money,
        weapons: capacity.weapons,
        credit: capacity.credit || 0,
        technologies: capacity.technologies,
      },
      catalog,
    };
  }

  /**
   * Costruisce (`build`) o importa (`buy`) equipaggiamento militare.
   *
   * - L'**acquisto** all'estero è immediato: consegna subito, pagando il
   *   sovrapprezzo.
   * - La **costruzione** apre un ordine con percentuale di completamento: si
   *   paga all'avvio, la consegna arriva a lavori finiti e può subire ritardi o
   *   difetti.
   * - Se la cassa non basta si va **a debito** entro il tetto di credito
   *   (60% del PIL nominale); oltre il tetto la spesa è rifiutata.
   */
  procureEquipment(mode: 'build' | 'buy', equipmentId: string, quantity = 1) {
    const polityId = this.playerPolityId;
    const equipment = equipmentById(equipmentId);
    if (!equipment) throw new Error(`equipment_unknown: ${equipmentId}`);
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    if (qty > 1000) throw new Error('equipment_quantity_invalid');
    if (mode !== 'build' && mode !== 'buy') throw new Error('procurement_mode_invalid');
    const account = WorldStateEngine.accounts(this.regions.values())[polityId];
    const capacity = this.nationCapacity(polityId);
    const option = procurementOption(equipment, capacity);
    if (mode === 'build' && !option.canBuild) {
      if (option.reasons.some(reason => reason.includes('credito'))) {
        throw new Error('credit_exhausted: cassa e credito insufficienti (debito al limite)');
      }
      throw new Error(`build_unavailable: ${option.reasons.join('; ') || 'capacità insufficienti'}`);
    }
    if (mode === 'buy' && !option.canBuy) {
      throw new Error('credit_exhausted: cassa e credito insufficienti (debito al limite)');
    }
    const unitCostMln = mode === 'build' ? option.buildCostMln : option.buyCostMln;
    const spentMln = unitCostMln * qty;
    const spentMld = spentMln / 1000;
    const stock = this.resourceStock(polityId);
    const financing = financePurchase(stock, account, spentMld);
    if (!financing.ok) throw new Error('credit_exhausted: debito al limite del tetto');
    const nextStock: ResourceStock = {
      ...stock,
      money: Math.round((stock.money - spentMld) * 1000) / 1000,
      weapons: mode === 'build' ? Math.max(0, stock.weapons - equipment.weaponsCost * qty) : stock.weapons,
    };
    this.saveResourceStock(polityId, nextStock);
    const financedMln = Math.round(financing.debtUsed * 1000);
    const debtMld = debtOf(nextStock);

    if (mode === 'buy') {
      const units = { ...this.arsenalUnits(polityId) };
      units[equipmentId] = (units[equipmentId] || 0) + qty;
      this.saveArsenal(polityId, units);
      return {
        mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
        financedMln, debtMld, complete: true, units, strength: arsenalStrength(units),
      };
    }

    const order = this.startProductionOrder(equipmentId, qty, spentMln);
    const units = this.arsenalUnits(polityId);
    return {
      mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
      financedMln, debtMld, complete: false, units, strength: arsenalStrength(units), order,
    };
  }

  private productionContext(): ProductionContext {
    const account = WorldStateEngine.accounts(this.regions.values())[this.playerPolityId];
    const stock = this.resourceStock(this.playerPolityId);
    return {
      factories: Math.max(0, account?.factories || 0),
      ports: Math.max(0, account?.ports || 0),
      universities: Math.max(0, account?.universities || 0),
      stability: Number(account?.stability ?? 50),
      socialTension: Number(account?.socialTension ?? 0),
      technologies: stock.technologies,
    };
  }

  /** Apre un ordine di produzione: il costo è già stato pagato all'avvio. */
  private startProductionOrder(equipmentId: string, quantity: number, spentMln: number): ProductionOrder {
    const equipment = equipmentById(equipmentId)!;
    const order: ProductionOrder = {
      id: `ord-${shortId(8)}`,
      equipmentId,
      name: equipment.name,
      domain: equipment.domain,
      quantity,
      progress: 0,
      spentMln,
      startedTurn: this.currentTurn,
      startedDate: this.currentDate,
      status: 'in_progress',
      note: '',
      qualityLoss: 0,
      updatedDate: this.currentDate,
    };
    this.saveProductionOrder(order);
    return order;
  }

  /** Ordini di produzione del giocatore, per API e dossier. */
  getProduction() {
    const orders = this.playerProductionOrders()
      .slice()
      .sort((a, b) => {
        const rank = (order: ProductionOrder) => order.status === 'in_progress' ? 0 : 1;
        return rank(a) - rank(b) || a.startedTurn - b.startedTurn;
      });
    return { orders, inProgress: orders.filter(order => order.status === 'in_progress').length };
  }

  private playerProductionOrders(): ProductionOrder[] {
    if (!this.productionLoaded) {
      try {
        for (const order of productionRepository.list(this.id)) this.productionOrders.set(order.id, order);
      } catch (error) {
        console.warn('[GameSession] Lettura ordini di produzione non disponibile:', error);
      }
      this.productionLoaded = true;
    }
    return [...this.productionOrders.values()];
  }

  private saveProductionOrder(order: ProductionOrder): void {
    this.productionOrders.set(order.id, order);
    try {
      productionRepository.upsert(this.id, order);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare l’ordine di produzione:', error);
    }
  }

  /** Avanza gli ordini di produzione del giocatore e consegna a lavori finiti. */
  private advanceProduction(days: number, account?: NationalAccount): string[] {
    if (this.isStrictGame() || days <= 0) return [];
    const orders = this.playerProductionOrders().filter(order => order.status === 'in_progress');
    if (orders.length === 0) return [];
    const months = days / 30;
    const context = this.productionContext();
    const bulletins: string[] = [];
    for (const order of orders) {
      const seed = `${this.id}:${order.id}:${this.currentTurn}`;
      const result = advanceOrder(order, context, months, seed);
      if (result.completed) {
        const units = { ...this.arsenalUnits(this.playerPolityId) };
        units[order.equipmentId] = (units[order.equipmentId] || 0) + result.delivered;
        this.saveArsenal(this.playerPolityId, units);
        productionRepository.remove(this.id, order.id);
        this.productionOrders.delete(order.id);
        const defect = result.order.qualityLoss > 0 ? ` (${Math.round(result.order.qualityLoss)}% difettose)` : '';
        bulletins.push(`🏭 Produzione completata: ${result.delivered}/${order.quantity} × ${order.name}${defect}.`);
      } else if (result.failed) {
        productionRepository.remove(this.id, order.id);
        this.productionOrders.delete(order.id);
        bulletins.push(`⚠️ Produzione fallita: ${order.name} — ${result.order.note}.`);
      } else {
        this.saveProductionOrder(result.order);
        if (result.setbackPct > 0) {
          bulletins.push(`⚠️ ${order.name}: imprevisto in produzione, avanzamento ${Math.round(result.order.progress)}% (−${result.setbackPct}%).`);
        }
      }
    }
    void account;
    return bulletins;
  }

  /**
   * Percentuale di completamento dei progetti in corso, con rischio di
   * slittamento della scadenza: non sempre le cose vanno come previsto.
   */
  private advanceProjects(days: number, asOfDate: string): string[] {
    if (this.isStrictGame() || days <= 0) return [];
    const processes = gameRepository.getOngoingProcesses(this.id);
    if (processes.length === 0) return [];
    const account = WorldStateEngine.accounts(this.regions.values())[this.playerPolityId];
    const stability = Number(account?.stability ?? 50);
    const tension = Number(account?.socialTension ?? 0);
    const risk = Math.min(0.5, 0.05 + Math.max(0, 60 - stability) / 300 + Math.max(0, tension - 30) / 500);
    const bulletins: string[] = [];
    for (const process of processes) {
      const progress = projectProgress(process.started_date, process.expected_date, asOfDate);
      const roll = stableRoll(`${this.id}:${process.id}:${this.currentTurn}`);
      let note = '';
      let expected: string | null = null;
      if (roll < risk && process.expected_date) {
        const slip = 15 + Math.round(stableRoll(`${this.id}:${process.id}:${this.currentTurn}:slip`) * 45);
        expected = addDays(process.expected_date, slip);
        note = `slittamento di ${slip} giorni (rischio ${Math.round(risk * 100)}%)`;
        bulletins.push(`⏳ Progetto «${process.title}»: ${note}. Avanzamento ${progress}%.`);
      }
      gameRepository.updateOngoingProcessProgress(this.id, process.id, progress, note, expected);
    }
    return bulletins;
  }

  // Diplomatic relationships
  private relationships: RelationshipMatrix = new RelationshipMatrix();

  /** Magazzino materiale per polity (cibo, vestiario, armamenti, carburante…). */
  private resourceStocks = new Map<string, ResourceStock>();
  private resourceLedgers = new Map<string, ResourceLedger>();
  private market: WorldMarket = emptyMarket();
  private marketSeeded = false;

  /** Arsenale militare per polity (quantità per voce di catalogo). */
  private arsenals = new Map<string, Record<string, number>>();

  /** Ordini di produzione con percentuale di completamento (giocatore). */
  private productionOrders = new Map<string, ProductionOrder>();
  private productionLoaded = false;

  /** Conti nazionali delle province INIZIALI del mondo (dati di partenza). */
  private initialAccountsCache?: Record<string, NationalAccount>;

  // SSE broadcaster for real-time updates
  private sseBroadcaster: ((type: SSEEventType, data: any) => boolean | void) | null = null;

  constructor(gameId: string, worldId: string, provider: LLMRouter) {
    this.id = gameId;
    this.worldId = worldId;
    this.llm = provider;
    this.gameController = new GameController(provider);
    this.promptEngine = new PromptEngine(provider);
    // F04 §9.4: ogni partita nasce (o riapre) sul suo ramo principale.
    // Idempotente: le sessioni ricostruite dal DB non duplicano il ramo.
    gameRepository.ensureMainBranch(gameId);
  }

  /**
   * Set SSE broadcaster for real-time updates
   */
  setSSEBroadcaster(broadcaster: (type: SSEEventType, data: any) => boolean | void): void {
    this.sseBroadcaster = broadcaster;
  }

  /**
   * Broadcast event to SSE clients
   */
  private broadcast(type: SSEEventType, data: any): boolean {
    if (!this.sseBroadcaster) return false;
    try {
      return this.sseBroadcaster(type, data) !== false;
    } catch (error) {
      // SSE è post-commit/best-effort: non può attivare un falso rollback RAM.
      console.error('[GameSession] SSE broadcast failed:', type, error);
      return false;
    }
  }

  /** Nome nazionale destinato a cronaca, diplomazia e prompt pubblici. */
  private publicPolityName(polityId: string): string {
    const registeredName = countryRepository.findByCode(polityId)?.name;
    const owned = Array.from(this.regions.values()).filter(region => region.owner === polityId);
    // Un'unica regione può rappresentare una nazione storica o alternativa
    // (es. Germania Ovest, Cecoslovacchia): conserva quel nome curato. Se è
    // soltanto il nome inglese del registro, preferisci invece l'italiano.
    const curatedSingleName = owned.length === 1 && owned[0].name
      && normalizeName(owned[0].name) !== normalizeName(registeredName || '')
      ? owned[0].name
      : undefined;
    return curatedSingleName || polityDisplayNameIt(polityId, registeredName || owned[0]?.name || polityId);
  }

  /** Applica il filtro editoriale usando sempre l'identità nazionale corrente. */
  private publicText(value: unknown): string {
    return publicNarrativeText(value, this.publicPolityName(this.playerPolityId));
  }

  /**
   * Build game data object for prompt engine
   */
  private buildGameData(focusTexts: string[] = []): any {
    const player = this.players[0];

    // Convert regions Map to object for compatibility
    const regionsObj: Record<string, RegionState> = {};
    const regionsByPolity = new Map<string, RegionState[]>();
    for (const [id, region] of this.regions) {
      regionsObj[id] = region;
      if (!regionsByPolity.has(region.owner)) regionsByPolity.set(region.owner, []);
      regionsByPolity.get(region.owner)!.push(region);
    }
    const polityNames: Record<string, string> = {};
    for (const [owner] of regionsByPolity) {
      polityNames[owner] = this.publicPolityName(owner);
    }
    const accounts = WorldStateEngine.accounts(this.regions.values());
    // Arsenale della nazione giocatore: pesa sulla potenza militare effettiva.
    const playerArsenalUnits = this.arsenalUnits(this.playerPolityId);
    const playerArsenalFactor = arsenalCombatFactor(playerArsenalUnits,
      Number(accounts[this.playerPolityId]?.forces || 0) + Number(accounts[this.playerPolityId]?.mobilized || 0));
    // Potenza effettiva per tutte le politie con arsenale già noto (il
    // giocatore e ogni nazione NPC i cui armamenti sono stati seminati).
    const effectiveAccounts: typeof accounts = {};
    for (const [id, account] of Object.entries(accounts)) {
      const units = id === this.playerPolityId ? playerArsenalUnits : this.arsenals.get(id);
      if (!units) { effectiveAccounts[id] = account; continue; }
      const factor = arsenalCombatFactor(units,
        Number(account.forces || 0) + Number(account.mobilized || 0));
      effectiveAccounts[id] = {
        ...account,
        arsenalStrength: arsenalStrength(units),
        arsenalCombatFactor: factor,
        effectiveMilitaryPower: Math.round(Number(account.militaryPower || 0) * factor * 10) / 10,
      } as NationalAccount;
    }

    return {
      id: this.id,
      currentDate: this.currentDate,
      currentTurn: this.currentTurn,
      difficulty: this.difficulty,
      consolidatedHistory: this.consolidatedHistory,
      consolidationTail: this.llm.consolidation.keepRawTail,
      // Stato materiale del mondo: è ricostruito dal motore deterministico
      // dalla mappa e quindi non può contraddire la memoria narrativa.
      worldState: {
        accounts: effectiveAccounts,
        resources: (() => {
          const stock = this.resourceStock(this.playerPolityId);
          const account = accounts[this.playerPolityId];
          return {
            stock,
            account,
            natural: summarizeLedger(this.resourceLedger(this.playerPolityId), account),
            debt: Math.round(debtOf(stock) * 100) / 100,
            creditLimit: creditLimit(account),
            creditHeadroom: Math.round(creditHeadroom(stock, account) * 100) / 100,
          };
        })(),
        // Ordini di produzione in corso con percentuale di completamento.
        production: this.getProduction().orders
          .filter(order => order.status === 'in_progress')
          .map(order => ({ id: order.id, name: order.name, quantity: order.quantity, progress: Math.round(order.progress), note: order.note })),
        // Arsenale e risorse naturali: tratti materiali della nazione, non
        // inventati dal modello. Il catalogo completo resta nelle API.
        arsenal: {
          units: playerArsenalUnits,
          strength: arsenalStrength(playerArsenalUnits),
          qualityIndex: arsenalQualityIndex(playerArsenalUnits),
          naturalResources: effectiveEndowment(this.resourceLedger(this.playerPolityId), naturalResourcesFor(this.playerPolityId)),
        },
        // Potenza militare effettiva: è il numero su cui si risolvono i
        // combattimenti narrati (potenza mappa × qualità/copertura dell'arsenale).
        military: {
          combatFactor: playerArsenalFactor,
          baseMilitaryPower: Math.round(Number(accounts[this.playerPolityId]?.militaryPower || 0)),
          effectiveMilitaryPower: Math.round(Number(accounts[this.playerPolityId]?.militaryPower || 0) * playerArsenalFactor * 10) / 10,
        },
      },
      world: {
        name: this.worldName,
        basePrompt: this.worldBasePrompt,
        startDate: this.worldStartDate || this.currentDate,
        regions: regionsObj,
      },
      // Этап 5: правила симуляции мира → HISTORICAL_PRESET_SIMULATION_RULES
      simulationRules: this.worldSimulationRules ?? undefined,
      // Gli adapter permissivi per modelli free restano disattivati nelle
      // partite strict, che devono fallire chiuse su ogni protocollo invalido.
      strictMode: this.isStrictGame(),
      players: this.players.map(p => ({
        id: p.id,
        name: p.polityId === this.playerPolityId ? this.publicPolityName(this.playerPolityId) : p.name,
        regionId: p.regionId,
        polityId: p.polityId,
      })),
      playerPolityId: this.playerPolityId,
      playerPolityName: polityNames[this.playerPolityId],
      polityNames,
      // Stato diplomatico persistente: il prompt usa questi rapporti per
      // motivare le reazioni delle altre politie, non per inventarle.
      relationships: this.relationships.toJSON(),
      // Identità stabile + priorità dinamiche + memoria per le politie davvero
      // rilevanti al teatro corrente. È la stessa fonte usata dalle chat.
      npcStrategicProfiles: this.buildNpcStrategicDossiers(focusTexts, accounts),
      // I progetti attivi sono contesto canonico anche senza nuovi ordini.
      // LLM riceve ID e date, non deve riconoscerli per titolo.
      ongoingProcesses: gameRepository.getOngoingProcesses(this.id).map((process: any) => ({
        id: process.id,
        sourceActionId: process.source_action_id,
        title: process.title,
        summary: process.summary,
        startedDate: process.started_date,
        expectedDate: process.expected_date || undefined,
        // Percentuale di completamento calcolata dal motore, non dal modello.
        progress: Number(process.progress) >= 0 && process.progress !== null
          ? Number(process.progress)
          : projectProgress(process.started_date, process.expected_date, this.currentDate),
        progressNote: process.progress_note || undefined,
      })),
      actions: this.actions,
      results: this.results,
      // Le trattative diplomatiche entrano nella simulazione (i patti contano)
      chatTranscripts: this.buildChatTranscripts(),
    };
  }

  // =========================================================================
  // Chat diplomatiche (stile Pax Historia): uno-a-uno e di gruppo,
  // «next speaker» deciso dall'LLM, auto-continuazione tra nazioni.
  // =========================================================================

  /** Elenco chat del gioco (per l'elenco frontend). */
  getChats(): ChatSummary[] {
    return chatRepository.getChatsByGame(this.id);
  }

  /** Messaggi della chat (404 se la chat è di un'altra partita). */
  getChatMessages(chatId: string): ChatMessageRecord[] {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.id) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    return chatRepository.getMessages(chatId);
  }

  /** Segna i messaggi delle politie della chat come letti. */
  markChatRead(chatId: string): void {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.id) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    chatRepository.markRead(chatId);
  }

  /**
   * Trova o crea la chat con le nazioni indicate PER NOME (come le chiama il
   * giocatore). Con più nomi crea una chat di gruppo: i partecipanti sono
   * risolti via PolityResolver; nome giocatore/neutral/inesistenti → errore.
   */
  ensureChat(polityNames: string[]): ChatRecord {
    const resolvers = this.buildResolvers();
    const interlocutors: ChatParticipant[] = [];

    for (const rawName of polityNames) {
      const name = (rawName || '').trim();
      if (!name) continue;
      const resolution = resolvers.polities.resolve(name);
      if (!resolution || resolution.isNew
          || resolution.polityId === 'neutral'
          || resolution.polityId === this.playerPolityId) {
        throw new Error(`Polity not found: ${name}`);
      }
      if (interlocutors.some(p => p.id === resolution.polityId)) continue;

      const polityRegions = Array.from(this.regions.values()).filter(r => r.owner === resolution.polityId);
      const displayName = this.publicPolityName(resolution.polityId);
      const color = this.polityColor(resolution.polityId) || polityRegions[0]?.color || '#888888';
      interlocutors.push({ id: resolution.polityId, name: displayName, color, role: 'polity' });
    }

    if (interlocutors.length === 0) {
      throw new Error('Polity not found: nessun interlocutore valido');
    }

    const player = this.players[0];
    const participants: ChatParticipant[] = [
      {
        id: this.playerPolityId,
        name: this.publicPolityName(this.playerPolityId),
        color: player?.color || '#667eea',
        role: 'player',
      },
      ...interlocutors,
    ];
    const existing = chatRepository.getChatByParticipantIds(this.id, participants.map(p => p.id));
    if (existing) return existing;

    const primary = interlocutors[0];
    const displayName = interlocutors.length > 1
      ? interlocutors.map(p => p.name).join(' + ')
      : primary.name;

    return chatRepository.createChat({
      id: shortId(),
      gameId: this.id,
      polityId: primary.id,
      polityName: displayName,
      polityColor: primary.color,
      participants,
    });
  }

  /** Conserva soltanto reazioni attribuite a politie realmente presenti. */
  private canonicalizeEventReactions(event: SimulationEvent, actionTexts: string[] = []): SimulationEvent {
    const resolver = this.buildResolvers().polities;
    const seen = new Set<string>();
    // Una reazione è valida solo se la politia è pertinente al teatro della
    // crisi (nominata, vicina o con un rapporto). Le potenze lontane senza
    // interesse documentato restano fuori dal dispaccio e dalle chat.
    const relevantPolities = this.crisisRelevantPolityIds([event.headline, event.description, ...actionTexts]);
    const reactions = (event.reactions || []).flatMap(reaction => {
      const resolution = resolver.resolve(reaction.polityName);
      if (!resolution || resolution.isNew || resolution.polityId === 'neutral'
          || resolution.polityId === this.playerPolityId || seen.has(resolution.polityId)) return [];
      if (!relevantPolities.has(resolution.polityId)) return [];
      seen.add(resolution.polityId);
      return [{
        ...reaction,
        polityName: this.publicPolityName(resolution.polityId),
        priority: reaction.priority ? this.publicText(reaction.priority) : undefined,
        response: this.publicText(reaction.response),
        counterAction: reaction.counterAction ? this.publicText(reaction.counterAction) : undefined,
      }];
    });
    const canonical = { ...event, description: this.publicText(event.description), reactions };
    return this.reconcileNpcMaterialMeasures({ ...canonical, description: this.eventDetail(canonical) });
  }

  /** Il dispaccio mostra esplicitamente le decisioni delle controparti. */
  private eventDetail(event: SimulationEvent): string {
    const base = (event.description || '').trim();
    if (!event.reactions?.length) return base;
    const stanceLabels: Record<string, string> = {
      supportive: 'favorevole',
      opposed: 'contraria',
      conditional: 'condizionata',
      neutral: 'neutrale',
    };
    const reactions = event.reactions.map(reaction => {
      const priority = reaction.priority ? ` La decisione tutela ${reaction.priority}.` : '';
      const counterAction = reaction.counterAction ? ` La misura annunciata è: ${reaction.counterAction}.` : '';
      return `• ${reaction.polityName} si dichiara ${stanceLabels[reaction.stance] || reaction.stance}: ${reaction.response}${priority}${counterAction}`;
    });
    return `${base}${base ? '\n\n' : ''}Reazioni internazionali:\n${reactions.join('\n')}`;
  }

  /** Ogni reazione strutturata diventa anche un messaggio diplomatico reale. */
  private reactionChatStarts(events: SimulationEvent[], pruneIrrelevant = false): SimulationChatStart[] {
    const resolver = pruneIrrelevant ? this.buildResolvers().polities : null;
    const actionTexts = pruneIrrelevant ? this.actions.slice(-10).map(action => action.text) : [];
    return events.flatMap(event => {
      const relevant = pruneIrrelevant
        ? this.crisisRelevantPolityIds([event.headline, event.description, ...actionTexts])
        : null;
      return (event.reactions || []).flatMap(reaction => {
        if (relevant && resolver) {
          const resolution = resolver.resolve(reaction.polityName);
          if (!resolution || resolution.isNew || !relevant.has(resolution.polityId)) return [];
        }
        return [{
          polityName: reaction.polityName,
          participants: [reaction.polityName],
          topic: [reaction.response, reaction.counterAction ? `Misura annunciata: ${reaction.counterAction}` : '']
            .filter(Boolean).join(' '),
          kind: 'statement' as const,
          eventHeadline: event.headline,
        }];
      });
    });
  }

  /**
   * Trasforma le aperture diplomatiche strutturate della simulazione in chat
   * dirette o riunioni di gruppo. Nei salti automatici accetta esclusivamente
   * aperture collegate per titolo a un evento realmente applicato: una chat
   * riferita a un futuro scartato non può attraversare il checkpoint.
   */
  private openSimulationChats(
    starts: SimulationChatStart[] | undefined,
    options: {
      turn: number;
      fallbackDate: string;
      simulationId?: string;
      events?: Array<{ headline: string; date: string }>;
      requireEventLink?: boolean;
    },
  ): {
    timelineEvents: TimelineEventRecord[];
    broadcasts: Array<Record<string, unknown>>;
    participantPolityIds: Set<string>;
  } {
    const timelineEvents: TimelineEventRecord[] = [];
    const broadcasts: Array<Record<string, unknown>> = [];
    const participantPolityIds = new Set<string>();
    const eventByHeadline = new Map(
      (options.events || []).map(event => [event.headline.trim().toLocaleLowerCase('it'), event] as const),
    );
    const opened = new Set<string>();
    const resolver = this.buildResolvers().polities;

    for (const start of starts || []) {
      const eventHeadline = (start.eventHeadline || '').trim();
      const linkedEvent = eventHeadline
        ? eventByHeadline.get(eventHeadline.toLocaleLowerCase('it'))
        : undefined;
      if (options.requireEventLink && !linkedEvent) {
        console.warn('[GameSession] startChat ignorata: evento causale non applicato:', eventHeadline || '(mancante)');
        continue;
      }

      const requestedNames = [...(Array.isArray(start.participants) ? start.participants : [])];
      if (start.polityName && !requestedNames.some(name =>
        name.toLocaleLowerCase('it') === start.polityName!.toLocaleLowerCase('it'))) {
        requestedNames.unshift(start.polityName);
      }
      const validPolityIds: string[] = [];
      for (const rawName of requestedNames) {
        const resolution = resolver.resolve(String(rawName || '').trim());
        if (!resolution || resolution.isNew || resolution.polityId === 'neutral'
            || resolution.polityId === this.playerPolityId
            || validPolityIds.includes(resolution.polityId)) continue;
        validPolityIds.push(resolution.polityId);
        if (validPolityIds.length >= 8) break;
      }
      if (validPolityIds.length === 0) {
        console.warn('[GameSession] startChat ignorata: nessuna politia partecipante valida');
        continue;
      }
      // Crisi locali: una potenza lontana senza interesse documentato non
      // entra in una riunione né in una nota di comodo. Il filtro agisce solo
      // quando il mondo offre dati di adiacenza reali, così non svuota i mondi
      // senza confini registrati (fixture e test).
      if (this.hasGeographicAdjacency()) {
        const relevant = this.crisisRelevantPolityIds([linkedEvent?.headline || '']);
        const kept = validPolityIds.filter(id => relevant.has(id));
        if (kept.length === 0) {
          console.warn('[GameSession] startChat ignorata: partecipanti fuori dal teatro della crisi:', requestedNames.join(', '));
          continue;
        }
        if (kept.length < validPolityIds.length) {
          validPolityIds.length = 0;
          validPolityIds.push(...kept);
        }
      }

      const duplicateKey = [
        [...validPolityIds].sort().join('|'),
        eventHeadline.toLocaleLowerCase('it'),
      ].join('::');
      if (opened.has(duplicateKey)) continue;
      opened.add(duplicateKey);

      try {
        const chat = this.ensureChat(validPolityIds);
        const initiatorId = validPolityIds[0];
        const sender = chat.participants.find(p => p.id === initiatorId && p.role === 'polity')
          || chat.participants.find(p => p.role === 'polity');
        if (!sender) continue;
        const gameDate = linkedEvent?.date || options.fallbackDate;
        const topic = this.publicText(start.topic) || 'Desideriamo discutere gli ultimi sviluppi.';
        const firstMessage = chatRepository.addMessage(
          chat.id, 'polity', topic, options.turn, sender.name, gameDate,
        );
        const group = validPolityIds.length > 1;
        const openingByKind: Record<string, string> = {
          meeting: group ? 'convoca una riunione multilaterale' : 'chiede una riunione',
          summit: 'propone un vertice',
          negotiation: 'avvia un negoziato',
          conference: 'convoca una conferenza',
          ultimatum: 'apre un confronto su un ultimatum',
          technical: 'propone un tavolo tecnico',
          statement: 'invia una nota diplomatica',
        };
        const kind = start.kind || (group ? 'meeting' : 'negotiation');
        // Il canale contiene sempre anche il giocatore (serve a leggere e
        // rispondere), ma il dispaccio non deve far apparire la sua nazione
        // in un incontro fra terzi: elenchiamo solo i partecipanti NPC
        // realmente convocati.
        const npcParticipantNames = validPolityIds
          .map(id => this.publicPolityName(id))
          .filter((name): name is string => !!name && name !== this.publicPolityName(this.playerPolityId));
        const participantsText = group && npcParticipantNames.length > 0
          ? `Alla riunione prendono parte ${npcParticipantNames.join(', ')}. `
          : '';
        timelineEvents.push({
          id: `chat-${firstMessage.id}`,
          date: gameDate,
          headline: `${sender.name} ${openingByKind[kind] || openingByKind.negotiation}`,
          detail: `${eventHeadline ? `In seguito a «${this.publicText(eventHeadline)}». ` : ''}${participantsText}${sender.name} dichiara: ${firstMessage.content}`,
          source: 'diplomacy',
          simulationId: options.simulationId,
          chatId: chat.id,
          speakerName: sender.name,
        });
        broadcasts.push({
          chatId: chat.id,
          polityId: chat.polityId,
          polityName: chat.polityName,
          participants: chat.participants,
          senderName: sender.name,
          meetingKind: kind,
          eventHeadline: eventHeadline || undefined,
          message: firstMessage,
        });
        validPolityIds.forEach(id => participantPolityIds.add(id));
      } catch (error) {
        console.warn('[GameSession] startChat: impossibile aprire il canale diplomatico:', requestedNames, error);
      }
    }

    return { timelineEvents, broadcasts, participantPolityIds };
  }

  /**
   * Invia un messaggio del giocatore: salva il messaggio, chiede all'LLM
   * (meccanica 'chat') CHI risponde e COSA, salva la replica e la broadcasta.
   */
  async sendChatMessage(chatId: string, content: string): Promise<{ message: ChatMessageRecord; reply: ChatMessageRecord }> {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.id) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    // F04 passo 3: durante un run la chat risponde 409 — nessuna scrittura
    // nel contesto già congelato (politica esplicita, non bozza silenziosa).
    if (this.hasActiveRun()) throw new SimulationInProgressError();
    const fence = this.fenceContext();

    // Cronaca PRIMA del nuovo messaggio del giocatore
    const history = chatRepository.getMessages(chatId)
      .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));

    const player = this.players[0];
    const message = chatRepository.addMessage(
      chatId,
      'player',
      content.trim(),
      this.currentTurn,
      this.publicPolityName(this.playerPolityId),
      this.currentDate,
    );

    const reply = await this.generateChatReply(chat, history, content, 'reply', fence);
    return { message, reply };
  }

  /**
   * «Lascia che parlino»: le nazioni della chat proseguono la trattativa tra
   * loro per un numero limitato di repliche, senza intervento del giocatore.
   */
  async continueChat(chatId: string, exchanges: number = 2): Promise<{ replies: ChatMessageRecord[] }> {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.id) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const replies: ChatMessageRecord[] = [];
    const rounds = Math.max(1, Math.min(exchanges, 4));
    const fence = this.fenceContext();
    for (let i = 0; i < rounds; i++) {
      const history = chatRepository.getMessages(chatId)
        .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));
      const reply = await this.generateChatReply(chat, history, '', 'auto', fence);
      replies.push(reply);
    }
    return { replies };
  }

  /**
   * Chiama l'LLM per la prossima battuta della chat (reply o auto), la salva
   * e la broadcasta via SSE.
   */
  private async generateChatReply(
    chat: ChatRecord,
    history: { role: string; content: string }[],
    playerMessage: string,
    mode: 'reply' | 'auto' | 'reaction',
    fence?: { branchId: string | null; revision: number },
  ): Promise<ChatMessageRecord> {
    const polityParticipants = chat.participants.filter(
      p => p.role !== 'player' && p.id !== this.playerPolityId
    );
    if (polityParticipants.length === 0) {
      polityParticipants.push({
        id: chat.polityId,
        name: chat.polityName,
        color: chat.polityColor,
        role: 'polity',
      });
    }

    const participantsVars = this.chatParticipantVarsFor(chat);

    let speakerName = participantsVars[0].name;
    if (participantsVars.length > 1) {
      const nextSpeakerPrompt = buildNextSpeakerPrompt({
        playerPolityName: this.publicPolityName(this.playerPolityId),
        participantNames: participantsVars.map(p => p.name),
        history,
        playerMessage,
        mode: mode === 'reaction' ? 'auto' : mode,
      });
      try {
        const selection = await this.llm.generate(
          'chat',
          'Seleziona il prossimo interlocutore diplomatico. Rispondi soltanto con JSON {"speaker"}.',
          nextSpeakerPrompt,
          { temperature: 0.15, maxTokens: 120 },
        );
        speakerName = parseNextSpeakerResponse(
          selection.content,
          participantsVars.map(p => p.name),
          speakerName,
        );
      } catch (error) {
        // La selezione è ausiliaria: se un modello free la salta, il primo
        // partecipante valido può comunque rispondere senza perdere la chat.
        console.warn('[GameSession] Selezione interlocutore non disponibile; uso il fallback canonico:', error);
      }
    }
    const respondingParticipant = participantsVars.find(p => p.name === speakerName) || participantsVars[0];
    const recentEvents = this.results
      .slice(-3)
      .flatMap(result => result.timelineEvents?.map(event => event.headline) || result.events)
      .slice(-8);
    const prompt = buildChatPrompt({
      playerPolityName: this.publicPolityName(this.playerPolityId),
      participants: participantsVars,
      respondingParticipant,
      worldContext: this.worldBasePrompt || 'Storia alternativa',
      simulationRules: this.worldSimulationRules || '',
      mapContext: this.buildChatMapContext(),
      difficultyContext: difficultyPromptBlock(this.difficulty),
      date: this.currentDate,
      recentEvents,
      history,
      playerMessage,
      mode,
    });

    const response = await this.llm.generate(
      'chat',
      `Interpreta ${speakerName} in una trattativa storica. Rispondi in italiano e SOLO con JSON {"message"}.`,
      prompt,
      { temperature: 0.7 },
    );
    const parsed = parseChatResponse(response.content);
    // F04 passo 3: verifica del fence PRIMA della scrittura — una risposta
    // tardiva (run partito, restore con ramo nuovo, revisione cambiata) non
    // muta il ramo nuovo né broadcasta nulla.
    if (fence) this.assertFenceValid(fence);
    const reply = chatRepository.addMessage(
      chat.id,
      'polity',
      parsed.message,
      this.currentTurn,
      speakerName,
      this.currentDate,
    );

    this.broadcast('chat_message', {
      chatId: chat.id,
      polityId: chat.polityId,
      polityName: chat.polityName,
      participants: chat.participants,
      senderName: speakerName,
      message: reply,
    });

    return reply;
  }

  /**
   * Variabili prompt dei partecipanti NPC di una chat: stato materiale
   * (regioni, popolazione, PIL, forza) + personalità. Condivisa da repliche
   * normali e reazioni automatiche agli ordini.
   */
  private chatParticipantVarsFor(chat: ChatRecord) {
    const polityParticipants = chat.participants.filter(
      p => p.role !== 'player' && p.id !== this.playerPolityId
    );
    if (polityParticipants.length === 0) {
      polityParticipants.push({
        id: chat.polityId,
        name: chat.polityName,
        color: chat.polityColor,
        role: 'polity',
      });
    }
    return polityParticipants.map(p => {
      const owned = Array.from(this.regions.values()).filter(r => r.owner === p.id);
      const population = owned.reduce((sum, r) => sum + (r.population || 0), 0);
      const gdp = owned.reduce((sum, r) => sum + (r.gdp || 0), 0);
      const military = owned.reduce((sum, r) => sum + (r.militaryPower || 0), 0);
      const ownedAccounts = WorldStateEngine.accounts(owned);
      const effectiveMilitary = this.nationalEffectiveMilitaryPower(p.id, ownedAccounts);
      const relationship = this.relationships.get(p.id, this.playerPolityId);
      const profile = strategicProfileForPolity(p.id);
      const hostileNeighbours = this.hostileNeighbourCount(p.id);
      const allRelations = [...new Set(Array.from(this.regions.values()).map(region => region.owner))]
        .filter(owner => owner && owner !== 'neutral' && owner !== p.id)
        .map(owner => this.relationships.get(p.id, owner));
      const priorities = currentStrategicPriorities(profile, {
        relationshipToPlayer: relationship,
        hostileNeighbours,
        hostileActors: allRelations.filter(value => value === 'hostile').length,
        alliedActors: allRelations.filter(value => value === 'ally').length,
        militaryPower: effectiveMilitary,
        playerMilitaryPower: this.nationalEffectiveMilitaryPower(this.playerPolityId, ownedAccounts),
        monthlyBalance: ownedAccounts[p.id]?.monthlyBalance,
        stability: ownedAccounts[p.id]?.stability,
      });
      const memory = this.recentStrategicMemory(p.id, 2);
      return {
        name: p.name,
        relationship,
        personality: `${profile.personality}; dottrina ${profile.doctrine}; stile ${profile.negotiationStyle}; propensione alla forza ${Math.round(profile.aggression * 100)}%; rischio ${profile.riskTolerance}/100; affidabilità verso impegni registrati ${profile.allianceReliability}/100`,
        interests: `priorità: ${priorities.join('; ')}; linee rosse: ${profile.redLines.join('; ')}; capacità: ${owned.length} regioni, popolazione ${population}, PIL ${gdp}, potenza militare effettiva ${effectiveMilitary} (nominale ${military}); memoria recente: ${memory.length ? memory.join(' | ') : 'nessun precedente specifico registrato'}`,
      };
    });
  }

  /** Risposta minima e prudente quando il modello free non produce una nota.
   * Non concede, rifiuta o inventa contromisure: rende visibile che la
   * controparte ha ricevuto l'iniziativa e conserva la propria priorità. */
  private persistNpcReactionFallback(
    polityId: string,
    input: { turn?: number; date?: string },
  ): void {
    try {
      const owned = Array.from(this.regions.values()).filter(region => region.owner === polityId);
      if (!owned.length) return;
      const displayName = this.publicPolityName(polityId);
      const profile = strategicProfileForPolity(polityId);
      const priority = currentStrategicPriorities(profile, {
        relationshipToPlayer: this.relationships.get(polityId, this.playerPolityId),
        hostileNeighbours: this.hostileNeighbourCount(polityId),
        militaryPower: this.nationalEffectiveMilitaryPower(polityId),
        playerMilitaryPower: this.nationalEffectiveMilitaryPower(this.playerPolityId),
      })[0] || profile.baselinePriorities[0];
      const chat = this.ensureChat([displayName]);
      const sender = chat.participants.find(participant => participant.role === 'polity')?.name || chat.polityName;
      const content = `${sender} prende formalmente atto degli sviluppi comunicati. Non considera concluso alcun accordo e non assume nuovi impegni senza una decisione verificabile; valuterà i prossimi passi secondo la priorità «${priority}».`;
      const reply = chatRepository.addMessage(
        chat.id, 'polity', content, input.turn ?? this.currentTurn, sender, input.date || this.currentDate,
      );
      this.broadcast('chat_message', {
        chatId: chat.id,
        polityId: chat.polityId,
        polityName: chat.polityName,
        participants: chat.participants,
        senderName: sender,
        message: reply,
        reaction: true,
        degraded: true,
      });
    } catch (error) {
      console.warn('[GameSession] Anche il fallback di reazione NPC è fallito:', polityId, error);
    }
  }

  /**
   * Reazioni diplomatiche automatiche agli ordini del giocatore.
   *
   * Dopo un turno con ordini, le politie NPC direttamente interessate
   * (cambi di relazione, trasferimenti territoriali, oppure un vicino
   * ostile come fallback) prendono posizione con un messaggio ufficiale
   * nella chat diplomatica: la nota è persistita e broadcastata via SSE
   * (badge «Diplomazia» + cronaca), così l'ordine produce non solo notizie
   * ma anche reazioni visibili.
   *
   * Fire-and-forget: il turno è già committato; un errore LLM non lo tocca.
   * Limite fallback: massimo 4 reazioni per turno (solo controparti riconosciute).
   */
  async generateNpcReactions(input: {
    actionTexts: string[];
    eventHeadlines: string[];
    candidatePolityIds: string[];
    turn?: number;
    date?: string;
  }): Promise<void> {
    if (input.actionTexts.length === 0 && input.eventHeadlines.length === 0) return;
    const candidates = input.candidatePolityIds
      .filter(id => id && id !== this.playerPolityId && id !== 'neutral')
      .filter((id, index, all) => all.indexOf(id) === index)
      .filter(id => Array.from(this.regions.values()).some(r => r.owner === id))
      .slice(0, 4);
    if (candidates.length === 0) return;

    const playerPolityName = this.publicPolityName(this.playerPolityId);
    const reactionBrief = [
      input.actionTexts.length > 0
        ? `Ordini resi pubblici da ${playerPolityName} in questo turno: ${input.actionTexts.join(' | ')}`
        : '',
      input.eventHeadlines.length > 0
        ? `Eventi del periodo: ${input.eventHeadlines.slice(0, 8).join('; ')}`
        : '',
    ].filter(Boolean).join('\n');

    for (const polityId of candidates) {
      try {
        const owned = Array.from(this.regions.values()).filter(r => r.owner === polityId);
        if (owned.length === 0) continue;
        // Stessa convenzione di ensureChat: nome nazionale dal registro ISO
        // per i mondi provinciali, nome della regione per le politie singole.
        const displayName = this.publicPolityName(polityId);
        const chat = this.ensureChat([displayName]);
        const sender = chat.participants.find(p => p.role === 'polity')?.name || chat.polityName;
        const history = chatRepository.getMessages(chat.id)
          .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));
        const participantsVars = this.chatParticipantVarsFor(chat);
        const responding = participantsVars.find(p => p.name === sender) || participantsVars[0];
        if (!responding) continue;

        const prompt = buildChatPrompt({
          playerPolityName,
          participants: participantsVars,
          respondingParticipant: responding,
          worldContext: this.worldBasePrompt || 'Storia alternativa',
          simulationRules: this.worldSimulationRules || '',
          mapContext: this.buildChatMapContext(),
          difficultyContext: difficultyPromptBlock(this.difficulty),
          date: input.date || this.currentDate,
          recentEvents: input.eventHeadlines.slice(0, 8),
          history,
          playerMessage: reactionBrief,
          mode: 'reaction',
        });
        const response = await this.llm.generate(
          'chat',
          `Interpreta ${sender} in una trattativa storica. Rispondi in italiano e SOLO con JSON {"message"}.`,
          prompt,
          { temperature: 0.7 },
        );
        const parsed = parseChatResponse(response.content);
        const reply = chatRepository.addMessage(
          chat.id,
          'polity',
          parsed.message,
          input.turn ?? this.currentTurn,
          sender,
          input.date || this.currentDate,
        );
        this.broadcast('chat_message', {
          chatId: chat.id,
          polityId: chat.polityId,
          polityName: chat.polityName,
          participants: chat.participants,
          senderName: sender,
          message: reply,
          reaction: true,
        });
        console.log('[GameSession] NPC reaction generated by', sender);
      } catch (e) {
        console.warn('[GameSession] NPC reaction failed for', polityId, e);
        this.persistNpcReactionFallback(polityId, input);
      }
    }
  }


  /** Descrizione compatta della mappa per il prompt: «Politia: regione1, regione2». */
  private buildChatMapContext(): string {
    const byOwner = new Map<string, RegionState[]>();
    for (const region of this.regions.values()) {
      if (region.owner === 'neutral') continue;
      if (!byOwner.has(region.owner)) byOwner.set(region.owner, []);
      byOwner.get(region.owner)!.push(region);
    }
    const lines: string[] = [];
    for (const regions of byOwner.values()) {
      lines.push(`${regions[0].name}: ${regions.map(r => r.name).join(', ')}`);
    }
    return lines.join('\n');
  }

  /** Trascritti delle chat recenti per il prompt di simulazione (le trattative contano). */
  private buildChatTranscripts(): string {
    const chats = chatRepository.getChatsByGame(this.id).slice(0, 3);
    const parts: string[] = [];

    for (const chat of chats) {
      const messages = chatRepository.getMessages(chat.id).slice(-15);
      if (messages.length === 0) continue;
      const lines = messages.map(m =>
        m.role === 'player' ? `${this.publicPolityName(this.playerPolityId)}: ${m.content}` : `${m.senderName || chat.polityName}: ${m.content}`
      );
      parts.push(`[Trattative con ${chat.polityName}]\n${lines.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Initialize session from existing world data
   */
  async initialize(playerRegionId: string, playerName: string, playerColor: string = '#FF0000', difficulty?: string): Promise<string> {
    // Load world from DB
    const world = worldRepository.findById(this.worldId);
    if (!world) throw new Error('World not found');

    // Cache world metadata for prompts (bug fix: lore never reached the LLM)
    this.worldName = world.name || '';
    this.worldBasePrompt = world.base_prompt || '';
    this.worldStartDate = world.start_date || '1951-01-01';
    this.worldSimulationRules = world.simulation_rules || undefined;
    this.difficulty = normalizeDifficulty(difficulty);

    // Load all regions into session state
    for (const region of world.regions) {
      this.regions.set(region.id, {
        id: region.id,
        name: region.name,
        color: region.color,
        owner: region.owner,
        population: region.population,
        gdp: region.gdp,
        militaryPower: region.militaryPower,
        objects: region.objects || [],
        svgPath: region.svgPath,
        borders: region.borders,
        status: (region.status || 'active') as 'active' | 'occupied' | 'destroyed' | 'independent',
      });
    }

    // Create player. Player's polity = owner of the chosen region
    // (unified polity-id convention: country code for templates).
    const playerPolityId = this.regions.get(playerRegionId)?.owner || 'player';
    this.playerPolityId = playerPolityId;
    const playerId = shortId();
    this.players = [{
      id: playerId,
      name: playerName,
      regionId: playerRegionId,
      color: playerColor,
      polityId: playerPolityId,
    }];

    // Initialize session-specific game controller
    this.gameController.initPromptEngine(this.buildGameData());
    this.gameController.setupWorld(world.base_prompt);
    // Il magazzino di ogni nazione nasce qui, dai suoi dati di partenza reali.
    this.seedInitialResources();

    // Setup NPC agents: NPC = una POLITIA (paese), non ogni regione.
    // Nei mondi provinciali un paese possiede più province — un agente per
    // provincia moltiplicherebbe le chiamate LLM (700+ a turno). Raggruppiamo
    // per owner: l'agente della politia parte dalla sua regione più popolosa.
    const regionsByOwner = new Map<string, RegionState>();
    for (const r of this.regions.values()) {
      if (r.owner === 'neutral' || r.owner === this.playerPolityId) continue;
      const current = regionsByOwner.get(r.owner);
      if (!current || r.population > current.population) {
        regionsByOwner.set(r.owner, r);
      }
    }
    const regionConfigs = Array.from(regionsByOwner.values())
      .map(r => ({ id: r.id, name: r.name, owner: r.owner }));
    this.gameController.setupNPCCountries(regionConfigs);

    // Ogni partita riceve una copia iniziale del baseline diplomatico, poi
    // muta solo game_relationships e mai il preset/world condiviso.
    let rels = relationshipRepository.getForGame(this.id);
    if (!rels.length) {
      rels = relationshipRepository.getForWorld(this.worldId);
      relationshipRepository.replaceForGame(this.id, rels);
    }
    for (const rel of rels) {
      this.relationships.set(rel.from, rel.to, rel.type);
    }

    this.currentDate = world.start_date || '1951-01-01';

    // Sync all regions to DB on init (ensure baseline is persisted)
    await this.syncRegionsToDB();

    // Persistenza immediata della data di inizio (schema legacy: la riga
    // games nasce con current_date = oggi/1951 — senza update l'API
    // mostrerebbe la data sbagliata fino alla prima mossa)
    gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);

    return playerId;
  }

  /**
   * Reconstruct session from DB state (used when loading from DB)
   * Fully restores session including game controller for AI to work
   */
  reconstructFromDB(data: {
    currentTurn: number;
    currentDate: string;
    players: PlayerInfo[];
    regionStates?: [string, RegionState][];
    basePrompt?: string;
    difficulty?: string;
    consolidatedHistory?: string;
    consolidatedUpTo?: number;
  }): void {
    this.currentTurn = data.currentTurn;
    this.currentDate = data.currentDate;
    this.players = data.players || [];
    this.difficulty = normalizeDifficulty(data.difficulty);
    this.consolidatedHistory = data.consolidatedHistory || '';
    this.consolidatedUpTo = data.consolidatedUpTo || 0;

    // Cache world metadata for prompts BEFORE buildGameData runs below
    // (bug fix: lore never reached the LLM because buildGameData sent basePrompt: '').
    const world = worldRepository.findById(this.worldId);
    this.worldName = world?.name || '';
    this.worldBasePrompt = data.basePrompt || world?.base_prompt || '';
    this.worldStartDate = world?.start_date || '';
    this.worldSimulationRules = world?.simulation_rules || undefined;

    // Restore player's polity (persisted in players.polity_id; fallback —
    // owner of the home region for legacy rows).
    const primaryPlayer = this.players[0];
    this.playerPolityId =
      primaryPlayer?.polityId ||
      (primaryPlayer ? this.regions.get(primaryPlayer.regionId)?.owner : undefined) ||
      'player';

    // If region states provided (from save), use them
    if (data.regionStates) {
      this.regions = new Map(data.regionStates);
    } else {
      // Geometria/metadati dal world, stato dinamico dalla copia isolata del
      // game. Le partite legacy senza copia ricevono il baseline al primo sync.
      const gameRegions = new Map(gameRepository.getGameRegions(this.id).map(region => [region.id, region]));
      const dbRegions = worldRepository.getRegions(this.worldId);
      for (const region of dbRegions) {
        const state = gameRegions.get(region.id);
        this.regions.set(region.id, {
          id: region.id,
          name: region.name,
          color: state?.color || region.color,
          owner: state?.owner || region.owner,
          population: state?.population ?? region.population,
          gdp: state?.gdp ?? region.gdp,
          militaryPower: state?.militaryPower ?? region.militaryPower,
          objects: state?.objects || region.objects || [],
          svgPath: region.svgPath,
          borders: region.borders,
          status: (region.status || 'active') as 'active' | 'occupied' | 'destroyed' | 'independent',
        });
      }
      if (!gameRegions.size) this.syncRegionsToDB();
    }

    // Re-initialize game controller with current state
    this.gameController.initPromptEngine(this.buildGameData());

    this.gameController.setupWorld(this.worldBasePrompt);
    // Ricostruzione: crea i magazzini mancanti dai dati iniziali del mondo.
    this.seedInitialResources();

    // Sessioni legacy ricevono il baseline solo se non possiedono ancora
    // relazioni isolate; in seguito il DB della partita è la fonte di verità.
    let rels = relationshipRepository.getForGame(this.id);
    if (!rels.length) {
      rels = relationshipRepository.getForWorld(this.worldId);
      relationshipRepository.replaceForGame(this.id, rels);
    }
    for (const rel of rels) {
      this.relationships.set(rel.from, rel.to, rel.type);
    }

    // Cronaca dei turni (Timeline) e ordini futuri: ricaricati dal DB alla
    // ricostruzione, così un riavvio non elimina la coda del giocatore.
    this.results = gameRepository.getResultsByGame(this.id);
    this.pendingActions = gameRepository.getPendingActions(this.id) as PendingAction[];
    // §9.3: il playback in pausa attraversa il riavvio. Gli ordini presi in
    // carico dal run sospeso restano «processing» e non sono reinviati.
    const paused = gameRepository.getPausedSimulationRun(this.id);
    this.pausedRun = paused ? this._revivePausedRunFromRow(paused) : null;
    const pausedActionIds = new Set(this.pausedRun?.batchActionIds || []);
    // Un processo LLM non può attraversare un restart: gli eventuali record
    // rimasti "processing" sono ritentabili nel nuovo processo — salvo quelli
    // di un run scaglionato che attende ancora la conferma del giocatore.
    gameRepository.updatePendingActionStatus(
      this.id,
      this.pendingActions.map(action => action.id).filter(id => !pausedActionIds.has(id)),
      'pending',
    );
    // Dopo crash un run non in pausa non conserva una claim tecnica: torna
    // queued/not_started sia in DB sia nella proiezione RAM. Il playback
    // durevole, invece, mantiene issued/in_progress e non viene reinviato.
    this.pendingActions.forEach(action => {
      if (pausedActionIds.has(action.id)) {
        action.status = 'processing';
        action.deliveryStatus = 'issued';
        action.executionStatus = 'in_progress';
      } else {
        action.status = 'pending';
        action.deliveryStatus = 'queued';
        action.executionStatus = 'not_started';
      }
    });

    // Re-setup NPC countries: любая полития, кроме игрока и 'neutral'
    const regionConfigs = Array.from(this.regions.values())
      .filter(r => r.owner !== 'neutral' && r.owner !== this.playerPolityId)
      .map(r => ({ id: r.id, name: r.name, owner: r.owner }));
    this.gameController.setupNPCCountries(regionConfigs);

    console.log('[GameSession] Reconstructed session from DB, turn:', this.currentTurn);
  }

  /**
   * Get region by ID
   */
  getRegion(regionId: string): RegionState | undefined {
    return this.regions.get(regionId);
  }

  /**
   * Get all regions
   */
  getAllRegions(): RegionState[] {
    return Array.from(this.regions.values());
  }

  /**
   * Get player info
   */
  getPlayer(): PlayerInfo | undefined {
    return this.players[0];
  }

  /**
   * Get current turn
   */
  getCurrentTurn(): number {
    return this.currentTurn;
  }

  /**
   * Get current date
   */
  getCurrentDate(): string {
    return this.currentDate;
  }

  /**
   * Get game status
   */
  getStatus(): string {
    return this.status;
  }

  /**
   * Get game results history
   */
  getResults(): TurnResultRecord[] {
    return this.results;
  }

  /**
   * Timeline del mondo: eventi strutturati della simulazione più passaggi
   * diplomatici significativi (accordi, rifiuti, ultimatum e chat avviate
   * dalle nazioni). I vecchi risultati vengono convertiti senza perdere dati.
   */
  getTimeline(): { turn: number; date: string; events: TimelineEventRecord[]; narration: string }[] {
    return this._buildTimelineEntries(this.results);
  }

  /**
   * Pagina la cronaca persistita dal DB (§10.1). `afterTurn` è il cursore
   * (turno da cui continuare); `limit` è la dimensione della pagina. Restituisce
   * `hasMore` e `nextAfter` per il recupero progressivo, così il registro non
   * è limitato irreversibilmente ai turni in memoria o agli ultimi N eventi.
   */
  getTimelinePage(afterTurn: number, limit: number): {
    timeline: { turn: number; date: string; events: TimelineEventRecord[]; narration: string }[];
    hasMore: boolean;
    nextAfter: number;
  } {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;
    const safeAfter = Number.isFinite(afterTurn) && afterTurn >= 0 ? Math.floor(afterTurn) : 0;
    const { rows, hasMore } = gameRepository.getTimelinePage(this.id, safeAfter, safeLimit);
    const timeline = this._buildTimelineEntries(rows);
    const last = timeline.at(-1);
    return { timeline, hasMore, nextAfter: last ? last.turn : safeAfter };
  }

  private _buildTimelineEntries(results: { id: string; turn: number; date?: string; events?: string[]; timelineEvents?: TimelineEventRecord[]; narration?: string; simulationId?: string }[]): {
    turn: number; date: string; events: TimelineEventRecord[]; narration: string
  }[] {
    const entries: { turn: number; date: string; events: TimelineEventRecord[]; narration: string }[] = results.map(r => ({
      turn: r.turn,
      date: r.date || '',
      events: r.timelineEvents?.length
        ? r.timelineEvents.map(event => ({
            ...event,
            headline: this.publicText(event.headline),
            detail: this.publicText(event.detail),
          }))
        : (r.events || []).map((headline, index) => ({
            id: `${r.id}-${index}`,
            date: r.date || '',
            headline: this.publicText(headline),
            detail: this.publicText(r.narration),
            source: 'world' as const,
            simulationId: r.simulationId,
          })),
      narration: this.publicText(r.narration),
    }));
    // I messaggi delle chat restano nel loro thread. La timeline riceve solo
    // eventi diplomatici esplicitamente committati dal simulatore (apertura
    // causale di chat o relationshipChanges), mai euristiche su parole come
    // "trattato" o "guerra" in una conversazione.
    for (const entry of entries) {
      entry.events.sort((a, b) => (a.date || entry.date).localeCompare(b.date || entry.date));
    }
    return entries.sort((a, b) => a.turn - b.turn || a.date.localeCompare(b.date));
  }

  /**
   * Build name resolvers from the current region state.
   * "ИИ по именам, движок по id": LLM видит только имена, движок резолвит их
   * обратно в regionId/polityId (bug fix: раньше LLM просили вернуть regionId,
   * который он никогда не видел, поэтому mapChanges почти никогда не применялись).
   */
  private buildResolvers(): { regions: RegionResolver; polities: PolityResolver } {
    const all = Array.from(this.regions.values());
    const polityAliases: Record<string, string[]> = {};
    for (const owner of new Set(all.map(region => region.owner))) {
      if (!owner || owner === 'neutral') continue;
      const registeredName = countryRepository.findByCode(owner)?.name;
      polityAliases[owner] = [
        registeredName,
        polityDisplayNameIt(owner, registeredName),
      ].filter((name): name is string => !!name);
    }
    return {
      regions: new RegionResolver(all),
      polities: new PolityResolver(all, this.playerPolityId, polityAliases),
    };
  }

  /**
   * Individua le politie nominate esplicitamente in ordini e dispacci. È il
   * fallback deterministico quando un provider omette il campo reactions:
   * almeno le controparti riconoscibili ricevono una presa di posizione in chat.
   */
  private mentionedNpcPolityIds(texts: string[]): string[] {
    const owners = [...new Set(Array.from(this.regions.values()).map(region => region.owner))]
      .filter(owner => owner && owner !== 'neutral' && owner !== this.playerPolityId);
    const found: string[] = [];
    for (const text of texts) {
      const normalizedText = ` ${normalizeName(text)} `;
      for (const owner of owners) {
        if (found.includes(owner)) continue;
        const registeredName = countryRepository.findByCode(owner)?.name;
        const aliases = [
          registeredName,
          polityDisplayNameIt(owner, registeredName),
          ...Array.from(this.regions.values()).filter(region => region.owner === owner).map(region => region.name),
        ]
          .filter((name): name is string => !!name)
          .map(normalizeName)
          .filter(alias => alias.length >= 3);
        const words = normalizedText.trim().split(/\s+/);
        const named = aliases.some(alias =>
          normalizedText.includes(` ${alias} `)
          || (!alias.includes(' ') && alias.length >= 5 && words.some(word => word.startsWith(alias)))
          // Forme aggettivali italiane ("cecoslovacca", "botswane"): radice condivisa.
          || (!alias.includes(' ') && alias.length >= 6
            && words.some(word => word.length >= 6 && word.startsWith(alias.slice(0, 6))))
        );
        const escapedOwner = owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const coded = new RegExp(`(^|[^A-Z])${escapedOwner}([^A-Z]|$)`).test(text);
        if (named || coded) found.push(owner);
      }
    }
    return found;
  }

  /** Vicini geografici (proprietari dei territori confinanti) di una politia. */
  private frontierOwnerIds(polityId: string, cache?: Map<string, Set<string>>): Set<string> {
    const cached = cache?.get(polityId);
    if (cached) return cached;
    const owners = new Set<string>();
    for (const region of this.regions.values()) {
      if (region.owner !== polityId) continue;
      for (const borderId of region.borders || []) {
        const other = this.regions.get(borderId)?.owner;
        if (other && other !== 'neutral' && other !== polityId) owners.add(other);
      }
    }
    cache?.set(polityId, owners);
    return owners;
  }

  /** Il mondo fornisce informazioni di adiacenza? Se no, nessun filtro geografico è applicabile. */
  private hasGeographicAdjacency(): boolean {
    for (const region of this.regions.values()) {
      if ((region.borders || []).length > 0) return true;
    }
    return false;
  }

  /**
   * Politie pertinenti a una crisi: quelle nominate nei testi, i vicini
   * geografici del giocatore e dei soggetti in scena, e le politie con un
   * rapporto registrato. Esclude le potenze lontane senza interesse
   * documentato: una crisi di confine non deve generare note di comodo da
   * capitali irrilevanti. `seedPolityIds` espande soltanto la geografia e i
   * rapporti, non rende automaticamente pertinente chi lo propone.
   */
  private crisisRelevantPolityIds(texts: string[], seedPolityIds: string[] = []): Set<string> {
    const relevant = new Set<string>(this.mentionedNpcPolityIds(texts));
    const cache = new Map<string, Set<string>>();
    const seeds = [this.playerPolityId, ...seedPolityIds, ...relevant];
    for (const seed of seeds) {
      for (const neighbour of this.frontierOwnerIds(seed, cache)) {
        if (neighbour !== this.playerPolityId) relevant.add(neighbour);
      }
    }
    for (const region of this.regions.values()) {
      const owner = region.owner;
      if (!owner || owner === 'neutral' || owner === this.playerPolityId || relevant.has(owner)) continue;
      if (this.relationships.get(owner, this.playerPolityId) !== 'neutral') { relevant.add(owner); continue; }
      for (const seed of seeds) {
        if (this.relationships.get(owner, seed) !== 'neutral') { relevant.add(owner); break; }
      }
    }
    return relevant;
  }

  /** Regione di una politia dove collocare una misura materiale: quella
   * nominata nel testo, altrimenti la capitale, altrimenti la più popolosa. */
  private npcMeasureRegion(polityId: string, texts: string[]): RegionState | undefined {
    const owned = [...this.regions.values()]
      .filter(region => region.owner === polityId && region.status !== 'destroyed');
    if (owned.length === 0) return undefined;
    const normalized = texts.map(text => ` ${normalizeName(text)} `);
    const named = owned.find(region =>
      normalized.some(text => text.includes(` ${normalizeName(region.name)} `)));
    if (named) return named;
    const capital = owned.find(region =>
      (region.objects || []).some((object: any) => object.type === 'capital'));
    return capital || owned.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
  }

  /**
   * Riconosce una misura materiale avviata nel testo di una controazione NPC.
   * Conservativo: solo formulazioni inequivocabili di mobilitazione o cantiere.
   */
  private detectNpcMaterialMeasure(
    text: string,
  ): { type: MapChange['type']; featureType: MapFeature['type']; label: string } | null {
    const lower = text.toLowerCase();
    const rules: Array<{ re: RegExp; type: MapChange['type']; featureType: MapFeature['type']; label: string }> = [
      { re: /\b(flotta|navale|marina militare|squadra navale)/, type: 'start_mobilization', featureType: 'fleet', label: 'Flotta mobilitata' },
      { re: /\b(missil|batteria costiera)/, type: 'start_mobilization', featureType: 'missile', label: 'Batteria missilistica mobilitata' },
      { re: /\b(mobilit|reclut|richiam|leva|riserve)/, type: 'start_mobilization', featureType: 'battalion', label: 'Riserve mobilitate' },
      { re: /\b(base aerea|aeroporto|airbase)/, type: 'start_construction', featureType: 'airbase', label: 'Base aerea' },
      { re: /\b(base navale|porto militare|arsenale)/, type: 'start_construction', featureType: 'naval_base', label: 'Base navale' },
      { re: /\b(radar|sorveglianza aerea)/, type: 'start_construction', featureType: 'radar', label: 'Stazione radar' },
      { re: /\b(fortific|trince|bunker|linea difensiva)/, type: 'start_construction', featureType: 'fortification', label: 'Fortificazioni' },
      { re: /\b(universit)/, type: 'start_construction', featureType: 'university', label: 'Università' },
      { re: /\b(fabbrica|acciaieria|impianto industriale)/, type: 'start_construction', featureType: 'factory', label: 'Impianto industriale' },
      { re: /\b(ferrovia|strada|corridoio|infrastruttur|oleodotto)/, type: 'start_construction', featureType: 'infrastructure', label: 'Opera infrastrutturale' },
      { re: /\b(centrale (elettrica|energetica)|diga)/, type: 'start_construction', featureType: 'power_plant', label: 'Centrale elettrica' },
      { re: /\b(cantiere|costru|edifica)/, type: 'start_construction', featureType: 'base', label: 'Nuova opera' },
    ];
    for (const rule of rules) {
      if (rule.re.test(lower)) return { type: rule.type, featureType: rule.featureType, label: rule.label };
    }
    return null;
  }

  /**
   * Contratto mappa per gli NPC: se una controazione attestata avvia una
   * misura materiale (mobilitazione, cantieri, difese) e il modello ha
   * dimenticato la mapChange, il motore la materializza nel territorio della
   * politia, senza inventare nulla che il testo non affermi già.
   */
  private reconcileNpcMaterialMeasures(event: SimulationEvent): SimulationEvent {
    const reactions = event.reactions || [];
    if (reactions.length === 0) return event;
    const resolver = this.buildResolvers();
    const existing = event.mapChanges || [];
    const existingRegionIds = new Set<string>();
    for (const change of existing) {
      const key = change.regionName || change.regionId;
      if (!key) continue;
      const direct = this.regions.get(key);
      const resolved = direct || resolver.regions.resolve(key);
      const regionId = direct?.id || (resolved ? (this.regions.get(resolved.id)?.id) : undefined);
      if (regionId) existingRegionIds.add(regionId);
    }
    const additions: MapChange[] = [];
    for (const reaction of reactions) {
      const resolution = resolver.polities.resolve(reaction.polityName);
      if (!resolution || resolution.isNew || resolution.polityId === this.playerPolityId) continue;
      const text = `${reaction.response || ''} ${reaction.counterAction || ''}`;
      const measure = this.detectNpcMaterialMeasure(text);
      if (!measure) continue;
      const region = this.npcMeasureRegion(resolution.polityId, [text, event.headline, event.description]);
      if (!region || existingRegionIds.has(region.id)) continue;
      additions.push({
        type: measure.type,
        regionName: region.name,
        feature: { type: measure.featureType, name: `${measure.label} ${this.publicPolityName(resolution.polityId)}` },
      });
      existingRegionIds.add(region.id);
    }
    if (additions.length === 0) return event;
    return { ...event, mapChanges: [...existing, ...additions] };
  }

  private nationalMilitaryPower(polityId: string): number {
    return Array.from(this.regions.values())
      .filter(region => region.owner === polityId)
      .reduce((total, region) => total + (Number(region.militaryPower) || 0), 0);
  }

  /**
   * Potenza militare effettiva di una politia: potenza di mappa × fattore
   * dell'arsenale (qualità e copertura delle armi). Vale per il giocatore e per
   * tutte le nazioni NPC, così le decisioni dell'IA tengono conto dell'arsenale.
   */
  private nationalEffectiveMilitaryPower(polityId: string, accounts?: Record<string, NationalAccount>): number {
    const base = this.nationalMilitaryPower(polityId);
    const arsenal = this.arsenalUnits(polityId);
    const book = accounts || WorldStateEngine.accounts(this.regions.values());
    const forces = Number(book[polityId]?.forces || 0) + Number(book[polityId]?.mobilized || 0);
    return Math.round(base * arsenalCombatFactor(arsenal, forces) * 10) / 10;
  }

  private hostileNeighbourCount(polityId: string): number {
    const hostile = new Set<string>();
    for (const region of this.regions.values()) {
      if (region.owner !== polityId) continue;
      for (const borderId of region.borders || []) {
        const other = this.regions.get(borderId)?.owner;
        if (other && other !== polityId && other !== 'neutral'
            && this.relationships.get(polityId, other) === 'hostile') hostile.add(other);
      }
    }
    return hostile.size;
  }

  /**
   * Memoria strategica verificabile: recupera soltanto eventi canonici già
   * persistiti che nominano la politia. Nessun riassunto LLM separato può
   * quindi inventare un precedente o sopravvivere a un rewind illegittimo.
   */
  private recentStrategicMemory(polityId: string, limit = 3): string[] {
    const candidates: Array<{ date: string; turn: number; text: string }> = [];
    for (const result of this.results) {
      for (const event of result.timelineEvents || []) {
        const text = `${event.headline} ${event.detail || ''}`;
        if (!this.mentionedNpcPolityIds([text]).includes(polityId)) continue;
        const detail = String(event.detail || '').replace(/\s+/g, ' ').trim();
        const compactDetail = detail.length > 180 ? `${detail.slice(0, 179).trimEnd()}…` : detail;
        candidates.push({
          date: event.date || result.date || '',
          turn: result.turn,
          text: `${event.date || result.date || ''}: ${event.headline}${compactDetail ? ` — ${compactDetail}` : ''}`,
        });
      }
    }
    // Anche promesse, rifiuti e condizioni nelle chat sono memoria canonica:
    // provengono da righe persistite, non da un riassunto inventato ad hoc.
    for (const chat of chatRepository.getChatsByGame(this.id)) {
      if (!chat.participants.some(participant => participant.id === polityId)) continue;
      for (const message of chatRepository.getMessages(chat.id).slice(-6)) {
        const content = String(message.content || '').replace(/\s+/g, ' ').trim();
        if (!content) continue;
        const compactContent = content.length > 180 ? `${content.slice(0, 179).trimEnd()}…` : content;
        const speaker = message.role === 'player'
          ? this.publicPolityName(this.playerPolityId)
          : (message.senderName || chat.polityName);
        candidates.push({
          date: message.gameDate || '',
          turn: message.turn,
          text: `${message.gameDate || `turno ${message.turn}`}: ${speaker} in diplomazia — ${compactContent}`,
        });
      }
    }
    return candidates
      .sort((a, b) => b.date.localeCompare(a.date) || b.turn - a.turn)
      .map(candidate => candidate.text)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, limit);
  }

  /**
   * Dossier passati al simulatore globale. Prima vengono le controparti
   * nominate negli ordini, poi attori della memoria recente, confinanti e
   * relazioni non neutrali. Il limite evita di trasformare il prompt in un
   * atlante di personalità irrilevanti.
   */
  private buildNpcStrategicDossiers(
    focusTexts: string[],
    accounts: ReturnType<typeof WorldStateEngine.accounts>,
  ): string {
    const owners = [...new Set(Array.from(this.regions.values()).map(region => region.owner))]
      .filter(owner => owner && owner !== 'neutral' && owner !== this.playerPolityId);
    if (owners.length === 0) return 'Nessuna politia non giocante presente.';

    const recentTexts = this.results.slice(-8).flatMap(result =>
      (result.timelineEvents || []).map(event => `${event.headline} ${event.detail || ''}`)
    );
    const recentOwners = this.mentionedNpcPolityIds(recentTexts);
    const focusedOwners = this.mentionedNpcPolityIds(focusTexts);
    const chatOwners = chatRepository.getChatsByGame(this.id)
      .flatMap(chat => chat.participants.map(participant => participant.id))
      .filter(owner => owners.includes(owner));
    const frontierOwners = new Set<string>();
    for (const region of this.regions.values()) {
      if (region.owner !== this.playerPolityId) continue;
      for (const borderId of region.borders || []) {
        const owner = this.regions.get(borderId)?.owner;
        if (owner && owner !== 'neutral' && owner !== this.playerPolityId) frontierOwners.add(owner);
      }
    }
    const relatedOwners = owners.filter(owner => this.relationships.get(this.playerPolityId, owner) !== 'neutral');
    const strongestOwners = [...owners].sort((a, b) => (accounts[b]?.militaryPower || 0) - (accounts[a]?.militaryPower || 0));
    // Il dossier copre il teatro della crisi, non l'intero globo. Ancore fisse:
    // gli ordini del turno e i rapporti registrati. Da lì si espande ai vicini;
    // le potenze lontane entrano solo con un ruolo documentato, non perché sono
    // potenti, e le vecchie menzioni non riportano in scena un attore estraneo.
    const anchors = new Set<string>([...focusedOwners, ...relatedOwners]);
    const regionalOwners = new Set<string>();
    for (const owner of [this.playerPolityId, ...anchors]) {
      for (const neighbour of this.frontierOwnerIds(owner)) {
        if (neighbour !== this.playerPolityId) regionalOwners.add(neighbour);
      }
    }
    const theatreOwners = new Set<string>([
      ...focusedOwners,
      ...frontierOwners,
      ...regionalOwners,
      ...relatedOwners,
    ]);
    const relevantOwners = [...new Set([
      ...focusedOwners,
      ...regionalOwners,
      ...frontierOwners,
      ...relatedOwners,
      ...recentOwners.filter(owner => theatreOwners.has(owner)),
      ...chatOwners.filter(owner => theatreOwners.has(owner)),
    ])];
    // Solo se il mondo non offre alcun aggancio geografico o diplomatico il
    // dossier ripiega sulle potenze più forti, per non restare vuoto.
    const selected = (relevantOwners.length > 0 ? relevantOwners : strongestOwners).slice(0, 10);
    const playerMilitaryPower = Number(accounts[this.playerPolityId]?.effectiveMilitaryPower) || this.nationalEffectiveMilitaryPower(this.playerPolityId, accounts);
    const displayName = (polityId: string): string => {
      const owned = Array.from(this.regions.values()).filter(region => region.owner === polityId);
      const registeredName = countryRepository.findByCode(polityId)?.name;
      return owned.length > 1
        ? (registeredName || polityId)
        : (owned[0]?.name || registeredName || polityId);
    };
    const allPolityIds = [this.playerPolityId, ...owners];

    return selected.map(polityId => {
      const owned = Array.from(this.regions.values()).filter(region => region.owner === polityId);
      const name = displayName(polityId);
      const account = accounts[polityId];
      const relationship = this.relationships.get(polityId, this.playerPolityId);
      const profile = strategicProfileForPolity(polityId);
      const registeredRelations = allPolityIds
        .filter(otherId => otherId !== polityId)
        .map(otherId => ({ otherId, value: this.relationships.get(polityId, otherId) }))
        .filter(entry => entry.value !== 'neutral');
      const priorities = currentStrategicPriorities(profile, {
        relationshipToPlayer: relationship,
        hostileNeighbours: this.hostileNeighbourCount(polityId),
        hostileActors: registeredRelations.filter(entry => entry.value === 'hostile').length,
        alliedActors: registeredRelations.filter(entry => entry.value === 'ally').length,
        militaryPower: this.nationalEffectiveMilitaryPower(polityId, accounts),
        playerMilitaryPower,
        monthlyBalance: account?.monthlyBalance,
        stability: account?.stability,
        mobilized: account?.mobilized,
        warEffort: account?.warEffort,
        socialTension: account?.socialTension,
      });
      const memory = this.recentStrategicMemory(polityId, 3);
      return [
        `- ${name} [${polityId}] — profilo persistente: ${profile.personality}, dottrina ${profile.doctrine}, stile negoziale ${profile.negotiationStyle}, decisione ${profile.decisionTempo}.`,
        `  Tratti: propensione alla forza ${Math.round(profile.aggression * 100)}/100; rischio ${profile.riskTolerance}/100; affidabilità verso impegni registrati ${profile.allianceReliability}/100; focus economico ${profile.economicFocus}/100; sensibilità alla sovranità ${profile.sovereigntySensitivity}/100.`,
        `  Priorità correnti: ${priorities.join('; ')}. Linee rosse: ${profile.redLines.join('; ')}.`,
        ...(account ? [`  Economia e sforzo: saldo mensile ${Math.round(account.monthlyBalance * 10) / 10}, stabilità ${account.stability}/100, spesa militare ${account.defenceBurdenPct}% del PIL, riserve mobilitate ${account.mobilized}, sforzo bellico ${account.warEffort}/100, tensione sociale ${account.socialTension}/100.`] : []),
        `  Rapporti registrati: ${registeredRelations.length ? registeredRelations.slice(0, 8).map(entry => `${displayName(entry.otherId)} [${entry.otherId}] ${entry.value}`).join('; ') : 'nessun rapporto non neutrale'}.`,
        `  Memoria strategica: ${memory.length ? memory.join(' | ') : 'nessun precedente specifico registrato: non inventarne uno'}.`,
      ].join('\n');
    }).join('\n');
  }

  /** Colore canonico di una politia: colore più frequente tra i territori posseduti. */
  private polityColor(polityId: string, excludeRegionId?: string): string | undefined {
    const counts = new Map<string, number>();
    for (const r of this.regions.values()) {
      if (r.id === excludeRegionId || r.owner !== polityId || !r.color) continue;
      counts.set(r.color, (counts.get(r.color) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  /**
   * Unico punto di trasferimento territoriale: owner E colore cambiano insieme.
   * Evita province conquistate che conservano il colore della vecchia nazione.
   *
   * Regola non negoziabile: il colore del territorio è quello della nazione che
   * lo controlla. Per una politia già nota vince il suo colore canonico; per una
   * politia nuova si accetta il colore esplicito dichiarato e, in mancanza, se ne
   * deriva uno stabile dall'id. Un `newColor` sbagliato proposto dal modello non
   * può lasciare una provincia occupata del colore del vecchio sovrano.
   */
  private transferRegion(region: RegionState, newOwner: string, explicitColor?: string): void {
    const canonical = this.polityColor(newOwner, region.id);
    const explicit = explicitColor ? normalizeHexColor(explicitColor) || undefined : undefined;
    region.owner = newOwner;
    region.color = canonical || explicit || colorForPolity(newOwner);
  }

  /**
   * Attrito di conquista: ogni volta che una provincia passa di mano tra due
   * nazioni reali, il vincitore consuma equipaggiamento e prontezza in
   * proporzione alla difesa incontrata. È il modo in cui l'arsenale materiale
   * pesa sulla guerra, indipendentemente dallo stato diplomatico registrato:
   * anche un'occupazione "pacifica" logora chi la esegue.
   */
  private applyConquestAttrition(
    region: RegionState, previousOwner: string, newOwner: string,
    accounts: Record<string, NationalAccount>,
  ): void {
    if (!previousOwner || previousOwner === newOwner) return;
    if (previousOwner === 'neutral' || newOwner === 'neutral') return;
    const defender = accounts[previousOwner];
    const winner = accounts[newOwner];
    const winnerBase = Math.max(0, Number(winner?.militaryPower || 0));
    const winnerFactor = arsenalCombatFactor(this.arsenalUnits(newOwner),
      Number(winner?.forces || 0) + Number(winner?.mobilized || 0));
    const effective = Math.max(1, winnerBase * winnerFactor);
    const defence = Math.max(0, region.militaryPower) + Math.max(0, Number(defender?.militaryPower || 0)) * 0.15;
    const intensity = Math.min(0.3, (defence / effective) * 0.18);
    if (intensity <= 0.005) return;
    const { units, lost } = combatAttrition(this.arsenalUnits(newOwner), intensity);
    if (lost > 0) {
      this.saveArsenal(newOwner, units);
      console.log(`[GameSession] Attrito di conquista: ${newOwner} perde ${lost} equipaggiamenti a ${region.name}.`);
    }
    region.militaryPower = Math.max(1, Math.round(region.militaryPower * (1 - Math.min(0.5, intensity * 1.5))));
  }

  /**
   * Apply world changes from simulation.
   * Keys могут быть как regionId (legacy), так и ИМЕНА регионов/политий —
   * резолвим оба варианта.
   */
  /** M06 µ3: la partita è strict se il catalogo server-side lo dichiara. */
  private isStrictGame(): boolean {
    return gameRepository.getEconomyMode(this.id) === 'strict';
  }

  private applyWorldChanges(changes: WorldChanges): void {
    if (this.isStrictGame()) validateStrictWorldChanges(changes);
    const resolvers = this.buildResolvers();

    if (changes.regionOwners) {
      // Attrito di conquista: conti calcolati una sola volta per il lotto.
      const accounts = this.isStrictGame() ? undefined : WorldStateEngine.accounts(this.regions.values());
      for (const [regionKey, newOwner] of Object.entries(changes.regionOwners)) {
        const region = this.regions.get(regionKey) || resolvers.regions.resolve(regionKey);
        if (!region) {
          console.warn('[GameSession] worldChanges: region not found for key:', regionKey);
          continue;
        }
        const liveRegion = this.regions.get(region.id);
        if (!liveRegion) continue;

        const ownerResolution = resolvers.polities.resolve(newOwner);
        const ownerId = ownerResolution?.polityId || newOwner;
        const explicitColor = changes.regionColors?.[regionKey] || changes.regionColors?.[region.id];
        const previousOwner = liveRegion.owner;
        this.transferRegion(liveRegion, ownerId, explicitColor || resolvers.polities.colorOf(ownerId));
        if (accounts) this.applyConquestAttrition(liveRegion, previousOwner, ownerId, accounts);
      }
    }

    if (changes.regionGDP) {
      for (const [regionKey, gdp] of Object.entries(changes.regionGDP)) {
        const region = this.regions.get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.regions.get(region.id);
        if (liveRegion && Number.isFinite(gdp) && gdp >= 0) liveRegion.gdp = gdp;
      }
    }

    if (changes.regionMilitary) {
      for (const [regionKey, military] of Object.entries(changes.regionMilitary)) {
        const region = this.regions.get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.regions.get(region.id);
        if (liveRegion && Number.isFinite(military) && military >= 0) liveRegion.militaryPower = military;
      }
    }

    if (changes.regionPopulation) {
      for (const [regionKey, pop] of Object.entries(changes.regionPopulation)) {
        const region = this.regions.get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.regions.get(region.id);
        if (liveRegion && Number.isFinite(pop) && pop >= 0) liveRegion.population = pop;
      }
    }
  }

  /**
   * Гибкий резолвинг региона: id → имя (fuzzy) → override-форматы оригинала
   * ('random', 'coastal', 'west/east/north/south' и русские аналоги, 'target X').
   */
  private resolveRegionFlexible(key: string | undefined | null, resolver: RegionResolver): RegionState | undefined {
    if (!key) return undefined;
    const direct = this.regions.get(key) || resolver.resolve(key);
    if (direct) return this.regions.get(direct.id);

    const norm = key.trim().toLowerCase();
    const all = Array.from(this.regions.values());
    if (all.length === 0) return undefined;

    // Детерминированный «случайный» выбор — от длины строки, чтобы ход был воспроизводим
    const pickDeterministic = (pool: RegionState[]) =>
      pool[key.length % pool.length];

    if (norm === 'random') return pickDeterministic(all);

    if (norm === 'coastal') {
      const coastal = all.filter(r => (r.objects || []).some((o: any) => o.type === 'port'));
      return pickDeterministic(coastal.length > 0 ? coastal : all);
    }

    if (norm.startsWith('target ')) {
      const inner = this.regions.get(norm.slice(7)) || resolver.resolve(key.slice(7));
      return inner ? this.regions.get(inner.id) : undefined;
    }

    const dirMap: Record<string, 'west' | 'east' | 'north' | 'south'> = {
      west: 'west', western: 'west', ovest: 'west', occidente: 'west', запад: 'west',
      east: 'east', eastern: 'east', est: 'east', oriente: 'east', восток: 'east',
      north: 'north', northern: 'north', nord: 'north', settentrione: 'north', север: 'north',
      south: 'south', southern: 'south', sud: 'south', meridione: 'south', юг: 'south',
    };
    const dir = Object.entries(dirMap).find(([k]) => norm === k || norm.startsWith(k + ' '))?.[1];
    if (dir) {
      const withCentroid = all
        .map(r => ({ r, c: this.svgCentroid(r.svgPath) }))
        .filter((x): x is { r: RegionState; c: { x: number; y: number } } => !!x.c);
      if (withCentroid.length === 0) return pickDeterministic(all);
      withCentroid.sort((a, b) => {
        switch (dir) {
          case 'west': return a.c.x - b.c.x;
          case 'east': return b.c.x - a.c.x;
          case 'north': return a.c.y - b.c.y; // SVG: y растёт вниз
          case 'south': return b.c.y - a.c.y;
        }
      });
      return withCentroid[0].r;
    }

    return undefined;
  }

  /** Центроид региона из SVG-пути (среднее всех координат). */
  private svgCentroid(path: string | undefined): { x: number; y: number } | null {
    if (!path) return null;
    const nums = path.match(/-?\d+\.?\d*/g);
    if (!nums || nums.length < 4) return null;
    let sumX = 0, sumY = 0, count = 0;
    for (let i = 0; i < nums.length; i += 2) {
      sumX += Number(nums[i]);
      sumY += Number(nums[i + 1] || 0);
      count++;
    }
    return count > 0 ? { x: sumX / count, y: sumY / count } : null;
  }

  /** Кэш геоцентроидов регионов: geojson тяжёлый, считаем один раз на сессию. */
  private geoCenterCache: Map<string, { lat: number; lng: number } | null> = new Map();

  /**
   * Центр региона в lat/lng — для маркеров Этапа 4 ({ id, type, name, lat, lng }).
   * Приоритет: geojson-геометрия из БД (шаблонные миры Natural Earth; кастомные
   * SVG-карты тоже сконвертированы в lng/lat через svgPathToGeoJSON) →
   * центроид SVG-пути по конвенции 2000x1500 → null.
   */
  private regionCenter(region: RegionState): { lat: number; lng: number } | null {
    if (!this.geoCenterCache.has(region.id)) {
      this.geoCenterCache.set(region.id, this.computeGeoCenter(region.id));
    }
    const fromGeo = this.geoCenterCache.get(region.id);
    if (fromGeo) return fromGeo;

    const c = this.svgCentroid(region.svgPath);
    if (c) {
      // Та же конвенция SVG→lng/lat, что в svgPathToGeoJSON (холст 2000x1500)
      return { lng: (c.x / 2000) * 360 - 180, lat: 90 - (c.y / 1500) * 180 };
    }
    return null;
  }

  /**
   * Центроид региона по geojson из БД: среднее точек внешнего кольца
   * наибольшего полигона. GeoJSON хранит координаты как [lng, lat].
   * Для стран через антимеридиан (Россия, США) среднее грубое — для маркера достаточно.
   */
  private computeGeoCenter(regionId: string): { lat: number; lng: number } | null {
    try {
      const row = db.prepare('SELECT geojson FROM world_regions WHERE id = ?').get(regionId) as any;
      if (!row?.geojson) return null;
      const gj = JSON.parse(row.geojson);
      const geom = gj?.geometry ?? gj;
      const polygons: any[] = geom?.type === 'Polygon'
        ? [geom.coordinates]
        : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
      let bestRing: any[] | null = null;
      for (const poly of polygons) {
        const ring = poly?.[0];
        if (Array.isArray(ring) && (!bestRing || ring.length > bestRing.length)) bestRing = ring;
      }
      if (!bestRing || bestRing.length === 0) return null;
      let sumLng = 0, sumLat = 0, n = 0;
      for (const pt of bestRing) {
        if (Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number') {
          sumLng += pt[0];
          sumLat += pt[1];
          n++;
        }
      }
      return n > 0 ? { lng: sumLng / n, lat: sumLat / n } : null;
    } catch {
      return null;
    }
  }

  /** Кэш геометрий для определения границы (point-in-polygon). */
  private regionGeometryCache: Map<string, any> = new Map();

  private regionGeometry(regionId: string): any | null {
    if (this.regionGeometryCache.has(regionId)) return this.regionGeometryCache.get(regionId);
    let geometry: any = null;
    try {
      const row = db.prepare('SELECT geojson FROM world_regions WHERE id = ?').get(regionId) as any;
      if (row?.geojson) {
        const gj = JSON.parse(row.geojson);
        const geom = gj?.geometry ?? gj;
        if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') geometry = geom;
      }
    } catch {
      geometry = null;
    }
    this.regionGeometryCache.set(regionId, geometry);
    return geometry;
  }

  private static pointInRing(x: number, y: number, ring: any[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]?.[0];
      const yi = ring[i]?.[1];
      const xj = ring[j]?.[0];
      const yj = ring[j]?.[1];
      if (typeof xi !== 'number' || typeof yi !== 'number' || typeof xj !== 'number' || typeof yj !== 'number') continue;
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  private pointInGeometry(lng: number, lat: number, geometry: any): boolean {
    const polygons: any[] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const poly of polygons) {
      if (!Array.isArray(poly) || !poly.length || !Array.isArray(poly[0])) continue;
      if (!GameSession.pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (Array.isArray(poly[i]) && GameSession.pointInRing(lng, lat, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  /**
   * Punto di schieramento di frontiera: parte dal centroide della provincia e
   * avanza verso la provincia più vicina della politia indicata, fermandosi
   * all'ultimo punto ancora dentro i confini della provincia. Così una
   * formazione "di frontiera" compare sul confine e non nel centro abitato.
   */
  private frontierPosition(region: RegionState, targetPolityId: string): { lat: number; lng: number } | null {
    const start = this.regionCenter(region);
    const geometry = this.regionGeometry(region.id);
    if (!start || !geometry) return null;
    let toward: { lat: number; lng: number } | null = null;
    let bestDist = Infinity;
    for (const other of this.regions.values()) {
      if (other.owner !== targetPolityId) continue;
      const center = this.regionCenter(other);
      if (!center) continue;
      const dist = (center.lat - start.lat) ** 2 + (center.lng - start.lng) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        toward = center;
      }
    }
    if (!toward) return null;
    let last = { ...start };
    const steps = 32;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = {
        lat: start.lat + (toward.lat - start.lat) * t,
        lng: start.lng + (toward.lng - start.lng) * t,
      };
      if (this.pointInGeometry(point.lng, point.lat, geometry)) last = point;
      else break;
    }
    return last;
  }

  /**
   * Materializza "di frontiera" come posizione, non solo come nome: se una
   * formazione creata o mobilitata si chiama o è descritta come di frontiera
   * verso una politia nominata, il marker viene spostato sul confine.
   */
  private applyFrontierPlacements(
    event: SimulationEvent,
    changed: RegionState[],
    actionTexts: string[] = [],
  ): RegionState[] {
    if (changed.length === 0) return changed;
    const formationTypes = new Set(['mobilization', 'battalion', 'army', 'fleet', 'missile']);
    const texts = [event.headline || '', this.eventDetail(event) || '', ...actionTexts];
    const namedInEvent = this.mentionedNpcPolityIds(texts).filter(id => id !== this.playerPolityId);
    for (const region of changed) {
      if (!region.objects?.length) continue;
      for (const object of region.objects as any[]) {
        if (!formationTypes.has(object.type)) continue;
        const name = String(object.name || '');
        if (!/frontier|frontiera|di confine|confine|border/i.test(name)) continue;
        const direct = this.mentionedNpcPolityIds([name]).filter(id => id !== this.playerPolityId);
        const target = direct[0] || namedInEvent[0];
        if (!target) continue;
        const position = this.frontierPosition(region, target);
        if (!position) continue;
        object.lat = position.lat;
        object.lng = position.lng;
      }
    }
    return changed;
  }

  /**
   * Apply mapChanges from a single simulation event (transfer/create/update/delete).
   * Регионы и политии адресуются ИМЕНАМИ (так их видит LLM в описании карты).
   */
  private applyMapChanges(mapChanges: MapChange[] | undefined, movedDate = this.currentDate): RegionState[] {
    if (this.isStrictGame()) validateStrictMapChanges(mapChanges);
    if (!mapChanges || mapChanges.length === 0) return [];
    const resolvers = this.buildResolvers();
    const changed = new Map<string, RegionState>();
    // Attrito di conquista (solo legacy): i conti si calcolano una volta per lotto.
    let conquestAccounts: Record<string, NationalAccount> | null = null;
    const conquestAttrition = (region: RegionState, previousOwner: string, newOwner: string) => {
      if (this.isStrictGame() || previousOwner === newOwner) return;
      conquestAccounts ??= WorldStateEngine.accounts(this.regions.values());
      this.applyConquestAttrition(region, previousOwner, newOwner, conquestAccounts);
    };
    const facilityTypes = new Set([
      'factory', 'port', 'university', 'base', 'airbase', 'naval_base',
      'fortification', 'radar', 'missile_site', 'infrastructure', 'power_plant',
    ]);
    const unitTypes = new Set(['battalion', 'army', 'fleet', 'missile']);
    const objectChangeTypes = new Set([
      'build_facility', 'start_construction', 'update_construction', 'complete_construction', 'cancel_construction',
      'start_mobilization', 'complete_mobilization', 'cancel_mobilization',
      'spawn_battalion', 'move_battalion', 'spawn_unit', 'move_unit', 'remove_unit',
    ]);
    const exactRegion = (key: string | undefined): RegionState | undefined =>
      exactMovementRegion([...this.regions.values()], key);
    const validFeatureName = (feature: MapChange['feature']): string | null => {
      if (!feature || typeof feature.name !== 'string' || !feature.name.trim()) return null;
      return feature.name.trim().slice(0, 160);
    };

    for (const change of mapChanges) {
      const regionKey = change.regionId || change.regionName;
      // Movement/removal can locate a unique unit even with an omitted or stale origin.
      if (change.type === 'move_unit' || change.type === 'move_battalion' || change.type === 'remove_unit') {
        for (const region of this.applyUnitChange(change, movedDate)) changed.set(region.id, region);
        continue;
      }
      // Oggetti e opere richiedono destinazioni reali. Mai interpretare
      // "random"/"coastal" come una provincia e collocare il marker a caso.
      const liveRegion = objectChangeTypes.has(change.type)
        ? exactRegion(regionKey)
        : this.resolveRegionFlexible(regionKey, resolvers.regions);
      if (!liveRegion) {
        console.warn('[GameSession] mapChange: region not resolved:', regionKey);
        continue;
      }
      let mutated = false;

      switch (change.type) {
        case 'transfer': {
          const ownerResolution = resolvers.polities.resolve(change.newOwner);
          if (!ownerResolution) break;
          const previous = `${liveRegion.owner}:${liveRegion.color}`;
          const previousOwner = liveRegion.owner;
          this.transferRegion(
            liveRegion,
            ownerResolution.polityId,
            change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
          );
          conquestAttrition(liveRegion, previousOwner, ownerResolution.polityId);
          mutated = `${liveRegion.owner}:${liveRegion.color}` !== previous;
          break;
        }
        case 'update': {
          // Un `update` con un nuovo proprietario è di fatto un passaggio
          // territoriale: lo trattiamo come tale, così la provincia occupata
          // prende il colore dell'occupante anche se il modello ha scelto il
          // tipo sbagliato.
          if (change.newOwner) {
            const ownerResolution = resolvers.polities.resolve(change.newOwner);
            if (ownerResolution) {
              const previous = `${liveRegion.owner}:${liveRegion.color}`;
              const previousOwner = liveRegion.owner;
              this.transferRegion(
                liveRegion,
                ownerResolution.polityId,
                change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
              );
              conquestAttrition(liveRegion, previousOwner, ownerResolution.polityId);
              mutated ||= `${liveRegion.owner}:${liveRegion.color}` !== previous;
            }
          } else if (change.newColor && change.newColor !== liveRegion.color) {
            liveRegion.color = change.newColor;
            mutated = true;
          }
          if (change.newName && change.newName !== liveRegion.name) {
            liveRegion.name = change.newName;
            mutated = true;
          }
          break;
        }
        case 'delete': {
          mutated = liveRegion.owner !== 'neutral' || liveRegion.color !== '#888888';
          liveRegion.owner = 'neutral';
          liveRegion.color = '#888888';
          break;
        }
        case 'create_polity':
        case 'create': {
          const ownerResolution = resolvers.polities.resolve(change.newOwner || change.newName);
          if (ownerResolution) {
            const previous = `${liveRegion.owner}:${liveRegion.color}`;
            this.transferRegion(
              liveRegion,
              ownerResolution.polityId,
              change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
            );
            mutated = `${liveRegion.owner}:${liveRegion.color}` !== previous;
          }
          break;
        }
        case 'start_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !facilityTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const duplicate = liveRegion.objects.some((object: any) =>
            normalizeName(object.name) === normalizeName(name)
            && (object.type === feature.type
              || (object.type === 'construction_site' && object.metadata?.plannedType === feature.type))
          );
          const center = this.regionCenter(liveRegion);
          if (duplicate || !center) break;
          liveRegion.objects.push({
            id: feature.id || shortId(),
            type: 'construction_site',
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: {
              ...constructionProgressPatch(feature.metadata),
              status: 'under_construction',
              plannedType: feature.type,
              startedDate: this.currentDate,
            },
          });
          mutated = true;
          break;
        }
        case 'update_construction': {
          const feature = change.feature;
          if (!feature || liveRegion.status === 'destroyed') break;
          const name = validFeatureName(feature);
          const site = (liveRegion.objects || []).find((object: any) =>
            object.type === 'construction_site'
            && object.metadata?.plannedType === feature.type
            && (feature.id ? object.id === feature.id : !!name && normalizeName(object.name) === normalizeName(name)));
          if (!site) break; // Never create a missing site or alter an operational facility.
          const patch = constructionProgressPatch(feature.metadata);
          mutated = Object.entries(patch).some(([key, value]) => site.metadata?.[key] !== value);
          if (mutated) site.metadata = { ...site.metadata, ...patch, lastUpdatedDate: this.currentDate };
          break;
        }
        case 'build_facility':
        case 'complete_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !facilityTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const existingFinal = liveRegion.objects.find((object: any) =>
            object.type === feature.type && normalizeName(object.name) === normalizeName(name));
          if (existingFinal) break;
          const siteIndex = liveRegion.objects.findIndex((object: any) =>
            object.type === 'construction_site'
            && ((feature.id && object.id === feature.id) || normalizeName(object.name) === normalizeName(name))
            && (!object.metadata?.plannedType || object.metadata.plannedType === feature.type));
          const center = this.regionCenter(liveRegion);
          if (!center) break;
          if (siteIndex >= 0) {
            const site = liveRegion.objects[siteIndex];
            liveRegion.objects[siteIndex] = {
              ...site,
              type: feature.type,
              name,
              owner: site.owner || liveRegion.owner,
              level: Math.max(1, Number(site.level) || 1),
              lat: site.lat ?? center.lat,
              lng: site.lng ?? center.lng,
              metadata: {
                ...(site.metadata || {}),
                ...(feature.metadata || {}),
                status: 'operational',
                phase: 'completed',
                blocker: '',
                nextStep: '',
                plannedType: undefined,
                completedDate: this.currentDate,
              },
            };
          } else {
            // Compatibilità: un evento può attestare direttamente un'opera già
            // terminata senza che i turni storici avessero un marker cantiere.
            liveRegion.objects.push({
              id: feature.id || shortId(), type: feature.type, name, level: 1,
              owner: liveRegion.owner, lat: center.lat, lng: center.lng,
              metadata: { ...(feature.metadata || {}), status: 'operational', completedDate: this.currentDate },
            });
          }
          mutated = true;
          break;
        }
        case 'cancel_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || (!feature.id && !name)) break;
          liveRegion.objects ||= [];
          const before = liveRegion.objects.length;
          liveRegion.objects = liveRegion.objects.filter((object: any) =>
            object.type !== 'construction_site'
            || (feature.id ? object.id !== feature.id : normalizeName(object.name) !== normalizeName(name || '')));
          mutated = liveRegion.objects.length !== before;
          break;
        }
        case 'start_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !unitTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const duplicate = liveRegion.objects.some((object: any) =>
            normalizeName(object.name) === normalizeName(name)
            && (object.type === feature.type
              || (object.type === 'mobilization' && object.metadata?.plannedType === feature.type))
          );
          const center = this.regionCenter(liveRegion);
          if (duplicate || !center) break;
          liveRegion.objects.push({
            id: feature.id || shortId(),
            type: 'mobilization',
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: {
              ...(feature.metadata || {}),
              status: 'forming',
              plannedType: feature.type,
              startedDate: this.currentDate,
            },
          });
          mutated = true;
          break;
        }
        case 'complete_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !unitTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          if (liveRegion.objects.some((object: any) => object.type === feature.type
              && normalizeName(object.name) === normalizeName(name))) break;
          const mobilizationIndex = liveRegion.objects.findIndex((object: any) =>
            object.type === 'mobilization'
            && ((feature.id && object.id === feature.id) || normalizeName(object.name) === normalizeName(name))
            && (!object.metadata?.plannedType || object.metadata.plannedType === feature.type));
          const center = this.regionCenter(liveRegion);
          if (!center) break;
          if (mobilizationIndex >= 0) {
            const mobilization = liveRegion.objects[mobilizationIndex];
            liveRegion.objects[mobilizationIndex] = {
              ...mobilization,
              type: feature.type,
              name,
              owner: mobilization.owner || liveRegion.owner,
              lat: mobilization.lat ?? center.lat,
              lng: mobilization.lng ?? center.lng,
              metadata: {
                ...(mobilization.metadata || {}),
                ...(feature.metadata || {}),
                status: 'operational',
                plannedType: undefined,
                deployedDate: this.currentDate,
              },
            };
          } else {
            liveRegion.objects.push({
              id: feature.id || shortId(), type: feature.type, name, level: 1,
              owner: liveRegion.owner, lat: center.lat, lng: center.lng,
              metadata: { ...(feature.metadata || {}), status: 'operational', deployedDate: this.currentDate },
            });
          }
          mutated = true;
          break;
        }
        case 'cancel_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || (!feature.id && !name)) break;
          liveRegion.objects ||= [];
          const before = liveRegion.objects.length;
          liveRegion.objects = liveRegion.objects.filter((object: any) =>
            object.type !== 'mobilization'
            || (feature.id ? object.id !== feature.id : normalizeName(object.name) !== normalizeName(name || '')));
          mutated = liveRegion.objects.length !== before;
          break;
        }
        case 'spawn_battalion':
        case 'spawn_unit': {
          const feature = change.feature;
          const requestedType = change.type === 'spawn_battalion' ? 'battalion' : feature?.type;
          if (!requestedType || !unitTypes.has(requestedType) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const name = validFeatureName(feature)
            || `${requestedType === 'army' ? 'Armata' : requestedType === 'fleet' ? 'Flotta' : requestedType === 'missile' ? 'Batteria' : 'Battaglione'} ${liveRegion.name} ${liveRegion.objects.filter((object: any) => object.type === requestedType).length + 1}`;
          if (liveRegion.objects.some((object: any) => object.type === requestedType
              && normalizeName(object.name) === normalizeName(name))) break;
          const center = this.regionCenter(liveRegion);
          if (!center) break;
          liveRegion.objects.push({
            id: feature?.id || shortId(),
            type: requestedType,
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: { ...(feature?.metadata || {}), status: 'operational', deployedDate: this.currentDate },
          });
          mutated = true;
          break;
        }
      }
      if (mutated) changed.set(liveRegion.id, liveRegion);
    }
    return [...changed.values()];
  }

  /** Resolve identity before mutating: IDs never fall back to names; ambiguous names never guess. */
  private applyUnitChange(change: MapChange, movedDate: string): RegionState[] {
    const feature = change.feature;
    const name = feature?.name ? normalizeName(feature.name) : '';
    const requestedType = change.type === 'move_battalion' ? 'battalion' : feature?.type;
    if (requestedType && !UNIT_TYPES.has(requestedType)) return [];
    const regions = [...this.regions.values()];
    const origin = resolveMovementRegion(regions, change.regionId || change.regionName);
    const movable = regions.flatMap(region => (region.objects || [])
      .filter(unit => UNIT_TYPES.has(unit.type))
      .map(unit => ({ region, unit })));
    const allowed = movable.filter(candidate => unitMatchesType(candidate.unit, requestedType));
    let candidates = feature?.id
      ? allowed.filter(candidate => candidate.unit.id === feature.id)
      : name ? allowed.filter(candidate => normalizeName(candidate.unit.name || '') === name) : [];
    // Il modello cita spesso il nome breve («3° Battaglione») di un reparto con
    // nome lungo: accettiamo un prefisso distintivo solo se identifica UNA unità.
    if (candidates.length === 0 && !feature?.id && name) {
      const tolerant = allowed.filter(candidate => unitNameMatchesPrefix(feature!.name!, candidate.unit.name || ''));
      if (tolerant.length === 1) candidates = tolerant;
    }
    // The legacy unnamed command is safe only with one battalion at an exact origin.
    if (!feature?.id && !name && change.type === 'move_battalion' && origin) {
      candidates.push(...(origin.objects || []).filter(unit => unit.type === 'battalion')
        .map(unit => ({ region: origin, unit })));
    }
    if (candidates.length !== 1) {
      if (change.type === 'move_unit' || change.type === 'move_battalion' || change.type === 'remove_unit') {
        console.warn('[GameSession]', change.type, 'non applicato: unità non identificata in modo univoco',
          { nome: feature?.name, id: feature?.id, tipo: requestedType, candidati: candidates.length });
      }
      return [];
    }
    const { region: source, unit } = candidates[0];
    if (change.type === 'remove_unit') {
      source.objects = source.objects.filter(object => object !== unit);
      return [source];
    }
    const target = resolveMovementRegion(regions, change.targetRegionName);
    if (!target || target.status === 'destroyed' || source.id === target.id) {
      console.warn('[GameSession]', change.type, 'non applicato: destinazione non risolta',
        { destinazione: change.targetRegionName, origine: source.name, unità: unit.name });
      return [];
    }
    const center = this.regionCenter(target);
    if (!center) return [];
    // Il movimento ha un costo materiale: cibo, carburante (se motorizzato) e
    // denaro. Non blocca il gioco, ma registra carenze e consuma le scorte.
    const payer = unit.owner || source.owner || this.playerPolityId;
    const cost = movementCost(this.resourceStock(payer));
    const payment = payMovement(this.resourceStock(payer), cost);
    this.saveResourceStock(payer, payment.stock);
    if (!payment.covered) {
      console.warn('[GameSession] Movimento con scorte insufficienti:', payment.shortages.join('; '),
        { unita: unit.name, polity: payer });
    }
    const previous = this.regionCenter(source);
    unit.metadata = {
      ...(unit.metadata || {}), status: unit.metadata?.status || 'operational', movedDate,
      previousRegionId: source.id, previousRegionName: source.name,
      previousLng: Number.isFinite(unit.lng) ? unit.lng : previous?.lng,
      previousLat: Number.isFinite(unit.lat) ? unit.lat : previous?.lat,
      logistics: { food: cost.food, fuel: cost.fuel, money: cost.money,
        motorized: cost.motorized, covered: payment.covered },
    };
    if (!unit.owner) unit.owner = source.owner;
    unit.lat = center.lat;
    unit.lng = center.lng;
    source.objects = source.objects.filter(object => object !== unit);
    target.objects ||= [];
    target.objects.push(unit);
    return [source, target];
  }

  private captureMovementIntents(actions: PendingAction[]): MovementIntent[] {
    if (this.isStrictGame()) return [];
    return actions.flatMap(action => parseMovementOrder(action.text, [...this.regions.values()], this.playerPolityId, action.id));
  }

  /**
   * Un ordine di movimento accettato dal modello ma senza `move_unit`
   * lascerebbe l'unità ferma: il motore applica allora il movimento dovuto.
   * Agisce solo su esiti `accepted`, con unità e destinazione realmente
   * esistenti, e mai due volte sulla stessa unità.
   */
  private reconcileAcceptedMoves(
    actions: PendingAction[],
    outcomes: ActionOutcome[],
    intents = this.captureMovementIntents(actions),
    explicitChanges: MapChange[] = [],
    movedDate = this.currentDate,
  ): RegionState[] {
    if (this.isStrictGame()) return [];
    const accepted = new Set(actions.filter(action => {
      // An ID is authoritative. Legacy text matching is allowed only without an ID,
      // and only for a unique queued text. Conflicting outcomes do not execute.
      const matching = outcomes.filter(outcome => outcome.actionId
        ? outcome.actionId === action.id
        : outcome.action === action.text && actions.filter(other => other.text === action.text).length === 1);
      return matching.length > 0 && matching.every(outcome => outcome.status === 'accepted');
    }).map(action => action.id));
    const eligible = intents.filter(intent => accepted.has(intent.actionId));
    const changed = new Map<string, RegionState>();
    for (const intent of eligible) {
      // Competing destinations or any explicit model move/removal take precedence.
      if (eligible.some(other => other.unitId === intent.unitId && other.targetId !== intent.targetId)) continue;
      if (explicitChanges.some(change => ['move_unit', 'move_battalion', 'remove_unit'].includes(change.type)
        && (change.feature?.id ? change.feature.id === intent.unitId
          : change.feature?.name ? normalizeName(change.feature.name) === normalizeName(intent.unitName)
            : change.type === 'move_battalion'))) continue;
      const origin = this.regions.get(intent.originId);
      const target = this.regions.get(intent.targetId);
      const unit = origin?.objects?.find(object => object.id === intent.unitId);
      // A partial advance, removal, ownership change or replacement is never undone.
      if (!origin || !target || !unit || origin.id === target.id
        || (unit.owner || origin.owner) !== this.playerPolityId
        || JSON.stringify(unit) !== intent.fingerprint) continue;
      const touched = this.applyMapChanges([{
        type: 'move_unit', regionId: origin.id, targetRegionName: target.id,
        feature: { type: intent.unitType as any, id: intent.unitId, name: intent.unitName },
      }], movedDate);
      for (const region of touched) changed.set(region.id, region);
    }
    return [...changed.values()];
  }

  /**
   * Process NPC turns for all NPC countries
   */
  private async processNPCTurns(limit = GameSession.TURN_NPC_LIMIT, days = 30): Promise<string[]> {
    const npcEvents: string[] = [];
    const allNpcRegionIds = npcRepresentatives(this.gameController.getNPCCountries(), this.regions, this.playerPolityId)
      .filter(id => !this.npcInFlight.has(this.regions.get(id)!.owner));
    const { owned, frontier } = indexPolities(this.regions);

    // Round-robin: con un limite, processa solo un sottoinsieme rotante di
    // paesi NPC (usato dalla simulazione live per limitare il costo LLM).
    let npcRegionIds = allNpcRegionIds;
    if (Number.isFinite(limit) && limit < allNpcRegionIds.length) {
      const n = allNpcRegionIds.length;
      npcRegionIds = [];
      for (let i = 0; i < limit; i++) {
        npcRegionIds.push(allNpcRegionIds[(this.npcCursor + i) % n]);
      }
      this.npcCursor = (this.npcCursor + limit) % n;
    }

    const regionResolver = new RegionResolver(Array.from(this.regions.values()));
    const scheduledOwners = new Map(npcRegionIds.map(id => [id, this.regions.get(id)!.owner]));

    for (const npcRegionId of npcRegionIds) {
      const npcRegion = this.regions.get(npcRegionId);
      if (!npcRegion) continue;

      const owner = npcRegion.owner;
      if (owner !== scheduledOwners.get(npcRegionId) || owner === this.playerPolityId || this.npcInFlight.has(owner)) continue;
      // Representatives may have been conquered earlier in this batch.
      const nationalRegions = (owned.get(owner) || []).filter(r => r.owner === owner);
      const frontierIds = frontier.get(owner) || new Set<string>();
      const neighbors = [...frontierIds].map(id => this.regions.get(id)!)
        .filter(r => r.owner !== owner && r.status !== 'destroyed')
        .slice(0, 24).map(r => ({
          id: r.id, name: r.name, owner: r.owner,
          militaryPower: r.militaryPower, gdp: r.gdp,
          relationship: this.relationships.get(owner, r.owner),
        }));
      const sum = (key: 'population' | 'gdp' | 'militaryPower') =>
        nationalRegions.reduce((total, region) => total + region[key], 0);
      const npcContext = {
        polityId: owner,
        polityName: polityDisplayNameIt(owner, countryRepository.findByCode(owner)?.name),
        turn: this.currentTurn,
        population: sum('population'), gdp: sum('gdp'), militaryPower: sum('militaryPower'),
        neighbors,
        recentEvents: this.results.slice(-3).map(r => r.narration.slice(0, 600)),
      };

      try {
        // Un singolo provider NPC indisponibile non può trattenere il lock del
        // gioco: allo scadere continuiamo con la prossima politia/tick.
        this.npcInFlight.add(owner);
        const request = this.gameController.processNPCTurn(npcRegionId, npcContext)
          .finally(() => this.npcInFlight.delete(owner));
        const npcAction = await withinDeadline(request, GameSession.NPC_TURN_TIMEOUT_MS);
        if (npcAction) {
          // Publish only accepted effects. Unsupported proposals must not
          // appear as completed alliances/trade deals in the world memory.
          if (npcAction.type === 'develop') {
            for (const region of nationalRegions) {
              region.gdp *= Math.pow(1.05, days / 365);
              region.militaryPower *= Math.pow(1.03, days / 365);
            }
            npcEvents.push(`${npcContext.polityName} attua misure di sviluppo interno`);
          } else if (npcAction.type === 'war' && npcAction.targetRegionId) {
            // LLM может вернуть как id, так и ИМЯ региона — резолвим оба варианта
            const resolved = this.regions.get(npcAction.targetRegionId)
              || regionResolver.resolve(npcAction.targetRegionId);
            const targetRegion = resolved ? this.regions.get(resolved.id) : undefined;
            // Re-check the live border after earlier captures in the batch.
            const liveFrontier = new Set(nationalRegions.flatMap(r => r.borders || []));
            if (targetRegion && (targetRegion.borders || []).some(id => this.regions.get(id)?.owner === owner)) {
              liveFrontier.add(targetRegion.id);
            }
            const attackingPower = nationalRegions
              .filter(r => (r.borders || []).includes(targetRegion?.id || '') || (targetRegion?.borders || []).includes(r.id))
              .reduce((total, r) => total + r.militaryPower, 0);
            if (canNpcCapture(owner, targetRegion, liveFrontier,
              targetRegion ? this.relationships.get(owner, targetRegion.owner) : 'neutral')
              && targetRegion.militaryPower < attackingPower * 0.7) {
              this.transferRegion(targetRegion, owner, npcRegion.color);
              npcEvents.push(`${npcContext.polityName} conquista ${targetRegion.name}`);
            }
          }
        } else {
          console.warn(`[GameSession] NPC ${npcRegion.name}: nessuna risposta entro ${GameSession.NPC_TURN_TIMEOUT_MS / 1000}s`);
        }
      } catch (e) {
        console.error(`NPC turn error for ${npcRegionId}:`, e);
      }
    }

    return npcEvents;
  }

  /**
   * Apply random events (15% chance)
   */
  private applyRandomEvents(): string[] {
    const randomEvents: string[] = [];

    if (Math.random() < 0.15) {
      const eventTypes = [
        { name: 'Disastro naturale', effects: ['terremoto', 'alluvione', 'siccità', 'uragano'] },
        { name: 'Crisi economica', effects: ['recessione', 'inflazione', 'carestia'] },
        { name: 'Progresso tecnologico', effects: ['invenzione', 'scoperta', 'innovazione'] },
        { name: 'Disordini sociali', effects: ['protesthe', 'sciopero generale', 'rivolta'] },
        { name: 'Epidemia', effects: ['peste', 'influenza', 'virus'] },
      ];

      const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const effect = event.effects[Math.floor(Math.random() * event.effects.length)];
      const regionsArray = Array.from(this.regions.values()).filter(r => r.status !== 'destroyed');
      if (regionsArray.length === 0) return [];
      const targetRegion = regionsArray[Math.floor(Math.random() * regionsArray.length)];

      const eventText = `${effect.charAt(0).toUpperCase() + effect.slice(1)} colpisce ${targetRegion.name}`;
      randomEvents.push(eventText);

      // Apply effects
      if (event.name === 'Disastro naturale') {
        targetRegion.population = Math.floor(targetRegion.population * 0.95);
        targetRegion.gdp *= 0.9;
      } else if (event.name === 'Crisi economica') {
        targetRegion.gdp *= 0.85;
      } else if (event.name === 'Progresso tecnologico') {
        targetRegion.gdp *= 1.15;
        targetRegion.militaryPower *= 1.1;
      } else if (event.name === 'Disordini sociali') {
        targetRegion.militaryPower *= 0.9;
      } else if (event.name === 'Epidemia') {
        targetRegion.population = Math.floor(targetRegion.population * 0.9);
        targetRegion.militaryPower *= 0.85;
      }
    }

    return randomEvents;
  }

  /**
   * Sync all region changes to database.
   * Uses batch update for performance (single transaction for all regions).
   *
   * Persists population/gdp/militaryPower (every turn) and owner/color
   * (rarely changes, but NPC conquests in processNPCTurns and LLM-driven
   * mapChanges in applyWorldChanges both mutate them in memory, so we
   * write them too to keep the DB consistent with the in-memory state
   * across restarts).
   */
  /**
   * Scrittura delle regioni nel DB. Il corpo è sincrono: può essere invocata
   * dentro la transazione canonica (F02 passo 2) senza aprire finestre di
   * asincronia. I call site con `await` restano validi.
   */
  syncRegionsToDB(): void {
    const updates = Array.from(this.regions.values()).map(region => ({
      id: region.id,
      population: region.population,
      gdp: region.gdp,
      militaryPower: region.militaryPower,
      owner: region.owner,
      color: region.color,
      // Этап 4: маркеры на карте (столицы/батальоны) — передаём всегда,
      // иначе updateRegionsBatch их не сохранял и объекты терялись при рестарте
      objects: region.objects || [],
    }));
    gameRepository.upsertGameRegions(this.id, updates);
  }

  /** Snapshot serializzabile di un checkpoint coerente del ramo corrente. */
  private captureCheckpointData(): SaveData {
    return {
      currentTurn: this.currentTurn,
      currentDate: this.currentDate,
      players: this.players,
      regions: Array.from(this.regions.entries()),
      relationships: this.relationships.toJSON(),
      actions: this.actions,
      results: this.results,
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      // §9.3: con un run in pausa la coda contiene anche ordini già emessi;
      // senza pausa «processing» non esiste mai qui (save è 409 durante il run).
      pendingActions: this.pendingActions.filter(action => action.status === 'pending' || action.status === 'processing'),
      pausedSimulationId: this.pausedRun?.runId,
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
      economicState: captureEconomicSnapshot(this.id, gameRepository.getHeadBranch(this.id) || gameRepository.ensureMainBranch(this.id)),
    };
  }

  /**
   * Save full session state to saves table
   */
  save(name: string): { saveId: string; currentTurn: number; currentDate: string } {
    const saveId = shortId();

    // Capture full region snapshot
    const saveData: SaveData = {
      currentTurn: this.currentTurn,
      currentDate: this.currentDate,
      players: this.players,
      regions: Array.from(this.regions.entries()),
      relationships: this.relationships.toJSON(),
      actions: this.actions,
      results: this.results,
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      pendingActions: this.pendingActions.filter(action => action.status === 'pending' || action.status === 'processing'),
      pausedSimulationId: this.pausedRun?.runId,
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
      economicState: captureEconomicSnapshot(this.id, gameRepository.getHeadBranch(this.id) || gameRepository.ensureMainBranch(this.id)),
    };

    const stmt = db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      saveId,
      this.id,
      name || `Game ${new Date().toLocaleDateString()}`,
      this.currentTurn,
      this.currentDate,
      JSON.stringify(saveData),
      semanticStateHash(saveData),
      new Date().toISOString()
    );

    console.log('[GameSession] Saved:', saveId, 'turn:', this.currentTurn);
    return { saveId, currentTurn: this.currentTurn, currentDate: this.currentDate };
  }

  /**
   * F04 §9.4.1: hash semantico dello stato corrente della sessione, calcolato
   * con la stessa funzione del salvataggio. Il DoD del restore (C12) lo
   * confronta con l’hash del checkpoint scelto, esclusi i metadati del ramo.
   */
  semanticHash(): string {
    return semanticStateHash(this.captureCheckpointData());
  }

  /**
   * Load session from save data. F04 §9.4.1: se è fornito l’hash atteso dal
   * catalogo, lo snapshot viene validato PRIMA di mutare la sessione; un hash
   * incompatibile rifiuta il restore (snapshot manomesso o incompatibile).
   */
  loadFromSave(
    saveData: SaveData,
    expectedHash?: string | null,
    options?: { newBranch?: { originCheckpointId?: string | null; name?: string } },
  ): { branchId: string | null } {
    const strictBranchId = this.isStrictGame()
      ? (gameRepository.getHeadBranch(this.id) || gameRepository.ensureMainBranch(this.id))
      : null;
    if (expectedHash != null && semanticStateHash(saveData) !== expectedHash) {
      if (strictBranchId) invalidateStrictEffectStaging(strictBranchId);
      throw new Error(`snapshot_hash_mismatch: lo snapshot non corrisponde al catalogo (atteso ${expectedHash.slice(0, 12)}…)`);
    }
    if (this.isStrictGame()) {
      try {
        if (!validateEconomicSnapshot(saveData.economicState)) {
          invalidateStrictEffectStaging(strictBranchId!);
          throw new Error('strict_economic_snapshot_missing: restore strict richiede stato economico verificabile');
        }
      } catch (error) {
        // `validateEconomicSnapshot` può lanciare per ledger semanticamente
        // invalido; in ogni rifiuto strict lo staging del futuro è scartato.
        invalidateStrictEffectStaging(strictBranchId!);
        if (error instanceof Error && error.message.startsWith('strict_economic_snapshot_')) throw error;
        const detail = error instanceof Error ? error.message : 'snapshot economico invalido';
        throw new Error(`strict_economic_snapshot_invalid: ${detail}`);
      }
    }
    // F04 passo 2: staging della RAM — il restore riuscito lo promuove, un
    // errore a metà lo scarta insieme al rollback DB.
    const staging = {
      regions: new Map<string, RegionState>(
        [...this.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      relationships: this.relationships.toJSON(),
      actions: [...this.actions],
      results: [...this.results],
      pendingActions: this.pendingActions.map(action => ({ ...action })),
      turn: this.currentTurn,
      date: this.currentDate,
      pausedRun: this.pausedRun,
      players: this.players,
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      interveneRequested: this.interveneRequested,
    };
    try {
    // F04 passo 2: tutte le collezioni ripristinate in UNA transazione
    // (coda, ordini processing, relazioni, chat, processi, mondo), e il
    // ramo nuovo con il suo fencing token nella stessa transazione.
    withCanonicalTransaction(() => {
    this.currentTurn = saveData.currentTurn;
    this.currentDate = saveData.currentDate;
    this.players = saveData.players || [];

    // Restore regions
    if (saveData.regions) {
      this.regions = new Map(saveData.regions);
    }

    // Restore relationships
    if (saveData.relationships) {
      this.relationships = RelationshipMatrix.fromJSON(saveData.relationships);
    }

    // Этап 2: история, консолидация, сложность (без них rewind терял контекст)
    this.actions = saveData.actions || [];
    this.results = saveData.results || [];
    this.consolidatedHistory = saveData.consolidatedHistory || '';
    this.consolidatedUpTo = saveData.consolidatedUpTo || 0;
    this.difficulty = normalizeDifficulty(saveData.difficulty);
    this.interveneRequested = false;
    // La coda appartiene al ramo salvato: ripristinala invece di perderla.
    // §9.3: gli ordini «processing» del playback sospeso tornano insieme al
    // loro run; il ramo che non li possiede più non li vede affatto.
    this.pendingActions = (saveData.pendingActions || [])
      .filter(action => action.status === 'pending' || action.status === 'processing');
    gameRepository.replacePendingActions(this.id, this.pendingActions);
    // §12/§9.3: il run in pausa del ramo ripristinato continua a esistere;
    // ogni altro run sospeso del ramo scartato è invalidato.
    this.pausedRun = this._revivePausedRun(saveData.pausedSimulationId);
    if (!this.pausedRun) gameRepository.interruptPausedRuns(this.id);
    // Vecchi salvataggi senza chats restano compatibili e non cancellano le
    // conversazioni; i nuovi checkpoint ripristinano invece il ramo esatto.
    if (saveData.chats) chatRepository.replaceGameChats(this.id, saveData.chats);
    if (saveData.ongoingProcesses) gameRepository.replaceOngoingProcesses(this.id, saveData.ongoingProcesses);

    // Update game in DB
    gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);
    gameRepository.updateConsolidation(this.id, this.consolidatedHistory, this.consolidatedUpTo);
    gameRepository.replaceHistory(this.id, this.actions, this.results);

    // Sync restored regions to DB
    this.syncRegionsToDB();

    // F04 passo 4: lo storico del ramo abbandonato resta solo nell’archivio
    // privato. Le righe outbox pendenti appartengono al futuro scartato:
    // vengono archiviate (mai ripubblicate) nella stessa transazione.
    gameRepository.archivePendingOutbox(this.id);

    // F04 passo 2: il restore crea un ramo figlio con origin nel checkpoint
    // ripristinato (fencing token nuovo); il ramo abbandonato resta in
    // archivio (game_branches) e non entra mai nei prompt del ramo nuovo.
    if (options?.newBranch) {
      gameRepository.createBranch({
        id: shortId(),
        gameId: this.id,
        name: options.newBranch.name || `restore-${saveData.currentDate}`,
        parentBranchId: gameRepository.getHeadBranch(this.id),
        originCheckpointId: options.newBranch.originCheckpointId ?? null,
      });
    }
    const economicsRestored = restoreEconomicSnapshot(this.id, gameRepository.getHeadBranch(this.id) || gameRepository.ensureMainBranch(this.id), saveData.economicState);
    if (this.isStrictGame() && !economicsRestored) throw new Error('strict_economic_snapshot_missing: restore strict richiede stato economico verificabile');
    });
    } catch (e) {
      this.regions = staging.regions;
      this.relationships = RelationshipMatrix.fromJSON(staging.relationships);
      this.actions = staging.actions;
      this.results = staging.results;
      this.pendingActions = staging.pendingActions;
      this.currentTurn = staging.turn;
      this.currentDate = staging.date;
      this.pausedRun = staging.pausedRun;
      this.players = staging.players;
      this.consolidatedHistory = staging.consolidatedHistory;
      this.consolidatedUpTo = staging.consolidatedUpTo;
      this.difficulty = staging.difficulty;
      this.interveneRequested = staging.interveneRequested;
      if (this.isStrictGame()) {
        const branchId = gameRepository.getHeadBranch(this.id);
        if (branchId) invalidateStrictEffectStaging(branchId);
      }
      throw e;
    }
    console.log('[GameSession] Loaded from save, turn:', this.currentTurn);
    return { branchId: gameRepository.getHeadBranch(this.id) };
  }

  // =========================================================================
  // Этап 2: Rewind-снапшоты, Intervene, консолидация истории
  // =========================================================================

  /**
   * Снапшот перед ходом — основа rewind. Хранится в saves под служебным
   * именем '__rewind__'; держим только один (последний) снапшот на игру.
   */
  private saveRewindSnapshot(): void {
    const saveData: SaveData = {
      currentTurn: this.currentTurn,
      currentDate: this.currentDate,
      players: this.players,
      regions: Array.from(this.regions.entries()),
      relationships: this.relationships.toJSON(),
      actions: this.actions,
      results: this.results,
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      pendingActions: this.pendingActions.filter(action => action.status === 'pending' || action.status === 'processing'),
      pausedSimulationId: this.pausedRun?.runId,
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
      economicState: captureEconomicSnapshot(this.id, gameRepository.getHeadBranch(this.id) || gameRepository.ensureMainBranch(this.id)),
    };
    const id = shortId();
    db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
      VALUES (?, ?, '__rewind__', ?, ?, ?, ?, ?)
    `).run(id, this.id, this.currentTurn, this.currentDate, JSON.stringify(saveData), semanticStateHash(saveData), new Date().toISOString());

    // Держим только последний rewind-снапшот
    db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__' AND id != ?").run(this.id, id);
  }

  /**
   * Откат на ход назад: восстанавливает снапшот, снятый перед последним ходом,
   * и вычищает «будущие» записи действий/результатов из БД.
   * Возвращает новое состояние или null, если откатываться некуда.
   */
  rewind(): { turn: number; date: string } | null {
    const save = db.prepare(
      "SELECT * FROM saves WHERE game_id = ? AND name = '__rewind__' ORDER BY saved_at DESC LIMIT 1"
    ).get(this.id) as any;
    if (!save) return null;

    let saveData: SaveData;
    try {
      saveData = JSON.parse(save.data);
    } catch (e) {
      console.error('[GameSession] Rewind: snapshot corrotto:', e);
      return null;
    }

    this.loadFromSave(saveData, save.content_hash ?? undefined);
    // Результат откаченного хода записан с turn == восстановленному currentTurn
    gameRepository.deleteAfterTurn(this.id, this.currentTurn - 1);
    // Снапшот потреблён — повторный rewind подряд невозможен
    db.prepare('DELETE FROM saves WHERE id = ?').run(save.id);

    this.broadcast('turn_complete', {
      turn: this.currentTurn,
      narration: '⏪ Ritorno al turno precedente',
      events: ['⏪ Turno annullato, il mondo è tornato allo stato precedente'],
      newTurn: this.currentTurn,
      newDate: this.currentDate,
      rewound: true,
    });

    console.log('[GameSession] Rewound to turn:', this.currentTurn, 'date:', this.currentDate);
    return { turn: this.currentTurn, date: this.currentDate };
  }

  /** Есть ли куда откатиться (для UI-кнопки). */
  canRewind(): boolean {
    const row = db.prepare(
      "SELECT 1 FROM saves WHERE game_id = ? AND name = '__rewind__' LIMIT 1"
    ).get(this.id);
    return !!row;
  }

  /**
   * Intervene: arresta lo stream logico dopo l'evento corrente; gli oggetti
   * successivi eventualmente già in transito non vengono applicati.
   */
  requestIntervene(simulationId?: string): { accepted: boolean; simulationId?: string } {
    if (!this.isProcessing || !this.activeSimulationRunId) return { accepted: false };
    if (simulationId && simulationId !== this.activeSimulationRunId) return { accepted: false };
    this.interveneRequested = true;
    this.activeSimulationAbort?.abort();
    console.log('[GameSession] Intervene requested for run:', this.activeSimulationRunId);
    return { accepted: true, simulationId: this.activeSimulationRunId };
  }

  // =========================================================================
  // §9.3 — Playback «un evento alla volta» per i salti fissi
  // =========================================================================

  /**
   * Il salto fisso con due o più eventi proposti entra in playback scaglionato:
   * il primo evento diventa il primo checkpoint per-evento e il run resta
   * «awaiting_next». Ogni «Continua» autorizza il checkpoint seguente, fino
   * all'avanzamento deterministico alla destinazione; «Intervieni qui»
   * chiude il salto al checkpoint mostrato.
   */
  private async _startPausedPlaybackUnlocked(opts: {
    simulationRunId: string;
    actions: PendingAction[];
    promptResult: any;
    proposedEvents: SimulationEvent[];
    periodStart: string;
    horizonDate: string;
  }): Promise<PendingAction[] | PausedBatchResult> {
    const headlineToActionIds: Record<string, string[]> = {};
    const outcomes = this.outcomesByActionId(
      opts.actions, opts.promptResult.actionOutcomes, opts.promptResult.convertedActions,
    );
    opts.actions.forEach(action => {
      const outcome = outcomes.get(action.id);
      outcome?.eventHeadlines?.forEach((headline: string) => {
        const ids = headlineToActionIds[headline] || [];
        ids.push(action.id);
        headlineToActionIds[headline] = ids;
      });
    });
    const state: PausedRunState = {
      runId: opts.simulationRunId,
      periodStart: opts.periodStart,
      destination: opts.horizonDate,
      jumpTurn: this.currentTurn,
      revisionBase: this.currentTurn + 1,
      remainingEvents: [...opts.proposedEvents],
      batchActionIds: opts.actions.map(action => action.id),
      movementIntents: this.captureMovementIntents(opts.actions),
      movementChanges: [],
      headlineToActionIds,
      incomplete: opts.promptResult.incomplete === true,
      changedRegions: [],
      completion: {
        narration: opts.promptResult.narration,
        convertedActions: opts.promptResult.convertedActions || [],
        actionOutcomes: opts.promptResult.actionOutcomes || [],
        voided: opts.promptResult.voided || [],
        worldChanges: opts.promptResult.worldChanges,
        relationshipChanges: opts.promptResult.relationshipChanges || [],
        startChat: opts.promptResult.startChat || [],
        effects: Array.isArray(opts.promptResult.effects) ? opts.promptResult.effects : [],
      },
      appliedCount: 0,
    };
    const first = state.remainingEvents.shift()!;
    console.log('[GameSession] §9.3: playback scaglionato del salto fisso, run', state.runId,
      '— eventi proposti:', opts.proposedEvents.length);
    const stepResult = await this._commitPausedStepUnlocked(state, first);
    // Con due o più proposte il primo checkpoint lascia sempre almeno un evento
    // in attesa: il run non può chiudersi qui. Se accade, lo stato è incoerente.
    if (!stepResult.paused) {
      throw new Error('Stato del playback scaglionato incoerente al primo checkpoint');
    }
    return stepResult;
  }

  /**
   * Applica UN evento del run in pausa e crea il relativo checkpoint. Se
   * restano proposte, il run torna «awaiting_next»; alla fine del playback
   * chiude il run (destinazione, budget o intervento).
   */
  private async _commitPausedStepUnlocked(
    state: PausedRunState,
    event: SimulationEvent,
  ): Promise<PausedBatchResult | CompletedBatchResult> {
    // Stesso contratto mappa della simulazione batch: le misure materiali
    // attestate dalle controparti NPC diventano marker anche nel playback.
    event = this.reconcileNpcMaterialMeasures(event);
    const runId = state.runId;
    const lastDate = this.currentDate;
    const eventDate = event.date;

    // F02 passo 4: ancora del mondo per il CAS e staging della RAM. Le
    // mutazioni qui sotto (mappa, economia, turno/data) sono transitorie:
    // solo il commit riuscito le rende canoniche, un errore le scarta.
    const anchorTurn = this.currentTurn;
    const anchorDate = this.currentDate;
    const staging = {
      regions: new Map<string, RegionState>(
        [...this.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      turn: this.currentTurn,
      date: this.currentDate,
      results: [...this.results],
      appliedCount: state.appliedCount,
      changedRegionsCount: state.changedRegions.length,
      movementChanges: [...(state.movementChanges || [])],
      remainingEvents: [event, ...state.remainingEvents],
      currentEventId: state.currentEventId,
      checkpointId: state.checkpointId,
      revision: state.revision,
      pausedRun: this.pausedRun,
    };
    // M06 µ5f (quarta revisione B2): closeReason vive FUORI dal try, così la
    // completion dell'ultimo evento è invocata DOPO il catch: un suo fault
    // non ripassa dal rollback pre-step sopra un run già chiuso 'failed'.
    let closeReason: 'paused_budget' | 'completed' | null = null;
    try {
    // Effetti mappa dell’evento: solo ora la proposta diventa applicata.
    const changedRegions = this.applyFrontierPlacements(
      event,
      this.applyMapChanges(event.mapChanges, event.date),
    ).map(region => ({
      id: region.id,
      owner: region.owner,
      color: region.color,
      name: region.name,
      population: region.population,
      gdp: region.gdp,
      militaryPower: region.militaryPower,
      objects: region.objects,
    }));
    for (const region of changedRegions) {
      const existing = state.changedRegions.find(changed => changed.id === region.id);
      if (existing) Object.assign(existing, region);
      else state.changedRegions.push(region);
    }

    state.movementChanges = [...(state.movementChanges || []), ...(event.mapChanges || [])
      .filter(change => ['move_unit', 'move_battalion', 'remove_unit'].includes(change.type))];

    // Economia deterministica dalla data dell'ultimo checkpoint a questa data.
    const elapsedDays = Math.round((Date.parse(eventDate) - Date.parse(lastDate)) / 86_400_000);
    const bulletins: string[] = [];

    // Il turno logico cresce una sola volta per l'intero salto (§9.1).
    if (state.appliedCount === 0) this.currentTurn = state.jumpTurn + 1;
    this.currentDate = eventDate;

    const stepId = shortId();
    const sourceActionIds = state.headlineToActionIds[event.headline] || [];
    const timelineEvents: TimelineEventRecord[] = [{
      id: `${stepId}-0`,
      date: eventDate,
      headline: this.publicText(event.headline),
      detail: this.publicText(event.description),
      source: 'world',
      simulationId: runId,
      sourceActionIds,
    }];
    const turnResult: TurnResultRecord = {
      id: stepId,
      simulationId: runId,
      turn: state.jumpTurn,
      narration: event.description,
      countryResponse: '',
      events: [this.publicText(event.headline), ...bulletins],
      timelineEvents,
      date: eventDate,
    };
    // F02 passo 2: le scritture canoniche del passo sono atomiche. Un errore
    // a metà (checkpoint, eventi, run) riporta il DB allo stato precedente:
    // nessun checkpoint orfano accanto a un mondo rimasto al passato. La
    // chiusura del run (se l'evento era l'ultimo) avviene FUORI dalla
    // transazione, dopo il commit del passo.
    let committedRevision = 0;
    let committedCheckpointId = '';
    let remainingEvents = 0;
    const reactionChatBroadcasts: Array<Record<string, unknown>> = [];
    withCanonicalTransaction(() => {
      // M06: tick e checkpoint condividono la stessa transazione/savepoint.
      // Un fault successivo annulla anche ledger e stato cashflow.
      if (elapsedDays > 0) {
        bulletins.push(...this.advanceWorldState(elapsedDays, eventDate));
        turnResult.events.push(...bulletins);
        timelineEvents.push(...bulletins.map((bulletin, index) => ({
          id: `${stepId}-b${index}`,
          date: eventDate,
          headline: 'Conti nazionali del periodo',
          detail: bulletin,
          source: 'world' as const,
          simulationId: runId,
        })));
      }
      const reactionChatEffects = this.openSimulationChats(this.reactionChatStarts([event], true), {
        turn: state.jumpTurn,
        fallbackDate: eventDate,
        simulationId: runId,
        events: [event],
        requireEventLink: true,
      });
      timelineEvents.push(...reactionChatEffects.timelineEvents);
      reactionChatBroadcasts.push(...reactionChatEffects.broadcasts);

      this.results.push(turnResult);
      // F03/A10: l’esito del batch è associato all’ID alla creazione; non verrà
      // mai letto per posizione da processWorldAdvance.
      this.lastCommittedResult = turnResult;
      gameRepository.addTurnResult({ ...turnResult, gameId: this.id });

      // Persist turn and date to DB in single operation. F02 passo 4: CAS
      // sull’ancora pre-commit — un mondo mutato altrove blocca il commit.
      this.syncRegionsToDB();
      if (!gameRepository.compareAndSwapTurnAndDate(this.id, anchorTurn, anchorDate, this.currentTurn, this.currentDate)) {
        throw new Error(`world_anchor_conflict: mondo mutato durante la pausa (atteso turno ${anchorTurn} del ${anchorDate})`);
      }

      // Il run in pausa referenzia il checkpoint: assegnalo PRIMA della cattura,
      // così un restore di questo checkpoint ripristina anche il playback (§9.3).
      // F02: revisione dal contatore monotono, non più da turno + indice.
      const previousRevision = gameRepository.getWorldRevision(this.id);
      const revision = gameRepository.nextWorldRevision(this.id);
      if (this.isStrictGame()) {
        const branchId = gameRepository.getHeadBranch(this.id);
        if (!branchId) throw new Error('strict_branch_missing');
        promotePlaybackEffectAnchors(this.id, branchId, previousRevision, revision, state.completion.effects);
      }
      const checkpointId = shortId();
      const eventOrdinal = state.appliedCount; // ordinale dell'evento nel playback (broadcast)
      state.currentEventId = `${stepId}-0`;
      state.checkpointId = checkpointId;
      state.revision = revision;
      // Il checkpoint cattura lo stato del passo *successivo*: dopo restore la
      // revisione resta crescente e non si ricommette l'evento appena letto.
      state.appliedCount += 1;
      this.pausedRun = state;
      gameRepository.createSimulationCheckpoint({
        id: checkpointId, runId, gameId: this.id, revision,
        turn: state.jumpTurn, date: eventDate, data: this.captureCheckpointData(),
      });
      gameRepository.addSimulationEvents(timelineEvents.map(timelineEvent => ({
        id: timelineEvent.id,
        runId,
        checkpointId,
        gameId: this.id,
        date: timelineEvent.date,
        headline: timelineEvent.headline,
        detail: timelineEvent.detail,
        source: timelineEvent.source,
        sourceActionIds: timelineEvent.sourceActionIds,
      })));
      this.enqueueOutboxRows(runId, checkpointId, revision, state.jumpTurn, timelineEvents);

      remainingEvents = state.remainingEvents.length;

      // Fine del playback: l'ultimo evento chiude il run subito se il budget è
      // esaurito o se la destinazione coincide con la data dell'evento.
      // La chiusura NON avviene qui: solo il marker (nessun await in transazione).
      if (remainingEvents === 0) {
        if (state.incomplete) closeReason = 'paused_budget';
        else if (eventDate >= state.destination) closeReason = 'completed';
      }

      if (!closeReason) {
        // Pausa durevole: le proposte restanti non sono canoniche e sopravvivono
        // a riavvio/save/load dentro il run (pending_state).
        // Nessuna LLM è in volo: la finestra di intervento è quella del lettore.
        this.activeSimulationRunId = null;
        this.activeSimulationAbort = null;
        gameRepository.pauseSimulationRun(runId, {
          checkpointDate: eventDate,
          checkpointId,
          turn: state.jumpTurn,
          pendingState: state,
        });
      }
      committedRevision = revision;
      committedCheckpointId = checkpointId;
    });

    // La chat nasce solo dopo il commit del checkpoint che contiene l'evento.
    for (const payload of reactionChatBroadcasts) this.broadcast('chat_message', payload);

    if (!closeReason) {
    const remaining = remainingEvents;
    const revision = committedRevision;
    const checkpointId = committedCheckpointId;
    const eventOrdinal = state.appliedCount - 1; // ordinale dell'evento appena committato
    this.publishPendingOutbox();
    this.broadcast('jump_event', {
      turn: state.jumpTurn,
      index: eventOrdinal,
      event: { ...event, headline: this.publicText(event.headline), description: this.publicText(event.description) },
      eventId: state.currentEventId,
      checkpointId: state.checkpointId,
      revision: state.revision,
      streaming: false,
      checkpoint: true,
      changedRegions,
      newDate: eventDate,
      newTurn: this.currentTurn,
      simulationId: runId,
      awaitingNext: { remaining, destination: state.destination },
    });
    console.log('[GameSession] §9.3: checkpoint per-evento', eventDate,
      '— run in attesa di «Continua»/«Intervieni»');
    return {
      paused: true,
      type: 'awaiting_next',
      simulationId: runId,
      event: {
        id: `${stepId}-0`,
        date: eventDate,
        headline: this.publicText(event.headline),
        detail: this.publicText(event.description),
        source: 'world',
        sourceActionIds,
      },
      remaining,
      destination: state.destination,
      checkpointId,
      revision,
      newDate: eventDate,
      newTurn: this.currentTurn,
      changedRegions,
    };
    }
    } catch (e) {
      // F02 passo 4: scarto dello staging — mappa, economia, turno/data e
      // stato del run tornano al checkpoint confermato più recente.
      this.regions = staging.regions;
      this.currentTurn = staging.turn;
      this.currentDate = staging.date;
      this.results = staging.results;
      state.appliedCount = staging.appliedCount;
      state.changedRegions.length = staging.changedRegionsCount;
      state.movementChanges = staging.movementChanges;
      state.remainingEvents = [...staging.remainingEvents];
      state.currentEventId = staging.currentEventId;
      state.checkpointId = staging.checkpointId;
      state.revision = staging.revision;
      this.pausedRun = staging.pausedRun;
      throw e;
    }
    // M06 µ5f: la completion dell'ultimo evento NON passa dal catch dello
    // step: il suo rollback interno (post-step + run 'failed' + requeue)
    // resta l'unica contabilità dell'errore, senza il doppio rollback pre-step.
    if (closeReason) return this._completePausedRunUnlocked(state, closeReason);
    throw new Error('playback step senza pausa né chiusura');
  }

  /**
   * Chiude il run scaglionato: porta il mondo a destinazione («completed»)
   * oppure lo ferma all'ultimo checkpoint confermato («paused_budget» /
   * «intervened»), finalizza gli ordini del lotto e pubblica il riepilogo.
   */
  private async _completePausedRunUnlocked(
    state: PausedRunState,
    reason: 'completed' | 'paused_budget' | 'intervened',
  ): Promise<CompletedBatchResult> {
    const runId = state.runId;
    const completion = state.completion;
    const player = this.players[0];
    if (!player) throw new Error('No player in session');
    const playerRegion = this.regions.get(player.regionId);
    if (!playerRegion) throw new Error('Player region not found');

    const destinationReached = reason === 'completed';
    const lastEventDate = this.currentDate;
    const finalDate = destinationReached ? state.destination : lastEventDate;

    // F02 passo 4: ancora del mondo per il CAS e staging della RAM. Il commit
    // riuscito promuove lo staging; ogni errore lo scarta e la RAM torna
    // esattamente al checkpoint confermato più recente.
    const anchorTurn = this.currentTurn;
    const anchorDate = this.currentDate;
    const staging = {
      regions: new Map<string, RegionState>(
        [...this.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      relationships: this.relationships.toJSON(),
      actions: [...this.actions],
      results: [...this.results],
      pendingActions: this.pendingActions.map(action => ({ ...action })),
      turn: this.currentTurn,
      date: this.currentDate,
      interveneRequested: this.interveneRequested,
      pausedRun: this.pausedRun,
    };

    // Cronaca canonica del run: gli eventi applicati, con le loro date.
    const appliedRows = gameRepository.getSimulationEvents(this.id, runId);
    const appliedHeadlines = new Set(appliedRows.map(row => row.headline));
    const voided = completion.voided || [];
    const voidedHeadlines = voided.map(v => `${this.publicPolityName(this.playerPolityId)} non attua la direttiva «${this.publicText(v.action)}»${v.reason ? `: ${this.publicText(v.reason)}` : '.'}`);

    // Gli effetti globali del record «complete» appartengono all'intero
    // periodo: si applicano soltanto quando la destinazione è raggiunta.
    // Su intervento o budget il futuro non simulato non entra nel mondo (§8.2).
    const persistedRelationshipChanges: {
      from: string; to: string; newRelationship: RelationshipType; reason: string;
    }[] = [];
    const chatTimelineEvents: TimelineEventRecord[] = [];
    const chatBroadcasts: Array<Record<string, unknown>> = [];
    // Variabili prodotte dentro la transazione e lette fuori (broadcast e
    // ritorno): la callback è sempre eseguita per intero o ha rilanciato.
    let narration!: string;
    let runEvents!: string[];
    let runEventDetails!: TimelineEventRecord[];
    let batchActions!: PendingAction[];
    // F02 passo 2: commit canonico atomico della chiusura del run — anche
    // qui tutte le scritture in una sola transazione breve; broadcast e
    // consolidamento restano fuori. Un protocol error (es. projectId non
    // accettato) riporta il DB integro allo stato del checkpoint precedente.
    try {
    withCanonicalTransaction(() => {
    if (destinationReached) {
      if (this.isStrictGame()) applyStagedStrictEffects(this.id, gameRepository.getHeadBranch(this.id)!, gameRepository.getWorldRevision(this.id), completion.effects || []);
      if (completion.worldChanges) this.applyWorldChanges(completion.worldChanges);
      const polityResolver = this.buildResolvers().polities;
      for (const change of completion.relationshipChanges) {
        const from = polityResolver.resolve(change.from);
        const to = polityResolver.resolve(change.to);
        if (!from || !to || from.isNew || to.isNew || from.polityId === to.polityId) continue;
        this.relationships.set(from.polityId, to.polityId, change.relationship);
        persistedRelationshipChanges.push({
          from: from.polityId,
          to: to.polityId,
          newRelationship: change.relationship,
          reason: change.reason || 'Conseguenza diplomatica del turno',
        });
      }
      // F02 passo 2: la transazione è aperta prima dell’if destinationReached.
      relationshipRepository.upsertForGame(this.id, persistedRelationshipChanges);
      const chatEffects = this.openSimulationChats(completion.startChat, {
        turn: state.jumpTurn,
        fallbackDate: finalDate,
        simulationId: runId,
        events: appliedRows,
      });
      chatTimelineEvents.push(...chatEffects.timelineEvents);
      chatBroadcasts.push(...chatEffects.broadcasts);
    }

    // Anche nel playback scaglionato un movimento accettato deve avvenire: se
    // il modello ha omesso `move_unit`, il motore lo completa e lo aggiunge al
    // delta cumulativo del run.
    if (destinationReached) {
      const reconciliationActions = state.batchActionIds
        .map(id => this.pendingActions.find(action => action.id === id))
        .filter((action): action is PendingAction => !!action);
      for (const region of this.reconcileAcceptedMoves(reconciliationActions, completion.actionOutcomes || [], state.movementIntents || [], state.movementChanges || [], finalDate)) {
        const snapshot = {
          id: region.id, owner: region.owner, color: region.color, name: region.name,
          population: region.population, gdp: region.gdp, militaryPower: region.militaryPower,
          objects: region.objects,
        };
        const existing = state.changedRegions.find(changed => changed.id === region.id);
        if (existing) Object.assign(existing, snapshot);
        else state.changedRegions.push(snapshot);
      }
    }

    // Economia deterministica fino alla data finale effettiva.
    const elapsedDays = Math.round((Date.parse(finalDate) - Date.parse(lastEventDate)) / 86_400_000);
    const bulletins = this.isStrictGame() || elapsedDays > 0 ? this.advanceWorldState(elapsedDays, finalDate) : [];

    // Record finale: riepilogo tecnico del periodo, non seconda fonte di
    // mutazioni. Gli eventi applicati vivono nei record per-evento.
    const interruptionHeadline = reason === 'paused_budget'
      ? 'Nessun ulteriore sviluppo viene confermato nel periodo'
      : 'La cronaca si arresta alla data scelta dal governo';
    narration = this.publicText(destinationReached
      ? completion.narration
      : appliedRows.map(row => row.detail).filter(Boolean).join('\n\n') || interruptionHeadline);
    const finalTimelineEvents: TimelineEventRecord[] = [
      ...bulletins.map((bulletin, index) => ({
        id: `${shortId()}-b${index}`,
        date: finalDate,
        headline: 'Conti nazionali del periodo',
        detail: bulletin,
        source: 'world' as const,
        simulationId: runId,
      })),
      ...persistedRelationshipChanges.map((change, index) => ({
        id: `${shortId()}-rel-${index}`,
        date: finalDate,
        headline: `${this.publicPolityName(change.from)} e ${this.publicPolityName(change.to)} ridefiniscono i rapporti`,
        detail: `Il rapporto diventa ${this.publicText(change.newRelationship)}: ${this.publicText(change.reason)}`,
        source: 'diplomacy' as const,
        simulationId: runId,
      })),
      ...chatTimelineEvents,
    ];
    const finalEvents = destinationReached
      ? [...voidedHeadlines, ...bulletins]
      : [...voidedHeadlines, interruptionHeadline];
    const finalResult: TurnResultRecord = {
      id: shortId(),
      simulationId: runId,
      turn: state.jumpTurn,
      narration,
      countryResponse: completion.convertedActions.map((action: any) => action.text).join('\n'),
      events: finalEvents,
      timelineEvents: finalTimelineEvents,
      date: finalDate,
    };
    this.results.push(finalResult);
    gameRepository.addTurnResult({ ...finalResult, gameId: this.id });

    // Finalizzazione del lotto di ordini: esiti individuali collegati SOLO
    // agli eventi effettivamente applicati del run (§9.2: gli ordini emessi
    // non sono reinviati; un esito parziale resta un processo aperto).
    batchActions = state.batchActionIds
      .map(id => this.pendingActions.find(action => action.id === id))
      .filter((action): action is PendingAction => !!action);
    const actionRecords: ActionRecord[] = batchActions.map(item => ({
      id: item.id,
      playerId: player.id,
      turn: state.jumpTurn,
      text: item.text,
      createdAt: item.createdAt,
    }));
    this.actions.push(...actionRecords);
    actionRecords.forEach(actionRecord => gameRepository.addAction({
      id: actionRecord.id,
      gameId: this.id,
      playerId: player.id,
      turn: actionRecord.turn,
      text: actionRecord.text,
    }));

    runEvents = this.results
      .filter(record => record.simulationId === runId)
      .flatMap(record => record.events);
    runEventDetails = this.results
      .filter(record => record.simulationId === runId)
      .flatMap(record => record.timelineEvents || []);
    const outcomes = this.outcomesByActionId(
      batchActions, completion.actionOutcomes, completion.convertedActions,
    );
    batchActions.forEach(item => {
      const outcome = outcomes.get(item.id);
      const rejected = voided.find((result: any) => result.action === item.text);
      const outcomeStatus = outcome?.status || (rejected ? 'rejected' : undefined);
      const outcomeSummary = this.publicText(outcome?.summary || rejected?.reason);
      const outcomeEvents = outcome?.eventHeadlines?.length
        ? outcome.eventHeadlines.map((headline: string) => this.publicText(headline)).filter((headline: string) => appliedHeadlines.has(headline))
        : rejected ? voidedHeadlines.filter(headline => headline.includes(rejected.action)) : runEvents;
      item.status = 'completed';
      item.deliveryStatus = 'issued';
      item.executionStatus = 'completed';
      item.result = {
        narration: outcomeSummary || narration,
        countryResponse: finalResult.countryResponse,
        events: outcomeEvents,
        eventDetails: runEventDetails,
        simulationId: runId,
        outcome: outcomeStatus && outcomeSummary
          ? {
            status: outcomeStatus,
            summary: outcomeSummary,
            expectedDate: outcome?.expectedDate,
            completesProjectId: outcome?.completesProjectId,
          }
          : undefined,
        objects: playerRegion.objects,
        turn: state.jumpTurn,
        periodStart: state.periodStart,
        periodEnd: finalDate,
      };
    });
    batchActions.filter(action => action.result?.outcome?.status === 'partial').forEach(action => {
      gameRepository.upsertOngoingProcess({
        id: shortId(),
        gameId: this.id,
        sourceActionId: action.id,
        sourceRunId: runId,
        title: action.text,
        summary: action.result!.outcome!.summary,
        startedDate: state.periodStart,
        expectedDate: action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > state.periodStart
          ? action.result!.outcome!.expectedDate
          : undefined,
      });
    });
    batchActions.forEach(action => {
      const outcome = action.result?.outcome;
      if (!outcome?.completesProjectId) return;
      if (outcome.status !== 'accepted'
        || gameRepository.completeOngoingProcessById(this.id, outcome.completesProjectId, outcome.summary) !== 1) {
        throw new Error('simulation_protocol_error: completesProjectId is invalid or not accepted');
      }
    });
    gameRepository.addSimulationActionOutcomes(batchActions.map(action => ({
      id: shortId(),
      runId,
      gameId: this.id,
      actionId: action.id,
      status: action.result?.outcome?.status || 'unresolved',
      summary: action.result?.outcome?.summary || action.result?.narration || narration,
      eventHeadlines: action.result?.events || [],
    })));
    gameRepository.removePendingActions(this.id, batchActions.map(action => action.id));
    // Anche la coda in memoria perde gli ordini conclusi: la coda autorevole
    // non deve mostrarli come ancora in elaborazione.
    this.pendingActions = this.pendingActions
      .filter(action => !batchActions.some(batch => batch.id === action.id));

    // Data/turno definitivi e checkpoint di chiusura del run. F02 passo 4:
    // CAS sull’ancora pre-commit — un mondo mutato altrove blocca il commit.
    this.currentDate = finalDate;
    this.interveneRequested = false;
    this.pausedRun = null; // prima della cattura: il checkpoint non referenzia più il run
    this.syncRegionsToDB();
    if (!gameRepository.compareAndSwapTurnAndDate(this.id, anchorTurn, anchorDate, this.currentTurn, this.currentDate)) {
      throw new Error(`world_anchor_conflict: mondo mutato durante la pausa (atteso turno ${anchorTurn} del ${anchorDate})`);
    }
    const finalCheckpointId = shortId();
    const finalRevision = gameRepository.nextWorldRevision(this.id);
    gameRepository.createSimulationCheckpoint({
      id: finalCheckpointId, runId, gameId: this.id, revision: finalRevision,
      turn: state.jumpTurn, date: finalDate, data: this.captureCheckpointData(),
    });
    gameRepository.addSimulationEvents(finalTimelineEvents.map(event => ({
      id: event.id,
      runId,
      checkpointId: finalCheckpointId,
      gameId: this.id,
      date: event.date,
      headline: event.headline,
      detail: event.detail,
      source: event.source,
      sourceActionIds: event.sourceActionIds,
    })));
    this.enqueueOutboxRows(runId, finalCheckpointId, finalRevision, state.jumpTurn, finalTimelineEvents);
    gameRepository.finishSimulationRun(runId, reason, {
      checkpointDate: finalDate,
      checkpointId: finalCheckpointId,
      turn: state.jumpTurn,
    });
      }); // fine transazione canonica (F02 passo 2)
      this.publishPendingOutbox();
    } catch (e) {
      // F02 passo 4: scarto dello staging — la RAM torna esattamente al
      // checkpoint confermato più recente, coerente con il DB rollbackato.
      this.regions = staging.regions;
      this.relationships = RelationshipMatrix.fromJSON(staging.relationships);
      this.actions = staging.actions;
      this.results = staging.results;
      this.pendingActions = staging.pendingActions;
      this.currentTurn = staging.turn;
      this.currentDate = staging.date;
      this.interveneRequested = staging.interveneRequested;
      if (this.isStrictGame()) {
        const pausedFallbackActions = this.pendingActions.map(action => ({ ...action }));
        this.pausedRun = null;
        this.activeSimulationRunId = null;
        this.activeSimulationAbort = null;
        for (const action of this.pendingActions) {
          if (!state.batchActionIds.includes(action.id)) continue;
          action.status = 'pending';
          action.deliveryStatus = 'queued';
          action.executionStatus = 'not_started';
        }
        // M06: un completion strict invalido chiude il run, non lascia una
        // finestra awaiting_next riutilizzabile sopra uno staging fallito.
        try {
          withCanonicalTransaction(() => {
            gameRepository.finishSimulationRun(runId, 'failed', { error: e instanceof Error ? e.message : String(e) });
            gameRepository.replacePendingActions(this.id, this.pendingActions);
          });
        } catch (failureError) {
          this.pendingActions = pausedFallbackActions;
          this.pausedRun = staging.pausedRun;
          console.error('[GameSession] Failed to persist paused-run failure:', failureError);
        }
      } else {
        // Compatibilità legacy: un protocol error mantiene aperto il lettore
        // sul checkpoint confermato, come prima di M06.
        this.pausedRun = staging.pausedRun;
      }
      throw e;
    }

    // F02/M06: SSE solo dopo il commit riuscito; il rollback non può pubblicare chat fantasma.
    for (const payload of chatBroadcasts) this.broadcast('chat_message', payload);
    this.broadcast('turn_complete', {
      turn: state.jumpTurn,
      narration,
      events: runEvents,
      eventDetails: runEventDetails,
      newTurn: this.currentTurn,
      newDate: this.currentDate,
      changedRegions: state.changedRegions,
      intervened: reason === 'intervened',
      pausedBudget: reason === 'paused_budget',
    });

    // La consolazione della memoria e il commento del consigliere non devono
    // compromettere un salto già chiuso con successo.
    try {
      await this.maybeConsolidate();
    } catch (e) {
      console.error('[GameSession] Consolidation failed (turn kept):', e);
    }
    this.getAdvisorUnchecked(
      'Commenta brevemente (max 500 caratteri) gli esiti del periodo appena trascorso per il tuo leader, in italiano',
      []
    )
      .then(content => this.broadcast('advisor_proactive', { content }))
      .catch(e => console.error('[GameSession] Proactive advisor failed:', e));

    this.activeSimulationRunId = null;
    this.activeSimulationAbort = null;
    console.log('[GameSession] §9.3: run scaglionato chiuso:', reason, '— data finale:', this.currentDate);
    return {
      paused: false,
      type: reason === 'completed' ? 'run_completed' : reason,
      simulationId: runId,
      actions: batchActions,
      result: {
        turn: state.jumpTurn,
        narration,
        events: runEvents,
        eventDetails: runEventDetails,
        periodStart: state.periodStart,
        periodEnd: finalDate,
      },
      newDate: this.currentDate,
      newTurn: this.currentTurn,
      destination: destinationReached ? undefined : state.destination,
    };
  }

  /** «Continua»: autorizza il checkpoint per-evento successivo del run sospeso. */
  async continueSimulation(runId: string): Promise<PausedBatchResult | CompletedBatchResult> {
    const result = await this.withLock(async () => {
      if (!this.pausedRun || this.pausedRun.runId !== runId) {
        throw new Error('Il run indicato non è in pausa per questa partita');
      }
      const state = this.pausedRun;
      // Una proposta stantia (per esempio dopo un restore) non retrodata il mondo.
      let event = state.remainingEvents.shift();
      while (event && !dateInPeriod(event.date, this.currentDate, state.destination)) {
        console.warn('[GameSession] §9.3: proposta fuori periodo scartata:', event.date);
        event = state.remainingEvents.shift();
      }
      if (event) return this._commitPausedStepUnlocked(state, event);
      // Nessuna proposta residua: «Continua» autorizza l'avanzamento a
      // destinazione — o la chiusura onesta se il budget non ha coperto il
      // periodo richiesto (§7.2/T36).
      return this._completePausedRunUnlocked(state, state.incomplete ? 'paused_budget' : 'completed');
    });
    if (result === null) throw new SimulationInProgressError();
    return result;
  }

  /** §9.3 «Intervieni qui»: chiude il salto al checkpoint mostrato. */
  async tryIntervenePausedRun(
    simulationId?: string,
    eventId?: string,
    revision?: number,
  ): Promise<CompletedBatchResult | null> {
    const state = this.pausedRun;
    if (!state) return null;
    if (simulationId && simulationId !== state.runId) return null;
    // G22: un controllo arriva solo al checkpoint che il lettore sta davvero
    // mostrando. Una richiesta stale non può chiudere un evento successivo.
    if ((eventId && eventId !== state.currentEventId)
      || (revision != null && revision !== state.revision)) {
      throw new SimulationStaleCheckpointError(state.runId, eventId, revision);
    }
    const result = await this.withLock(async () => {
      if (this.pausedRun !== state) return undefined; // già chiuso da una richiesta concorrente
      return this._completePausedRunUnlocked(state, 'intervened');
    });
    if (result === undefined) return null;
    if (result === null) throw new SimulationInProgressError();
    return result;
  }

  /** Stato del playback sospeso, per API e riconciliazione del client. */
  getPausedRunInfo(): {
    simulationId: string; remaining: number; destination: string;
    date: string; turn: number; incomplete: boolean;
    eventId?: string; checkpointId?: string; revision?: number;
  } | null {
    if (!this.pausedRun) return null;
    return {
      simulationId: this.pausedRun.runId,
      remaining: this.pausedRun.remainingEvents.length,
      destination: this.pausedRun.destination,
      date: this.currentDate,
      turn: this.currentTurn,
      incomplete: this.pausedRun.incomplete,
      eventId: this.pausedRun.currentEventId,
      checkpointId: this.pausedRun.checkpointId,
      revision: this.pausedRun.revision,
    };
  }

  /** Ricostruisce il playback sospeso di un salvataggio/checkpoint. */
  private _revivePausedRun(pausedSimulationId?: string): PausedRunState | null {
    if (!pausedSimulationId) return null;
    const row = db.prepare(
      'SELECT id, status, pending_state FROM simulation_runs WHERE id = ? AND game_id = ?'
    ).get(pausedSimulationId, this.id) as any;
    if (!row || row.status !== 'awaiting_next' || !row.pending_state) return null;
    let parsed: any = null;
    try { parsed = JSON.parse(row.pending_state); } catch { return null; }
    return this._revivePausedRunState(parsed);
  }

  private _revivePausedRunFromRow(row: any): PausedRunState | null {
    if (!row?.pendingState) return null;
    const raw = typeof row.pendingState === 'string'
      ? (() => { try { return JSON.parse(row.pendingState); } catch { return null; } })()
      : row.pendingState;
    return this._revivePausedRunState(raw);
  }

  private _revivePausedRunState(raw: any): PausedRunState | null {
    try {
      if (!raw || typeof raw.runId !== 'string' || !Array.isArray(raw.remainingEvents)) return null;
      const remainingEvents = raw.remainingEvents.filter((event: any) =>
        event && typeof event.headline === 'string' && typeof event.date === 'string'
        && Array.isArray(event.mapChanges)
      );
      if (typeof raw.periodStart !== 'string' || typeof raw.destination !== 'string') return null;
      return {
        runId: raw.runId,
        periodStart: raw.periodStart,
        destination: raw.destination,
        jumpTurn: Number.isInteger(raw.jumpTurn) ? raw.jumpTurn : this.currentTurn,
        revisionBase: Number.isInteger(raw.revisionBase) ? raw.revisionBase : this.currentTurn + 1,
        remainingEvents,
        batchActionIds: Array.isArray(raw.batchActionIds) ? raw.batchActionIds : [],
        movementIntents: Array.isArray(raw.movementIntents) ? raw.movementIntents : [],
        movementChanges: Array.isArray(raw.movementChanges) ? raw.movementChanges : [],
        headlineToActionIds: raw.headlineToActionIds && typeof raw.headlineToActionIds === 'object' ? raw.headlineToActionIds : {},
        incomplete: raw.incomplete === true,
        changedRegions: Array.isArray(raw.changedRegions) ? raw.changedRegions : [],
        completion: {
          narration: typeof raw.completion?.narration === 'string' ? raw.completion.narration : '',
          convertedActions: Array.isArray(raw.completion?.convertedActions) ? raw.completion.convertedActions : [],
          actionOutcomes: Array.isArray(raw.completion?.actionOutcomes) ? raw.completion.actionOutcomes : [],
          voided: Array.isArray(raw.completion?.voided) ? raw.completion.voided : [],
          worldChanges: raw.completion?.worldChanges,
          relationshipChanges: Array.isArray(raw.completion?.relationshipChanges) ? raw.completion.relationshipChanges : [],
          startChat: Array.isArray(raw.completion?.startChat) ? raw.completion.startChat : [],
          effects: Array.isArray(raw.completion?.effects) ? raw.completion.effects as StrictEffect[] : [],
        },
        appliedCount: Number.isInteger(raw.appliedCount) ? raw.appliedCount : 0,
        currentEventId: typeof raw.currentEventId === 'string' ? raw.currentEventId : undefined,
        checkpointId: typeof raw.checkpointId === 'string' ? raw.checkpointId : undefined,
        revision: Number.isInteger(raw.revision) ? raw.revision : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Консолидация истории (механика оригинала): когда раундов накопилось
   * больше consolidation.chunkSize поверх consolidatedUpTo — LLM-саммари
   * старых раундов дописывается в consolidated_history, а в промпты
   * подаётся саммари + сырой хвост последних раундов.
   */
  private async maybeConsolidate(): Promise<void> {
    const cfg = this.llm.consolidation;
    const lastTurn = this.currentTurn - 1;
    if (lastTurn < cfg.startRound) return;
    if (lastTurn - this.consolidatedUpTo < cfg.chunkSize) return;

    const toSummarize = this.results.filter(
      r => r.turn > this.consolidatedUpTo && r.turn <= lastTurn
    );
    if (toSummarize.length === 0) return;

    console.log(`[GameSession] Consolidating rounds ${this.consolidatedUpTo + 1}..${lastTurn} (${toSummarize.length} turni)`);

    const system = 'Sei il cronista di un gioco strategico. Condensa la storia mantenendo i fatti, scrivendo in italiano.';
    const user = `Qui sotto c'è la cronaca dei turni già vissuti di un gioco strategico (turni ${this.consolidatedUpTo + 1}–${lastTurn}).
${this.consolidatedHistory ? `\n[Cronaca già consolidata dei turni precedenti]\n${this.consolidatedHistory}\n` : ''}
[Nuovi turni da condensare]
${toSummarize.map(r => `Turno ${r.turn}: ${r.narration}`).join('\n\n')}

Condensa TUTTA la storia in una MEMORIA CANONICA di massimo 220 parole, in italiano.
Usa frasi fattuali e dense, senza stile letterario. Conserva sempre: cambi di proprietà delle regioni,
guerre e trattati di pace, alleanze, decisioni chiave del giocatore, impegni ancora aperti e conseguenze.
Non inventare nuovi fatti né statistiche. Il riassunto sarà l'unica memoria remota passata ai turni futuri.`;

    const res = await this.llm.generate('consolidation', system, user, { temperature: 0.2, maxTokens: 900 });
    this.consolidatedHistory = res.content;
    this.consolidatedUpTo = lastTurn;
    gameRepository.updateConsolidation(this.id, this.consolidatedHistory, this.consolidatedUpTo);
    console.log('[GameSession] Consolidated history updated, length:', this.consolidatedHistory.length);
  }

  /**
   * Get all relationships for the frontend UI
   */
  getRelationships(): Record<string, Record<string, string>> {
    return this.relationships.toJSON();
  }

  /** Dossier aggregati aggiornati dalla fonte di verità provinciale. */
  getNationalAccounts() {
    return WorldStateEngine.accounts(this.regions.values());
  }

  /** Rende definitivo uno snapshot caricato: prima questa operazione mutava
   * solo la RAM, quindi al refresh data, turno e dispacci tornavano allo stato
   * precedente registrato nel database. */
  async persistLoadedState(): Promise<void> {
    await this.syncRegionsToDB();
    gameRepository.replaceHistory(this.id, this.actions, this.results);
    const relationshipRows = Object.entries(this.relationships.toJSON()).flatMap(([from, targets]) =>
      Object.entries(targets as Record<string, RelationshipType>).map(([to, type]) => ({ from, to, type }))
    );
    relationshipRepository.replaceForGame(this.id, relationshipRows);
    gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);
  }

  /**
   * Get advisor response using prompt system
   */
  async getAdvisor(message: string, history: any[] = []): Promise<string> {
    // F04 passo 3: politica esplicita durante un run — 409, non un consiglio
    // calcolato su un contesto già congelato. L'advisor non persiste nulla:
    // la risposta resta per costruzione una bozza.
    if (this.hasActiveRun()) throw new SimulationInProgressError();
    return this.getAdvisorUnchecked(message, history);
  }

  /**
   * Consiglio senza guardia di run: riservato al commento proattivo del run
   * appena chiuso (stesso ramo, stessa revisione commessa — nessun write-back,
   * solo broadcast).
   */
  private async getAdvisorUnchecked(message: string, history: any[]): Promise<string> {
    const gameData = this.buildGameData();
    return this.gameController.getAdvisorWithPrompts(gameData, message, history);
  }

  /**
   * Streaming-вариант советника (Этап 3): токены приходят в onToken
   * (число символов накопленного ответа), возвращается полный текст.
   */
  async getAdvisorStream(message: string, history: any[] = [], onToken: (chars: number) => void): Promise<string> {
    // F04 passo 3: stessa politica del non-streaming (409 durante un run).
    if (this.hasActiveRun()) throw new SimulationInProgressError();
    const gameData = this.buildGameData();
    return this.gameController.getAdvisorStreamWithPrompts(gameData, message, history, onToken);
  }

  // =========================================================================
  // F04 passo 3 — fencing ramo/revisione per chat e advisor
  // =========================================================================

  /** Cattura ramo/revisione all'inizio di una richiesta conversazionale. */
  fenceContext(): { branchId: string | null; revision: number } {
    return { branchId: gameRepository.getHeadBranch(this.id), revision: gameRepository.getWorldRevision(this.id) };
  }

  /** Verifica la validità del fence PRIMA di qualsiasi write-back. */
  private assertFenceValid(fence: { branchId: string | null; revision: number }): void {
    if (this.hasActiveRun()) throw new SimulationInProgressError();
    const current = this.fenceContext();
    if (current.branchId !== fence.branchId || current.revision !== fence.revision) {
      throw new ContextChangedError(fence.branchId, fence.revision);
    }
  }

  /**
   * Get suggestions using actions.md prompts
   */
  async getSuggestions(): Promise<any[]> {
    const gameData = this.buildGameData();
    return this.gameController.getSuggestionsWithPrompts(gameData);
  }

  // =========================================================================
  // Pending Actions Queue (Phase 2)
  // =========================================================================

  /**
   * F02 passo 3: registra gli eventi canonici nell’outbox. Va invocata DENTRO
   * la transazione canonica, subito dopo addSimulationEvents: eventi e outbox
   * commettono o rollbackano insieme. Gli ID sono quelli stabili degli eventi.
   */
  private enqueueOutboxRows(
    runId: string,
    checkpointId: string,
    revision: number,
    turn: number,
    rows: Array<{ id: string; date: string; headline: string; detail?: string; source: string; sourceActionIds?: string[] }>,
  ): void {
    if (!rows.length) return;
    gameRepository.enqueueOutbox(rows.map(event => ({
      id: event.id,
      gameId: this.id,
      runId,
      eventId: event.id,
      payload: {
        type: 'world_event' as const,
        eventId: event.id,
        runId,
        checkpointId,
        revision,
        turn,
        date: event.date,
        headline: event.headline,
        detail: event.detail ?? '',
        source: event.source,
        sourceActionIds: event.sourceActionIds || [],
      },
    })));
  }

  /**
   * F02 passo 3: pubblicatore outbox — separato e ripetibile. Pubblica solo
   * eventi già committati, in ordine di sequenza; marca «published» solo dopo
   * la diffusione (almeno-una-volta: un crash tra diffusione e marcia ripete
   * la diffusione con gli stessi ID stabili, e il client deduplica). Senza
   * client SSE le righe restano «pending»: il flush avviene alla (ri)connessione.
   */
  publishPendingOutbox(limit = 200): number {
    if (!this.sseBroadcaster) return 0;
    try {
      const rows = gameRepository.pendingOutbox(this.id, limit);
      if (!rows.length) return 0;
      const published: string[] = [];
      for (const row of rows) {
        let payload: unknown;
        try { payload = JSON.parse(row.payload); } catch { payload = null; }
        if (!payload || !this.broadcast('world_event', payload)) break;
        published.push(row.id);
      }
      if (published.length) gameRepository.markOutboxPublished(this.id, published);
      return published.length;
    } catch (error) {
      // Il commit è già riuscito: conserva pending per retry, mai rollback finto.
      console.error('[GameSession] Outbox publish failed after commit:', error);
      return 0;
    }
  }

  /**
   * Add action to pending queue (without processing)
   */
  queueAction(text: string): PendingAction {
    const action: PendingAction = {
      id: shortId(),
      text,
      createdAt: new Date().toISOString(),
      status: 'pending',
      deliveryStatus: 'queued',
      executionStatus: 'not_started',
    };
    this.pendingActions.push(action);
    gameRepository.queuePendingAction({
      id: action.id,
      gameId: this.id,
      text: action.text,
      createdAt: action.createdAt,
      status: action.status,
    });
    console.log('[GameSession] Queued action:', action.id, 'text:', text.substring(0, 50));
    return action;
  }

  /**
   * G24 — «Migliora formulazione»: produce un'anteprima riformulata di un
   * ordine libero SENZA accodarla né simulare. L'accettazione resta un click
   * esplicito del giocatore (queueAction). Non altera il tempo né la coda.
   */
  async enhanceAction(text: string): Promise<{ original: string; enhanced: string }> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Il testo dell’ordine è obbligatorio');
    if (!this.gameController) throw new Error('Prompt engine non inizializzato');
    const converted = await this.gameController.enhanceAction(this.buildGameData(), trimmed);
    const enhanced = converted.text && converted.text.trim() ? converted.text.trim() : trimmed;
    return { original: trimmed, enhanced };
  }

  /**
   * G4-B — verifica fattibilità da testo libero (sola lettura).
   *
   * Delega a checkFeasibilityWithCosts e restituisce solo l'assessment.
   */
  async checkFeasibility(text: string): Promise<OrderAssessment> {
    const { assessment } = await this.checkFeasibilityWithCosts(text);
    return assessment;
  }

  /**
   * G4-B/G4-D — verifica completa: assessment + stima costi da catalogo in un
   * solo percorso LLM. La stima è sola lettura e usa solo dati autorevoli.
   */
  async checkFeasibilityWithCosts(text: string): Promise<{ assessment: OrderAssessment; costs: CostEstimate }> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Il testo dell’ordine è obbligatorio');
    }
    if (!this.promptEngine) {
      throw new Error('Prompt engine non inizializzato');
    }

    // Testo libero → intent: stesso batch LLM del salto, con un solo ordine.
    const gameData = this.buildGameData();
    const tempId = shortId();
    const convertedActions = await this.promptEngine.convertActionsBatch(
      gameData,
      [{ actionId: tempId, text: trimmed }],
      undefined,
    );

    if (!convertedActions || convertedActions.length === 0) {
      throw new Error('Impossibile convertire il testo in intenzione');
    }

    const convertedAction = convertedActions[0];

    // Normalizzazione canonica: fallisce con needs_clarification se il testo
    // non individua un intent completo (tipo, target, catalogo, autorizzazione).
    const normalized = normalizeOrderIntent(convertedAction);

    // Identità: mondo con catalog binding e attore tesoreria della polity.
    const worldRow = worldRepository.findById(this.worldId) as { template_id?: unknown } | undefined;
    const templateId = worldRow?.template_id;
    if (typeof templateId !== 'string' || !templateId) {
      throw new Error('Mondo legacy senza catalog binding');
    }

    const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
    if (!loaded.catalog) {
      throw new Error('Catalogo server non valido');
    }

    // La stima costa esiste anche per un intent non normalizzabile: l'eventuale
    // catalogRef già presente orienta la proiezione; altrimenti è 'none'.
    const costs = estimateIntentCosts(loaded.catalog, normalized.ok ? normalized.intent : {
      id: tempId,
      actorPolityId: '',
      originalText: trimmed,
      actionKind: 'qualitative',
      targetIds: [],
      priority: 0,
      dependencyIds: [],
      authorization: { allowPartialStart: false, allowedPhaseIds: [] },
    } as never);

    if (!normalized.ok) {
      return {
        assessment: {
          actionId: tempId,
          status: 'blocked',
          blockers: normalized.clarifications.map(c => ({
            code: c.code as ReasonCode,
            detail: c.message,
          })),
          warnings: [],
          alternatives: [],
        },
        costs,
      };
    }

    const player = this.getPlayer();
    const polity = player?.polityId;
    if (!polity) {
      throw new Error('Identità politica del giocatore non disponibile');
    }

    const actor = loaded.catalog.actors.find(
      item => item.polityId === polity && item.type === 'treasury',
    );
    if (!actor) {
      throw new Error('Attore economico (tesoreria) non trovato per la polity');
    }

    const assessment = new FeasibilityService(loaded.catalog).evaluate(normalized.intent, {
      actorId: actor.actorId,
      verifiedPolityId: polity,
      approvals: [],
      rights: [],
      knowledgeIds: [],
      capabilityIds: [],
    });

    return { assessment, costs };
  }

  /**
   * Get all pending actions
   */
  getPendingActions(): PendingAction[] {
    return this.pendingActions;
  }

  getQueueVersion(): number {
    return gameRepository.getQueueVersion(this.id);
  }

  /**
   * Risolve gli esiti LLM con la chiave canonica. Il testo è ammesso soltanto
   * nell'adapter legacy e solo quando individua una singola azione convertita:
   * testi duplicati, ID ignoti o outcome ripetuti sono errori di protocollo.
   */
  private outcomesByActionId(
    actions: PendingAction[],
    outcomes: ActionOutcome[] | undefined,
    convertedActions: ConvertedAction[] | undefined,
  ): Map<string, ActionOutcome> {
    const result = new Map<string, ActionOutcome>();
    const knownIds = new Set(actions.map(action => action.id));
    const converted = convertedActions || [];

    // Avanzamento del solo mondo (nessun ordine nel lotto): un esito emesso
    // dal provider non è attribuibile ad alcun ordine e non può mutare nulla.
    // Ignorarlo evita che una riga spuria faccia fallire un turno world-only,
    // mentre senza ordini reali il fail-closed non protegge niente.
    if (actions.length === 0) {
      if ((outcomes || []).length > 0) {
        console.warn('[GameSession] outcomesByActionId: ignorati', outcomes!.length, 'esiti senza ordini nel lotto');
      }
      return result;
    }

    for (const outcome of outcomes || []) {
      let actionId = outcome.actionId;
      if (!actionId) {
        const candidates = new Set<string>();
        for (const action of actions) {
          if (action.text === outcome.action) candidates.add(action.id);
        }
        for (const action of converted) {
          if (action.actionId && action.text === outcome.action) candidates.add(action.actionId);
        }
        if (candidates.size !== 1) {
          throw new Error('simulation_protocol_error: legacy outcome is ambiguous or unresolved; actionId is required');
        }
        actionId = [...candidates][0];
      }
      if (!knownIds.has(actionId) || result.has(actionId)) {
        throw new Error('simulation_protocol_error: outcome actionId is unknown or duplicated');
      }
      result.set(actionId, outcome);
    }
    return result;
  }

  /** Rimuove dalla coda un ordine non ancora avviato. */
  removePendingAction(actionId: string): boolean {
    const index = this.pendingActions.findIndex(action => action.id === actionId && action.status === 'pending');
    if (index < 0) return false;
    if (!gameRepository.removePendingAction(this.id, actionId)) return false;
    this.pendingActions.splice(index, 1);
    return true;
  }

  /**
   * Modifica il testo di un ordine ancora in coda (prima della presa in
   * carico). La modifica è persistita: non è soltanto un nascondimento in UI.
   * Un ordine già emesso/elaborato non può essere riscritto retroattivamente.
   */
  updatePendingAction(actionId: string, newText: string): PendingAction | null {
    const trimmed = newText.trim();
    if (!trimmed) return null;
    const action = this.pendingActions.find(item => item.id === actionId && item.status === 'pending');
    if (!action) return null;
    if (!gameRepository.updatePendingActionText(this.id, actionId, trimmed)) return null;
    action.text = trimmed;
    return action;
  }

  /**
   * Clear completed actions from queue
   */
  clearCompletedActions(): void {
    this.pendingActions = this.pendingActions.filter(a => a.status !== 'completed');
  }

  /**
   * Process a single queued action. This remains for compatibility with the
   * legacy endpoint; every normal time jump must use the batch method below.
   */
  async processNextAction(jumpDays: number = 30): Promise<PendingAction | null> {
    const result = await this.withLock(async () => {
      if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
      const action = this.pendingActions.find(item => item.status === 'pending');
      if (!action) return [];
      return this._processActionBatchUnlocked(jumpDays, [action]);
    });
    if (result === null) throw new SimulationInProgressError();
    if (!Array.isArray(result)) return null; // §9.3: il run è in pausa su un checkpoint per-evento
    return result[0] || null;
  }

  /**
   * Simulate one time interval for all selected orders. A batch deliberately
   * has one date range, one LLM simulation and one turn: processing N queued
   * orders must never advance the clock N times.
   *
   * This private method assumes that the caller owns `withLock`.
   */
  private async _processActionBatchUnlocked(
    jumpDays: number,
    actions: PendingAction[],
    idempotencyKey?: string,
  ): Promise<PendingAction[] | PausedBatchResult> {
    // Validate before taking a snapshot or mutating the queue.
    const timeJump = jumpHorizon(jumpDays);
    const periodStart = this.currentDate;
    const horizonDate = addDays(periodStart, timeJump);
    // §12: lo snapshot di rewind ritrae l'ORIGINE del salto, ordini ancora
    // in coda compresi. Va preso prima della presa in carico, così un rewind
    // (o un Intervene durante il playback scaglionato) li restituisce alla
    // coda invece di perderli.
    const rewindBeforeSearch = db.prepare(
      "SELECT * FROM saves WHERE game_id = ? AND name = '__rewind__' ORDER BY saved_at DESC LIMIT 1"
    ).get(this.id) as any;
    this.saveRewindSnapshot();
    actions.forEach(item => {
      item.status = 'processing';
      item.deliveryStatus = 'issued';
      item.executionStatus = 'in_progress';
    });
    gameRepository.updatePendingActionStatus(this.id, actions.map(item => item.id), 'processing');
    console.log(
      '[GameSession] Processing simulation batch:',
      actions.length ? actions.map(item => item.id).join(', ') : '(world only)',
    );
    // Gli eventi progressivi mutano la mappa prima della fine della risposta:
    // conserva una copia locale per ripristinare lo stato se lo stream fallisce.
    const regionsBeforeStream = new Map<string, RegionState>(
      [...this.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))])
    );
    let simulationRunId: string | null = null;
    // F03/A10: ogni batch riparte senza esiti ereditati — un salto senza
    // eventi non deve poter restituire la cronaca di un run precedente.
    this.lastCommittedResult = null;
    // Snapshot completo pre-run: un errore dopo scritture DB non può lasciare
    // cronaca, relazioni o chat avanti rispetto alla mappa ripristinata.
    const turnBeforeRun = this.currentTurn;
    const dateBeforeRun = this.currentDate;
    const relationshipsBeforeRun = this.relationships.toJSON();
    const actionsBeforeRun = [...this.actions];
    const resultsBeforeRun = [...this.results];
    const chatsBeforeRun = chatRepository.snapshotGameChats(this.id);
    const ongoingProcessesBeforeRun = gameRepository.snapshotOngoingProcesses(this.id);

    try {
      const player = this.players[0];
      if (!player) throw new Error('No player in session');

      const playerRegion = this.regions.get(player.regionId);
      if (!playerRegion) throw new Error('Player region not found');

      // M06 µ3: in strict nessun comando materiale LLM diretto entra nel
      // percorso: build_facility/spawn_battalion/grant_funds/set_gdp non sono
      // più comandi diretti. Il rifiuto avviene PRIMA della chiamata al
      // provider, così nessun credito viene consumato per un ordine vietato.
      if (this.isStrictGame()) {
        for (const action of actions) rejectDirectMaterialCommand(action.text);
      }

      // jumpDays <= 0 — auto-jump «к следующему важному событию» (горизонт — год)
      const autoJump = jumpDays <= 0;
      // In auto-jump ogni ordine in coda ha diritto al proprio evento: il
      // limite di eventi accettati è il numero di ordini del lotto (minimo 1,
      // per l'avanzamento del mondo senza ordini).
      const autoJumpEventLimit = Math.max(1, actions.length);
      simulationRunId = shortId();
      this.activeSimulationRunId = simulationRunId;
      this.activeSimulationAbort = new AbortController();
      gameRepository.createSimulationRun({
        id: simulationRunId,
        gameId: this.id,
        mode: autoJump ? 'auto' : 'fixed',
        startDate: periodStart,
        targetDate: horizonDate,
        idempotencyKey,
      });

      // M06 µ6a (B1): in strict lo stato iniziale del catalogo entra nel ledger
      // del ramo (idempotente) PRIMA di ogni proposta: disponibilità reali per
      // prenotazioni/cashflow; fallisce chiuso se il catalogo è incoerente.
      if (this.isStrictGame()) {
        const worldRow = worldRepository.findById(this.worldId) as { template_id?: unknown } | undefined;
        const templateId = worldRow?.template_id;
        if (typeof templateId === 'string' && templateId) {
          const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
          if (!loaded.catalog) throw new Error(`strict_catalog_invalid: ${templateId}`);
          const branchId = gameRepository.getHeadBranch(this.id);
          if (!branchId) throw new Error('strict_branch_missing');
          bootstrapCatalogEconomy(this.id, branchId, loaded.catalog);
        }
      }

      this.broadcast('turn_start', {
        simulationId: simulationRunId,
        turn: this.currentTurn,
        actions: actions.map(item => ({ id: item.id, text: item.text })),
      });

      // Build game data for prompt engine
      const gameData = this.buildGameData(actions.map(item => item.text));

      // Gli eventi escono dal token stream UNO ALLA VOLTA. In auto-jump un
      // oggetto JSON completo viene applicato alla mappa e inviato al browser
      // come anteprima; nel salto fisso (§9.3) gli eventi restano PROPOSTE non
      // applicate: il primo commit avviene solo a stream concluso, e i
      // successivi soltanto dopo la conferma esplicita del giocatore.
      this.interveneRequested = false;
      const movementIntents = this.captureMovementIntents(actions);
      const appliedEvents: SimulationEvent[] = [];
      const proposedEvents: SimulationEvent[] = [];
      // Gli stream possono mostrare una proposta evento, ma la mappa del
      // client cambia solo dopo il commit del turno. Conserviamo qui il delta
      // da pubblicare insieme al checkpoint durevole.
      const checkpointChanges = new Map<string, {
        id: string; owner: string; color: string; name: string;
        population: number; gdp: number; militaryPower: number; objects: any[];
      }>();
      let consumedEvents = 0;
      let intervened = false;
      const acceptEvent = (event: SimulationEvent, index: number, apply: boolean): boolean => {
        consumedEvents = Math.max(consumedEvents, index + 1);
        if (this.interveneRequested) {
          intervened = true;
          return false;
        }
        const canonicalEvent = this.canonicalizeEventReactions(event, actions.map(item => item.text));
        // Reject invalid/backdated dates before any map effect. Count consumed
        // events separately below so streaming fallbacks cannot reapply them.
        const previousDate = (apply ? appliedEvents.at(-1) : proposedEvents.at(-1))?.date || periodStart;
        if (!dateInPeriod(canonicalEvent.date, previousDate, horizonDate)) {
          console.warn('[GameSession] Event outside turn period:', canonicalEvent.date);
          return false;
        }
        if (!apply) {
          proposedEvents.push(canonicalEvent);
          return true;
        }
        // In auto-jump il limite di eventi accettati è il numero di ordini in
        // coda: ignora rigorosamente gli eventuali record successivi di un
        // modello che non abbia rispettato il budget del prompt.
        if (autoJump && appliedEvents.length >= autoJumpEventLimit) {
          console.warn(`[GameSession] Auto-jump: event after the limit of ${autoJumpEventLimit} ignored`);
          return false;
        }
        const changedRegions = this.applyFrontierPlacements(
          canonicalEvent,
          this.applyMapChanges(canonicalEvent.mapChanges, canonicalEvent.date),
          actions.map(item => item.text),
        ).map(region => ({
          id: region.id,
          owner: region.owner,
          color: region.color,
          name: region.name,
          population: region.population,
          gdp: region.gdp,
          militaryPower: region.militaryPower,
          objects: region.objects,
        }));
        changedRegions.forEach(region => checkpointChanges.set(region.id, region));
        appliedEvents.push(canonicalEvent);
        // È una sola anteprima narrativa: nessun delta o data viene ancora
        // pubblicato, poiché DB e checkpoint non sono stati committati.
        this.broadcast('jump_event', {
          turn: this.currentTurn,
          index,
          event: {
            ...canonicalEvent,
            headline: this.publicText(canonicalEvent.headline),
            description: this.publicText(canonicalEvent.description),
          },
          streaming: true,
          checkpoint: false,
        });
        return true;
      };
      // §9.3: durante la generazione di un salto fisso nessun evento è
      // applicato né svelato: le proposte future non sono canoniche e non
      // devono rivelare la narrazione prima dell'applicazione.
      const emitEvent = autoJump
        ? (event: SimulationEvent, index: number) => { acceptEvent(event, index, true); }
        : (event: SimulationEvent, index: number) => { acceptEvent(event, index, false); };

      const promptResult = await this.gameController.processTurnWithPrompts(
        gameData,
        actions.map(item => ({ actionId: item.id, text: item.text })),
        timeJump,
        (chars) => this.broadcast('llm_progress', {
          mechanic: 'jump',
          chars,
          eventsReady: autoJump ? appliedEvents.length : proposedEvents.length,
        }),
        autoJump,
        emitEvent,
        this.activeSimulationAbort.signal,
      );

      const events = promptResult.events || [];
      // Compatibilità con mock/test e provider non-streaming: pubblica qui gli
      // eventuali eventi che non sono già arrivati dal callback incrementale.
      for (let i = consumedEvents; i < events.length; i++) {
        if (this.interveneRequested) { intervened = true; break; }
        emitEvent(events[i], i);
      }
      intervened ||= this.interveneRequested;

      // M06 µ3: in strict l'intero risultato è validato in un solo punto
      // PRIMA di qualsiasi mutatore materiale o commit narrativo. worldChanges
      // assoluti, mapChanges LLM diretti, outcome senza actionId canonico ed
      // effetti non consentiti → EffectValidationError: il catch riporta il
      // mondo all'ultimo checkpoint e il run termina 'failed'. Mai simulazione
      // riuscita per fallback (MAT25/26/27/37/38, C03/C04/C10).
      if (this.isStrictGame()) {
        validateStrictResultSafe(promptResult);
        assertExecutableStrictEffects(promptResult.effects || []);
      }

      // §9.3 — playback «un evento alla volta»: con due o più eventi proposti
      // il salto fisso committa solo il primo checkpoint e consegna il resto
      // delle proposte al run in pausa. «Continua» autorizza il checkpoint
      // seguente, «Intervieni qui» chiude il salto al checkpoint mostrato.
      if (!autoJump && !intervened && proposedEvents.length >= 2) {
        return this._startPausedPlaybackUnlocked({
          simulationRunId: simulationRunId!,
          actions,
          promptResult,
          proposedEvents,
          periodStart,
          horizonDate,
        });
      }

      // §7.2: Intervene durante la generazione di un salto fisso arresta un
      // mondo che non ha ancora applicato né svelato alcun evento. La
      // destinazione non è raggiunta, gli ordini tornano disponibili e il
      // run termina «interrupted» senza inventare esiti.
      if (!autoJump && intervened) {
        actions.forEach(action => {
          action.status = 'pending';
          action.deliveryStatus = 'queued';
          action.executionStatus = 'not_started';
        });
        gameRepository.updatePendingActionStatus(this.id, actions.map(action => action.id), 'pending');
        db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__'").run(this.id);
        if (rewindBeforeSearch) {
          db.prepare(`
            INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            rewindBeforeSearch.id, rewindBeforeSearch.game_id, rewindBeforeSearch.name,
            rewindBeforeSearch.current_turn, rewindBeforeSearch.current_date,
            rewindBeforeSearch.data, rewindBeforeSearch.content_hash, rewindBeforeSearch.saved_at,
          );
        }
        gameRepository.finishSimulationRun(simulationRunId, 'interrupted', {
          checkpointDate: periodStart,
          turn: this.currentTurn,
        });
        this.activeSimulationRunId = null;
        this.activeSimulationAbort = null;
        this.broadcast('turn_complete', {
          turn: this.currentTurn,
          narration: `La cronaca resta ferma: ${this.publicPolityName(this.playerPolityId)} non conferma l’avanzamento del periodo.`,
          events: ['Nessun nuovo sviluppo viene confermato'],
          newTurn: this.currentTurn,
          newDate: this.currentDate,
          intervened: true,
        });
        this.lastCommittedResult = null; // nessun esito: mai inferire dall’ultima cronaca
        return [];
      }

      // Salto fisso con al più un evento: nessuna finestra di intervento
      // da proteggere oltre lo streaming — applica e completa il periodo
      // con il codice storico (un solo checkpoint a destinazione).
      if (!autoJump) {
        for (const [i, event] of proposedEvents.entries()) acceptEvent(event, i, true);
      }

      // Un ordine di movimento dichiarato «accepted» dal modello ma privo di
      // `move_unit` lascerebbe l'unità ferma: il motore completa il movimento
      // dovuto, con unità e destinazione reali, e lo aggiunge al checkpoint.
      // Completion outcomes cover the whole generated timeline, not a prefix.
      // Never infer arrival when any event was rejected/truncated (including
      // streamed events omitted from the sanitized result after the auto-jump cap).
      const allEventsApplied = appliedEvents.length === Math.max(consumedEvents, events.length);
      if (!intervened && !promptResult.incomplete && allEventsApplied && !(autoJump && appliedEvents.length === 0)) {
        const reconciled = this.reconcileAcceptedMoves(actions, promptResult.actionOutcomes || [], movementIntents,
          appliedEvents.flatMap(event => event.mapChanges || []), autoJump ? appliedEvents.at(-1)!.date : horizonDate);
        for (const region of reconciled) {
          checkpointChanges.set(region.id, {
            id: region.id, owner: region.owner, color: region.color, name: region.name,
            population: region.population, gdp: region.gdp, militaryPower: region.militaryPower,
            objects: region.objects,
          });
        }
      }

      const period = resolvePeriod({ start: periodStart, days: timeJump, auto: autoJump,
        interrupted: intervened, target: promptResult.targetDate, eventDates: appliedEvents.map(e => e.date) });
      if (intervened) {
        console.log(`[GameSession] Intervene: applicati ${appliedEvents.length}/${events.length} eventi`);
      }

      // Una ricerca automatica senza svolte non è un turno: lascia data,
      // mappa, coda, risultati e snapshot esattamente al checkpoint iniziale.
      if (autoJump && !intervened && appliedEvents.length === 0) {
        actions.forEach(action => {
          action.status = 'pending';
          action.deliveryStatus = 'queued';
          action.executionStatus = 'not_started';
        });
        gameRepository.updatePendingActionStatus(this.id, actions.map(action => action.id), 'pending');
        db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__'").run(this.id);
        if (rewindBeforeSearch) {
          db.prepare(`
            INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            rewindBeforeSearch.id, rewindBeforeSearch.game_id, rewindBeforeSearch.name,
            rewindBeforeSearch.current_turn, rewindBeforeSearch.current_date,
            rewindBeforeSearch.data, rewindBeforeSearch.content_hash, rewindBeforeSearch.saved_at,
          );
        }
        gameRepository.finishSimulationRun(simulationRunId, 'no_event', {
          checkpointDate: periodStart,
          turn: this.currentTurn,
        });
        this.activeSimulationRunId = null;
        this.activeSimulationAbort = null;
        this.broadcast('simulation_no_event', {
          simulationId: simulationRunId,
          turn: this.currentTurn,
          startDate: periodStart,
          searchedUntil: horizonDate,
        });
        this.lastCommittedResult = null; // C10: il salto senza eventi non ha un esito
        return [];
      }

      // Нереалистичные действия, отклонённые simulaцией
      const voided = promptResult.voided || [];
      for (const v of voided) {
        this.broadcast('action_voided', {
          turn: this.currentTurn,
          action: this.publicText(v.action),
          reason: this.publicText(v.reason),
          polityName: this.publicPolityName(this.playerPolityId),
        });
      }

      // Gli effetti globali legacy non sono associati a un evento datato.
      // Durante l'auto-jump gli eventi accettati sono il confine invalicabile:
      // solo i loro `mapChanges` già validati possono mutare il mondo.
      // Applicare qui worldChanges, relazioni o chat della risposta completa
      // farebbe entrare nel checkpoint conseguenze che appartengono a eventi
      // futuri scartati.
      const applyCompletionEffects = !intervened && !autoJump;
      if (applyCompletionEffects && promptResult.worldChanges) {
        this.applyWorldChanges(promptResult.worldChanges);
      }

      // Le conseguenze delle trattative diventano relazioni persistenti.
      const persistedRelationshipChanges: {
        from: string;
        to: string;
        newRelationship: RelationshipType;
        reason: string;
      }[] = [];
      // F02 passo 2: il record del turno è prodotto dentro la transazione e
      // letto fuori (broadcast/return): callback intera o errore propagato.
      let turnResult!: TurnResultRecord;
      const chatBroadcasts: Array<Record<string, unknown>> = [];
      let openedChatPolityIds = new Set<string>();
      const polityResolver = this.buildResolvers().polities;
      for (const change of applyCompletionEffects ? promptResult.relationshipChanges || [] : []) {
        const from = polityResolver.resolve(change.from);
        const to = polityResolver.resolve(change.to);
        if (!from || !to || from.isNew || to.isNew || from.polityId === to.polityId) continue;
        this.relationships.set(from.polityId, to.polityId, change.relationship);
        persistedRelationshipChanges.push({
          from: from.polityId,
          to: to.polityId,
          newRelationship: change.relationship,
          reason: change.reason || 'Conseguenza diplomatica del turno',
        });
      }
      // F02 passo 2: commit canonico atomico del percorso ordinario — tutte
      // le scritture (relazioni, chat, azioni, esiti, coda, mondo, checkpoint,
      // eventi, run) in una sola transazione breve; LLM/consolidamento e SSE
      // restano fuori. Un errore a metà non lascia stato misto nel DB.
      withCanonicalTransaction(() => {
      if (this.isStrictGame() && applyCompletionEffects) applyStagedStrictEffects(this.id, gameRepository.getHeadBranch(this.id)!, gameRepository.getWorldRevision(this.id), promptResult.effects || []);
      relationshipRepository.upsertForGame(this.id, persistedRelationshipChanges);

      // Le nazioni possono aprire autonomamente un canale dopo un evento.
      // In auto-jump entra soltanto una chat legata per titolo a un dispaccio
      // realmente applicato; nei salti fissi conclusi è valida anche la forma
      // legacy senza collegamento esplicito.
      const chatTimelineEvents: TimelineEventRecord[] = [];
      const explicitChatStarts = applyCompletionEffects || (autoJump && !intervened)
        ? promptResult.startChat || []
        : [];
      const chatEffects = this.openSimulationChats(
        [...explicitChatStarts, ...this.reactionChatStarts(appliedEvents)],
        {
          turn: this.currentTurn,
          fallbackDate: period.end,
          simulationId: simulationRunId || undefined,
          events: appliedEvents,
          requireEventLink: autoJump,
        },
      );
      chatTimelineEvents.push(...chatEffects.timelineEvents);
      chatBroadcasts.push(...chatEffects.broadcasts);
      openedChatPolityIds = chatEffects.participantPolityIds;

      // An intention (even a rejected order containing "build") is not a
      // completed construction. Objects are applied only via event mapChanges.

      // Oggetti costruiti e trasformazioni approvate entrano subito nei conti
      // nazionali. Il risultato economico è deterministico e viene conservato
      // nei dispacci, così i turni successivi ricordano le conseguenze.
      // L'economia aggiorna comunque i valori fino alla data dell'evento,
      // ma nell'auto-jump non aggiunge un secondo dispaccio alla prima svolta.
      const economyBulletins = this.isStrictGame() || period.elapsedDays > 0 ? this.advanceWorldState(period.elapsedDays, period.end) : [];
      const economyEvents = autoJump ? [] : economyBulletins;

      // Il salto viene deciso da UN'unica sequenza causale (la simulazione
      // datata sopra). Non aggiungere dopo la narrazione un secondo generatore
      // NPC/casuale: le iniziative delle politie devono essere emesse nel
      // prompt come eventi con causa e checkpoint, non come rumore tardivo.
      const npcEvents: string[] = [];
      const randomEvents: string[] = [];

      // Every order is recorded against the same simulation turn. Their
      // individual result points at the shared outcome below instead of
      // triggering independent calendar jumps.
      const actionRecords: ActionRecord[] = actions.map(item => ({
        id: item.id,
        playerId: player.id,
        turn: this.currentTurn,
        text: item.text,
        createdAt: item.createdAt,
      }));
      this.actions.push(...actionRecords);
      actionRecords.forEach(actionRecord => gameRepository.addAction({
        id: actionRecord.id,
        gameId: this.id,
        playerId: player.id,
        turn: this.currentTurn,
        text: actionRecord.text,
      }));

      // Create turn result (заголовки только ПРИМЕНЁННЫХ событий + voided)
      const llmEventHeadlines = appliedEvents.map((event: any) => this.publicText(event.headline)).filter(Boolean);
      const voidedHeadlines = voided.map(v => `${this.publicPolityName(this.playerPolityId)} non attua la direttiva «${this.publicText(v.action)}»${v.reason ? `: ${this.publicText(v.reason)}` : '.'}`);
      if (intervened) llmEventHeadlines.push('La cronaca si arresta alla data scelta dal governo');
      turnResult = {
        id: shortId(),
        simulationId: simulationRunId || undefined,
        turn: this.currentTurn,
        // In auto-jump non riutilizzare il riassunto completo della LLM: può
        // descrivere il futuro oltre gli eventi accettati.
        narration: this.publicText((intervened || autoJump)
          ? appliedEvents.map(e => e.description).join('\n\n')
          : promptResult.narration),
        countryResponse: promptResult.convertedActions.map((a: any) => a.text).join('\n'),
        events: [...voidedHeadlines, ...llmEventHeadlines, ...economyEvents, ...npcEvents, ...randomEvents],
      };
      this.results.push(turnResult);
      // F03/A10: l’esito è associato all’ID alla creazione (nessun fallback
      // per posizione in processWorldAdvance).
      this.lastCommittedResult = turnResult;

      // Persist ALL region changes to DB
      this.syncRegionsToDB();

      // Ogni ordine mantiene l'involucro comune del turno ma riceve il proprio
      // esito strutturato quando il provider lo restituisce. Il nuovo percorso
      // usa actionId; l'adapter legacy accetta solo testi univoci convertiti.
      const outcomes = this.outcomesByActionId(
        actions, promptResult.actionOutcomes, promptResult.convertedActions,
      );
      actions.forEach(item => {
        const outcome = outcomes.get(item.id);
        const rejected = voided.find(result => result.action === item.text);
        const outcomeStatus = outcome?.status || (rejected ? 'rejected' : undefined);
        const outcomeSummary = this.publicText(outcome?.summary || rejected?.reason);
        const outcomeEvents = outcome?.eventHeadlines?.length
          ? outcome.eventHeadlines.map(headline => this.publicText(headline)).filter(headline => turnResult.events.includes(headline))
          : rejected ? voidedHeadlines.filter(headline => headline.includes(rejected.action)) : turnResult.events;
        item.status = 'completed';
        item.deliveryStatus = 'issued';
        item.executionStatus = 'completed';
        item.result = {
          narration: outcomeSummary || turnResult.narration,
          countryResponse: turnResult.countryResponse,
          events: outcomeEvents,
          simulationId: simulationRunId || undefined,
          outcome: outcomeStatus && outcomeSummary
            ? {
              status: outcomeStatus,
              summary: outcomeSummary,
              expectedDate: outcome?.expectedDate,
              completesProjectId: outcome?.completesProjectId,
            }
            : undefined,
          objects: playerRegion.objects,
          turn: this.currentTurn,
          periodStart,
          periodEnd: '', // Will be set after date advance
        };
      });

      // Un esito partial è un processo ancora aperto, non un successo finale.
      // Il record resta nel checkpoint e potrà essere aggiornato da un futuro
      // outcome invece di inventare la conclusione nel turno corrente.
      actions.filter(action => action.result?.outcome?.status === 'partial').forEach(action => {
        gameRepository.upsertOngoingProcess({
          id: shortId(),
          gameId: this.id,
          sourceActionId: action.id,
          sourceRunId: simulationRunId!,
          title: action.text,
          summary: action.result!.outcome!.summary,
          startedDate: periodStart,
          expectedDate: action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > periodStart
            ? action.result!.outcome!.expectedDate
            : undefined,
        });
      });
      // Un progetto si chiude solo per il suo ID esplicito e con outcome
      // accepted: un titolo o un testo riformulato non può chiudere un altro.
      actions.forEach(action => {
        const outcome = action.result?.outcome;
        if (!outcome?.completesProjectId) return;
        if (outcome.status !== 'accepted'
          || gameRepository.completeOngoingProcessById(this.id, outcome.completesProjectId, outcome.summary) !== 1) {
          throw new Error('simulation_protocol_error: completesProjectId is invalid or not accepted');
        }
      });

      // Esiti individuali durevoli: anche i preset legacy ricevono un record
      // esplicito (accepted + cronaca comune) invece di sparire con la coda.
      gameRepository.addSimulationActionOutcomes(actions.map(action => ({
        id: shortId(),
        runId: simulationRunId!,
        gameId: this.id,
        actionId: action.id,
        status: action.result?.outcome?.status || 'unresolved',
        summary: action.result?.outcome?.summary || action.result?.narration || turnResult.narration,
        eventHeadlines: action.result?.events || [],
      })));

      // Completed orders no longer belong to the future queue. Persist the
      // removal only after their common result has been constructed.
      gameRepository.removePendingActions(this.id, actions.map(item => item.id));

      // Advance turn and date
      this.currentTurn++;
      this.currentDate = period.end;

      // Now set periodEnd (after advancing)
      actions.forEach(item => {
        if (item.result) item.result.periodEnd = this.currentDate;
      });

      // Timeline: conserva data, titolo e dettaglio originale di ogni evento.
      turnResult.date = this.currentDate;
      const detailedByHeadline = new Map(
        appliedEvents.map(event => [this.publicText(event.headline), event] as const)
      );
      const sourceActionsByHeadline = new Map<string, string[]>();
      actions.forEach(action => {
        const outcome = outcomes.get(action.id);
        outcome?.eventHeadlines?.forEach(headline => {
          const ids = sourceActionsByHeadline.get(headline) || [];
          ids.push(action.id);
          sourceActionsByHeadline.set(headline, ids);
        });
      });
      turnResult.timelineEvents = turnResult.events.map((headline, index) => {
        const detailed = detailedByHeadline.get(headline);
        return {
          id: `${turnResult.id}-${index}`,
          date: detailed?.date || this.currentDate,
          headline,
          detail: detailed?.description || (voidedHeadlines.includes(headline) ? headline : turnResult.narration),
          source: 'world' as const,
          simulationId: simulationRunId || undefined,
          sourceActionIds: sourceActionsByHeadline.get(headline) || [],
        };
      });
      for (const [index, change] of persistedRelationshipChanges.entries()) {
        turnResult.timelineEvents.push({
          id: `${turnResult.id}-relationship-${index}`,
          date: this.currentDate,
          headline: `${this.publicPolityName(change.from)} e ${this.publicPolityName(change.to)} ridefiniscono i rapporti`,
          detail: `Il rapporto diventa ${this.publicText(change.newRelationship)}: ${this.publicText(change.reason)}`,
          source: 'diplomacy',
          simulationId: simulationRunId || undefined,
        });
      }
      chatTimelineEvents.forEach(event => { event.simulationId = simulationRunId || undefined; });
      turnResult.timelineEvents.push(...chatTimelineEvents);
      // Ogni ordine del lotto rimanda agli stessi eventi canonici del suo
      // turno, anziché obbligare client/API a ricostruirli da sole stringhe.
      actions.forEach(action => {
        if (action.result) action.result.eventDetails = turnResult.timelineEvents;
      });
      gameRepository.addTurnResult({
        id: turnResult.id,
        gameId: this.id,
        turn: turnResult.turn,
        narration: turnResult.narration,
        countryResponse: turnResult.countryResponse,
        events: turnResult.events,
        timelineEvents: turnResult.timelineEvents,
        date: turnResult.date,
      });

      // Persist turn and date to DB in single operation. F02 passo 4: CAS
      // sull’ancora pre-run — se il mondo è mutato altrove, il commit fallisce
      // invece di sovrascrivere.
      if (!gameRepository.compareAndSwapTurnAndDate(this.id, turnBeforeRun, dateBeforeRun, this.currentTurn, this.currentDate)) {
        throw new Error(`world_anchor_conflict: mondo mutato durante il run (atteso turno ${turnBeforeRun} del ${dateBeforeRun})`);
      }
      const checkpointId = shortId();
      // F02: anche il percorso ordinario usa il contatore monotono: la sua
      // revisione non può mai regredire rispetto a un playback precedente.
      const checkpointRevision = gameRepository.nextWorldRevision(this.id);
      gameRepository.createSimulationCheckpoint({
        id: checkpointId,
        runId: simulationRunId!,
        gameId: this.id,
        revision: checkpointRevision,
        turn: turnResult.turn,
        date: this.currentDate,
        data: this.captureCheckpointData(),
      });
      gameRepository.addSimulationEvents((turnResult.timelineEvents || []).map(event => ({
        id: event.id,
        runId: simulationRunId!,
        checkpointId,
        gameId: this.id,
        date: event.date,
        headline: event.headline,
        detail: event.detail,
        source: event.source,
        sourceActionIds: event.sourceActionIds,
      })));
      this.enqueueOutboxRows(simulationRunId!, checkpointId, checkpointRevision, turnResult.turn, turnResult.timelineEvents || []);
      gameRepository.finishSimulationRun(simulationRunId!, intervened ? 'intervened' : 'completed', {
        checkpointDate: this.currentDate,
        checkpointId,
        turn: turnResult.turn,
      });
      }); // fine transazione canonica (F02 passo 2)
      this.publishPendingOutbox();
      // F02/M06: la chat è visibile soltanto dopo il commit canonico.
      for (const payload of chatBroadcasts) this.broadcast('chat_message', payload);

      // Этап 2: консолидация истории — не должна ронять успешный ход
      try {
        await this.maybeConsolidate();
      } catch (e) {
        console.error('[GameSession] Consolidation failed (turn kept):', e);
      }

      this.broadcast('turn_complete', {
        turn: this.currentTurn - 1,
        narration: turnResult.narration,
        events: turnResult.events,
        eventDetails: turnResult.timelineEvents,
        newTurn: this.currentTurn,
        newDate: this.currentDate,
        changedRegions: [...checkpointChanges.values()],
        intervened,
      });

      // Reazioni NPC agli ordini: non solo notizie, ma anche prese di
      // posizione diplomatiche. Fire-and-forget (turno già committato).
      if (actions.length > 0) {
        const reactionCandidates = new Set<string>();
        for (const change of persistedRelationshipChanges) {
          if (change.from === this.playerPolityId) reactionCandidates.add(change.to);
          if (change.to === this.playerPolityId) reactionCandidates.add(change.from);
        }
        if (applyCompletionEffects && promptResult.worldChanges?.regionOwners) {
          for (const newOwner of Object.values(promptResult.worldChanges.regionOwners)) {
            const resolved = polityResolver.resolve(String(newOwner || ''));
            if (resolved && !resolved.isNew) reactionCandidates.add(resolved.polityId);
          }
        }
        // Fallback deterministico per provider che omettono `reactions`: nomi
        // come Israele, Israel, Stati Uniti, United States o USA negli ordini
        // e nei dispacci identificano comunque le controparti da far reagire.
        for (const polityId of this.mentionedNpcPolityIds([
          ...actions.map(action => action.text),
          ...appliedEvents.flatMap(event => [event.headline, event.description]),
        ])) reactionCandidates.add(polityId);
        const hadDirectlyInvolvedPolity = reactionCandidates.size > 0 || openedChatPolityIds.size > 0;
        // Le politie che hanno già aperto un canale o partecipano a una
        // riunione generata dall'evento hanno già reagito: non duplicare note.
        for (const polityId of openedChatPolityIds) reactionCandidates.delete(polityId);
        // Fallback: soltanto se nessuna controparte diretta è stata rilevata,
        // un vicino ostile può reagire alla mossa (deterrenza/protesta).
        if (reactionCandidates.size === 0 && !hadDirectlyInvolvedPolity) {
          const playerRegions = Array.from(this.regions.values()).filter(r => r.owner === this.playerPolityId);
          const frontierOwners = new Set<string>();
          for (const region of playerRegions) {
            for (const borderId of region.borders || []) {
              const neighbour = this.regions.get(borderId);
              if (neighbour && neighbour.owner !== this.playerPolityId && neighbour.owner !== 'neutral') {
                frontierOwners.add(neighbour.owner);
              }
            }
          }
          const hostile = [...frontierOwners].find(owner => this.relationships.get(owner, this.playerPolityId) === 'hostile');
          if (hostile) reactionCandidates.add(hostile);
        }
        void this.generateNpcReactions({
          actionTexts: actions.map(item => item.text),
          eventHeadlines: turnResult.events.filter(headline => !headline.startsWith('⊘')),
          candidatePolityIds: [...reactionCandidates],
          turn: turnResult.turn,
          date: turnResult.date || this.currentDate,
        }).catch(e => console.warn('[GameSession] NPC reactions failed:', e));
      }

      // Этап 3: проактивный советник — короткий комментарий итогов периода.
      // Fire-and-forget: ход уже успешен, советник не должен его задерживать
      // или ронять.
      this.getAdvisorUnchecked(
        'Commenta brevemente (max 500 caratteri) gli esiti del periodo appena trascorso per il tuo leader, in italiano',
        []
      )
        .then(content => this.broadcast('advisor_proactive', { content }))
        .catch(e => console.error('[GameSession] Proactive advisor failed:', e));

      this.activeSimulationRunId = null;
      this.activeSimulationAbort = null;
      console.log('[GameSession] Action batch processed, new date:', this.currentDate);
      return actions;

    } catch (e) {
      console.error('[GameSession] Error processing action batch:', e);
      // Ripristino completo del checkpoint precedente, non soltanto della
      // mappa: altrimenti un client potrebbe osservare data/cronaca future.
      this.regions = regionsBeforeStream;
      this.currentTurn = turnBeforeRun;
      this.currentDate = dateBeforeRun;
      this.relationships = RelationshipMatrix.fromJSON(relationshipsBeforeRun);
      this.actions = actionsBeforeRun;
      this.results = resultsBeforeRun;
      if (simulationRunId) {
        gameRepository.finishSimulationRun(simulationRunId, 'failed', { error: e instanceof Error ? e.message : String(e) });
      }
      this.activeSimulationRunId = null;
      this.activeSimulationAbort = null;
      actions.forEach(item => {
        item.status = 'pending';
        item.deliveryStatus = 'queued';
        item.executionStatus = 'not_started';
      });
      try {
        await this.syncRegionsToDB();
        gameRepository.replaceHistory(this.id, this.actions, this.results);
        relationshipRepository.replaceForGame(this.id, Object.entries(relationshipsBeforeRun).flatMap(([from, targets]) =>
          Object.entries(targets as Record<string, RelationshipType>).map(([to, type]) => ({ from, to, type }))
        ));
        chatRepository.replaceGameChats(this.id, chatsBeforeRun);
        gameRepository.replaceOngoingProcesses(this.id, ongoingProcessesBeforeRun);
        gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);
        // The batch may already have removed its rows before a later DB write.
        gameRepository.replacePendingActions(this.id, this.pendingActions);
      } catch (rollbackError) {
        console.error('[GameSession] Checkpoint rollback persistence failed:', rollbackError);
      }
      throw e;
    }
  }

  /**
   * Process every currently pending order as one simultaneous batch.
   */
  async processAllPendingActions(jumpDays: number = 30, idempotencyKey?: string): Promise<PendingAction[] | PausedBatchResult> {
    const result = await this.withLock(async () => {
      if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
      const pending = this.pendingActions.filter(action => action.status === 'pending');
      return this._processActionBatchUnlocked(jumpDays, pending, idempotencyKey);
    });
    if (result === null) throw new SimulationInProgressError();
    return result;
  }

  /**
   * Advance the world through the same causal event pipeline used for player
   * orders. No placeholder player action is created: an empty `actions` array
   * explicitly means that only existing world processes may produce events.
   */
  async processWorldAdvance(jumpDays: number = 30, idempotencyKey?: string): Promise<TurnResultRecord | PausedBatchResult | null> {
    // F03/A10: `executed` distingue il conflitto di lock (nessun callback
    // eseguito → SimulationInProgressError) dal no_event onesto (callback
    // eseguito, nessun risultato → null → la route risponde no_event_found).
    let executed = false;
    const result = await this.withLock(async () => {
      executed = true;
      if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
      const batch = await this._processActionBatchUnlocked(jumpDays, [], idempotencyKey);
      // §9.3: il mondo senza nuovi ordini riceve lo stesso playback scaglionato
      // quando la simulazione produce più eventi nel periodo richiesto.
      if (!Array.isArray(batch)) return batch;
      // F03/A10: il risultato è quello del batch appena committato, associato
      // all’ID alla creazione. Un salto senza eventi non inventa la cronaca
      // dell’esito dal run precedente.
      return this.lastCommittedResult;
    });
    if (!executed) throw new SimulationInProgressError();
    return result ?? null;
  }

  /**
   * Advance date without processing actions (for legacy callers only).
   * New timeline controls must use processWorldAdvance so world events are not
   * bypassed when the player has no fresh orders. The calendar and economy
   * still advance together for callers that explicitly retain this legacy API.
   */
  async advanceDate(jumpDays: number = 30): Promise<{ newDate: string; newTurn: number }> {
    if (this.isStrictGame()) throw new Error('strict_legacy_path_forbidden: advanceDate');
    // §9.3: un run in pausa possiede il turno: nemmeno il percorso legacy
    // può far avanzare il mondo dietro la finestra di lettura del giocatore.
    if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
    // Validate BEFORE any mutation: an invalid horizon used to increment the
    // turn and then throw on an Invalid Date.
    const days = explicitDays(jumpDays);
    const periodStart = this.currentDate;
    const elapsedTurn = this.currentTurn;
    const newDate = addDays(periodStart, days);

    const tick = WorldStateEngine.advance(this.regions.values(), days);
    const resourceLines = this.advanceResources(days, tick.accounts);
    const bulletin = WorldStateEngine.playerBulletin(tick.accounts[this.playerPolityId]);
    this.currentTurn++;
    this.currentDate = newDate;

    const id = shortId();
    const headline = `Il tempo avanza di ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
    const result: TurnResultRecord = {
      id,
      turn: elapsedTurn,
      date: this.currentDate,
      narration: `Dal ${periodStart} al ${this.currentDate} non sono state impartite nuove direttive.`,
      countryResponse: '',
      events: [headline, ...(bulletin ? [`📊 ${bulletin}`] : []), ...resourceLines],
      timelineEvents: [{
        id: `${id}-0`,
        date: this.currentDate,
        headline,
        detail: `${this.publicPolityName(this.playerPolityId)} non ha impartito nuove direttive tra il ${periodStart} e il ${this.currentDate}.`,
        source: 'world',
      }, ...(bulletin ? [{
        id: `${id}-1`,
        date: this.currentDate,
        headline: 'Conti nazionali del periodo',
        detail: bulletin,
        source: 'world' as const,
      }] : [])],
    };
    this.results.push(result);
    gameRepository.addTurnResult({ ...result, gameId: this.id });
    gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);
    // The skip is only complete once its economic effects are on disk.
    await this.syncRegionsToDB();

    const changedRegions = tick.changedRegions.map(regionId => {
      const region = this.regions.get(regionId);
      if (!region) return null;
      return { id: region.id, owner: region.owner, color: region.color,
        population: region.population, gdp: region.gdp, militaryPower: region.militaryPower };
    }).filter(Boolean);
    this.broadcast('world_event', {
      narration: result.narration,
      events: result.events,
      eventDetails: result.timelineEvents,
      newTurn: this.currentTurn,
      newDate: this.currentDate,
      changedRegions,
    });

    console.log('[GameSession] Advanced date:', periodStart, '->', this.currentDate);
    return { newDate: this.currentDate, newTurn: this.currentTurn };
  }
}
