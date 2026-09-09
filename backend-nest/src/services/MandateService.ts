/**
 * World Story — M07 µ1: servizio mandati con persistenza (maestro §7.5).
 * ===================================================================
 * Persistenza SQLite dei mandati e delle loro esecuzioni. Ogni esecuzione
 * cita `mandateId` e consuma il plafond UNA volta: la chiave unica
 * (branch_id, mandate_id, execution_id) rende il retry un no-op verificato,
 * mai una seconda spesa. Le regole (whitelist, fornitori, prezzo, periodo,
 * tetto) sono applicate dal motore puro `MandateEngine`; qui si leggono e
 * scrivono le righe in transazioni canoniche.
 */
import db, { withCanonicalTransaction } from '../database';
import {
  MandateDefinition,
  MandateError,
  MandateExecution,
  MandateState,
  MandateStatus,
  createMandate,
  executeMandate,
  remainingPlafond,
  validateMandate,
} from '../core/mandates/MandateEngine';
import { IntString, intToString, parseInteger } from '../domain/quantities';

export class MandateConflictError extends MandateError {
  constructor(message: string) {
    super('mandate_conflict', message);
    this.name = 'MandateConflictError';
  }
}

interface MandateRow {
  game_id: string;
  branch_id: string;
  mandate_id: string;
  title: string;
  currency_id: string;
  ceiling: IntString;
  start_date: string;
  end_date: string;
  whitelist: string;
  suppliers: string;
  price_limit: IntString | null;
  resource_id: string | null;
  min_stock: IntString | null;
  no_new_debt: number;
  spent: IntString;
  status: MandateStatus;
}

interface ExecutionRow {
  branch_id: string;
  mandate_id: string;
  execution_id: string;
  action_type: string;
  supplier: string;
  amount: IntString;
  price: IntString | null;
  quantity: IntString | null;
  at_date: string;
}

/** Record completo per motori server-side valutati al tick. */
export interface ActiveMandateRecord {
  readonly definition: MandateDefinition;
  readonly state: MandateState;
}

function parseJsonList(value: string, label: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new MandateError('bad_storage', `${label}: lista JSON non valida`);
    }
    return parsed as string[];
  } catch (error) {
    if (error instanceof MandateError) throw error;
    throw new MandateError('bad_storage', `${label}: JSON non valido`);
  }
}

function toDefinition(row: MandateRow): MandateDefinition {
  return {
    id: row.mandate_id,
    title: row.title,
    currencyId: row.currency_id,
    ceiling: row.ceiling,
    startDate: row.start_date,
    endDate: row.end_date,
    whitelist: parseJsonList(row.whitelist, 'whitelist'),
    suppliers: parseJsonList(row.suppliers, 'suppliers'),
    priceLimit: row.price_limit ?? undefined,
    resourceId: row.resource_id ?? undefined,
    minStock: row.min_stock ?? undefined,
    noNewDebt: row.no_new_debt === 1,
  };
}

function toState(row: MandateRow, executions: readonly MandateExecution[]): MandateState {
  return { id: row.mandate_id, status: row.status, spent: row.spent, executions };
}

function findMandate(branchId: string, mandateId: string): MandateRow | null {
  const row = db.prepare(
    `SELECT game_id, branch_id, mandate_id, title, currency_id, ceiling, start_date, end_date,
            whitelist, suppliers, price_limit, resource_id, min_stock, no_new_debt, spent, status
       FROM mandates WHERE branch_id = ? AND mandate_id = ?`,
  ).get(branchId, mandateId) as MandateRow | undefined;
  return row ?? null;
}

function findExecutions(branchId: string, mandateId: string): MandateExecution[] {
  const rows = db.prepare(
    `SELECT branch_id, mandate_id, execution_id, action_type, supplier, amount, price, quantity, at_date
       FROM mandate_executions WHERE branch_id = ? AND mandate_id = ? ORDER BY id ASC`,
  ).all(branchId, mandateId) as ExecutionRow[];
  return rows.map((row) => ({
    executionId: row.execution_id,
    mandateId: row.mandate_id,
    actionType: row.action_type,
    supplier: row.supplier,
    amount: row.amount,
    price: row.price ?? undefined,
    quantity: row.quantity ?? undefined,
    atDate: row.at_date,
  }));
}

function findExecution(branchId: string, mandateId: string, executionId: string): ExecutionRow | null {
  const row = db.prepare(
    `SELECT branch_id, mandate_id, execution_id, action_type, supplier, amount, price, quantity, at_date
       FROM mandate_executions
      WHERE branch_id = ? AND mandate_id = ? AND execution_id = ?`,
  ).get(branchId, mandateId, executionId) as ExecutionRow | undefined;
  return row ?? null;
}

