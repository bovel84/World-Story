/** Read-only adapter over existing canonical persistence, NOT a history engine. */
import db from '../../database';
import { semanticStateHash } from '../../domain/semantic-hash';
import { isEconomicSnapshot } from '../../repositories/economy-snapshot.repository';
import { buildVerifiedWorldSnapshot, type VerifiedWorldGameData, type VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import type { SaveData } from '../../game-session';
import type { NationalAccount } from '../simulation/WorldStateEngine';

interface PersistedAnchor {
  id: string;
  data: string;
  content_hash: string | null;
  game_date: string;
  recorded_at: string;
}
interface PersistedAccount { account: string; turn: number; recorded_at: string }
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Saves/checkpoints from an abandoned same-ID branch must not become a
 * baseline after restoring and playing an alternative history. Only a prefix
 * of the current canonical recorded history can identify the prior state. */
function currentHistoryContains(saved: SaveData, current: VerifiedWorldGameData): boolean {
  return ([['actions', current.actions], ['results', current.results]] as const).every(([key, records]) => {
    const prior = saved[key];
    return Array.isArray(prior) && Array.isArray(records) && prior.length <= records.length
      && prior.every((entry, index) => semanticStateHash(entry) === semanticStateHash(records[index]));
  });
}

/** A persisted turn/date anchor is necessary: ticks are not consistently
 * labelled with the visible turn (TurnPipeline records before incrementing;
 * live ticks record after). Do not guess the previous date from latest reads,
 * the nearest older history row, or an economic ledger balance in other units.
 *
 * Legacy economicState stores strict ledger/finance/project tables, NOT the
 * material stock or food coverage. National account history contains exact
 * balance/tension and legacy treasury when available. Unsupported fields stay
 * unknown; rounded history debt is deliberately not promoted to a raw delta. */
export function readPreviousVerifiedWorldSnapshot(
  current: VerifiedWorldGameData,
  branchId: string | null,
): VerifiedWorldSnapshot | null {
  if (!branchId || !Number.isInteger(current.currentTurn) || !current.currentDate) return null;
  const previousTurn = current.currentTurn! - 1;
  // The saves.current_date column has carried wall-clock values in some paths;
  // the authoritative date is inside the validated payload, so anchor by turn
  // and judge the date only after parsing succeeds.
  const anchors = db.prepare(`
    SELECT id, data, content_hash, current_date AS game_date, saved_at AS recorded_at
    FROM saves WHERE game_id = ? AND current_turn = ?
    UNION ALL
    SELECT id, data, content_hash, game_date, created_at AS recorded_at
    FROM simulation_checkpoints WHERE game_id = ? AND turn = ?
    ORDER BY game_date DESC, recorded_at DESC, id DESC
  `).all(current.id, previousTurn, current.id, previousTurn) as PersistedAnchor[];

  for (const anchor of anchors) {
    let saved: SaveData;
    try {
      const parsed: unknown = JSON.parse(anchor.data);
      if (!record(parsed) || !anchor.content_hash || semanticStateHash(parsed) !== anchor.content_hash) continue;
      saved = parsed as unknown as SaveData;
      if (saved.currentTurn !== previousTurn || !saved.currentDate || saved.currentDate >= current.currentDate
        || !isEconomicSnapshot(saved.economicState) || saved.economicState.sourceBranchId !== branchId
        || !saved.players?.some(player => player.polityId === current.playerPolityId)
        || !currentHistoryContains(saved, current)) continue;
    } catch (error) { console.error('HIST3 parse/hash fail', (error as Error).message); continue; }

    const row = db.prepare(`
      SELECT account, turn, recorded_at FROM national_account_history
      WHERE game_id = ? AND branch_id = ? AND polity_id = ? AND game_date = ?
        AND recorded_at <= ?
    `).get(current.id, branchId, current.playerPolityId, saved.currentDate, anchor.recorded_at) as PersistedAccount | undefined;
    console.error('HIST4', { row, previousTurn });
    if (!row || (row.turn !== previousTurn && row.turn !== previousTurn - 1)) continue;
    let account: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(row.account);
      if (!record(parsed) || parsed.polityId !== current.playerPolityId) continue;
      account = parsed;
    } catch (error) { console.error('HIST5 account parse fail'); continue; }
    const money = finite(account.money);
    const previous = buildVerifiedWorldSnapshot({
      gameData: {
        id: current.id, currentDate: saved.currentDate, currentTurn: saved.currentTurn,
        playerPolityId: current.playerPolityId,
        worldState: {
          accounts: { [current.playerPolityId]: account as Partial<NationalAccount> },
          resources: money === null ? {} : { stock: { money } },
        },
      },
      branchId,
      // Only a recorded engine measurement can supply historical coverage.
      // It is absent in current legacy account history, so normally unknown.
      foodCoverageMonths: finite(account.foodCoverageMonths),
    });
    if (!Object.values(previous.facts).some(fact => finite(fact.rawValue) !== null)) continue;
    const source = `national_account_history.${branchId}.${current.playerPolityId}.${saved.currentDate}.account`;
    const fields: Record<string, string> = {
      treasury: 'money', monthlyBalance: 'monthlyBalance', foodCoverageMonths: 'foodCoverageMonths',
      socialTension: 'socialTension', revenue: 'monthlyRevenue', expenditure: 'monthlyExpenses',
      stability: 'stability', population: 'population',
    };
    for (const [key, field] of Object.entries(fields)) {
      if (previous.facts[key]) previous.facts[key].sourceRef = `${source}.${field}`;
    }
    return previous;
  }
  return null;
}
