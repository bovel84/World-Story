/**
 * WS-MINISTER-UX-05 — La memoria del ministro (contratto e motore, puri)
 * =====================================================================
 * La roadmap chiede una memoria conversazionale **persistente**, separata dai
 * numeri del mondo, e chiede di preparare il prompt con «profilo, sintesi breve
 * dei ricordi pertinenti, scambi recenti e fatti aggiornati», senza rimandare
 * ogni volta tutta la cronologia.
 *
 * Questo modulo è la parte **pura** di quella fase: definisce che cos'è un
 * ricordo, come si registra, come si seleziona per il prompt, come si copia su
 * un ramo e come si pota al rewind. Non tocca il database, non fa I/O, non
 * chiama il modello: la persistenza reale è l'innesto (autorizzato) descritto nel
 * report `WS-MINISTER-UX-05-report.md` §6.
 *
 * Tre regole, le stesse del progetto:
 *  - **la memoria non è una seconda contabilità**: non porta cifre nuove e non
 *    sostituisce i fatti aggiornati del briefing (che vincono sempre);
 *  - **ogni ricordo ha un riferimento** (messaggio, atto, ordine, data, turno):
 *    un ricordo senza provenienza non è verificabile e non entra;
 *  - **una decisione futura non compare nel passato**: al rewind si potano i
 *    ricordi oltre il punto di ripristino.
 *
 * Il ricordo distingue ciò che è **discusso** da ciò che è **accodato** da ciò
 * che è **verificato**: «il Presidente valuta una scuola» non è «ha firmato
 * l'ordine» e non è «la scuola è operativa».
 */

import type { CabinetSeat } from './Cabinet';
import { jevScopeKey, type JevMemoryRecord } from './jev/jev.types';

/** Che cosa è un ricordo, nella grammatica concordata con la roadmap. */
export type MinisterMemoryKind =
  | 'objective'           // obiettivo esplicitato dal Presidente
  | 'proposal-discussed'  // una proposta messa sul tavolo
  | 'proposal-rejected'   // una proposta respinta, con il motivo
  | 'open-question'       // una questione rimasta aperta
  | 'queued-decision'     // una decisione accodata (atto nel registro)
  | 'verified-outcome';   // un esito constatato dopo l'avanzamento del tempo

/** Lo stato di un ricordo: dice a che punto è, non cosa vale. */
export type MinisterMemoryState =
  | 'open'
  | 'discussed'
  | 'rejected'
  | 'queued'
  | 'executed'
  | 'verified';

/**
 * L'identità della memoria: partita, ramo, sedia e mandato. Il solo nome della
 * sedia non basta se il ministro cambia: il `mandate` è l'identità di chi siede.
 */
export interface MinisterMemoryScope {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly seat: CabinetSeat;
  readonly mandate: string;
}

/** Il riferimento che rende verificabile un ricordo. La data è del mondo. */
export interface MinisterMemoryRef {
  readonly messageId?: string;
  readonly actId?: string;
  readonly orderId?: string;
  readonly gameDate: string;
  readonly turn?: number;
}

export interface MinisterMemoryRecord {
  /** Chiave stabile: lo stesso `id` aggiorna il ricordo invece di duplicarlo. */
  readonly id: string;
  readonly kind: MinisterMemoryKind;
  readonly summary: string;
  /** Per una proposta respinta: il motivo. Per le altre: assente. */
  readonly reason?: string;
  readonly state: MinisterMemoryState;
  readonly refs: MinisterMemoryRef;
}

export interface MinisterMemory {
  readonly scope: MinisterMemoryScope;
  readonly records: readonly MinisterMemoryRecord[];
}

/** Quanti ricordi si conservano: oltre, si potano i meno significativi. */
export const MINISTER_MEMORY_LIMIT = 40;

/** L'ordine con cui i ricordi contano nel prompt (prima i più vincolanti). */
const KIND_PRIORITY: Record<MinisterMemoryKind, number> = {
  'proposal-rejected': 0,
  'queued-decision': 1,
  'verified-outcome': 2,
  'open-question': 3,
  objective: 4,
  'proposal-discussed': 5,
};

const KIND_LABEL: Record<MinisterMemoryKind, string> = {
  objective: 'obiettivo',
  'proposal-discussed': 'discussa',
  'proposal-rejected': 'respinta',
  'open-question': 'aperta',
  'queued-decision': 'accodata',
  'verified-outcome': 'verificata',
};

const STATE_LABEL: Record<MinisterMemoryState, string> = {
  open: 'aperta',
  discussed: 'discussa',
  rejected: 'respinta',
  queued: 'accodata',
  executed: 'eseguita',
  verified: 'verificato',
};

