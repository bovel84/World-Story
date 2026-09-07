/**
 * Open-Pax — Game Session
 * ========================
 * Per-game session that encapsulates all game state and logic.
 * Each game gets its own GameSession instance via SessionRegistry.
 */

import { shortId } from './utils/short-id';
import { LLMRouter } from './llm';
import { GameController } from './agents';
import { PromptEngine } from './prompt-builder';
import { worldRepository, gameRepository, relationshipRepository, chatRepository } from './repositories';
import type { ChatRecord, ChatSummary, ChatMessageRecord, ChatParticipant, GameChatSnapshot } from './repositories';
import db from './database';
import { RelationshipMatrix } from './core/RelationshipMatrix';
import { WorldStateEngine } from './core/simulation/WorldStateEngine';
import { addDays, dateInPeriod, explicitDays, jumpHorizon, resolvePeriod } from './core/simulation/calendar';
import { withinDeadline } from './core/simulation/deadline';
import { canNpcCapture, indexPolities, npcRepresentatives } from './core/simulation/npc-policy';
import { RegionResolver, PolityResolver } from './utils/name-resolver';
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
import type { MapChange, SimulationEvent } from './prompts/types';
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

export interface PendingAction {
  id: string;
  text: string;
  createdAt: string;
  status: 'pending' | 'processing' | 'completed';
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
  /** Ordini futuri: un salvataggio deve ripristinare anche la coda. */
  pendingActions?: PendingAction[];
  /** Chat e messaggi del ramo al checkpoint. */
  chats?: GameChatSnapshot[];
  /** Processi in corso/completati nel ramo del checkpoint. */
  ongoingProcesses?: any[];
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
  private advanceWorldState(days: number): string[] {
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
  private broadcast(type: SSEEventType, data: any): void {
    if (this.sseBroadcaster) {
      this.sseBroadcaster(type, data);
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

    const reply = await this.generateChatReply(chat, history, content, 'reply');
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
    for (let i = 0; i < rounds; i++) {
      const history = chatRepository.getMessages(chatId)
        .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));
      const reply = await this.generateChatReply(chat, history, '', 'auto');
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
    // Un processo LLM non può attraversare un restart: gli eventuali record
    // rimasti "processing" sono ritentabili nel nuovo processo.
    gameRepository.updatePendingActionStatus(
      this.id,
      this.pendingActions.map(action => action.id),
      'pending',
    );

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
  private applyWorldChanges(changes: WorldChanges): void {
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
  async syncRegionsToDB(): Promise<void> {
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
      pendingActions: this.pendingActions.filter(action => action.status === 'pending'),
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
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
      pendingActions: this.pendingActions.filter(action => action.status === 'pending'),
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
    };

    const stmt = db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      saveId,
      this.id,
      name || `Game ${new Date().toLocaleDateString()}`,
      this.currentTurn,
      this.currentDate,
      JSON.stringify(saveData),
      new Date().toISOString()
    );

    console.log('[GameSession] Saved:', saveId, 'turn:', this.currentTurn);
    return { saveId, currentTurn: this.currentTurn, currentDate: this.currentDate };
  }

  /**
   * Load session from save data
   */
  loadFromSave(saveData: SaveData): void {
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
    this.pendingActions = (saveData.pendingActions || []).filter(action => action.status === 'pending');
    gameRepository.replacePendingActions(this.id, this.pendingActions);
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

    console.log('[GameSession] Loaded from save, turn:', this.currentTurn);
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
      pendingActions: this.pendingActions.filter(action => action.status === 'pending'),
      chats: chatRepository.snapshotGameChats(this.id),
      ongoingProcesses: gameRepository.snapshotOngoingProcesses(this.id),
    };
    const id = shortId();
    db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, saved_at)
      VALUES (?, ?, '__rewind__', ?, ?, ?, ?)
    `).run(id, this.id, this.currentTurn, this.currentDate, JSON.stringify(saveData), new Date().toISOString());

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

    this.loadFromSave(saveData);
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
    const gameData = this.buildGameData();
    return this.gameController.getAdvisorWithPrompts(gameData, message, history);
  }

  /**
   * Streaming-вариант советника (Этап 3): токены приходят в onToken
   * (число символов накопленного ответа), возвращается полный текст.
   */
  async getAdvisorStream(message: string, history: any[] = [], onToken: (chars: number) => void): Promise<string> {
    const gameData = this.buildGameData();
    return this.gameController.getAdvisorStreamWithPrompts(gameData, message, history, onToken);
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
   * Add action to pending queue (without processing)
   */
  queueAction(text: string): PendingAction {
    const action: PendingAction = {
      id: shortId(),
      text,
      createdAt: new Date().toISOString(),
      status: 'pending',
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
      const action = this.pendingActions.find(item => item.status === 'pending');
      if (!action) return [];
      return this._processActionBatchUnlocked(jumpDays, [action]);
    });
    if (result === null) throw new SimulationInProgressError();
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
  ): Promise<PendingAction[]> {
    // Validate before taking a snapshot or mutating the queue.
    const timeJump = jumpHorizon(jumpDays);
    const periodStart = this.currentDate;
    const horizonDate = addDays(periodStart, timeJump);
    actions.forEach(item => { item.status = 'processing'; });
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

      // Snapshot pre-turn. If auto-jump finds no event at all, restore the
      // previous rewind record as well: a failed search is not a checkpoint.
      const rewindBeforeSearch = db.prepare(
        "SELECT * FROM saves WHERE game_id = ? AND name = '__rewind__' ORDER BY saved_at DESC LIMIT 1"
      ).get(this.id) as any;
      this.saveRewindSnapshot();

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

      this.broadcast('turn_start', {
        simulationId: simulationRunId,
        turn: this.currentTurn,
        actions: actions.map(item => ({ id: item.id, text: item.text })),
      });

      // Build game data for prompt engine
      const gameData = this.buildGameData();

      // Gli eventi escono dal token stream UNO ALLA VOLTA. Appena un oggetto
      // JSON è completo viene applicato alla mappa e inviato al browser; non
      // attendiamo più la generazione dell'intero lotto.
      this.interveneRequested = false;
      const appliedEvents: SimulationEvent[] = [];
      // Gli stream possono mostrare una proposta evento, ma la mappa del
      // client cambia solo dopo il commit del turno. Conserviamo qui il delta
      // da pubblicare insieme al checkpoint durevole.
      const checkpointChanges = new Map<string, {
        id: string; owner: string; color: string; name: string;
        population: number; gdp: number; militaryPower: number; objects: any[];
      }>();
      let consumedEvents = 0;
      let intervened = false;
      const publishEvent = (event: SimulationEvent, index: number) => {
        consumedEvents = Math.max(consumedEvents, index + 1);
        if (this.interveneRequested) {
          intervened = true;
          return;
        }
        // In auto-jump il primo evento significativo è anche il punto di
        // arresto: ignora rigorosamente gli eventuali record successivi di un
        // modello che non abbia rispettato il limite del prompt.
        if (autoJump && appliedEvents.length > 0) {
          console.warn('[GameSession] Auto-jump: event after the first ignored');
          return;
        }
        // Reject invalid/backdated dates before any map effect. Count consumed
        // events separately below so streaming fallbacks cannot reapply them.
        const previousDate = appliedEvents.at(-1)?.date || periodStart;
        if (!dateInPeriod(event.date, previousDate, horizonDate)) {
          console.warn('[GameSession] Event outside turn period:', event.date);
          return;
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
      };

      const promptResult = await this.gameController.processTurnWithPrompts(
        gameData,
        actions.map(item => item.text),
        timeJump,
        (chars) => this.broadcast('llm_progress', { mechanic: 'jump', chars, eventsReady: appliedEvents.length }),
        autoJump,
        publishEvent,
        this.activeSimulationAbort.signal,
      );

      const events = promptResult.events || [];
      // Compatibilità con mock/test e provider non-streaming: pubblica qui gli
      // eventuali eventi che non sono già arrivati dal callback incrementale.
      for (let i = consumedEvents; i < events.length; i++) {
        if (this.interveneRequested) { intervened = true; break; }
        publishEvent(events[i], i);
      }
      intervened ||= this.interveneRequested;
      const period = resolvePeriod({ start: periodStart, days: timeJump, auto: autoJump,
        interrupted: intervened, target: promptResult.targetDate, eventDates: appliedEvents.map(e => e.date) });
      if (intervened) {
        console.log(`[GameSession] Intervene: applicati ${appliedEvents.length}/${events.length} eventi`);
      }

      // Una ricerca automatica senza svolte non è un turno: lascia data,
      // mappa, coda, risultati e snapshot esattamente al checkpoint iniziale.
      if (autoJump && !intervened && appliedEvents.length === 0) {
        actions.forEach(action => { action.status = 'pending'; });
        gameRepository.updatePendingActionStatus(this.id, actions.map(action => action.id), 'pending');
        db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__'").run(this.id);
        if (rewindBeforeSearch) {
          db.prepare(`
            INSERT INTO saves (id, game_id, name, current_turn, current_date, data, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            rewindBeforeSearch.id, rewindBeforeSearch.game_id, rewindBeforeSearch.name,
            rewindBeforeSearch.current_turn, rewindBeforeSearch.current_date,
            rewindBeforeSearch.data, rewindBeforeSearch.saved_at,
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
          this.broadcast('chat_message', {
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
      const economyBulletins = period.elapsedDays > 0 ? this.advanceWorldState(period.elapsedDays) : [];
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
      const turnResult: TurnResultRecord = {
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

      // Persist ALL region changes to DB
      await this.syncRegionsToDB();

      // Ogni ordine mantiene l'involucro comune del turno ma riceve il proprio
      // esito strutturato quando il provider lo restituisce. Fallback legacy:
      // la cronaca comune resta leggibile finché un preset non emette outcome.
      actions.forEach((item, index) => {
        // Il converter può normalizzare/tradurre il testo prima del prompt;
        // l'ordine del lotto resta quindi il fallback stabile di associazione.
        const outcome = promptResult.actionOutcomes?.find(result => result.action === item.text)
          || promptResult.actionOutcomes?.[index];
        const rejected = voided.find(result => result.action === item.text);
        const outcomeStatus = outcome?.status || (rejected ? 'rejected' : undefined);
        const outcomeSummary = outcome?.summary || rejected?.reason;
        const outcomeEvents = outcome?.eventHeadlines?.length
          ? outcome.eventHeadlines.filter(headline => turnResult.events.includes(headline))
          : rejected ? voidedHeadlines.filter(headline => headline.includes(rejected.action)) : turnResult.events;
        item.status = 'completed';
        item.result = {
          narration: outcomeSummary || turnResult.narration,
          countryResponse: turnResult.countryResponse,
          events: outcomeEvents,
          simulationId: simulationRunId || undefined,
          outcome: outcomeStatus && outcomeSummary
            ? { status: outcomeStatus, summary: outcomeSummary, expectedDate: outcome?.expectedDate }
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
      // Una reiterazione dello stesso ordine con esito accepted chiude il
      // processo aperto associato: la LLM deve comunque dichiarare accepted.
      actions.filter(action => action.result?.outcome?.status === 'accepted').forEach(action => {
        gameRepository.completeOngoingProcessForAction(
          this.id,
          action.text,
          action.result!.outcome!.summary,
        );
      });

      // Esiti individuali durevoli: anche i preset legacy ricevono un record
      // esplicito (accepted + cronaca comune) invece di sparire con la coda.
      gameRepository.addSimulationActionOutcomes(actions.map(action => ({
        id: shortId(),
        runId: simulationRunId!,
        gameId: this.id,
        actionId: action.id,
        status: action.result?.outcome?.status || 'accepted',
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
      actions.forEach((action, index) => {
        const outcome = promptResult.actionOutcomes?.find(result => result.action === action.text)
          || promptResult.actionOutcomes?.[index];
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

      // Persist turn and date to DB in single operation
      gameRepository.updateTurnAndDate(this.id, this.currentTurn, this.currentDate);
      const checkpointId = shortId();
      gameRepository.createSimulationCheckpoint({
        id: checkpointId,
        runId: simulationRunId!,
        gameId: this.id,
        revision: this.currentTurn,
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
      gameRepository.finishSimulationRun(simulationRunId!, intervened ? 'intervened' : 'completed', {
        checkpointDate: this.currentDate,
        checkpointId,
        turn: turnResult.turn,
      });

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
      this.getAdvisor(
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
      actions.forEach(item => { item.status = 'pending'; });
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
  async processAllPendingActions(jumpDays: number = 30, idempotencyKey?: string): Promise<PendingAction[]> {
    const result = await this.withLock(async () => {
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
  async processWorldAdvance(jumpDays: number = 30, idempotencyKey?: string): Promise<TurnResultRecord | null> {
    const result = await this.withLock(async () => {
      await this._processActionBatchUnlocked(jumpDays, [], idempotencyKey);
      return this.results.at(-1) || null;
    });
    if (result === null) throw new SimulationInProgressError();
    return result;
  }

  /**
   * Advance date without processing actions (for legacy callers only).
   * New timeline controls must use processWorldAdvance so world events are not
   * bypassed when the player has no fresh orders. The calendar and economy
   * still advance together for callers that explicitly retain this legacy API.
   */
  async advanceDate(jumpDays: number = 30): Promise<{ newDate: string; newTurn: number }> {
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
