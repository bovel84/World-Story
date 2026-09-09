/**
 * World Story — M02 µ3: prenotazioni atomiche di fondi e stock (§6.1–6.2).
 * =====================================================================
 * Prenotare NON consuma: `committed` è separato dal `total` del ledger;
 * `available = total − committed`. Il consume converte la prenotazione in un
 * movimento ledger e riduce il residuo nella STESSA transazione. La release
 * libera soltanto il residuo non consumato. Ogni operazione ha una chiave
 * idempotente verificata: un retry è no-op, non una seconda sottrazione.
 */
import db, { withCanonicalTransaction } from '../database';
import {
  LedgerEntryInput,
  LedgerKind,
  validateLedgerEntry,
} from '../domain/ledger';
import {
  IntString,
  QuantityCodecError,
  intToString,
  isIdString,
  parseInteger,
} from '../domain/quantities';
import { hasSpendingBlock } from '../repositories/finance.repository';
import { appendLedgerEntries, reconstructBalances } from '../repositories/ledger.repository';

export type ReservationStatus = 'active' | 'consumed' | 'released';
export type ReservationOperationType = 'consume' | 'release';

/** Il conto (money) o titolare/lotto (material) a cui si applica la riserva. */
export interface ReservationTarget {
  readonly kind: LedgerKind;
  readonly unitId: string;
  readonly holderRef: string;
}

export interface CreateReservationInput {
  /** Chiave idempotente della creazione nel ramo. */
  readonly reservationId: string;
  readonly target: ReservationTarget;
  /** Quantità impegnata (strettamente positiva) in unità minime/base. */
  readonly amount: IntString;
}

export interface ConsumeReservationInput {
  /** Chiave idempotente dell'operazione consume della prenotazione. */
  readonly operationId: string;
  readonly amount: IntString;
  /** Movimento reale: deve uscire dall'holder, stessa kind/unità/delta. */
  readonly ledgerEntry: LedgerEntryInput;
}

export interface ReleaseReservationInput {
  /** Chiave idempotente dell'operazione release della prenotazione. */
  readonly operationId: string;
  /** Parte residua da liberare; per cancellare, passare remainingAmount. */
  readonly amount: IntString;
}

export interface ReservationRecord {
  readonly gameId: string;
  readonly branchId: string;
  readonly reservationId: string;
  readonly target: ReservationTarget;
  /** Quantità impegnata al momento della creazione (immutabile). */
  readonly initialAmount: IntString;
  /** Parte ancora impegnata: è l'unica che contribuisce a committed. */
  readonly remainingAmount: IntString;
  readonly status: ReservationStatus;
}

export interface ReservationAvailability {
  readonly target: ReservationTarget;
  /** Saldo totale ricostruito dal ledger (non comprende committed). */
  readonly total: IntString;
  /** Somma bigint dei residui active (mai SUM() SQL su TEXT). */
  readonly committed: IntString;
  /** total − committed; negativo = incoerenza esplicita, mai nascosta. */
  readonly available: IntString;
  /** max(0, committed − total): espone l'eventuale violazione senza nasconderla. */
  readonly shortfall: IntString;
}

interface ReservationRow {
  game_id: string;
  branch_id: string;
  reservation_id: string;
  kind: LedgerKind;
  unit_id: string;
  holder_ref: string;
  initial_amount: IntString;
  remaining_amount: IntString;
  status: ReservationStatus;
}

interface ReservationOperationRow {
  branch_id: string;
  reservation_id: string;
  operation_id: string;
  operation_type: ReservationOperationType;
  amount: IntString;
  ledger_effect_id: string | null;
  ledger_entry_index: number | null;
}

const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class ReservationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
  }
}

export class ReservationConflictError extends ReservationError {
  constructor(message: string) {
    super('reservation_conflict', message);
    this.name = 'ReservationConflictError';
  }
}

export class InsufficientAvailabilityError extends ReservationError {
  constructor(message: string) {
    super('insufficient_available', message);
    this.name = 'InsufficientAvailabilityError';
  }
}

function assertOpaqueId(value: string, label: string): void {
  if (typeof value !== 'string' || !OPAQUE_ID_RE.test(value)) {
    throw new ReservationError('bad_id', `${label}: atteso id opaco ASCII non vuoto (max 128), ricevuto "${String(value)}"`);
  }
}

