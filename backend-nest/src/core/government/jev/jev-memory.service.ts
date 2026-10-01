import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { memorySection, relevantMinisterMemory, recallMinisterMemory, rankMinisterMemory, ministerMemoryLine, type MinisterMemoryPoint, type MinisterMemoryRecall, type MinisterMemoryScope } from '../MinisterMemory';
import { personaFor, personaSection } from '../MinisterPersona';
import { SEAT_LABEL, SEAT_READS, type CabinetSeat } from '../Cabinet';
import { ministerMemoryRepository } from '../../../repositories/minister-memory.repository';
import { jevMemoryRepository } from '../../../repositories/jev-memory.repository';
import { factionMemoryId } from '../../../repositories/faction-memory.repository';
import type { FactionMemoryEvent } from '../../simulation/FactionMemory';
import { getJevConfig, type JevContextBudget } from './jev.config';
import { classifyJevIngest, type JevIngestDecision } from './jev-classify';
import { jevScopeKey, type JevIngestInput, type JevMemoryRecord, type JevMemoryType, type JevScope } from './jev.types';

export interface JevMinisterRecall extends MinisterMemoryRecall {
  telemetry: {
    scopes_consulted: string[];
    memories_retrieved: number;
    token_upper_bound: number;
    raw_bytes_considered: number;
    retrieval_latency_ms: number;
    model_calls: 0;
  };
}

/** Facade over the existing MinisterMemory plus branch-scoped narrative evidence.
 * No ingestion, generated profile, embedding, model call or world-state mutation.
 * A caller's fenced GameData cursor wins over the persisted active-branch cursor.
 */
export function getMinisterMemory(
  gameId: string, branchId: string | null, seat: CabinetSeat, mandate: string,
  query: string, maxTokens = 1200, asOf?: MinisterMemoryPoint,
): JevMinisterRecall {
  const started = performance.now();
  const scope = { gameId, branchId, seat, mandate };
  const jevScope: JevScope = { ...scope, kind: 'minister' };
  const key = jevScopeKey(jevScope);
  const legacy = ministerMemoryRepository.listMemory(scope);
  let recalled: MinisterMemoryRecall;
  if (!getJevConfig().enabled) {
    // Exact existing grammar/priority/budget; never reads or touches JEV storage.
    const text = memorySection({ scope, records: legacy });
    recalled = { text, legacyIds: relevantMinisterMemory({ scope, records: legacy }).map(r => r.id), jevIds: [], tokenUpperBound: Buffer.byteLength(text, 'utf8'), considered: legacy.length, rawBytes: Buffer.byteLength(text, 'utf8') };
  } else {
    const point = asOf ?? jevMemoryRepository.currentPoint(scope);
    if (!point) recalled = { text: '', legacyIds: [], jevIds: [], tokenUpperBound: 0, considered: 0, rawBytes: 0 };
    else {
      const additional = jevMemoryRepository.listMemory(jevScope, { gameDate: point.gameDate, turn: point.turn, eligibleOnly: true });
      recalled = recallMinisterMemory({ scope, records: legacy }, additional, query, maxTokens, point);
      // Access metadata only: scoped update, not part of the deterministic world.
      if (recalled.jevIds.length) jevMemoryRepository.touch(jevScope, recalled.jevIds, new Date().toISOString());
    }
  }
  return { ...recalled, telemetry: { scopes_consulted: [key], memories_retrieved: recalled.legacyIds.length + recalled.jevIds.length,
    token_upper_bound: recalled.tokenUpperBound, raw_bytes_considered: recalled.rawBytes,
    retrieval_latency_ms: performance.now() - started, model_calls: 0 } };
}

// ── WS-JEV-W2 — Ingestion narrativa (deterministica, zero LLM) ──────────────

/** Esito di una singola ingestion: cosa si è deciso e se si è scritto. */
export interface JevIngestOutcome {
  decision: JevIngestDecision;
  reason: string;
  stored: boolean;
  id?: string;
  scopeKey: string;
}

