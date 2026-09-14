/**
 * World Story — National Modifiers Repository
 * ==========================================
 *
 * Modificatori persistenti (poi decadenti) che il modello applica alla vita
 * della nazione: stabilità, tensione sociale, sforzo bellico, entrate, crescita.
 * Una riga per partita/polity. È la sola fonte autoritativa: il client non può
 * inventarli e il modello li propone solo tramite `nationalEffects`.
 */

import db from '../database';
import type { NationalModifiers } from '../core/simulation/NationalEffects';
import { EMPTY_MODIFIERS } from '../core/simulation/NationalEffects';

interface ModifierRow {
  game_id: string;
  polity_id: string;
  modifiers: string;
  updated_turn: number;
  updated_date: string | null;
}

function parseModifiers(raw: string): NationalModifiers {
  try {
    const value = JSON.parse(raw || '{}') as Partial<NationalModifiers>;
    const number = (input: unknown, fallback: number) => Number.isFinite(Number(input)) ? Number(input) : fallback;
    return {
      stability: number(value.stability, 0),
      socialTension: number(value.socialTension, 0),
      warEffort: number(value.warEffort, 0),
      revenueMultiplier: number(value.revenueMultiplier, 1),
      growthModifier: number(value.growthModifier, 0),
    };
  } catch {
    return { ...EMPTY_MODIFIERS };
  }
}

export const modifiersRepository = {
  get: (gameId: string, polityId: string): NationalModifiers | null => {
    const row = db.prepare(
      'SELECT game_id, polity_id, modifiers, updated_turn, updated_date FROM game_national_modifiers WHERE game_id = ? AND polity_id = ?',
    ).get(gameId, polityId) as ModifierRow | undefined;
    return row ? parseModifiers(row.modifiers) : null;
  },

  list: (gameId: string): Array<{ polityId: string; modifiers: NationalModifiers }> => {
    const rows = db.prepare(
      'SELECT game_id, polity_id, modifiers, updated_turn, updated_date FROM game_national_modifiers WHERE game_id = ?',
    ).all(gameId) as ModifierRow[];
    return rows.map(row => ({ polityId: row.polity_id, modifiers: parseModifiers(row.modifiers) }));
  },

  upsert: (gameId: string, polityId: string, modifiers: NationalModifiers, turn: number, date: string | null): void => {
    db.prepare(`
      INSERT INTO game_national_modifiers (game_id, polity_id, modifiers, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        modifiers = excluded.modifiers, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `).run(gameId, polityId, JSON.stringify(modifiers), turn, date, new Date().toISOString());
  },
};

export default modifiersRepository;
