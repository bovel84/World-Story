/**
 * Open-Pax — Game Repository
 * ==========================
 */

import db from '../database';
import { worldRepository } from './world.repository';

export interface PlayerRecord {
  id: string;
  name: string;
  regionId: string;
  color: string;
  polityId?: string;
}

export const gameRepository = {
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

  create: (game: { id: string; worldId: string; currentTurn?: number; maxTurns?: number; status?: string; difficulty?: string }) => {
    const stmt = db.prepare(`
      INSERT INTO games (id, world_id, current_turn, max_turns, status, difficulty)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      game.id,
      game.worldId,
      game.currentTurn || 1,
      game.maxTurns || 100,
      game.status || 'playing',
      game.difficulty || 'normal'
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

  finishSimulationRun: (id: string, status: 'completed' | 'no_event' | 'failed' | 'intervened', data: {
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
  },

  createSimulationCheckpoint: (checkpoint: {
    id: string; runId: string; gameId: string; revision: number; turn: number; date: string; data: unknown;
  }) => {
    db.prepare(`
      INSERT INTO simulation_checkpoints (id, run_id, game_id, revision, turn, game_date, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id, checkpoint.runId, checkpoint.gameId, checkpoint.revision,
      checkpoint.turn, checkpoint.date, JSON.stringify(checkpoint.data), new Date().toISOString(),
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
    status: 'accepted' | 'partial' | 'rejected'; summary: string; eventHeadlines: string[];
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

  completeOngoingProcessForAction: (gameId: string, actionText: string, summary: string) => {
    return db.prepare(`
      UPDATE ongoing_processes
      SET status = 'completed', summary = ?, updated_at = ?
      WHERE game_id = ? AND title = ? AND status = 'ongoing'
    `).run(summary, new Date().toISOString(), gameId, actionText).changes;
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
    db.prepare(`
      INSERT INTO pending_actions (id, game_id, text, created_at, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(action.id, action.gameId, action.text, action.createdAt, action.status || 'pending');
    return action;
  },

  getPendingActions: (gameId: string) => {
    const rows = db.prepare(`
      SELECT id, text, created_at, status
      FROM pending_actions
      WHERE game_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(gameId) as any[];
    return rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      // A process cannot survive a backend restart: make it safely retryable.
      status: row.status === 'processing' ? 'pending' : row.status,
    }));
  },

  updatePendingActionStatus: (gameId: string, actionIds: string[], status: 'pending' | 'processing') => {
    if (!actionIds.length) return;
    const placeholders = actionIds.map(() => '?').join(', ');
    db.prepare(`UPDATE pending_actions SET status = ? WHERE game_id = ? AND id IN (${placeholders})`)
      .run(status, gameId, ...actionIds);
  },

  removePendingAction: (gameId: string, actionId: string): boolean => {
    return db.prepare('DELETE FROM pending_actions WHERE game_id = ? AND id = ?').run(gameId, actionId).changes > 0;
  },

  /** Aggiorna il testo di un ordine ancora in coda (non ancora preso in carico). */
  updatePendingActionText: (gameId: string, actionId: string, text: string): boolean => {
    return db.prepare('UPDATE pending_actions SET text = ? WHERE game_id = ? AND id = ? AND status = ?')
      .run(text, gameId, actionId, 'pending').changes > 0;
  },

  removePendingActions: (gameId: string, actionIds: string[]) => {
    if (!actionIds.length) return;
    const placeholders = actionIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM pending_actions WHERE game_id = ? AND id IN (${placeholders})`)
      .run(gameId, ...actionIds);
  },

  replacePendingActions: (gameId: string, actions: { id: string; text: string; createdAt: string; status: string }[]) => {
    db.transaction(() => {
      db.prepare('DELETE FROM pending_actions WHERE game_id = ?').run(gameId);
      const insert = db.prepare(`
        INSERT INTO pending_actions (id, game_id, text, created_at, status)
        VALUES (?, ?, ?, ?, ?)
      `);
      actions.filter(action => action.status === 'pending').forEach(action => {
        insert.run(action.id, gameId, action.text, action.createdAt, 'pending');
      });
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
