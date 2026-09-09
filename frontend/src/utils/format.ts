/**
 * World Story — Formattazione condivisa del Dossier Nazione (U03 µ1)
 * ===============================================================
 * Denaro, unità e periodi formattati in modo coerente e leggibile in
 * italiano. Funzioni pure, testate. Nessuna logica di gioco: solo
 * presentazione.
 *
 * Regole:
 *  - valori null/undefined/non-finiti → «—» (mai "NaN" o "undefined");
 *  - raggruppamento delle migliaia DETERMINISTICO (`.`), decimale `,`:
 *    non dipende dai dati ICU del runtime (che in Node non raggruppano
 *    i numeri a 4 cifre);
 *  - denaro con segno esplicito opzionale;
 *  - periodi da date ISO (YYYY-MM-DD) letti come calendario di simulazione,
 *    mai come timestamp locale (stesso pattern di ChatsPanel).
 */

/** Raggruppa la parte intera con `.` e usa `,` come decimale (it-IT).
 * Il segno è gestito dal chiamante (formatMoney/formatPercent), così il
 * corpo non contiene mai un `-` duplicato. */
function groupThousands(value: number, decimals: number): string {
  const abs = Math.abs(value);
  const fixed = abs.toFixed(decimals);
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decPart = dot === -1 ? '' : fixed.slice(dot + 1);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return grouped + (decPart ? `,${decPart}` : '');
}

/** Numero intero/unità con separatore delle migliaia it-IT. */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return groupThousands(value, 0);
}

export interface FormatMoneyOptions {
  /** Simbolo/valuta da appendere (es. 'mld', 'TEST', '$'). */
  currency?: string;
  /** Cifre decimali (default 0). */
  decimals?: number;
  /** Antepone +/− esplicito per valori positivi/negativi. */
  sign?: boolean;
}

/** Denaro formattato con separatore it-IT e segno opzionale. */
export function formatMoney(
  value: number | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const decimals = opts.decimals ?? 0;
  const sign = opts.sign ? (value > 0 ? '+' : value < 0 ? '−' : '') : '';
  const currency = opts.currency ? ` ${opts.currency}` : '';
  const body = groupThousands(value, decimals);
  return `${sign}${body}${currency}`;
}

/** Percentuale formattata (es. 42,5%). */
export function formatPercent(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${groupThousands(value, decimals)}%`;
}

/** Data ISO (YYYY-MM-DD) letta come calendario di simulazione. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** Periodo da data di inizio a data di fine (es. "1 gen 1951 — 4 gen 1951"). */
export function formatPeriod(start?: string | null, end?: string | null): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s !== '—' && e !== '—') return `${s} — ${e}`;
  return s !== '—' ? s : e;
}