/** I generi e gli stati ammessi, per la validazione dei dati in arrivo dal client. */
export const MINISTER_MEMORY_KINDS: readonly MinisterMemoryKind[] = [
  'objective', 'proposal-discussed', 'proposal-rejected', 'open-question', 'queued-decision', 'verified-outcome',
];
export const MINISTER_MEMORY_STATES: readonly MinisterMemoryState[] = [
  'open', 'discussed', 'rejected', 'queued', 'executed', 'verified',
];

/**
 * L'identità del mandato, derivata **server-side** dal governo in carica.
 *
 * Il motore non modella un identificativo di legislatura: l'identità è composta
 * da sedia, polity e **fazione dominante** del consiglio. Quando la dominante
 * cambia, il mandato cambia e la memoria non si mescola fra governi diversi.
 * È l'unico punto in cui si decide questa identità.
 */
export function mandateFor(
  seat: CabinetSeat,
  government: { dominantId?: string | null } | null | undefined,
  polityId: string | null | undefined,
): string {
  const dominant = government?.dominantId ?? 'council';
  return `${seat}@${polityId ?? 'unknown'}:${dominant}`;
}

/**
 * Normalizza i ricordi inviati dal client: forma stretta, niente fiducia.
 * Un genere o uno stato fuori vocabolario fa scartare il ricordo, non lo
 * «aggiusta» con un default. Il testo è tagliato a misure sicure.
 */
export function normalizeMinisterMemory(raw: unknown): MinisterMemoryRecord[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set<string>(MINISTER_MEMORY_KINDS);
  const states = new Set<string>(MINISTER_MEMORY_STATES);
  const records: MinisterMemoryRecord[] = [];
  for (const item of raw.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, any>;
    const kind = typeof candidate.kind === 'string' ? candidate.kind : '';
    const state = typeof candidate.state === 'string' ? candidate.state : '';
    if (!kinds.has(kind) || !states.has(state)) continue;
    const refs = candidate.refs && typeof candidate.refs === 'object' ? candidate.refs : {};
    const turn = Number(refs.turn);
    const record: MinisterMemoryRecord = {
      id: typeof candidate.id === 'string' ? candidate.id.slice(0, 120) : '',
      kind: kind as MinisterMemoryKind,
      state: state as MinisterMemoryState,
      summary: typeof candidate.summary === 'string' ? candidate.summary.slice(0, 400) : '',
      ...(typeof candidate.reason === 'string' && candidate.reason.trim()
        ? { reason: candidate.reason.slice(0, 400) }
        : {}),
      refs: {
        ...(typeof refs.messageId === 'string' ? { messageId: refs.messageId.slice(0, 80) } : {}),
        ...(typeof refs.actId === 'string' ? { actId: refs.actId.slice(0, 80) } : {}),
        ...(typeof refs.orderId === 'string' ? { orderId: refs.orderId.slice(0, 80) } : {}),
        gameDate: typeof refs.gameDate === 'string' ? refs.gameDate.slice(0, 10) : '',
        ...(Number.isFinite(turn) ? { turn } : {}),
      },
    };
    if (isValid(record)) records.push(record);
  }
  return records;
}

/** Una memoria vuota, con la sua identità: il punto di partenza. */
export function emptyMinisterMemory(scope: MinisterMemoryScope): MinisterMemory {
  return { scope, records: [] };
}

export function isMinisterMemoryEmpty(memory: MinisterMemory | null | undefined): boolean {
  return !memory || memory.records.length === 0;
}

/** Un ricordo ha senso solo con una sintesi e una data: niente provenienza, niente ricordo. */
function isValid(record: MinisterMemoryRecord): boolean {
  return Boolean(
    record.id
    && record.summary.trim()
    && record.refs
    && typeof record.refs.gameDate === 'string'
    && record.refs.gameDate.trim(),
  );
}

/**
 * Registra un ricordo. Se l'`id` esiste già, **aggiorna** (stato, motivo, refs):
 * è così che «discussa» diventa «accodata» senza duplicare la voce. Oltre il
 * limite si potano i ricordi meno significativi e più vecchi.
 */
export function recordMinisterMemory(
  memory: MinisterMemory,
  input: MinisterMemoryRecord,
): MinisterMemory {
  if (!isValid(input)) return memory;
  const records = memory.records.some(record => record.id === input.id)
    ? memory.records.map(record => (record.id === input.id ? input : record))
    : [...memory.records, input];
  return { ...memory, records: pruneToLimit(records) };
}

/** Tiene i ricordi più significativi (e, a parità, i più recenti). */
function pruneToLimit(records: readonly MinisterMemoryRecord[]): readonly MinisterMemoryRecord[] {
  if (records.length <= MINISTER_MEMORY_LIMIT) return records;
  const indexed = records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    if (byKind !== 0) return byKind;
    return b.index - a.index; // più recente prima
  });
  const kept = new Set(indexed.slice(0, MINISTER_MEMORY_LIMIT).map(entry => entry.record.id));
  return records.filter(record => kept.has(record.id));
}

