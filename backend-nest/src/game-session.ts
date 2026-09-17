/**
 * World Story — Game Session
 * ========================
 * Per-game session that encapsulates all game state and logic.
 * Each game gets its own GameSession instance via SessionRegistry.
 */

import { shortId } from './utils/short-id';
import { TimelineService, type TimelineEntry, type TimelineEventRecord, type TurnResultRecord } from './game/TimelineService';
import { RegionGeometryService } from './game/RegionGeometryService';
import { MilitaryService } from './game/MilitaryService';
import { OrderExecutionService, type PendingAction } from './game/OrderExecutionService';
import { LLMRouter } from './llm';
import { GameController } from './agents';
import { PromptEngine } from './prompt-builder';
import { worldRepository, gameRepository, relationshipRepository, chatRepository, nationalAccountRepository, type PressureRecord } from './repositories';
import { captureEconomicSnapshot } from './repositories/economy-snapshot.repository';
import type { ChatRecord, ChatSummary, ChatMessageRecord, GameChatSnapshot } from './repositories';
import { DiplomacyService } from './game/DiplomacyService';
import { GamePersistenceService, type PersistenceApplyState } from './game/GamePersistenceService';
import { NationStateService } from './game/NationStateService';
import { SimulationCoordinator } from './game/SimulationCoordinator';
import { WorldMutationService } from './game/WorldMutationService';
import { GameDataService } from './game/GameDataService';
import type { CurrentReactionAction } from './core/simulation/ReactionContext';
import { WorldIntelService } from './game/WorldIntelService';
import { NpcTurnService } from './game/NpcTurnService';
import { SessionStateStore } from './game/SessionStateStore';
import { PlaybackService } from './game/PlaybackService';
import { TurnPipelineService } from './game/TurnPipelineService';
import { SessionBootstrapService } from './game/SessionBootstrapService';
import { LiveTickService } from './game/LiveTickService';
import { HistoryService } from './game/HistoryService';
import { OutboxService } from './game/OutboxService';
import { WorldStateEngine, type NationalAccount } from './core/simulation/WorldStateEngine';
import { clampTaxRatePct, DEFAULT_FISCAL_POLICY, describeFiscalEffects, fiscalShockModifier, FISCAL_MAX_PCT, FISCAL_MIN_PCT, fiscalLabel, type FiscalPolicy } from './core/simulation/FiscalPolicy';
import { type PressureEffect } from './core/simulation/PeacetimePressures';
import { type CrisisEnding, type CrisisState } from './core/simulation/NationCrisis';
import { governmentSnapshot } from './core/simulation/GovernmentFactions';
import type { GovernmentVoices } from './prompts/government';
import { annualDebtServiceMld, creditHeadroom, debtOf, issueSovereignDebt, type ResourceStock } from './core/simulation/MaterialEconomy';
import {
  projectProgress, stableRoll,
} from './core/simulation/MilitaryProduction';
import {
  applyDebtBurdenToAccounts, applyModifierEffects, applyModifiersToAccounts,
  type NationalEffect, type NationalModifiers,
} from './core/simulation/NationalEffects';
import { type OrderCostEstimate } from './core/simulation/OrderCost';
import { NATURAL_RESOURCE_KINDS, type NaturalResourceKind } from './core/simulation/MilitaryIndustry';
import {
  executeTrade,
  marketQuote, tradePressureDelta,
  type ResourceLedger, type WorldMarket,
} from './core/simulation/ResourceMarket';
import { addDays, dateInPeriod, explicitDays } from './core/simulation/calendar';
import { type StrictEffect } from './core/simulation/EffectValidator';
import { runStrictTick } from './core/simulation/TurnOrchestrator';
import { refreshMandateStockDecisions } from './services/MandateDecisionService';
import { normalizeName, RegionResolver, PolityResolver } from './utils/name-resolver';
import { MovementIntent, analyzeMovementOrder, parseMovementOrder } from './utils/movement-orders';
import { buildMovementNotices } from './game/movementNotices';
import { colorForPolity, normalizeHexColor } from './utils/color';
import path from 'path';
import { loadSimulationCatalog } from './scenario/loader';
import { OrderAssessment } from "./core/feasibility/FeasibilityService";
import { type CostEstimate } from "./core/feasibility/costs";
import { Difficulty } from './prompts/difficulty';
import { countryRepository } from './repositories/country.repository';
import { polityDisplayNameIt, hasModernReferenceFacts } from './utils/country-facts';
import { publicNarrativeText } from './utils/public-narrative';
import type { ActionOutcome, ConvertedAction, MapChange, SimulationChatStart, SimulationEvent } from './prompts/types';
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
  /** Provincia con sbocco al mare: capacità navale di base del paese. */
  coastal?: boolean;
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

// Timeline/cronaca: tipi e read model vivono in `game/TimelineService`.
// Re-export per compatibilità con chi importa da `game-session`.
export type { TimelineEventRecord, TurnResultRecord };

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

/** La partita è finita: la nazione è caduta (rivolta, default o invasione). */
export class GameOverError extends Error {
  constructor(public ending: CrisisEnding) {
    super(`game_over: ${ending.title}`);
    this.name = 'GameOverError';
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

// La coda ordini e il suo tipo vivono in `game/OrderExecutionService`.
// Re-export per compatibilità con chi importa da `game-session`.
export type { PendingAction };

export interface WorldChanges {
  regionOwners?: Record<string, string>;
  regionColors?: Record<string, string>;
  regionGDP?: Record<string, number>;
  regionMilitary?: Record<string, number>;
  regionPopulation?: Record<string, number>;
  /**
   * Leve del modello sulla vita della nazione: scorte, arsenale, società,
   * economia. Vengono validate e limitate dal motore (mai applicate alla
   * lettera). Solo percorso legacy: in strict vale il canale canonico.
   */
  nationalEffects?: unknown;
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
      coastal: region.coastal,
    }));
    // I fatti 2024 (PIL, popolazione, debito) valgono solo per i mondi dal
    // 1990 in poi: i preset storici leggono esclusivamente la mappa.
    const startDate = worldRepository.findById(worldId)?.start_date;
    accounts = WorldStateEngine.accounts(regions, {
      modernFacts: hasModernReferenceFacts(startDate),
      startDate,
    });
  } catch (error) {
    console.warn('[GameSession] Dati iniziali del mondo non disponibili:', error);
  }
  worldInitialAccountsCache.set(worldId, accounts);
  return accounts;
}

export class GameSession {
  public readonly id: string;
  public readonly worldId: string;

  /** Proprietà dello stato vivo di sessione (Fase 1: spostata dall'oggetto). */
  private readonly state = new SessionStateStore();

  // Session-specific agents (not shared!)
  private gameController: GameController;
  private promptEngine: PromptEngine;
  private llm: LLMRouter;
  /** Read model della timeline e dei processi (Fase 1: estratto da GameSession). */
  private timeline: TimelineService;
  /** Geometria e risoluzione regioni (Fase 1: estratto da GameSession). */
  private geometry: RegionGeometryService<RegionState>;
  /** Arsenale e produzione militare (Fase 1: estratto da GameSession). */
  private military: MilitaryService;
  /** Economia e fattibilità degli ordini (Fase 1: estratto da GameSession). */
  private orders: OrderExecutionService;
  /** Relazioni internazionali (Fase 1: estratto da GameSession). */
  private diplomacy: DiplomacyService;
  private persistence: GamePersistenceService;
  /** Stato materiale delle nazioni (Fase 1: estratto da GameSession). */
  private nationState: NationStateService;
  /** Lock di sessione e ciclo di vita del run (Fase 1: estratto da GameSession). */
  private coordinator: SimulationCoordinator;
  /** Mutazione deterministica del mondo (Fase 1: estratto da GameSession). */
  private worldMutation: WorldMutationService;
  /** Read model GameData per prompt/LLM (Fase 1: estratto da GameSession). */
  private gameData: GameDataService;
  /** Intelligenza su regioni/polity/cronaca (Fase 1: estratto da GameSession). */
  private worldIntel: WorldIntelService;
  /** Turni NPC ed eventi casuali (Fase 1: estratto da GameSession). */
  private npcTurns: NpcTurnService;
  /** Macchina a stati del playback scaglionato (Fase 1: estratto da GameSession). */
  private playback: PlaybackService;
  /** Orchestratore del lotto di ordini (Fase 1: estratto da GameSession). */
  private turnPipeline: TurnPipelineService;
  /** Ciclo di vita iniziale della sessione (Fase 1: estratto da GameSession). */
  private bootstrap: SessionBootstrapService;
  /** Battito live del mondo (Fase 1: estratto da GameSession). */
  private liveTick: LiveTickService;
  /** Consolidamento della cronaca (Fase 1: estratto da GameSession). */
  private history: HistoryService;
  /** Outbox durable degli eventi canonici (Fase 1: estratto da GameSession). */
  private outbox: OutboxService;

