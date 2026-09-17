import { normalizeName } from './name-resolver';

/**
 * Formazioni realmente spostabili. Include `mobilization`: un reparto in
 * formazione è già sul terreno e può essere trasferito (con l'equipaggiamento
 * disponibile), non è una semplice intenzione.
 */
export const UNIT_TYPES = new Set(['battalion', 'army', 'fleet', 'missile', 'mobilization']);

interface MovementObject { type?: string; name?: string; metadata?: Record<string, any> | null }
interface MovementRegion {
  id: string;
  name: string;
  owner: string;
  objects: any[];
}

/** Tipo operativo effettivo: una mobilitazione conta come il reparto previsto. */
export function unitEffectiveType(object: MovementObject): string {
  if (object?.type === 'mobilization') {
    const planned = object.metadata?.plannedType;
    return typeof planned === 'string' && planned ? planned : 'battalion';
  }
  return String(object?.type || '');
}

/** Il modello chiede `battalion` e l'unità è una mobilitazione pianificata come tale. */
export function unitMatchesType(object: MovementObject, requested?: string): boolean {
  if (!requested) return true;
  if (object?.type === requested) return true;
  return unitEffectiveType(object) === requested;
}

/** Prefisso di token distintivo dell'unità presente nell'ordine ("3 battaglione"). */
export function unitNameMatchesPrefix(orderName: string, unitName: string): boolean {
  const order = normalizeName(orderName);
  const unit = normalizeName(unitName);
  if (!order || !unit) return false;
  if (unit === order || unit.startsWith(`${order} `)) return true;
  const orderTokens = order.split(' ').filter(Boolean);
  const unitTokens = unit.split(' ').filter(Boolean);
  if (orderTokens.length < 2 || unitTokens.length < 2) return false;
  const prefix = orderTokens.join(' ');
  return unitTokens.join(' ').startsWith(`${prefix} `);
}

