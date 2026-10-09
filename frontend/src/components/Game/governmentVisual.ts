import type { Region } from '../../types';
import type { ActionSnapshotSource } from './actionSnapshot';
import type { MapContextIndex } from '../Map/mapContext';
import { regionIdsForFocus, type MapRegionFocusRequest } from '../Map/mapFocus';
import { polityLabel } from '../Map/mapThematicContext';
import { buildStaticMap, type StaticRegionPath } from '../Map/staticMapModel';
import { svgPathBounds, unionBounds, viewBoxFor } from './regionFocus';
import { MAX_MAP_PREVIEW_REGIONS, type PresentationDirective } from './presentation';
import type { GovernmentMapRequest } from './governmentVisualRequest';

interface VisualBase {
  title: string;
  description?: string;
  /** Transient UI provenance, never persisted or sent to a model. */
  scopeKey: string;
}
/** La mappa politica nazionale mostra un quadro, mai una crisi: lo dichiara. */
const NEUTRAL_NATIONAL_DESCRIPTION = 'Territori di riferimento; non indica operazioni, crisi o aree di conflitto.';
export interface MapFocusVisual extends VisualBase {
  type: 'map-focus';
  regionIds: readonly string[];
  source?: { type: 'front'; id: string } | { type: 'diplomacy'; playerPolityId: string; polityId: string };
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
  militaryAvailable?: boolean;
  playerPolityId?: string;
  relationships?: Record<string, Record<string, string>> | null;
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
  militaryUnavailable?: boolean;
  playerPolityId?: string;
  relationships?: Record<string, Record<string, string>> | null;
}): GovernmentVisualSnapshot | undefined {
  return input.unavailable ? undefined : { scopeKey: input.scopeKey, index: input.index,
    militaryAvailable: !input.militaryUnavailable && input.militarySnapshotKey === input.canonicalSnapshotKey,
    playerPolityId: input.playerPolityId, relationships: input.relationships };
}

/**
 * M01 — Le regioni possedute dal giocatore, dalle sole fonti canoniche
 * (`regionsById` + `playerPolityId`). È la rappresentazione minima quando il
 * Presidente chiede esplicitamente la mappa e non esiste un riferimento più
 * preciso: **nessun fronte richiesto**, mai un id inventato dal modello.
 * L'ordine è stabile (ordine dell'indice) perché la scheda resti comparabile.
 */
export function playerOwnedRegionIds(snapshot: GovernmentVisualSnapshot): string[] {
  const player = snapshot.playerPolityId;
  if (!player) return [];
  return [...snapshot.index.regionsById.values()].filter(region => region.owner === player).map(region => region.id);
}

export interface GovernmentVisualMessage {
  role: 'user' | 'assistant';
  content?: string;
  situations?: readonly { signalKeys?: readonly string[] }[];
  issues?: readonly { signalKeys?: readonly string[] }[];
  evidence?: readonly PresentationDirective[];
  visualRequest?: GovernmentMapRequest;
}

/** Geographic joins only: exact IDs, current fronts and verified diplomatic
 * interlocutors. No text-name matching, coordinates, or inferred military acts. */
