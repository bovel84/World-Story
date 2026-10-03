/**
 * WS-GOV-SITUATIONS — Il formato dei numeri del Governo (solo presentazione)
 * ========================================================================
 * Il motore produce i valori PIENI («0.06575272084693667», «14.137593») e quelli
 * restano la sorgente di verità: nessuna funzione qui arrotonda il dato canonico,
 * e nessuna riscrive lo stato della partita. Queste funzioni servono **solo**
 * alla prosa del Governo — `need`, `because`, `opening` — e alle cifre mostrate
 * al giocatore, dove un numero con sedici decimali non è informazione: è rumore.
 *
 * Regola unica e riusabile:
 *  - `money`   → al più 2 decimali, zeri finali rimossi (`7,61`; `7,6`; `0`);
 *  - `percent` → al più 1 decimale (`110,1`; `35`);
 *  - `ratio`   → 0–100, al più 1 decimale (`41,2`; `35`);
 *  - `integer` → nessun decimale (`1201`), e gli interi grandi restano **esatti**
 *    anche oltre il limite dei `number` (stringhe e `bigint` non si toccano).
 *
 * Due rese dello stesso numero:
 *  - `formatGovernmentNumber` → prosa italiana, virgola decimale (`7,61`);
 *  - `governmentFigureValue`  → valore per DTO/cifre, punto decimale (`7.61`),
 *    perché il client riapplica la propria formattazione locale.
 *
 * L'arrotondamento è half-up sul decimale inteso, non sul float: `1.005` è
 * `1,01`, non `1,00`. Il segno di un valore negativo che arrotonda a zero resta
 * visibile (`-0`), perché «−0,001 mld» non è «0 mld».
 */

export type GovernmentNumberKind = 'money' | 'percent' | 'ratio' | 'integer';

const DECIMALS: Record<GovernmentNumberKind, number> = { money: 2, percent: 1, ratio: 1, integer: 0 };

/** Un intero esatto: `bigint` o stringa di sole cifre. Non si converte in float. */
function exactInteger(value: unknown): string | null {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return value.trim();
  return null;
}

/** Arrotonda half-up al decimale inteso, correggendo la rappresentazione float. */
function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const nudged = scaled + Number.EPSILON * Math.abs(scaled);
  return Math.round(nudged) / factor;
}

interface RoundedNumber {
  readonly negative: boolean;
  readonly digits: string;
}

/** Il numero arrotondato e reso come cifre, con il segno separato. */
function roundedNumber(value: number | string | bigint, kind: GovernmentNumberKind): RoundedNumber | null {
  if (kind === 'integer') {
    const exact = exactInteger(value);
    if (exact !== null) return { negative: exact.startsWith('-'), digits: exact.replace(/^[+-]/, '') };
  }
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const decimals = DECIMALS[kind];
  const negative = parsed < 0;
  let digits = roundHalfUp(Math.abs(parsed), decimals).toFixed(decimals);
  if (decimals > 0) digits = digits.replace(/0+$/, '').replace(/\.$/, '');
  if (digits === '') digits = '0';
  return { negative, digits };
}

/** Prosa italiana: virgola decimale, zeri finali rimossi, segno conservato. */
export function formatGovernmentNumber(value: number | string | bigint, kind: GovernmentNumberKind): string {
  const rounded = roundedNumber(value, kind);
  if (!rounded) return String(value);
  return `${rounded.negative ? '-' : ''}${rounded.digits.replace('.', ',')}`;
}

/** Valore per DTO/cifre: punto decimale, zeri finali rimossi, segno conservato. */
export function governmentFigureValue(value: number | string | bigint, kind: GovernmentNumberKind): string {
  const rounded = roundedNumber(value, kind);
  if (!rounded) return String(value);
  return `${rounded.negative ? '-' : ''}${rounded.digits}`;
}