  // ── Stato vivo: accessor deleganti a SessionStateStore ────────────────────
  // I nomi sono identici ai campi precedenti: nessun call-site cambia.
  private get regions(): Map<string, RegionState> { return this.state.regions; }
  private set regions(value: Map<string, RegionState>) { this.state.regions = value; }
  private get players(): PlayerInfo[] { return this.state.players; }
  private set players(value: PlayerInfo[]) { this.state.players = value; }
  private get currentTurn(): number { return this.state.currentTurn; }
  private set currentTurn(value: number) { this.state.currentTurn = value; }
  private get currentDate(): string { return this.state.currentDate; }
  private set currentDate(value: string) { this.state.currentDate = value; }
  private get maxTurns(): number { return this.state.maxTurns; }
  private set maxTurns(value: number) { this.state.maxTurns = value; }
  private get lastCommittedResult(): TurnResultRecord | null { return this.state.lastCommittedResult; }
  private set lastCommittedResult(value: TurnResultRecord | null) { this.state.lastCommittedResult = value; }
  private get worldName(): string { return this.state.worldName; }
  private set worldName(value: string) { this.state.worldName = value; }
  private get worldBasePrompt(): string { return this.state.worldBasePrompt; }
  private set worldBasePrompt(value: string) { this.state.worldBasePrompt = value; }
  private get worldStartDate(): string { return this.state.worldStartDate; }
  private set worldStartDate(value: string) { this.state.worldStartDate = value; }
  private get worldSimulationRules(): string | undefined { return this.state.worldSimulationRules; }
  private set worldSimulationRules(value: string | undefined) { this.state.worldSimulationRules = value; }
  private get playerPolityId(): string { return this.state.playerPolityId; }
  private set playerPolityId(value: string) { this.state.playerPolityId = value; }
  private get difficulty(): Difficulty { return this.state.difficulty; }
  private set difficulty(value: Difficulty) { this.state.difficulty = value; }
  private get taxRatePct(): number | null { return this.state.taxRatePct; }
  private set taxRatePct(value: number | null) { this.state.taxRatePct = value; }
  private get ending(): CrisisEnding | null { return this.state.ending; }
  private set ending(value: CrisisEnding | null) { this.state.ending = value; }
  private get pendingFundingNotes(): string | null { return this.state.pendingFundingNotes; }
  private set pendingFundingNotes(value: string | null) { this.state.pendingFundingNotes = value; }
  private get consolidatedHistory(): string { return this.state.consolidatedHistory; }
  private set consolidatedHistory(value: string) { this.state.consolidatedHistory = value; }
  private get consolidatedUpTo(): number { return this.state.consolidatedUpTo; }
  private set consolidatedUpTo(value: number) { this.state.consolidatedUpTo = value; }
  private get interveneRequested(): boolean { return this.state.interveneRequested; }
  private set interveneRequested(value: boolean) { this.state.interveneRequested = value; }
  private get actions(): ActionRecord[] { return this.state.actions; }
  private set actions(value: ActionRecord[]) { this.state.actions = value; }
  private get results(): TurnResultRecord[] { return this.state.results; }
  private set results(value: TurnResultRecord[]) { this.state.results = value; }
  private get status(): 'waiting' | 'playing' | 'finished' { return this.state.status; }
  private set status(value: 'waiting' | 'playing' | 'finished') { this.state.status = value; }
  private get pausedRun(): PausedRunState | null { return this.state.pausedRun; }
  private set pausedRun(value: PausedRunState | null) { this.state.pausedRun = value; }
  private get pendingNationalNotes(): string[] { return this.state.pendingNationalNotes; }
  private set pendingNationalNotes(value: string[]) { this.state.pendingNationalNotes = value; }
  private get governmentVoices(): { key: string; data: GovernmentVoices } | null { return this.state.governmentVoices; }
  private set governmentVoices(value: { key: string; data: GovernmentVoices } | null) { this.state.governmentVoices = value; }
  private get initialAccountsCache(): Record<string, NationalAccount> | undefined { return this.state.initialAccountsCache; }
  private set initialAccountsCache(value: Record<string, NationalAccount> | undefined) { this.state.initialAccountsCache = value; }
  private get liveSimEnabled(): boolean { return this.state.liveSimEnabled; }
  private set liveSimEnabled(value: boolean) { this.state.liveSimEnabled = value; }
  private get worldTickTimer(): ReturnType<typeof setInterval> | null { return this.state.worldTickTimer; }
  private set worldTickTimer(value: ReturnType<typeof setInterval> | null) { this.state.worldTickTimer = value; }

  /** True while a mutable simulation owns this session checkpoint. */
  isSimulationInProgress(): boolean {
    return this.coordinator.isSimulationInProgress();
  }

  /** F04 passo 3: un run è «attivo» anche quando il playback è in pausa in
   * lettura (§9.5: paused è uno stato del run). Chat e advisor non scrivono
   * nel contesto di un run attivo o sospeso. */
  hasActiveRun(): boolean {
    return this.coordinator.isProcessing || this.pausedRun !== null;
  }

  /** F05 µ2: arresto controllato — abort del run attivo fino agli adattatori. */
  abortActiveSimulation(): void {
    this.coordinator.abortActive();
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    return this.coordinator.withLock(fn);
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
  private static readonly LIVE_TICK_MS = 30000;
  private static readonly LIVE_TICK_DAYS = 7;
  /** Reazioni NPC per turno giocatore: round-robin, per non congelare la
   * simulazione mentre decine di richieste LLM vengono eseguite in serie. */
  private static readonly TURN_NPC_LIMIT = 3;

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
  /** Un tick del mondo in modalità live (implementazione in LiveTickService). */
  async worldTick(): Promise<void> {
    return this.liveTick.worldTick();
  }

  /** Registra il punto storico dei conti nazionali del giocatore per la data
   * indicata. Best-effort: un errore di persistenza non deve interrompere il
   * tick economico, ma non deve nemmeno produrre una tendenza inventata. */
  private recordAccountSnapshot(date: string, accounts?: Record<string, NationalAccount>): void {
    try {
      const branchId = gameRepository.getHeadBranch(this.id);
      if (!branchId) return;
      const account = (accounts ?? this.sessionAccounts())[this.playerPolityId];
      if (!account) return;
      // Il punto storico porta anche il magazzino materiale: così il Dossier può
      // mostrare come cresce o cala la tesoreria senza inventare serie.
      const payload: Record<string, unknown> = { ...account };
      if (!this.isStrictGame()) {
        try {
          const stock = this.resourceStock(this.playerPolityId);
          payload.money = Number(stock.money) || 0;
          payload.debt = Math.round(debtOf(stock) * 100) / 100;
        } catch { /* magazzino non disponibile: il punto resta contabile */ }
      }
      nationalAccountRepository.append(this.id, branchId, this.playerPolityId, this.currentTurn, date, payload);
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
    const rawTick = WorldStateEngine.advance(this.regions.values(), days, this.worldStateOptions());
    // L'overlay dei modificatori nazionali (proposti dal modello) entra nei
    // conti usati dall'economia: stabilità, tensione, entrate e crescita.
    const tickAccounts = applyModifiersToAccounts(rawTick.accounts, polityId => this.modifiersFor(polityId));
    const lines: string[] = [];
    // Leve nazionali applicate al turno precedente, ora visibili in cronaca.
    if (this.pendingNationalNotes.length > 0) lines.push(...this.pendingNationalNotes.splice(0));
    const bulletin = WorldStateEngine.playerBulletin(tickAccounts[this.playerPolityId]);
    if (bulletin) lines.push(`📊 ${bulletin}`);
    // Le anime del governo entrano nella cronaca del turno: chi preme e per
    // che cosa è un fatto della partita, non solo una schermata del dossier.
    const government = governmentSnapshot(tickAccounts[this.playerPolityId]);
    if (government.factions.length > 0) lines.push(`🏛️ Governo — ${government.headline}`);
    lines.push(...this.advanceResources(days, tickAccounts, asOfDate));
    lines.push(...this.advanceProduction(days, tickAccounts[this.playerPolityId]));
    lines.push(...this.advanceProjects(days, asOfDate));
    // Il punto storico è registrato a fine tick, dopo il magazzino, così la
    // tesoreria della data coincide con quella mostrata dal Dossier.
    this.recordAccountSnapshot(asOfDate, tickAccounts);
    return lines;
  }

  /** Magazzino già noto, senza seminarlo (implementazione in NationStateService). */
  private peekResourceStock(polityId: string): ResourceStock | null {
    return this.nationState.peekResourceStock(polityId);
  }

  /** Magazzino materiale della polity (implementazione in NationStateService). */
  private resourceStock(polityId: string): ResourceStock {
    return this.nationState.resourceStock(polityId);
  }

  /** Conto nazionale delle province iniziali del mondo, per polity. */
  private initialAccounts(): Record<string, NationalAccount> {
    if (!this.initialAccountsCache) this.initialAccountsCache = worldInitialAccounts(this.worldId);
    return this.initialAccountsCache;
  }

  /**
   * Opzioni del motore coerenti con l'epoca dello scenario: i fatti 2024 si
   * applicano solo ai mondi dal 1990 in poi. Un preset storico legge solo la
   * mappa e non eredita PIL, popolazione o debito odierni.
   */
  private worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> } {
    return {
      modernFacts: hasModernReferenceFacts(this.worldStartDate),
      startDate: this.worldStartDate,
      taxRateByPolity: this.taxRatePct !== null && this.playerPolityId
        ? { [this.playerPolityId]: this.taxRatePct }
        : undefined,
    };
  }

  /** Politica fiscale corrente del giocatore (aliquota e riferimento). */
  getFiscalPolicy(): FiscalPolicy & {
    label: string;
    minPct: number;
    maxPct: number;
    effects: string[];
    /** Aliquota calcolata dal profilo, usata finché il giocatore non sceglie. */
    defaultPct: number;
    /** True se il giocatore ha scelto esplicitamente l'aliquota. */
    configured: boolean;
  } {
    const defaultPct = this.engineBaseTaxPct();
    const taxRatePct = this.taxRatePct ?? defaultPct;
    return {
      taxRatePct,
      label: fiscalLabel(taxRatePct),
      minPct: FISCAL_MIN_PCT,
      maxPct: FISCAL_MAX_PCT,
      effects: describeFiscalEffects(taxRatePct, defaultPct),
      defaultPct,
      configured: this.taxRatePct !== null,
    };
  }

  /** Aliquota che il motore applicherebbe senza una scelta del giocatore. */
  private engineBaseTaxPct(): number {
    try {
      const base = WorldStateEngine.accounts(this.regions.values(), {
        modernFacts: hasModernReferenceFacts(this.worldStartDate),
        startDate: this.worldStartDate,
      })[this.playerPolityId];
      return Math.round(Number(base?.taxRatePct ?? DEFAULT_FISCAL_POLICY.taxRatePct) * 10) / 10;
    } catch {
      return DEFAULT_FISCAL_POLICY.taxRatePct;
    }
  }

  /**
   * Cambia la pressione fiscale scelta dal giocatore. Validata e persistita;
   * una manovra brusca lascia un costo politico transitorio (modificatore che
   * poi decade), mentre il livello scelto agisce in modo permanente sui conti.
   */
  setFiscalPolicy(taxRatePct: number): { policy: ReturnType<GameSession['getFiscalPolicy']>; note: string } {
    this.assertPlayable();
    const next = clampTaxRatePct(taxRatePct);
    const previous = this.taxRatePct ?? this.engineBaseTaxPct();
    this.taxRatePct = next;
    try {
      gameRepository.setTaxRatePct(this.id, next);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare l\'aliquota fiscale:', error);
    }
    // Costo politico della manovra (una volta sola), indipendente dal livello.
    const shock = fiscalShockModifier(previous, next);
    if (shock.stabilityDelta !== 0 || shock.tensionDelta !== 0) {
      const modifiers = this.modifiersFor(this.playerPolityId);
      this.saveModifiers(this.playerPolityId, {
        ...modifiers,
        stability: modifiers.stability + shock.stabilityDelta,
        socialTension: modifiers.socialTension + shock.tensionDelta,
      });
    }
    // Le voci del consiglio erano tarate sull'aliquota precedente: si invalidano.
    this.governmentVoices = null;
    const note = `Pressione fiscale al ${next}% del PIL (${fiscalLabel(next).toLowerCase()}).`;
    this.pendingNationalNotes.push(note);
    return { policy: this.getFiscalPolicy(), note };
  }

