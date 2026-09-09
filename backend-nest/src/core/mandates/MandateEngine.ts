/**
 * World Story — M07 µ1: motore dei mandati (maestro §7.5, piano M07 passo 1).
 * =========================================================================
 * Un mandato è una delega controllata: tetto di spesa, periodo di validità,
 * whitelist di azioni ammesse, scadenza, fornitori e prezzo limite. Il motore
 * deterministico propone/esegue SOLO azioni nella whitelist e nei limiti
 * residui; ogni esecuzione cita `mandateId` e consuma il plafond UNA volta
 * (idempotenza per executionId). Nessuna autonomia estende il mandato da sola:
 * cambiamento sostanziale, nuova tecnologia, debito o superamento tetto
 * richiedono una decisione del giocatore (passo 2/3).
 *
 * Questo modulo è PURO (nessuna I/O): il servizio applica le stesse funzioni
 * con persistenza SQLite e transazioni canoniche.
 */
import {
  IntString,
  QuantityCodecError,
  isIdString,
  parseInteger,
  intToString,
} from '../../domain/quantities';

export type MandateStatus = 'active' | 'expired' | 'cancelled';

export interface MandateDefinition {
  readonly id: string;
  readonly title: string;
  readonly currencyId: string;
  /** Tetto totale spendibile (plafond) in unità monetarie minime. */
  readonly ceiling: IntString;
  /** Periodo di validità [startDate, endDate] (ISO-8601). */
  readonly startDate: string;
  readonly endDate: string;
  /** Azioni ammesse: il motore non esegue nulla fuori da questa whitelist. */
  readonly whitelist: readonly string[];
  /** Fornitori ammessi (ref opachi). */
  readonly suppliers: readonly string[];
  /** Prezzo limite per unità (opzionale). */
  readonly priceLimit?: IntString;
  /** Bene di riferimento per scorte minime (passo 2). */
  readonly resourceId?: string;
  /** Scorte minime da mantenere (passo 2). */
  readonly minStock?: IntString;
  /** Vietato nuovo debito: se true, un'esecuzione che crea debito è rifiutata. */
  readonly noNewDebt: boolean;
}

export interface MandateExecution {
  /** Chiave idempotente dell'esecuzione nel mandato. */
  readonly executionId: string;
  readonly mandateId: string;
  /** Deve appartenere alla whitelist del mandato. */
  readonly actionType: string;
  /** Deve appartenere ai fornitori ammessi. */
  readonly supplier: string;
  /** Spesa in unità monetarie minime (strettamente positiva). */
  readonly amount: IntString;
  /** Prezzo unitario (opzionale): se presente deve essere ≤ priceLimit. */
  readonly price?: IntString;
  /** Quantità acquistata (opzionale). */
  readonly quantity?: IntString;
  /** Data del mondo in cui l'esecuzione è committata (entro il periodo). */
  readonly atDate: string;
}

export interface MandateState {
  readonly id: string;
  readonly status: MandateStatus;
  /** Plafond già consumato (somma delle esecuzioni applicate). */
  readonly spent: IntString;
  readonly executions: readonly MandateExecution[];
}

export class MandateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MandateError';
    this.code = code;
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new MandateError('bad_id', `${label}: atteso id opaco ASCII non vuoto (max 128), ricevuto "${String(value)}"`);
  }
}

function assertDate(value: string, label: string): void {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new MandateError('bad_date', `${label}: attesa data ISO-8601 YYYY-MM-DD, ricevuto "${String(value)}"`);
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new MandateError('bad_date', `${label}: attesa data ISO-8601 YYYY-MM-DD canonica, ricevuto "${String(value)}"`);
  }
}

function assertPositive(value: IntString, label: string): bigint {
  try {
    const amount = parseInteger(value, label);
    if (amount <= 0n) throw new MandateError('bad_amount', `${label} deve essere > 0, ricevuto ${value}`);
    return amount;
  } catch (error) {
    if (error instanceof QuantityCodecError) throw new MandateError(error.code, `${label}: ${error.message}`);
    throw error;
  }
}

function assertNonNegative(value: IntString, label: string): bigint {
  try {
    const amount = parseInteger(value, label);
    if (amount < 0n) throw new MandateError('bad_amount', `${label} non può essere negativo, ricevuto ${value}`);
    return amount;
  } catch (error) {
    if (error instanceof QuantityCodecError) throw new MandateError(error.code, `${label}: ${error.message}`);
    throw error;
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new MandateError('bad_list', `${label}: valori duplicati non ammessi`);
    seen.add(value);
  }
}

/** Validazione completa della definizione di un mandato. */
export function validateMandate(def: MandateDefinition): void {
  assertId(def.id, 'mandate.id');
  if (!def.title || typeof def.title !== 'string' || def.title.length > 200) {
    throw new MandateError('bad_title', 'mandate.title obbligatorio (max 200)');
  }
  if (!isIdString(def.currencyId)) {
    throw new MandateError('bad_currency', `mandate.currencyId atteso [a-z0-9_], ricevuto "${String(def.currencyId)}"`);
  }
  assertPositive(def.ceiling, 'mandate.ceiling');
  assertDate(def.startDate, 'mandate.startDate');
  assertDate(def.endDate, 'mandate.endDate');
  if (def.endDate < def.startDate) {
    throw new MandateError('bad_period', 'mandate.endDate precede startDate');
  }
  if (!def.whitelist.length) throw new MandateError('bad_whitelist', 'mandate.whitelist non può essere vuota');
  assertUnique(def.whitelist, 'mandate.whitelist');
  if (!def.suppliers.length) throw new MandateError('bad_suppliers', 'mandate.suppliers non può essere vuoto');
  assertUnique(def.suppliers, 'mandate.suppliers');
  if (typeof def.priceLimit !== 'undefined') assertNonNegative(def.priceLimit, 'mandate.priceLimit');
  if (typeof def.resourceId !== 'undefined' && !isIdString(def.resourceId)) {
    throw new MandateError('bad_resource', `mandate.resourceId atteso [a-z0-9_], ricevuto "${String(def.resourceId)}"`);
  }
  if (typeof def.minStock !== 'undefined') assertNonNegative(def.minStock, 'mandate.minStock');
  if ((typeof def.resourceId === 'undefined') !== (typeof def.minStock === 'undefined')) {
    throw new MandateError('incomplete_stock_guard', 'resourceId e minStock devono essere dichiarati insieme');
  }
  if (typeof def.noNewDebt !== 'boolean') throw new MandateError('bad_flag', 'mandate.noNewDebt deve essere booleano');
}

