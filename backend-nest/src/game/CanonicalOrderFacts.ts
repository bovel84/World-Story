/** Read-only adapter for trusted order guards. Do not use getRegions here:
 * its legacy hydration can write geographic objects during a preflight read.
 * Execution supplies the live canonical region map instead of reloading it.
 */
import db from '../database';
import { operationalObjectRepository } from '../repositories/operational-object.repository';
import type { CanonicalOrderRegion, CanonicalOrderWorld } from '../core/feasibility/CanonicalOrderSafety';

function regionsFromRows(rows: Array<{ id: string; name: string; owner: string; objects: string }>): CanonicalOrderRegion[] {
  return rows.map(row => {
    const objects: unknown = JSON.parse(row.objects || '[]');
    if (!Array.isArray(objects)) throw new Error('order_reality_data_unavailable: invalid canonical region objects');
    return { id: row.id, name: row.name, owner: row.owner, objects };
  });
}

export function readCanonicalOrderWorld(gameId: string, worldId: string, liveRegions?: Iterable<CanonicalOrderRegion>): CanonicalOrderWorld {
  // The DYNAMIC copy of the game (game_regions) is the canonical reality: the
  // world template rows stay frozen while constructions are delivered.
  const live = db.prepare(
    'SELECT gr.region_id AS id, COALESCE(wr.name, gr.region_id) AS name, gr.owner, gr.objects '
    + 'FROM game_regions gr LEFT JOIN world_regions wr ON wr.id = gr.region_id '
    + 'WHERE gr.game_id = ? ORDER BY gr.region_id',
  ).all(gameId) as Array<{ id: string; name: string; owner: string; objects: string }>;
  const template = db.prepare('SELECT id, name, owner, objects FROM world_regions WHERE world_id = ? ORDER BY id')
    .all(worldId) as Array<{ id: string; name: string; owner: string; objects: string }>;
  // Live rows shadow the template per region; regions that exist only in the
  // template (never entered the dynamic copy) remain known for existence checks.
  const dynamic = liveRegions ? [...liveRegions] : live.length > 0 ? regionsFromRows(live) : regionsFromRows(template);
  const templateRows = regionsFromRows(template);
  const known = new Set(dynamic.map(region => region.id));
  const regions = [...dynamic, ...templateRows.filter(region => !known.has(region.id))];
  return { regions, operationalObjects: operationalObjectRepository.list(gameId) };
}
