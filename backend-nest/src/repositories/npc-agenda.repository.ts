/**
 * World Story — Agenda strategica degli NPC (repository)
 * =====================================================
 * Iperscrivibile: ogni revisione di un obiettivo aggiunge una **versione**
 * (`id = objective_key@turno`), non modifica la riga precedente. La strategia
 * corrente è l'ultima versione per `objective_key`; il rewind, che pota le
 * versioni future, fa riemergere da solo lo stato precedente.
 */
import db from '../database';
import type { NpcObjective, NpcObjectiveMeasure, NpcObjectiveStatus, NpcObjectiveType } from '../core/simulation/NpcAgenda';

interface AgendaRow {
  id: string;
  game_id: string;
  branch_id: string;
  objective_key: string;
  polity_id: string;
  type: string;
  target_polity_id: string | null;
  target_region_id: string | null;
  description: string;
  priority: number | string;
  status: string;
  progress: number | string;
  measure: string;
  baseline: number | string | null;
  reason: string;
  created_date: string;
  created_turn: number | string;
  review_date: string;
  reviewed_date: string;
  reviewed_turn: number | string;
}

function rowToObjective(row: AgendaRow): NpcObjective {
  return {
    id: row.objective_key,
    polityId: row.polity_id,
    type: row.type as NpcObjectiveType,
    targetPolityId: row.target_polity_id,
    targetRegionId: row.target_region_id,
    description: row.description ?? '',
    priority: Number(row.priority) || 2,
    status: row.status as NpcObjectiveStatus,
    progress: Number(row.progress) || 0,
    measure: row.measure as NpcObjectiveMeasure,
    baseline: row.baseline === null || row.baseline === undefined ? null : Number(row.baseline),
    reason: row.reason ?? '',
    createdDate: row.created_date,
    createdTurn: Number(row.created_turn) || 0,
    reviewDate: row.review_date,
    reviewedDate: row.reviewed_date,
    reviewedTurn: Number(row.reviewed_turn) || 0,
  };
}

export const npcAgendaRepository = {
  /**
   * Agenda corrente: per ogni istanza (`objective_key`) vale l'ultima versione
   * registrata, ordinata dalla più decisiva.
   */
  list: (gameId: string, options: { polityId?: string; branchId?: string; activeOnly?: boolean } = {}): NpcObjective[] => {
    const branchId = options.branchId ?? 'main';
    const rows = (options.polityId
      ? db.prepare(`
          SELECT * FROM game_npc_agenda
           WHERE game_id = ? AND branch_id = ? AND polity_id = ?
           ORDER BY reviewed_turn DESC, recorded_at DESC, id DESC
        `).all(gameId, branchId, options.polityId)
      : db.prepare(`
          SELECT * FROM game_npc_agenda
           WHERE game_id = ? AND branch_id = ?
           ORDER BY reviewed_turn DESC, recorded_at DESC, id DESC
        `).all(gameId, branchId)) as AgendaRow[];
    const latest = new Map<string, NpcObjective>();
    for (const row of rows) {
      if (!latest.has(row.objective_key)) latest.set(row.objective_key, rowToObjective(row));
    }
    const agenda = [...latest.values()];
    return (options.activeOnly ? agenda.filter(objective => objective.status === 'active') : agenda)
      .sort((a, b) => b.priority - a.priority || a.createdTurn - b.createdTurn || a.type.localeCompare(b.type));
  },

  /** Registra una versione (nascita, revisione, chiusura) di un obiettivo. */
  appendMany: (
    gameId: string,
    objectives: readonly NpcObjective[],
    options: { branchId?: string } = {},
  ): number => {
    if (!Array.isArray(objectives) || objectives.length === 0) return 0;
    const branchId = options.branchId ?? 'main';
    const statement = db.prepare(`
      INSERT OR REPLACE INTO game_npc_agenda
        (id, game_id, branch_id, objective_key, polity_id, type, target_polity_id, target_region_id,
         description, priority, status, progress, measure, baseline, reason,
         created_date, created_turn, review_date, reviewed_date, reviewed_turn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let written = 0;
    const run = db.transaction((list: readonly NpcObjective[]) => {
      for (const objective of list) {
        const result = statement.run(
          `${objective.id}@${objective.reviewedTurn}`, gameId, branchId, objective.id, objective.polityId,
          objective.type, objective.targetPolityId ?? null, objective.targetRegionId ?? null,
          objective.description, objective.priority, objective.status, objective.progress,
          objective.measure, objective.baseline ?? null, objective.reason,
          objective.createdDate, objective.createdTurn, objective.reviewDate,
          objective.reviewedDate, objective.reviewedTurn,
        );
        written += Number(result.changes) || 0;
      }
    });
    run(objectives);
    return written;
  },

  /** Potatura del rewind: le versioni future spariscono, la strategia torna com'era. */
  pruneAfterTurn: (gameId: string, turn: number, options: { branchId?: string } = {}): number => {
    const branchId = options.branchId ?? 'main';
    const result = db.prepare(
      'DELETE FROM game_npc_agenda WHERE game_id = ? AND branch_id = ? AND reviewed_turn > ?',
    ).run(gameId, branchId, turn);
    return Number(result.changes) || 0;
  },

  deleteAll: (gameId: string): number => {
    const result = db.prepare('DELETE FROM game_npc_agenda WHERE game_id = ?').run(gameId);
    return Number(result.changes) || 0;
  },
};
