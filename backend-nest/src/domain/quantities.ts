/**
 * World Story — M02 µ1: codec quantità, valuta e ratei (maestro §4.1).
 * ==================================================================
 * Convenzioni numeriche §4.1:
 *  - grandezze additive del ledger: interi a precisione arbitraria nel
 *    dominio (bigint), stringhe decimali canoniche in JSON e storage
 *    SQLite TEXT. MAI Number per confronti/somme;
 *  - denaro in unità monetarie minime del catalogo valuta (cent/kopeck);
 *    materiali in unità base del catalogo risorsa; nessun importo IEEE-754;
 *  - ratei come razionali interi numerator/denominator con denominatore
 *    > 0: il resto della divisione è ESPlicito e persiste (carry §4.1.3);
 *  - niente conversioni implicite fra unità o valute: l'addizione di
 *    importi eterogenei è rifiutata, non arrotondata (§6.1);
 *  - limite di lunghezza sull'input del client contro abuso (MAT03).
 *
 * Il codec è l'unico punto di conversione stringa↔bigint: i repository lo
 * usano comune e non applicano SUM() SQL ai valori testuali.
 */

/** Stringa decimale canonica: /^-?(0|[1-9][0-9]*)$/, no -0, no zero pilota. */
export type IntString = string;

export type QuantityErrorCode =
  | 'not_int'
  | 'too_long'
  | 'bad_id'
  | 'cross_unit'
  | 'bad_denominator';

export class QuantityCodecError extends Error {
  readonly code: QuantityErrorCode;
  constructor(code: QuantityErrorCode, message: string) {
    super(message);
    this.name = 'QuantityCodecError';
    this.code = code;
  }
}

export const INT_STRING_RE = /^-?(0|[1-9][0-9]*)$/;

/** Limite anti-abuso sull'input: 24 cifre coprono ~10^24 unità. */
export const MAX_QUANTITY_DIGITS = 24;

function describe(value: unknown): string {
  if (typeof value === 'string') return `stringa "${value.slice(0, 32)}"`;
  if (typeof value === 'number') return Number.isFinite(value) ? `number ${value}` : `number non finito (${String(value)})`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `tipo ${typeof value}`;
}

/** Codec canonico: stringa decimale intera, no -0, no zero pilota, entro il limite. */
export function isIntString(value: unknown): value is IntString {
  if (typeof value !== 'string' || !INT_STRING_RE.test(value) || value === '-0') return false;
  // il limite è sulle CIFRE (segno escluso) — MAT03 anti-abuso
  const digits = value.startsWith('-') ? value.length - 1 : value.length;
  return digits <= MAX_QUANTITY_DIGITS;
}

/** Converte in bigint o rifiuta con motivo preciso (mai parseFloat/Number). */
export function parseInteger(value: unknown, label = 'quantità'): bigint {
  if (!isIntString(value)) {
    if (typeof value === 'string' && (value.startsWith('-') ? value.length - 1 : value.length) > MAX_QUANTITY_DIGITS) {
      throw new QuantityCodecError('too_long', `${label}: oltre ${MAX_QUANTITY_DIGITS} cifre (limite anti-abuso)`);
    }
    throw new QuantityCodecError('not_int', `${label}: attesa stringa decimale canonica, ricevuto ${describe(value)}`);
  }
  return BigInt(value as IntString);
}

/** BigInt → stringa canonica ((-0n).toString() === '0'). */
export function intToString(value: bigint): IntString {
  return value.toString();
}

