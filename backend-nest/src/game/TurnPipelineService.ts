/**
 * World Story — TurnPipelineService
 * =================================
 * Orchestratore di un lotto di ordini (Fase 1: estratto da `game-session.ts`).
 * Copre la validazione del salto, la presa in carico della coda, la chiamata
 * LLM, la canonicalizzazione degli eventi, l'applicazione deterministica,
 * l'outbox, il playback scaglionato e la finalizzazione.
 *
 * Lo **stato vivo** è posseduto da `SessionStateStore` (iniettato): il
 * servizio legge/scrive `state.regions`, `state.currentTurn`, `state.results`
 * ecc. Tutto il resto passa da `TurnPipelineContext`.
 */

import path from 'path';
import db, { withCanonicalTransaction } from '../database';
import { chatRepository, gameRepository, relationshipRepository, worldRepository } from '../repositories';
import { addDays, dateInPeriod, jumpHorizon, resolvePeriod } from '../core/simulation/calendar';
import { applyStagedStrictEffects, assertExecutableStrictEffects } from '../core/simulation/TurnOrchestrator';
import { autoJumpEventBudget, isDecisiveNpcDecision } from '../core/simulation/EventBudget';
import { projectProgress } from '../core/simulation/MilitaryProduction';
import { EFFECT_LIMITS } from '../core/simulation/NationalEffects';
import { rejectDirectMaterialCommand, validateStrictResultSafe } from '../core/simulation/EffectValidator';
import { bootstrapCatalogEconomy } from '../services/StrictEffectProducerService';
import { loadSimulationCatalog } from '../scenario/loader';
import { shortId } from '../utils/short-id';
import type { RelationshipType } from '../core/RelationshipMatrix';
import type { SimulationEvent } from '../prompts/types';
import type { PendingAction, OrderSettlementEntry } from './OrderExecutionService';
import type { OrderExecutionService } from './OrderExecutionService';
import type { SimulationCoordinator } from './SimulationCoordinator';
import type { DiplomacyService } from './DiplomacyService';
import type { PlaybackService } from './PlaybackService';
import type { SessionStateStore } from './SessionStateStore';
import type { CommitmentResult } from './CommitmentService';
import { SimulationPausedError, SimulationInProgressError, type ActionRecord, type PausedBatchResult, type RegionState, type TimelineEventRecord, type TurnResultRecord } from '../game-session';

export interface TurnPipelineContext {
  gameId: string;
  worldId: string;
  state: SessionStateStore;
  coordinator: SimulationCoordinator;
  diplomacy: DiplomacyService;
  orders: OrderExecutionService;
  playback: PlaybackService;
  gameController: any;
  isStrictGame(): boolean;
  publicText(value: unknown): string;
  publicPolityName(polityId: string): string;
  broadcast(type: any, data: any): boolean | void;
  buildGameData(...args: any[]): any;
  buildResolvers(): any;
  canonicalizeEventReactions(...args: any[]): SimulationEvent;
  captureCheckpointData(): any;
  captureMovementIntents(actions: PendingAction[]): any[];
  outcomesByActionId(...args: any[]): any;
  advanceWorldState(...args: any[]): string[];
  applyFrontierPlacements(...args: any[]): RegionState[];
  applyMapChanges(...args: any[]): RegionState[];
  applyWorldChanges(...args: any[]): void;
  mentionedNpcPolityIds(texts: string[]): string[];
  reactionChatStarts(...args: any[]): any[];
  recordAccountSnapshot(...args: any[]): void;
  enqueueOutboxRows(...args: any[]): void;
  publishPendingOutbox(limit?: number): number;
  syncRegionsToDB(): Promise<void> | void;
  saveRewindSnapshot(): void;
  maybeConsolidate(): Promise<void>;
  getAdvisorUnchecked(...args: any[]): Promise<string>;
  refreshProjectProgress(asOfDate?: string): string[];
  refreshPeacetimePressures(): void;
  /** GAMEPLAY-LONG: registra gli impegni nati nel turno (registro strutturato). */
  recordCommitments(input: {
    startChat?: readonly { participants?: string[]; polityName?: string; kind?: string; topic?: string; eventHeadline?: string }[];
    proposals?: unknown;
    updates?: unknown;
  }): CommitmentResult;
  /**
   * CRISIS-RESIDUAL P0.1: la crisi riceve i **giorni realmente simulati** nel
   * periodo (`period.elapsedDays`), non il numero di turni né un valore
   * ricostruito: il percorso con ordini e quello senza ordini devono avere la
   * stessa semantica del tempo trascorso.
   */
  evaluateCrisis(advance?: boolean, periodDays?: number): any;
  settleOrderCosts(...args: any[]): any;
  orderFundingNotes(actions: PendingAction[]): string | null;
  reconcileAcceptedMoves(...args: any[]): any;
  /** ARMY-MOVE: motivazioni esplicite per i movimenti accettati non eseguiti. */
  movementNotices(...args: any[]): string[];
  withLock<T>(fn: () => Promise<T>): Promise<T | null>;
}

