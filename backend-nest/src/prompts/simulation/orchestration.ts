import type { ReactionContext } from '../../core/simulation/ReactionContext';

const clip = (text: string, cap: number): string => cap <= 0 ? '' : text.length <= cap ? text : `${text.slice(0, cap - 1).trimEnd()}…`;

/** Allocate the existing budget across actors instead of cutting off later
 * countries (and their agendas). No summarizer call or generated state. */
export function compactNpcDossiers(text: string | undefined, maxChars: number): string {
  const raw = (text ?? '').trim();
  if (raw.length <= maxChars) return raw;
  const blocks = raw.split(/\n(?=- .+\[[^\]]+\])/);
  if (!raw.startsWith('- ') || !raw.includes('Agenda strategica:')) return clip(raw, maxChars);
  const budget = Math.max(0, Math.floor((maxChars - blocks.length) / blocks.length));
  return blocks.map(block => {
    const lines = block.split('\n').map(line => line.trim());
    const field = (prefix: string, ratio: number) => clip(lines.find(line => line.startsWith(prefix)) ?? '', Math.floor(budget * ratio));
    return [clip(lines[0], Math.floor(budget * .20)),
      field('Priorità correnti:', .23), field('Agenda strategica:', .30),
      field('Memoria strategica:', .17), field('Economia e sforzo:', .09)]
      .filter(Boolean).join('\n');
  }).join('\n').slice(0, maxChars);
}

/** Keep every actor and option ID intact. Only descriptive text shares the
 * remaining budget; an oversized identity skeleton is never cut in half. */
export function compactReactionContext(context: ReactionContext, maxChars: number): string {
  const actors = context.actors.filter(actor => !actor.id.includes(':'));
  const identities = actors.map(actor => `${actor.name} [${actor.id}] ruolo=${actor.role}; opzioni: ${actor.options.map(o => o.id).join('|')}`);
  const header = `CAUSA (${context.trigger.kind}): ${clip(context.trigger.summary, 240)}\nMassimo ${context.maxReactions} reazioni per evento.`;
  const constraints = context.constraints.map(c => `${c.kind}: ${c.description}`).join('; ');
  const skeletonSize = header.length + identities.join('\n').length + actors.length * 2;
  const remaining = Math.max(0, maxChars - skeletonSize);
  const shared = clip(constraints, Math.floor(remaining * .35));
  const each = Math.max(0, Math.floor((remaining - shared.length - 10) / Math.max(1, actors.length)));
  return [header, shared, ...actors.map((actor, i) => {
    const limits = actor.options.filter(o => o.constraint).map(o => `${o.id}: ${o.constraint}`).join('; ');
    return `${identities[i]}\n${clip(actor.because, Math.floor(each * .5))} ${clip(limits, Math.floor(each * .5))}`;
  })].filter(Boolean).join('\n');
}