  /** Crea, se mancante, il magazzino della polity (implementazione in NationStateService). */
  seedInitialResources(): void {
    this.nationState.seedInitialResources();
  }

  private saveResourceStock(polityId: string, stock: ResourceStock): void {
    this.nationState.saveResourceStock(polityId, stock);
  }

  /**
   * Avanza il magazzino di ogni polity del periodo indicato. Le scorte sono
   * persistenti: qui maturano produzione, consumi, ricerca e tecnologie.
   */
  /** Avanza le scorte materiali del turno (implementazione in NationStateService). */
  private advanceResources(days: number, accounts?: Record<string, NationalAccount>, asOfDate: string = this.currentDate): string[] {
    return this.nationState.advanceResources(days, accounts, asOfDate);
  }

  /** Magazzino del paese giocatore, per API e dossier (implementazione in NationStateService). */
  getResources() {
    return this.nationState.getResources();
  }

  /**
   * La nazione **fa debito**: emette titoli, incassa cassa oggi e si assume
   * interessi e scadenza. Il motore fissa il tasso di mercato (durata + rischio)
   * e rifiuta l'operazione oltre il tetto di credito. Ogni emissione ha un
   * riflesso sociale: il rapporto debito/PIL sale e con esso la tensione.
   */
  borrowSovereignDebt(amountMld: number, termYears = 10) {
    this.assertPlayable();
    const polityId = this.playerPolityId;
    const account = this.sessionAccounts()[polityId];
    const stock = this.resourceStock(polityId);
    const result = issueSovereignDebt(stock, account, { amountMld, termYears, date: this.currentDate });
    if (!result.ok) {
      throw new Error(result.error === 'amount_invalid'
        ? 'amount_invalid: importo non positivo'
        : 'credit_exhausted: tetto di credito raggiunto');
    }
    this.saveResourceStock(polityId, result.stock);
    const tranche = result.tranche!;
    const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
    const debtRatioPct = gdp > 0 ? debtOf(result.stock) / gdp * 100 : 0;
    return {
      ok: true,
      tranche,
      stock: result.stock,
      debt: Math.round(debtOf(result.stock) * 100) / 100,
      annualInterest: Math.round(annualDebtServiceMld(result.stock) * 100) / 100,
      debtRatioPct: Math.round(debtRatioPct * 10) / 10,
      creditHeadroom: Math.round(creditHeadroom(result.stock, account) * 100) / 100,
    };
  }

  // ── Pressioni di pace: le sfide interne ed esterne del turno ──────────────

  /** Genera le sfide del turno se assenti (implementazione in NationStateService). */
  private ensurePeacetimePressures(): void {
    this.nationState.ensurePeacetimePressures();
  }

  /** Chiude il turno delle pressioni (implementazione in NationStateService). */
  private refreshPeacetimePressures(): void {
    this.nationState.refreshPeacetimePressures();
  }

  /** Applica la conseguenza di una scelta (o dell'inerzia) alla nazione. */
  private applyPressureEffect(effect: PressureEffect, reason: string): void {
    const modifierEffects: NationalEffect[] = [];
    if (effect.stability) modifierEffects.push({ kind: 'modifier', field: 'stability', delta: effect.stability, reason });
    if (effect.socialTension) modifierEffects.push({ kind: 'modifier', field: 'socialTension', delta: effect.socialTension, reason });
    if (effect.growthModifier !== undefined || effect.revenueMultiplierDelta !== undefined) {
      modifierEffects.push({
        kind: 'economy',
        growthModifierDelta: effect.growthModifier,
        revenueMultiplierDelta: effect.revenueMultiplierDelta,
        reason,
      });
    }
    if (modifierEffects.length > 0) {
      const { modifiers } = applyModifierEffects(this.modifiersFor(this.playerPolityId), modifierEffects);
      this.saveModifiers(this.playerPolityId, modifiers);
    }
    if (effect.moneyDeltaMld) {
      const stock = this.resourceStock(this.playerPolityId);
      const money = Math.round((Number(stock.money || 0) + effect.moneyDeltaMld) * 100) / 100;
      this.saveResourceStock(this.playerPolityId, { ...stock, money: Math.max(0, money) });
    }
    if (effect.relationship) {
      const { target, direction } = effect.relationship;
      if (direction === 'improve') this.diplomacy.matrix().improve(this.playerPolityId, target);
      else this.diplomacy.matrix().degrade(this.playerPolityId, target);
      try {
        relationshipRepository.upsertForGame(this.id, [{
          from: this.playerPolityId,
          to: target,
          newRelationship: this.diplomacy.matrix().get(this.playerPolityId, target),
          reason,
        }]);
      } catch (error) {
        console.warn('[GameSession] Relazione non salvata:', error);
      }
    }
    if (effect.note) this.pendingNationalNotes.push(`⚑ ${effect.note}`);
  }

  /** Le sfide del momento per il dossier (implementazione in NationStateService). */
  getPeacetimePressures(): {
    pressures: PressureRecord[];
    recent: PressureRecord[];
    foodCoverageMonths: number | null;
  } {
    return this.nationState.getPeacetimePressures(Boolean(this.ending));
  }

  /**
   * Il giocatore risponde a una sfida. La scelta è idempotente: risolvere due
   * volte la stessa pressione non applica l'effetto una seconda volta.
   */
  resolvePeacetimePressure(pressureId: string, optionId: string): {
    pressure: PressureRecord;
    effect: PressureEffect;
    account?: NationalAccount;
  } {
    this.assertPlayable();
    const record = gameRepository.listPressures(this.id, 'active').find(item => item.id === pressureId);
    if (!record) throw new Error('pressure_not_active: la sfida non è più aperta');
    const option = record.options.find(item => item.id === optionId);
    if (!option) throw new Error('pressure_option_unknown: opzione non valida');
    if (option.effect.moneyDeltaMld && option.effect.moneyDeltaMld < 0) {
      const stock = this.resourceStock(this.playerPolityId);
      if (Number(stock.money || 0) + option.effect.moneyDeltaMld < 0) {
        throw new Error('insufficient_funds: cassa insufficiente per questa scelta');
      }
    }
    this.applyPressureEffect(option.effect, `${record.title}: ${option.label}`);
    if (!gameRepository.resolvePressure(this.id, pressureId, optionId, option.effect.note, this.currentDate)) {
      throw new Error('pressure_not_active: la sfida è stata già chiusa');
    }
    this.governmentVoices = null;
    return {
      pressure: { ...record, status: 'resolved', resolvedOption: optionId, resolution: option.effect.note, resolvedDate: this.currentDate },
      effect: option.effect,
      account: this.sessionAccounts()[this.playerPolityId],
    };
  }

  // ── Crisi e fine partita ──────────────────────────────────────────────────

  /**
   * Blocca ogni azione quando la nazione è caduta: dopo il collasso non si
   * governa più, si può solo tornare indietro o ricominciare.
   */
  private assertPlayable(): void {
    if (this.ending) throw new GameOverError(this.ending);
  }

  /** Valuta la crisi senza scrivere nulla (implementazione in NationStateService). */
  private peekCrisis(): CrisisState {
    return this.nationState.peekCrisis();
  }

  /** Valuta la crisi e, se scatta il collasso, chiude la partita. */
  private evaluateCrisis(advance = true): CrisisState {
    return this.nationState.evaluateCrisis(advance);
  }

  /** Chiude la partita: stato, epilogo persistito ed evento ai client. */
  private finishGame(ending: CrisisEnding): void {
    if (this.ending) return;
    this.ending = ending;
    this.status = 'finished';
    try {
      gameRepository.setStatus(this.id, 'finished');
    } catch (error) {
      console.warn('[GameSession] Chiusura della partita non salvata:', error);
    }
    this.pendingNationalNotes.push(`⛔ ${ending.title}: ${ending.summary}`);
    this.broadcast('game_over', {
      ending,
      turn: this.currentTurn,
      date: this.currentDate,
    });
  }

  /**
   * Ripristina l'epilogo salvato: una partita finita resta finita anche dopo
   * un riavvio o una ricostruzione della sessione.
   */
  private restoreEnding(): void {
    const saved = gameRepository.getCrisisState(this.id)?.ending;
    if (!saved) {
      this.ending = null;
      return;
    }
    this.ending = { ...saved, criticalDimensions: [saved.dimension] };
    this.status = 'finished';
  }

  /**
   * Stato di crisi per il dossier e l'HUD: rischi, giorni di criticità e
   * l'eventuale epilogo. Sola lettura: non fa avanzare la scala.
   */
  getCrisis(): { state: CrisisState; ending: CrisisEnding | null; finished: boolean; collapseDays: number } {
    const state = this.peekCrisis();
    return {
      state,
      ending: this.ending ?? state.ending,
      finished: Boolean(this.ending),
      collapseDays: state.collapseDays,
    };
  }

  /** True quando la nazione è caduta: la UI mostra l'epilogo. */
  isFinished(): boolean {
    return Boolean(this.ending);
  }

  getEnding(): CrisisEnding | null {
    return this.ending;
  }

