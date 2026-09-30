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

/* ===========================================================================
 * WS-GOVOFFICE-05B — Il formato delle cifre del ministro (unico punto di verità)
 * ===========================================================================
 * Il motore produce i valori PIENI («0.06575272084693667»): sono la sorgente di
 * verità e **non si toccano** (decisione A dell'autore). Qui si formattano solo
 * alla resa, con una regola sola e riusabile:
 *
 *  - valori assoluti → 2 decimali, virgola it-IT, punto per le migliaia;
 *  - percentuali (unità che contiene «%») → 1 decimale;
 *  - una cifra non numerica/ignota NON diventa 0: torna com'era, e il chiamante
 *    la rende «—» se la provenienza è `unknown`.
 *
 * Nessun `toFixed` sparso: `groupThousands` resta l'unica implementazione del
 * raggruppamento, così l'arrotondamento non diverge fra i punti dell'app.
 */

/** Cifre decimali per unità: 1 per le percentuali, 2 per tutto il resto. */
export function decimalsForUnit(unit: string): number {
  return unit.includes('%') ? 1 : 2;
}

/** Numero con decimali fissi, virgola it-IT, punto per le migliaia, segno conservato. */
export function formatDecimal(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}${groupThousands(value, decimals)}`;
}

/**
 * Il valore di una cifra del motore, leggibile: 2 decimali (1 se percentuale),
 * con l'unità accanto come oggi (`0,06 mld`, `29,4 %`).
 *
 * `value` è la stringa piena del motore; se non è numerica torna com'era (non si
 * inventa uno zero). Una cifra con provenienza `unknown` non arriva qui: il
 * chiamante la rende «—» prima (vedi `isUnknown`).
 */
export function formatFigureValue(value: string | number, unit: string): string {
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  const n = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return `${raw} ${unit}`.trim();
  return `${formatDecimal(n, decimalsForUnit(unit))} ${unit}`.trim();
}

/**
 * Le cifre DENTRO il testo del motore (il «perché», l'apertura, i bisogni).
 *
 * Il motore scrive i valori pieni anche nella prosa («Il saldo è 0.06575272084693667
 * mld (0.2% del PIL)»). Qui si formattano **solo i decimali** — 2 cifre, 1 se
 * seguiti da «%». Gli interi NON si toccano: «Ho 1 cosa» resta «Ho 1 cosa», un
 * anno non diventa «2.000», e un numero già raggruppato («61.000.000») non si
 * spezza.
 */
export function formatNarratedDecimals(text: string): string {
  if (!text) return text;
  return text.replace(
    /(-?\d+\.\d+)(\s*%?)/g,
    (match: string, raw: string, suffix: string, offset: number, whole: string) => {
      // Non toccare un numero incastrato in un altro:
      // - preceduto da cifra o punto (parte di «61.000.000»);
      // - seguito da «.cifra» (ancora una parte di «61.000.000»);
      // il punto di fine frase NON blocca invece la formattazione.
      const before = whole[offset - 1];
      const after = whole.slice(offset + match.length);
      if (before && /[\d.]/.test(before)) return match;
      if (after.startsWith('.') && /\d/.test(after[1] ?? '')) return match;
      const n = Number(raw);
      if (!Number.isFinite(n)) return match;
      return `${formatDecimal(n, suffix.includes('%') ? 1 : 2)}${suffix}`;
    },
  );
}

/** Data ISO (YYYY-MM-DD) letta come calendario di simulazione. */
export function formatDate(iso?: string | null): string {
  return formatDateOr(iso, '—');
}

/**
 * N08 — unica implementazione della data breve del dossier.
 *
 * Il Dossier (`NationDock/format.ts`) aveva una **seconda** copia di questa
 * funzione, identica nella regola e diversa solo nel fallback («Data non
 * pubblicata» invece di «—»). Due copie della stessa regola divergono: qui la
 * regola è una sola e il fallback è un **parametro**, così ogni chiamante
 * dichiara il proprio senza riscriverla.
 *
 * La lettura è sempre a calendario: la data ISO si interpreta come giorno di
 * simulazione, mai come timestamp locale (`new Date('1951-01-01')` darebbe UTC e
 * in un fuso a ovest slitterebbe di un giorno — difetto documentato in HudBar).
 */
export function formatDateOr(iso: string | null | undefined, fallback: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso ? String(iso) : fallback;
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