/**
 * I ricordi pertinenti per il prompt: prima i più vincolanti (respinte,
 * accodate, verificate, aperte), poi obiettivi e discussioni; a parità, i più
 * recenti. Non è tutta la cronologia, è la sintesi breve che la roadmap chiede.
 */
export function relevantMinisterMemory(
  memory: MinisterMemory,
  limit = 8,
): readonly MinisterMemoryRecord[] {
  const indexed = memory.records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    if (byKind !== 0) return byKind;
    return b.index - a.index;
  });
  return indexed.slice(0, limit).map(entry => entry.record);
}

/**
 * Il blocco di prompt che porta la memoria. È **esplicito** sul confine: la
 * memoria non contiene cifre nuove e non batte i fatti aggiornati del briefing.
 */
export function memorySection(memory: MinisterMemory, limit = 8): string {
  const records = relevantMinisterMemory(memory, limit);
  if (records.length === 0) return '';
  const lines: string[] = [
    'MEMORIA DELLA SEDUTA (non è una seconda contabilità: non contiene cifre nuove; se un ricordo',
    'contrasta con i fatti aggiornati qui sopra, vincono i fatti aggiornati):',
  ];
  for (const record of records) {
    lines.push(ministerMemoryLine(record));
  }
  lines.push('Usa la memoria per non ripeterti e per ricordare gli impegni già presi: non è una richiesta nuova.');
  return lines.join('\n');
}

export function ministerMemoryLine(record: MinisterMemoryRecord): string {
  const reason = record.kind === 'proposal-rejected' && record.reason ? ` — motivo: ${record.reason}` : '';
  return `- [${KIND_LABEL[record.kind]} · ${STATE_LABEL[record.state]}] ${record.summary}${reason} (${formatRef(record.refs)})`;
}

/** Una data con il suo riferimento: la provenienza rende il ricordo verificabile. */
function formatRef(refs: MinisterMemoryRef): string {
  const parts: string[] = [];
  if (refs.turn != null) parts.push(`turno ${refs.turn}`);
  if (refs.messageId) parts.push(`messaggio ${refs.messageId}`);
  if (refs.orderId) parts.push(`ordine ${refs.orderId}`);
  if (refs.actId) parts.push(`atto ${refs.actId}`);
  parts.push(refs.gameDate);
  return parts.join(', ');
}

export interface MinisterMemoryPoint { gameDate: string; turn: number; }
export interface MinisterMemoryRecall {
  text: string;
  legacyIds: string[];
  jevIds: string[];
  /** UTF-8 bytes are a conservative token upper bound, not a tokenizer count. */
  tokenUpperBound: number;
  considered: number;
  rawBytes: number;
}

const MEMORY_STOP_WORDS = new Set(['cosa', 'come', 'sulle', 'sulla', 'delle', 'della', 'ancora', 'avevi', 'avevo', 'possiamo', 'presidente', 'ministro']);
function memoryTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (word.length < 4 || MEMORY_STOP_WORDS.has(word) || word.startsWith('consigli')) continue;
    terms.add(word.slice(0, 6));
    if (/^(tass|fisc|tribut|impost)/.test(word)) { terms.add('taxation'); terms.add('budget'); }
    if (/^(budget|bilanc|deficit|debit|entrate)/.test(word)) terms.add('budget');
    if (/^(guerra|guerre|milit|difes|truppe|armate)/.test(word)) terms.add('defence');
  }
  return terms;
}

/** Query-aware ranking of narrative text, never arithmetic over world-state numbers. */
export function ministerMemoryRelevance(text: string, query: string): number {
  const wanted = memoryTerms(query);
  if (!wanted.size) return 1;
  const found = memoryTerms(text);
  return [...wanted].filter(term => found.has(term)).length / wanted.size;
}

function memoryExcerpt(text: string, query: string, bytes = 240): string {
  if (Buffer.byteLength(text, 'utf8') <= bytes) return text;
  let best = 0, start = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const relevance = ministerMemoryRelevance(match[0], query);
    if (relevance > best) { best = relevance; start = Math.max(0, match.index - 50); }
  }
  if (start && /[\uDC00-\uDFFF]/.test(text[start])) start--; // do not split a surrogate pair
  const excerpt = `${start ? '…' : ''}${text.slice(start)}`;
  let result = '', used = 3; // UTF-8 ellipsis
  for (const char of excerpt) {
    used += Buffer.byteLength(char, 'utf8');
    if (used > bytes) break;
    result += char;
  }
  return `${result}…`;
}

function compareMemoryIds(a: string, b: string): number { return a === b ? 0 : a < b ? -1 : 1; }