function assertTarget(target: ReservationTarget): void {
  if (target.kind !== 'money' && target.kind !== 'material') {
    throw new ReservationError('bad_kind', `kind atteso money/material, ricevuto ${String(target.kind)}`);
  }
  if (!isIdString(target.unitId)) {
    throw new ReservationError('bad_unit', `unitId atteso [a-z0-9_], ricevuto "${String(target.unitId)}"`);
  }
  if (typeof target.holderRef !== 'string' || target.holderRef.length === 0 || target.holderRef.length > 160) {
    throw new ReservationError('bad_holder', 'holderRef obbligatorio (stringa max 160)');
  }
}

function assertPositive(value: IntString, label: string): bigint {
  try {
    const amount = parseInteger(value, label);
    if (amount <= 0n) throw new ReservationError('bad_amount', `${label} deve essere > 0, ricevuto ${value}`);
    return amount;
  } catch (error) {
    if (error instanceof QuantityCodecError) throw new ReservationError(error.code, `${label}: ${error.message}`);
    throw error;
  }
}

function toRecord(row: ReservationRow): ReservationRecord {
  return {
    gameId: row.game_id,
    branchId: row.branch_id,
    reservationId: row.reservation_id,
    target: { kind: row.kind, unitId: row.unit_id, holderRef: row.holder_ref },
    initialAmount: row.initial_amount,
    remainingAmount: row.remaining_amount,
    status: row.status,
  };
}

function findReservation(branchId: string, reservationId: string): ReservationRow | null {
  const row = db.prepare(
    `SELECT game_id, branch_id, reservation_id, kind, unit_id, holder_ref,
            initial_amount, remaining_amount, status
       FROM reservations WHERE branch_id = ? AND reservation_id = ?`,
  ).get(branchId, reservationId) as ReservationRow | undefined;
  return row ?? null;
}

function findOperation(branchId: string, reservationId: string, operationId: string): ReservationOperationRow | null {
  const row = db.prepare(
    `SELECT branch_id, reservation_id, operation_id, operation_type, amount,
            ledger_effect_id, ledger_entry_index
       FROM reservation_operations
      WHERE branch_id = ? AND reservation_id = ? AND operation_id = ?`,
  ).get(branchId, reservationId, operationId) as ReservationOperationRow | undefined;
  return row ?? null;
}

function getCommitted(branchId: string, target: ReservationTarget): bigint {
  const rows = db.prepare(
    `SELECT remaining_amount FROM reservations
      WHERE branch_id = ? AND kind = ? AND unit_id = ? AND holder_ref = ? AND status = 'active'`,
  ).all(branchId, target.kind, target.unitId, target.holderRef) as Array<{ remaining_amount: IntString }>;
  let committed = 0n;
  for (const row of rows) committed += parseInteger(row.remaining_amount, 'remaining_amount');
  return committed;
}

function getLedgerTotal(branchId: string, target: ReservationTarget): bigint {
  const reconstruction = reconstructBalances(branchId);
  if (target.kind === 'money') {
    const balance = reconstruction.accounts.find(
      (item) => item.ref === target.holderRef && item.currencyId === target.unitId,
    );
    return parseInteger(balance?.balance ?? '0', 'ledger money balance');
  }
  const balance = reconstruction.stock.find(
    (item) => item.holder === target.holderRef && item.resourceId === target.unitId,
  );
  return parseInteger(balance?.quantity ?? '0', 'ledger material balance');
}

function calculateAvailability(branchId: string, target: ReservationTarget): ReservationAvailability {
  const total = getLedgerTotal(branchId, target);
  const committed = getCommitted(branchId, target);
  const available = total - committed;
  const shortfall = available < 0n ? -available : 0n;
  return {
    target,
    total: intToString(total),
    committed: intToString(committed),
    available: intToString(available),
    shortfall: intToString(shortfall),
  };
}

function assertSameCreation(existing: ReservationRow, gameId: string, input: CreateReservationInput): void {
  const target = input.target;
  if (
    existing.game_id !== gameId
    || existing.kind !== target.kind
    || existing.unit_id !== target.unitId
    || existing.holder_ref !== target.holderRef
    || existing.initial_amount !== input.amount
  ) {
    throw new ReservationConflictError(
      `prenotazione ${input.reservationId} già esistente con contenuto diverso nel ramo ${existing.branch_id}`,
    );
  }
}

function assertExisting(branchId: string, reservationId: string): ReservationRow {
  const reservation = findReservation(branchId, reservationId);
  if (reservation === null) throw new ReservationError('not_found', `prenotazione non trovata: ${reservationId} nel ramo ${branchId}`);
  return reservation;
}

