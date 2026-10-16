import type { WorldReactionCause } from '../core/simulation/ReactionContext';
import type { NpcObjective } from '../core/simulation/NpcAgenda';

export interface WorldStorylineSource {
  id: string; title: string; summary: string; parties: readonly string[];
  trajectory?: string; active_from?: string; active_until?: string; state?: string;
}

/** One nearby thread and one independent theatre. Rotation is replayable and
 * changes attention, never creates an event or reopens a resolved storyline. */
export function selectWorldStorylines<T extends WorldStorylineSource>(
  threads: readonly T[], playerId: string, date: string, turn = 1,
): T[] {
  const active = threads.filter(t => t.state !== 'risolto' && t.state !== 'congelato'
    && (!t.active_from || t.active_from <= date) && (!t.active_until || t.active_until >= date));
  const rotate = (items: T[]): T[] => {
    if (!items.length) return [];
    const offset = Math.max(0, Math.floor(Number.isFinite(turn) ? turn - 1 : 0)) % items.length;
    return [...items.slice(offset), ...items.slice(0, offset)];
  };
  const national = rotate(active.filter(t => t.parties.includes(playerId)));
  const independent = rotate(active.filter(t => !t.parties.includes(playerId)));
  return national.length && independent.length
    ? [national[0], independent[0]] : [...national, ...independent].slice(0, 2);
}

interface WorldCauseInput {
  date: string;
  playerPolityId: string;
  turn?: number;
  results: readonly { timelineEvents?: Array<{ id?: string; date: string; headline: string; detail?: string }> }[];
  storylines: readonly WorldStorylineSource[];
  objectives?: readonly NpcObjective[];
}

/** Read only committed chronology and already-active preset threads. Never orders
 * or unconsumed playback events; no new model call and no whole-world scan. */
export function buildWorldReactionCauses(input: WorldCauseInput): WorldReactionCause[] {
  const now = Date.parse(input.date);
  if (!Number.isFinite(now)) return [];
  const recent = input.results.slice(-4).flatMap(result => result.timelineEvents ?? [])
    .filter(event => {
      const date = Date.parse(event.date);
      return event.headline?.trim() && Number.isFinite(date) && date <= now && now - date <= 180 * 86_400_000;
    }).sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set<string>();
  const causes: WorldReactionCause[] = [];
  for (const event of recent) {
    const key = `${event.date}:${event.headline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    causes.push({ kind: 'prior_event', sourceRef: `timeline:${event.id || key}`,
      summary: `${event.date}: ${event.headline}. ${event.detail ?? ''}`.slice(0, 500) });
    if (causes.length === 3) break;
  }
  for (const thread of selectWorldStorylines(input.storylines, input.playerPolityId, input.date, input.turn)) {
    causes.push({ kind: 'world_process', sourceRef: `storyline:${thread.id}`, polityIds: [...thread.parties],
      summary: `Filone del preset, non esito già avvenuto: ${thread.title}. ${thread.summary} ${thread.trajectory ?? ''}`.trim().slice(0, 500) });
  }
  // An existing active agenda can drive initiative even in presets with no
  // storylines. Select one objective, not one provider call per country.
  const objectives = (input.objectives ?? []).filter(o => o.status === 'active'
    && o.polityId !== input.playerPolityId && o.type !== 'storyline'
    && o.createdDate <= input.date && o.reviewedDate <= input.date)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const urgent = objectives.filter(o => o.priority === objectives[0]?.priority);
  const offset = Math.max(0, Math.floor(Number.isFinite(input.turn) ? input.turn! - 1 : 0));
  const objective = urgent[offset % urgent.length];
  if (objective) causes.push({ kind: 'world_process', sourceRef: `agenda:${objective.id}`,
    polityIds: [objective.polityId, ...(objective.targetPolityId ? [objective.targetPolityId] : [])],
    summary: `Obiettivo attivo di ${objective.polityId}, non risultato acquisito: ${objective.description}. Motivo: ${objective.reason}`.slice(0, 500) });
  return causes;
}