/** Telemetria di batch: `model_calls` è sempre 0 per costruzione. */
export interface JevIngestTelemetry {
  considered: number;
  kept: number;
  deferred: number;
  dropped: number;
  stored: number;
  model_calls: 0;
  latency_ms: number;
}

interface JevIngestMapping {
  type: JevMemoryType;
  importance: number;
  confidence: number;
}

/** Mappe deterministiche evento → tipo/peso. Nessun modello, nessun default inventato. */
const JEV_INGEST_MAPPING: Record<string, JevIngestMapping> = {
  war_declared: { type: 'conflict', importance: 0.95, confidence: 0.9 },
  treaty_signed: { type: 'agreement', importance: 0.95, confidence: 0.9 },
  government_broken: { type: 'conflict', importance: 0.85, confidence: 0.9 },
  government_grievance: { type: 'decision', importance: 0.85, confidence: 0.9 },
  government_favor: { type: 'decision', importance: 0.8, confidence: 0.9 },
  government_promise: { type: 'promise', importance: 0.8, confidence: 0.9 },
  government_kept: { type: 'outcome', importance: 0.8, confidence: 0.9 },
  government_decision: { type: 'decision', importance: 0.8, confidence: 0.9 },
  minister_decision: { type: 'decision', importance: 0.7, confidence: 0.7 },
  minister_promise: { type: 'promise', importance: 0.7, confidence: 0.7 },
  minister_statement: { type: 'opinion', importance: 0.6, confidence: 0.7 },
  player_decision: { type: 'decision', importance: 0.7, confidence: 0.8 },
  player_order: { type: 'decision', importance: 0.7, confidence: 0.8 },
};

function ingestMapping(input: JevIngestInput): JevIngestMapping {
  const known = input.eventType !== undefined ? JEV_INGEST_MAPPING[input.eventType] : undefined;
  if (known) return known;
  if (input.source === 'simulation' && input.metadata?.hasNumericOutcome === true) {
    return { type: 'outcome', importance: 0.9, confidence: 0.9 };
  }
  return { type: 'event', importance: 0.5, confidence: 0.6 };
}

/** Cap di sicurezza: una memoria narrativa non è una cronologia. */
function narrativeText(text: string): string {
  const collapsed = text.trim().replace(/[ \t]+/gu, ' ');
  return collapsed.length <= 2000 ? collapsed : `${collapsed.slice(0, 1999)}…`;
}

function ingestTopics(metadata: Record<string, unknown> | undefined): string[] {
  const raw = metadata?.topics;
  return Array.isArray(raw) && raw.every(item => typeof item === 'string') ? (raw as string[]) : [];
}

function ingestSourceEventId(metadata: Record<string, unknown> | undefined): string | null {
  if (typeof metadata?.sourceEventId === 'string' && metadata.sourceEventId) return metadata.sourceEventId;
  if (typeof metadata?.eventId === 'string' && metadata.eventId) return metadata.eventId;
  return null;
}

function ingestMetadata(input: JevIngestInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = { source: input.source, eventType: input.eventType ?? null };
  for (const key of ['eventId', 'sourceEventId']) {
    const value = input.metadata?.[key];
    if (typeof value === 'string') metadata[key] = value;
  }
  // Provenienza dell'esito verificato: serve a W7/W8 per distinguere un fatto
  // del motore da una narrazione, senza duplicare il numero di gioco.
  if (input.metadata?.hasNumericOutcome === true) metadata.hasNumericOutcome = true;
  return metadata;
}

/**
 * Chiave stabile: un `metadata.eventId` esplicito vince; altrimenti l'hash
 * deterministico di scope/game/branch/data/turno/sorgente/evento/testo. Lo
 * stesso evento ri-ingestito aggiorna, non duplica.
 */
export function jevIngestId(input: JevIngestInput): string {
  const explicit = input.metadata?.eventId;
  if (typeof explicit === 'string' && explicit.length > 0) return `jev:${explicit}`;
  const parts = [
    input.scope.kind, jevScopeKey(input.scope), input.gameId, input.branchId ?? '',
    input.gameDate, input.turn ?? '', input.source, input.eventType ?? '', narrativeText(input.text),
  ];
  return `jev:${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)}`;
}

