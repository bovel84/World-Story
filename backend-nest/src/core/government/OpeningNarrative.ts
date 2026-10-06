/**
 * WS-GAME-OPENING-IMMERSION — L'OpeningContext e la narrativa semantica
 * ====================================================================
 * Un **unico** read model backend, di sola lettura, che raccoglie ciò che le
 * fonti di verità già dicono sul mondo, sul paese e sul governo; e la narrativa
 * **semantica** che ne deriva. Niente `paragraphs[]` presi a caso dal preset:
 * quattro campi con un significato — che mondo è questo, cosa succede nella
 * regione, perché riguarda proprio il mio paese.
 *
 * Gerarchia: stato del motore > storia della partita > preset/lore > renderer.
 * Il renderer LLM (in `OpeningNarrativeRenderer.ts`) vive fuori da questo
 * modulo: qui c'è il **fallback deterministico** e la **validazione** che
 * protegge dal renderer (cifre non presenti = rifiuto).
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import { personaFor } from './MinisterPersona';
import type { CabinetAddress, CabinetSeat } from './Cabinet';

export interface OpeningWorldFact {
  id: string;
  label: string;
  detail?: string;
  severity?: string;
  /** Il fatto coinvolge direttamente la polity del giocatore. */
  playerInvolved?: boolean;
  /** Il fatto è in una regione confinante / attore collegato. */
  border?: boolean;
}

export interface OpeningPriority {
  id: string;
  label: string;
  detail?: string;
  severity: string;
}

export interface OpeningCouncilInput {
  seat: CabinetSeat;
  label: string;
  line: string;
}

/** Il contesto verificato dell'apertura: solo dati esistenti, nessuna copia persistente. */
export interface OpeningContext {
  world: { name: string; date: string; premise: string; rules: string };
  nation: { name: string; polityId: string; verifiedSituation: string[]; questions: string[] };
  worldFacts: OpeningWorldFact[];
  priorities: OpeningPriority[];
  council: OpeningCouncilInput[];
}

/** Il prologo **semantico**: risponde a «che mondo è questo / cosa succede / perché mi riguarda». */
export interface OpeningWorldNarrative {
  headline?: string;
  worldOrder: string;
  regionalSituation?: string;
  stakesForNation: string;
}

export interface OpeningNarrativeResponse {
  generated: boolean;
  deterministic: boolean;
  world: { name: string; date: string; narrative: OpeningWorldNarrative };
  nation: { framing: string; questions: string[] };
  council: OpeningCouncilInput[];
}

export interface OpeningContextInput {
  worldName?: string | null;
  date?: string | null;
  premise?: string | null;
  rules?: string | null;
  nationName?: string | null;
  polityId?: string | null;
  verifiedSituation?: readonly string[];
  /** WS-GOV-PRESET-REALITY-PIPELINE — questioni derivate dai segnali reali (numero reale, non fisso). */
  questions?: readonly string[] | null;
  worldFacts?: readonly OpeningWorldFact[] | null;
  priorities?: readonly OpeningPriority[] | null;
  addresses?: readonly CabinetAddress[] | null;
}

const MIN_BLOCK_CHARS = 24;

/** Ripulisce il testo del preset: via titoli markdown, elenchi, enfasi. */
export function cleanPremise(value: string): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function clipWords(text: string, maxWords: number): string {
  const tokens = words(text);
  if (tokens.length <= maxWords) return text;
  return `${tokens.slice(0, maxWords).join(' ').replace(/[,;:]$/, '')}…`;
}

