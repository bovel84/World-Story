/**
 * World Story — Military Arsenal Repository
 * =========================================
 *
 * Quantità possedute per voce del catalogo militare (terra, aria, mare,
 * missili, droni), una riga per partita/polity. È la sola fonte autoritativa
 * dell'arsenale: il client e il modello non possono inventare armamenti.
 */

import db from '../database';

export interface ArsenalRecord {
  gameId: string;
  polityId: string;
  units: Record<string, number>;
  updatedTurn: number;
  updatedDate: string | null;
}

interface ArsenalRow {
  game_id: string;
  polity_id: string;
  units: string;
  updated_turn: number;
  updated_date: string | null;
}

function parseUnits(raw: string): Record<string, number> {
  try {
    const value = JSON.parse(raw || '{}') as Record<string, unknown>;
    const units: Record<string, number> = {};
    for (const [id, quantity] of Object.entries(value || {})) {
      const count = Math.floor(Number(quantity));
      if (Number.isFinite(count) && count > 0) units[id] = count;
    }
    return units;
  } catch {
    return {};
  }
}

const toRecord = (row: ArsenalRow): ArsenalRecord => ({
  gameId: row.game_id,
  polityId: row.polity_id,
  units: parseUnits(row.units),
  updatedTurn: Number(row.updated_turn) || 0,
  updatedDate: row.updated_date ?? null,
});

export const arsenalRepository = {
  get: (gameId: string, polityId: string): ArsenalRecord | null => {
    const row = db.prepare(
      'SELECT game_id, polity_id, units, updated_turn, updated_date FROM game_arsenals WHERE game_id = ? AND polity_id = ?',
    ).get(gameId, polityId) as ArsenalRow | undefined;
    return row ? toRecord(row) : null;
  },

  list: (gameId: string): ArsenalRecord[] => {
    const rows = db.prepare(
      'SELECT game_id, polity_id, units, updated_turn, updated_date FROM game_arsenals WHERE game_id = ?',
    ).all(gameId) as ArsenalRow[];
    return rows.map(toRecord);
  },

  upsert: (gameId: string, polityId: string, units: Record<string, number>, turn: number, date: string | null): void => {
    db.prepare(`
      INSERT INTO game_arsenals (game_id, polity_id, units, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        units = excluded.units, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `).run(gameId, polityId, JSON.stringify(units), turn, date, new Date().toISOString());
  },
};

export default arsenalRepository;
