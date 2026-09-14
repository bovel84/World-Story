import { normalizeName } from './name-resolver';

export const UNIT_TYPES = new Set(['battalion', 'army', 'fleet', 'missile']);

interface MovementRegion {
  id: string;
  name: string;
  owner: string;
  objects: any[];
}

/** Serializable, pre-event intent: never discover newly spawned replacements at completion. */
export interface MovementIntent {
  actionId: string;
  unitId: string;
  unitName: string;
  unitType: 'battalion' | 'army' | 'fleet' | 'missile';
  originId: string;
  targetId: string;
  fingerprint: string;
}

// Unlike the fuzzy narrative resolver, material destinations must be unique and exact.
export function exactMovementRegion<T extends MovementRegion>(regions: T[], key?: string): T | undefined {
  if (!key) return undefined;
  const byId = regions.find(region => region.id === key);
  if (byId) return byId;
  const name = normalizeName(key);
  if (!name) return undefined;
  const matches = regions.filter(region => normalizeName(region.name) === name);
  return matches.length === 1 ? matches[0] : undefined;
}

interface Mention<T> { value: T; start: number; end: number }
function mentions<T>(text: string, values: T[], name: (value: T) => string): Mention<T>[] {
  const found: Mention<T>[] = [];
  for (const value of values) {
    const needle = normalizeName(name(value) || '');
    if (!needle) continue;
    let start = text.indexOf(needle);
    while (start >= 0) {
      const end = start + needle.length;
      if ((start === 0 || text[start - 1] === ' ') && (end === text.length || text[end] === ' ')) {
        found.push({ value, start, end });
      }
      start = text.indexOf(needle, start + 1);
    }
  }
  // "I Armata" must not match inside "II Armata"; "Roma" must not
  // also select a second province when the order explicitly names "Roma Nord".
  return found.filter(item => !found.some(other => other.start <= item.start && other.end >= item.end
    && (other.start < item.start || other.end > item.end)));
}

/** Intentionally narrow: one unconditional destination, explicit units or all troops from one origin. */
export function parseMovementOrder(
  text: string, regions: MovementRegion[], playerId: string, actionId: string,
): MovementIntent[] {
  // Keep parenthetical instructions/negations; the shared name normalizer
  // otherwise drops their contents (appropriate for labels, not commands).
  const folded = normalizeName(String(text || '').replace(/[()]/g, ' '));
  // An attack can be conducted at range: only explicit relocation verbs
  // authorize a fallback move. Mixed attack/move orders fail the word check below.
  const movementVerb = /^(?:muov\w*|spost\w*|avanz\w*|invad\w*|occup\w*|schier\w*|trasfer\w*|marcia\w*|conquist\w*|invia\w*|deploy\w*|move\w*)$/;
  if (!folded.split(' ').some(word => movementVerb.test(word))) return [];
  // Do not interpret negations, alternatives, conditions or preparatory orders as execution.
  if (/\b(non|mai|senza|nessun\w*|evita\w*|annulla\w*|ferma\w*|rinvia\w*|aspetta\w*|attendi\w*|pianifica\w*|prepara\w*|valuta\w*|se|qualora|oppure|o|not|never|don|without|if|unless|or|plan\w*)\b/.test(folded)) return [];
  const units = regions.flatMap(region => (region.objects || [])
    .filter(object => UNIT_TYPES.has(object.type))
    .map(object => ({ region, object })));
  const named = mentions(folded, units, unit => unit.object.name);
  // Region names inside unit names are not destinations.
  const places = mentions(folded, regions, region => region.name)
    .filter(place => !named.some(unit => unit.start <= place.start && unit.end >= place.end));
  const sources = places.filter(place => /(?:^| )(?:da|dal|dalla|dallo|dalle|dai|dagli|dall|from) (?:regione |provincia )?$/.test(folded.slice(0, place.start)));
  const destinations = places.filter(place => /(?:^| )(?:a|ad|al|alla|allo|alle|ai|agli|all|in|nel|nella|nelle|nell|verso|su|contro|to|into|toward|towards) (?:regione |provincia )?$/.test(folded.slice(0, place.start)));
  // Every mentioned province must have an explicit role. No "last mention wins".
  if (places.some(place => !sources.includes(place) && !destinations.includes(place))) return [];
  const targets = new Set(destinations.map(place => place.value.id));
  const origins = new Set(sources.map(place => place.value.id));
  if (targets.size !== 1 || origins.size > 1) return [];
  const targetId = [...targets][0];
  // Repeated/duplicate normalized province names are ambiguous even in directional phrases.
  if (places.some(place => !exactMovementRegion(regions, place.value.name))) return [];
  // Account for every remaining word. This rejects unknown named units,
  // truncated place names ("Italia orientale"), and mixed orders such as
  // "sposta A e lascia B", rather than moving a recognized subset by accident.
  const masked = [...folded];
  for (const mention of [...named, ...places]) {
    for (let i = mention.start; i < mention.end; i++) masked[i] = ' ';
  }
  const connective = /^(?:ordina\w*|ordin\w*|di|a|ad|al|alla|allo|alle|ai|agli|all|da|dal|dalla|dallo|dalle|dai|dagli|dall|in|nel|nella|nelle|nell|verso|su|contro|fino|e|ed|il|lo|la|le|gli|i|l|un|una|unit|unita|truppe|battaglioni|armate|eserciti|flotte|missili|tutte|tutti|regione|provincia|immediatamente|subito|ora|from|to|into|toward|towards|all|the|troops|units|and|please)$/;
  if (masked.join('').trim().split(/\s+/).some(word => !movementVerb.test(word) && !connective.test(word))) return [];
  const collective = /\b(?:tutte le truppe|tutte le unit(?:a)?|tutti i battaglioni|tutti gli eserciti|all (?:the )?(?:troops|units))\b/.test(folded);
  let selected = [...new Set(named.map(item => item.value))];
  if (collective) {
    if (origins.size !== 1 || named.length > 0) return [];
    selected = units.filter(unit => unit.region.id === [...origins][0]
      && (unit.object.owner || unit.region.owner) === playerId);
    if (/\btutti i battaglioni\b/.test(folded)) selected = selected.filter(unit => unit.object.type === 'battalion');
    if (/\btutti gli eserciti\b/.test(folded)) selected = selected.filter(unit => unit.object.type === 'army');
  } else {
    if (!selected.length) return [];
    // Do not pick between same-name formations (including hostile formations).
    if (selected.some(unit => units.filter(other => normalizeName(other.object.name || '') === normalizeName(unit.object.name || '')).length !== 1)) return [];
  }
  if (selected.some(unit => (unit.object.owner || unit.region.owner) !== playerId)) return [];
  if (origins.size && selected.some(unit => unit.region.id !== [...origins][0] && unit.region.id !== targetId)) return [];
  return selected.filter(unit => typeof unit.object.id === 'string' && unit.object.id
    && units.filter(other => other.object.id === unit.object.id).length === 1)
    .map(unit => ({ actionId, unitId: unit.object.id, unitName: unit.object.name, unitType: unit.object.type,
      originId: unit.region.id, targetId, fingerprint: JSON.stringify(unit.object) }));
}