function assertOperationMatch(
  existing: ReservationOperationRow,
  operationType: ReservationOperationType,
  amount: IntString,
  ledgerEntry: LedgerEntryInput | null,
): void {
  const sameLedger = ledgerEntry === null
    ? existing.ledger_effect_id === null && existing.ledger_entry_index === null
    : existing.ledger_effect_id === ledgerEntry.effectId && existing.ledger_entry_index === ledgerEntry.entryIndex;
  if (existing.operation_type !== operationType || existing.amount !== amount || !sameLedger) {
    throw new ReservationConflictError(
      `operazione ${existing.operation_id} già registrata con contenuto diverso sulla prenotazione ${existing.reservation_id}`,
    );
  }
}

function assertConsumeEntry(reservation: ReservationRow, amount: IntString, entry: LedgerEntryInput, operationId: string): void {
  validateLedgerEntry(entry);
  if (entry.effectId !== operationId) {
    throw new ReservationError('effect_mismatch', `ledgerEntry.effectId deve coincidere con operationId (${operationId})`);
  }
  if (
    entry.kind !== reservation.kind
    || entry.unitId !== reservation.unit_id
    || entry.fromRef !== reservation.holder_ref
    || entry.delta !== amount
  ) {
    throw new ReservationError(
      'ledger_mismatch',
      'consume: il movimento ledger deve uscire dallo stesso holder e avere kind/unitId/delta della prenotazione',
    );
  }
}

/** Legge total/committed/available per un conto o stock, senza conversioni implicite. */
export function getReservationAvailability(branchId: string, target: ReservationTarget): ReservationAvailability {
  assertTarget(target);
  return calculateAvailability(branchId, target);
}

export function getReservation(branchId: string, reservationId: string): ReservationRecord | null {
  assertOpaqueId(reservationId, 'reservationId');
  const row = findReservation(branchId, reservationId);
  return row === null ? null : toRecord(row);
}

/**
 * Crea una prenotazione: controlla disponibile e inserisce in una transazione.
 * Due client sequenziali non possono ottenere lo stesso stock/fondo: il secondo
 * vede il committed del primo e riceve insufficient_available.
 */
