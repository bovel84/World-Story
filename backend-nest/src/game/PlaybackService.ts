/**
 * World Story — PlaybackService
 * =============================
 * Macchina a stati del playback «un evento alla volta» per i salti fissi,
 * estratta da `game-session.ts` (Fase 1). Copre:
 *  - `startPausedPlaybackUnlocked`: crea il run scaglionato e committa il primo evento;
 *  - `commitPausedStepUnlocked`: applica un evento e crea il checkpoint per-evento;
 *  - `completePausedRunUnlocked`: chiude il run (destinazione, budget, intervento).
 *
 * Lo **stato vivo** è posseduto da `SessionStateStore`, iniettato qui: il
 * servizio legge/scrive `state.regions`, `state.currentTurn`, `state.pausedRun`
 * ecc. Tutto il resto passa da callback di `GameSession` (`PlaybackContext`):
 * transazione, checkpoint, broadcast, mutazione mappa, economia, chat, outbox.
 */

import { withCanonicalTransaction } from '../database';
import { gameRepository, relationshipRepository } from '../repositories';
import { applyStagedStrictEffects, promotePlaybackEffectAnchors } from '../core/simulation/TurnOrchestrator';
import { projectProgress } from '../core/simulation/MilitaryProduction';
import { shortId } from '../utils/short-id';
import type { RelationshipType } from '../core/RelationshipMatrix';
import type { SimulationEvent } from '../prompts/types';
import type { MovementIntent } from '../utils/movement-orders';
import type { PendingAction, OrderSettlementEntry } from './OrderExecutionService';
import type { CommitmentResult } from './CommitmentService';
import type { SimulationCoordinator } from './SimulationCoordinator';
import type { DiplomacyService } from './DiplomacyService';
import type { OrderExecutionService } from './OrderExecutionService';
import type { SessionStateStore } from './SessionStateStore';
import type { ActionRecord, CompletedBatchResult, PausedBatchResult, PausedRunState, RegionState, TimelineEventRecord, TurnResultRecord } from '../game-session';

export interface PlaybackContext {
  gameId: string;
  /** Stato vivo di sessione: il servizio ne è un mutatore autorizzato. */
  state: SessionStateStore;
  coordinator: SimulationCoordinator;
  diplomacy: DiplomacyService;
  orders: OrderExecutionService;
  /** GAMEPLAY-LONG: registra gli impegni nati nel turno. */
  recordCommitments(input: {
    startChat?: readonly { participants?: string[]; polityName?: string; kind?: string; topic?: string; eventHeadline?: string }[];
    proposals?: unknown;
    updates?: unknown;
  }): CommitmentResult;
  isStrictGame(): boolean;
  publicText(value: unknown): string;
  publicPolityName(polityId: string): string;
  broadcast(type: any, data: any): boolean | void;
  buildResolvers(): any;
  captureCheckpointData(): any;
  captureMovementIntents(actions: PendingAction[]): MovementIntent[];
  outcomesByActionId(...args: any[]): any;
  advanceWorldState(days: number, asOfDate: string): string[];
  /**
   * CRISIS-RESIDUAL P0.1: il playback scaglionato fa avanzare la crisi dei
   * giorni del passo, con la stessa semantica degli altri percorsi. Il
   * checkpoint del passo porta con sé lo stato aggiornato, quindi il pericolo
   * è visibile **prima** dell'eventuale collasso (Intervieni/Continua).
   */
  evaluateCrisis(periodDays: number): any;
  applyFrontierPlacements(...args: any[]): RegionState[];
  applyMapChanges(...args: any[]): RegionState[];
  applyWorldChanges(...args: any[]): void;
  reconcileNpcMaterialMeasures(event: SimulationEvent): SimulationEvent;
  reactionChatStarts(...args: any[]): any[];
  recordAccountSnapshot(...args: any[]): void;
  enqueueOutboxRows(...args: any[]): void;
  publishPendingOutbox(limit?: number): number;
  syncRegionsToDB(): Promise<void> | void;
  maybeConsolidate(): Promise<void>;
  getAdvisorUnchecked(...args: any[]): Promise<string>;
  refreshProjectProgress(asOfDate?: string): string[];
  settleOrderCosts(...args: any[]): any;
  reconcileAcceptedMoves(...args: any[]): any;
  /** ARMY-MOVE: motivazioni esplicite per i movimenti accettati non eseguiti. */
  movementNotices(...args: any[]): string[];
}