export function compareInteger(a: IntString, b: IntString): -1 | 0 | 1 {
  const left = parseInteger(a);
  const right = parseInteger(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addInteger(a: IntString, b: IntString): IntString {
  return intToString(parseInteger(a) + parseInteger(b));
}

export function subtractInteger(a: IntString, b: IntString): IntString {
  return intToString(parseInteger(a) - parseInteger(b));
}

// ─── ID canonici (valuta/risorsa) ───────────────────────────────────────────

const ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function isIdString(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function assertId(value: unknown, label: string): string {
  if (!isIdString(value)) throw new QuantityCodecError('bad_id', `${label}: atteso id minuscolo [a-z0-9_], ricevuto ${describe(value)}`);
  return value;
}

// ─── Amount: denaro in unità monetarie minime ──────────────────────────────

export interface Amount {
  readonly currencyId: string;
  readonly minorUnits: IntString;
}

export function amount(currencyId: string, minorUnits: IntString | bigint): Amount {
  assertId(currencyId, 'currencyId');
  const units = typeof minorUnits === 'bigint' ? intToString(minorUnits) : minorUnits;
  parseInteger(units, 'minorUnits'); // canonicalità
  return { currencyId, minorUnits: units };
}

export function amountValue(a: Amount): bigint {
  return parseInteger(a.minorUnits, 'minorUnits');
}

/** Somma bilanciata: MAI fra valute diverse (§6.1, nessuna somma eterogenea). */
export function addAmounts(a: Amount, b: Amount): Amount {
  if (a.currencyId !== b.currencyId) {
    throw new QuantityCodecError('cross_unit', `valute diverse: ${a.currencyId} ≠ ${b.currencyId} (nessuna somma di importi eterogenei)`);
  }
  return amount(a.currencyId, amountValue(a) + amountValue(b));
}

export function subtractAmounts(a: Amount, b: Amount): Amount {
  if (a.currencyId !== b.currencyId) {
    throw new QuantityCodecError('cross_unit', `valute diverse: ${a.currencyId} ≠ ${b.currencyId} (nessuna somma di importi eterogenei)`);
  }
  return amount(a.currencyId, amountValue(a) - amountValue(b));
}

// ─── Quantity: materiale in unità base del catalogo ────────────────────────

export interface Quantity {
  readonly resourceId: string;
  readonly baseUnits: IntString;
}

export function quantity(resourceId: string, baseUnits: IntString | bigint): Quantity {
  assertId(resourceId, 'resourceId');
  const units = typeof baseUnits === 'bigint' ? intToString(baseUnits) : baseUnits;
  parseInteger(units, 'baseUnits');
  return { resourceId, baseUnits: units };
}

export function quantityValue(q: Quantity): bigint {
  return parseInteger(q.baseUnits, 'baseUnits');
}

export function addQuantities(a: Quantity, b: Quantity): Quantity {
  if (a.resourceId !== b.resourceId) {
    throw new QuantityCodecError('cross_unit', `risorse diverse: ${a.resourceId} ≠ ${b.resourceId} (capacità e quantità non si sommano, §4.1.7)`);
  }
  return quantity(a.resourceId, quantityValue(a) + quantityValue(b));
}

export function subtractQuantities(a: Quantity, b: Quantity): Quantity {
  if (a.resourceId !== b.resourceId) {
    throw new QuantityCodecError('cross_unit', `risorse diverse: ${a.resourceId} ≠ ${b.resourceId} (capacità e quantità non si sommano, §4.1.7)`);
  }
  return quantity(a.resourceId, quantityValue(a) - quantityValue(b));
}

// ─── Razionali interi per ratei (§4.1.3) ───────────────────────────────────

export interface Rational {
  readonly numerator: IntString;
  readonly denominator: IntString;
}

/** Costruttore: denominatore intero STRETTAMENTE positivo. */
export function rational(numerator: IntString | bigint, denominator: IntString | bigint): Rational {
  const n = typeof numerator === 'bigint' ? intToString(numerator) : numerator;
  const d = typeof denominator === 'bigint' ? intToString(denominator) : denominator;
  const den = parseInteger(d, 'denominator');
  if (den <= 0n) throw new QuantityCodecError('bad_denominator', `denominatore deve essere > 0, ricevuto ${describe(d)}`);
  parseInteger(n, 'numerator');
  return { numerator: n, denominator: d };
}

/**
 * Divisione intera ESATTA con resto: il quoziente è troncato verso lo zero
 * (convenzione dichiarata) e il resto è esplicito per il carry persistito
 * (§4.1.3: frammentare un salto non crea né perde quantità per arrotondamento).
 */
export function integerDivide(numerator: bigint, denominator: bigint): { quotient: bigint; remainder: bigint } {
  if (denominator === 0n) throw new QuantityCodecError('bad_denominator', 'divisione per zero');
  const quotient = numerator / denominator; // troncamento verso lo zero
  return { quotient, remainder: numerator - quotient * denominator };
}