/**
 * Ingestione di un fatto narrativo. Con il flag off non tocca il repository
 * (funziona anche se `jev_memory` non esiste). Con DEFER/DROP non scrive.
 * Non modifica mai lo stato deterministico: solo righe `jev_memory`.
 */
export function ingestJevMemory(input: JevIngestInput, now?: string): JevIngestOutcome {
  if (!input.scope || input.scope.gameId !== input.gameId || input.scope.branchId !== input.branchId) {
    throw new TypeError('JEV ingest scope must match input gameId and branchId');
  }
  const scopeKey = jevScopeKey(input.scope);
  if (!getJevConfig().enabled) {
    return { decision: 'DROP', reason: 'jev_disabled', stored: false, scopeKey };
  }
  const classification = classifyJevIngest(input);
  if (classification.decision !== 'KEEP') {
    return { decision: classification.decision, reason: classification.reason, stored: false, scopeKey };
  }
  const id = jevIngestId(input);
  const mapping = ingestMapping(input);
  const sourceEventId = ingestSourceEventId(input.metadata);
  const record: JevMemoryRecord = {
    id,
    gameId: input.gameId,
    branchId: input.branchId,
    scope: input.scope.kind,
    scopeKey,
    type: mapping.type,
    gameDate: input.gameDate,
    turn: input.turn ?? null,
    createdAt: now ?? new Date().toISOString(),
    text: narrativeText(input.text),
    actors: [...input.actorIds],
    topics: ingestTopics(input.metadata),
    importance: mapping.importance,
    confidence: mapping.confidence,
    status: 'active',
    lifecycle: mapping.importance >= 0.8 ? 'hot' : 'warm',
    accessCount: 0,
    metadata: ingestMetadata(input),
    ...(sourceEventId ? { sourceEventIds: [sourceEventId] } : {}),
  };
  jevMemoryRepository.upsert(input.scope, record);
  return { decision: 'KEEP', reason: classification.reason, stored: true, id, scopeKey };
}

/** Batch con telemetria; nessun modello viene mai interrogato. */
export function ingestJevBatch(
  inputs: readonly JevIngestInput[], now?: string,
): { outcomes: JevIngestOutcome[]; telemetry: JevIngestTelemetry } {
  const started = performance.now();
  // Isolamento per-item: un input invalido non deve far cadere l'intero batch,
  // altrimenti un solo evento rotto perderebbe tutti gli altri.
  const outcomes = inputs.map((input): JevIngestOutcome => {
    try {
      return ingestJevMemory(input, now);
    } catch (error) {
      console.warn('[JEV] ingestion del singolo evento non riuscita:', error);
      let scopeKey = '';
      try { scopeKey = input?.scope ? jevScopeKey(input.scope) : ''; } catch { /* scope invalido */ }
      return { decision: 'DROP', reason: 'ingest_error', stored: false, scopeKey };
    }
  });
  return {
    outcomes,
    telemetry: {
      considered: outcomes.length,
      kept: outcomes.filter(outcome => outcome.decision === 'KEEP').length,
      deferred: outcomes.filter(outcome => outcome.decision === 'DEFER').length,
      dropped: outcomes.filter(outcome => outcome.decision === 'DROP').length,
      stored: outcomes.filter(outcome => outcome.stored).length,
      model_calls: 0,
      latency_ms: performance.now() - started,
    },
  };
}

const GOVERNMENT_EVENT_TYPES: Record<FactionMemoryEvent['kind'], string> = {
  favor: 'government_favor',
  grievance: 'government_grievance',
  ignored: 'government_grievance',
  promise: 'government_promise',
  kept: 'government_kept',
  broken: 'government_broken',
};

export interface JevIngestContext {
  gameId: string;
  branchId: string | null;
  gameDate: string;
  turn: number;
}

