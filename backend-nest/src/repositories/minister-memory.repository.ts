/**
 * WS-MINISTER-UX-05 — Memoria del ministro (repository)
 * ====================================================
 * La persistenza reale della memoria conversazionale, separata dai numeri del
 * mondo. Righe **per scope** (partita, ramo, sedia, mandato): aggiornabili per
 * chiave, copiate al fork, potate al rewind.
 *
 * Additivo e retrocompatibile: la tabella `minister_memory` è nuova, i
 * salvataggi precedenti non hanno memoria e i flussi esistenti restano identici
 * (con memoria vuota ogni operazione è un no-op).
 *
 * Confine: qui vive **solo** la memoria del ministro. Nessun numero di gioco,
 * nessun riferimento a entità di simulazione.
 */
import db from '../database';
import type {
  CabinetSeat,
} from '../core/government/Cabinet';
import type {
  MinisterMemoryKind,
  MinisterMemoryRecord,
  MinisterMemoryRef,
  MinisterMemoryState,
} from '../core/government/MinisterMemory';

/** Lo scope completo di un ricordo: identifica chi ricorda, dove e in che mandato. */
export interface MinisterMemoryScope {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly seat: CabinetSeat;
  readonly mandate: string;
}

/** Lo scope di ramo: per le operazioni che valgono per tutte le sedie. */
export interface MinisterMemoryBranchScope {
  readonly gameId: string;
  readonly branchId: string | null;
}

interface MemoryRow {
  game_id: string;
  branch_id: string;
  seat: string;
  mandate: string;
  record_id: string;
  kind: string;
  state: string;
  summary: string;
  reason: string | null;
  refs_json: string;
  record_date: string;
  record_turn: number | null;
}

/** `null` è il ramo principale: la colonna usa `''` per non rompere la PK. */
function branchOf(branchId: string | null | undefined): string {
  return branchId ?? '';
}

function parseRefs(raw: string): MinisterMemoryRef {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as MinisterMemoryRef;
  } catch { /* refs corrotti: si legge quel che si può */ }
  return { gameDate: '' };
}

function rowToRecord(row: MemoryRow): MinisterMemoryRecord {
  const refs = parseRefs(row.refs_json);
  return {
    id: row.record_id,
    kind: row.kind as MinisterMemoryKind,
    state: row.state as MinisterMemoryState,
    summary: row.summary,
    ...(row.reason ? { reason: row.reason } : {}),
    refs: {
      ...refs,
      gameDate: refs.gameDate || row.record_date || '',
      ...(row.record_turn != null ? { turn: Number(row.record_turn) } : {}),
    },
  };
}

