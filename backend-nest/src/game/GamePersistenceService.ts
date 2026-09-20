/**
 * World Story — GamePersistenceService
 * ====================================
 * Persistenza di basso livello di una partita, estratta da `game-session.ts`
 * (Fase 1, punto 3).
 *
 * Contiene:
 *  - i **salvataggi** nella tabella `saves` (snapshot manuali e lo snapshot
 *    `__rewind__`) e il relativo hash semantico;
 *  - la **lettura/consumo** dello snapshot di rewind (l'orchestrazione del
 *    rewind resta in `GameSession`, perché applica stato e broadcast);
 *  - il **codec del playback in pausa** (`PausedRunState`): validazione e
 *    normalizzazione dello stato serializzato in `simulation_runs`.
 *
 * Il servizio NON possiede lo stato di gioco: lo riceve tramite
 * `ctx.captureState()` (snapshot) e ne conosce solo l'ID partita.
 */

import db, { withCanonicalTransaction } from '../database';
import { shortId } from '../utils/short-id';
import { semanticStateHash } from '../domain/semantic-hash';
import { gameRepository, chatRepository, operationalObjectRepository, arsenalRepository } from '../repositories';
import { invalidateStrictEffectStaging, restoreEconomicSnapshot, validateEconomicSnapshot } from '../repositories/economy-snapshot.repository';
import { normalizeDifficulty, type Difficulty } from '../prompts/difficulty';
import type { StrictEffect } from '../core/simulation/EffectValidator';
import type { RelationshipMap } from '../core/RelationshipMatrix';
import type { PendingAction } from './OrderExecutionService';
import type { TurnResultRecord } from './TimelineService';
import type { SaveData, PausedRunState, PlayerInfo, RegionState, ActionRecord } from '../game-session';
import type { CrisisSnapshot } from '../repositories';

/**
 * Stato applicabile di una sessione: le 13 grandezze che il restore tocca in
 * RAM. Il servizio lo calcola e lo consegna a `GameSession` tramite
 * `applyState`; la cattura per il rollback usa lo stesso tipo.
 */
export interface PersistenceApplyState {
  currentTurn: number;
  currentDate: string;
  players: PlayerInfo[];
  /** `undefined` = non toccare le regioni correnti. */
  regions?: Map<string, RegionState>;
  relationships: RelationshipMap | undefined;
  actions: ActionRecord[];
  results: TurnResultRecord[];
  consolidatedHistory: string;
  consolidatedUpTo: number;
  difficulty: Difficulty;
  interveneRequested: boolean;
  pendingActions: PendingAction[];
  pausedRun: PausedRunState | null;
}

export interface PersistenceContext {
  readonly gameId: string;
  /** Snapshot serializzabile dello stato corrente della sessione. */
  captureState(): SaveData;
  /** Turno corrente: fallback nel codec dei run in pausa. */
  currentTurn(): number;

  // ── Restore (loadFromSave): lettura/scrittura dello stato in RAM ──
  isStrictGame(): boolean;
  /** Cattura dello stato per lo staging di rollback. */
  captureApplyState(): PersistenceApplyState;
  /** Scrive lo stato in RAM (forward e rollback). */
  applyState(state: PersistenceApplyState): void;
  /** Ripristina taxRatePct ed ending nella fase di commit (come l'originale). */
  prepareRestore(): void;
  /** Sincronizza le regioni ripristinate sul DB. */
  syncRegionsToDB(): void;
  /**
   * Effetti post-restore riuscito: crisi riportata al punto del checkpoint e
   * sfide di pace riallineate al nuovo presente.
   */
  afterRestore(restored?: { crisis?: CrisisSnapshot | null }): void;
}

export class GamePersistenceService {
  constructor(private readonly ctx: PersistenceContext) {}

  // ── Salvataggi ──────────────────────────────────────────────────────────

  /** Salva lo stato della sessione nella tabella `saves`. */
  save(name?: string): { saveId: string; currentTurn: number; currentDate: string } {
    const saveId = shortId();
    const saveData = this.ctx.captureState();
    this.insertSave(saveId, name || `Game ${new Date().toLocaleDateString()}`, saveData);

    console.log('[GameSession] Saved:', saveId, 'turn:', saveData.currentTurn);
    return { saveId, currentTurn: saveData.currentTurn, currentDate: saveData.currentDate };
  }