/** Adapter: un evento di memoria politica della fazione diventa fatto di governo. */
export function governmentEventInput(event: FactionMemoryEvent, ctx: JevIngestContext): JevIngestInput {
  const topics = typeof event.lever === 'string' && event.lever ? [event.lever] : undefined;
  return {
    gameId: ctx.gameId,
    branchId: ctx.branchId,
    gameDate: ctx.gameDate,
    turn: ctx.turn,
    source: 'government',
    actorIds: [event.factionId],
    text: event.text,
    eventType: GOVERNMENT_EVENT_TYPES[event.kind],
    scope: { kind: 'government', gameId: ctx.gameId, branchId: ctx.branchId },
    metadata: {
      eventId: factionMemoryId(event),
      ...(event.sourceEventId ? { sourceEventId: event.sourceEventId } : {}),
      ...(topics ? { topics } : {}),
    },
  };
}

/** Adapter: lo scambio presidente↔ministro come memoria della sedia/mandato. */
export function ministerExchangeInput(p: {
  gameId: string; branchId: string | null; seat: CabinetSeat; mandate: string;
  gameDate: string; turn: number; question: string; reply: string;
}): JevIngestInput {
  const question = p.question.trim();
  const reply = p.reply.trim();
  const text = reply
    ? `Domanda del presidente: ${question}\nRisposta del ministro: ${reply}`
    : `Domanda del presidente: ${question}`;
  return {
    gameId: p.gameId,
    branchId: p.branchId,
    gameDate: p.gameDate,
    turn: p.turn,
    source: 'minister',
    actorIds: [p.seat],
    text,
    eventType: 'minister_statement',
    scope: { kind: 'minister', gameId: p.gameId, branchId: p.branchId, seat: p.seat, mandate: p.mandate },
  };
}

/** Adapter: una decisione del giocatore entra nella memoria del governo. */
export function playerDecisionInput(p: {
  gameId: string; branchId: string | null; gameDate: string; turn: number;
  actionId: string; text: string; actorIds?: string[];
}): JevIngestInput {
  return {
    gameId: p.gameId,
    branchId: p.branchId,
    gameDate: p.gameDate,
    turn: p.turn,
    source: 'player',
    actorIds: p.actorIds ?? ['player'],
    text: p.text,
    eventType: 'player_decision',
    scope: { kind: 'government', gameId: p.gameId, branchId: p.branchId },
    metadata: { eventId: p.actionId },
  };
}

// ── WS-JEV-W4 — Context builder a sezioni (innesto, non sostituto) ────────────

/**
 * Le sezioni che il prompt del ministro riceve, ciascuna entro il proprio
 * budget. `CURRENT VERIFIED STATE` viene **solo** dal motore (`verifiedState`),
 * mai da JEV: JEV aggiunge narrazione, non corregge i numeri.
 */
export interface MinisterContextInput {
  scope: MinisterMemoryScope;
  query: string;
  /** Profilo, regole e fatti della sedia, composti dal motore. Mai da JEV. */
  verifiedState?: string;
  /** Scambi recenti, dal più vecchio al più nuovo. */
  recentConversation?: readonly { role: string; content: string }[];
  asOf?: MinisterMemoryPoint;
  budget?: JevContextBudget;
}

export interface MinisterContextSections {
  identity: string;
  worldState: string;
  strategicMemory: string;
  relevantPast: string;
  unresolved: string;
  recentConversation: string;
}

export interface MinisterContextResult {
  text: string;
  sections: MinisterContextSections;
  telemetry: {
    section_bytes: Record<string, number>;
    total_bytes: number;
    /** Somma dei soli budget dichiarati; `worldState` è il blocco del motore. */
    budget_bytes: number;
    /** Vero se il blocco supera i budget dichiarati (briefing del motore esente dal taglio). */
    over_budget: boolean;
    legacy_ids: string[];
    jev_ids: string[];
    considered: number;
    model_calls: 0;
    latency_ms: number;
  };
}

const UNRESOLVED_LEGACY = new Set(['open-question', 'queued-decision']);
const UNRESOLVED_JEV = new Set(['promise', 'conflict']);

/** Compone una sezione entro il budget UTF-8, saltando le righe che non entrano. */
function jevClaimLine(record: JevMemoryRecord): string {
  return JSON.stringify({ source: 'JEV-claim', id: record.id, type: record.type, status: record.status,
    date: record.gameDate, refs: record.sourceEventIds ?? [], excerpt: record.text });
}

