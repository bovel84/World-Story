import { CABINET_SEATS } from '../Cabinet';
import type { CabinetSeat } from '../Cabinet';
import type { MinisterMemoryScope } from '../MinisterMemory';

export type JevMemoryType =
  | 'decision' | 'promise' | 'policy' | 'outcome' | 'relationship'
  | 'opinion' | 'conflict' | 'agreement' | 'event' | 'project'
  | 'crisis' | 'historical_episode';

export interface JevBranchScope {
  gameId: string;
  branchId: string | null;
}

export type JevScope =
  | ({ kind: 'world' } & JevBranchScope)
  | ({ kind: 'government' } & JevBranchScope)
  | ({ kind: 'minister' } & MinisterMemoryScope)
  | ({ kind: 'nation'; polityId: string } & JevBranchScope)
  | ({ kind: 'diplomacy'; a: string; b: string } & JevBranchScope)
  | ({ kind: 'perception'; observer: string; subject: string } & JevBranchScope)
  | ({ kind: 'faction'; factionId: string } & JevBranchScope);

export type JevStatus = 'active' | 'resolved' | 'superseded' | 'archived';
export type JevLifecycle = 'hot' | 'warm' | 'cold' | 'archived';

export interface JevMemoryRecord {
  id: string;
  gameId: string;
  branchId: string | null;
  scope: JevScope['kind'];
  scopeKey: string;
  type: JevMemoryType;
  gameDate: string;
  turn: number | null;
  createdAt: string;
  title?: string;
  text: string;
  actors: string[];
  topics: string[];
  importance: number;
  confidence: number;
  status: JevStatus;
  lifecycle: JevLifecycle;
  sourceEventIds?: string[];
  parentMemoryIds?: string[];
  accessCount: number;
  lastAccessedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface JevIngestInput {
  gameId: string;
  branchId: string | null;
  gameDate: string;
  turn?: number;
  source: 'player' | 'minister' | 'npc' | 'simulation' | 'diplomacy' | 'government';
  actorIds: string[];
  text: string;
  eventType?: string;
  scope: JevScope;
  metadata?: Record<string, unknown>;
}

export interface MinisterProfile {
  id: string;
  name: string;
  seat: CabinetSeat;
  mandate: string;
  traits: string[];
  ideology?: string;
  expertise: string[];
  communicationStyle: string;
  riskTolerance: number;
  loyalty: number;
  relationshipWithPresident: number;
}

/** Explicit null is the main branch. Missing/undefined branches are invalid. */
export function assertJevBranchScope(scope: JevBranchScope): void {
  if (!scope || typeof scope.gameId !== 'string' || !scope.gameId.trim()
    || !(scope.branchId === null || (typeof scope.branchId === 'string' && scope.branchId.length > 0))) {
    throw new TypeError('JEV scope requires gameId and an explicit branchId (string or null)');
  }
}

function component(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Invalid JEV scope component');
  return encodeURIComponent(value);
}

/** Identity within a game/branch; encoded delimiters cannot alias another scope. */
export function jevScopeKey(scope: JevScope): string {
  assertJevBranchScope(scope);
  switch (scope.kind) {
    case 'world': return 'world';
    case 'government': return 'government';
    case 'minister':
      if (!CABINET_SEATS.includes(scope.seat)) throw new TypeError('Invalid JEV minister seat');
      return `minister:${component(scope.seat)}:${component(scope.mandate)}`;
    case 'nation': return `nation:${component(scope.polityId)}`;
    case 'faction': return `faction:${component(scope.factionId)}`;
    case 'diplomacy': {
      // Sort raw IDs, then encode: both participants share the same memory.
      if (scope.a === scope.b) throw new TypeError('JEV diplomacy requires two distinct polities');
      const a = component(scope.a);
      const b = component(scope.b);
      return scope.a <= scope.b ? `diplomacy:${a}:${b}` : `diplomacy:${b}:${a}`;
    }
    case 'perception': {
      // Directional: the observer's view of the subject. Never sorted, never
      // merged with the shared `diplomacy:<a>:<b>` pair.
      if (scope.observer === scope.subject) throw new TypeError('JEV perception requires two distinct polities');
      return `nation:${component(scope.observer)}:view:${component(scope.subject)}`;
    }
    default: throw new TypeError('Invalid JEV scope kind');
  }
}
