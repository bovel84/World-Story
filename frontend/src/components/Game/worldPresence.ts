/**
 * World Story — LW05: presenza del mondo (read model puro)
 * ======================================================
 * Rende visibili le variazioni estere **già simulate** dal motore: regioni
 * cambiate nel turno, proprietari coinvolti, dispacci recenti classificati.
 * Nessun nuovo sistema, nessuna nuova simulazione: solo osservabilità.
 */

import type { Region } from '../../types';
import { classifyDispatch } from './dispatchCategory';

/** Gravità di un fatto del mondo (stessa scala del briefing). */
export type WorldSeverity = 'critical' | 'warning' | 'opportunity' | 'positive' | 'info';

export interface WorldFact {
  id: string;
  severity: WorldSeverity;
  label: string;
  detail?: string;
}

export interface WorldPresenceInput {
  regions: Record<string, Region> | ReadonlyArray<Region>;
  /** Regioni cambiate nell'ultimo avanzamento (dal gameStore). */
  changedRegionIds: readonly string[];
  playerPolityId: string;
  /** Matrice relazioni `da → verso → tipo`, se già disponibile. */
  relationships?: Record<string, Record<string, string>> | null;
  /** Dispacci recenti: testo e regioni toccate. */
  feedItems?: ReadonlyArray<{ id: string; text: string; detail?: string; regionIds?: string[] }>;
  /** Quanti dispacci considerare (i più recenti). */
  limit?: number;
}

export interface WorldPresence {
  facts: WorldFact[];
  /** Numero di regioni estere aggiornate nel turno. */
  changedForeignCount: number;
}

function asList(regions: WorldPresenceInput['regions']): Region[] {
  return Array.isArray(regions) ? [...regions] : Object.values(regions);
}

function polityLabel(region: Region): string {
  return region.polityName || region.name || region.owner;
}

function isHostile(relationships: WorldPresenceInput['relationships'], from: string, to: string): boolean {
  return relationships?.[from]?.[to] === 'hostile';
}

/**
 * Deriva i fatti del mondo. Deterministica: stesso input → stesso output.
 * L'ordine è: guerre/scontri, variazioni territoriali, diplomazia.
 */
export function deriveWorldPresence(input: WorldPresenceInput): WorldPresence {
  const limit = input.limit ?? 3;
  const byId = new Map(asList(input.regions).map(region => [region.id, region]));
  const facts: WorldFact[] = [];

  // --- 1. Regioni estere cambiate nel turno, raggruppate per proprietario ---
  const byOwner = new Map<string, Region[]>();
  for (const regionId of input.changedRegionIds) {
    const region = byId.get(regionId);
    if (!region || region.owner === input.playerPolityId || region.owner === 'neutral') continue;
    const bucket = byOwner.get(region.owner) ?? [];
    bucket.push(region);
    byOwner.set(region.owner, bucket);
  }
  let changedForeignCount = 0;
  for (const [owner, regions] of byOwner) {
    changedForeignCount += regions.length;
    const name = polityLabel(regions[0]);
    facts.push({
      id: `world-owner-${owner}`,
      severity: isHostile(input.relationships, input.playerPolityId, owner) ? 'warning' : 'info',
      label: `${name}: movimento nel turno`,
      detail: `${regions.length} ${regions.length === 1 ? 'regione aggiornata' : 'regioni aggiornate'}${isHostile(input.relationships, input.playerPolityId, owner) ? ' · potenza ostile' : ''}`,
    });
  }

  // --- 2. Dispacci recenti con scontri o diplomazia ------------------------
  const recent = (input.feedItems ?? []).slice(0, Math.max(limit, 1));
  for (const item of recent) {
    const category = classifyDispatch(item.text, item.detail);
    if (category.key !== 'war' && category.key !== 'diplomacy') continue;
    facts.push({
      id: `world-feed-${item.id}`,
      severity: category.key === 'war' ? 'warning' : 'info',
      label: item.text,
      detail: category.label,
    });
    if (facts.length >= limit * 2) break;
  }

  return { facts: facts.slice(0, Math.max(limit, 1) * 2), changedForeignCount };
}