function fitSection(header: string, lines: readonly string[], budget: number): string {
  if (!lines.length || budget <= 0) return '';
  if (Buffer.byteLength(`${header}\n`, 'utf8') > budget) return '';
  let text = `${header}\n`;
  for (const line of lines) {
    const next = `${text}${line}\n`;
    if (Buffer.byteLength(next, 'utf8') > budget) continue;
    text = next;
  }
  return text.trimEnd();
}

/** Gli scambi recenti che entrano nel budget, dal più nuovo a ritroso. */
function recentConversationLines(
  history: readonly { role: string; content: string }[], budget: number,
): string[] {
  if (!history.length || budget <= 0) return [];
  const kept: string[] = [];
  let used = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message || typeof message.content !== 'string' || !message.content.trim()) continue;
    const speaker = message.role === 'user' ? 'Presidente' : 'Ministro';
    const line = `${speaker}: ${message.content.trim().replace(/\s+/gu, ' ')}`;
    const size = Buffer.byteLength(line, 'utf8');
    if (used + size > budget) break;
    kept.push(line);
    used += size;
  }
  return kept.reverse();
}

/**
 * Il context builder della sedia, a sezioni e a budget, innestato nel
 * `PromptBuilder` esistente (non un builder parallelo).
 *
 * Budget (default da `jev.config`): identità 400, stato verificato 1200,
 * memoria strategica 800, eventi passati 1200, conversazione recente 800.
 * `UNRESOLVED ISSUES` condivide il budget residuo dei due blocchi di memoria,
 * così il totale resta entro il target senza una voce di budget aggiuntiva.
 *
 * Flag off o nessun cursore: nessun testo, zero accessi a JEV.
 */