export function resolveGovernmentVisuals(message: GovernmentVisualMessage, snapshot: GovernmentVisualSnapshot): MapFocusVisual[] {
  if (message.role !== 'assistant' || (message.visualRequest?.scopeKey && message.visualRequest.scopeKey !== snapshot.scopeKey)) return [];
  const keys = new Set([
    ...(message.situations ?? []).flatMap(situation => situation.signalKeys ?? []),
    ...(message.issues ?? []).flatMap(issue => issue.signalKeys ?? []),
    ...(message.visualRequest?.signalKeys ?? []),
  ]);
  const maps = (message.evidence ?? []).filter(directive => directive.evidence === 'mappa' && ['show', 'focus'].includes(directive.op));
  if (maps.length && !message.visualRequest) return []; // Legacy unscoped directives are not re-badged.
  if (maps.some(directive => directive.invalidRegionIds)) return [];
  const explicitIds = [...maps].reverse().find(directive => directive.regionIds?.length)?.regionIds;
  const checkedIds = explicitIds && regionIdsForFocus({ regionIds: explicitIds, requestId: 0 }, snapshot.index.regionsById);
  if (explicitIds && !checkedIds?.length) return []; // Never substitute rejected IDs with another map.
  const player = snapshot.playerPolityId;
  const ownedRegions = player ? [...snapshot.index.regionsById.values()].filter(region => region.owner === player) : [];
  const neutralPoliticalCard = (): MapFocusVisual => ({ type: 'map-focus', title: 'Contesto territoriale', description: NEUTRAL_NATIONAL_DESCRIPTION, regionIds: ownedRegions.map(region => region.id), scopeKey: snapshot.scopeKey });
  // A — Mappa NAZIONALE esplicita: il territorio posseduto vince sui segnali
  // della questione (una relazione non verificata o un fronte chiuso non devono
  // cancellarla). Gli id espliciti/ereditati restano il riferimento più
  // specifico e passano prima; id invalidi hanno già fatto uscire sopra.
  if (message.visualRequest?.intent === 'national' && !checkedIds?.length && !message.visualRequest.regionIds?.length) {
    return ownedRegions.length ? [neutralPoliticalCard()] : [];
  }
  const cards: MapFocusVisual[] = [];
  if (snapshot.militaryAvailable !== false) for (const key of keys) {
    if (!key.startsWith('conflict:')) continue;
    const front = snapshot.index.frontsById.get(key.slice('conflict:'.length));
    if (!front || !['active', 'stalemate', 'breakthrough'].includes(front.status)) continue;
    const regionIds = regionIdsForFocus({ regionIds: front.regionIds, requestId: 0 }, snapshot.index.regionsById);
    if (regionIds.length) cards.push({ type: 'map-focus', title: front.name, description: 'Territori del fronte nello stato attuale.', regionIds, scopeKey: snapshot.scopeKey, source: { type: 'front', id: front.id } });
  }
  const identity = (ids: readonly string[]) => [...ids].sort().join('\u0000');
  if (checkedIds?.length) {
    const matchingFront = cards.find(card => identity(card.regionIds) === identity(checkedIds));
    return [matchingFront ?? { type: 'map-focus', title: 'Contesto territoriale', description: 'Territori di riferimento; non indica operazioni o aree di conflitto.', regionIds: checkedIds, scopeKey: snapshot.scopeKey }];
  }
  if (cards.length) return cards.filter((card, i) => cards.findIndex(other => identity(other.regionIds) === identity(card.regionIds)) === i);
  if (message.visualRequest?.regionIds?.length) {
    const regionIds = regionIdsForFocus({ regionIds: message.visualRequest.regionIds, requestId: 0 }, snapshot.index.regionsById);
    return regionIds.length ? [{ type: 'map-focus', title: 'Contesto territoriale', description: 'Territori di riferimento; non indica operazioni o aree di conflitto.', regionIds, scopeKey: snapshot.scopeKey }] : [];
  }
  // Diplomatic context is only drawn on an explicit map request: a routine
  // mention of a hostile relation must not force a card on every reply.
  if (!message.visualRequest) return [];
  const relations = player && snapshot.relationships?.[player];
  if (player && relations) {
    const hostile = Object.keys(relations).filter(id => id !== player && relations[id] === 'hostile');
    for (const key of keys) {
      const polityId = key === 'hostile-relations' ? (hostile.length === 1 ? hostile[0] : undefined)
        : key.startsWith('hostile-relations:') ? key.slice('hostile-relations:'.length) : undefined;
      if (!polityId || !hostile.includes(polityId)) continue;
      const territories = [...snapshot.index.regionsById.values()].filter(region => region.owner === player || region.owner === polityId);
      if (!territories.some(region => region.owner === player) || !territories.some(region => region.owner === polityId)) continue;
      cards.push({ type: 'map-focus', title: 'Contesto diplomatico', description: 'Relazione ostile verificata; non implica una guerra in corso.', regionIds: territories.map(region => region.id), scopeKey: snapshot.scopeKey, source: { type: 'diplomacy', playerPolityId: player, polityId } });
    }
  }
  if (cards.length) return cards.filter((card, i) => cards.findIndex(other => identity(other.regionIds) === identity(card.regionIds)) === i);
  const situationalGeography = [...keys].some(key =>
    key.startsWith('conflict:') || key === 'hostile-relations' || key.startsWith('hostile-relations:'));
  // B — Mappa della QUESTIONE: solo riferimenti verificati. Se non ne esistono,
  // niente carta: una mappa nazionale al posto della crisi sarebbe fuorviante.
  if (message.visualRequest.intent === 'situation') return [];
  // C — Mappa GENERICA (o richiesta legacy senza intento): i riferimenti
  // verificati hanno già avuto la loro strada; in mancanza, una mappa politica
  // nazionale neutra, dichiarata tale. La richiesta legacy resta protetta dalla
  // vecchia guardia situazionale.
  if (ownedRegions.length && (message.visualRequest.intent === 'generic'
    || (message.visualRequest.intent === undefined && !situationalGeography))) {
    return [neutralPoliticalCard()];
  }
  return [];
}

