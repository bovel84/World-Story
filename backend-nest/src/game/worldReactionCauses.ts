import type { WorldReactionCause } from '../core/simulation/ReactionContext';

interface WorldCauseInput {
  date: string;
  playerPolityId: string;
  results: readonly { timelineEvents?: Array<{ id?: string; date: string; headline: string; detail?: string }> }[];
  storylines: readonly { id: string; title: string; summary: string; parties: readonly string[] }[];
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
  // Relevant national threads first; a second, independent theatre can still act.
  const threads = [...input.storylines].sort((a, b) =>
    Number(b.parties.includes(input.playerPolityId)) - Number(a.parties.includes(input.playerPolityId)));
  for (const thread of threads.slice(0, 2)) {
    causes.push({ kind: 'world_process', sourceRef: `storyline:${thread.id}`, polityIds: [...thread.parties],
      summary: `Filone del preset, non esito già avvenuto: ${thread.title}. ${thread.summary}`.slice(0, 500) });
  }
  return causes;
}