/** Serializable, pre-event intent: never discover newly spawned replacements at completion. */
export interface MovementIntent {
  actionId: string;
  unitId: string;
  unitName: string;
  unitType: string;
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

/**
 * Destinazione di un movimento: id esatto, nome esatto, poi prefisso/inclusione
 * **solo se univoci**, infine una città/porto con quel nome dentro una sola
 * provincia. Mai "random"/direzioni: un marker materiale non va inventato.
 */
export function resolveMovementRegion<T extends MovementRegion>(regions: T[], key?: string): T | undefined {
  const exact = exactMovementRegion(regions, key);
  if (exact) return exact;
  if (!key) return undefined;
  const needle = normalizeName(key);
  if (!needle) return undefined;
  const prefix = regions.filter(region => {
    const name = normalizeName(region.name);
    // Solo troncamento ("Поль" → "Польша"): mai accettare un nome con token
    // aggiuntivi non verificabili ("Italia orientale").
    return name.startsWith(needle);
  });
  if (prefix.length === 1) return prefix[0];
  const contained = regions.filter(region => {
    const name = normalizeName(region.name);
    return name.includes(needle);
  });
  if (contained.length === 1) return contained[0];
  const byObject = regions.filter(region => (region.objects || [])
    .some((object: MovementObject) => normalizeName(object.name || '') === needle));
  return byObject.length === 1 ? byObject[0] : undefined;
}

interface Mention<T> { value: T; start: number; end: number; exact: boolean }
function mentions<T>(text: string, values: T[], name: (value: T) => string, exact = true): Mention<T>[] {
  const found: Mention<T>[] = [];
  for (const value of values) {
    const needle = normalizeName(name(value) || '');
    if (!needle) continue;
    let start = text.indexOf(needle);
    while (start >= 0) {
      const end = start + needle.length;
      if ((start === 0 || text[start - 1] === ' ') && (end === text.length || text[end] === ' ')) {
        found.push({ value, start, end, exact });
      }
      start = text.indexOf(needle, start + 1);
    }
  }
  // "I Armata" must not match inside "II Armata"; "Roma" must not
  // also select a second province when the order explicitly names "Roma Nord".
  return found.filter(item => !found.some(other => other.start <= item.start && other.end >= item.end
    && (other.start < item.start || other.end > item.end)));
}

type UnitRef = { region: MovementRegion; object: any };
/** Menzione dell'unità: nome pieno oppure prefisso di token univoco ("3 battaglione"). */
function unitMentions(folded: string, units: UnitRef[]): Mention<UnitRef>[] {
  const found = [...mentions(folded, units, unit => unit.object.name, true)];
  for (const unit of units) {
    const tokens = normalizeName(unit.object.name || '').split(' ').filter(Boolean);
    if (tokens.length < 2) continue;
    let span: { start: number; end: number } | null = null;
    for (let length = Math.min(tokens.length, 5); length >= 2; length--) {
      const needle = tokens.slice(0, length).join(' ');
      const start = folded.indexOf(needle);
      if (start < 0) continue;
      const end = start + needle.length;
      if ((start === 0 || folded[start - 1] === ' ') && (end === folded.length || folded[end] === ' ')) {
        span = { start, end };
        break;
      }
    }
    if (span) found.push({ value: unit, ...span, exact: false });
  }
  const merged = new Map<string, Mention<UnitRef>>();
  for (const item of found) {
    const key = item.value.object.id || item.value.object.name;
    const previous = merged.get(key);
    // Prefer the longest span; an exact full-name win is recorded as exact.
    if (!previous || (item.end - item.start) > (previous.end - previous.start)) merged.set(key, item);
  }
  return [...merged.values()];
}

/**
 * Menzione di regione tollerante al troncamento: "gwanda" identifica
 * "Gwanda ZWE" se il prefisso è univoco. Mai quando l'ordine aggiunge token
 * non verificabili ("Italia orientale").
 *
 * Terza via, allineata a `resolveMovementRegion`: un ordine può indicare una
 * **città** ("Vienna", "Monaco") invece di una regione. La città è valida solo
 * se quel nome identifica UNA sola regione: se lo stesso nome esiste in più
 * regioni la menzione è ambigua e il parser rifiuta l'ordine invece di
 * spostare un reparto nel paese sbagliato.
 */
function regionMentions(folded: string, regions: MovementRegion[]): Mention<MovementRegion>[] {
  const found = [...mentions(folded, regions, region => region.name, true)];
  for (const region of regions) {
    const tokens = normalizeName(region.name).split(' ').filter(Boolean);
    if (tokens.length < 2) continue;
    for (let length = tokens.length - 1; length >= 1; length--) {
      const needle = tokens.slice(0, length).join(' ');
      const start = folded.indexOf(needle);
      if (start < 0) continue;
      const end = start + needle.length;
      if ((start === 0 || folded[start - 1] === ' ') && (end === folded.length || folded[end] === ' ')) {
        // Il prefisso deve identificare UNA sola regione al mondo.
        const matches = regions.filter(other => {
          const name = normalizeName(other.name);
          return name === needle || name.startsWith(`${needle} `);
        });
        if (matches.length === 1) found.push({ value: region, start, end, exact: false });
        break;
      }
    }
  }
  const merged = new Map<string, Mention<MovementRegion>>();
  for (const item of found) {
    const previous = merged.get(item.value.id);
    if (!previous || (item.end - item.start) > (previous.end - previous.start)) merged.set(item.value.id, item);
  }
  // Città/porti: indice unico nome → regioni, costruito una volta per ordine.
  const byObjectName = new Map<string, MovementRegion[]>();
  for (const region of regions) {
    for (const object of region.objects || []) {
      const name = normalizeName(object?.name || '');
      if (name.length < 3) continue;
      const list = byObjectName.get(name) || [];
      list.push(region);
      byObjectName.set(name, list);
    }
  }
  const words = folded.trim().split(' ').filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    for (let length = Math.min(3, words.length - start); length >= 1; length--) {
      const needle = words.slice(start, start + length).join(' ');
      if (needle.length < 3) continue;
      const matches = byObjectName.get(needle);
      if (!matches || matches.length !== 1) continue;
      const region = matches[0];
      if ([...merged.values()].some(item => item.value.id === region.id)) break;
      const span = folded.indexOf(needle);
      if (span < 0 || (span > 0 && folded[span - 1] !== ' ')) break;
      const end = span + needle.length;
      if (end !== folded.length && folded[end] !== ' ') break;
      merged.set(region.id, { value: region, start: span, end, exact: false });
      break;
    }
  }
  return [...merged.values()];
}

const GENERIC_UNIT_TYPES: Array<[RegExp, string | null]> = [
  [/^battaglion/, 'battalion'], [/^armat/, 'army'], [/^esercit/, 'army'],
  [/^flott/, 'fleet'], [/^missil/, 'missile'], [/^trupp/, null], [/^unita$/, null],
];
function genericUnitType(folded: string): string | null | undefined {
  for (const word of folded.split(' ')) {
    for (const [pattern, type] of GENERIC_UNIT_TYPES) if (pattern.test(word)) return type;
  }
  return undefined;
}

/** Perché un ordine di movimento NON è stato eseguito. Sempre spiegabile al giocatore. */
export type MovementBlockCode =
  | 'negated'
  | 'no_destination'
  | 'ambiguous_destination'
  | 'no_unit'
  | 'ambiguous_unit'
  | 'not_owned'
  | 'origin_mismatch'
  | 'unknown_words';

export interface MovementBlock {
  code: MovementBlockCode;
  /** Motivazione leggibile: finisce nel dispaccio/risultato dell'ordine. */
  message: string;
}