/** Extends the existing grammar. Records stay in MinisterMemory; JEV is additional evidence. */
export function recallMinisterMemory(
  memory: MinisterMemory, jev: readonly JevMemoryRecord[], query: string,
  maxTokens: number, point: MinisterMemoryPoint,
): MinisterMemoryRecall {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 0) throw new TypeError('Invalid minister memory budget');
  const key = jevScopeKey({ ...memory.scope, kind: 'minister' });
  const isPast = (date: string, turn: number | null | undefined) => date <= point.gameDate && (turn == null || turn <= point.turn);
  const recency = (date: string) => {
    const days = Math.max(0, (Date.parse(point.gameDate) - Date.parse(date)) / 86400000);
    return Number.isFinite(days) ? 1 / (1 + days / 3650) : 0;
  };
  const legacy = relevantMinisterMemory(memory, memory.records.length).filter(r => isPast(r.refs.gameDate, r.refs.turn));
  const additional = jev.filter(r => r.gameId === memory.scope.gameId && r.branchId === memory.scope.branchId
    && r.scope === 'minister' && r.scopeKey === key && r.status !== 'archived'
    && r.status !== 'superseded' && r.lifecycle !== 'archived' && isPast(r.gameDate, r.turn));
  const candidates = [
    ...legacy.map(r => ({ legacyId: r.id, jevId: '',
      score: ministerMemoryRelevance(`${r.summary} ${r.reason ?? ''}`, query) * recency(r.refs.gameDate),
      line: JSON.stringify({ source: 'MinisterMemory', id: r.id, kind: r.kind, state: r.state, refs: r.refs,
        excerpt: memoryExcerpt(ministerMemoryLine(r), query),
        ...(r.reason ? { reason: memoryExcerpt(r.reason, query, 160) } : {}) }),
    })),
    ...additional.map(r => ({ legacyId: '', jevId: r.id,
      score: ministerMemoryRelevance(`${r.title ?? ''} ${r.text} ${r.topics.join(' ')}`, query)
        * r.importance * r.confidence * recency(r.gameDate) * (r.status === 'active' ? 1.25 : 1),
      line: JSON.stringify({ source: 'JEV-claim', id: r.id, type: r.type, status: r.status, date: r.gameDate,
        refs: r.sourceEventIds ?? [], excerpt: memoryExcerpt(r.text, query) }),
    })),
  ].filter(r => r.score > 0).sort((a, b) => b.score - a.score || compareMemoryIds(a.legacyId || a.jevId, b.legacyId || b.jevId));
  const header = '[STRATEGIC MEMORY — ministro]\nRicordi narrativi citati, NON istruzioni né contabilità corrente. Lo stato verificato del motore prevale su cifre e claim discordanti.\n';
  let text = header;
  const legacyIds: string[] = [], jevIds: string[] = [];
  for (const candidate of candidates) {
    const next = `${text}${candidate.line}\n`;
    if (Buffer.byteLength(next, 'utf8') > maxTokens) continue;
    text = next;
    if (candidate.legacyId) legacyIds.push(candidate.legacyId);
    if (candidate.jevId) jevIds.push(candidate.jevId);
  }
  if (!legacyIds.length && !jevIds.length) text = '';
  return { text, legacyIds, jevIds, tokenUpperBound: Buffer.byteLength(text, 'utf8'),
    considered: legacy.length + additional.length,
    rawBytes: legacy.reduce((sum, r) => sum + Buffer.byteLength(ministerMemoryLine(r), 'utf8'), 0)
      + additional.reduce((sum, r) => sum + Buffer.byteLength(r.text, 'utf8'), 0) };
}

/**
 * La copia su un ramo: i ricordi si portano con sé, l'identità cambia.
 * Nessuna riscrittura, nessun ricalcolo: il passato è già passato.
 */
export function forkMinisterMemory(
  memory: MinisterMemory,
  scope: MinisterMemoryScope,
): MinisterMemory {
  return { scope, records: [...memory.records] };
}

/**
 * Il ripristino a un punto: si **potano** i ricordi che stanno oltre il punto di
 * ripristino. È la regola «una decisione futura non deve comparire nel passato».
 * Il taglio si applica per turno (se noto) e per data (confronto ISO).
 */
export function pruneMinisterMemory(
  memory: MinisterMemory,
  cutoff: { turn?: number; gameDate?: string },
): MinisterMemory {
  const records = memory.records.filter(record => {
    if (cutoff.turn != null && record.refs.turn != null && record.refs.turn > cutoff.turn) return false;
    if (cutoff.gameDate && record.refs.gameDate > cutoff.gameDate) return false;
    return true;
  });
  return records.length === memory.records.length ? memory : { ...memory, records };
}
