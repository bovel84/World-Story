/**
 * World Story — Production Order Repository
 * ========================================
 *
 * Ordini di produzione militare con percentuale di completamento. Una riga per
 * ordine: è la sola fonte autoritativa dell'avanzamento (il modello non può
 * dichiarare completato ciò che il motore non ha finito).
 */

import db from '../database';
import type { ProductionOrder } from '../core/simulation/MilitaryProduction';
import { DOMAIN_MONTHS } from '../core/simulation/MilitaryProduction';

interface ProductionRow {
  game_id: string;
  order_id: string;
  data: string;
  recorded_at: string;
}

function parseOrder(raw: string): ProductionOrder | null {
  try {
    const value = JSON.parse(raw || '{}') as Partial<ProductionOrder>;
    if (!value.id || !value.equipmentId) return null;
    return {
      id: String(value.id),
      equipmentId: String(value.equipmentId),
      name: String(value.name || value.equipmentId),
      domain: (value.domain && value.domain in DOMAIN_MONTHS ? value.domain : 'terra') as ProductionOrder['domain'],
      quantity: Math.max(1, Math.floor(Number(value.quantity) || 1)),
      progress: Math.max(0, Math.min(100, Number(value.progress) || 0)),
      spentMln: Math.max(0, Number(value.spentMln) || 0),
      startedTurn: Math.max(0, Number(value.startedTurn) || 0),
      startedDate: String(value.startedDate || ''),
      status: value.status === 'completed' || value.status === 'failed' ? value.status : 'in_progress',
      note: String(value.note || ''),
      qualityLoss: Math.max(0, Math.min(40, Number(value.qualityLoss) || 0)),
      updatedDate: String(value.updatedDate || value.startedDate || ''),
      facilityId: value.facilityId ? String(value.facilityId) : null,
    };
  } catch {
    return null;
  }
}

export const productionRepository = {
  list: (gameId: string): ProductionOrder[] => {
    const rows = db.prepare(
      'SELECT game_id, order_id, data, recorded_at FROM game_production_orders WHERE game_id = ? ORDER BY order_id',
    ).all(gameId) as ProductionRow[];
    return rows.map(row => parseOrder(row.data)).filter((order): order is ProductionOrder => Boolean(order));
  },

  upsert: (gameId: string, order: ProductionOrder): void => {
    db.prepare(`
      INSERT INTO game_production_orders (game_id, order_id, data, recorded_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id, order_id) DO UPDATE SET
        data = excluded.data, recorded_at = excluded.recorded_at
    `).run(gameId, order.id, JSON.stringify(order), new Date().toISOString());
  },

  remove: (gameId: string, orderId: string): void => {
    db.prepare('DELETE FROM game_production_orders WHERE game_id = ? AND order_id = ?').run(gameId, orderId);
  },
};

export default productionRepository;