/** Paragrafi brevi dal preset, entro un limite di parole. Deterministica. */
export function extractOpeningParagraphs(
  premise: string,
  options: { maxParagraphs?: number; maxWords?: number } = {},
): string[] {
  const maxParagraphs = options.maxParagraphs ?? 4;
  const maxWords = options.maxWords ?? 220;
  const text = cleanPremise(premise);
  if (!text) return [];

  const blocks = text
    .split(/\n\s*\n+/)
    .map(block => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(block => block.length >= MIN_BLOCK_CHARS);
  const source = blocks.length > 0 ? blocks : [text.replace(/\s+/g, ' ')];

  const out: string[] = [];
  let usedWords = 0;
  for (const block of source) {
    if (out.length >= maxParagraphs || usedWords >= maxWords) break;
    const sentences = block.split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = sentences.slice(0, 2).join(' ');
    const candidate = clipWords(kept, Math.max(24, maxWords - usedWords));
    if (!candidate) continue;
    out.push(candidate);
    usedWords += words(candidate).length;
  }
  return out;
}

/**
 * La voce di una sedia: **persona + verified state**, senza cifre inventate.
 * La firma di stile di `MinisterPersona` più la prima questione del motore
 * (`CabinetItem.need`), che entra solo se breve e priva di cifre.
 */
export function openingCouncilLine(address: CabinetAddress): string {
  const signature = personaFor(address.seat).signature
    .replace(/^[«"]\s*/, '')
    .replace(/\s*[»"]$/, '')
    .replace(/[.]$/, '');
  const issue = String(address.items[0]?.need ?? '').trim();
  const safeIssue = issue.length > 0 && issue.length <= 80 && !/\d/.test(issue);
  if (!safeIssue) return `${signature}.`;
  const lower = issue[0].toLowerCase() + issue.slice(1);
  return `${signature} — ${lower.replace(/[.]$/, '')}.`;
}

function councilFromAddresses(addresses: readonly CabinetAddress[] | null | undefined): OpeningCouncilInput[] {
  return [...(addresses ?? [])]
    .filter(address => address.items.length > 0)
    .map((address, index) => ({
      address,
      index,
      rank: address.items.some(item => item.urgency === 'critica') ? 0 : 1,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 3)
    .map(({ address }) => ({ seat: address.seat, label: address.label, line: openingCouncilLine(address) }));
}

/** Le questioni del motore per il paese (agenda del consiglio), deduplicate. */
export function verifiedSituationFromAddresses(addresses: readonly CabinetAddress[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of addresses ?? []) {
    for (const item of address.items) {
      const need = String(item.need ?? '').trim();
      if (!need || seen.has(need)) continue;
      seen.add(need);
      out.push(need);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

/** Costruisce l'**unico** read model backend dai dati già esistenti. */
export function buildOpeningContext(input: OpeningContextInput): OpeningContext {
  const addresses = input.addresses ?? null;
  const council = councilFromAddresses(addresses);
  const priorities: OpeningPriority[] = input.priorities
    ? [...input.priorities].slice(0, 8)
    : (addresses ?? [])
      .flatMap(address => address.items.slice(0, 1).map(item => ({
        id: `${address.seat}:${item.voiceId}`,
        label: String(item.need ?? '').trim(),
        ...(item.because ? { detail: String(item.because).trim() } : {}),
        severity: String(item.urgency ?? 'ordinaria'),
      })))
      .filter(p => p.label)
      .slice(0, 8);
  const verifiedSituation = input.verifiedSituation && input.verifiedSituation.length > 0
    ? input.verifiedSituation.map(s => String(s).trim()).filter(Boolean).slice(0, 5)
    : verifiedSituationFromAddresses(addresses);

  return {
    world: {
      name: String(input.worldName ?? '').trim(),
      date: String(input.date ?? '').trim(),
      premise: cleanPremise(String(input.premise ?? '')),
      rules: cleanPremise(String(input.rules ?? '')),
    },
    nation: {
      name: String(input.nationName ?? '').trim(),
      polityId: String(input.polityId ?? '').trim(),
      verifiedSituation,
      questions: (input.questions ?? []).map(q => String(q).trim()).filter(Boolean).slice(0, 3),
    },
    worldFacts: [...(input.worldFacts ?? [])].slice(0, 6),
    priorities,
    council,
  };
}

/**
 * Il prologo deterministico **semantico**. `worldOrder` è il primo blocco del
 * preset (l'ordine del mondo); `regionalSituation` il secondo, se esiste;
 * `stakesForNation` lega il mondo al paese usando solo dati verificati.
 */
export function buildDeterministicWorldNarrative(context: OpeningContext): OpeningWorldNarrative {
  // Il primo blocco del preset è l'ordine del mondo; il secondo, se c'è, la
  // situazione regionale. Il briefing nazionale NON viene da qui (vedi
  // `nation.verifiedSituation`/`questions`): è il Consulente a parlare del paese.
  const paragraphs = extractOpeningParagraphs(context.world.premise, { maxParagraphs: 3, maxWords: 220 });
  // §3A — Il contesto mondiale apre con una frase breve, non con il briefing
  // intero: subito dopo parlano il paese e le sue questioni.
  const worldOrder = clipWords(paragraphs[0] ?? '', 45);
  const regionalSituation = paragraphs[1];
  const stakes = buildStakesForNation(context);
  const headline = context.world.date || undefined;
  return {
    ...(headline ? { headline } : {}),
    worldOrder,
    ...(regionalSituation ? { regionalSituation } : {}),
    stakesForNation: stakes,
  };
}

function buildStakesForNation(context: OpeningContext): string {
  const rawName = context.nation.name;
  // Un codice polity (es. «ITA») non è un nome da leggere: si dice «il tuo paese».
  const nation = rawName && !/^[A-Z0-9_-]{2,5}$/.test(rawName) ? rawName : 'il tuo paese';
  const facts: string[] = [];
  if (context.nation.verifiedSituation[0]) facts.push(context.nation.verifiedSituation[0]);
  if (context.worldFacts[0]?.label) facts.push(context.worldFacts[0].label);
  if (facts.length === 0) {
    return `Per ${nation}, le scelte interne saranno inseparabili dalla posizione che saprà costruirsi in questo ordine.`;
  }
  const detail = facts.join(' ').replace(/[.]$/, '');
  return `Per ${nation}, questo significa: ${detail}.`;
}

/** Il quadro del paese in forma discorsiva, dai soli dati verificati. */
export function buildDeterministicNationFraming(context: OpeningContext): string {
  const situation = context.nation.verifiedSituation;
  if (situation.length === 0) return '';
  return situation.slice(0, 3).map(s => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
}

/** La risposta deterministica completa (fallback obbligatorio). */
export function buildDeterministicOpeningResponse(context: OpeningContext): OpeningNarrativeResponse {
  return {
    generated: false,
    deterministic: true,
    world: {
      name: context.world.name,
      date: context.world.date,
      narrative: buildDeterministicWorldNarrative(context),
    },
    nation: { framing: buildDeterministicNationFraming(context), questions: [...context.nation.questions] },
    council: context.council,
  };
}

// ── Validazione dell'output del renderer ────────────────────────────────────

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
const FORBIDDEN_METAWORDS = ['preset', 'scenario', 'prompt', 'engine', 'context', 'llm', 'simulazione', 'gioco'];
/** Parole istituzionali comuni che possono comparire senza essere nel preset. */
const COMMON_CAPITALIZED = new Set([
  'presidente', 'governo', 'ministro', 'ministri', 'paese', 'stato', 'consiglio',
  'nazione', 'signore', 'signora', 'oggi', 'domani', 'ieri',
]);

function numbersIn(text: string): string[] {
  return String(text ?? '').match(NUMBER_RE) ?? [];
}

function normalizeNumber(value: string): string {
  return value.replace(',', '.').replace(/^0+(?=\d)/, '');
}

/** Guardiano numerico condiviso dai renderer read-only: virgola/punto equivalenti, niente arrotondamenti. */
export function narrativeNumbersAreVerified(text: string, verified: string): boolean {
  const allowed = new Set(numbersIn(verified).map(normalizeNumber));
  return numbersIn(text).every(number => allowed.has(normalizeNumber(number)));
}

/** Tutto il materiale verificato contro cui validare il testo del renderer. */
function verifiedBlob(context: OpeningContext): string {
  return [
    context.world.premise,
    context.world.rules,
    context.world.date,
    context.nation.name,
    ...context.nation.verifiedSituation,
    ...context.worldFacts.flatMap(f => [f.label, f.detail ?? '']),
    ...context.priorities.flatMap(p => [p.label, p.detail ?? '']),
    ...context.council.flatMap(c => [c.line, c.label, c.seat] as string[]),
  ].join(' \n ');
}

/**
 * Valida un testo contro l'OpeningContext: nessuna cifra non presente, nessun
 * **proper noun nuovo**, nessuna parola di metadato. È il guardiano che può
 * **rifiutare** l'output del renderer. Non è un fact checker universale: copre
 * cifre/date e i nomi propri evidenti introdotti dal modello (§8, §33).
 */
export function validateTextAgainstContext(text: string, context: OpeningContext): { ok: boolean; reason?: string } {
  const body = String(text ?? '');
  if (!body.trim()) return { ok: false, reason: 'testo vuoto' };
  const lower = body.toLowerCase();
  for (const word of FORBIDDEN_METAWORDS) {
    if (lower.includes(word)) return { ok: false, reason: `metadato vietato: ${word}` };
  }
  const blob = verifiedBlob(context);
  const blobLower = blob.toLowerCase();
  if (!narrativeNumbersAreVerified(body, blob)) return { ok: false, reason: 'cifra non verificata' };
  // Proper noun nuovi: un token maiuscolo "interno" (non a inizio frase) che
  // non compare come **parola** nel materiale verificato e non è una parola
  // istituzionale comune.
  for (const token of properNouns(body)) {
    if (COMMON_CAPITALIZED.has(token.toLowerCase())) continue;
    if (containsWord(blobLower, token.toLowerCase())) continue;
    return { ok: false, reason: `nome non verificato: ${token}` };
  }
  return { ok: true };
}

/** Match come parola intera (non sottostringa): evita che «c» passi per «città». */
function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zà-öø-ÿ])${escaped}([^a-zà-öø-ÿ]|$)`, 'u').test(haystack);
}

/** Token maiuscoli non a inizio frase: candidati a nomi propri introdotti dal modello. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const re = /(^|[.!?:;\n]\s+|[\s(\[])([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'’-]*)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lead = match[1];
    const token = match[2];
    if (lead === '' || /^[.!?:;\n]/.test(lead.trim())) continue; // inizio frase: non è prova
    out.push(token);
  }
  return out;
}

export function validateOpeningWorldNarrative(
  narrative: OpeningWorldNarrative,
  context: OpeningContext,
): { ok: boolean; reason?: string } {
  const parts = [narrative.headline, narrative.worldOrder, narrative.regionalSituation, narrative.stakesForNation]
    .filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return { ok: false, reason: 'narrativa vuota' };
  return validateTextAgainstContext(parts.join(' \n '), context);
}

// ── Contratto del renderer (prompt puro, testabile) ─────────────────────────

export const OPENING_NARRATIVE_SYSTEM = 'Sei un narratore istituzionale di World Story.';

export function composeOpeningNarrativePrompt(context: OpeningContext): string {
  return [
    'Ricevi un OpeningContext VERIFICATO (già filtrato dalle fonti di verità).',
    'Scrivi SOLO prosa di presentazione, in italiano, tono sobrio e istituzionale.',
    'NON aggiungere fatti, numeri, date, nomi, paesi, alleanze, ostilità o eventi che non siano presenti nel contesto.',
    'Se un dato non c\'è, non inventarlo. NON parlare di preset, motore, prompt, simulazione, dati o gioco.',
    'Il giocatore vive in questo mondo.',
    '',
    'CONTESTO VERIFICATO:',
    `Mondo: ${context.world.name} (${context.world.date})`,
    `Premessa: ${context.world.premise}`,
    `Regole: ${context.world.rules}`,
    `Paese: ${context.nation.name}`,
    `Situazione verificata del paese: ${context.nation.verifiedSituation.join(' | ') || '(nessuna)'}`,
    `Fatti del mondo: ${context.worldFacts.map(f => `${f.label}${f.detail ? ` (${f.detail})` : ''}`).join(' | ') || '(nessuno)'}`,
    `Questioni del governo: ${context.priorities.map(p => p.label).join(' | ') || '(nessuna)'}`,
    `Sedie: ${context.council.map(c => `${c.seat}=${c.label}`).join(' | ') || '(nessuna)'}`,
    '',
    'Restituisci SOLO un oggetto JSON con questa forma:',
    '{',
    '  "headline": "breve titolo d\'epoca (opzionale)",',
    '  "worldOrder": "che mondo è questo: epoca e ordine internazionale",',
    '  "regionalSituation": "situazione regionale rilevante, se presente",',
    '  "stakesForNation": "perché questo riguarda proprio il mio paese",',
    '  "nationFraming": "2-3 frasi sullo stato specifico del paese, solo dai fatti verificati",',
    '  "council": [ { "seat": "lavori", "line": "una breve frase in prima persona" } ]',
    '}',
    'Massimo 3 voci di council, solo per le sedie elencate. Nessuna cifra inventata.',
  ].join('\n');
}

export interface ParsedOpeningNarrative {
  world: OpeningWorldNarrative;
  nationFraming: string;
  council: Array<{ seat: string; line: string }>;
}

/** Estrae e normalizza il JSON del renderer. `null` se non è parsabile. */
export function parseOpeningNarrativeJson(content: unknown): ParsedOpeningNarrative | null {
  const raw = String(content ?? '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: any;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const world: OpeningWorldNarrative = {
    ...(str(data.headline) ? { headline: str(data.headline) } : {}),
    worldOrder: str(data.worldOrder),
    ...(str(data.regionalSituation) ? { regionalSituation: str(data.regionalSituation) } : {}),
    stakesForNation: str(data.stakesForNation),
  };
  if (!world.worldOrder || !world.stakesForNation) return null;
  const council = Array.isArray(data.council)
    ? data.council
      .map((entry: any) => ({ seat: str(entry?.seat), line: str(entry?.line) }))
      .filter((entry: { seat: string; line: string }) => entry.seat && entry.line)
    : [];
  return { world, nationFraming: str(data.nationFraming), council };
}