  /** Compravendita di risorse naturali: cassa ↔ magazzino, prezzo di mercato. */
  tradeResource(mode: 'sell' | 'buy', kind: string, quantity: number) {
    this.assertPlayable();
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

  /** Riserva naturale della polity (implementazione in NationStateService). */
  private resourceLedger(polityId: string): ResourceLedger {
    return this.nationState.resourceLedger(polityId);
  }

  private saveResourceLedger(polityId: string, ledger: ResourceLedger): void {
    this.nationState.saveResourceLedger(polityId, ledger);
  }

  /** Mercato mondiale (implementazione in NationStateService). */
  private ensureMarket(): WorldMarket {
    return this.nationState.ensureMarket();
  }

  // ── Militare (Fase 1): implementazione in `game/MilitaryService` ──────────
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
    return this.military.getArsenal();
  }

  /** Ordini di produzione del giocatore, per API e dossier. */
  getProduction() {
    return this.military.getProduction();
  }

  /** Costruisce o importa equipaggiamento militare (implementazione nel servizio). */
  procureEquipment(mode: 'build' | 'buy', equipmentId: string, quantity = 1) {
    return this.military.procureEquipment(mode, equipmentId, quantity);
  }

  /** Avanza gli ordini di produzione del giocatore (stato nel servizio). */
  private advanceProduction(days: number, account?: NationalAccount): string[] {
    return this.military.advanceProduction(days, account);
  }

