import { performance } from 'node:perf_hooks';
import { memorySection, relevantMinisterMemory, recallMinisterMemory, type MinisterMemoryPoint, type MinisterMemoryRecall } from '../MinisterMemory';
import type { CabinetSeat } from '../Cabinet';
import { ministerMemoryRepository } from '../../../repositories/minister-memory.repository';
import { jevMemoryRepository } from '../../../repositories/jev-memory.repository';
import { getJevConfig } from './jev.config';
import { jevScopeKey, type JevScope } from './jev.types';

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