export function buildMinisterContext(input: MinisterContextInput): MinisterContextResult {
  const started = performance.now();
  const config = getJevConfig();
  const empty: MinisterContextSections = {
    identity: '', worldState: '', strategicMemory: '', relevantPast: '', unresolved: '', recentConversation: '',
  };
  const emptyResult = (): MinisterContextResult => ({
    text: '', sections: { ...empty },
    telemetry: { section_bytes: {}, total_bytes: 0, budget_bytes: 0, over_budget: false, legacy_ids: [], jev_ids: [], considered: 0, model_calls: 0, latency_ms: performance.now() - started },
  });
  if (!config.enabled) return emptyResult();
  const budget = input.budget ?? config.contextBudget;
  const point = input.asOf ?? jevMemoryRepository.currentPoint(input.scope);
  if (!point) return emptyResult();

  const scope = input.scope;
  const legacy = ministerMemoryRepository.listMemory(scope);
  const jevScope: JevScope = { ...scope, kind: 'minister' };
  const jev = jevMemoryRepository.listMemory(jevScope, { gameDate: point.gameDate, turn: point.turn, eligibleOnly: true });
  const ranking = rankMinisterMemory({ scope, records: legacy }, jev, input.query, point);

  // Il briefing della sedia è un blocco curato dal motore (profilo, regole
  // inviolabili, fatti con la provenienza): si inserisce INTEGRO. Tagliarlo al
  // budget `worldState` perderebbe proprio le regole e i fatti, che è peggio di
  // un budget di riferimento superato. `worldState` resta la soglia di
  // riferimento per uno stato compatto; la dimensione reale è in telemetria e
  // il `maxMinisterContextTokens` complessivo è applicato con un taglio morbido
  // che non tocca mai il briefing.
  const worldState = input.verifiedState?.trim()
    ? `[CURRENT VERIFIED STATE — fatti del motore, mai da JEV]\n${input.verifiedState.trim()}`
    : '';
  // Con il briefing inserito integro, la persona è già in `worldState`: ripeterla
  // in `identity` sprecherebbe budget. La si include solo senza briefing.
  const identityLines = [`${SEAT_LABEL[scope.seat]} — legge ${SEAT_READS[scope.seat]}.`];
  if (!worldState) identityLines.push(...personaSection(personaFor(scope.seat)).split('\n'));
  const identity = fitSection('[MINISTER IDENTITY]', identityLines, budget.identity);

  const legacyCandidates = ranking.candidates.filter(candidate => candidate.legacy);
  const jevCandidates = ranking.candidates.filter(candidate => candidate.jev);
  const strategicMemory = fitSection('[STRATEGIC MEMORY]',
    legacyCandidates.filter(c => !UNRESOLVED_LEGACY.has(c.legacy!.kind)).map(c => c.line), budget.strategicMemory);
  const relevantPast = fitSection('[RELEVANT PAST EVENTS — narrativa citata, non fatti del motore]',
    jevCandidates.filter(c => !(c.jev!.status === 'active' && UNRESOLVED_JEV.has(c.jev!.type))).map(c => c.line), budget.retrievedMemory);
  // Le questioni aperte contano anche se non rispondono alla domanda del turno:
  // non passano per il ranking di pertinenza, ma restano nel passato verificato.
  const isPastRef = (date: string, turn: number | null | undefined) => date <= point.gameDate && (turn == null || turn <= point.turn);
  const unresolvedBudget = Math.max(0, budget.strategicMemory - Buffer.byteLength(strategicMemory, 'utf8'))
    + Math.max(0, budget.retrievedMemory - Buffer.byteLength(relevantPast, 'utf8'));
  const unresolved = fitSection('[UNRESOLVED ISSUES — aperti o in sospeso]', [
    ...legacy.filter(r => UNRESOLVED_LEGACY.has(r.kind) && isPastRef(r.refs.gameDate, r.refs.turn))
      .map(r => JSON.stringify({ source: 'MinisterMemory', id: r.id, kind: r.kind, state: r.state, refs: r.refs,
        excerpt: ministerMemoryLine(r), ...(r.reason ? { reason: r.reason } : {}) })),
    ...jev.filter(r => r.status === 'active' && UNRESOLVED_JEV.has(r.type)).map(jevClaimLine),
  ], unresolvedBudget);
  const recentBudget = Math.max(0, budget.recentConversation - Buffer.byteLength('[RECENT CONVERSATION]\n', 'utf8'));
  const recentConversation = fitSection('[RECENT CONVERSATION]',
    recentConversationLines(input.recentConversation ?? [], recentBudget), budget.recentConversation);

  const sections: MinisterContextSections = { identity, worldState, strategicMemory, relevantPast, unresolved, recentConversation };
  const text = [sections.identity, sections.worldState, sections.strategicMemory, sections.relevantPast, sections.unresolved, sections.recentConversation]
    .filter(Boolean).join('\n\n');

  // Access metadata sulle sole evidenze JEV realmente finite nel testo scelto:
  // è la stessa semantica `touch` di W3, non uno stato deterministico.
  const selectedJevIds = [
    ...jevCandidates.map(c => ({ id: c.jev!.id, line: c.line, section: sections.relevantPast })),
    ...jev.filter(r => r.status === 'active' && UNRESOLVED_JEV.has(r.type))
      .map(r => ({ id: r.id, line: jevClaimLine(r), section: sections.unresolved })),
  ].filter(entry => entry.section.includes(entry.line)).map(entry => entry.id);
  if (selectedJevIds.length) jevMemoryRepository.touch(jevScope, selectedJevIds, new Date().toISOString());

  // `worldState` è il briefing del motore, inserito integro (vedi sopra): il
  // confronto con i budget dichiarati è diagnostico, non un taglio. Le sezioni
  // di memoria restano invece vincolate ai rispettivi budget.
  const budgetBytes = budget.identity + budget.worldState + budget.strategicMemory + budget.retrievedMemory + budget.recentConversation;
  const totalBytes = Buffer.byteLength(text, 'utf8');
  return {
    text, sections,
    telemetry: {
      section_bytes: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, Buffer.byteLength(value, 'utf8')])),
      total_bytes: totalBytes,
      budget_bytes: budgetBytes,
      over_budget: totalBytes > budgetBytes,
      legacy_ids: legacyCandidates.map(c => c.legacy!.id),
      jev_ids: jevCandidates.map(c => c.jev!.id),
      considered: ranking.considered,
      model_calls: 0,
      latency_ms: performance.now() - started,
    },
  };
}
