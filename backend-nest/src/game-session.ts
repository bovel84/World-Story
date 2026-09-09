/**
 * World Story — Game Session
 * ========================
 * Per-game session that encapsulates all game state and logic.
 * Each game gets its own GameSession instance via SessionRegistry.
 */

import { shortId } from './utils/short-id';
import { LLMRouter } from './llm';
import { GameController } from './agents';
import { PromptEngine } from './prompt-builder';
import { worldRepository, gameRepository, relationshipRepository, chatRepository } from './repositories';
import { captureEconomicSnapshot, invalidateStrictEffectStaging, restoreEconomicSnapshot, validateEconomicSnapshot } from './repositories/economy-snapshot.repository';
import { withCanonicalTransaction } from './database';
import { semanticStateHash } from './domain/semantic-hash';
import type { ChatRecord, ChatSummary, ChatMessageRecord, ChatParticipant, GameChatSnapshot } from './repositories';
import db from './database';
import { RelationshipMatrix } from './core/RelationshipMatrix';
import { WorldStateEngine } from './core/simulation/WorldStateEngine';
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
import { RegionResolver, PolityResolver } from './utils/name-resolver';
import path from 'path';
import { loadSimulationCatalog } from './scenario/loader';
import { Difficulty, difficultyPromptBlock, normalizeDifficulty } from './prompts/difficulty';
import { personalityForPolity } from './npc-agents';
import { countryRepository } from './repositories/country.repository';
import { polityDisplayNameIt } from './utils/country-facts';
import {
  buildChatPrompt,
  buildNextSpeakerPrompt,
  parseChatResponse,
  parseNextSpeakerResponse,
} from './prompts/chat';
import type { ActionOutcome, ConvertedAction, MapChange, SimulationEvent } from './prompts/types';
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
      const playerName = polityDisplayNameIt(
        this.playerPolityId,
        countryRepository.findByCode(this.playerPolityId)?.name,
      );
      const balance = playerAccount?.monthlyBalance || 0;
      // Il titolo resta una notizia breve; cifre e qualifiche appartengono al
      // corpo del dispaccio, non alla riga che deve essere letta sulla mappa.
      const quietHeadline = playerAccount
        ? `${playerName}: aggiornamento dei conti nazionali`
        : 'Settimana senza svolte nel teatro di gioco';
      const quietDispatch = playerAccount
        ? `Nel monitoraggio settimanale il motore registra per ${playerName} una crescita annua stimata al ${(playerAccount.annualGrowthRate * 100).toFixed(1)}%. Il saldo pubblico mensile resta ${balance >= 0 ? 'positivo' : 'negativo'} a ${Math.abs(balance).toFixed(2)} miliardi USD. Sono stime del modello economico, non nuovi eventi politici.`
        : 'I governi mantengono le posizioni e non emergono fatti che richiedano una modifica della mappa.';
      const events = randomEvents.length > 0 ? randomEvents : [quietHeadline];
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
            ? `Evento ambientale del mondo (turno ${this.currentTurn - 1}).`
            : `Dati del motore alla data ${this.currentDate}: ${quietDispatch}`, 
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
      return [
        ...tick.settledCashflows.map(flow => `📒 Scadenza ${flow.cashflowId}: ${flow.status} (${flow.paid})`),
        ...mandateDecisions.map(decision => `⚠️ Mandato ${decision.mandateId}: scorte ${decision.resourceId} ${decision.availableStock}/${decision.minStock}; decisione giocatore richiesta (${decision.kind === 'stock_shortfall_outside_authorization' ? 'acquisto fuori autorizzazione' : 'prezzo e quantità da confermare'})`),
      ];
    }
    const tick = WorldStateEngine.advance(this.regions.values(), days);
    const bulletin = WorldStateEngine.playerBulletin(tick.accounts[this.playerPolityId]);
    return bulletin ? [`📊 ${bulletin}`] : [];
  }

  // Diplomatic relationships
  private relationships: RelationshipMatrix = new RelationshipMatrix();

  // SSE broadcaster for real-time updates
  private sseBroadcaster: ((type: SSEEventType, data: any) => void) | null = null;

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
  setSSEBroadcaster(broadcaster: (type: SSEEventType, data: any) => void): void {
    this.sseBroadcaster = broadcaster;
  }

  /**
   * Broadcast event to SSE clients
   */
  private broadcast(type: SSEEventType, data: any): boolean {
    if (!this.sseBroadcaster) return false;
    try {
      this.sseBroadcaster(type, data);
      return true;
    } catch (error) {
      // SSE è post-commit/best-effort: non può attivare un falso rollback RAM.
      console.error('[GameSession] SSE broadcast failed:', type, error);
      return false;
    }
  }

  /**
   * Build game data object for prompt engine
   */
  private buildGameData(): any {
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
    for (const [owner, owned] of regionsByPolity) {
      // Una sola regione può avere un nome storico/custom più preciso del
      // registro ISO. Il nome nazionale serve soprattutto alle mappe provinciali.
      polityNames[owner] = owned.length === 1
        ? owned[0].name
        : (countryRepository.findByCode(owner)?.name || owner);
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
      worldState: { accounts: WorldStateEngine.accounts(this.regions.values()) },
      world: {
        name: this.worldName,
        basePrompt: this.worldBasePrompt,
        startDate: this.worldStartDate || this.currentDate,
        regions: regionsObj,
      },
      // Этап 5: правила симуляции мира → HISTORICAL_PRESET_SIMULATION_RULES
      simulationRules: this.worldSimulationRules ?? undefined,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        regionId: p.regionId,
        polityId: p.polityId,
      })),
      playerPolityId: this.playerPolityId,
      playerPolityName: polityNames[this.playerPolityId],
      polityNames,
      // Stato diplomatico persistente: il prompt usa questi rapporti per
      // motivare le reazioni delle altre politie, non per inventarle.
      relationships: this.relationships.toJSON(),
      // I progetti attivi sono contesto canonico anche senza nuovi ordini.
      // LLM riceve ID e date, non deve riconoscerli per titolo.
      ongoingProcesses: gameRepository.getOngoingProcesses(this.id).map((process: any) => ({
        id: process.id,
        sourceActionId: process.source_action_id,
        title: process.title,
        summary: process.summary,
        startedDate: process.started_date,
        expectedDate: process.expected_date || undefined,
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
      // Nei mondi provinciali il primo territorio è una provincia: per la chat
      // usiamo il nome della NAZIONE dal registro ISO, non quello della provincia.
      const displayName = polityRegions.length > 1
        ? (countryRepository.findByCode(resolution.polityId)?.name || resolution.polityId)
        : (polityRegions[0]?.name || resolution.polityId);
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
        name: player?.name || this.playerPolityId,
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
      player?.name || 'Giocatore',
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
    mode: 'reply' | 'auto',
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

    const participantsVars = polityParticipants.map(p => {
      const owned = Array.from(this.regions.values()).filter(r => r.owner === p.id);
      const population = owned.reduce((sum, r) => sum + (r.population || 0), 0);
      const gdp = owned.reduce((sum, r) => sum + (r.gdp || 0), 0);
      const military = owned.reduce((sum, r) => sum + (r.militaryPower || 0), 0);
      const { personality, aggression } = personalityForPolity(p.id);
      return {
        name: p.name,
        relationship: this.relationships.get(p.id, this.playerPolityId),
        personality: `${personality} (propensione alla forza ${Math.round(aggression * 100)}%)`,
        interests: `difendere ${owned.length} regioni; popolazione ${population}; PIL ${gdp}; potenza militare ${military}; migliorare la propria sicurezza e influenza senza ignorare il lore del preset`,
      };
    });

    let speakerName = participantsVars[0].name;
    if (participantsVars.length > 1) {
      const nextSpeakerPrompt = buildNextSpeakerPrompt({
        playerPolityName: this.players[0]?.name || this.playerPolityId,
        participantNames: participantsVars.map(p => p.name),
        history,
        playerMessage,
        mode,
      });
      const selection = await this.llm.generate(
        'chat',
        'Seleziona il prossimo interlocutore diplomatico. Rispondi soltanto con JSON {"speaker"}.',
        nextSpeakerPrompt,
        { temperature: 0.25, maxTokens: 120 },
      );
      speakerName = parseNextSpeakerResponse(
        selection.content,
        participantsVars.map(p => p.name),
        speakerName,
      );
    }
    const respondingParticipant = participantsVars.find(p => p.name === speakerName) || participantsVars[0];
    const recentEvents = this.results
      .slice(-3)
      .flatMap(result => result.timelineEvents?.map(event => event.headline) || result.events)
      .slice(-8);
    const prompt = buildChatPrompt({
      playerPolityName: this.players[0]?.name || this.playerPolityId,
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
        m.role === 'player' ? `Giocatore: ${m.content}` : `${m.senderName || chat.polityName}: ${m.content}`
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
        ? [...r.timelineEvents]
        : (r.events || []).map((headline, index) => ({
            id: `${r.id}-${index}`,
            date: r.date || '',
            headline,
            detail: r.narration || '',
            source: 'world' as const,
            simulationId: r.simulationId,
          })),
      narration: r.narration || '',
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
    return {
      regions: new RegionResolver(all),
      polities: new PolityResolver(all, this.playerPolityId),
    };
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
   */
  private transferRegion(region: RegionState, newOwner: string, explicitColor?: string): void {
    const inherited = explicitColor || this.polityColor(newOwner, region.id);
    region.owner = newOwner;
    if (inherited) region.color = inherited;
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
        this.transferRegion(liveRegion, ownerId, explicitColor || resolvers.polities.colorOf(ownerId));
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

  /**
   * Apply mapChanges from a single simulation event (transfer/create/update/delete).
   * Регионы и политии адресуются ИМЕНАМИ (так их видит LLM в описании карты).
   */
  private applyMapChanges(mapChanges: MapChange[] | undefined): RegionState[] {
    if (this.isStrictGame()) validateStrictMapChanges(mapChanges);
    if (!mapChanges || mapChanges.length === 0) return [];
    const resolvers = this.buildResolvers();
    const changed = new Map<string, RegionState>();

    for (const change of mapChanges) {
      const regionKey = change.regionName || change.regionId;
      // Works require an exact destination: the fuzzy resolver would happily
      // accept 'random'/'coastal' and build a factory on the wrong province.
      let liveRegion: RegionState | undefined;
      if (change.type === 'build_facility') {
        const direct = regionKey ? this.regions.get(regionKey) : undefined;
        const resolved = !direct && regionKey ? resolvers.regions.resolve(regionKey) : undefined;
        liveRegion = direct ?? (resolved ? this.regions.get(resolved.id) : undefined);
      } else {
        liveRegion = this.resolveRegionFlexible(regionKey, resolvers.regions);
      }
      if (!liveRegion) {
        console.warn('[GameSession] mapChange: region not resolved:', regionKey);
        continue;
      }

      switch (change.type) {
        case 'transfer': {
          const ownerResolution = resolvers.polities.resolve(change.newOwner);
          if (!ownerResolution) break;
          // Owner e colore vengono trasferiti atomicamente.
          this.transferRegion(
            liveRegion,
            ownerResolution.polityId,
            change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
          );
          break;
        }
        case 'update': {
          if (change.newColor) liveRegion.color = change.newColor;
          if (change.newName) liveRegion.name = change.newName;
          break;
        }
        case 'delete': {
          liveRegion.owner = 'neutral';
          liveRegion.color = '#888888';
          break;
        }
        case 'create_polity':
        case 'create': {
          // Создание новой политии: регион получает нового владельца (+ цвет)
          const ownerResolution = resolvers.polities.resolve(change.newOwner || change.newName);
          if (ownerResolution) {
            this.transferRegion(
              liveRegion,
              ownerResolution.polityId,
              change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
            );
          }
          break;
        }
        case 'build_facility': {
          // Explicit completed works only. No keyword detection on requests or
          // denied orders; no fabricated cities/capitals from narrative text.
          const feature = change.feature;
          if (!feature || !['factory', 'port', 'university', 'base', 'radar'].includes(feature.type)
            || typeof feature.name !== 'string' || !feature.name.trim()
            || liveRegion.status === 'destroyed') break;
          const name = feature.name.trim().slice(0, 160);
          if ((liveRegion.objects || []).some(o => o.type === feature.type && o.name === name)) break;
          const center = this.regionCenter(liveRegion);
          if (!center) break;
          liveRegion.objects ||= [];
          liveRegion.objects.push({ id: shortId(), type: feature.type, name, level: 1,
            lat: center.lat, lng: center.lng });
          break;
        }
        case 'spawn_battalion': {
          liveRegion.objects = liveRegion.objects || [];
          // Этап 4: формат маркера согласован с фронтом — { id, type, name, lat, lng },
          // type ровно 'battalion'. Координаты — центр региона (geojson/SVG).
          const center = this.regionCenter(liveRegion);
          liveRegion.objects.push({
            id: shortId(),
            type: 'battalion',
            name: change.feature?.name || `Battaglione ${liveRegion.name} ${(liveRegion.objects.filter((o: any) => o.type === 'battalion').length) + 1}`,
            lat: center?.lat ?? 0,
            lng: center?.lng ?? 0,
          });
          break;
        }
        case 'move_battalion': {
          const target = this.resolveRegionFlexible(change.targetRegionName, resolvers.regions);
          if (!target) break;
          const objects = liveRegion.objects || [];
          const featureId = (change.feature as any)?.id;
          const featureName = change.feature?.name;
          // Батальон адресуется по id; если id не передан или не найден — по имени;
          // последний fallback — первый батальон региона (прежнее поведение).
          let idx = featureId
            ? objects.findIndex((o: any) => o.type === 'battalion' && o.id === featureId)
            : -1;
          if (idx < 0 && featureName) {
            idx = objects.findIndex((o: any) => o.type === 'battalion' && o.name === featureName);
          }
          if (idx < 0) {
            idx = objects.findIndex((o: any) => o.type === 'battalion');
          }
          if (idx >= 0) {
            const [b] = objects.splice(idx, 1);
            target.objects = target.objects || [];
            // Координаты — центр целевого региона, иначе маркер остался бы на старом месте
            const center = this.regionCenter(target);
            if (center) {
              b.lat = center.lat;
              b.lng = center.lng;
            }
            target.objects.push(b);
            changed.set(target.id, target);
          }
          break;
        }
      }
      changed.set(liveRegion.id, liveRegion);
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
    const changedRegions = this.applyMapChanges(event.mapChanges).map(region => ({
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
      headline: event.headline,
      detail: event.description,
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
      events: [event.headline, ...bulletins],
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
      gameRepository.addSimulationEvents([{
        id: `${stepId}-0`,
        runId,
        checkpointId,
        gameId: this.id,
        date: eventDate,
        headline: event.headline,
        detail: event.description,
        source: 'world',
        sourceActionIds,
      }]);
      this.enqueueOutboxRows(runId, checkpointId, revision, state.jumpTurn, [{
        id: `${stepId}-0`,
        date: eventDate,
        headline: event.headline,
        detail: event.description,
        source: 'world',
        sourceActionIds,
      }]);

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

    if (!closeReason) {
    const remaining = remainingEvents;
    const revision = committedRevision;
    const checkpointId = committedCheckpointId;
    const eventOrdinal = state.appliedCount - 1; // ordinale dell'evento appena committato
    this.publishPendingOutbox();
    this.broadcast('jump_event', {
      turn: state.jumpTurn,
      index: eventOrdinal,
      event,
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
        headline: event.headline,
        detail: event.description,
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
    const voidedHeadlines = voided.map(v => `⊘ Respinto: ${v.action}${v.reason ? ` — ${v.reason}` : ''}`);

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
      for (const startChat of completion.startChat) {
        try {
          const chat = this.ensureChat([startChat.polityName]);
          const sender = chat.participants.find(p => p.role === 'polity')?.name || chat.polityName;
          const firstMessage = chatRepository.addMessage(
            chat.id, 'polity', startChat.topic || 'Desideriamo discutere gli ultimi sviluppi.',
            state.jumpTurn, sender, finalDate,
          );
          chatTimelineEvents.push({
            id: `chat-${firstMessage.id}`,
            date: finalDate,
            headline: `${sender} apre un canale diplomatico`,
            detail: `${sender}: ${firstMessage.content}`,
            source: 'diplomacy',
            simulationId: runId,
            chatId: chat.id,
            speakerName: sender,
          });
          chatBroadcasts.push({
            chatId: chat.id,
            polityId: chat.polityId,
            polityName: chat.polityName,
            participants: chat.participants,
            senderName: sender,
            message: firstMessage,
          });
        } catch (e) {
          console.warn('[GameSession] startChat: politia non trovata:', startChat.polityName, e);
        }
      }
    }

    // Economia deterministica fino alla data finale effettiva.
    const elapsedDays = Math.round((Date.parse(finalDate) - Date.parse(lastEventDate)) / 86_400_000);
    const bulletins = this.isStrictGame() || elapsedDays > 0 ? this.advanceWorldState(elapsedDays, finalDate) : [];

    // Record finale: riepilogo tecnico del periodo, non seconda fonte di
    // mutazioni. Gli eventi applicati vivono nei record per-evento.
    const interruptionHeadline = reason === 'paused_budget'
      ? '⏸ Budget di simulazione esaurito: destinazione non raggiunta'
      : '⏸ Simulazione interrotta dal giocatore (Intervene)';
    narration = destinationReached
      ? completion.narration
      : appliedRows.map(row => row.detail).filter(Boolean).join('\n\n') || interruptionHeadline;
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
        headline: `Rapporti diplomatici: ${change.from} ↔ ${change.to}`,
        detail: `${change.newRelationship}: ${change.reason}`,
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
      const outcomeSummary = outcome?.summary || rejected?.reason;
      const outcomeEvents = outcome?.eventHeadlines?.length
        ? outcome.eventHeadlines.filter((headline: string) => appliedHeadlines.has(headline))
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
      const gameData = this.buildGameData();

      // Gli eventi escono dal token stream UNO ALLA VOLTA. In auto-jump un
      // oggetto JSON completo viene applicato alla mappa e inviato al browser
      // come anteprima; nel salto fisso (§9.3) gli eventi restano PROPOSTE non
      // applicate: il primo commit avviene solo a stream concluso, e i
      // successivi soltanto dopo la conferma esplicita del giocatore.
      this.interveneRequested = false;
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
        // Reject invalid/backdated dates before any map effect. Count consumed
        // events separately below so streaming fallbacks cannot reapply them.
        const previousDate = (apply ? appliedEvents.at(-1) : proposedEvents.at(-1))?.date || periodStart;
        if (!dateInPeriod(event.date, previousDate, horizonDate)) {
          console.warn('[GameSession] Event outside turn period:', event.date);
          return false;
        }
        if (!apply) {
          proposedEvents.push(event);
          return true;
        }
        // In auto-jump il primo evento significativo è anche il punto di
        // arresto: ignora rigorosamente gli eventuali record successivi di un
        // modello che non abbia rispettato il limite del prompt.
        if (autoJump && appliedEvents.length > 0) {
          console.warn('[GameSession] Auto-jump: event after the first ignored');
          return false;
        }
        const changedRegions = this.applyMapChanges(event.mapChanges).map(region => ({
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
        appliedEvents.push(event);
        // È una sola anteprima narrativa: nessun delta o data viene ancora
        // pubblicato, poiché DB e checkpoint non sono stati committati.
        this.broadcast('jump_event', {
          turn: this.currentTurn,
          index,
          event,
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
          narration: '⏸ Simulazione interrotta dal giocatore prima del primo evento',
          events: ['⏸ Simulazione interrotta: nessun evento applicato'],
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
        this.broadcast('action_voided', { turn: this.currentTurn, action: v.action, reason: v.reason });
      }

      // Gli effetti globali legacy non sono associati a un evento datato.
      // Durante l'auto-jump il primo evento è il confine invalicabile: solo i
      // suoi `mapChanges` già validati possono mutare il mondo. Applicare qui
      // worldChanges, relazioni o chat della risposta completa farebbe entrare
      // nel checkpoint conseguenze che appartengono a eventi futuri scartati.
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
      // L'apertura è un evento diplomatico esplicito, datato al checkpoint
      // finale, non una deduzione fatta in seguito dal testo dei messaggi.
      const chatTimelineEvents: TimelineEventRecord[] = [];
      for (const startChat of applyCompletionEffects ? promptResult.startChat || [] : []) {
        try {
          const chat = this.ensureChat([startChat.polityName]);
          const sender = chat.participants.find(p => p.role === 'polity')?.name || chat.polityName;
          const firstMessage = chatRepository.addMessage(
            chat.id,
            'polity',
            startChat.topic || 'Desideriamo discutere gli ultimi sviluppi.',
            this.currentTurn,
            sender,
            period.end,
          );
          chatTimelineEvents.push({
            id: `chat-${firstMessage.id}`,
            date: period.end,
            headline: `${sender} apre un canale diplomatico`,
            detail: `${sender}: ${firstMessage.content}`,
            source: 'diplomacy',
            chatId: chat.id,
            speakerName: sender,
          });
          chatBroadcasts.push({
            chatId: chat.id,
            polityId: chat.polityId,
            polityName: chat.polityName,
            participants: chat.participants,
            senderName: sender,
            message: firstMessage,
          });
        } catch (e) {
          console.warn('[GameSession] startChat: politia non trovata:', startChat.polityName, e);
        }
      }

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
      const llmEventHeadlines = appliedEvents.map((e: any) => e.headline).filter(Boolean);
      const voidedHeadlines = voided.map(v => `⊘ Respinto: ${v.action}${v.reason ? ` — ${v.reason}` : ''}`);
      if (intervened) llmEventHeadlines.push('⏸ Simulazione interrotta dal giocatore (Intervene)');
      turnResult = {
        id: shortId(),
        simulationId: simulationRunId || undefined,
        turn: this.currentTurn,
        // In auto-jump non riutilizzare il riassunto completo della LLM: può
        // descrivere il futuro oltre il primo evento accettato.
        narration: (intervened || autoJump)
          ? appliedEvents.map(e => e.description).join('\n\n')
          : promptResult.narration,
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
        const outcomeSummary = outcome?.summary || rejected?.reason;
        const outcomeEvents = outcome?.eventHeadlines?.length
          ? outcome.eventHeadlines.filter(headline => turnResult.events.includes(headline))
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
        appliedEvents.map(event => [event.headline, event] as const)
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
          detail: detailed?.description || (headline.startsWith('⊘') ? headline : turnResult.narration),
          source: 'world' as const,
          simulationId: simulationRunId || undefined,
          sourceActionIds: sourceActionsByHeadline.get(headline) || [],
        };
      });
      for (const [index, change] of persistedRelationshipChanges.entries()) {
        turnResult.timelineEvents.push({
          id: `${turnResult.id}-relationship-${index}`,
          date: this.currentDate,
          headline: `Rapporti diplomatici: ${change.from} ↔ ${change.to}`,
          detail: `${change.newRelationship}: ${change.reason}`,
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
      events: bulletin ? [headline, `📊 ${bulletin}`] : [headline],
      timelineEvents: [{
        id: `${id}-0`,
        date: this.currentDate,
        headline,
        detail: `Periodo trascorso senza un’azione esplicita del giocatore (${periodStart} → ${this.currentDate}).`,
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
