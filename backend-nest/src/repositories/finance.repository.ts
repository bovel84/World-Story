import db from '../database';

/** Un arretrato/default blocca nuovi impegni monetari (§6.1), non i retry. */
export function hasSpendingBlock(branchId: string, debtorRef: string, currencyId: string): boolean {
  const row = db.prepare(
    `SELECT 1 FROM finance_cashflows
      WHERE branch_id = ? AND debtor_ref = ? AND currency_id = ?
        AND status IN ('arrears', 'default') LIMIT 1`,
  ).get(branchId, debtorRef, currencyId) as { 1: number } | undefined;
  return row !== undefined;
}
