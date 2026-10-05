/** Read-only consequence adapter. No narrative, signed act, or measured delta
 * proves an applied effect: only committed canonical ledger rows do.
 * Branchless action/report tables are intersected with the restored snapshot's
 * canonical history; receipts and abandoned runs are deliberately not read. */
import db from '../../database';
import path from 'node:path';
import { loadSimulationCatalog } from '../../scenario/loader';
import { validateLedgerEntry, type LedgerEntryInput } from '../../domain/ledger';
import { semanticStateHash } from '../../domain/semantic-hash';
import { isEconomicSnapshot } from '../../repositories/economy-snapshot.repository';
import type { VerifiedWorldFact, VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export interface GovernmentDossierState {
  date: string | null;
  turn: number | null;
  facts: Record<string, VerifiedWorldFact>;
  /** Historical facts not compared by the verified snapshot remain unknown. */
  unavailable: string[];
}
export interface GovernmentDossierReport {
  id: string;
  status: 'accepted' | 'partial' | 'rejected' | 'unresolved';
  summary: string;
  eventHeadlines: string[];
  evidence: 'report_only';
  sourceRef: string;
}
export interface GovernmentDossierDecision {
  id: string;
  text: string;
  turn: number | null;
  /** Actions have no world-date column; createdAt is a wall-clock timestamp. */
  createdAt: string;
  status: 'recorded' | 'signed_pending_execution';
  /** A recorded action/outcome is NOT proof that execution completed. */
  executionStatus: string | null;
  result: GovernmentDossierReport[] | null;
  sourceRef: string;
}
export interface GovernmentDossierAppliedEffect extends LedgerEntryInput {
  gameId: string;
  branchId: string;
  sourceRef: string;
  /** Only literal canonical effectId = action.id links. No prefix, timeline,
   * title, turn, project-ID derivation, or all-actions-to-deltas matching. */
  sourceAction: { id: string; sourceRef: string } | null;
}
export interface GovernmentDossier {
  before: GovernmentDossierState | null;
  after: GovernmentDossierState;
  decisions: GovernmentDossierDecision[];
  /** null = period/ledger unknown; [] = no committed entries in known period.
   * This ledger does NOT cover all legacy engine changes or use their units. */
  appliedEffects: GovernmentDossierAppliedEffect[] | null;
  observedChanges: VerifiedWorldSnapshot['changes'];
  causalAttribution: 'explicit_links_only';
}

interface ActionRow { id: string; player_id: string; turn: number; text: string; created_at: string }
interface PendingRow { id: string; text: string; created_at: string; status: string; execution_status: string }
interface ResultRow { id: string; turn: number; date: string | null; timeline_events: string }
interface CheckpointRow { data: string; content_hash: string | null }
interface OutcomeRow { id: string; status: string; summary: string; event_headlines: string }
interface LedgerRow {
  effect_id: string; entry_index: number; cause: LedgerEntryInput['cause']; kind: LedgerEntryInput['kind'];
  unit_id: string; from_ref: string | null; to_ref: string | null; owner_ref: string | null;
  delta: string; at_date: string;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A branch ledger is shared by every catalog actor, so an entry may belong to
 * another polity (e.g. `beta_treasury` bootstrap). Ownership is decided ONLY by
 * a reference in the player's actor set; `null` means the set is unknowable and
 * no filtering is claimed. */
export function ownedLedgerMovement(entry: Pick<LedgerEntryInput, 'fromRef' | 'toRef' | 'ownerRef'>, refs: ReadonlySet<string>): boolean {
  return [entry.fromRef, entry.toRef, entry.ownerRef].some(ref => typeof ref === 'string' && refs.has(ref));
}

const ownedRefsCache = new Map<string, ReadonlySet<string> | null>();
/** Memoized catalog actor refs of the player polity; null = catalog unavailable. */
function ownedActorRefs(gameId: string, polityId: string): ReadonlySet<string> | null {
  const key = `${gameId}|${polityId}`;
  if (ownedRefsCache.has(key)) return ownedRefsCache.get(key)!;
  let refs: ReadonlySet<string> | null = null;
  try {
    const row = db.prepare('SELECT w.template_id AS template_id FROM games g JOIN worlds w ON w.id = g.world_id WHERE g.id = ?')
      .get(gameId) as { template_id?: string } | undefined;
    if (row?.template_id) {
      const { catalog } = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', row.template_id));
      const set = new Set((catalog?.actors ?? []).filter(actor => actor.polityId === polityId).map(actor => actor.actorId));
      if (set.size) refs = set;
    }
  } catch { refs = null; }
  ownedRefsCache.set(key, refs);
  return refs;
}
function parse(raw: string): unknown { try { return JSON.parse(raw); } catch { return null; } }
function date(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Reconstruct only facts actually measured in both states. The verified
 * comparison is the baseline authority; do not pick a nearer account row or
 * guess a date from saves/ledger entries. Unchanged numeric values are known,
 * missing historical inventories and unmeasured facts are not zero/unchanged. */
function previousState(snapshot: VerifiedWorldSnapshot): GovernmentDossierState | null {
  const changes = snapshot.changes;
  if (!changes.available || !date(snapshot.date) || !date(changes.previousDate)
    || changes.previousDate >= snapshot.date || !Number.isInteger(snapshot.turn)
    || !Number.isInteger(changes.previousTurn) || changes.previousTurn !== snapshot.turn! - 1) return null;
  const facts: Record<string, VerifiedWorldFact> = {};
  for (const key of changes.comparedKeys) {
    const current = snapshot.facts[key];
    const delta = changes.deltas.find(item => item.key === key);
    if (!current || typeof current.rawValue !== 'number' || !Number.isFinite(current.rawValue)) continue;
    const before = delta ? delta.before : current.rawValue;
    if (!Number.isFinite(before)) continue;
    facts[key] = { ...current, rawValue: before, value: String(before),
      sourceRef: delta?.previousSourceRef ?? `snapshot.changes.comparedKeys.${key}` };
  }
  return { date: changes.previousDate, turn: changes.previousTurn, facts,
    unavailable: [...new Set([...changes.unavailableKeys, ...Object.keys(snapshot.facts).filter(key => !(key in facts))])] };
}

/** Outcome tables have no branch/date columns. Require an explicit run in a
 * persisted result still present in the canonical restored snapshot, plus a
 * hash-verified game/date/branch checkpoint. JSON failure stays unknown. */
function canonicalReportRuns(snapshot: VerifiedWorldSnapshot, before: GovernmentDossierState | null): Set<string> {
  const runs = new Set<string>();
  const checkedAnchors = new Set<string>();
  const ids = snapshot.recent.consequences.map(result => result.id);
  if (!ids.length) return runs;
  const rows = db.prepare(`SELECT id, turn, date, timeline_events FROM turn_results
    WHERE game_id = ? AND turn <= ? AND date > ? AND date <= ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(snapshot.gameId, snapshot.turn, before?.date ?? '', snapshot.date, ...ids) as ResultRow[];
  for (const row of rows) {
    const canonical = snapshot.recent.consequences.find(result => result.id === row.id && result.turn === row.turn && result.date === row.date);
    if (!canonical || !date(row.date) || row.date > snapshot.date! || (before && row.date <= before.date!)) continue;
    const events = parse(row.timeline_events);
    if (!Array.isArray(events)) continue;
    for (const event of events) {
      if (!record(event) || typeof event.simulationId !== 'string' || !date(typeof event.date === 'string' ? event.date : null)
        || (event.date as string) > snapshot.date!
        || !canonical.timelineEvents?.some(item => item.id === event.id && item.date === event.date && item.simulationId === event.simulationId)) continue;
      const anchorKey = `${event.simulationId}|${row.date}`;
      if (checkedAnchors.has(anchorKey)) continue;
      checkedAnchors.add(anchorKey);
      const anchors = db.prepare(`
        SELECT c.data, c.content_hash FROM simulation_checkpoints c
        JOIN simulation_runs r ON r.id = c.run_id AND r.game_id = c.game_id
        WHERE c.game_id = ? AND c.run_id = ? AND c.game_date = ? AND c.turn <= ?
      `).all(snapshot.gameId, event.simulationId, row.date, snapshot.turn) as CheckpointRow[];
      if (anchors.some(anchor => {
        const saved = parse(anchor.data);
        return record(saved) && !!anchor.content_hash && semanticStateHash(saved) === anchor.content_hash
          && isEconomicSnapshot(saved.economicState) && saved.economicState.sourceBranchId === snapshot.branchId;
      })) runs.add(event.simulationId);
    }
  }
  return runs;
}
function reports(gameId: string, actionId: string, runs: Set<string>): GovernmentDossierReport[] | null {
  const results: GovernmentDossierReport[] = [];
  for (const runId of [...runs].sort()) {
    const rows = db.prepare(`SELECT id, status, summary, event_headlines FROM simulation_action_outcomes
      WHERE game_id = ? AND run_id = ? AND action_id = ? ORDER BY id ASC`).all(gameId, runId, actionId) as OutcomeRow[];
    for (const row of rows) {
      const headlines = parse(row.event_headlines);
      if (!Array.isArray(headlines) || !headlines.every(item => typeof item === 'string')
        || !['accepted', 'partial', 'rejected', 'unresolved'].includes(row.status) || typeof row.summary !== 'string') continue;
      results.push({ id: row.id, status: row.status as GovernmentDossierReport['status'], summary: row.summary,
        eventHeadlines: headlines, evidence: 'report_only', sourceRef: `simulation_action_outcomes.${row.id}` });
    }
  }
  return results.length ? results : null;
}

export function readGovernmentDossier(snapshot: VerifiedWorldSnapshot): GovernmentDossier {
  const before = previousState(snapshot);
  const dossier: GovernmentDossier = {
    before, after: { date: snapshot.date, turn: snapshot.turn, facts: structuredClone(snapshot.facts), unavailable: [...snapshot.unavailable] },
    decisions: [], appliedEffects: null, observedChanges: structuredClone(snapshot.changes), causalAttribution: 'explicit_links_only',
  };
  if (!snapshot.branchId || !date(snapshot.date) || !Number.isInteger(snapshot.turn)) return dossier;
  // Never call ensureMainBranch/findById: those readers may materialize state.
  const scope = db.prepare(`SELECT g.head_branch_id, b.game_id FROM games g
    JOIN game_branches b ON b.id = ? WHERE g.id = ?`).get(snapshot.branchId, snapshot.gameId) as { head_branch_id: string; game_id: string } | undefined;
  if (!scope || scope.game_id !== snapshot.gameId || scope.head_branch_id !== snapshot.branchId) {
    dossier.before = null;
    return dossier;
  }

  const ids = snapshot.recent.orders.map(action => action.id);
  const actions = ids.length ? db.prepare(`SELECT a.id, a.player_id, a.turn, a.text, a.created_at FROM actions a
    JOIN players p ON p.id = a.player_id AND p.game_id = a.game_id
    WHERE a.game_id = ? AND p.polity_id = ? AND a.turn >= ? AND a.turn <= ?
      AND a.id IN (${ids.map(() => '?').join(',')}) ORDER BY a.turn ASC, a.created_at ASC, a.id ASC`)
    .all(snapshot.gameId, snapshot.polityId, before?.turn ?? 0, snapshot.turn, ...ids) as ActionRow[] : [];
  const runs = canonicalReportRuns(snapshot, before);
  for (const row of actions) {
    if ((before && row.turn < before.turn!) || !snapshot.recent.orders.some(action => action.id === row.id
      && action.playerId === row.player_id && action.turn === row.turn && action.text === row.text)) continue;
    // Legacy addAction defaults created_at to execution time, while the
    // restored ActionRecord carries signature time: neither is a world date.
    dossier.decisions.push({ id: row.id, text: row.text, turn: row.turn, createdAt: row.created_at,
      status: 'recorded', executionStatus: null, result: reports(snapshot.gameId, row.id, runs), sourceRef: `actions.${row.id}` });
  }
  // Pending rows have no player/branch/game-date: only the live, restored queue
  // supplied by this verified snapshot can establish them as own signed acts.
  const pending = db.prepare('SELECT id, text, created_at, status, execution_status FROM pending_actions WHERE game_id = ? ORDER BY created_at ASC, id ASC')
    .all(snapshot.gameId) as PendingRow[];
  for (const row of pending) {
    if (row.status !== 'pending' || !snapshot.recent.signedActs.some(act => act.id === row.id && act.text === row.text && act.createdAt === row.created_at)) continue;
    dossier.decisions.push({ id: row.id, text: row.text, turn: null, createdAt: row.created_at,
      status: 'signed_pending_execution', executionStatus: row.execution_status, result: null, sourceRef: `pending_actions.${row.id}` });
  }
  if (!before) return dossier;

  // listLedgerEntries is branch-only and omits game provenance; use the exact
  // same persisted ledger/codec with both fences and the bounded (before,after]
  // world-date period. Staging, finance shortfalls and narrative are not ledger.
  const rows = db.prepare(`SELECT effect_id, entry_index, cause, kind, unit_id, from_ref, to_ref, owner_ref, delta, at_date
    FROM ledger_entries WHERE game_id = ? AND branch_id = ? AND at_date > ? AND at_date <= ?
    ORDER BY at_date ASC, effect_id ASC, entry_index ASC`).all(snapshot.gameId, snapshot.branchId, before.date, snapshot.date) as LedgerRow[];
  const effects: GovernmentDossierAppliedEffect[] = [];
  const owned = ownedActorRefs(snapshot.gameId, snapshot.polityId);
  for (const row of rows) {
    const entry: LedgerEntryInput = { effectId: row.effect_id, entryIndex: row.entry_index, cause: row.cause,
      kind: row.kind, unitId: row.unit_id, fromRef: row.from_ref, toRef: row.to_ref,
      ...(row.owner_ref !== null ? { ownerRef: row.owner_ref } : {}), delta: row.delta, atDate: row.at_date };
    try { validateLedgerEntry(entry); } catch { return dossier; } // corrupt ledger means unknown, not zero
    if (entry.kind !== 'money' && entry.kind !== 'material') return dossier;
    // Foreign or unknown-ownership branch movements never masquerade as the player's.
    if (owned && !ownedLedgerMovement(entry, owned)) continue;
    const action = dossier.decisions.find(item => item.status === 'recorded' && item.id === entry.effectId);
    effects.push({ ...entry, gameId: snapshot.gameId, branchId: snapshot.branchId,
      sourceRef: `ledger_entries.${snapshot.branchId}.${entry.effectId}.${entry.entryIndex}`,
      sourceAction: action ? { id: action.id, sourceRef: action.sourceRef } : null });
  }
  dossier.appliedEffects = effects;
  return dossier;
}