function assertSameDefinition(existing: MandateRow, gameId: string, def: MandateDefinition): void {
  if (
    existing.game_id !== gameId
    || existing.title !== def.title
    || existing.currency_id !== def.currencyId
    || existing.ceiling !== def.ceiling
    || existing.start_date !== def.startDate
    || existing.end_date !== def.endDate
    || existing.whitelist !== JSON.stringify(def.whitelist)
    || existing.suppliers !== JSON.stringify(def.suppliers)
    || existing.price_limit !== (def.priceLimit ?? null)
    || existing.resource_id !== (def.resourceId ?? null)
    || existing.min_stock !== (def.minStock ?? null)
    || existing.no_new_debt !== (def.noNewDebt ? 1 : 0)
  ) {
    throw new MandateConflictError(`mandato ${def.id} già esistente con contenuto diverso nel ramo ${existing.branch_id}`);
  }
}

function assertSameExecution(existing: ExecutionRow, execution: MandateExecution): void {
  if (
    existing.action_type !== execution.actionType
    || existing.supplier !== execution.supplier
    || existing.amount !== execution.amount
    || existing.price !== (execution.price ?? null)
    || existing.quantity !== (execution.quantity ?? null)
    || existing.at_date !== execution.atDate
  ) {
    throw new MandateConflictError(`esecuzione ${execution.executionId} già registrata con contenuto diverso`);
  }
}

/** Crea un mandato (idempotente: stesso contenuto → no-op, diverso → conflitto). */
export function createMandateRecord(
  gameId: string,
  branchId: string,
  def: MandateDefinition,
): { mandate: MandateState; created: boolean } {
  validateMandate(def);
  return withCanonicalTransaction(() => {
    const existing = findMandate(branchId, def.id);
    if (existing !== null) {
      assertSameDefinition(existing, gameId, def);
      return { mandate: toState(existing, findExecutions(branchId, def.id)), created: false };
    }
    db.prepare(
      `INSERT INTO mandates
        (game_id, branch_id, mandate_id, title, currency_id, ceiling, start_date, end_date,
         whitelist, suppliers, price_limit, resource_id, min_stock, no_new_debt, spent, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', 'active')`,
    ).run(
      gameId, branchId, def.id, def.title, def.currencyId, def.ceiling, def.startDate, def.endDate,
      JSON.stringify(def.whitelist), JSON.stringify(def.suppliers),
      def.priceLimit ?? null, def.resourceId ?? null, def.minStock ?? null, def.noNewDebt ? 1 : 0,
    );
    const row = findMandate(branchId, def.id);
    if (!row) throw new MandateError('not_found', `mandato ${def.id} non creato`);
    return { mandate: toState(row, []), created: true };
  });
}

/**
 * Esegue un'azione nel mandato: applica le regole del motore puro e persiste
 * l'esecuzione consumando il plafond UNA volta. Il retry con lo stesso
 * executionId è no-op verificato, mai una seconda spesa.
 */
