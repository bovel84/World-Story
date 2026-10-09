import type { Region } from '../../types';
import type { ActionSnapshotSource } from './actionSnapshot';
import type { MapContextIndex } from '../Map/mapContext';
import { regionIdsForFocus, type MapRegionFocusRequest } from '../Map/mapFocus';
import { polityLabel } from '../Map/mapThematicContext';
import { buildStaticMap, type StaticRegionPath } from '../Map/staticMapModel';
import { svgPathBounds, unionBounds, viewBoxFor } from './regionFocus';

interface VisualBase {
  title: string;
  description?: string;
  /** Transient UI provenance, never persisted or sent to a model. */
  scopeKey: string;
}
export interface MapFocusVisual extends VisualBase {
  type: 'map-focus';
  regionIds: readonly string[];
}
/** Reserved contracts only: proposals must never look like executed actions.
 * No resolver or renderer for either of these types in this first increment. */
export type GovernmentVisual = MapFocusVisual
  | (VisualBase & { type: 'troop-movement'; unitIds: readonly string[]; regionIds: readonly string[]; state: 'proposed' | 'verified' })
  | (VisualBase & { type: 'infrastructure-project'; projectId: string; regionIds: readonly string[]; state: 'proposed' | 'verified' });

export interface GovernmentVisualSnapshot {
  scopeKey: string;
  /** The main map's index, resolved against the current world, not a copied world. */
  index: MapContextIndex;
}
/** Store selector shared with the live click guard, including restore/rewind commands. */
export function governmentVisualEpoch({ state, commandGeneration }: {
  state: { gameId: string; branchId: string; worldRevision: number } | null;
  commandGeneration: number;
}): string {
  return `${state?.gameId ?? ''}:${state?.branchId ?? ''}:${state?.worldRevision ?? 0}:${commandGeneration}`;
}

/** Do not pair a new simulation branch/revision with the still-visible old world. */
export function governmentVisualRuntimeMatches(game: ActionSnapshotSource | null, runtime: {
  gameId: string; branchId: string; worldRevision: number;
} | null): boolean {
  return Boolean(game?.id && runtime && game.id === runtime.gameId
    && (game.headBranchId || 'unknown') === runtime.branchId && (game.worldRevision ?? 0) === runtime.worldRevision);
}

/** A fresh UI epoch cannot re-badge fronts fetched for an older canonical world. */
export function buildGovernmentVisualSnapshot(input: {
  scopeKey: string;
  canonicalSnapshotKey: string;
  militarySnapshotKey: string | null;
  index: MapContextIndex;
  unavailable: boolean;
}): GovernmentVisualSnapshot | undefined {
  return !input.unavailable && input.militarySnapshotKey === input.canonicalSnapshotKey
    ? { scopeKey: input.scopeKey, index: input.index } : undefined;
}

export interface GovernmentVisualMessage {
  role: 'user' | 'assistant';
  content?: string;
  situations?: readonly { signalKeys?: readonly string[] }[];
  issues?: readonly { signalKeys?: readonly string[] }[];
}

/** Only a verified structural join: RealitySignals emits conflict:<front.id>.
 * No name matching, generic domain inference, LLM calls or option inspection. */
export function resolveGovernmentVisuals(message: GovernmentVisualMessage, snapshot: GovernmentVisualSnapshot): MapFocusVisual[] {
  if (message.role !== 'assistant') return [];
  const keys = new Set([
    ...(message.situations ?? []).flatMap(situation => situation.signalKeys ?? []),
    ...(message.issues ?? []).flatMap(issue => issue.signalKeys ?? []),
  ]);
  const cards: MapFocusVisual[] = [];
  for (const key of keys) {
    if (!key.startsWith('conflict:')) continue;
    const front = snapshot.index.frontsById.get(key.slice('conflict:'.length));
    if (!front || !['active', 'stalemate', 'breakthrough'].includes(front.status)) continue;
    const regionIds = regionIdsForFocus({ regionIds: front.regionIds, requestId: 0 }, snapshot.index.regionsById);
    if (!regionIds.length) continue;
    cards.push({ type: 'map-focus', title: front.name, description: 'Territori del fronte nello stato attuale.', regionIds, scopeKey: snapshot.scopeKey });
  }
  return cards;
}

/** Also used at the final click boundary: a queued callback cannot cross epochs. */
export function mapFocusFromVisual(card: MapFocusVisual, snapshot: GovernmentVisualSnapshot, requestId: number): MapRegionFocusRequest | null {
  if (card.scopeKey !== snapshot.scopeKey) return null;
  const regionIds = regionIdsForFocus({ regionIds: card.regionIds, requestId }, snapshot.index.regionsById);
  return regionIds.length ? { regionIds, requestId, scopeKey: snapshot.scopeKey } : null;
}

interface VisualPreview { paths: StaticRegionPath[]; viewBox: string }
function previewFor(regions: Region[]): VisualPreview | null {
  let paths: StaticRegionPath[];
  if (regions.every(region => region.geojson)) {
    // This is the existing WebGL fallback projection, not a second map engine.
    const model = buildStaticMap(regions, 640, 260);
    // No partial map, no stretched dateline approximation. Declare absence.
    if (model.paths.length !== regions.length || !model.bounds || model.bounds.east - model.bounds.west > 184) return null;
    paths = model.paths;
  } else if (regions.every(region => !region.geojson && region.svgPath)) {
    // The shared legacy bounds helper measures absolute M/L/Z paths. Do not
    // misframe relative paths or curves that it cannot measure faithfully.
    if (regions.some(region => !/^\s*M[\sMLZz\d,.-]+$/.test(region.svgPath!))) return null;
    paths = regions.map(region => ({ id: region.id, name: region.name, owner: region.owner, color: region.color || '#3a3f4b', path: region.svgPath! }));
  } else return null; // Mixed coordinate systems cannot be overlaid honestly.
  const bounds = paths.map(path => svgPathBounds(path.path));
  if (bounds.some(bound => !bound || bound.maxX <= bound.minX || bound.maxY <= bound.minY)) return null;
  const all = unionBounds(bounds)!;
  return { paths, viewBox: viewBoxFor(all, Math.max(all.maxX - all.minX, all.maxY - all.minY) * 0.08) };
}

/** Resolve display facts afresh: names, ownership and shapes remain canonical. */
export function governmentVisualModel(card: MapFocusVisual, snapshot: GovernmentVisualSnapshot) {
  const focus = mapFocusFromVisual(card, snapshot, 0);
  if (!focus?.regionIds) return null;
  const regions = focus.regionIds.map(id => snapshot.index.regionsById.get(id)!);
  const legend = new Map<string, { label: string; color: string }>();
  for (const region of regions) {
    const color = region.color || '#3a3f4b'; // Same neutral fallback as buildStaticMap.
    const key = `${region.owner}:${color}`;
    if (!legend.has(key)) legend.set(key, { label: polityLabel(region.owner, regions), color });
  }
  return { regions, legend: [...legend.values()], preview: previewFor(regions) };
}
