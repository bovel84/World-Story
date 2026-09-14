/**
 * World Story — Material Resource Stock Repository
 * ================================================
 *
 * Persistenza del magazzino materiale (`MaterialEconomy`): una riga per
 * partita/polity. Le scorte sono la sola fonte autoritativa di cibo,
 * vestiario, armamenti, carburante, denaro, ricerca e tecnologie; nessun
 * valore viene inventato dal client o dal modello.
 */

import db from '../database';
import { normalizeStock, type ResourceStock } from '../core/simulation/MaterialEconomy';

export interface ResourceStockRecord {
  gameId: string;
  polityId: string;
  stock: ResourceStock;
  updatedTurn: number;
  updatedDate: string | null;
}

interface ResourceRow {
  game_id: string;
  polity_id: string;
  stock: string;
  updated_turn: number;
  updated_date: string | null;
}

const toRecord = (row: ResourceRow): ResourceStockRecord => ({
  gameId: row.game_id,
  polityId: row.polity_id,
  stock: normalizeStock(JSON.parse(row.stock || '{}')),
  updatedTurn: Number(row.updated_turn) || 0,
  updatedDate: row.updated_date ?? null,
});

export const resourceRepository = {
  get: (gameId: string, polityId: string): ResourceStockRecord | null => {
    const row = db.prepare(
      'SELECT game_id, polity_id, stock, updated_turn, updated_date FROM game_resource_stocks WHERE game_id = ? AND polity_id = ?',
    ).get(gameId, polityId) as ResourceRow | undefined;
    return row ? toRecord(row) : null;
  },

  list: (gameId: string): ResourceStockRecord[] => {
    const rows = db.prepare(
      'SELECT game_id, polity_id, stock, updated_turn, updated_date FROM game_resource_stocks WHERE game_id = ?',
    ).all(gameId) as ResourceRow[];
    return rows.map(toRecord);
  },

  upsert: (gameId: string, polityId: string, stock: ResourceStock, turn: number, date: string | null): void => {
    db.prepare(`
      INSERT INTO game_resource_stocks (game_id, polity_id, stock, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        stock = excluded.stock, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `).run(gameId, polityId, JSON.stringify(stock), turn, date, new Date().toISOString());
  },
};

export default resourceRepository;