export function createReservation(
  gameId: string,
  branchId: string,
  input: CreateReservationInput,
): { reservation: ReservationRecord; created: boolean; availability: ReservationAvailability } {
  assertOpaqueId(input.reservationId, 'reservationId');
  assertTarget(input.target);
  const requested = assertPositive(input.amount, 'amount');
  return withCanonicalTransaction(() => {
    const existing = findReservation(branchId, input.reservationId);
    if (existing !== null) {
      assertSameCreation(existing, gameId, input);
      return {
        reservation: toRecord(existing),
        created: false,
        availability: calculateAvailability(branchId, input.target),
      };
    }

    if (input.target.kind === 'money' && hasSpendingBlock(branchId, input.target.holderRef, input.target.unitId)) {
      throw new ReservationError('spending_blocked', `nuovi impegni bloccati: arretrato/default su ${input.target.holderRef}/${input.target.unitId}`);
    }
    const availability = calculateAvailability(branchId, input.target);
    if (requested > parseInteger(availability.available, 'available')) {
      throw new InsufficientAvailabilityError(
        `prenotazione ${input.reservationId}: richiesti ${input.amount}, disponibili ${availability.available} ` +
        `(total ${availability.total}, committed ${availability.committed}, unità ${input.target.unitId})`,
      );
    }

    db.prepare(
      `INSERT INTO reservations
        (game_id, branch_id, reservation_id, kind, unit_id, holder_ref, initial_amount, remaining_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    ).run(
      gameId, branchId, input.reservationId, input.target.kind, input.target.unitId,
      input.target.holderRef, input.amount, input.amount,
    );
    const created = assertExisting(branchId, input.reservationId);
    return {
      reservation: toRecord(created),
      created: true,
      availability: calculateAvailability(branchId, input.target),
    };
  });
}

/**
 * Consuma una parte prenotata: il movimento ledger e il decremento del
 * residuo avvengono nella STESSA transazione. Il retry riesegue l'append
 * verificato del ledger (duplicate) e non decrementa una seconda volta.
 */
export function consumeReservation(
  gameId: string,
  branchId: string,
  reservationId: string,
  input: ConsumeReservationInput,
): { reservation: ReservationRecord; consumed: boolean } {
  assertOpaqueId(reservationId, 'reservationId');
  assertOpaqueId(input.operationId, 'operationId');
  const amount = assertPositive(input.amount, 'amount');
  return withCanonicalTransaction(() => {
    const reservation = assertExisting(branchId, reservationId);
    if (reservation.game_id !== gameId) throw new ReservationConflictError(`prenotazione ${reservationId} appartiene a un'altra partita`);
    assertConsumeEntry(reservation, input.amount, input.ledgerEntry, input.operationId);

    const existingOperation = findOperation(branchId, reservationId, input.operationId);
    if (existingOperation !== null) {
      assertOperationMatch(existingOperation, 'consume', input.amount, input.ledgerEntry);
      appendLedgerEntries(gameId, branchId, [input.ledgerEntry]); // duplicate verificato
      return { reservation: toRecord(assertExisting(branchId, reservationId)), consumed: false };
    }
    if (reservation.status !== 'active') {
      throw new ReservationError('not_active', `prenotazione ${reservationId} non attiva (${reservation.status})`);
    }
    if (amount > parseInteger(reservation.remaining_amount, 'remainingAmount')) {
      throw new ReservationError(
        'over_consume',
        `consume ${input.amount} supera il residuo prenotato ${reservation.remaining_amount} (${reservationId})`,
      );
    }

    // Append e decremento sono atomici (transazione canonica, nidificata = savepoint).
    appendLedgerEntries(gameId, branchId, [input.ledgerEntry]);
    const remaining = parseInteger(reservation.remaining_amount, 'remainingAmount') - amount;
    const status: ReservationStatus = remaining === 0n ? 'consumed' : 'active';
    db.prepare(
      `INSERT INTO reservation_operations
        (branch_id, reservation_id, operation_id, operation_type, amount, ledger_effect_id, ledger_entry_index)
       VALUES (?, ?, ?, 'consume', ?, ?, ?)`,
    ).run(branchId, reservationId, input.operationId, input.amount, input.ledgerEntry.effectId, input.ledgerEntry.entryIndex);
    db.prepare(
      `UPDATE reservations SET remaining_amount = ?, status = ?
        WHERE branch_id = ? AND reservation_id = ?`,
    ).run(intToString(remaining), status, branchId, reservationId);
    return { reservation: toRecord(assertExisting(branchId, reservationId)), consumed: true };
  });
}

/**
 * Libera parte del residuo non consumato. Non genera ledger entry: prenotare
 * non aveva sottratto stock/cassa. Per cancellazione completa passare il
 * remainingAmount restituito da getReservation/create/consume.
 */
export function releaseReservation(
  gameId: string,
  branchId: string,
  reservationId: string,
  input: ReleaseReservationInput,
): { reservation: ReservationRecord; released: boolean } {
  assertOpaqueId(reservationId, 'reservationId');
  assertOpaqueId(input.operationId, 'operationId');
  const amount = assertPositive(input.amount, 'amount');
  return withCanonicalTransaction(() => {
    const reservation = assertExisting(branchId, reservationId);
    if (reservation.game_id !== gameId) throw new ReservationConflictError(`prenotazione ${reservationId} appartiene a un'altra partita`);
    const existingOperation = findOperation(branchId, reservationId, input.operationId);
    if (existingOperation !== null) {
      assertOperationMatch(existingOperation, 'release', input.amount, null);
      return { reservation: toRecord(reservation), released: false };
    }
    if (reservation.status !== 'active') {
      throw new ReservationError('not_active', `prenotazione ${reservationId} non attiva (${reservation.status})`);
    }
    if (amount > parseInteger(reservation.remaining_amount, 'remainingAmount')) {
      throw new ReservationError(
        'over_release',
        `release ${input.amount} supera il residuo prenotato ${reservation.remaining_amount} (${reservationId})`,
      );
    }

    const remaining = parseInteger(reservation.remaining_amount, 'remainingAmount') - amount;
    const status: ReservationStatus = remaining === 0n ? 'released' : 'active';
    db.prepare(
      `INSERT INTO reservation_operations
        (branch_id, reservation_id, operation_id, operation_type, amount, ledger_effect_id, ledger_entry_index)
       VALUES (?, ?, ?, 'release', ?, NULL, NULL)`,
    ).run(branchId, reservationId, input.operationId, input.amount);
    db.prepare(
      `UPDATE reservations SET remaining_amount = ?, status = ?
        WHERE branch_id = ? AND reservation_id = ?`,
    ).run(intToString(remaining), status, branchId, reservationId);
    return { reservation: toRecord(assertExisting(branchId, reservationId)), released: true };
  });
}
