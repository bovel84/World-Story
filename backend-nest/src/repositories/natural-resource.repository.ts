/**
 * World Story — Natural Resource Ledger Repository
 * ===============================================
 *
 * Riserva, magazzino ed estrazione per risorsa naturale (petrolio, gas, ferro,
 * diamanti, terra fertile…), una riga per partita/polity. È la sola fonte
 * autoritativa delle risorse naturali dinamiche: il client e il modello non
 * possono inventare giacimenti né quantità.
 */

import db from '../database';
import type { ResourceLedger, ResourceNode } from '../core/simulation/ResourceMarket';
import { NATURAL_RESOURCE_KINDS, type NaturalResourceKind } from '../core/simulation/MilitaryIndustry';

export interface NaturalResourceRecord {
  gameId: string;
  polityId: string;
  ledger: ResourceLedger;
  updatedTurn: number;
  updatedDate: string | null;
}

interface NaturalResourceRow {
  game_id: string;
  polity_id: string;
  ledger: string;
  updated_turn: number;
  updated_date: string | null;
}

function parseLedger(raw: string): ResourceLedger {
  try {
    const value = JSON.parse(raw || '{}') as Record<string, Partial<ResourceNode>>;
    const ledger: ResourceLedger = {};
    for (const kind of NATURAL_RESOURCE_KINDS) {
      const node = value?.[kind];
      if (!node) continue;
      const endowment = Number(node.endowment || 0);
      if (!Number.isFinite(endowment) || endowment <= 0) continue;
      const maxReserve = Math.max(0, Number(node.maxReserve || 0));
      ledger[kind as NaturalResourceKind] = {
        endowment,
        maxReserve,
        reserve: Math.max(0, Number(node.reserve ?? maxReserve)),
        stockpile: Math.max(0, Number(node.stockpile || 0)),
        extractedTotal: Math.max(0, Number(node.extractedTotal || 0)),
      };
    }
    return ledger;
  } catch {
    return {};
  }
}

const toRecord = (row: NaturalResourceRow): NaturalResourceRecord => ({
  gameId: row.game_id,
  polityId: row.polity_id,
  ledger: parseLedger(row.ledger),
  updatedTurn: Number(row.updated_turn) || 0,
  updatedDate: row.updated_date ?? null,
});

export const naturalResourceRepository = {
  get: (gameId: string, polityId: string): NaturalResourceRecord | null => {
    const row = db.prepare(
      'SELECT game_id, polity_id, ledger, updated_turn, updated_date FROM game_natural_resources WHERE game_id = ? AND polity_id = ?',
    ).get(gameId, polityId) as NaturalResourceRow | undefined;
    return row ? toRecord(row) : null;
  },

  list: (gameId: string): NaturalResourceRecord[] => {
    const rows = db.prepare(
      'SELECT game_id, polity_id, ledger, updated_turn, updated_date FROM game_natural_resources WHERE game_id = ?',
    ).all(gameId) as NaturalResourceRow[];
    return rows.map(toRecord);
  },

  upsert: (gameId: string, polityId: string, ledger: ResourceLedger, turn: number, date: string | null): void => {
    db.prepare(`
      INSERT INTO game_natural_resources (game_id, polity_id, ledger, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        ledger = excluded.ledger, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `).run(gameId, polityId, JSON.stringify(ledger), turn, date, new Date().toISOString());
  },
};

export default naturalResourceRepository;