  /**
   * Percentuale di completamento dei progetti in corso, con rischio di
   * slittamento della scadenza: non sempre le cose vanno come previsto.
   */
  private advanceProjects(days: number, asOfDate: string): string[] {
    // `days === 0` è ammesso: serve a rinfrescare l'avanzamento alla data
    // corrente (chiusura di un run) senza inventare tempo trascorso.
    if (this.isStrictGame() || days < 0) return [];
    const processes = gameRepository.getOngoingProcesses(this.id);
    if (processes.length === 0) return [];
    const account = this.sessionAccounts()[this.playerPolityId];
    const stability = Number(account?.stability ?? 50);
    const tension = Number(account?.socialTension ?? 0);
    const risk = Math.min(0.5, 0.05 + Math.max(0, 60 - stability) / 300 + Math.max(0, tension - 30) / 500);
    const bulletins: string[] = [];
    for (const process of processes) {
      // Un progetto non torna mai indietro: lo slittamento sposta la scadenza,
      // non cancella i mesi già trascorsi.
      const progress = Math.max(
        Number.isFinite(Number(process.progress)) ? Math.max(0, Number(process.progress)) : 0,
        projectProgress(process.started_date, process.expected_date, asOfDate),
      );
      // Scadenza dichiarata raggiunta: il progetto è chiuso. Non resta
      // «in corso» al 99% quando la data prevista è ormai passata.
      if (process.expected_date && asOfDate >= process.expected_date) {
        gameRepository.completeOngoingProcessById(
          this.id,
          process.id,
          `${process.summary} Opera completata entro la scadenza prevista del ${process.expected_date}.`,
          asOfDate,
        );
        bulletins.push(`✅ Progetto «${process.title}»: completato alla scadenza prevista.`);
        continue;
      }
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

  // Relazioni internazionali: stato posseduto da DiplomacyService.


  /** Modificatori di una polity (implementazione in NationStateService). */
  private modifiersFor(polityId: string): NationalModifiers {
    return this.nationState.modifiersFor(polityId);
  }

  private saveModifiers(polityId: string, modifiers: NationalModifiers): void {
    this.nationState.saveModifiers(polityId, modifiers);
  }

  /**
   * Conti nazionali con l'overlay dei modificatori: ciò che il modello decide
   * sulla nazione entra davvero nei numeri che il motore usa (economia,
   * produzione, credito, dossier).
   */
  private sessionAccounts(regions?: Iterable<RegionState>): Record<string, NationalAccount> {
    const accounts = WorldStateEngine.accounts(regions ?? this.regions.values(), this.worldStateOptions());
    const overlaid = applyModifiersToAccounts(accounts, polityId => this.modifiersFor(polityId));
    // Il rapporto debito/PIL mostrato e usato dalle fazioni è quello EFFETTIVO
    // (titoli emessi + scoperto), per il giocatore e per gli NPC: le stesse
    // regole materiali valgono per tutti. Il debito alto pesa su tensione e
    // stabilità di chiunque lo contragga.
    return applyDebtBurdenToAccounts(overlaid, polityId => {
      // Si usano i valori di base del motore (non quelli già modificati dal
      // modello): l'effetto sociale del debito non deve muoversi con le
      // fluttuazioni di un turno, ma con la ricchezza reale della nazione.
      const base = accounts[polityId] ?? overlaid[polityId];
      const gdp = Math.max(0, Number(base?.nominalGdpUsdBillions) || 0);
      if (gdp <= 0) return null;
      // Il magazzino del giocatore è sempre noto (anche da DB). Quello degli NPC
      // si legge solo se già in cache: un tick lo popola per tutte le nazioni,
      // e così una lettura dei conti non diventa N query al database.
      const stock = polityId === this.playerPolityId
        ? this.peekResourceStock(polityId)
        : this.nationState.peekStockCached(polityId);
      if (!stock) return null;
      const revenue = Math.abs(Number(base?.monthlyRevenue) || 0) * 12;
      return {
        debtRatioPct: debtOf(stock) / gdp * 100,
        serviceRatioPct: revenue > 0 ? annualDebtServiceMld(stock) / revenue * 100 : 0,
      };
    });
  }

  /**
   * Leve del modello sulla vita della nazione (scorte, arsenale, società,
   * economia). Ogni proposta è validata, quantizzata e limitata dal motore.
   */
  /** Leve nazionali del modello (implementazione in NationStateService). */
  private applyNationalEffects(raw: unknown): { applied: NationalEffect[]; bulletins: string[] } {
    return this.nationState.applyNationalEffects(raw);
  }


  // SSE broadcaster for real-time updates
  private sseBroadcaster: ((type: SSEEventType, data: any) => boolean | void) | null = null;

  constructor(gameId: string, worldId: string, provider: LLMRouter) {
    this.id = gameId;
    this.worldId = worldId;
    this.llm = provider;
    this.coordinator = new SimulationCoordinator();
    this.worldIntel = new WorldIntelService({
      gameId: this.id,
      regions: () => this.regions,
      playerPolityId: () => this.playerPolityId,
      publicPolityName: polityId => this.publicPolityName(polityId),
      results: () => this.results,
      relationship: (from, to) => this.diplomacy.matrix().get(from, to),
      arsenalUnits: polityId => this.military.arsenalUnits(polityId),
      worldStateOptions: () => this.worldStateOptions(),
    });
    this.gameController = new GameController(provider);
    this.promptEngine = new PromptEngine(provider);
    this.npcTurns = new NpcTurnService({
      regions: () => this.regions,
      playerPolityId: () => this.playerPolityId,
      currentTurn: () => this.currentTurn,
      results: () => this.results,
      gameController: this.gameController,
      relationship: (from, to) => this.diplomacy.matrix().get(from, to),
      transferRegion: (region, owner, color) => this.transferRegion(region, owner, color),
      seed: () => this.id,
      degradeRelationship: (from, to) => this.diplomacy.matrix().degrade(from, to),
    });
    this.timeline = new TimelineService(gameId, value => this.publicText(value));
    this.geometry = new RegionGeometryService<RegionState>(() => this.regions);
    this.military = new MilitaryService({
      gameId,
      currentTurn: () => this.currentTurn,
      currentDate: () => this.currentDate,
      playerPolityId: () => this.playerPolityId,
      isStrictGame: () => this.isStrictGame(),
      accounts: () => this.sessionAccounts(),
      initialAccounts: () => this.initialAccounts(),
      resourceStock: polityId => this.resourceStock(polityId),
      saveResourceStock: (polityId, stock) => this.saveResourceStock(polityId, stock),
    });
    this.orders = new OrderExecutionService({
      gameId: this.id,
      assertPlayable: () => this.assertPlayable(),
      worldId: this.worldId,
      isStrictGame: () => this.isStrictGame(),
      playerPolityId: () => this.playerPolityId,
      playerPolity: () => this.getPlayer()?.polityId,
      accounts: () => this.sessionAccounts(),
      resourceStock: polityId => this.resourceStock(polityId),
      saveResourceStock: (polityId, stock) => this.saveResourceStock(polityId, stock),
      buildGameData: () => this.buildGameData(),
      enhanceOrder: (gameData, text) => this.gameController.enhanceAction(gameData, text),
      convertActionsBatch: (gameData, actions) => this.promptEngine.convertActionsBatch(gameData, actions, undefined),
    });
    this.nationState = new NationStateService({
      gameId: this.id,
      currentTurn: () => this.currentTurn,
      currentDate: () => this.currentDate,
      isStrictGame: () => this.isStrictGame(),
      playerPolityId: () => this.playerPolityId,
      worldStateOptions: () => this.worldStateOptions(),
      initialAccounts: () => this.initialAccounts(),
      sessionAccounts: () => this.sessionAccounts(),
      regions: () => this.regions,
      publicPolityName: polityId => this.publicPolityName(polityId),
      relationToPlayer: polityId => this.diplomacy.matrix().get(polityId, this.playerPolityId),
      nationalMilitaryPower: polityId => this.nationalMilitaryPower(polityId),
      nationalEffectiveMilitaryPower: polityId => this.nationalEffectiveMilitaryPower(polityId),
      applyPressureEffect: (effect, reason) => this.applyPressureEffect(effect, reason),
      onCrisisEnding: ending => this.finishGame(ending),
      resolvePolity: name => this.buildResolvers().polities.resolve(name)?.polityId,
      arsenalUnits: polityId => this.military.arsenalUnits(polityId),
      saveArsenal: (polityId, units) => this.military.saveArsenal(polityId, units),
    });
    this.gameData = new GameDataService({
      gameId: this.id,
      players: () => this.players,
      regions: () => this.regions,
      playerPolityId: () => this.playerPolityId,
      currentDate: () => this.currentDate,
      currentTurn: () => this.currentTurn,
      difficulty: () => this.difficulty,
      consolidatedHistory: () => this.consolidatedHistory,
      keepRawTail: () => this.llm.consolidation.keepRawTail,
      worldName: () => this.worldName,
      worldBasePrompt: () => this.worldBasePrompt,
      worldStartDate: () => this.worldStartDate,
      worldSimulationRules: () => this.worldSimulationRules,
      isStrictGame: () => this.isStrictGame(),
      publicPolityName: polityId => this.publicPolityName(polityId),
      sessionAccounts: () => this.sessionAccounts(),
      arsenalUnits: polityId => this.military.arsenalUnits(polityId),
      peekArsenal: polityId => this.military.peekArsenal(polityId),
      resourceStock: polityId => this.resourceStock(polityId),
      resourceLedger: polityId => this.resourceLedger(polityId),
      modifiersFor: polityId => this.modifiersFor(polityId),
      productionOrders: () => this.getProduction().orders,
      governmentVoices: () => this.governmentVoices,
      governmentVoiceKey: () => this.governmentVoiceKey(),
      peekCrisis: () => this.peekCrisis(),
      ending: () => this.ending,
      pendingFundingNotes: () => this.pendingFundingNotes,
      buildNpcStrategicDossiers: (focusTexts, accounts) => this.buildNpcStrategicDossiers(focusTexts, accounts),
      relationships: () => this.diplomacy.toJSON(),
      chatTranscripts: () => this.diplomacy.buildChatTranscripts(),
      actions: () => this.actions,
      results: () => this.results,
    });
    this.worldMutation = new WorldMutationService({
      regions: () => this.regions,
      isStrictGame: () => this.isStrictGame(),
      currentDate: () => this.currentDate,
      playerPolityId: () => this.playerPolityId,
      buildResolvers: () => this.buildResolvers(),
      worldStateOptions: () => this.worldStateOptions(),
      transferRegion: (region, newOwner, explicitColor) => this.transferRegion(region, newOwner, explicitColor),
      geometry: {
        frontierPosition: (region, target) => this.geometry.frontierPosition(region, target),
        regionCenter: region => this.geometry.regionCenter(region),
        resolveRegionFlexible: (key, resolver) => this.geometry.resolveRegionFlexible(key, resolver),
      },
      applyNationalEffects: raw => this.applyNationalEffects(raw),
      pushNationalNote: note => this.pendingNationalNotes.push(note),
      mentionedNpcPolityIds: texts => this.mentionedNpcPolityIds(texts),
      eventDetail: event => this.eventDetail(event),
      arsenalUnits: polityId => this.military.arsenalUnits(polityId),
      saveArsenal: (polityId, units) => this.military.saveArsenal(polityId, units),
      resourceStock: polityId => this.resourceStock(polityId),
      saveResourceStock: (polityId, stock) => this.saveResourceStock(polityId, stock),
    });
    this.persistence = new GamePersistenceService({
      gameId: this.id,
      captureState: () => this.captureCheckpointData(),
      currentTurn: () => this.currentTurn,
      isStrictGame: () => this.isStrictGame(),
      captureApplyState: () => this.captureApplyState(),
      applyState: state => this.applyPersistenceState(state),
      prepareRestore: () => this.prepareRestoreState(),
      syncRegionsToDB: () => this.syncRegionsToDB(),
      afterRestore: () => this.afterRestoreState(),
    });
    this.diplomacy = new DiplomacyService({
      gameId: this.id,
      playerPolityId: () => this.playerPolityId,
      players: () => this.players,
      regions: () => this.regions,
      buildResolvers: () => this.buildResolvers(),
      publicPolityName: polityId => this.publicPolityName(polityId),
      polityColor: (polityId, excludeRegionId) => this.polityColor(polityId, excludeRegionId),
      publicText: value => this.publicText(value),
      crisisRelevantPolityIds: (texts, seed) => this.crisisRelevantPolityIds(texts, seed),
      hasGeographicAdjacency: () => this.hasGeographicAdjacency(),
      assertNoActiveRun: () => {
        if (this.hasActiveRun()) throw new SimulationInProgressError();
      },
      fenceContext: () => this.fenceContext(),
      assertFenceValid: fence => this.assertFenceValid(fence),
      currentTurn: () => this.currentTurn,
      currentDate: () => this.currentDate,
      results: () => this.results,
      worldBasePrompt: () => this.worldBasePrompt,
      worldSimulationRules: () => this.worldSimulationRules,
      difficulty: () => this.difficulty,
      llm: this.llm,
      broadcast: (type, data) => this.broadcast(type, data),
      worldStateOptions: () => this.worldStateOptions(),
      nationalEffectiveMilitaryPower: (polityId, accounts) => this.nationalEffectiveMilitaryPower(polityId, accounts),
      hostileNeighbourCount: polityId => this.hostileNeighbourCount(polityId),
      recentStrategicMemory: (polityId, limit) => this.recentStrategicMemory(polityId, limit),
    });
    // F04 §9.4: ogni partita nasce (o riapre) sul suo ramo principale.
    // Idempotente: le sessioni ricostruite dal DB non duplicano il ramo.
    this.playback = new PlaybackService({
      gameId: this.id,
      state: this.state,
      coordinator: this.coordinator,
      diplomacy: this.diplomacy,
      orders: this.orders,
      isStrictGame: () => this.isStrictGame(),
      publicText: value => this.publicText(value),
      publicPolityName: polityId => this.publicPolityName(polityId),
      broadcast: (type, data) => this.broadcast(type, data),
      buildResolvers: () => this.buildResolvers(),
      captureCheckpointData: () => this.captureCheckpointData(),
      captureMovementIntents: actions => this.captureMovementIntents(actions),
      outcomesByActionId: (...args: any[]) => (this.outcomesByActionId as any)(...args),
      advanceWorldState: (days, asOfDate) => this.advanceWorldState(days, asOfDate),
      applyFrontierPlacements: (...args: any[]) => (this.applyFrontierPlacements as any)(...args),
      applyMapChanges: (...args: any[]) => (this.applyMapChanges as any)(...args),
      applyWorldChanges: changes => this.applyWorldChanges(changes),
      reconcileNpcMaterialMeasures: event => this.reconcileNpcMaterialMeasures(event),
      reactionChatStarts: (...args: any[]) => (this.reactionChatStarts as any)(...args),
      recordAccountSnapshot: (...args: any[]) => (this.recordAccountSnapshot as any)(...args),
      enqueueOutboxRows: (...args: any[]) => (this.enqueueOutboxRows as any)(...args),
      publishPendingOutbox: limit => this.publishPendingOutbox(limit),
      syncRegionsToDB: () => this.syncRegionsToDB(),
      maybeConsolidate: () => this.maybeConsolidate(),
      getAdvisorUnchecked: (...args: any[]) => (this.getAdvisorUnchecked as any)(...args),
      refreshProjectProgress: asOfDate => this.refreshProjectProgress(asOfDate),
      settleOrderCosts: (...args: any[]) => (this.settleOrderCosts as any)(...args),
      reconcileAcceptedMoves: (...args: any[]) => (this.reconcileAcceptedMoves as any)(...args),
      movementNotices: (...args: any[]) => (this.movementNotices as any)(...args),
    });
    this.turnPipeline = new TurnPipelineService({
      gameId: this.id,
      worldId: this.worldId,
      state: this.state,
      coordinator: this.coordinator,
      diplomacy: this.diplomacy,
      orders: this.orders,
      playback: this.playback,
      gameController: this.gameController,
      isStrictGame: () => this.isStrictGame(),
      publicText: value => this.publicText(value),
      publicPolityName: polityId => this.publicPolityName(polityId),
      broadcast: (type, data) => this.broadcast(type, data),
      buildGameData: (...args: any[]) => (this.buildGameData as any)(...args),
      buildResolvers: () => this.buildResolvers(),
      canonicalizeEventReactions: (...args: any[]) => (this.canonicalizeEventReactions as any)(...args),
      captureCheckpointData: () => this.captureCheckpointData(),
      captureMovementIntents: actions => this.captureMovementIntents(actions),
      outcomesByActionId: (...args: any[]) => (this.outcomesByActionId as any)(...args),
      advanceWorldState: (...args: any[]) => (this.advanceWorldState as any)(...args),
      applyFrontierPlacements: (...args: any[]) => (this.applyFrontierPlacements as any)(...args),
      applyMapChanges: (...args: any[]) => (this.applyMapChanges as any)(...args),
      applyWorldChanges: changes => this.applyWorldChanges(changes),
      mentionedNpcPolityIds: texts => this.mentionedNpcPolityIds(texts),
      reactionChatStarts: (...args: any[]) => (this.reactionChatStarts as any)(...args),
      recordAccountSnapshot: (...args: any[]) => (this.recordAccountSnapshot as any)(...args),
      enqueueOutboxRows: (...args: any[]) => (this.enqueueOutboxRows as any)(...args),
      publishPendingOutbox: limit => this.publishPendingOutbox(limit),
      syncRegionsToDB: () => this.syncRegionsToDB(),
      saveRewindSnapshot: () => this.saveRewindSnapshot(),
      maybeConsolidate: () => this.maybeConsolidate(),
      getAdvisorUnchecked: (...args: any[]) => (this.getAdvisorUnchecked as any)(...args),
      refreshProjectProgress: asOfDate => this.refreshProjectProgress(asOfDate),
      refreshPeacetimePressures: () => this.refreshPeacetimePressures(),
      evaluateCrisis: advance => this.evaluateCrisis(advance),
      settleOrderCosts: (...args: any[]) => (this.settleOrderCosts as any)(...args),
      orderFundingNotes: actions => this.orderFundingNotes(actions),
      reconcileAcceptedMoves: (...args: any[]) => (this.reconcileAcceptedMoves as any)(...args),
      movementNotices: (...args: any[]) => (this.movementNotices as any)(...args),
      withLock: fn => this.withLock(fn),
    });
    this.bootstrap = new SessionBootstrapService({
      gameId: this.id,
      worldId: this.worldId,
      state: this.state,
      diplomacy: this.diplomacy,
      orders: this.orders,
      gameController: this.gameController,
      buildGameData: (...args: any[]) => (this.buildGameData as any)(...args),
      ensurePeacetimePressures: () => this.ensurePeacetimePressures(),
      restoreEnding: () => this.restoreEnding(),
      seedInitialResources: () => this.seedInitialResources(),
      syncRegionsToDB: () => this.syncRegionsToDB(),
      revivePausedRunFromRow: row => this._revivePausedRunFromRow(row),
    });
    this.liveTick = new LiveTickService({
      gameId: this.id,
      state: this.state,
      coordinator: this.coordinator,
      isStrictGame: () => this.isStrictGame(),
      publicText: value => this.publicText(value),
      publicPolityName: polityId => this.publicPolityName(polityId),
      broadcast: (type, data) => this.broadcast(type, data),
      applyRandomEvents: () => this.applyRandomEvents(),
      applyWorldConflicts: () => this.applyWorldConflicts(),
      worldStateOptions: () => this.worldStateOptions(),
      syncRegionsToDB: () => this.syncRegionsToDB(),
      withLock: fn => this.withLock(fn),
    });
    this.history = new HistoryService({ gameId: this.id, state: this.state, llm: this.llm });
    this.outbox = new OutboxService({
      gameId: this.id,
      hasClient: () => this.sseBroadcaster !== null,
      broadcast: (type, data) => this.broadcast(type, data),
    });
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
  /** Read model GameData per il motore di prompt (implementazione in GameDataService). */
  private buildGameData(focusTexts: string[] = [], currentActions: CurrentReactionAction[] = []): any {
    return this.gameData.build(focusTexts, currentActions);
  }

  // =========================================================================
  // Chat diplomatiche (stile Pax Historia): uno-a-uno e di gruppo,
  // «next speaker» deciso dall'LLM, auto-continuazione tra nazioni.
  // =========================================================================

  /** Elenco chat del gioco (implementazione in DiplomacyService). */
  getChats(includeArchived = false): ChatSummary[] {
    return this.diplomacy.getChats(includeArchived);
  }

  /** Archivia una discussione. */
  archiveChat(chatId: string): void {
    this.diplomacy.archiveChat(chatId);
  }

  /** Riapre una discussione archiviata. */
  unarchiveChat(chatId: string): void {
    this.diplomacy.unarchiveChat(chatId);
  }

  /** Messaggi della chat. */
  getChatMessages(chatId: string): ChatMessageRecord[] {
    return this.diplomacy.getChatMessages(chatId);
  }

  /** Segna i messaggi delle politie della chat come letti. */
  markChatRead(chatId: string): void {
    this.diplomacy.markChatRead(chatId);
  }

  /** Trova o crea la chat con le nazioni indicate (implementazione in DiplomacyService). */
  ensureChat(polityNames: string[], options: {
    dedupeKey?: string;
    subject?: string;
    origin?: 'player' | 'simulation';
  } = {}): ChatRecord {
    return this.diplomacy.ensureChat(polityNames, options);
  }

  /** Conserva soltanto reazioni attribuite a politie realmente presenti. */
  private canonicalizeEventReactions(event: SimulationEvent, actionTexts: string[] = []): SimulationEvent {
    const resolver = this.buildResolvers().polities;
    const seen = new Set<string>();
    // Una reazione è valida solo se la politia è pertinente al teatro della
    // crisi (nominata, vicina o con un rapporto). Le potenze lontane senza
    // interesse documentato restano fuori dal dispaccio e dalle chat.
    const relevantPolities = this.crisisRelevantPolityIds([event.headline, event.description, ...actionTexts]);
    const knownOwners = new Set(Array.from(this.regions.values()).map(region => region.owner));
    const reactions = (event.reactions || []).flatMap(reaction => {
      // Il contratto ha già validato `actorId` contro il ReactionContext: se
      // c'è, è la fonte autorevole dell'attribuzione e la selezione degli
      // attori è del motore, non del testo dell'evento. Senza `actorId`
      // (dato legacy) resta il percorso storico su `polityName`.
      const actorId = typeof reaction.actorId === 'string' ? reaction.actorId.trim() : '';
      const validatedActor = actorId && knownOwners.has(actorId);
      const resolution = validatedActor ? { polityId: actorId, isNew: false } : resolver.resolve(reaction.polityName);
      if (!resolution || resolution.isNew || resolution.polityId === 'neutral'
          || resolution.polityId === this.playerPolityId || seen.has(resolution.polityId)) return [];
      if (!validatedActor && !relevantPolities.has(resolution.polityId)) return [];
      seen.add(resolution.polityId);
      return [{
        ...reaction,
        // `actorId` è aggiunto/canonicalizzato SOLO quando il contratto l'ha già
        // validato: una reaction legacy senza `actorId` non viene riscritta (§5).
        actorId: validatedActor ? resolution.polityId : reaction.actorId,
        polityName: this.publicPolityName(resolution.polityId),
        priority: reaction.priority ? this.publicText(reaction.priority) : undefined,
        response: this.publicText(reaction.response),
        note: reaction.note ? this.publicText(reaction.note) : undefined,
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
          // Il canale diplomatico parla con la voce della nazione: usiamo la sua
          // nota diretta quando c'è, altrimenti la decisione (senza etichette
          // da bollettino come «Misura annunciata»).
          topic: (reaction.note && reaction.note.trim())
            || [reaction.response, reaction.counterAction].filter(Boolean).join(' '),
          kind: 'statement' as const,
          eventHeadline: event.headline,
        }];
      });
    });
  }

  /**
   * Invia un messaggio del giocatore (implementazione in DiplomacyService).
   */
  async sendChatMessage(chatId: string, content: string): Promise<{ message: ChatMessageRecord; reply: ChatMessageRecord }> {
    return this.diplomacy.sendChatMessage(chatId, content);
  }

  /** «Lascia che parlino»: le nazioni proseguono tra loro (implementazione in DiplomacyService). */
  async continueChat(chatId: string, exchanges: number = 2): Promise<{ replies: ChatMessageRecord[] }> {
    return this.diplomacy.continueChat(chatId, exchanges);
  }

  /**
   * Initialize session from existing world data
   */
  /** Nuova partita da un mondo (implementazione in SessionBootstrapService). */
  async initialize(
    playerRegionId: string,
    playerName: string,
    playerColor: string = '#FF0000',
    difficulty?: string,
  ): Promise<string> {
    return this.bootstrap.initialize(playerRegionId, playerName, playerColor, difficulty);
  }

  /** Ricostruzione da stato DB (implementazione in SessionBootstrapService). */
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
    this.bootstrap.reconstructFromDB(data);
  }

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
  getTimeline(): TimelineEntry[] {
    return this.timeline.getTimeline(this.results);
  }