export class TurnPipelineService {
  constructor(private readonly ctx: TurnPipelineContext) {}

  /** Stato vivo di sessione (accessor per leggibilità dei corpi metodo). */
  private get state(): SessionStateStore { return this.ctx.state; }

  async processActionBatchUnlocked(
    jumpDays: number,
    actions: PendingAction[],
    idempotencyKey?: string,
  ): Promise<PendingAction[] | PausedBatchResult> {
    // Validate before taking a snapshot or mutating the queue.
    const timeJump = jumpHorizon(jumpDays);
    const periodStart = this.state.currentDate;
    const horizonDate = addDays(periodStart, timeJump);
    // §12: lo snapshot di rewind ritrae l'ORIGINE del salto, ordini ancora
    // in coda compresi. Va preso prima della presa in carico, così un rewind
    // (o un Intervene durante il playback scaglionato) li restituisce alla
    // coda invece di perderli.
    const rewindBeforeSearch = db.prepare(
      "SELECT * FROM saves WHERE game_id = ? AND name = '__rewind__' ORDER BY saved_at DESC LIMIT 1"
    ).get(this.ctx.gameId) as any;
    this.ctx.saveRewindSnapshot();
    actions.forEach(item => {
      item.status = 'processing';
      item.deliveryStatus = 'issued';
      item.executionStatus = 'in_progress';
    });
    gameRepository.updatePendingActionStatus(this.ctx.gameId, actions.map(item => item.id), 'processing');
    console.log(
      '[GameSession] Processing simulation batch:',
      actions.length ? actions.map(item => item.id).join(', ') : '(world only)',
    );
    // Gli eventi progressivi mutano la mappa prima della fine della risposta:
    // conserva una copia locale per ripristinare lo stato se lo stream fallisce.
    const regionsBeforeStream = new Map<string, RegionState>(
      [...this.state.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))])
    );
    let simulationRunId: string | null = null;
    // F03/A10: ogni batch riparte senza esiti ereditati — un salto senza
    // eventi non deve poter restituire la cronaca di un run precedente.
    this.state.lastCommittedResult = null;
    // Snapshot completo pre-run: un errore dopo scritture DB non può lasciare
    // cronaca, relazioni o chat avanti rispetto alla mappa ripristinata.
    const turnBeforeRun = this.state.currentTurn;
    const dateBeforeRun = this.state.currentDate;
    const relationshipsBeforeRun = this.ctx.diplomacy.toJSON();
    const actionsBeforeRun = [...this.state.actions];
    const resultsBeforeRun = [...this.state.results];
    const chatsBeforeRun = chatRepository.snapshotGameChats(this.ctx.gameId);
    const ongoingProcessesBeforeRun = gameRepository.snapshotOngoingProcesses(this.ctx.gameId);

    try {
      const player = this.state.players[0];
      if (!player) throw new Error('No player in session');

      const playerRegion = this.state.regions.get(player.regionId);
      if (!playerRegion) throw new Error('Player region not found');

      // M06 µ3: in strict nessun comando materiale LLM diretto entra nel
      // percorso: build_facility/spawn_battalion/grant_funds/set_gdp non sono
      // più comandi diretti. Il rifiuto avviene PRIMA della chiamata al
      // provider, così nessun credito viene consumato per un ordine vietato.
      if (this.ctx.isStrictGame()) {
        for (const action of actions) rejectDirectMaterialCommand(action.text);
      }

      // jumpDays <= 0 — auto-jump «к следующему важному событию» (горизонт — год)
      const autoJump = jumpDays <= 0;
      // In auto-jump ogni ordine in coda ha diritto al proprio evento, ma il
      // salto non si ferma al primo fatto di cronaca: il budget condiviso col
      // prompt consente di attraversare i fatti di contorno fino alla decisione
      // NPC che risponde agli ordini (o al tetto, se nessuno decide).
      const autoJumpEventLimit = autoJumpEventBudget(actions.length);
      simulationRunId = shortId();
      this.ctx.coordinator.setActiveRunId(simulationRunId);
      this.ctx.coordinator.beginAbort();
      gameRepository.createSimulationRun({
        id: simulationRunId,
        gameId: this.ctx.gameId,
        mode: autoJump ? 'auto' : 'fixed',
        startDate: periodStart,
        targetDate: horizonDate,
        idempotencyKey,
      });

      // M06 µ6a (B1): in strict lo stato iniziale del catalogo entra nel ledger
      // del ramo (idempotente) PRIMA di ogni proposta: disponibilità reali per
      // prenotazioni/cashflow; fallisce chiuso se il catalogo è incoerente.
      if (this.ctx.isStrictGame()) {
        const worldRow = worldRepository.findById(this.ctx.worldId) as { template_id?: unknown } | undefined;
        const templateId = worldRow?.template_id;
        if (typeof templateId === 'string' && templateId) {
          const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
          if (!loaded.catalog) throw new Error(`strict_catalog_invalid: ${templateId}`);
          const branchId = gameRepository.getHeadBranch(this.ctx.gameId);
          if (!branchId) throw new Error('strict_branch_missing');
          bootstrapCatalogEconomy(this.ctx.gameId, branchId, loaded.catalog);
        }
      }

      this.ctx.broadcast('turn_start', {
        simulationId: simulationRunId,
        turn: this.state.currentTurn,
        actions: actions.map(item => ({ id: item.id, text: item.text })),
      });

      // Build game data for prompt engine
      // Il narratore conosce in anticipo quali ordini la tesoreria non può
      // sostenere: nessun successo narrato che la cassa smentisce.
      this.state.pendingFundingNotes = this.ctx.orderFundingNotes(actions);
      // Il trigger del turno usa le azioni del lotto CORRENTE con il loro ID
      // canonico: lo storico azioni non determina mai la causa del turno.
      const gameData = this.ctx.buildGameData(
        actions.map(item => item.text),
        actions.map(item => ({ actionId: item.id, text: item.text })),
      );
      this.state.pendingFundingNotes = null;

      // Gli eventi escono dal token stream UNO ALLA VOLTA. In auto-jump un
      // oggetto JSON completo viene applicato alla mappa e inviato al browser
      // come anteprima; nel salto fisso (§9.3) gli eventi restano PROPOSTE non
      // applicate: il primo commit avviene solo a stream concluso, e i
      // successivi soltanto dopo la conferma esplicita del giocatore.
      this.state.interveneRequested = false;
      const movementIntents = this.ctx.captureMovementIntents(actions);
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
      // Auto-jump: applicata la decisione NPC che risponde agli ordini, il
      // salto si ferma lì. Gli eventi successivi (conseguenze oltre la
      // decisione) restano fuori dal checkpoint e si gestiranno al prossimo salto.
      let autoJumpStopReached = false;
      const acceptEvent = (event: SimulationEvent, index: number, apply: boolean): boolean => {
        consumedEvents = Math.max(consumedEvents, index + 1);
        if (this.state.interveneRequested) {
          intervened = true;
          return false;
        }
        const canonicalEvent = this.ctx.canonicalizeEventReactions(event, actions.map(item => item.text));
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
        // In auto-jump il salto si arresta sulla prima decisione NPC che
        // risponde agli ordini del giocatore, oppure al tetto del budget se
        // nessuno decide: ignora gli eventuali record successivi del modello.
        if (autoJump && autoJumpStopReached) {
          console.log('[GameSession] Auto-jump: event after the decisive NPC decision ignored');
          return false;
        }
        if (autoJump && appliedEvents.length >= autoJumpEventLimit) {
          console.warn(`[GameSession] Auto-jump: event after the limit of ${autoJumpEventLimit} ignored`);
          return false;
        }
        const changedRegions = this.ctx.applyFrontierPlacements(
          canonicalEvent,
          this.ctx.applyMapChanges(canonicalEvent.mapChanges, canonicalEvent.date),
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
        // La decisione che chiude il salto entra nel checkpoint; le sue
        // conseguenze successive no (il controllo è DOPO l'applicazione).
        if (autoJump && isDecisiveNpcDecision(canonicalEvent)) {
          autoJumpStopReached = true;
        }
        // È una sola anteprima narrativa: nessun delta o data viene ancora
        // pubblicato, poiché DB e checkpoint non sono stati committati.
        this.ctx.broadcast('jump_event', {
          turn: this.state.currentTurn,
          index,
          event: {
            ...canonicalEvent,
            headline: this.ctx.publicText(canonicalEvent.headline),
            description: this.ctx.publicText(canonicalEvent.description),
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

      const promptResult = await this.ctx.gameController.processTurnWithPrompts(
        gameData,
        actions.map(item => ({ actionId: item.id, text: item.text })),
        timeJump,
        (chars: number) => this.ctx.broadcast('llm_progress', {
          mechanic: 'jump',
          chars,
          eventsReady: autoJump ? appliedEvents.length : proposedEvents.length,
        }),
        autoJump,
        emitEvent,
        this.ctx.coordinator.activeSimulationAbort!.signal,
      );

      const events = promptResult.events || [];
      // Compatibilità con mock/test e provider non-streaming: pubblica qui gli
      // eventuali eventi che non sono già arrivati dal callback incrementale.
      for (let i = consumedEvents; i < events.length; i++) {
        if (this.state.interveneRequested) { intervened = true; break; }
        emitEvent(events[i], i);
      }
      intervened ||= this.state.interveneRequested;

      // M06 µ3: in strict l'intero risultato è validato in un solo punto
      // PRIMA di qualsiasi mutatore materiale o commit narrativo. worldChanges
      // assoluti, mapChanges LLM diretti, outcome senza actionId canonico ed
      // effetti non consentiti → EffectValidationError: il catch riporta il
      // mondo all'ultimo checkpoint e il run termina 'failed'. Mai simulazione
      // riuscita per fallback (MAT25/26/27/37/38, C03/C04/C10).
      if (this.ctx.isStrictGame()) {
        validateStrictResultSafe(promptResult);
        assertExecutableStrictEffects(promptResult.effects || []);
      }

      // §9.3 — playback «un evento alla volta»: con due o più eventi proposti
      // il salto fisso committa solo il primo checkpoint e consegna il resto
      // delle proposte al run in pausa. «Continua» autorizza il checkpoint
      // seguente, «Intervieni qui» chiude il salto al checkpoint mostrato.
      if (!autoJump && !intervened && proposedEvents.length >= 2) {
        return this.ctx.playback.startPausedPlaybackUnlocked({
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
        gameRepository.updatePendingActionStatus(this.ctx.gameId, actions.map(action => action.id), 'pending');
        db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__'").run(this.ctx.gameId);
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
          turn: this.state.currentTurn,
        });
        this.ctx.coordinator.clearActiveRun();
        this.ctx.broadcast('turn_complete', {
          turn: this.state.currentTurn,
          narration: `La cronaca resta ferma: ${this.ctx.publicPolityName(this.state.playerPolityId)} non conferma l’avanzamento del periodo.`,
          events: ['Nessun nuovo sviluppo viene confermato'],
          newTurn: this.state.currentTurn,
          newDate: this.state.currentDate,
          intervened: true,
        });
        this.state.lastCommittedResult = null; // nessun esito: mai inferire dall’ultima cronaca
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
        const reconciled = this.ctx.reconcileAcceptedMoves(actions, promptResult.actionOutcomes || [], movementIntents,
          appliedEvents.flatMap(event => event.mapChanges || []), autoJump ? appliedEvents.at(-1)!.date : horizonDate);
        for (const region of reconciled) {
          checkpointChanges.set(region.id, {
            id: region.id, owner: region.owner, color: region.color, name: region.name,
            population: region.population, gdp: region.gdp, militaryPower: region.militaryPower,
            objects: region.objects,
          });
        }
        // Nessun movimento accettato resta silenzioso: la ragione entra nei
        // dispacci del turno (drenati da advanceWorldState, più sotto).
        for (const note of this.ctx.movementNotices(actions, promptResult.actionOutcomes || [], movementIntents)) {
          this.state.pendingNationalNotes.push(note);
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
        gameRepository.updatePendingActionStatus(this.ctx.gameId, actions.map(action => action.id), 'pending');
        db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__'").run(this.ctx.gameId);
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
          turn: this.state.currentTurn,
        });
        this.ctx.coordinator.clearActiveRun();
        this.ctx.broadcast('simulation_no_event', {
          simulationId: simulationRunId,
          turn: this.state.currentTurn,
          startDate: periodStart,
          searchedUntil: horizonDate,
        });
        this.state.lastCommittedResult = null; // C10: il salto senza eventi non ha un esito
        return [];
      }

      // Нереалистичные действия, отклонённые simulaцией
      const voided = promptResult.voided || [];
      for (const v of voided) {
        this.ctx.broadcast('action_voided', {
          turn: this.state.currentTurn,
          action: this.ctx.publicText(v.action),
          reason: this.ctx.publicText(v.reason),
          polityName: this.ctx.publicPolityName(this.state.playerPolityId),
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
        this.ctx.applyWorldChanges(promptResult.worldChanges);
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
      const polityResolver = this.ctx.buildResolvers().polities;
      for (const change of applyCompletionEffects ? promptResult.relationshipChanges || [] : []) {
        const from = polityResolver.resolve(change.from);
        const to = polityResolver.resolve(change.to);
        if (!from || !to || from.isNew || to.isNew || from.polityId === to.polityId) continue;
        this.ctx.diplomacy.matrix().set(from.polityId, to.polityId, change.relationship);
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
      if (this.ctx.isStrictGame() && applyCompletionEffects) applyStagedStrictEffects(this.ctx.gameId, gameRepository.getHeadBranch(this.ctx.gameId)!, gameRepository.getWorldRevision(this.ctx.gameId), promptResult.effects || []);
      relationshipRepository.upsertForGame(this.ctx.gameId, persistedRelationshipChanges);

      // Le nazioni possono aprire autonomamente un canale dopo un evento.
      // In auto-jump entra soltanto una chat legata per titolo a un dispaccio
      // realmente applicato; nei salti fissi conclusi è valida anche la forma
      // legacy senza collegamento esplicito.
      const chatTimelineEvents: TimelineEventRecord[] = [];
      const explicitChatStarts = applyCompletionEffects || (autoJump && !intervened)
        ? promptResult.startChat || []
        : [];
      const chatStarts = [...explicitChatStarts, ...this.ctx.reactionChatStarts(appliedEvents)];
      const chatEffects = this.ctx.diplomacy.openSimulationChats(
        chatStarts,
        {
          turn: this.state.currentTurn,
          fallbackDate: period.end,
          simulationId: simulationRunId || undefined,
          events: appliedEvents,
          requireEventLink: autoJump,
        },
      );
      // GAMEPLAY-LONG: gli impegni nati nel turno entrano nel registro
      // strutturato (ultimatum dalle chat, proposte validate del modello): la
      // cronaca potrà essere riassunta, il registro no.
      const commitmentEffects = this.ctx.recordCommitments({
        startChat: chatStarts,
        proposals: (promptResult as { commitments?: unknown }).commitments,
        updates: (promptResult as { commitmentUpdates?: unknown }).commitmentUpdates,
      });
      for (const commitment of commitmentEffects.created) {
        console.log(`[GameSession] Impegno registrato: ${commitment.type} ${commitment.actor} → ${commitment.counterparty ?? 'interno'} (${commitment.description}).`);
      }
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
      const economyBulletins = this.ctx.isStrictGame() || period.elapsedDays > 0 ? this.ctx.advanceWorldState(period.elapsedDays, period.end) : [];
      // Avanzamento dei progetti sempre rinfrescato, anche a tempo invariato.
      economyBulletins.push(...this.ctx.refreshProjectProgress(period.end));
      // La cassa segue le scelte del giocatore: gli ordini eseguiti in questo
      // periodo vengono regolati nella stessa transazione dell'esito.
      const orderCostSettlement = this.ctx.settleOrderCosts(
        promptResult.actionOutcomes,
        actions.map(action => action.id),
        new Map(actions.map(action => [action.id, action.text] as const)),
      );
      economyBulletins.push(...orderCostSettlement.lines);
      // Chi non ha i soldi non compra: il motore annulla l'ordine e lo dichiara.
      for (const order of orderCostSettlement.unfunded) {
        if (!voided.some((entry: any) => entry.action === order.action)) {
          voided.push({ action: order.action, reason: order.reason });
        }
        this.ctx.broadcast('action_voided', {
          turn: this.state.currentTurn,
          action: this.ctx.publicText(order.action),
          reason: order.reason,
          polityName: this.ctx.publicPolityName(this.state.playerPolityId),
        });
      }
      // Il punto storico della tesoreria va riscritto dopo la spesa ordinata.
      if (orderCostSettlement.lines.length > 0) this.ctx.recordAccountSnapshot(period.end);
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
        turn: this.state.currentTurn,
        text: item.text,
        createdAt: item.createdAt,
      }));
      this.state.actions.push(...actionRecords);
      actionRecords.forEach(actionRecord => gameRepository.addAction({
        id: actionRecord.id,
        gameId: this.ctx.gameId,
        playerId: player.id,
        turn: this.state.currentTurn,
        text: actionRecord.text,
      }));

      // Create turn result (заголовки только ПРИМЕНЁННЫХ событий + voided)
      const llmEventHeadlines = appliedEvents.map((event: any) => this.ctx.publicText(event.headline)).filter(Boolean);
      const voidedHeadlines = voided.map((v: any) => `${this.ctx.publicPolityName(this.state.playerPolityId)} non attua la direttiva «${this.ctx.publicText(v.action)}»${v.reason ? `: ${this.ctx.publicText(v.reason)}` : '.'}`);
      if (intervened) llmEventHeadlines.push('La cronaca si arresta alla data scelta dal governo');
      turnResult = {
        id: shortId(),
        simulationId: simulationRunId || undefined,
        turn: this.state.currentTurn,
        // In auto-jump non riutilizzare il riassunto completo della LLM: può
        // descrivere il futuro oltre gli eventi accettati.
        narration: this.ctx.publicText((intervened || autoJump)
          ? appliedEvents.map(e => e.description).join('\n\n')
          : promptResult.narration),
        countryResponse: promptResult.convertedActions.map((a: any) => a.text).join('\n'),
        events: [...voidedHeadlines, ...llmEventHeadlines, ...economyEvents, ...npcEvents, ...randomEvents],
      };
      this.state.results.push(turnResult);
      // F03/A10: l’esito è associato all’ID alla creazione (nessun fallback
      // per posizione in processWorldAdvance).
      this.state.lastCommittedResult = turnResult;

      // Persist ALL region changes to DB
      this.ctx.syncRegionsToDB();

      // Ogni ordine mantiene l'involucro comune del turno ma riceve il proprio
      // esito strutturato quando il provider lo restituisce. Il nuovo percorso
      // usa actionId; l'adapter legacy accetta solo testi univoci convertiti.
      const outcomes = this.ctx.outcomesByActionId(
        actions, promptResult.actionOutcomes, promptResult.convertedActions,
      );
      // DECISION-IMPACT: la contabilità già fatta dal motore (addebito per
      // ordine) viaggia con l'esito strutturato dell'ordine, così il client può
      // attribuire alla singola decisione un effetto misurabile senza dedurlo.
      const settlementByActionId = new Map<string, OrderSettlementEntry>(
        (orderCostSettlement.entries || []).map((entry: OrderSettlementEntry) => [String(entry.actionId), entry]),
      );
      actions.forEach(item => {
        const outcome = outcomes.get(item.id);
        const rejected = voided.find((result: any) => result.action === item.text);
        const outcomeStatus = outcome?.status || (rejected ? 'rejected' : undefined);
        const outcomeSummary = this.ctx.publicText(outcome?.summary || rejected?.reason);
        const outcomeEvents = outcome?.eventHeadlines?.length
          ? outcome.eventHeadlines.map((headline: string) => this.ctx.publicText(headline)).filter((headline: string) => turnResult.events.includes(headline))
          : rejected ? voidedHeadlines.filter((headline: string) => headline.includes(rejected.action)) : turnResult.events;
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
          settlement: settlementByActionId.get(item.id),
          turn: this.state.currentTurn,
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
          gameId: this.ctx.gameId,
          sourceActionId: action.id,
          sourceRunId: simulationRunId!,
          title: action.text,
          summary: action.result!.outcome!.summary,
          startedDate: periodStart,
          expectedDate: action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > periodStart
            ? action.result!.outcome!.expectedDate
            : undefined,
          progress: projectProgress(
            periodStart,
            action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > periodStart
              ? action.result!.outcome!.expectedDate
              : null,
            this.state.currentDate,
          ),
        });
      });
      // Un progetto si chiude solo per il suo ID esplicito e con outcome
      // accepted: un titolo o un testo riformulato non può chiudere un altro.
      // Inoltre il cantiere deve essere materialmente pronto: se il progetto ha
      // una scadenza dichiarata e l'avanzamento è sotto soglia, il motore NON
      // chiude e il progetto resta aperto. Senza scadenza vale l'esito del
      // modello (è l'unico segnale di chiusura disponibile).
      const ongoingNow = gameRepository.getOngoingProcesses(this.ctx.gameId);
      const progressById = new Map(ongoingNow
        .filter(process => process.expected_date)
        .map(process => [
          process.id,
          Number.isFinite(Number(process.progress)) && process.progress !== null
            ? Number(process.progress)
            : projectProgress(process.started_date, process.expected_date, this.state.currentDate),
        ]));
      actions.forEach(action => {
        const outcome = action.result?.outcome;
        if (!outcome?.completesProjectId) return;
        if (outcome.status !== 'accepted') {
          throw new Error('simulation_protocol_error: completesProjectId is invalid or not accepted');
        }
        const progress = progressById.get(outcome.completesProjectId);
        if (progress !== undefined && progress < EFFECT_LIMITS.projectCompletionThreshold) {
          this.state.pendingNationalNotes.push(`⏳ Progetto non chiuso: avanzamento ${progress}% sotto la soglia del ${EFFECT_LIMITS.projectCompletionThreshold}%. Il cantiere resta aperto.`);
          return;
        }
        if (gameRepository.completeOngoingProcessById(this.ctx.gameId, outcome.completesProjectId, outcome.summary, period.end) !== 1) {
          throw new Error('simulation_protocol_error: completesProjectId is invalid or not accepted');
        }
      });

      // Esiti individuali durevoli: anche i preset legacy ricevono un record
      // esplicito (accepted + cronaca comune) invece di sparire con la coda.
      gameRepository.addSimulationActionOutcomes(actions.map(action => ({
        id: shortId(),
        runId: simulationRunId!,
        gameId: this.ctx.gameId,
        actionId: action.id,
        status: action.result?.outcome?.status || 'unresolved',
        summary: action.result?.outcome?.summary || action.result?.narration || turnResult.narration,
        eventHeadlines: action.result?.events || [],
      })));

      // Completed orders no longer belong to the future queue. Persist the
      // removal only after their common result has been constructed.
      gameRepository.removePendingActions(this.ctx.gameId, actions.map(item => item.id));
      // Anche la coda viva perde gli ordini conclusi (MAP-COMPLETE-ACTIONS
      // P2/P3): la UI rilegge la coda autorevole dopo il salto, quindi se la
      // RAM conservasse gli ordini completati la lista si accumulerebbe turno
      // dopo turno. Stessa pulizia già fatta dal percorso in pausa
      // (`PlaybackService`), con lo stesso `replaceQueue`.
      this.ctx.orders.replaceQueue(this.ctx.orders.queue()
        .filter(action => !actions.some(item => item.id === action.id)));

      // Advance turn and date
      this.state.currentTurn++;
      this.state.currentDate = period.end;
      // Le sfide del turno appena chiuso scadono (l'inerzia pesa) e ne
      // nascono di nuove dagli indicatori aggiornati.
      this.ctx.refreshPeacetimePressures();
      // La scala di crisi fa un passo **lungo il tempo realmente simulato**
      // (7/30/90/180/365 giorni, o l'orizzonte di una ricerca automatica):
      // tre turni critici e la nazione cade (rivolta, default o invasione).
      this.ctx.evaluateCrisis(true, period.elapsedDays);

      // Now set periodEnd (after advancing)
      actions.forEach(item => {
        if (item.result) item.result.periodEnd = this.state.currentDate;
      });

      // Timeline: conserva data, titolo e dettaglio originale di ogni evento.
      turnResult.date = this.state.currentDate;
      const detailedByHeadline = new Map(
        appliedEvents.map(event => [this.ctx.publicText(event.headline), event] as const)
      );
      const sourceActionsByHeadline = new Map<string, string[]>();
      actions.forEach(action => {
        const outcome = outcomes.get(action.id);
        outcome?.eventHeadlines?.forEach((headline: string) => {
          const ids = sourceActionsByHeadline.get(headline) || [];
          ids.push(action.id);
          sourceActionsByHeadline.set(headline, ids);
        });
      });
      turnResult.timelineEvents = turnResult.events.map((headline: string, index: number) => {
        const detailed = detailedByHeadline.get(headline);
        return {
          id: `${turnResult.id}-${index}`,
          date: detailed?.date || this.state.currentDate,
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
          date: this.state.currentDate,
          headline: `${this.ctx.publicPolityName(change.from)} e ${this.ctx.publicPolityName(change.to)} ridefiniscono i rapporti`,
          detail: `Il rapporto diventa ${this.ctx.publicText(change.newRelationship)}: ${this.ctx.publicText(change.reason)}`,
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
        gameId: this.ctx.gameId,
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
      if (!gameRepository.compareAndSwapTurnAndDate(this.ctx.gameId, turnBeforeRun, dateBeforeRun, this.state.currentTurn, this.state.currentDate)) {
        throw new Error(`world_anchor_conflict: mondo mutato durante il run (atteso turno ${turnBeforeRun} del ${dateBeforeRun})`);
      }
      const checkpointId = shortId();
      // F02: anche il percorso ordinario usa il contatore monotono: la sua
      // revisione non può mai regredire rispetto a un playback precedente.
      const checkpointRevision = gameRepository.nextWorldRevision(this.ctx.gameId);
      gameRepository.createSimulationCheckpoint({
        id: checkpointId,
        runId: simulationRunId!,
        gameId: this.ctx.gameId,
        revision: checkpointRevision,
        turn: turnResult.turn,
        date: this.state.currentDate,
        data: this.ctx.captureCheckpointData(),
      });
      gameRepository.addSimulationEvents((turnResult.timelineEvents || []).map((event: any) => ({
        id: event.id,
        runId: simulationRunId!,
        checkpointId,
        gameId: this.ctx.gameId,
        date: event.date,
        headline: event.headline,
        detail: event.detail,
        source: event.source,
        sourceActionIds: event.sourceActionIds,
      })));
      this.ctx.enqueueOutboxRows(simulationRunId!, checkpointId, checkpointRevision, turnResult.turn, turnResult.timelineEvents || []);
      gameRepository.finishSimulationRun(simulationRunId!, intervened ? 'intervened' : 'completed', {
        checkpointDate: this.state.currentDate,
        checkpointId,
        turn: turnResult.turn,
      });
      }); // fine transazione canonica (F02 passo 2)
      this.ctx.publishPendingOutbox();
      // F02/M06: la chat è visibile soltanto dopo il commit canonico.
      for (const payload of chatBroadcasts) this.ctx.broadcast('chat_message', payload);

      // Этап 2: консолидация истории — не должна ронять успешный ход
      try {
        await this.ctx.maybeConsolidate();
      } catch (e) {
        console.error('[GameSession] Consolidation failed (turn kept):', e);
      }

      this.ctx.broadcast('turn_complete', {
        turn: this.state.currentTurn - 1,
        narration: turnResult.narration,
        events: turnResult.events,
        eventDetails: turnResult.timelineEvents,
        newTurn: this.state.currentTurn,
        newDate: this.state.currentDate,
        changedRegions: [...checkpointChanges.values()],
        intervened,
      });

      // Reazioni NPC agli ordini: non solo notizie, ma anche prese di
      // posizione diplomatiche. Fire-and-forget (turno già committato).
      if (actions.length > 0) {
        const reactionCandidates = new Set<string>();
        for (const change of persistedRelationshipChanges) {
          if (change.from === this.state.playerPolityId) reactionCandidates.add(change.to);
          if (change.to === this.state.playerPolityId) reactionCandidates.add(change.from);
        }
        if (applyCompletionEffects && promptResult.worldChanges?.regionOwners) {
          for (const newOwner of Object.values(promptResult.worldChanges.regionOwners)) {
            const resolved = polityResolver.resolve(String(newOwner || ''));
            if (resolved && !resolved.isNew) reactionCandidates.add(resolved.polityId);
          }
        }
        // Fallback deterministico per provider che omettono `reactions`:
        // solo le controparti che il giocatore ha davvero interpellato con
        // i suoi ordini aprono un canale. Un nome citato di sfondo in un
        // dispaccio non basta: evitiamo note di comodo da nazioni incoerenti.
        for (const polityId of this.ctx.mentionedNpcPolityIds(actions.map(action => action.text))) {
          reactionCandidates.add(polityId);
        }
        const hadDirectlyInvolvedPolity = reactionCandidates.size > 0 || openedChatPolityIds.size > 0;
        // Le politie che hanno già aperto un canale o partecipano a una
        // riunione generata dall'evento hanno già reagito: non duplicare note.
        for (const polityId of openedChatPolityIds) reactionCandidates.delete(polityId);
        // Fallback: soltanto se nessuna controparte diretta è stata rilevata,
        // un vicino ostile può reagire alla mossa (deterrenza/protesta).
        if (reactionCandidates.size === 0 && !hadDirectlyInvolvedPolity) {
          const playerRegions = Array.from(this.state.regions.values()).filter(r => r.owner === this.state.playerPolityId);
          const frontierOwners = new Set<string>();
          for (const region of playerRegions) {
            for (const borderId of region.borders || []) {
              const neighbour = this.state.regions.get(borderId);
              if (neighbour && neighbour.owner !== this.state.playerPolityId && neighbour.owner !== 'neutral') {
                frontierOwners.add(neighbour.owner);
              }
            }
          }
          const hostile = [...frontierOwners].find(owner => this.ctx.diplomacy.matrix().get(owner, this.state.playerPolityId) === 'hostile');
          if (hostile) reactionCandidates.add(hostile);
        }
        void this.ctx.diplomacy.generateNpcReactions({
          actionTexts: actions.map(item => item.text),
          eventHeadlines: turnResult.events.filter((headline: string) => !headline.startsWith('⊘')),
          candidatePolityIds: [...reactionCandidates],
          turn: turnResult.turn,
          date: turnResult.date || this.state.currentDate,
        }).catch(e => console.warn('[GameSession] NPC reactions failed:', e));
      }

      // Этап 3: проактивный советник — короткий комментарий итогов периода.
      // Fire-and-forget: ход уже успешен, советник не должен его задерживать
      // или ронять.
      this.ctx.getAdvisorUnchecked(
        'Commenta brevemente (max 500 caratteri) gli esiti del periodo appena trascorso per il tuo leader, in italiano',
        []
      )
        .then(content => this.ctx.broadcast('advisor_proactive', { content }))
        .catch(e => console.error('[GameSession] Proactive advisor failed:', e));

      this.ctx.coordinator.clearActiveRun();
      console.log('[GameSession] Action batch processed, new date:', this.state.currentDate);
      return actions;

    } catch (e) {
      console.error('[GameSession] Error processing action batch:', e);
      // Ripristino completo del checkpoint precedente, non soltanto della
      // mappa: altrimenti un client potrebbe osservare data/cronaca future.
      this.state.regions = regionsBeforeStream;
      this.state.currentTurn = turnBeforeRun;
      this.state.currentDate = dateBeforeRun;
      this.ctx.diplomacy.replaceFromJSON(relationshipsBeforeRun);
      this.state.actions = actionsBeforeRun;
      this.state.results = resultsBeforeRun;
      if (simulationRunId) {
        gameRepository.finishSimulationRun(simulationRunId, 'failed', { error: e instanceof Error ? e.message : String(e) });
      }
      this.ctx.coordinator.clearActiveRun();
      actions.forEach(item => {
        item.status = 'pending';
        item.deliveryStatus = 'queued';
        item.executionStatus = 'not_started';
      });
      try {
        await this.ctx.syncRegionsToDB();
        gameRepository.replaceHistory(this.ctx.gameId, this.state.actions, this.state.results);
        relationshipRepository.replaceForGame(this.ctx.gameId, Object.entries(relationshipsBeforeRun).flatMap(([from, targets]) =>
          Object.entries(targets as Record<string, RelationshipType>).map(([to, type]) => ({ from, to, type }))
        ));
        chatRepository.replaceGameChats(this.ctx.gameId, chatsBeforeRun);
        gameRepository.replaceOngoingProcesses(this.ctx.gameId, ongoingProcessesBeforeRun);
        gameRepository.updateTurnAndDate(this.ctx.gameId, this.state.currentTurn, this.state.currentDate);
        // The batch may already have removed its rows before a later DB write.
        gameRepository.replacePendingActions(this.ctx.gameId, this.ctx.orders.queue());
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
    const result = await this.ctx.withLock(async () => {
      if (this.state.pausedRun) throw new SimulationPausedError(this.state.pausedRun.runId);
      const pending = this.ctx.orders.queue().filter(action => action.status === 'pending');
      return this.processActionBatchUnlocked(jumpDays, pending, idempotencyKey);
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
    const result = await this.ctx.withLock(async () => {
      executed = true;
      if (this.state.pausedRun) throw new SimulationPausedError(this.state.pausedRun.runId);
      const batch = await this.processActionBatchUnlocked(jumpDays, [], idempotencyKey);
      // §9.3: il mondo senza nuovi ordini riceve lo stesso playback scaglionato
      // quando la simulazione produce più eventi nel periodo richiesto.
      if (!Array.isArray(batch)) return batch;
      // F03/A10: il risultato è quello del batch appena committato, associato
      // all’ID alla creazione. Un salto senza eventi non inventa la cronaca
      // dell’esito dal run precedente.
      return this.state.lastCommittedResult;
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
}
