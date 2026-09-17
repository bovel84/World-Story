/**
 * World Story — Registro degli impegni (repository)
 * ================================================
 * Versioni append-only: `id` distingue la versione, `commitment_id` l'impegno.
 * Lo stato corrente è l'ultima versione; il rewind, potando le versioni future,
 * riporta il registro a com'era.
 */
import db from '../database';
import type { Commitment, CommitmentStatus, CommitmentType } from '../core/simulation/Commitments';

interface CommitmentRow {
  id: string;
  game_id: string;
  branch_id: string;
  commitment_key: string;
  commitment_id: string;
  type: string;
  actor: string;
  counterparty: string | null;
  description: string;
  importance: number | string;
  status: string;
  created_date: string;
  created_turn: number | string;
  deadline: string | null;
  source_event_id: string | null;
  note: string;
  updated_date: string;
  updated_turn: number | string;
}

function rowToCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.commitment_id,
    type: row.type as CommitmentType,
    actor: row.actor,
    counterparty: row.counterparty,
    description: row.description ?? '',
    createdDate: row.created_date,
    createdTurn: Number(row.created_turn) || 0,
    status: row.status as CommitmentStatus,
    deadline: row.deadline,
    sourceEventId: row.source_event_id,
    importance: Number(row.importance) || 2,
    updatedDate: row.updated_date,
    updatedTurn: Number(row.updated_turn) || 0,
    note: row.note ?? '',
  };
}

export const commitmentRepository = {
  /** Registro corrente: per ogni impegno vale l'ultima versione. */
  list: (gameId: string, options: { branchId?: string; status?: CommitmentStatus } = {}): Commitment[] => {
    const branchId = options.branchId ?? 'main';
    const rows = db.prepare(`
      SELECT * FROM game_commitments
       WHERE game_id = ? AND branch_id = ?
       ORDER BY updated_turn DESC, recorded_at DESC, id DESC
    `).all(gameId, branchId) as CommitmentRow[];
    const latest = new Map<string, Commitment>();
    for (const row of rows) {
      if (!latest.has(row.commitment_id)) latest.set(row.commitment_id, rowToCommitment(row));
    }
    const all = [...latest.values()];
    return (options.status ? all.filter(item => item.status === options.status) : all)
      .sort((a, b) => b.importance - a.importance || b.createdTurn - a.createdTurn || a.id.localeCompare(b.id));
  },

  /** Scrive una nuova versione di ogni impegno indicato. */
  appendMany: (
    gameId: string,
    commitments: readonly Commitment[],
    options: { branchId?: string } = {},
  ): number => {
    if (!Array.isArray(commitments) || commitments.length === 0) return 0;
    const branchId = options.branchId ?? 'main';
    const statement = db.prepare(`
      INSERT OR REPLACE INTO game_commitments
        (id, game_id, branch_id, commitment_key, commitment_id, type, actor, counterparty,
         description, importance, status, created_date, created_turn, deadline, source_event_id,
         note, updated_date, updated_turn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let written = 0;
    const run = db.transaction((list: readonly Commitment[]) => {
      for (const commitment of list) {
        const result = statement.run(
          `${commitment.id}@${commitment.updatedTurn}`, gameId, branchId,
          `${commitment.actor}|${commitment.counterparty ?? 'interno'}|${commitment.type}`,
          commitment.id, commitment.type, commitment.actor, commitment.counterparty ?? null,
          commitment.description, commitment.importance, commitment.status,
          commitment.createdDate, commitment.createdTurn, commitment.deadline ?? null,
          commitment.sourceEventId ?? null, commitment.note, commitment.updatedDate, commitment.updatedTurn,
        );
        written += Number(result.changes) || 0;
      }
    });
    run(commitments);
    return written;
  },

  /** Potatura del rewind. */
  pruneAfterTurn: (gameId: string, turn: number, options: { branchId?: string } = {}): number => {
    const branchId = options.branchId ?? 'main';
    const result = db.prepare(
      'DELETE FROM game_commitments WHERE game_id = ? AND branch_id = ? AND updated_turn > ?',
    ).run(gameId, branchId, turn);
    return Number(result.changes) || 0;
  },

  deleteAll: (gameId: string): number => {
    const result = db.prepare('DELETE FROM game_commitments WHERE game_id = ?').run(gameId);
    return Number(result.changes) || 0;
  },
};
