/**
 * M02 µ1 — codec quantità/valuta/ratei (maestro §4.1, test MAT03).
 * ================================================================
 * Aritmetica ESATTA o rifiuto: niente arrotondamento nascosto, niente
 * float IEEE-754, niente somme di importi eterogenei. Input del client
 * falsato (NaN/Infinity, stringhe non canoniche, stringhe enormi) è
 * rifiutato con motivo preciso e limite anti-abuso.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_QUANTITY_DIGITS,
  QuantityCodecError,
  addAmounts,
  addInteger,
  addQuantities,
  amount,
  amountValue,
  assertId,
  compareInteger,
  integerDivide,
  intToString,
  isIntString,
  parseInteger,
  quantity,
  quantityValue,
  rational,
  subtractAmounts,
  subtractQuantities,
  subtractInteger,
} from '../src/domain/quantities';

describe('M02 µ1 — IntString canonico (§4.1.1)', () => {
  it('accetta solo stringhe decimali canoniche', () => {
    for (const ok of ['0', '123', '-42', '1' + '0'.repeat(23)]) expect(isIntString(ok)).toBe(true);
    for (const bad of ['-0', '01', '1.5', '1e5', '0x10', ' 1', '1 ', '+1', '1_000', '', '١٢٣', '1,5']) {
      expect(isIntString(bad)).toBe(false);
    }
    // niente numeri IEEE-754: anche un number "pulito" è rifiutato
    for (const bad of [12, 0, -3, NaN, Infinity, -Infinity, null, undefined, {}, ['12']]) {
      expect(isIntString(bad)).toBe(false);
    }
  });

  it('parseInteger rifiuta input client falsato con motivo', () => {
    expect(() => parseInteger(12)).toThrow(QuantityCodecError);
    expect(() => parseInteger(12).valueOf()).toBeDefined(); // mai raggiunto
    expect(() => parseInteger(NaN)).toThrow(/non finito/);
    expect(() => parseInteger(Infinity)).toThrow(QuantityCodecError);
    expect(() => parseInteger('1.5')).toThrow(/canonica/);
    expect(() => parseInteger('12x', 'minorUnits')).toThrow(/minorUnits/);
  });

  it('limite anti-abuso sulla lunghezza (MAT03)', () => {
    const ok = '9'.repeat(MAX_QUANTITY_DIGITS);
    const tooLong = '9'.repeat(MAX_QUANTITY_DIGITS + 1);
    expect(isIntString(ok)).toBe(true);
    expect(isIntString('-' + ok)).toBe(true);
    expect(isIntString(tooLong)).toBe(false);
    expect(() => parseInteger(tooLong)).toThrow(QuantityCodecError);
    expect(() => parseInteger(tooLong)).toThrow(/limite anti-abuso/);
  });

  it('intToString è canonico e parseInteger è la sua inversa', () => {
    expect(intToString(0n)).toBe('0');
    expect(intToString(-0n)).toBe('0'); // no -0
    expect(intToString(-42n)).toBe('-42');
    expect(intToString(10n ** 24n - 1n)).toBe('9'.repeat(24));
    expect(parseInteger(intToString(10n ** 23n))).toBe(10n ** 23n);
  });

  it('somma e confronto esatti su valori oltre la precisione float', () => {
    const big = '123456789012345678901234'; // 24 cifre
    expect(addInteger(big, '1')).toBe('123456789012345678901235');
    expect(subtractInteger(big, '1')).toBe('123456789012345678901233');
    expect(compareInteger(big, big)).toBe(0);
    expect(compareInteger(big, '123456789012345678901235')).toBe(-1);
    // 2^53+1 NON è rappresentabile in Number: il codec non perde nulla
    expect(addInteger('9007199254740993', '0')).toBe('9007199254740993');
  });
});

describe('M02 µ1 — Amount: denaro in unità monetarie minime', () => {
  it('centesimi esatti e importi negativi (debito) ammessi', () => {
    const cent = amount('usd', '1');
    const dollar = amount('usd', '100');
    expect(amountValue(addAmounts(cent, dollar))).toBe(101n);
    const debit = subtractAmounts(amount('usd', '50'), amount('usd', '80'));
    expect(debit.minorUnits).toBe('-30'); // il segno è politica del chiamante
  });

  it('somme di valute diverse sono RIFIUTATE (§6.1, MAT03)', () => {
    expect(() => addAmounts(amount('usd', '100'), amount('sur', '100'))).toThrow(QuantityCodecError);
    expect(() => subtractAmounts(amount('usd', '100'), amount('eur', '1'))).toThrow(/eterogenei/);
  });

  it('id valuta canonico; input non canonico rifiutato', () => {
    expect(() => amount('USD', '1')).toThrow(/currencyId/);
    expect(() => amount('__proto__', '1')).toThrow(QuantityCodecError);
    expect(() => amount('usd', '12.5')).toThrow(QuantityCodecError);
    expect(() => assertId('us-d', 'currencyId')).toThrow(QuantityCodecError);
  });
});

describe('M02 µ1 — Quantity: materiali in unità base', () => {
  it('aritmetica esatta sulla stessa risorsa', () => {
    const steel = quantity('steel', '500');
    expect(quantityValue(addQuantities(steel, quantity('steel', '250'))).valueOf()).toBe(750n);
    expect(subtractQuantities(steel, quantity('steel', '600')).baseUnits).toBe('-100');
  });

  it('materiali diversi NON si sommano (§4.1.7)', () => {
    expect(() => addQuantities(quantity('steel', '1'), quantity('coal', '1'))).toThrow(QuantityCodecError);
    expect(() => addQuantities(quantity('steel', '1'), quantity('coal', '1'))).toThrow(/non si sommano/);
    expect(() => subtractQuantities(quantity('steel', '1'), quantity('coal', '1'))).toThrow(QuantityCodecError);
  });

  it('bigint accettato come costruttore (dominio interno), stringa per storage', () => {
    expect(quantity('coal', 120n).baseUnits).toBe('120');
    expect(amount('usd', 500n).minorUnits).toBe('500');
  });
});

describe('M02 µ1 — razionali e carry (§4.1.3)', () => {
  it('denominatore deve essere strettamente positivo', () => {
    expect(() => rational('1', '0')).toThrow(/denominatore/);
    expect(() => rational('1', '-2')).toThrow(QuantityCodecError);
    expect(() => rational(1n, 0n)).toThrow(QuantityCodecError);
    expect(rational('10', '3')).toEqual({ numerator: '10', denominator: '3' });
  });

  it('divisione esatta con resto esplicito (carry persistito)', () => {
    // il caso del piano: 3.938.854 GWh/anno → capacità giornaliera
    const { quotient, remainder } = integerDivide(3938854n, 365n);
    expect(quotient).toBe(10791n);
    expect(remainder).toBe(139n); // 10791*365 = 3938715, resto 139
    expect(quotient * 365n + remainder).toBe(3938854n); // identità SEMPRE
  });

  it('resto esatto anche su valori oltre la precisione float e con segno', () => {
    const huge = 10n ** 22n + 7n;
    const { quotient, remainder } = integerDivide(huge, 365n);
    expect(quotient * 365n + remainder).toBe(huge);
    expect(remainder >= 0n && remainder < 365n).toBe(true);
    // troncamento verso lo zero: convenzione dichiarata
    expect(integerDivide(-10n, 3n)).toEqual({ quotient: -3n, remainder: -1n });
    expect(integerDivide(-10n, 3n).quotient * 3n + integerDivide(-10n, 3n).remainder).toBe(-10n);
  });

  it('divisione per zero rifiutata', () => {
    expect(() => integerDivide(1n, 0n)).toThrow(/zero/);
  });
});