/** Crea lo stato iniziale di un mandato (spesa zero, nessuna esecuzione). */
export function createMandate(def: MandateDefinition): MandateState {
  validateMandate(def);
  return { id: def.id, status: 'active', spent: '0', executions: [] };
}

/** Un mandato è scaduto se la data corrente supera endDate. */
export function isExpired(def: MandateDefinition, atDate: string): boolean {
  assertDate(atDate, 'atDate');
  return atDate > def.endDate;
}

/** Plafond residuo: ceiling − spent. */
export function remainingPlafond(def: MandateDefinition, state: MandateState): IntString {
  return intToString(parseInteger(def.ceiling, 'ceiling') - parseInteger(state.spent, 'spent'));
}

function assertExecutionShape(def: MandateDefinition, execution: MandateExecution): void {
  assertId(execution.executionId, 'execution.executionId');
  if (execution.mandateId !== def.id) {
    throw new MandateError('mandate_mismatch', `esecuzione ${execution.executionId} cita mandateId ${execution.mandateId}, atteso ${def.id}`);
  }
  if (!def.whitelist.includes(execution.actionType)) {
    throw new MandateError('not_in_whitelist', `azione "${execution.actionType}" fuori dalla whitelist del mandato ${def.id}`);
  }
  if (!def.suppliers.includes(execution.supplier)) {
    throw new MandateError('not_in_suppliers', `fornitore "${execution.supplier}" non ammesso dal mandato ${def.id}`);
  }
  assertPositive(execution.amount, 'execution.amount');
  assertDate(execution.atDate, 'execution.atDate');
  if (typeof execution.price !== 'undefined') assertNonNegative(execution.price, 'execution.price');
  if (typeof execution.quantity !== 'undefined') assertNonNegative(execution.quantity, 'execution.quantity');
}

/**
 * Esegue un'azione nel mandato: verifica whitelist, fornitori, prezzo limite,
 * periodo e tetto; consuma il plafond UNA volta. Un retry con lo stesso
 * executionId è no-op verificato (stesso contenuto), mai una seconda spesa.
 * Ritorna `applied:false` per il retry idempotente.
 */
export function executeMandate(
  def: MandateDefinition,
  state: MandateState,
  execution: MandateExecution,
): { state: MandateState; applied: boolean } {
  validateMandate(def);
  assertExecutionShape(def, execution);

  const existing = state.executions.find((e) => e.executionId === execution.executionId);
  if (existing) {
    if (
      existing.actionType !== execution.actionType
      || existing.supplier !== execution.supplier
      || existing.amount !== execution.amount
      || existing.price !== execution.price
      || existing.quantity !== execution.quantity
      || existing.atDate !== execution.atDate
    ) {
      throw new MandateError('execution_conflict', `esecuzione ${execution.executionId} già registrata con contenuto diverso`);
    }
    return { state, applied: false };
  }

  if (state.status !== 'active') {
    throw new MandateError('not_active', `mandato ${def.id} non attivo (${state.status})`);
  }
  if (isExpired(def, execution.atDate)) {
    throw new MandateError('expired', `mandato ${def.id} scaduto alla data ${execution.atDate}`);
  }
  if (execution.atDate < def.startDate) {
    throw new MandateError('not_started', `mandato ${def.id} non ancora valido alla data ${execution.atDate}`);
  }
  if (typeof def.priceLimit !== 'undefined' && typeof execution.price !== 'undefined') {
    if (parseInteger(execution.price, 'price') > parseInteger(def.priceLimit, 'priceLimit')) {
      throw new MandateError('price_exceeded', `prezzo ${execution.price} supera il limite ${def.priceLimit} del mandato ${def.id}`);
    }
  }

  const spent = parseInteger(state.spent, 'spent');
  const amount = parseInteger(execution.amount, 'amount');
  if (spent + amount > parseInteger(def.ceiling, 'ceiling')) {
    throw new MandateError(
      'ceiling_exceeded',
      `mandato ${def.id}: spesa ${execution.amount} supera il plafond residuo ${remainingPlafond(def, state)} (tetto ${def.ceiling}, già speso ${state.spent})`,
    );
  }

  return {
    state: {
      ...state,
      spent: intToString(spent + amount),
      executions: [...state.executions, execution],
    },
    applied: true,
  };
}

/** Annulla un mandato: nessuna nuova esecuzione, le già applicate restano. */
export function cancelMandate(state: MandateState): MandateState {
  if (state.status === 'cancelled') throw new MandateError('already_cancelled', `mandato ${state.id} già annullato`);
  return { ...state, status: 'cancelled' };
}