export interface MovementAnalysis {
  intents: MovementIntent[];
  /** Presente solo se il testo È un ordine di movimento ma non è eseguibile. */
  block?: MovementBlock;
}

function blocked(code: MovementBlockCode, message: string): MovementAnalysis {
  return { intents: [], block: { code, message } };
}

/**
 * Analizza un ordine di movimento: produce gli intenti eseguibili **e**, quando
 * l'ordine è di movimento ma non è eseguibile, la ragione esatta. È la stessa
 * logica di `parseMovementOrder` (che ora la riusa): un solo parser, una sola
 * verità, e nessun blocco silenzioso.
 *
 * Intentionally narrow: one unconditional destination, explicit units or all
 * troops from one origin.
 */
export function analyzeMovementOrder(
  text: string, regions: MovementRegion[], playerId: string, actionId: string,
): MovementAnalysis {
  // Keep parenthetical instructions/negations; the shared name normalizer
  // otherwise drops their contents (appropriate for labels, not commands).
  const folded = normalizeName(String(text || '').replace(/[()]/g, ' '));
  // An attack can be conducted at range: only explicit relocation verbs
  // authorize a fallback move. Mixed attack/move orders fail the word check below.
  const movementVerb = /^(?:muov\w*|spost\w*|avanz\w*|invad\w*|occup\w*|schier\w*|trasfer\w*|marcia\w*|conquist\w*|invia\w*|deploy\w*|move\w*)$/;
  // Non è un ordine di movimento: nessun blocco, non c'è nulla da spiegare.
  if (!folded.split(' ').some(word => movementVerb.test(word))) return { intents: [] };
  // Do not interpret negations, alternatives, conditions or preparatory orders as execution.
  if (/\b(non|mai|senza|nessun\w*|evita\w*|annulla\w*|ferma\w*|rinvia\w*|aspetta\w*|attendi\w*|pianifica\w*|prepara\w*|valuta\w*|se|qualora|oppure|o|not|never|don|without|if|unless|or|plan\w*)\b/.test(folded)) {
    return blocked('negated', 'ordine negativo, condizionale o preparatorio: nessuno spostamento eseguito nel periodo.');
  }
  const units = regions.flatMap(region => (region.objects || [])
    .filter(object => UNIT_TYPES.has(object.type))
    .map(object => ({ region, object })));
  const named = unitMentions(folded, units);
  // Region names inside unit names are not destinations.
  const places = regionMentions(folded, regions)
    .filter(place => !named.some(unit => unit.start <= place.start && unit.end >= place.end));
  const article = '(?:il |lo |la |le |gli |i |l\u2019|l\u0027)?';
  const sources = places.filter(place => new RegExp(`(?:^| )(?:da|dal|dalla|dallo|dalle|dai|dagli|dall|from) (?:regione |provincia )?${article}$`).test(folded.slice(0, place.start)));
  const destinations = places.filter(place => new RegExp(`(?:^| )(?:a|ad|al|alla|allo|alle|ai|agli|all|in|nel|nella|nelle|nell|verso|su|contro|to|into|toward|towards) (?:regione |provincia )?${article}$`).test(folded.slice(0, place.start)));
  // Every mentioned province must have an explicit role. No "last mention wins".
  if (places.some(place => !sources.includes(place) && !destinations.includes(place))) {
    return blocked('ambiguous_destination', 'non è chiaro quale luogo sia la destinazione: indica una sola destinazione con «in …» o «verso …».');
  }
  const targets = new Set(destinations.map(place => place.value.id));
  const origins = new Set(sources.map(place => place.value.id));
  if (targets.size === 0) {
    return blocked('no_destination', 'nessuna destinazione riconosciuta: indica la regione o la città di destinazione per nome.');
  }
  if (targets.size !== 1 || origins.size > 1) {
    return blocked('ambiguous_destination', 'destinazione o origine ambigue: indica una sola destinazione e una sola origine.');
  }
  const targetId = [...targets][0];
  // Repeated/duplicate normalized province names are ambiguous even in directional phrases.
  if (places.some(place => !exactMovementRegion(regions, place.value.name))) {
    return blocked('ambiguous_destination', 'il nome del luogo indicato è ambiguo: più regioni hanno lo stesso nome, specifica la destinazione.');
  }
  // Account for every remaining word. This rejects unknown named units,
  // truncated place names ("Italia orientale"), and mixed orders such as
  // "sposta A e lascia B", rather than moving a recognized subset by accident.
  const masked = [...folded];
  for (const mention of [...named, ...places]) {
    for (let i = mention.start; i < mention.end; i++) masked[i] = ' ';
  }
  const connective = /^(?:ordina\w*|ordin\w*|di|a|ad|al|alla|allo|alle|ai|agli|all|da|dal|dalla|dallo|dalle|dai|dagli|dall|in|nel|nella|nelle|nell|verso|su|contro|fino|e|ed|il|lo|la|le|gli|i|l|un|una|unit|unita|truppe|battaglioni|battaglione|armate|armata|eserciti|esercito|flotte|flotta|missili|missile|tutte|tutti|regione|provincia|immediatamente|subito|ora|from|to|into|toward|towards|all|the|troops|units|and|please)$/;
  const unknown = masked.join('').trim().split(/\s+/).filter(word => word && !movementVerb.test(word) && !connective.test(word));
  if (unknown.length > 0) {
    return blocked('unknown_words', `l'ordine contiene elementi non verificabili («${unknown.slice(0, 3).join(' ')}»): riformula indicando formazione e destinazione.`);
  }
  const collective = /\b(?:tutte le truppe|tutte le unit(?:a)?|tutti i battaglioni|tutti gli eserciti|all (?:the )?(?:troops|units))\b/.test(folded);
  let selected = [...new Map(named.map(item => [item.value.object.id || item.value.object.name, item.value])).values()];
  if (collective) {
    if (origins.size !== 1 || named.length > 0) {
      return blocked('no_unit', 'per spostare tutte le truppe indica una sola origine («da …») e nessuna formazione specifica.');
    }
    selected = units.filter(unit => unit.region.id === [...origins][0]
      && (unit.object.owner || unit.region.owner) === playerId);
    if (/\btutti i battaglioni\b/.test(folded)) selected = selected.filter(unit => unitEffectiveType(unit.object) === 'battalion');
    if (/\btutti gli eserciti\b/.test(folded)) selected = selected.filter(unit => unitEffectiveType(unit.object) === 'army');
    if (selected.length === 0) {
      return blocked('no_unit', 'nessuna formazione di questa nazione si trova nell\'origine indicata.');
    }
  } else if (!selected.length) {
    // Riferimento generico ("il battaglione", "l'esercito"): ammesso solo se
    // identifica UNA sola formazione del giocatore (all'origine, o nel mondo).
    const requested = genericUnitType(folded);
    if (requested === undefined) {
      return blocked('no_unit', 'nessuna formazione riconosciuta: indica il nome della formazione da spostare.');
    }
    const pool = units.filter(unit => (unit.object.owner || unit.region.owner) === playerId
      && (requested === null || unitEffectiveType(unit.object) === requested));
    const scoped = origins.size === 1 ? pool.filter(unit => unit.region.id === [...origins][0]) : pool;
    if (scoped.length === 1) selected = [scoped[0]];
    else if (pool.length === 1) selected = [pool[0]];
    else return blocked('ambiguous_unit', 'la formazione indicata non è univoca: specifica il nome esatto.');
  } else {
    // A short reference ("3 battaglione") must identify exactly one formation;
    // only full, unambiguous names may move several units in one order.
    const tolerant = named.some(item => !item.exact);
    if (tolerant && selected.length > 1) {
      return blocked('ambiguous_unit', 'il riferimento breve alla formazione non è univoco: indica il nome completo.');
    }
    // Do not pick between same-name formations (including hostile formations).
    if (selected.some(unit => units.filter(other => normalizeName(other.object.name || '') === normalizeName(unit.object.name || '')).length !== 1)) {
      return blocked('ambiguous_unit', 'più formazioni hanno lo stesso nome: lo spostamento non può essere deciso dal motore.');
    }
  }
  if (selected.some(unit => (unit.object.owner || unit.region.owner) !== playerId)) {
    return blocked('not_owned', 'la formazione indicata non appartiene a questa nazione.');
  }
  if (origins.size && selected.some(unit => unit.region.id !== [...origins][0] && unit.region.id !== targetId)) {
    return blocked('origin_mismatch', 'la formazione indicata non si trova nell\'origine dichiarata.');
  }
  const intents = selected.filter(unit => typeof unit.object.id === 'string' && unit.object.id
    && units.filter(other => other.object.id === unit.object.id).length === 1)
    .map(unit => ({ actionId, unitId: unit.object.id, unitName: unit.object.name, unitType: unitEffectiveType(unit.object),
      originId: unit.region.id, targetId, fingerprint: JSON.stringify(unit.object) }));
  if (intents.length === 0) {
    return blocked('no_unit', 'nessuna formazione identificabile in modo univoco: lo spostamento non è stato eseguito.');
  }
  return { intents };
}

/** Intenti eseguibili di un ordine di movimento (compatibilità: solo gli intenti). */
export function parseMovementOrder(
  text: string, regions: MovementRegion[], playerId: string, actionId: string,
): MovementIntent[] {
  return analyzeMovementOrder(text, regions, playerId, actionId).intents;
}