export function executeMandateRecord(
  gameId: string,
  branchId: string,
  mandateId: string,
  execution: MandateExecution,
): { mandate: MandateState; applied: boolean } {
  return withCanonicalTransaction(() => {
    const row = findMandate(branchId, mandateId);
    if (!row) throw new MandateError('not_found', `mandato non trovato: ${mandateId} nel ramo ${branchId}`);
    if (row.game_id !== gameId) throw new MandateConflictError(`mandato ${mandateId} appartiene a un'altra partita`);

    const def = toDefinition(row);
    const executions = findExecutions(branchId, mandateId);
    const state = toState(row, executions);

    const existing = findExecution(branchId, mandateId, execution.executionId);
    if (existing !== null) {
      assertSameExecution(existing, execution);
      return { mandate: toState(row, executions), applied: false };
    }

    const result = executeMandate(def, state, execution);
    if (!result.applied) {
      return { mandate: result.state, applied: false };
    }

    db.prepare(
      `INSERT INTO mandate_executions
        (branch_id, mandate_id, execution_id, action_type, supplier, amount, price, quantity, at_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      branchId, mandateId, execution.executionId, execution.actionType, execution.supplier,
      execution.amount, execution.price ?? null, execution.quantity ?? null, execution.atDate,
    );
    db.prepare(
      `UPDATE mandates SET spent = ? WHERE branch_id = ? AND mandate_id = ?`,
    ).run(result.state.spent, branchId, mandateId);

    const updated = findMandate(branchId, mandateId);
    if (!updated) throw new MandateError('not_found', `mandato ${mandateId} non aggiornato`);
    return { mandate: toState(updated, findExecutions(branchId, mandateId)), applied: true };
  });
}

/** Legge un mandato con le sue esecuzioni. */
export function getMandate(branchId: string, mandateId: string): MandateState | null {
  const row = findMandate(branchId, mandateId);
  if (row === null) return null;
  return toState(row, findExecutions(branchId, mandateId));
}

/** Legge la definizione di un mandato (per il motore). */
export function getMandateDefinition(branchId: string, mandateId: string): MandateDefinition | null {
  const row = findMandate(branchId, mandateId);
  return row === null ? null : toDefinition(row);
}

/** Elenca i mandati attivi di un ramo. */
export function listActiveMandates(branchId: string): MandateState[] {
  const rows = db.prepare(
    `SELECT game_id, branch_id, mandate_id, title, currency_id, ceiling, start_date, end_date,
            whitelist, suppliers, price_limit, resource_id, min_stock, no_new_debt, spent, status
       FROM mandates WHERE branch_id = ? AND status = 'active' ORDER BY mandate_id ASC`,
  ).all(branchId) as MandateRow[];
  return rows.map((row) => toState(row, findExecutions(branchId, row.mandate_id)));
}

/** Elenco fenced game+ramo per i motori deterministici del tick (M07 µ4). */
export function listActiveMandateRecords(gameId: string, branchId: string): readonly ActiveMandateRecord[] {
  const rows = db.prepare(
    `SELECT game_id, branch_id, mandate_id, title, currency_id, ceiling, start_date, end_date,
            whitelist, suppliers, price_limit, resource_id, min_stock, no_new_debt, spent, status
       FROM mandates WHERE game_id = ? AND branch_id = ? AND status = 'active' ORDER BY mandate_id ASC`,
  ).all(gameId, branchId) as MandateRow[];
  return rows.map((row) => ({ definition: toDefinition(row), state: toState(row, findExecutions(branchId, row.mandate_id)) }));
}

/** Plafond residuo di un mandato. */
export function getMandateRemaining(branchId: string, mandateId: string): IntString | null {
  const row = findMandate(branchId, mandateId);
  if (row === null) return null;
  return remainingPlafond(toDefinition(row), toState(row, findExecutions(branchId, mandateId)));
}

/** Annulla un mandato: nessuna nuova esecuzione, le già applicate restano. */
function cancelMandate(expectedGameId: string | null, branchId: string, mandateId: string): MandateState {
  return withCanonicalTransaction(() => {
    const row = findMandate(branchId, mandateId);
    if (!row) throw new MandateError('not_found', `mandato non trovato: ${mandateId} nel ramo ${branchId}`);
    if (expectedGameId !== null && row.game_id !== expectedGameId) {
      throw new MandateConflictError(`mandato ${mandateId} appartiene a un'altra partita`);
    }
    const state = toState(row, findExecutions(branchId, mandateId));
    if (state.status === 'cancelled') throw new MandateError('already_cancelled', `mandato ${mandateId} già annullato`);
    db.prepare(`UPDATE mandates SET status = 'cancelled' WHERE branch_id = ? AND mandate_id = ?`).run(branchId, mandateId);
    const updated = findMandate(branchId, mandateId);
    if (!updated) throw new MandateError('not_found', `mandato ${mandateId} non aggiornato`);
    return toState(updated, findExecutions(branchId, mandateId));
  });
}

export function cancelMandateRecord(branchId: string, mandateId: string): MandateState {
  return cancelMandate(null, branchId, mandateId);
}

/** Variante fenced per comandi gameplay: impedisce cancel cross-game. */
export function cancelMandateRecordForGame(gameId: string, branchId: string, mandateId: string): MandateState {
  return cancelMandate(gameId, branchId, mandateId);
}

/** Verifica che una spesa non superi il plafond residuo (per il passo 2). */
export function assertWithinPlafond(branchId: string, mandateId: string, amount: IntString): void {
  const remaining = getMandateRemaining(branchId, mandateId);
  if (remaining === null) throw new MandateError('not_found', `mandato non trovato: ${mandateId}`);
  if (parseInteger(amount, 'amount') > parseInteger(remaining, 'remaining')) {
    throw new MandateError('ceiling_exceeded', `mandato ${mandateId}: spesa ${amount} supera il plafond residuo ${remaining}`);
  }
}

/** Somma del plafond consumato (per la dashboard del passo 4). */
export function totalMandateSpent(branchId: string): IntString {
  const rows = db.prepare(
    `SELECT spent FROM mandates WHERE branch_id = ?`,
  ).all(branchId) as Array<{ spent: IntString }>;
  let total = 0n;
  for (const row of rows) total += parseInteger(row.spent, 'spent');
  return intToString(total);
}
