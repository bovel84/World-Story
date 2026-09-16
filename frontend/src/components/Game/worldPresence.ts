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
 * Ordine di preferenza (MIGLIORIA 4):
 *  1. evento reale dal feed (scontri, poi diplomazia) → più informativo;
 *  2. variazione territoriale (solo se il feed non offre nulla);
 *  3. nessun fatto inventato.
 * Il feed è cronologico (vecchio → nuovo): si legge dalla coda per prendere i
 * dispacci più recenti (BUG 3).
 */
export function deriveWorldPresence(input: WorldPresenceInput): WorldPresence {
  const limit = Math.max(input.limit ?? 3, 1);
  const byId = new Map(asList(input.regions).map(region => [region.id, region]));

  // --- 1. Eventi reali dal feed, dal più recente ----------------------------
  // Scontri prima della diplomazia: più urgenti e più concreti.
  const newest = [...(input.feedItems ?? [])].reverse();
  const warFacts: WorldFact[] = [];
  const diplomacyFacts: WorldFact[] = [];
  for (const item of newest) {
    const category = classifyDispatch(item.text, item.detail);
    if (category.key !== 'war' && category.key !== 'diplomacy') continue;
    const fact: WorldFact = {
      id: `world-feed-${item.id}`,
      severity: category.key === 'war' ? 'warning' : 'info',
      label: item.text,
      detail: category.label,
    };
    if (category.key === 'war') warFacts.push(fact);
    else diplomacyFacts.push(fact);
    if (warFacts.length + diplomacyFacts.length >= limit) break;
  }
  const feedFacts = [...warFacts, ...diplomacyFacts].slice(0, limit);

  // --- 2. Variazioni territoriali (solo se non c'è una notizia reale) -------
  const byOwner = new Map<string, Region[]>();
  for (const regionId of input.changedRegionIds) {
    const region = byId.get(regionId);
    if (!region || region.owner === input.playerPolityId || region.owner === 'neutral') continue;
    const bucket = byOwner.get(region.owner) ?? [];
    bucket.push(region);
    byOwner.set(region.owner, bucket);
  }
  let changedForeignCount = 0;
  const territorialFacts: WorldFact[] = [];
  for (const [owner, regions] of byOwner) {
    changedForeignCount += regions.length;
    const name = polityLabel(regions[0]);
    const placeNames = regions.slice(0, 2).map(region => region.name).filter(Boolean).join(', ');
    territorialFacts.push({
      id: `world-owner-${owner}`,
      severity: isHostile(input.relationships, input.playerPolityId, owner) ? 'warning' : 'info',
      label: `${name}: ${regions.length === 1 ? 'un territorio aggiornato' : `${regions.length} territori aggiornati`}`,
      detail: `${placeNames}${regions.length > 2 ? ` e altri ${regions.length - 2}` : ''}${isHostile(input.relationships, input.playerPolityId, owner) ? ' · potenza ostile' : ''}`,
    });
  }

  // Una notizia reale vale più di un movimento generico: se c'è, il territorio
  // resta sullo sfondo (osservabile dalla mappa) e non sporca il briefing.
  const facts = feedFacts.length > 0 ? feedFacts : territorialFacts.slice(0, limit);
  return { facts, changedForeignCount };
}
