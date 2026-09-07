import type { RegionState } from '../../game-session';

/** O(provinces + borders), built once per NPC batch rather than per country. */
export function indexPolities(regions: Map<string, RegionState>) {
  const owned = new Map<string, RegionState[]>();
  const frontier = new Map<string, Set<string>>();
  for (const region of regions.values()) {
    if (region.status === 'destroyed') continue;
    const list = owned.get(region.owner) || [];
    list.push(region);
    owned.set(region.owner, list);
    for (const id of region.borders || []) {
      const other = regions.get(id);
      if (!other || other.status === 'destroyed' || other.owner === region.owner) continue;
      // Old scenarios sometimes only stored one direction of an adjacency.
      for (const [owner, target] of [[region.owner, other.id], [other.owner, region.id]]) {
        const borders = frontier.get(owner) || new Set<string>();
        borders.add(target);
        frontier.set(owner, borders);
      }
    }
  }
  return { owned, frontier };
}

/** One representative agent per *current* polity; no player/neutral agents. */
export function npcRepresentatives(ids: string[], regions: Map<string, RegionState>, player: string): string[] {
  const seen = new Set<string>();
  return ids.filter(id => {
    const region = regions.get(id);
    if (!region || !region.owner || region.owner === player || region.owner === 'neutral'
      || region.status === 'destroyed' || seen.has(region.owner)) return false;
    seen.add(region.owner);
    return true;
  });
}

/** NPC skirmishes can only continue an established conflict on a real border.
 * New declarations of war must come from the causal world simulation.
 */
export function canNpcCapture(owner: string, target: RegionState | undefined,
  frontier: Set<string>, relationship: string): target is RegionState {
  return !!target && target.status !== 'destroyed' && target.owner !== owner
    && frontier.has(target.id) && relationship === 'hostile';
}
