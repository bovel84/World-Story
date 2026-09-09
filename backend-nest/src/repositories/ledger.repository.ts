/**
 * World Story — M02 µ2: repository del ledger append-only (maestro §6.2, §4.3).
 * ==========================================================================
 * - Chiave unica (branch_id, effect_id, entry_index): la ripetizione è
 *   no-op VERIFICATA — se la riga esiste con contenuti identici è saltata,
 *   se differisce è un conflitto (nessun secondo pagamento).
 * - Append-only nel ramo: nessun UPDATE/DELETE esposto.
 * - Ricostruzione: saldi = Σ ingressi − Σ uscite ripercorrendo le righe.
 * - Le scritture avvengono in transazione canonica (annidamenti = savepoint).
 */
import db, { withCanonicalTransaction } from '../database';
import {
  BalanceMap,
  LedgerEntryInput,
  applyLedgerEntries,
  parseHoldingKey,
  validateLedgerEntry,
} from '../domain/ledger';
import { IntString, intToString, parseInteger } from '../domain/quantities';

interface LedgerRow {
  id: number;
  game_id: string;
  branch_id: string;
  effect_id: string;
  entry_index: number;
  cause: string;
  kind: 'money' | 'material';
  unit_id: string;
  from_ref: string | null;
  to_ref: string | null;
  owner_ref: string | null;
  delta: string;
  at_date: string;
}

function toInput(row: LedgerRow): LedgerEntryInput {
  return {
    effectId: row.effect_id,
    entryIndex: row.entry_index,
    cause: row.cause as LedgerEntryInput['cause'],
    kind: row.kind,
    unitId: row.unit_id,
    fromRef: row.from_ref,
    toRef: row.to_ref,
    ...(row.owner_ref !== null ? { ownerRef: row.owner_ref } : {}),
    delta: row.delta,
    atDate: row.at_date,
  };
}

function rowsEqual(a: LedgerEntryInput, b: LedgerEntryInput): boolean {
  return a.effectId === b.effectId
    && a.entryIndex === b.entryIndex
    && a.cause === b.cause
    && a.kind === b.kind
    && a.unitId === b.unitId
    && a.fromRef === b.fromRef
    && a.toRef === b.toRef
    && (a.ownerRef ?? null) === (b.ownerRef ?? null)
    && a.delta === b.delta
    && a.atDate === b.atDate;
}

export class LedgerConflictError extends Error {
  readonly code = 'ledger_conflict';
  constructor(message: string) {
    super(message);
    this.name = 'LedgerConflictError';
  }
}

export function getLedgerEntry(
  branchId: string,
  effectId: string,
  entryIndex: number,
): LedgerEntryInput | null {
  const row = db.prepare(
    'SELECT * FROM ledger_entries WHERE branch_id = ? AND effect_id = ? AND entry_index = ?',
  ).get(branchId, effectId, entryIndex) as LedgerRow | undefined;
  return row ? toInput(row) : null;
}

/**
 * Append verificato: per ogni riga, se la chiave esiste già
 *  - con contenuto identico → no-op (ripetizione, §6.2);
 *  - con contenuto diverso → conflitto: NESSUN secondo pagamento.
 * Le righe nuove vengono inserite; l'intera operazione è una transazione.
 */