/**
 * M-DIAG — Perché una richiesta di mappa non ha prodotto una card. Diagnostica
 * **solo di sviluppo** (mai testo tecnico al giocatore): segue l'ordine dei
 * rifiuti del resolver, così il motivo è identificabile senza log continui.
 * `null` = il resolver avrebbe prodotto qualcosa (o non c'era richiesta).
 */
export type GovernmentVisualDenial = 'snapshot-unavailable' | 'snapshot-scope-mismatch' | 'no-request' | 'invalid-region-id' | 'no-verified-reference' | 'no-owned-territory';

export function explainGovernmentVisualDenial(message: GovernmentVisualMessage, snapshot: GovernmentVisualSnapshot | undefined): GovernmentVisualDenial | null {
  if (!snapshot) return 'snapshot-unavailable';
  if (message.role !== 'assistant' || !message.visualRequest) return 'no-request';
  if (resolveGovernmentVisuals(message, snapshot).length) return null;
  if (message.visualRequest.scopeKey && message.visualRequest.scopeKey !== snapshot.scopeKey) return 'snapshot-scope-mismatch';
  const maps = (message.evidence ?? []).filter(directive => directive.evidence === 'mappa' && ['show', 'focus'].includes(directive.op));
  if (maps.some(directive => directive.invalidRegionIds)) return 'invalid-region-id';
  const explicitIds = [...maps].reverse().find(directive => directive.regionIds?.length)?.regionIds;
  if (explicitIds && !regionIdsForFocus({ regionIds: explicitIds, requestId: 0 }, snapshot.index.regionsById).length) return 'invalid-region-id';
  if (message.visualRequest.regionIds?.length) return 'invalid-region-id';
  // B — nessun riferimento verificato per la questione: non si ripiega.
  if (message.visualRequest.intent === 'situation') return 'no-verified-reference';
  // A/C senza territorio posseduto (né player né regioni).
  return playerOwnedRegionIds(snapshot).length ? null : 'no-owned-territory';
}

/** Also used at the final click boundary: a queued callback cannot cross epochs. */
export function mapFocusFromVisual(card: MapFocusVisual, snapshot: GovernmentVisualSnapshot, requestId: number): MapRegionFocusRequest | null {
  if (card.scopeKey !== snapshot.scopeKey) return null;
  if (card.source?.type === 'front') {
    const front = snapshot.index.frontsById.get(card.source.id);
    const selected = new Set(card.regionIds);
    if (snapshot.militaryAvailable === false || !front || !['active', 'stalemate', 'breakthrough'].includes(front.status)
      || new Set(front.regionIds).size !== selected.size || front.regionIds.some(id => !selected.has(id))) return null;
  }
  if (card.source?.type === 'diplomacy') {
    const { playerPolityId, polityId } = card.source;
    if (snapshot.playerPolityId !== playerPolityId || snapshot.relationships?.[playerPolityId]?.[polityId] !== 'hostile') return null;
    const currentIds = [...snapshot.index.regionsById.values()].filter(region => region.owner === playerPolityId || region.owner === polityId).map(region => region.id);
    const selected = new Set(card.regionIds);
    if (currentIds.length !== selected.size || currentIds.some(id => !selected.has(id))) return null;
  }
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
    const role = card.source?.type === 'diplomacy' ? (region.owner === card.source.playerPolityId ? 'Nazione del giocatore' : 'Interlocutore diplomatico ostile') : '';
    if (!legend.has(key)) legend.set(key, { label: [polityLabel(region.owner, regions), role].filter(Boolean).join(' · '), color });
  }
  const bounded = card.source?.type !== 'front' && regions.length > MAX_MAP_PREVIEW_REGIONS;
  return { regions, legend: [...legend.values()], preview: bounded ? null : previewFor(regions) };
}