  private insertSave(id: string, name: string, saveData: SaveData): void {
    db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.ctx.gameId,
      name,
      saveData.currentTurn,
      saveData.currentDate,
      JSON.stringify(saveData),
      semanticStateHash(saveData),
      new Date().toISOString(),
    );
  }

  /**
   * F04 §9.4.1: hash semantico dello stato corrente, calcolato con la stessa
   * funzione del salvataggio (usato dal DoD del restore C12).
   */
  semanticHash(): string {
    return semanticStateHash(this.ctx.captureState());
  }

  // ── Rewind ──────────────────────────────────────────────────────────────

  /**
   * Snapshot prima del turno — base del rewind. Vive in `saves` sotto il nome
   * riservato `__rewind__`; se ne conserva uno solo (l'ultimo) per partita.
   */
  saveRewindSnapshot(): void {
    const saveData = this.ctx.captureState();
    const id = shortId();
    db.prepare(`
      INSERT INTO saves (id, game_id, name, current_turn, current_date, data, content_hash, saved_at)
      VALUES (?, ?, '__rewind__', ?, ?, ?, ?, ?)
    `).run(
      id,
      this.ctx.gameId,
      saveData.currentTurn,
      saveData.currentDate,
      JSON.stringify(saveData),
      semanticStateHash(saveData),
      new Date().toISOString(),
    );

    // Conserva soltanto l'ultimo snapshot di rewind.
    db.prepare("DELETE FROM saves WHERE game_id = ? AND name = '__rewind__' AND id != ?").run(this.ctx.gameId, id);
  }

  /** C'è un rewind disponibile? (per la UI) */
  canRewind(): boolean {
    const row = db.prepare(
      "SELECT 1 FROM saves WHERE game_id = ? AND name = '__rewind__' LIMIT 1"
    ).get(this.ctx.gameId);
    return !!row;
  }

  /** Ultimo snapshot di rewind (`{ id, saveData, hash }`) o `null`. */
  latestRewindSnapshot(): { id: string; saveData: SaveData; hash?: string } | null {
    const row = db.prepare(
      "SELECT * FROM saves WHERE game_id = ? AND name = '__rewind__' ORDER BY saved_at DESC LIMIT 1"
    ).get(this.ctx.gameId) as any;
    if (!row) return null;

    try {
      return { id: row.id, saveData: JSON.parse(row.data) as SaveData, hash: row.content_hash ?? undefined };
    } catch (e) {
      console.error('[GameSession] Rewind: snapshot corrotto:', e);
      return null;
    }
  }

  /** Consuma lo snapshot: un secondo rewind consecutivo non è più possibile. */
  consumeRewindSnapshot(id: string): void {
    db.prepare('DELETE FROM saves WHERE id = ?').run(id);
  }

  // ── Restore (loadFromSave) ──────────────────────────────────────────────

  /**
   * Ripristina la sessione da uno snapshot. F04 §9.4.1: con `expectedHash`
   * lo snapshot è validato PRIMA di mutare la sessione; un hash incompatibile
   * rifiuta il restore. Tutte le collezioni sono ripristinate in UNA
   * transazione canonica; un errore a metà scarta lo staging RAM + DB.
   */
  loadFromSave(
    saveData: SaveData,
    expectedHash?: string | null,
    options?: { newBranch?: { originCheckpointId?: string | null; name?: string } },
  ): { branchId: string | null } {
    const gameId = this.ctx.gameId;
    const strict = this.ctx.isStrictGame();
    const strictBranchId = strict
      ? (gameRepository.getHeadBranch(gameId) || gameRepository.ensureMainBranch(gameId))
      : null;
    if (expectedHash != null && semanticStateHash(saveData) !== expectedHash) {
      if (strictBranchId) invalidateStrictEffectStaging(strictBranchId);
      throw new Error(`snapshot_hash_mismatch: lo snapshot non corrisponde al catalogo (atteso ${expectedHash.slice(0, 12)}…)`);
    }
    if (strict) {
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
    const staging = this.ctx.captureApplyState();
    try {
      // F04 passo 2: tutte le collezioni ripristinate in UNA transazione
      // (coda, ordini processing, relazioni, chat, processi, mondo), e il
      // ramo nuovo con il suo fencing token nella stessa transazione.
      withCanonicalTransaction(() => {
        const next: PersistenceApplyState = {
          currentTurn: saveData.currentTurn,
          currentDate: saveData.currentDate,
          players: saveData.players || [],
          // Restore regions (solo se lo snapshot le contiene)
          regions: saveData.regions ? new Map(saveData.regions) : undefined,
          relationships: saveData.relationships ?? staging.relationships,
          // Этап 2: история, консолидация, сложность (без них rewind терял контекст)
          actions: saveData.actions || [],
          results: saveData.results || [],
          consolidatedHistory: saveData.consolidatedHistory || '',
          consolidatedUpTo: saveData.consolidatedUpTo || 0,
          difficulty: normalizeDifficulty(saveData.difficulty),
          interveneRequested: false,
          // La coda appartiene al ramo salvato: ripristinala invece di perderla.
          // §9.3: gli ordini «processing» del playback sospeso tornano insieme
          // al loro run; il ramo che non li possiede più non li vede affatto.
          pendingActions: (saveData.pendingActions || [])
            .filter(action => action.status === 'pending' || action.status === 'processing'),
          // §12/§9.3: il run in pausa del ramo ripristinato continua a esistere.
          pausedRun: this.revivePausedRun(saveData.pausedSimulationId),
        };
        this.ctx.applyState(next);
        this.ctx.prepareRestore();

        // MILITARY/WARFRONT INTEGRITY P0-1: gli oggetti persistenti sono stato
        // del ramo. Semantica **REPLACE ALL FOR GAME**: l'insieme del
        // checkpoint sostituisce quello della partita (un fronte o un reparto
        // creati nel futuro **spariscono**, uno cancellato **ritorna**).
        //
        // Compatibilità: `operationalState === undefined` = salvataggio
        // precedente a questo campo → non si tocca nulla. `{ version: 1,
        // rows: [] }` è invece un fatto e si applica (ramo senza oggetti).
        if (saveData.operationalState) {
          operationalObjectRepository.replaceAll(gameId, saveData.operationalState.rows || []);
        }
        // P5 — arsenali e dotazioni assegnate devono tornare allo stesso
        // checkpoint. `undefined` conserva la compatibilità dei save legacy.
        if (saveData.arsenalState) {
          arsenalRepository.replaceAll(gameId, saveData.arsenalState.rows || []);
        }

        // Ogni altro run sospeso del ramo scartato è invalidato.
        if (!next.pausedRun) gameRepository.interruptPausedRuns(gameId);
        gameRepository.replacePendingActions(gameId, next.pendingActions);
        // Vecchi salvataggi senza chats restano compatibili e non cancellano le
        // conversazioni; i nuovi checkpoint ripristinano invece il ramo esatto.
        if (saveData.chats) chatRepository.replaceGameChats(gameId, saveData.chats);
        if (saveData.ongoingProcesses) gameRepository.replaceOngoingProcesses(gameId, saveData.ongoingProcesses);

        // Update game in DB
        gameRepository.updateTurnAndDate(gameId, next.currentTurn, next.currentDate);
        gameRepository.updateConsolidation(gameId, next.consolidatedHistory, next.consolidatedUpTo);
        gameRepository.replaceHistory(gameId, next.actions, next.results);

        // Sync restored regions to DB
        this.ctx.syncRegionsToDB();

        // F04 passo 4: lo storico del ramo abbandonato resta solo nell’archivio
        // privato. Le righe outbox pendenti appartengono al futuro scartato:
        // vengono archiviate (mai ripubblicate) nella stessa transazione.
        gameRepository.archivePendingOutbox(gameId);

        // F04 passo 2: il restore crea un ramo figlio con origin nel checkpoint
        // ripristinato (fencing token nuovo); il ramo abbandonato resta in
        // archivio (game_branches) e non entra mai nei prompt del ramo nuovo.
        if (options?.newBranch) {
          gameRepository.createBranch({
            id: shortId(),
            gameId,
            name: options.newBranch.name || `restore-${saveData.currentDate}`,
            parentBranchId: gameRepository.getHeadBranch(gameId),
            originCheckpointId: options.newBranch.originCheckpointId ?? null,
          });
        }
        const economicsRestored = restoreEconomicSnapshot(
          gameId,
          gameRepository.getHeadBranch(gameId) || gameRepository.ensureMainBranch(gameId),
          saveData.economicState,
        );
        if (strict && !economicsRestored) throw new Error('strict_economic_snapshot_missing: restore strict richiede stato economico verificabile');
      });
    } catch (e) {
      this.ctx.applyState(staging);
      if (this.ctx.isStrictGame()) {
        const branchId = gameRepository.getHeadBranch(gameId);
        if (branchId) invalidateStrictEffectStaging(branchId);
      }
      throw e;
    }
    // Dopo il commit (e dopo l'eventuale apertura del nuovo ramo) la crisi torna
    // esattamente al punto del checkpoint salvato. Un salvataggio precedente a
    // questa versione non contiene lo stato di crisi: per lui non si scrive nulla.
    this.ctx.afterRestore({ crisis: saveData.crisis });
    console.log('[GameSession] Loaded from save, turn:', saveData.currentTurn);
    return { branchId: gameRepository.getHeadBranch(gameId) };
  }

  // ── Codec del playback in pausa ─────────────────────────────────────────
  /** Ricostruisce il run in pausa dalla riga DB `simulation_runs`. */
  revivePausedRun(pausedSimulationId?: string): PausedRunState | null {
    if (!pausedSimulationId) return null;
    const row = db.prepare(
      'SELECT id, status, pending_state FROM simulation_runs WHERE id = ? AND game_id = ?'
    ).get(pausedSimulationId, this.ctx.gameId) as any;
    if (!row || row.status !== 'awaiting_next' || !row.pending_state) return null;
    let parsed: any = null;
    try { parsed = JSON.parse(row.pending_state); } catch { return null; }
    return this.revivePausedRunState(parsed);
  }

  /** Ricostruisce il run in pausa da una riga già letta (`pendingState`). */
  revivePausedRunFromRow(row: any): PausedRunState | null {
    if (!row?.pendingState) return null;
    const raw = typeof row.pendingState === 'string'
      ? (() => { try { return JSON.parse(row.pendingState); } catch { return null; } })()
      : row.pendingState;
    return this.revivePausedRunState(raw);
  }

  /** Codec puro: valida e normalizza lo stato serializzato di un run. */
  revivePausedRunState(raw: any): PausedRunState | null {
    const fallbackTurn = this.ctx.currentTurn();
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
        jumpTurn: Number.isInteger(raw.jumpTurn) ? raw.jumpTurn : fallbackTurn,
        revisionBase: Number.isInteger(raw.revisionBase) ? raw.revisionBase : fallbackTurn + 1,
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
}
