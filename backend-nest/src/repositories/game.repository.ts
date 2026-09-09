/**
 * World Story — Game Repository
 * ==========================
 */

import db from '../database';
import { worldRepository } from './world.repository';
import { semanticStateHash } from '../domain/semantic-hash';
import { randomUUID } from 'node:crypto';

function bumpQueueVersion(gameId: string): void {
  db.prepare('UPDATE games SET queue_version = queue_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(gameId);
}

export interface PlayerRecord {
  id: string;
  name: string;
  regionId: string;
  color: string;
  polityId?: string;
}

export const gameRepository = {
  // ── F04 §9.4: rami di mondo ───────────────────────────────────────────────

  /**
   * Ramo principale di una partita: creato alla prima apertura, idempotente.
   * L’id del ramo è il fencing token delle operazioni che catturano ramo e
   * revisione prima di scrivere.
   */
  ensureMainBranch: (gameId: string): string => {
    const row = db.prepare('SELECT head_branch_id FROM games WHERE id = ?').get(gameId) as { head_branch_id?: string } | undefined;
    if (row?.head_branch_id) return row.head_branch_id;
    const branchId = randomUUID();
    db.prepare(`
      INSERT INTO game_branches (id, game_id, name, parent_branch_id, origin_checkpoint_id, created_at)
      VALUES (?, ?, 'main', NULL, NULL, ?)
    `).run(branchId, gameId, new Date().toISOString());
    db.prepare('UPDATE games SET head_branch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(branchId, gameId);
    return branchId;
  },

  getEconomyMode: (gameId: string): 'legacy' | 'strict' => {
    const row = db.prepare('SELECT economy_mode FROM games WHERE id = ?').get(gameId) as { economy_mode?: string } | undefined;
    return row?.economy_mode === 'strict' ? 'strict' : 'legacy';
  },

  getHeadBranch: (gameId: string): string | null => {
    const row = db.prepare('SELECT head_branch_id FROM games WHERE id = ?').get(gameId) as { head_branch_id?: string } | undefined;
    return row?.head_branch_id ?? null;
  },

  createBranch: (branch: { id: string; gameId: string; name: string; parentBranchId?: string | null; originCheckpointId?: string | null }) => {
    db.prepare(`
      INSERT INTO game_branches (id, game_id, name, parent_branch_id, origin_checkpoint_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(branch.id, branch.gameId, branch.name, branch.parentBranchId ?? null, branch.originCheckpointId ?? null, new Date().toISOString());
    db.prepare('UPDATE games SET head_branch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(branch.id, branch.gameId);
    return branch;
  },

  getQueueVersion: (gameId: string): number => {
    const row = db.prepare('SELECT queue_version FROM games WHERE id = ?').get(gameId) as { queue_version?: number } | undefined;
    return Number(row?.queue_version || 0);
  },

  // F02: revisione canonica del mondo — contatore monotono per partita. Ogni
  // checkpoint lo incrementa di una volta; mai uguale, mai decrescente.
  nextWorldRevision: (gameId: string): number => {
    return db.transaction(() => {
      db.prepare('UPDATE games SET world_revision = world_revision + 1 WHERE id = ?').run(gameId);
      const row = db.prepare('SELECT world_revision FROM games WHERE id = ?').get(gameId) as { world_revision?: number } | undefined;
      return Number(row?.world_revision || 0);
    })();
  },

  // F04 passo 3: lettura pura della revisione corrente per il fencing delle
  // risposte chat/advisor (cattura all'inizio, verifica prima della scrittura).
  getWorldRevision: (gameId: string): number => {
    const row = db.prepare('SELECT world_revision FROM games WHERE id = ?').get(gameId) as { world_revision?: number } | undefined;
    return Number(row?.world_revision || 0);
  },

  getGameRegions: (gameId: string) => {
    const rows = db.prepare(`
      SELECT region_id, owner, color, population, gdp, military_power, objects
      FROM game_regions WHERE game_id = ?
    `).all(gameId) as any[];
    return rows.map(row => ({
      id: row.region_id,
      owner: row.owner,
      color: row.color,
      population: Number(row.population),
      gdp: Number(row.gdp),
      militaryPower: Number(row.military_power),
      objects: (() => { try { return JSON.parse(row.objects || '[]'); } catch { return []; } })(),
    }));
  },

  upsertGameRegions: (gameId: string, regions: Array<{
    id: string; owner: string; color: string; population: number; gdp: number; militaryPower: number; objects: any[];
  }>) => {
    const upsert = db.prepare(`
      INSERT INTO game_regions (game_id, region_id, owner, color, population, gdp, military_power, objects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, region_id) DO UPDATE SET
        owner = excluded.owner, color = excluded.color, population = excluded.population,
        gdp = excluded.gdp, military_power = excluded.military_power, objects = excluded.objects
    `);
    db.transaction((items: typeof regions) => items.forEach(region => upsert.run(
      gameId, region.id, region.owner, region.color, region.population,
      region.gdp, region.militaryPower, JSON.stringify(region.objects || []),
    )))(regions);
  },

  create: (game: { id: string; worldId: string; currentTurn?: number; maxTurns?: number; status?: string; difficulty?: string; economyMode?: 'legacy' | 'strict'; economyModelVersion?: string | null }) => {
    const stmt = db.prepare(`
      INSERT INTO games (id, world_id, current_turn, max_turns, status, difficulty, economy_mode, economy_model_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      game.id,
      game.worldId,
      game.currentTurn || 1,
      game.maxTurns || 100,
      game.status || 'playing',
      game.difficulty || 'normal',
      game.economyMode || 'legacy',
      game.economyModelVersion ?? null
    );
    return game;
  },

  findById: (id: string) => {
    const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    const world = worldRepository.findById(row.world_id);
    const players = gameRepository.getPlayers(id);

    return {
      ...row,
      world,
      players,
    };
  },

  getPlayers: (gameId: string): PlayerRecord[] => {
    const stmt = db.prepare('SELECT * FROM players WHERE game_id = ?');
    const rows = stmt.all(gameId) as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      regionId: row.region_id,
      color: row.color,
      polityId: row.polity_id || undefined,
    }));
  },

  addPlayer: (player: { id: string; gameId: string; name: string; regionId: string; color?: string; polityId?: string }) => {
    const stmt = db.prepare(`
      INSERT INTO players (id, game_id, name, region_id, color, polity_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(player.id, player.gameId, player.name, player.regionId, player.color || '#FF0000', player.polityId || null);
    return player;
  },

  addAction: (action: { id: string; gameId: string; playerId: string; turn: number; text: string }) => {
    const stmt = db.prepare(`
      INSERT INTO actions (id, game_id, player_id, turn, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(action.id, action.gameId, action.playerId, action.turn, action.text);
    return action;
  },

  createSimulationRun: (run: {
    id: string; gameId: string; mode: 'auto' | 'fixed'; startDate: string; targetDate?: string; idempotencyKey?: string;
  }) => {
    db.prepare(`
      INSERT INTO simulation_runs (id, game_id, mode, idempotency_key, status, start_date, target_date, created_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(run.id, run.gameId, run.mode, run.idempotencyKey || null, run.startDate, run.targetDate || null, new Date().toISOString());
    return run;
  },

  finishSimulationRun: (id: string, status: 'completed' | 'no_event' | 'failed' | 'intervened' | 'interrupted' | 'paused_budget', data: {
    checkpointDate?: string; checkpointId?: string; turn?: number; error?: string;
  } = {}) => {
    db.prepare(`
      UPDATE simulation_runs
      SET status = ?, checkpoint_date = ?, checkpoint_id = ?, turn = ?, error = ?, completed_at = ?
      WHERE id = ?
    `).run(
      status, data.checkpointDate || null, data.checkpointId || null,
      data.turn ?? null, data.error || null, new Date().toISOString(), id,
    );
    // Un run terminato non ha più proposte in sospeso: il playback «un evento
    // alla volta» è chiuso e il resto del salto non è più autorizzabile.
    db.prepare('UPDATE simulation_runs SET pending_state = NULL WHERE id = ?').run(id);
  },

  /** §9.3: un salto fisso si ferma dopo il checkpoint di un evento, con le
   * proposte successive persistite per la conferma esplicita del giocatore. */
  pauseSimulationRun: (id: string, data: {
    checkpointDate: string; checkpointId: string; turn: number; pendingState: unknown;
  }) => {
    db.prepare(`
      UPDATE simulation_runs
      SET status = 'awaiting_next', checkpoint_date = ?, checkpoint_id = ?, turn = ?, pending_state = ?, completed_at = NULL
      WHERE id = ?
    `).run(data.checkpointDate, data.checkpointId, data.turn, JSON.stringify(data.pendingState), id);
  },

  /** Ricostruisce un playback in pausa dopo un riavvio del backend. */
  getPausedSimulationRun: (gameId: string) => {
    const row = db.prepare(`
      SELECT id, mode, start_date, target_date, checkpoint_date, checkpoint_id, turn, pending_state
      FROM simulation_runs
      WHERE game_id = ? AND status = 'awaiting_next'
      ORDER BY created_at DESC LIMIT 1
    `).get(gameId) as any || null;
    if (!row?.pending_state) return null;
    let pendingState: any = null;
    try { pendingState = JSON.parse(row.pending_state); } catch { pendingState = null; }
    if (!pendingState) return null;
    return {
      runId: row.id,
      mode: row.mode,
      startDate: row.start_date,
      targetDate: row.target_date,
      checkpointDate: row.checkpoint_date,
      checkpointId: row.checkpoint_id,
      turn: row.turn != null ? Number(row.turn) : undefined,
      pendingState,
    };
  },

  /** §12: load/rewind/restore invalidano i run sospesi del ramo scartato. */
  interruptPausedRuns: (gameId: string, keepRunId?: string) => {
    db.prepare(`
      UPDATE simulation_runs
      SET status = 'interrupted', completed_at = ?, pending_state = NULL
      WHERE game_id = ? AND status IN ('awaiting_next', 'paused_budget') AND id != ?
    `).run(new Date().toISOString(), gameId, keepRunId || '');
  },

  createSimulationCheckpoint: (checkpoint: {
    id: string; runId: string; gameId: string; revision: number; turn: number; date: string; data: unknown;
  }) => {
    db.prepare(`
      INSERT INTO simulation_checkpoints (id, run_id, game_id, revision, turn, game_date, data, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id, checkpoint.runId, checkpoint.gameId, checkpoint.revision,
      checkpoint.turn, checkpoint.date, JSON.stringify(checkpoint.data),
      // F04 §9.4.1: hash semantico committato con il checkpoint.
      semanticStateHash(checkpoint.data), new Date().toISOString(),
    );
    return checkpoint;
  },

  getSimulationCheckpoint: (gameId: string, checkpointId: string) => {
    return db.prepare('SELECT * FROM simulation_checkpoints WHERE game_id = ? AND id = ?')
      .get(gameId, checkpointId) as any || null;
  },

  addSimulationEvents: (events: Array<{
    id: string; runId: string; checkpointId: string; gameId: string; date: string;
    headline: string; detail: string; source: string; sourceActionIds?: string[];
  }>) => {
    if (!events.length) return;
    const insert = db.prepare(`
      INSERT INTO simulation_events
        (id, run_id, checkpoint_id, game_id, game_date, headline, detail, source, source_action_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction((records: typeof events) => records.forEach(event => insert.run(
      event.id, event.runId, event.checkpointId, event.gameId, event.date,
      event.headline, event.detail, event.source, JSON.stringify(event.sourceActionIds || []),
    )))(events);
  },

  getSimulationEvents: (gameId: string, runId: string) => {
    const rows = db.prepare(`
      SELECT id, checkpoint_id, game_date, headline, detail, source, source_action_ids
      FROM simulation_events WHERE game_id = ? AND run_id = ? ORDER BY game_date, rowid
    `).all(gameId, runId) as any[];
    return rows.map(row => ({
      id: row.id,
      checkpointId: row.checkpoint_id,
      date: row.game_date,
      headline: row.headline,
      detail: row.detail,
      source: row.source,
      sourceActionIds: (() => { try { return JSON.parse(row.source_action_ids || '[]'); } catch { return []; } })(),
    }));
  },

  addSimulationActionOutcomes: (outcomes: Array<{
    id: string; runId: string; gameId: string; actionId: string;
    status: 'accepted' | 'partial' | 'rejected' | 'unresolved'; summary: string; eventHeadlines: string[];
  }>) => {
    if (!outcomes.length) return;
    const insert = db.prepare(`
      INSERT INTO simulation_action_outcomes (id, run_id, game_id, action_id, status, summary, event_headlines)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction((records: typeof outcomes) => records.forEach(outcome => insert.run(
      outcome.id, outcome.runId, outcome.gameId, outcome.actionId,
      outcome.status, outcome.summary, JSON.stringify(outcome.eventHeadlines),
    )))(outcomes);
  },

  getSimulationActionOutcomes: (gameId: string, runId: string) => {
    const rows = db.prepare(`
      SELECT id, action_id, status, summary, event_headlines
      FROM simulation_action_outcomes WHERE game_id = ? AND run_id = ? ORDER BY rowid
    `).all(gameId, runId) as any[];
    return rows.map(row => ({
      id: row.id,
      actionId: row.action_id,
      status: row.status,
      summary: row.summary,
      eventHeadlines: (() => { try { return JSON.parse(row.event_headlines || '[]'); } catch { return []; } })(),
    }));
  },

  // F02 passo 4: CAS sull’ancora del mondo. Il commit scrive solo se il DB
  // è ancora nello stato atteso (turno/data letti dalla RAM prima del lavoro);
  // un writer esterno fa fallire il commit invece di farsi sovrascrivere.
  // NB: "current_date" va quotato — è anche una keyword SQLite.
  compareAndSwapTurnAndDate: (gameId: string, expectedTurn: number, expectedDate: string, turn: number, date: string): boolean => {
    const result = db.prepare(`
      UPDATE games SET current_turn = ?, "current_date" = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND current_turn = ? AND "current_date" = ?
    `).run(turn, date, gameId, expectedTurn, expectedDate);
    return Number(result.changes) === 1;
  },

  // F02 passo 3: outbox degli eventi — scritto nella STESSA transazione
  // canonica degli eventi, pubblicato solo dopo il commit, con ID stabili.
  enqueueOutbox: (rows: { id: string; gameId: string; runId: string; eventId: string; payload: unknown }[]) => {
    if (!rows.length) return;
    const insert = db.prepare(`
      INSERT INTO simulation_outbox (id, game_id, run_id, event_id, sequence, payload, delivery_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    const nextSeq = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS s FROM simulation_outbox WHERE game_id = ?');
    for (const row of rows) {
      const sequence = Number((nextSeq.get(row.gameId) as { s: number }).s);
      insert.run(row.id, row.gameId, row.runId, row.eventId, sequence, JSON.stringify(row.payload), new Date().toISOString());
    }
  },

  pendingOutbox: (gameId: string, limit = 200) => {
    return db.prepare(`
      SELECT id, event_id, sequence, payload
      FROM simulation_outbox WHERE game_id = ? AND delivery_state = 'pending'
      ORDER BY sequence LIMIT ?
    `).all(gameId, limit) as Array<{ id: string; event_id: string; sequence: number; payload: string }>;
  },

  markOutboxPublished: (gameId: string, ids: string[]) => {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE simulation_outbox SET delivery_state = 'published', published_at = ?
      WHERE game_id = ? AND id IN (${placeholders}) AND delivery_state = 'pending'
    `).run(new Date().toISOString(), gameId, ...ids);
  },

  // F04 passo 4: lo storico del ramo abbandonato resta solo nell’archivio
  // privato — le righe outbox pendenti al restore non vengono ripubblicate
  // (§9.4.1: un solo messaggio pubblico di branch replacement, mai republish
  // dello storico). Le righe restano consultabili come audit privato.
  archivePendingOutbox: (gameId: string): number => {
    const result = db.prepare(`
      UPDATE simulation_outbox SET delivery_state = 'published', published_at = ?
      WHERE game_id = ? AND delivery_state = 'pending'
    `).run(new Date().toISOString(), gameId);
    return Number(result.changes || 0);
  },

  // ── F05 µ1: job asincroni del salto ────────────────────────────────────

  createJob: (job: { id: string; gameId: string; type: string; payloadJson: string; payloadHash: string; idempotencyKey?: string }) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO simulation_jobs (id, game_id, type, status, payload_json, payload_hash, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    `).run(job.id, job.gameId, job.type, job.payloadJson, job.payloadHash, job.idempotencyKey || null, now, now);
    return job;
  },

  getJob: (id: string) => {
    return db.prepare('SELECT * FROM simulation_jobs WHERE id = ?').get(id) as any || null;
  },

  findJobByIdempotencyKey: (gameId: string, idempotencyKey: string) => {
    return db.prepare('SELECT * FROM simulation_jobs WHERE game_id = ? AND idempotency_key = ?').get(gameId, idempotencyKey) as any || null;
  },

  updateJobStatus: (id: string, status: 'queued' | 'running' | 'completed' | 'failed', data: {
    leaseOwner?: string; leaseExpiresAt?: string; runId?: string | null; error?: string | null; errorName?: string | null; resultJson?: string | null;
  } = {}) => {
    db.prepare(`
      UPDATE simulation_jobs
      SET status = ?, lease_owner = COALESCE(?, lease_owner), lease_expires_at = COALESCE(?, lease_expires_at),
          run_id = COALESCE(?, run_id), error = ?, error_name = COALESCE(?, error_name), result_json = COALESCE(?, result_json), updated_at = ?
      WHERE id = ?
    `).run(status, data.leaseOwner || null, data.leaseExpiresAt || null, data.runId || null, data.error || null, data.errorName || null, data.resultJson || null, new Date().toISOString(), id);
  },

  nextQueuedJob: () => {
    return db.prepare("SELECT * FROM simulation_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as any || null;
  },

  /** Claim atomico del lease: vince solo il worker che scrive da 'queued'. */
  claimJob: (id: string, owner: string, leaseExpiresAt: string): boolean => {
    const result = db.prepare(`
      UPDATE simulation_jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(owner, leaseExpiresAt, new Date().toISOString(), id);
    return Number(result.changes) === 1;
  },

  expiredRunningJobs: (nowIso: string) => {
    return db.prepare(`
      SELECT * FROM simulation_jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
    `).all(nowIso) as any[];
  },

  /** F05 passo 4: lease scaduta → paused_recovery all'ultimo checkpoint.
   * Nessuna seconda chiamata pagata automaticamente per «recuperare». */
  markRunPausedRecovery: (runId: string, error?: string) => {
    db.prepare(`
      UPDATE simulation_runs
      SET status = 'paused_recovery', pending_state = NULL, error = ?, completed_at = NULL
      WHERE id = ? AND status = 'running'
    `).run(error || null, runId);
  },

  latestRunningRun: (gameId: string) => {
    return db.prepare(`
      SELECT id, status, start_date FROM simulation_runs
      WHERE game_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1
    `).get(gameId) as any || null;
  },

  getJobByRunId: (runId: string) => {
    return db.prepare('SELECT * FROM simulation_jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId) as any || null;
  },

  /** F05 µ2: heartbeat del lease, con fencing sul proprietario. */
  renewJobLease: (id: string, owner: string, leaseExpiresAt: string): boolean => {
    const result = db.prepare(`
      UPDATE simulation_jobs SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(leaseExpiresAt, new Date().toISOString(), id, owner);
    return Number(result.changes) === 1;
  },

  upsertOngoingProcess: (process: {
    id: string; gameId: string; sourceActionId: string; sourceRunId: string;
    title: string; summary: string; startedDate: string; expectedDate?: string;
  }) => {
    db.prepare(`
      INSERT INTO ongoing_processes
        (id, game_id, source_action_id, source_run_id, title, summary, status, started_date, expected_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ongoing', ?, ?, ?)
      ON CONFLICT(game_id, source_action_id) DO UPDATE SET
        summary = excluded.summary, expected_date = excluded.expected_date, updated_at = excluded.updated_at
    `).run(
      process.id, process.gameId, process.sourceActionId, process.sourceRunId,
      process.title, process.summary, process.startedDate, process.expectedDate || null, new Date().toISOString(),
    );
  },

  getOngoingProcesses: (gameId: string) => {
    return db.prepare(`
      SELECT id, source_action_id, source_run_id, title, summary, status, started_date, expected_date, updated_at
      FROM ongoing_processes WHERE game_id = ? AND status = 'ongoing' ORDER BY updated_at DESC
    `).all(gameId) as any[];
  },

  snapshotOngoingProcesses: (gameId: string) => {
    return db.prepare(`
      SELECT id, source_action_id, source_run_id, title, summary, status, started_date, expected_date, updated_at
      FROM ongoing_processes WHERE game_id = ? ORDER BY rowid
    `).all(gameId) as any[];
  },

  replaceOngoingProcesses: (gameId: string, processes: any[]) => {
    db.transaction(() => {
      db.prepare('DELETE FROM ongoing_processes WHERE game_id = ?').run(gameId);
      const insert = db.prepare(`
        INSERT INTO ongoing_processes
          (id, game_id, source_action_id, source_run_id, title, summary, status, started_date, expected_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      processes.forEach(process => insert.run(
        process.id, gameId, process.source_action_id, process.source_run_id,
        process.title, process.summary, process.status, process.started_date,
        process.expected_date || null, process.updated_at,
      ));
    })();
  },

  /** Chiude soltanto il progetto canonico indicato dall'outcome. */
  completeOngoingProcessById: (gameId: string, projectId: string, summary: string) => {
    return db.prepare(`
      UPDATE ongoing_processes
      SET status = 'completed', summary = ?, updated_at = ?
      WHERE game_id = ? AND id = ? AND status = 'ongoing'
    `).run(summary, new Date().toISOString(), gameId, projectId).changes;
  },

  getSimulationRun: (gameId: string, runId: string) => {
    return db.prepare('SELECT * FROM simulation_runs WHERE game_id = ? AND id = ?').get(gameId, runId) as any || null;
  },

  getLatestSimulationRun: (gameId: string) => {
    return db.prepare('SELECT * FROM simulation_runs WHERE game_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(gameId) as any || null;
  },

  getSimulationRunByIdempotencyKey: (gameId: string, idempotencyKey: string) => {
    return db.prepare('SELECT * FROM simulation_runs WHERE game_id = ? AND idempotency_key = ?')
      .get(gameId, idempotencyKey) as any || null;
  },

  queuePendingAction: (action: { id: string; gameId: string; text: string; createdAt: string; status?: string }) => {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO pending_actions (id, game_id, text, created_at, status, delivery_status, execution_status)
        VALUES (?, ?, ?, ?, 'pending', 'queued', 'not_started')
      `).run(action.id, action.gameId, action.text, action.createdAt);
      bumpQueueVersion(action.gameId);
    })();
    return action;
  },

  getPendingActions: (gameId: string) => {
    const rows = db.prepare(`
      SELECT id, text, created_at, status, delivery_status, execution_status
      FROM pending_actions
      WHERE game_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(gameId) as any[];
    return rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      status: row.status,
      deliveryStatus: row.delivery_status,
      executionStatus: row.execution_status,
    }));
  },

  updatePendingActionStatus: (gameId: string, actionIds: string[], status: 'pending' | 'processing') => {
    if (!actionIds.length) return;
    const placeholders = actionIds.map(() => '?').join(', ');
    const next = status === 'processing'
      ? { delivery: 'issued', execution: 'in_progress' }
      : { delivery: 'queued', execution: 'not_started' };
    db.transaction(() => {
      const result = db.prepare(`
        UPDATE pending_actions
        SET status = ?, delivery_status = ?, execution_status = ?
        WHERE game_id = ? AND id IN (${placeholders})
          AND (status <> ? OR delivery_status <> ? OR execution_status <> ?)
      `).run(
        status, next.delivery, next.execution, gameId, ...actionIds,
        status, next.delivery, next.execution,
      );
      if (result.changes) bumpQueueVersion(gameId);
    })();
  },

  removePendingAction: (gameId: string, actionId: string): boolean => {
    let removed = false;
    db.transaction(() => {
      removed = db.prepare('DELETE FROM pending_actions WHERE game_id = ? AND id = ?').run(gameId, actionId).changes > 0;
      if (removed) bumpQueueVersion(gameId);
    })();
    return removed;
  },

  /** Aggiorna il testo di un ordine ancora in coda (non ancora preso in carico). */
  updatePendingActionText: (gameId: string, actionId: string, text: string): boolean => {
    let updated = false;
    db.transaction(() => {
      updated = db.prepare('UPDATE pending_actions SET text = ? WHERE game_id = ? AND id = ? AND status = ?')
        .run(text, gameId, actionId, 'pending').changes > 0;
      if (updated) bumpQueueVersion(gameId);
    })();
    return updated;
  },

  removePendingActions: (gameId: string, actionIds: string[]) => {
    if (!actionIds.length) return;
    const placeholders = actionIds.map(() => '?').join(', ');
    db.transaction(() => {
      const result = db.prepare(`DELETE FROM pending_actions WHERE game_id = ? AND id IN (${placeholders})`)
        .run(gameId, ...actionIds);
      if (result.changes) bumpQueueVersion(gameId);
    })();
  },

  replacePendingActions: (gameId: string, actions: Array<{
    id: string; text: string; createdAt: string; status: string;
    deliveryStatus?: string; executionStatus?: string;
  }>) => {
    db.transaction(() => {
      db.prepare('DELETE FROM pending_actions WHERE game_id = ?').run(gameId);
      const insert = db.prepare(`
        INSERT INTO pending_actions (id, game_id, text, created_at, status, delivery_status, execution_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      actions.filter(action => action.status === 'pending' || action.status === 'processing').forEach(action => {
        const processing = action.status === 'processing';
        insert.run(
          action.id, gameId, action.text, action.createdAt, action.status,
          action.deliveryStatus || (processing ? 'issued' : 'queued'),
          action.executionStatus || (processing ? 'in_progress' : 'not_started'),
        );
      });
      bumpQueueVersion(gameId);
    })();
  },

  addTurnResult: (result: { id: string; gameId: string; turn: number; narration: string; countryResponse: string; events?: string[]; timelineEvents?: any[]; date?: string }) => {
    const stmt = db.prepare(`
      INSERT INTO turn_results (id, game_id, turn, narration, country_response, events, timeline_events, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      result.id,
      result.gameId,
      result.turn,
      result.narration,
      result.countryResponse,
      JSON.stringify(result.events || []),
      JSON.stringify(result.timelineEvents || []),
      result.date || null
    );
    return result;
  },

  /** Cronaca dei turni dal DB (ricostruzione sessione / Timeline). */
  getResultsByGame: (gameId: string) => {
    const rows = db.prepare('SELECT * FROM turn_results WHERE game_id = ? ORDER BY turn ASC, rowid ASC').all(gameId) as any[];
    return rows.map(r => {
      let events: string[] = [];
      let timelineEvents: any[] = [];
      try { events = JSON.parse(r.events || '[]'); } catch { events = []; }
      try { timelineEvents = JSON.parse(r.timeline_events || '[]'); } catch { timelineEvents = []; }
      return {
        id: r.id,
        turn: r.turn,
        narration: r.narration || '',
        countryResponse: r.country_response || '',
        events,
        timelineEvents,
        date: r.date || undefined,
      };
    });
  },

  /**
   * Pagina la cronaca persistita oltre il turno indicato (§10.1 `?after=`).
   * Legge da `turn_results`, quindi gli eventi sopravvivono a refresh, riavvio
   * e consolidazione della memoria: il registro non è limitato agli ultimi N.
   */
  getTimelinePage: (gameId: string, afterTurn: number, limit: number): { rows: any[]; hasMore: boolean } => {
    const rows = db.prepare(
      'SELECT * FROM turn_results WHERE game_id = ? AND turn > ? ORDER BY turn ASC, rowid ASC LIMIT ?'
    ).all(gameId, afterTurn, limit + 1) as any[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(r => {
      let events: string[] = [];
      let timelineEvents: any[] = [];
      try { events = JSON.parse(r.events || '[]'); } catch { events = []; }
      try { timelineEvents = JSON.parse(r.timeline_events || '[]'); } catch { timelineEvents = []; }
      return {
        id: r.id,
        turn: r.turn,
        narration: r.narration || '',
        countryResponse: r.country_response || '',
        events,
        timelineEvents,
        date: r.date || undefined,
      };
    });
    return { rows: page, hasMore };
  },

  updateTurn: (gameId: string, turn: number) => {
    const stmt = db.prepare('UPDATE games SET current_turn = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(turn, gameId);
  },

  updateDate: (gameId: string, date: string) => {
    const stmt = db.prepare('UPDATE games SET current_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(date, gameId);
  },

  /**
   * Combined update for turn and date in a single statement
   */
  updateTurnAndDate: (gameId: string, turn: number, date: string) => {
    const stmt = db.prepare('UPDATE games SET current_turn = ?, current_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(turn, date, gameId);
  },

  /** Этап 2: сохранить консолидированную историю (саммари старых раундов). */
  updateConsolidation: (gameId: string, history: string, upToTurn: number) => {
    const stmt = db.prepare('UPDATE games SET consolidated_history = ?, consolidated_up_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(history, upToTurn, gameId);
  },

  /** Sostituisce la cronaca persistita quando si carica un ramo salvato. */
  replaceHistory: (
    gameId: string,
    actions: { id: string; playerId: string; turn: number; text: string; createdAt?: string }[],
    results: { id: string; turn: number; narration: string; countryResponse: string; events?: string[]; timelineEvents?: any[]; date?: string }[],
  ) => {
    db.transaction(() => {
      db.prepare('DELETE FROM actions WHERE game_id = ?').run(gameId);
      db.prepare('DELETE FROM turn_results WHERE game_id = ?').run(gameId);
      const actionStmt = db.prepare(`
        INSERT INTO actions (id, game_id, player_id, turn, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const action of actions) {
        actionStmt.run(action.id, gameId, action.playerId, action.turn, action.text, action.createdAt || new Date().toISOString());
      }
      const resultStmt = db.prepare(`
        INSERT INTO turn_results
          (id, game_id, turn, narration, country_response, events, timeline_events, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const result of results) {
        resultStmt.run(
          result.id,
          gameId,
          result.turn,
          result.narration,
          result.countryResponse,
          JSON.stringify(result.events || []),
          JSON.stringify(result.timelineEvents || []),
          result.date || null,
        );
      }
    })();
  },

  /** Этап 2 (rewind): удалить действия и результаты ходов новее указанного. */
  deleteAfterTurn: (gameId: string, turn: number) => {
    db.prepare('DELETE FROM actions WHERE game_id = ? AND turn > ?').run(gameId, turn);
    db.prepare('DELETE FROM turn_results WHERE game_id = ? AND turn > ?').run(gameId, turn);
  },
};