export function appendLedgerEntries(
  gameId: string,
  branchId: string,
  entries: readonly LedgerEntryInput[],
): { appended: number; duplicates: number } {
  for (const entry of entries) validateLedgerEntry(entry);
  return withCanonicalTransaction(() => {
    let appended = 0;
    let duplicates = 0;
    const insert = db.prepare(
      `INSERT INTO ledger_entries
        (game_id, branch_id, effect_id, entry_index, cause, kind, unit_id, from_ref, to_ref, owner_ref, delta, at_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of entries) {
      const existing = getLedgerEntry(branchId, entry.effectId, entry.entryIndex);
      if (existing !== null) {
        if (!rowsEqual(existing, entry)) {
          throw new LedgerConflictError(
            `ledger: riga già registrata con contenuto diverso ` +
            `(branch ${branchId}, effect ${entry.effectId}, index ${entry.entryIndex}): ` +
            `esistente ${existing.kind}/${existing.cause}/${existing.unitId}/${existing.delta} ` +
            `${existing.fromRef ?? '∅'}→${existing.toRef ?? '∅'} @${existing.atDate} vs ` +
            `nuova ${entry.kind}/${entry.cause}/${entry.unitId}/${entry.delta} ` +
            `${entry.fromRef ?? '∅'}→${entry.toRef ?? '∅'} @${entry.atDate}`,
          );
        }
        duplicates += 1;
        continue;
      }
      insert.run(
        gameId, branchId, entry.effectId, entry.entryIndex,
        entry.cause, entry.kind, entry.unitId,
        entry.fromRef, entry.toRef, entry.ownerRef ?? null, entry.delta, entry.atDate,
      );
      appended += 1;
    }
    return { appended, duplicates };
  });
}

/** Righe del ramo in ordine di inserimento (ordine di append). */
export function listLedgerEntries(branchId: string): LedgerEntryInput[] {
  const rows = db.prepare(
    'SELECT * FROM ledger_entries WHERE branch_id = ? ORDER BY id ASC',
  ).all(branchId) as LedgerRow[];
  return rows.map(toInput);
}

export interface AccountBalance {
  readonly ref: string;
  readonly currencyId: string;
  readonly balance: IntString;
}

export interface StockBalance {
  readonly holder: string;
  readonly resourceId: string;
  readonly quantity: IntString;
}

/** Stock con provenienza proprietaria attestata dal producer. Le righe legacy
 * senza ownerRef NON sono attribuite a nessuno: meglio un deficit esplicito
 * che contare custodia/merce estera come disponibilità della polity. */
export interface OwnedStockBalance extends StockBalance {
  readonly owner: string;
}

/** Ricostruisce la custodia fisica per proprietario. La stessa merce può stare
 * presso un holder terzo (transito/custode) ma resta nel saldo del suo owner. */
export function reconstructOwnedStock(branchId: string): readonly OwnedStockBalance[] {
  const balances = new Map<string, bigint>();
  for (const entry of listLedgerEntries(branchId)) {
    if (entry.kind !== 'material' || !entry.ownerRef) continue;
    const apply = (holder: string, sign: bigint): void => {
      const key = JSON.stringify([entry.ownerRef, holder, entry.unitId]);
      balances.set(key, (balances.get(key) ?? 0n) + sign * parseInteger(entry.delta, 'delta'));
    };
    if (entry.fromRef !== null) apply(entry.fromRef, -1n);
    if (entry.toRef !== null) apply(entry.toRef, 1n);
  }
  return [...balances.entries()].map(([key, quantity]) => {
    const [owner, holder, resourceId] = JSON.parse(key) as [string, string, string];
    return { owner, holder, resourceId, quantity: intToString(quantity) };
  });
}

export interface LedgerReconstruction {
  readonly accounts: readonly AccountBalance[];
  readonly stock: readonly StockBalance[];
  readonly entryCount: number;
}

/**
 * Ricostruzione dei saldi ripercorrendo il ledger del ramo (append-only):
 * ogni riga sottrae il delta dall'origine e lo aggiunge alla destinazione.
 * Il saldo iniziale NON è qui: proviene dallo stato iniziale del catalogo.
 */
export function reconstructBalances(branchId: string): LedgerReconstruction {
  const entries = listLedgerEntries(branchId);
  const balances: BalanceMap = applyLedgerEntries(new Map(), entries);
  const accounts: AccountBalance[] = [];
  const stock: StockBalance[] = [];
  for (const [key, value] of balances) {
    const { kind, unitId, ref } = parseHoldingKey(key);
    if (kind === 'money') accounts.push({ ref, currencyId: unitId, balance: value });
    else stock.push({ holder: ref, resourceId: unitId, quantity: value });
  }
  return { accounts, stock, entryCount: entries.length };
}