export const ministerMemoryRepository = {
  /** I ricordi di una sedia, dal più vecchio al più recente.
   *
   * WS-GOVUX-P6 — L'ordine è il **tempo del mondo** (data, poi turno), mai il
   * `updated_at` tecnico: una decisione resta al suo turno anche quando viene
   * aggiornata (eseguita, revocata). `record_id` chiude i pareggi in modo
   * deterministico; il timestamp non entra nell'ordine. */
  listMemory: (scope: MinisterMemoryScope): MinisterMemoryRecord[] => {
    const rows = db.prepare(`
      SELECT * FROM minister_memory
       WHERE game_id = ? AND branch_id = ? AND seat = ? AND mandate = ?
       ORDER BY record_date ASC, record_turn ASC, record_id ASC
    `).all(scope.gameId, branchOf(scope.branchId), scope.seat, scope.mandate) as MemoryRow[];
    return rows.map(rowToRecord);
  },

  /** Tutti i ricordi di un ramo, di ogni sedia e mandato (per fork/potatura/test).
   * Stesso ordine di `listMemory`: tempo del mondo, non timestamp tecnico. */
  listBranch: (scope: MinisterMemoryBranchScope): MinisterMemoryRecord[] => {
    const rows = db.prepare(`
      SELECT * FROM minister_memory
       WHERE game_id = ? AND branch_id = ?
       ORDER BY seat ASC, record_date ASC, record_turn ASC, record_id ASC
    `).all(scope.gameId, branchOf(scope.branchId)) as MemoryRow[];
    return rows.map(rowToRecord);
  },

  /**
   * Registra o aggiorna i ricordi dello scope. Idempotente per `record_id`:
   * lo stesso ricordo aggiorna stato/motivo invece di duplicare la voce.
   */
  upsertRecords: (scope: MinisterMemoryScope, records: readonly MinisterMemoryRecord[]): number => {
    if (!Array.isArray(records) || records.length === 0) return 0;
    const statement = db.prepare(`
      INSERT INTO minister_memory
        (game_id, branch_id, seat, mandate, record_id, kind, state, summary, reason, refs_json, record_date, record_turn, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (game_id, branch_id, seat, mandate, record_id) DO UPDATE SET
        kind = excluded.kind,
        state = excluded.state,
        summary = excluded.summary,
        reason = excluded.reason,
        refs_json = excluded.refs_json,
        record_date = excluded.record_date,
        record_turn = excluded.record_turn,
        updated_at = CURRENT_TIMESTAMP
    `);
    let written = 0;
    const run = db.transaction((list: readonly MinisterMemoryRecord[]) => {
      for (const record of list) {
        const result = statement.run(
          scope.gameId, branchOf(scope.branchId), scope.seat, scope.mandate, record.id,
          record.kind, record.state, record.summary, record.reason ?? null,
          JSON.stringify(record.refs), record.refs.gameDate || '', record.refs.turn ?? null,
        );
        written += Number(result.changes) || 0;
      }
    });
    run(records);
    return written;
  },

  /**
   * Il fork: i ricordi di un ramo si copiano sul nuovo, con la nuova identità di
   * ramo. `INSERT OR IGNORE` rende il fork idempotente (un ramo già popolato non
   * viene duplicato).
   */
  forkMemory: (scope: MinisterMemoryBranchScope, toBranchId: string): number => {
    const result = db.prepare(`
      INSERT OR IGNORE INTO minister_memory
        (game_id, branch_id, seat, mandate, record_id, kind, state, summary, reason, refs_json, record_date, record_turn, updated_at)
      SELECT game_id, ?, seat, mandate, record_id, kind, state, summary, reason, refs_json, record_date, record_turn, updated_at
        FROM minister_memory
       WHERE game_id = ? AND branch_id = ?
    `).run(toBranchId, scope.gameId, branchOf(scope.branchId));
    return Number(result.changes) || 0;
  },

  /**
   * La potatura al rewind: si cancellano i ricordi **oltre** il punto di
   * ripristino (per turno, e per data quando il turno manca). Una decisione
   * futura non resta nel passato.
   */
  pruneAfter: (scope: MinisterMemoryBranchScope, cutoff: { turn?: number; gameDate?: string }): number => {
    const clauses: string[] = [];
    const params: Array<string | number> = [scope.gameId, branchOf(scope.branchId)];
    if (cutoff.turn != null) {
      clauses.push('(record_turn IS NOT NULL AND record_turn > ?)');
      params.push(cutoff.turn);
    }
    if (cutoff.gameDate) {
      clauses.push("(record_date <> '' AND record_date > ?)");
      params.push(cutoff.gameDate);
    }
    if (clauses.length === 0) return 0;
    const result = db.prepare(
      `DELETE FROM minister_memory WHERE game_id = ? AND branch_id = ? AND (${clauses.join(' OR ')})`,
    ).run(...params);
    return Number(result.changes) || 0;
  },

  /** Dimentica ogni memoria di una partita (partita nuova / reset). */
  deleteGameMemory: (gameId: string): number => {
    const result = db.prepare('DELETE FROM minister_memory WHERE game_id = ?').run(gameId);
    return Number(result.changes) || 0;
  },
};