  /**
   * Pagina la cronaca persistita dal DB (§10.1). `afterTurn` è il cursore
   * (turno da cui continuare); `limit` è la dimensione della pagina. Restituisce
   * `hasMore` e `nextAfter` per il recupero progressivo, così il registro non
   * è limitato irreversibilmente ai turni in memoria o agli ultimi N eventi.
   */
  getTimelinePage(afterTurn: number, limit: number): {
    timeline: TimelineEntry[];
    hasMore: boolean;
    nextAfter: number;
  } {
    return this.timeline.getTimelinePage(afterTurn, limit);
  }

  /**
   * Build name resolvers from the current region state.
   * "ИИ по именам, движок по id": LLM видит только имена, движок резолвит их
   * обратно в regionId/polityId (bug fix: раньше LLM просили вернуть regionId,
   * который он никогда не видел, поэтому mapChanges почти никогда не применялись).
   */
  /** Name resolvers correnti (implementazione in WorldIntelService). */
  private buildResolvers(): { regions: RegionResolver; polities: PolityResolver } {
    return this.worldIntel.buildResolvers();
  }

  /** Politie nominate nei testi (implementazione in WorldIntelService). */
  private mentionedNpcPolityIds(texts: string[]): string[] {
    return this.worldIntel.mentionedNpcPolityIds(texts);
  }

  /** Il mondo offre informazioni di adiacenza (implementazione in WorldIntelService). */
  private hasGeographicAdjacency(): boolean {
    return this.worldIntel.hasGeographicAdjacency();
  }

  /** Politie pertinenti a una crisi (implementazione in WorldIntelService). */
  private crisisRelevantPolityIds(texts: string[], seedPolityIds: string[] = []): Set<string> {
    return this.worldIntel.crisisRelevantPolityIds(texts, seedPolityIds);
  }

  /** Misure materiali delle controparti (implementazione in WorldIntelService). */
  private reconcileNpcMaterialMeasures(event: SimulationEvent): SimulationEvent {
    return this.worldIntel.reconcileNpcMaterialMeasures(event);
  }

  /** Potenza militare di mappa (implementazione in WorldIntelService). */
  private nationalMilitaryPower(polityId: string): number {
    return this.worldIntel.nationalMilitaryPower(polityId);
  }

  /** Potenza militare effettiva (implementazione in WorldIntelService). */
  private nationalEffectiveMilitaryPower(polityId: string, accounts?: Record<string, NationalAccount>): number {
    return this.worldIntel.nationalEffectiveMilitaryPower(polityId, accounts);
  }

  /** Vicini ostili (implementazione in WorldIntelService). */
  private hostileNeighbourCount(polityId: string): number {
    return this.worldIntel.hostileNeighbourCount(polityId);
  }

  /** Memoria strategica verificabile (implementazione in WorldIntelService). */
  private recentStrategicMemory(polityId: string, limit = 3): string[] {
    return this.worldIntel.recentStrategicMemory(polityId, limit);
  }

  /** Dossier NPC per il simulatore (implementazione in WorldIntelService). */
  private buildNpcStrategicDossiers(
    focusTexts: string[],
    accounts: ReturnType<typeof WorldStateEngine.accounts>,
  ): string {
    return this.worldIntel.buildNpcStrategicDossiers(focusTexts, accounts);
  }

