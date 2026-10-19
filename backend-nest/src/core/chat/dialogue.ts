/** Political routing and topic continuity use recorded identities, never invented actors. */
const normalize = (text: string) => text.toLocaleLowerCase('it').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function addressedDelegations(text: string, participants: readonly { id: string; name: string }[]): string[] {
  const source = ` ${normalize(text)} `;
  return participants.filter(p => source.includes(` ${normalize(p.name)} `)
    || new RegExp(`(?:^|[^A-Za-z0-9])${p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^A-Za-z0-9])`).test(text))
    .map(p => p.name);
}

/** Conservative fallback when a provider omits the existing thread ID. */
export function sameDiplomaticTopic(a: string | null | undefined, b: string): boolean {
  if (!a?.trim() || !b.trim()) return false;
  if (normalize(a) === normalize(b)) return true;
  const ignored = new Set(['della', 'delle', 'dello', 'degli', 'sulla', 'sulle', 'delle', 'dell',
    'accordo', 'accordi', 'proposta', 'proposte', 'richiesta', 'richieste', 'negoziato', 'trattativa',
    'aggiornamento', 'nuova', 'nuovo', 'the', 'with', 'from', 'diplomatic']);
  const terms = (value: string) => new Set(normalize(value).split(' ').filter(word => word.length > 3 && !ignored.has(word)));
  const left = terms(a), right = terms(b);
  const shared = [...left].filter(word => right.has(word)).length;
  return shared >= 2 && shared / Math.min(left.size, right.size) >= .6;
}
