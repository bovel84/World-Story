import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { memorySection, relevantMinisterMemory, recallMinisterMemory, type MinisterMemoryPoint, type MinisterMemoryRecall } from '../MinisterMemory';
import type { CabinetSeat } from '../Cabinet';
import { ministerMemoryRepository } from '../../../repositories/minister-memory.repository';
import { jevMemoryRepository } from '../../../repositories/jev-memory.repository';
import { factionMemoryId } from '../../../repositories/faction-memory.repository';
import type { FactionMemoryEvent } from '../../simulation/FactionMemory';
import { getJevConfig } from './jev.config';
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