  /** Colore canonico di una politia (implementazione in WorldIntelService). */
  private polityColor(polityId: string, excludeRegionId?: string): string | undefined {
    return this.worldIntel.polityColor(polityId, excludeRegionId);
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

  /** M06 µ3: la partita è strict se il catalogo server-side lo dichiara. */
  private isStrictGame(): boolean {
    return gameRepository.getEconomyMode(this.id) === 'strict';
  }

  /** Modifiche al mondo (implementazione in WorldMutationService). */
  private applyWorldChanges(changes: WorldChanges): void {
    this.worldMutation.applyWorldChanges(changes);
  }

  /** Materializza le formazioni di frontiera (implementazione in WorldMutationService). */
  private applyFrontierPlacements(
    event: SimulationEvent,
    changed: RegionState[],
    actionTexts: string[] = [],
  ): RegionState[] {
    return this.worldMutation.applyFrontierPlacements(event, changed, actionTexts);
  }

  /** Applica i mapChanges di un evento (implementazione in WorldMutationService). */
  private applyMapChanges(mapChanges: MapChange[] | undefined, movedDate = this.currentDate): RegionState[] {
    return this.worldMutation.applyMapChanges(mapChanges, movedDate);
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
    const accepted = this.acceptedActionIds(actions, outcomes);
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
        || JSON.stringify(unit) !== intent.fingerprint) {
        continue;
      }
      const touched = this.applyMapChanges([{
        type: 'move_unit', regionId: origin.id, targetRegionName: target.id,
        feature: { type: intent.unitType as any, id: intent.unitId, name: intent.unitName },
      }], movedDate);
      for (const region of touched) changed.set(region.id, region);
    }
    return [...changed.values()];
  }

  /**
   * Ordini con esito pienamente accettato. Un ID è autorevole; il testo legacy
   * è ammesso solo senza ID e solo per un ordine unico in coda. Esiti
   * contrastanti non eseguono nulla.
   */
  private acceptedActionIds(actions: PendingAction[], outcomes: ActionOutcome[]): Set<string> {
    return new Set(actions.filter(action => {
      const matching = outcomes.filter(outcome => outcome.actionId
        ? outcome.actionId === action.id
        : outcome.action === action.text && actions.filter(other => other.text === action.text).length === 1);
      return matching.length > 0 && matching.every(outcome => outcome.status === 'accepted');
    }).map(action => action.id));
  }

  /**
   * ARMY-MOVE: motivazioni esplicite per gli ordini di movimento accettati che
   * non hanno spostato nulla. Riusa la stessa analisi del parser deterministico
   * e la posizione reale delle unità: nessun blocco resta silenzioso.
   */
  private movementNotices(
    actions: PendingAction[],
    outcomes: ActionOutcome[],
    intents: MovementIntent[] = this.captureMovementIntents(actions),
  ): string[] {
    if (this.isStrictGame()) return [];
    const regions = [...this.regions.values()];
    const acceptedIds = this.acceptedActionIds(actions, outcomes);
    return buildMovementNotices({
      accepted: actions.filter(action => acceptedIds.has(action.id)).map(action => ({ actionId: action.id, text: action.text })),
      analyses: actions.map(action => ({
        actionId: action.id,
        block: analyzeMovementOrder(action.text, regions, this.playerPolityId, action.id).block,
      })),
      intents,
      regions,
    });
  }

  /**
   * Process NPC turns for all NPC countries
   */
  /** Turni NPC (implementazione in NpcTurnService). */
  private async processNPCTurns(limit = GameSession.TURN_NPC_LIMIT, days = 30): Promise<string[]> {
    return this.npcTurns.processNPCTurns(limit, days);
  }

  /** Eventi casuali (implementazione in NpcTurnService). */
  private applyRandomEvents(): string[] {
    return this.npcTurns.applyRandomEvents();
  }

  /**
   * WORLD-ALIVE P3: conflitti deterministici del mondo fra politie NPC.
   * Riusa `NpcTurnService` (politiche e `transferRegion`), senza LLM: il tick
   * live non attende e le conquiste finiscono su mappa, timeline e dispacci.
   */
  private applyWorldConflicts(): string[] {
    return this.npcTurns.processWorldConflictTick(GameSession.LIVE_TICK_DAYS);
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
      relationships: this.diplomacy.toJSON(),
      actions: this.actions,
      results: this.results,
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      // §9.3: con un run in pausa la coda contiene anche ordini già emessi;
      // senza pausa «processing» non esiste mai qui (save è 409 durante il run).
      pendingActions: this.orders.queue().filter(action => action.status === 'pending' || action.status === 'processing'),
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
    return this.persistence.save(name);
  }

  /**
   * F04 §9.4.1: hash semantico dello stato corrente della sessione, calcolato
   * con la stessa funzione del salvataggio. Il DoD del restore (C12) lo
   * confronta con l’hash del checkpoint scelto, esclusi i metadati del ramo.
   */
  semanticHash(): string {
    return this.persistence.semanticHash();
  }

  /**
   * Load session from save data (implementazione in GamePersistenceService).
   * F04 §9.4.1: con l'hash atteso lo snapshot è validato prima di mutare la
   * sessione; un hash incompatibile rifiuta il restore.
   */
  loadFromSave(
    saveData: SaveData,
    expectedHash?: string | null,
    options?: { newBranch?: { originCheckpointId?: string | null; name?: string } },
  ): { branchId: string | null } {
    return this.persistence.loadFromSave(saveData, expectedHash, options);
  }

  /** Cattura dello stato per lo staging di rollback del restore. */
  private captureApplyState(): PersistenceApplyState {
    return {
      ...this.state.captureCore(),
      relationships: this.diplomacy.toJSON(),
      pendingActions: this.orders.snapshot(),
    };
  }

  /** Scrive in RAM lo stato calcolato dal restore (forward o rollback). */
  private applyPersistenceState(state: PersistenceApplyState): void {
    this.state.applyCore(state);
    this.diplomacy.replaceFromJSON(state.relationships);
    this.orders.replaceQueue(state.pendingActions);
  }

  /** Fase di commit del restore: aliquota ed esito (come il restore originale). */
  private prepareRestoreState(): void {
    this.taxRatePct = gameRepository.getTaxRatePct(this.id);
    this.restoreEnding();
  }

  /** Effetti collaterali del restore riuscito. */
  private afterRestoreState(): void {
    this.ensurePeacetimePressures();
  }

  // Этап 2: Rewind-снапшоты, Intervene, консолидация истории
  // =========================================================================

  /**
   * Снапшот перед ходом — основа rewind. Хранится в saves под служебным
   * именем '__rewind__'; держим только один (последний) снапшот на игру.
   */
  private saveRewindSnapshot(): void {
    this.persistence.saveRewindSnapshot();
  }

  /**
   * Откат на ход назад: восстанавливает снапшот, снятый перед последним ходом,
   * и вычищает «будущие» записи действий/результатов из БД.
   * Возвращает новое состояние или null, если откатываться некуда.
   */
  rewind(): { turn: number; date: string } | null {
    const snapshot = this.persistence.latestRewindSnapshot();
    if (!snapshot) return null;
    const { id: snapshotId, saveData, hash } = snapshot;

    // Le sfide nate nei turni annullati non appartengono più alla storia.
    gameRepository.deletePressuresAfterTurn(this.id, (Number(saveData.currentTurn) || 0) - 1);
    // Un turno annullato cancella anche il collasso: si torna a giocare.
    gameRepository.resetCrisisState(this.id);
    this.loadFromSave(saveData, hash);
    this.status = 'playing';
    gameRepository.setStatus(this.id, 'playing');
    this.ending = null;
    // Результат откаченного хода записан с turn == восстановленному currentTurn
    gameRepository.deleteAfterTurn(this.id, this.currentTurn - 1);
    // Снапшот потреблён — повторный rewind подряд невозможен
    this.persistence.consumeRewindSnapshot(snapshotId);

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
    return this.persistence.canRewind();
  }

  /**
   * Intervene: arresta lo stream logico dopo l'evento corrente; gli oggetti
   * successivi eventualmente già in transito non vengono applicati.
   */
  requestIntervene(simulationId?: string): { accepted: boolean; simulationId?: string } {
    if (!this.coordinator.isProcessing || !this.coordinator.activeSimulationRunId) return { accepted: false };
    if (simulationId && simulationId !== this.coordinator.activeSimulationRunId) return { accepted: false };
    this.interveneRequested = true;
    this.coordinator.abortActive();
    console.log('[GameSession] Intervene requested for run:', this.coordinator.activeSimulationRunId);
    return { accepted: true, simulationId: this.coordinator.activeSimulationRunId };
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
  /** Avvia il playback scaglionato (implementazione in PlaybackService). */
  private async _startPausedPlaybackUnlocked(opts: {
    simulationRunId: string;
    actions: PendingAction[];
    promptResult: any;
    proposedEvents: SimulationEvent[];
    periodStart: string;
    horizonDate: string;
  }): Promise<PendingAction[] | PausedBatchResult> {
    return this.playback.startPausedPlaybackUnlocked(opts);
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
      if (event) return this.playback.commitPausedStepUnlocked(state, event);
      // Nessuna proposta residua: «Continua» autorizza l'avanzamento a
      // destinazione — o la chiusura onesta se il budget non ha coperto il
      // periodo richiesto (§7.2/T36).
      return this.playback.completePausedRunUnlocked(state, state.incomplete ? 'paused_budget' : 'completed');
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
      return this.playback.completePausedRunUnlocked(state, 'intervened');
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
    return this.persistence.revivePausedRun(pausedSimulationId);
  }

  private _revivePausedRunFromRow(row: any): PausedRunState | null {
    return this.persistence.revivePausedRunFromRow(row);
  }

  /** Codec dello stato di un run in pausa (implementazione in GamePersistenceService). */
  private _revivePausedRunState(raw: any): PausedRunState | null {
    return this.persistence.revivePausedRunState(raw);
  }

  /** Consolidamento della cronaca (implementazione in HistoryService). */
  private async maybeConsolidate(): Promise<void> {
    return this.history.maybeConsolidate();
  }

  /**
   * Get all relationships for the frontend UI
   */
  getRelationships(): Record<string, Record<string, string>> {
    return this.diplomacy.getRelationships();
  }

  /** Dossier aggregati aggiornati dalla fonte di verità provinciale. */
  getNationalAccounts() {
    return this.sessionAccounts();
  }

  /** Polity del paese giocatore (es. `ITA`). */
  getPlayerPolityId(): string {
    return this.playerPolityId;
  }

  /**
   * Le anime del governo e il dettaglio del bilancio del paese giocatore.
   * Tutto è derivato dal conto nazionale già overlayato dai modificatori:
   * nessuna cifra nuova, solo lettura leggibile delle stesse fonti.
   */
  getGovernment() {
    return governmentSnapshot(this.sessionAccounts()[this.playerPolityId]);
  }

  /** Chiave del turno corrente per la cache delle voci del consiglio. */
  private governmentVoiceKey(): string {
    return `${this.currentTurn}:${this.currentDate}`;
  }

  /**
   * Voci delle anime del governo, generate dall'LLM per il turno corrente.
   * La snapshot è quella del motore: il modello non inventa fazioni né
   * richieste. Se l'LLM non risponde, la UI mostra la richiesta deterministica.
   */
  async getGovernmentVoices(): Promise<{ council: string; voices: Record<string, string>; generated: boolean }> {
    if (this.hasActiveRun()) throw new SimulationInProgressError();
    const snapshot = this.getGovernment();
    const key = this.governmentVoiceKey();
    if (this.governmentVoices && this.governmentVoices.key === key) {
      return { ...this.governmentVoices.data, generated: true };
    }
    const gameData = this.buildGameData();
    const parsed = await this.gameController.getGovernmentVoiceWithPrompts(gameData, snapshot);
    if (!parsed) return { council: '', voices: {}, generated: false };
    this.governmentVoices = { key, data: parsed };
    return { ...parsed, generated: true };
  }

  /**
   * Progetti in corso con avanzamento **sempre** leggibile. Le righe create
   * prima del calcolo dell'avanzamento hanno `progress` nullo: qui la
   * percentuale viene ricalcolata dalle date (stessa formula del tick), così
   * l'interfaccia non mostra mai un progetto senza stato di avanzamento.
   */
  getOngoingProcesses() {
    return this.timeline.getOngoingProcesses(this.currentDate);
  }

  /** Rinfresca l'avanzamento dei progetti a una data (idempotente). */
  refreshProjectProgress(asOfDate: string = this.currentDate): string[] {
    return this.advanceProjects(0, asOfDate);
  }

  /** Progetti chiusi di recente, letti dal motore (read model del Dossier). */
  getCompletedProcesses(limit = 20) {
    return this.timeline.getCompletedProcesses(limit);
  }

  /**
   * Costo deterministico di un ordine in testo libero, dal conto nazionale.
   * È la stessa stima che l'interfaccia mostra prima di registrare l'ordine.
   */
  estimateOrderCost(text: string): OrderCostEstimate {
    return this.orders.estimateOrderCost(text);
  }

  /** Addebita alla tesoreria gli ordini eseguiti (implementazione in OrderExecutionService). */
  private settleOrderCosts(
    actionOutcomes: Array<{ actionId?: string; action?: string; status?: string }> | undefined,
    batchActionIds: string[],
    texts: Map<string, string>,
  ): { lines: string[]; unfunded: Array<{ actionId: string; action: string; reason: string }> } {
    return this.orders.settleOrderCosts(actionOutcomes, batchActionIds, texts);
  }

  /** Vincoli di cassa/credito consegnati al narratore (implementazione nel servizio). */
  private orderFundingNotes(actions: PendingAction[]): string | null {
    return this.orders.orderFundingNotes(actions);
  }

  /** Rende definitivo uno snapshot caricato: prima questa operazione mutava
   * solo la RAM, quindi al refresh data, turno e dispacci tornavano allo stato
   * precedente registrato nel database. */
  async persistLoadedState(): Promise<void> {
    await this.syncRegionsToDB();
    gameRepository.replaceHistory(this.id, this.actions, this.results);
    const relationshipRows = Object.entries(this.diplomacy.toJSON()).flatMap(([from, targets]) =>
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

  /** Registra le righe outbox nella transazione canonica (implementazione in OutboxService). */
  private enqueueOutboxRows(
    runId: string,
    checkpointId: string,
    revision: number,
    turn: number,
    rows: Array<{ id: string; date: string; headline: string; detail?: string; source: string; sourceActionIds?: string[] }>,
  ): void {
    this.outbox.enqueueOutboxRows(runId, checkpointId, revision, turn, rows);
  }

  /** Pubblica gli eventi outbox già committati (implementazione in OutboxService). */
  publishPendingOutbox(limit = 200): number {
    return this.outbox.publishPendingOutbox(limit);
  }

  /** Add action to pending queue (implementazione in OrderExecutionService). */
  queueAction(text: string): PendingAction {
    return this.orders.enqueue(text);
  }

  /** G24 — anteprima riformulata di un ordine (implementazione nel servizio). */
  async enhanceAction(text: string): Promise<{ original: string; enhanced: string }> {
    return this.orders.enhanceAction(text);
  }

  /** G4-B — verifica fattibilità da testo libero (sola lettura). */
  async checkFeasibility(text: string): Promise<OrderAssessment> {
    return this.orders.checkFeasibility(text);
  }

  /** G4-B/G4-D — assessment + stima costi in un solo percorso LLM. */
  async checkFeasibilityWithCosts(text: string): Promise<{ assessment: OrderAssessment; costs: CostEstimate }> {
    return this.orders.checkFeasibilityWithCosts(text);
  }

  /** Get all pending actions */
  getPendingActions(): PendingAction[] {
    return this.orders.getPendingActions();
  }

  getQueueVersion(): number {
    return this.orders.getQueueVersion();
  }

  /** Risoluzione canonica degli esiti LLM per actionId (implementazione nel servizio). */
  private outcomesByActionId(
    actions: PendingAction[],
    outcomes: ActionOutcome[] | undefined,
    convertedActions: ConvertedAction[] | undefined,
  ): Map<string, ActionOutcome> {
    return this.orders.outcomesByActionId(actions, outcomes, convertedActions);
  }

  /** Rimuove dalla coda un ordine non ancora avviato. */
  removePendingAction(actionId: string): boolean {
    return this.orders.removePendingAction(actionId);
  }

  /** Modifica il testo di un ordine ancora in coda (implementazione nel servizio). */
  updatePendingAction(actionId: string, newText: string): PendingAction | null {
    return this.orders.updatePendingAction(actionId, newText);
  }

  /** Clear completed actions from queue */
  clearCompletedActions(): void {
    this.orders.clearCompletedActions();
  }

  /**
   * Process a single queued action. This remains for compatibility with the
   * legacy endpoint; every normal time jump must use the batch method below.
   */
  async processNextAction(jumpDays: number = 30): Promise<PendingAction | null> {
    const result = await this.withLock(async () => {
      this.assertPlayable();
      if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
      const action = this.orders.queue().find(item => item.status === 'pending');
      if (!action) return [];
      return this._processActionBatchUnlocked(jumpDays, [action]);
    });
    if (result === null) throw new SimulationInProgressError();
    if (!Array.isArray(result)) return null; // §9.3: il run è in pausa su un checkpoint per-evento
    return result[0] || null;
  }

  /** Simula il salto per tutti gli ordini in coda (implementazione in TurnPipelineService). */
  async processAllPendingActions(
    jumpDays: number = 30,
    idempotencyKey?: string,
  ): Promise<PendingAction[] | PausedBatchResult> {
    return this.turnPipeline.processAllPendingActions(jumpDays, idempotencyKey);
  }

  /** Simula un salto senza nuovi ordini (implementazione in TurnPipelineService). */
  async processWorldAdvance(
    jumpDays: number = 30,
    idempotencyKey?: string,
  ): Promise<TurnResultRecord | PausedBatchResult | null> {
    return this.turnPipeline.processWorldAdvance(jumpDays, idempotencyKey);
  }

  /**
   * Simulate one time interval for all selected orders. A batch deliberately
   * has one date range, one LLM simulation and one turn: processing N queued
   * orders must never advance the clock N times.
   *
   * This private method assumes that the caller owns `withLock`.
   */
  /** Lotto di ordini: orchestrazione (implementazione in TurnPipelineService). */
  private async _processActionBatchUnlocked(
    jumpDays: number,
    actions: PendingAction[],
    idempotencyKey?: string,
  ): Promise<PendingAction[] | PausedBatchResult> {
    return this.turnPipeline.processActionBatchUnlocked(jumpDays, actions, idempotencyKey);
  }

  async advanceDate(jumpDays: number = 30): Promise<{ newDate: string; newTurn: number }> {
    if (this.isStrictGame()) throw new Error('strict_legacy_path_forbidden: advanceDate');
    this.assertPlayable();
    // §9.3: un run in pausa possiede il turno: nemmeno il percorso legacy
    // può far avanzare il mondo dietro la finestra di lettura del giocatore.
    if (this.pausedRun) throw new SimulationPausedError(this.pausedRun.runId);
    // Validate BEFORE any mutation: an invalid horizon used to increment the
    // turn and then throw on an Invalid Date.
    const days = explicitDays(jumpDays);
    const periodStart = this.currentDate;
    const elapsedTurn = this.currentTurn;
    const newDate = addDays(periodStart, days);
    // Anche un salto di tempo puro è reversibile: se il collasso scatta qui,
    // il giocatore può tornare al turno precedente.
    this.saveRewindSnapshot();

    const tick = WorldStateEngine.advance(this.regions.values(), days, this.worldStateOptions());
    // Anche il salto di tempo applica i modificatori nazionali e il magazzino,
    // poi registra il punto storico: senza di esso il Dossier non potrebbe
    // mostrare come cresce o cala la tesoreria durante un salto.
    const tickAccounts = applyModifiersToAccounts(tick.accounts, polityId => this.modifiersFor(polityId));
    const resourceLines = this.advanceResources(days, tickAccounts, newDate);
    const bulletin = WorldStateEngine.playerBulletin(tickAccounts[this.playerPolityId]);
    this.currentTurn++;
    this.currentDate = newDate;
    this.refreshPeacetimePressures();
    // Un salto di tempo è comunque tempo che passa: la crisi avanza.
    this.evaluateCrisis();
    this.recordAccountSnapshot(newDate, tickAccounts);

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
