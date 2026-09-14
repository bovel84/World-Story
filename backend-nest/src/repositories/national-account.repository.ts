/**
 * World Story — National Account History Repository
 * ================================================
 *
 * Serie storica dei conti nazionali (`WorldStateEngine.accounts`) registrata
 * a ogni tick del mondo. È la sola fonte delle tendenze mostrate nel Dossier
 * Nazione: il client non interpola né inventa punti mancanti.
 *
 * Una riga per (partita, ramo, data di gioco, polity). La chiave primaria
 * deduplica i tick ripetuti sulla stessa data; la potatura conserva solo le
 * date più recenti, così la tabella non cresce senza limite.
 */

import db from '../database';

/** Numero di date storiche conservate per ciascuna polity. */
const MAX_POINTS = 60;

export interface AccountHistoryPoint {
  date: string;
  turn: number;
  account: Record<string, unknown>;
}

interface AccountHistoryRow {
  game_date: string;
  turn: number;
  account: string;
}

export const nationalAccountRepository = {
  /** Registra (o sostituisce) il punto del giorno per la polity indicata. */
  append: (
    gameId: string,
    branchId: string,
    polityId: string,
    turn: number,
    date: string,
    account: Record<string, unknown>,
  ): void => {
    db.prepare(`
      INSERT INTO national_account_history
        (game_id, branch_id, game_date, turn, polity_id, account, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, branch_id, game_date, polity_id)
      DO UPDATE SET turn = excluded.turn, account = excluded.account, recorded_at = excluded.recorded_at
    `).run(gameId, branchId, date, turn, polityId, JSON.stringify(account), new Date().toISOString());
    // Potatura: mantiene solo le date più recenti per questa polity.
    db.prepare(`
      DELETE FROM national_account_history
      WHERE game_id = ? AND branch_id = ? AND polity_id = ?
        AND game_date NOT IN (
          SELECT game_date FROM national_account_history
          WHERE game_id = ? AND branch_id = ? AND polity_id = ?
          ORDER BY game_date DESC LIMIT ?
        )
    `).run(gameId, branchId, polityId, gameId, branchId, polityId, MAX_POINTS);
  },

  /** Punti in ordine cronologico (dal più vecchio al più recente). */
  list: (gameId: string, branchId: string, polityId: string, limit = MAX_POINTS): AccountHistoryPoint[] => {
    const rows = db.prepare(`
      SELECT game_date, turn, account FROM national_account_history
      WHERE game_id = ? AND branch_id = ? AND polity_id = ?
      ORDER BY game_date DESC
      LIMIT ?
    `).all(gameId, branchId, polityId, Math.max(2, Math.min(limit, MAX_POINTS))) as AccountHistoryRow[];
    return rows.reverse().flatMap((row) => {
      try {
        const account = JSON.parse(row.account) as Record<string, unknown>;
        return [{ date: row.game_date, turn: Number(row.turn), account }];
      } catch {
        return [];
      }
    });
  },
};

export default nationalAccountRepository;