export class PlaybackService {
  constructor(private readonly ctx: PlaybackContext) {}

  /** Stato vivo di sessione (accessor per leggibilità dei corpi metodo). */
  private get state(): SessionStateStore { return this.ctx.state; }

  async startPausedPlaybackUnlocked(opts: {
    simulationRunId: string;
    actions: PendingAction[];
    promptResult: any;
    proposedEvents: SimulationEvent[];
    periodStart: string;
    horizonDate: string;
  }): Promise<PendingAction[] | PausedBatchResult> {
    const headlineToActionIds: Record<string, string[]> = {};
    const outcomes = this.ctx.outcomesByActionId(
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
      jumpTurn: this.state.currentTurn,
      revisionBase: this.state.currentTurn + 1,
      remainingEvents: [...opts.proposedEvents],
      batchActionIds: opts.actions.map(action => action.id),
      movementIntents: this.ctx.captureMovementIntents(opts.actions),
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
    const stepResult = await this.commitPausedStepUnlocked(state, first);
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
  async commitPausedStepUnlocked(
    state: PausedRunState,
    event: SimulationEvent,
  ): Promise<PausedBatchResult | CompletedBatchResult> {
    // Stesso contratto mappa della simulazione batch: le misure materiali
    // attestate dalle controparti NPC diventano marker anche nel playback.
    event = this.ctx.reconcileNpcMaterialMeasures(event);
    const runId = state.runId;
    const lastDate = this.state.currentDate;
    const eventDate = event.date;

    // F02 passo 4: ancora del mondo per il CAS e staging della RAM. Le
    // mutazioni qui sotto (mappa, economia, turno/data) sono transitorie:
    // solo il commit riuscito le rende canoniche, un errore le scarta.
    const anchorTurn = this.state.currentTurn;
    const anchorDate = this.state.currentDate;
    const staging = {
      regions: new Map<string, RegionState>(
        [...this.state.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      turn: this.state.currentTurn,
      date: this.state.currentDate,
      results: [...this.state.results],
      appliedCount: state.appliedCount,
      changedRegionsCount: state.changedRegions.length,
      movementChanges: [...(state.movementChanges || [])],
      remainingEvents: [event, ...state.remainingEvents],
      currentEventId: state.currentEventId,
      checkpointId: state.checkpointId,
      revision: state.revision,
      pausedRun: this.state.pausedRun,
    };
    // M06 µ5f (quarta revisione B2): closeReason vive FUORI dal try, così la
    // completion dell'ultimo evento è invocata DOPO il catch: un suo fault
    // non ripassa dal rollback pre-step sopra un run già chiuso 'failed'.
    let closeReason: 'paused_budget' | 'completed' | null = null;
    try {
    // Effetti mappa dell’evento: solo ora la proposta diventa applicata.
    const changedRegions = this.ctx.applyFrontierPlacements(
      event,
      this.ctx.applyMapChanges(event.mapChanges, event.date),
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
    if (state.appliedCount === 0) this.state.currentTurn = state.jumpTurn + 1;
    this.state.currentDate = eventDate;

    const stepId = shortId();
    const sourceActionIds = state.headlineToActionIds[event.headline] || [];
    const timelineEvents: TimelineEventRecord[] = [{
      id: `${stepId}-0`,
      date: eventDate,
      headline: this.ctx.publicText(event.headline),
      detail: this.ctx.publicText(event.description),
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
      events: [this.ctx.publicText(event.headline), ...bulletins],
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
        bulletins.push(...this.ctx.advanceWorldState(elapsedDays, eventDate));
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
      // CRISIS-RESIDUAL P0.1: il tempo di questo passo fa avanzare anche la crisi.
      // Va valutata PRIMA del checkpoint qui sotto, così il punto salvato porta
      // con sé lo stato aggiornato: il giocatore vede il pericolo al checkpoint.
      if (elapsedDays > 0) this.ctx.evaluateCrisis(elapsedDays);

      const reactionChatEffects = this.ctx.diplomacy.openSimulationChats(this.ctx.reactionChatStarts([event], true), {
        turn: state.jumpTurn,
        fallbackDate: eventDate,
        simulationId: runId,
        events: [event],
        requireEventLink: true,
      });
      timelineEvents.push(...reactionChatEffects.timelineEvents);
      reactionChatBroadcasts.push(...reactionChatEffects.broadcasts);

      this.state.results.push(turnResult);
      // F03/A10: l’esito del batch è associato all’ID alla creazione; non verrà
      // mai letto per posizione da processWorldAdvance.
      this.state.lastCommittedResult = turnResult;
      gameRepository.addTurnResult({ ...turnResult, gameId: this.ctx.gameId });

      // Persist turn and date to DB in single operation. F02 passo 4: CAS
      // sull’ancora pre-commit — un mondo mutato altrove blocca il commit.
      this.ctx.syncRegionsToDB();
      if (!gameRepository.compareAndSwapTurnAndDate(this.ctx.gameId, anchorTurn, anchorDate, this.state.currentTurn, this.state.currentDate)) {
        throw new Error(`world_anchor_conflict: mondo mutato durante la pausa (atteso turno ${anchorTurn} del ${anchorDate})`);
      }

      // Il run in pausa referenzia il checkpoint: assegnalo PRIMA della cattura,
      // così un restore di questo checkpoint ripristina anche il playback (§9.3).
      // F02: revisione dal contatore monotono, non più da turno + indice.
      const previousRevision = gameRepository.getWorldRevision(this.ctx.gameId);
      const revision = gameRepository.nextWorldRevision(this.ctx.gameId);
      if (this.ctx.isStrictGame()) {
        const branchId = gameRepository.getHeadBranch(this.ctx.gameId);
        if (!branchId) throw new Error('strict_branch_missing');
        promotePlaybackEffectAnchors(this.ctx.gameId, branchId, previousRevision, revision, state.completion.effects);
      }
      const checkpointId = shortId();
      const eventOrdinal = state.appliedCount; // ordinale dell'evento nel playback (broadcast)
      state.currentEventId = `${stepId}-0`;
      state.checkpointId = checkpointId;
      state.revision = revision;
      // Il checkpoint cattura lo stato del passo *successivo*: dopo restore la
      // revisione resta crescente e non si ricommette l'evento appena letto.
      state.appliedCount += 1;
      this.state.pausedRun = state;
      gameRepository.createSimulationCheckpoint({
        id: checkpointId, runId, gameId: this.ctx.gameId, revision,
        turn: state.jumpTurn, date: eventDate, data: this.ctx.captureCheckpointData(),
      });
      gameRepository.addSimulationEvents(timelineEvents.map(timelineEvent => ({
        id: timelineEvent.id,
        runId,
        checkpointId,
        gameId: this.ctx.gameId,
        date: timelineEvent.date,
        headline: timelineEvent.headline,
        detail: timelineEvent.detail,
        source: timelineEvent.source,
        sourceActionIds: timelineEvent.sourceActionIds,
      })));
      this.ctx.enqueueOutboxRows(runId, checkpointId, revision, state.jumpTurn, timelineEvents);

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
        this.ctx.coordinator.clearActiveRun();
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
    for (const payload of reactionChatBroadcasts) this.ctx.broadcast('chat_message', payload);

    if (!closeReason) {
    const remaining = remainingEvents;
    const revision = committedRevision;
    const checkpointId = committedCheckpointId;
    const eventOrdinal = state.appliedCount - 1; // ordinale dell'evento appena committato
    this.ctx.publishPendingOutbox();
    this.ctx.broadcast('jump_event', {
      turn: state.jumpTurn,
      index: eventOrdinal,
      event: { ...event, headline: this.ctx.publicText(event.headline), description: this.ctx.publicText(event.description) },
      eventId: state.currentEventId,
      checkpointId: state.checkpointId,
      revision: state.revision,
      streaming: false,
      checkpoint: true,
      changedRegions,
      newDate: eventDate,
      newTurn: this.state.currentTurn,
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
        headline: this.ctx.publicText(event.headline),
        detail: this.ctx.publicText(event.description),
        source: 'world',
        sourceActionIds,
      },
      remaining,
      destination: state.destination,
      checkpointId,
      revision,
      newDate: eventDate,
      newTurn: this.state.currentTurn,
      changedRegions,
    };
    }
    } catch (e) {
      // F02 passo 4: scarto dello staging — mappa, economia, turno/data e
      // stato del run tornano al checkpoint confermato più recente.
      this.state.regions = staging.regions;
      this.state.currentTurn = staging.turn;
      this.state.currentDate = staging.date;
      this.state.results = staging.results;
      state.appliedCount = staging.appliedCount;
      state.changedRegions.length = staging.changedRegionsCount;
      state.movementChanges = staging.movementChanges;
      state.remainingEvents = [...staging.remainingEvents];
      state.currentEventId = staging.currentEventId;
      state.checkpointId = staging.checkpointId;
      state.revision = staging.revision;
      this.state.pausedRun = staging.pausedRun;
      throw e;
    }
    // M06 µ5f: la completion dell'ultimo evento NON passa dal catch dello
    // step: il suo rollback interno (post-step + run 'failed' + requeue)
    // resta l'unica contabilità dell'errore, senza il doppio rollback pre-step.
    if (closeReason) return this.completePausedRunUnlocked(state, closeReason);
    throw new Error('playback step senza pausa né chiusura');
  }

  /**
   * Chiude il run scaglionato: porta il mondo a destinazione («completed»)
   * oppure lo ferma all'ultimo checkpoint confermato («paused_budget» /
   * «intervened»), finalizza gli ordini del lotto e pubblica il riepilogo.
   */
  async completePausedRunUnlocked(
    state: PausedRunState,
    reason: 'completed' | 'paused_budget' | 'intervened',
  ): Promise<CompletedBatchResult> {
    const runId = state.runId;
    const completion = state.completion;
    const player = this.state.players[0];
    if (!player) throw new Error('No player in session');
    const playerRegion = this.state.regions.get(player.regionId);
    if (!playerRegion) throw new Error('Player region not found');

    const destinationReached = reason === 'completed';
    const lastEventDate = this.state.currentDate;
    const finalDate = destinationReached ? state.destination : lastEventDate;

    // F02 passo 4: ancora del mondo per il CAS e staging della RAM. Il commit
    // riuscito promuove lo staging; ogni errore lo scarta e la RAM torna
    // esattamente al checkpoint confermato più recente.
    const anchorTurn = this.state.currentTurn;
    const anchorDate = this.state.currentDate;
    const staging = {
      regions: new Map<string, RegionState>(
        [...this.state.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      relationships: this.ctx.diplomacy.toJSON(),
      actions: [...this.state.actions],
      results: [...this.state.results],
      pendingActions: this.ctx.orders.snapshot(),
      turn: this.state.currentTurn,
      date: this.state.currentDate,
      interveneRequested: this.state.interveneRequested,
      pausedRun: this.state.pausedRun,
    };

    // Cronaca canonica del run: gli eventi applicati, con le loro date.
    const appliedRows = gameRepository.getSimulationEvents(this.ctx.gameId, runId);
    const appliedHeadlines = new Set(appliedRows.map(row => row.headline));
    const voided = completion.voided || [];
    // La cassa segue le scelte del giocatore: gli ordini che il run ha eseguito
    // vengono regolati ora, prima che la cronaca li racconti. Chi non ha i
    // soldi vede l'ordine annullato dal motore, non dal narratore.
    const orderTexts = new Map(state.batchActionIds
      .map(id => [id, this.ctx.orders.queue().find(action => action.id === id)?.text || ''] as const));
    const orderCostSettlement = this.ctx.settleOrderCosts(completion.actionOutcomes, state.batchActionIds, orderTexts);
    for (const order of orderCostSettlement.unfunded) {
      voided.push({ action: order.action, reason: order.reason });
      this.ctx.broadcast('action_voided', {
        turn: this.state.currentTurn,
        action: this.ctx.publicText(order.action),
        reason: order.reason,
        polityName: this.ctx.publicPolityName(this.state.playerPolityId),
      });
    }
    const voidedHeadlines = voided.map(v => `${this.ctx.publicPolityName(this.state.playerPolityId)} non attua la direttiva «${this.ctx.publicText(v.action)}»${v.reason ? `: ${this.ctx.publicText(v.reason)}` : '.'}`);

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
      if (this.ctx.isStrictGame()) applyStagedStrictEffects(this.ctx.gameId, gameRepository.getHeadBranch(this.ctx.gameId)!, gameRepository.getWorldRevision(this.ctx.gameId), completion.effects || []);
      if (completion.worldChanges) this.ctx.applyWorldChanges(completion.worldChanges);
      const polityResolver = this.ctx.buildResolvers().polities;
      for (const change of completion.relationshipChanges) {
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
      // F02 passo 2: la transazione è aperta prima dell’if destinationReached.
      relationshipRepository.upsertForGame(this.ctx.gameId, persistedRelationshipChanges);
      const chatEffects = this.ctx.diplomacy.openSimulationChats(completion.startChat, {
        turn: state.jumpTurn,
        fallbackDate: finalDate,
        simulationId: runId,
        events: appliedRows,
      });
      // GAMEPLAY-LONG: anche il percorso in pausa registra gli impegni del turno.
      this.ctx.recordCommitments({
        startChat: completion.startChat,
        proposals: (completion as { commitments?: unknown }).commitments,
        updates: (completion as { commitmentUpdates?: unknown }).commitmentUpdates,
      });
      chatTimelineEvents.push(...chatEffects.timelineEvents);
      chatBroadcasts.push(...chatEffects.broadcasts);
    }

    // Anche nel playback scaglionato un movimento accettato deve avvenire: se
    // il modello ha omesso `move_unit`, il motore lo completa e lo aggiunge al
    // delta cumulativo del run.
    if (destinationReached) {
      const reconciliationActions = state.batchActionIds
        .map(id => this.ctx.orders.queue().find(action => action.id === id))
        .filter((action): action is PendingAction => !!action);
      for (const region of this.ctx.reconcileAcceptedMoves(reconciliationActions, completion.actionOutcomes || [], state.movementIntents || [], state.movementChanges || [], finalDate)) {
        const snapshot = {
          id: region.id, owner: region.owner, color: region.color, name: region.name,
          population: region.population, gdp: region.gdp, militaryPower: region.militaryPower,
          objects: region.objects,
        };
        const existing = state.changedRegions.find(changed => changed.id === region.id);
        if (existing) Object.assign(existing, snapshot);
        else state.changedRegions.push(snapshot);
      }
      // ARMY-MOVE: anche il percorso in pausa spiega i movimenti non eseguiti.
      for (const note of this.ctx.movementNotices(reconciliationActions, completion.actionOutcomes || [], state.movementIntents || [])) {
        this.state.pendingNationalNotes.push(note);
      }
    }

    // Economia deterministica fino alla data finale effettiva.
    const elapsedDays = Math.round((Date.parse(finalDate) - Date.parse(lastEventDate)) / 86_400_000);
    const bulletins = this.ctx.isStrictGame() || elapsedDays > 0 ? this.ctx.advanceWorldState(elapsedDays, finalDate) : [];
    // Anche a tempo invariato l'avanzamento dei progetti va rinfrescato: un
    // progetto non deve restare senza percentuale leggibile nel Dossier.
    bulletins.push(...this.ctx.refreshProjectProgress(finalDate));
    // La cassa segue le scelte del giocatore: gli ordini che il run ha eseguito
    // vengono regolati nella stessa transazione dell'esito (già calcolati sopra,
    // così gli ordini non finanziabili entrano anche fra i «voided»).
    bulletins.push(...orderCostSettlement.lines);
    // Il punto storico della tesoreria va riscritto dopo la spesa ordinata:
    // altrimenti la serie mostrata dal Dossier ignora le scelte del giocatore.
    if (orderCostSettlement.lines.length > 0) this.ctx.recordAccountSnapshot(finalDate);

    // Record finale: riepilogo tecnico del periodo, non seconda fonte di
    // mutazioni. Gli eventi applicati vivono nei record per-evento.
    const interruptionHeadline = reason === 'paused_budget'
      ? 'Nessun ulteriore sviluppo viene confermato nel periodo'
      : 'La cronaca si arresta alla data scelta dal governo';
    narration = this.ctx.publicText(destinationReached
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
        headline: `${this.ctx.publicPolityName(change.from)} e ${this.ctx.publicPolityName(change.to)} ridefiniscono i rapporti`,
        detail: `Il rapporto diventa ${this.ctx.publicText(change.newRelationship)}: ${this.ctx.publicText(change.reason)}`,
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
    this.state.results.push(finalResult);
    gameRepository.addTurnResult({ ...finalResult, gameId: this.ctx.gameId });

    // Finalizzazione del lotto di ordini: esiti individuali collegati SOLO
    // agli eventi effettivamente applicati del run (§9.2: gli ordini emessi
    // non sono reinviati; un esito parziale resta un processo aperto).
    batchActions = state.batchActionIds
      .map(id => this.ctx.orders.queue().find(action => action.id === id))
      .filter((action): action is PendingAction => !!action);
    const actionRecords: ActionRecord[] = batchActions.map(item => ({
      id: item.id,
      playerId: player.id,
      turn: state.jumpTurn,
      text: item.text,
      createdAt: item.createdAt,
    }));
    this.state.actions.push(...actionRecords);
    actionRecords.forEach(actionRecord => gameRepository.addAction({
      id: actionRecord.id,
      gameId: this.ctx.gameId,
      playerId: player.id,
      turn: actionRecord.turn,
      text: actionRecord.text,
    }));

    runEvents = this.state.results
      .filter(record => record.simulationId === runId)
      .flatMap(record => record.events);
    runEventDetails = this.state.results
      .filter(record => record.simulationId === runId)
      .flatMap(record => record.timelineEvents || []);
    const outcomes = this.ctx.outcomesByActionId(
      batchActions, completion.actionOutcomes, completion.convertedActions,
    );
    const settlementByActionId = new Map<string, OrderSettlementEntry>(
      (orderCostSettlement.entries || []).map((entry: OrderSettlementEntry) => [String(entry.actionId), entry]),
    );
    batchActions.forEach(item => {
      const outcome = outcomes.get(item.id);
      const rejected = voided.find((result: any) => result.action === item.text);
      const outcomeStatus = outcome?.status || (rejected ? 'rejected' : undefined);
      const outcomeSummary = this.ctx.publicText(outcome?.summary || rejected?.reason);
      const outcomeEvents = outcome?.eventHeadlines?.length
        ? outcome.eventHeadlines.map((headline: string) => this.ctx.publicText(headline)).filter((headline: string) => appliedHeadlines.has(headline))
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
        settlement: settlementByActionId.get(item.id),
        turn: state.jumpTurn,
        periodStart: state.periodStart,
        periodEnd: finalDate,
      };
    });
    batchActions.filter(action => action.result?.outcome?.status === 'partial').forEach(action => {
      gameRepository.upsertOngoingProcess({
        id: shortId(),
        gameId: this.ctx.gameId,
        sourceActionId: action.id,
        sourceRunId: runId,
        title: action.text,
        summary: action.result!.outcome!.summary,
        startedDate: state.periodStart,
        expectedDate: action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > state.periodStart
          ? action.result!.outcome!.expectedDate
          : undefined,
        // Avanzamento subito calcolato alla data del commit: un progetto non
        // deve restare senza percentuale leggibile nel Dossier.
        progress: projectProgress(
          state.periodStart,
          action.result!.outcome!.expectedDate && action.result!.outcome!.expectedDate > state.periodStart
            ? action.result!.outcome!.expectedDate
            : null,
          finalDate,
        ),
      });
    });
    batchActions.forEach(action => {
      const outcome = action.result?.outcome;
      if (!outcome?.completesProjectId) return;
      if (outcome.status !== 'accepted'
        || gameRepository.completeOngoingProcessById(this.ctx.gameId, outcome.completesProjectId, outcome.summary, finalDate) !== 1) {
        throw new Error('simulation_protocol_error: completesProjectId is invalid or not accepted');
      }
    });
    gameRepository.addSimulationActionOutcomes(batchActions.map(action => ({
      id: shortId(),
      runId,
      gameId: this.ctx.gameId,
      actionId: action.id,
      status: action.result?.outcome?.status || 'unresolved',
      summary: action.result?.outcome?.summary || action.result?.narration || narration,
      eventHeadlines: action.result?.events || [],
    })));
    gameRepository.removePendingActions(this.ctx.gameId, batchActions.map(action => action.id));
    // Anche la coda in memoria perde gli ordini conclusi: la coda autorevole
    // non deve mostrarli come ancora in elaborazione.
    this.ctx.orders.replaceQueue(this.ctx.orders.queue()
      .filter(action => !batchActions.some(batch => batch.id === action.id)));

    // Data/turno definitivi e checkpoint di chiusura del run. F02 passo 4:
    // CAS sull’ancora pre-commit — un mondo mutato altrove blocca il commit.
    this.state.currentDate = finalDate;
    this.state.interveneRequested = false;
    this.state.pausedRun = null; // prima della cattura: il checkpoint non referenzia più il run
    this.ctx.syncRegionsToDB();
    if (!gameRepository.compareAndSwapTurnAndDate(this.ctx.gameId, anchorTurn, anchorDate, this.state.currentTurn, this.state.currentDate)) {
      throw new Error(`world_anchor_conflict: mondo mutato durante la pausa (atteso turno ${anchorTurn} del ${anchorDate})`);
    }
    const finalCheckpointId = shortId();
    const finalRevision = gameRepository.nextWorldRevision(this.ctx.gameId);
    gameRepository.createSimulationCheckpoint({
      id: finalCheckpointId, runId, gameId: this.ctx.gameId, revision: finalRevision,
      turn: state.jumpTurn, date: finalDate, data: this.ctx.captureCheckpointData(),
    });
    gameRepository.addSimulationEvents(finalTimelineEvents.map(event => ({
      id: event.id,
      runId,
      checkpointId: finalCheckpointId,
      gameId: this.ctx.gameId,
      date: event.date,
      headline: event.headline,
      detail: event.detail,
      source: event.source,
      sourceActionIds: event.sourceActionIds,
    })));
    this.ctx.enqueueOutboxRows(runId, finalCheckpointId, finalRevision, state.jumpTurn, finalTimelineEvents);
    gameRepository.finishSimulationRun(runId, reason, {
      checkpointDate: finalDate,
      checkpointId: finalCheckpointId,
      turn: state.jumpTurn,
    });
      }); // fine transazione canonica (F02 passo 2)
      this.ctx.publishPendingOutbox();
    } catch (e) {
      // F02 passo 4: scarto dello staging — la RAM torna esattamente al
      // checkpoint confermato più recente, coerente con il DB rollbackato.
      this.state.regions = staging.regions;
      this.ctx.diplomacy.replaceFromJSON(staging.relationships);
      this.state.actions = staging.actions;
      this.state.results = staging.results;
      this.ctx.orders.replaceQueue(staging.pendingActions);
      this.state.currentTurn = staging.turn;
      this.state.currentDate = staging.date;
      this.state.interveneRequested = staging.interveneRequested;
      if (this.ctx.isStrictGame()) {
        const pausedFallbackActions = this.ctx.orders.queue().map(action => ({ ...action }));
        this.state.pausedRun = null;
        this.ctx.coordinator.clearActiveRun();
        for (const action of this.ctx.orders.queue()) {
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
            gameRepository.replacePendingActions(this.ctx.gameId, this.ctx.orders.queue());
          });
        } catch (failureError) {
          this.ctx.orders.replaceQueue(pausedFallbackActions);
          this.state.pausedRun = staging.pausedRun;
          console.error('[GameSession] Failed to persist paused-run failure:', failureError);
        }
      } else {
        // Compatibilità legacy: un protocol error mantiene aperto il lettore
        // sul checkpoint confermato, come prima di M06.
        this.state.pausedRun = staging.pausedRun;
      }
      throw e;
    }

    // F02/M06: SSE solo dopo il commit riuscito; il rollback non può pubblicare chat fantasma.
    for (const payload of chatBroadcasts) this.ctx.broadcast('chat_message', payload);
    this.ctx.broadcast('turn_complete', {
      turn: state.jumpTurn,
      narration,
      events: runEvents,
      eventDetails: runEventDetails,
      newTurn: this.state.currentTurn,
      newDate: this.state.currentDate,
      changedRegions: state.changedRegions,
      intervened: reason === 'intervened',
      pausedBudget: reason === 'paused_budget',
    });

    // La consolazione della memoria e il commento del consigliere non devono
    // compromettere un salto già chiuso con successo.
    try {
      await this.ctx.maybeConsolidate();
    } catch (e) {
      console.error('[GameSession] Consolidation failed (turn kept):', e);
    }
    this.ctx.getAdvisorUnchecked(
      'Commenta brevemente (max 500 caratteri) gli esiti del periodo appena trascorso per il tuo leader, in italiano',
      []
    )
      .then(content => this.ctx.broadcast('advisor_proactive', { content }))
      .catch(e => console.error('[GameSession] Proactive advisor failed:', e));

    this.ctx.coordinator.clearActiveRun();
    console.log('[GameSession] §9.3: run scaglionato chiuso:', reason, '— data finale:', this.state.currentDate);
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
      newDate: this.state.currentDate,
      newTurn: this.state.currentTurn,
      destination: destinationReached ? undefined : state.destination,
    };
  }
}
