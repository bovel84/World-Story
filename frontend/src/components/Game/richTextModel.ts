/**
 * World Story — resa leggibile del testo del Consulente
 * =====================================================
 * Il prompt del Consulente chiede al modello di scrivere «con titoli, grassetto,
 * elenchi» (`prompts/advisor.ts`). Il componente però stampava il testo **grezzo**
 * in un `<div>` con `white-space: pre-wrap`: il giocatore vedeva gli asterischi
 * del grassetto, i cancelletto dei titoli e i trattini degli elenchi. Il difetto
 * era tutto qui — una richiesta di formattazione senza chi la rendesse.
 *
 * Questo modulo rende quel sottoinsieme di markdown in **elementi React**. Non usa
 * `dangerouslySetInnerHTML`: il testo arriva da un modello linguistico, e inserirlo
 * come HTML sarebbe una superficie di iniezione. Qui ogni carattere resta testo,
 * interpretato solo per struttura — grassetto, corsivo, codice, titoli, elenchi,
 * citazioni, righe divisorie.
 *
 * È deliberatamente un sottoinsieme: niente link (il consulente non ne produce e
 * un link generato è un rischio), niente tabelle, niente HTML. Ciò che non è
 * riconosciuto resta testo, com'è giusto.
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string };

export type BlockNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; inlines: InlineNode[] }
  | { kind: 'paragraph'; inlines: InlineNode[] }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'quote'; inlines: InlineNode[] }
  | { kind: 'rule' }
  /**
   * C01 — il Consulente chiede una figura. Il blocco porta **solo il tipo**: le
   * cifre le mette il frontend dai dati del motore (`advisorCharts.ts`). Un
   * grafico disegnato su numeri del modello sarebbe verosimile e falso.
   */
  | { kind: 'chart'; chartKind: string };

/**
 * Interpreta il testo in linea: `**grassetto**`, `*corsivo*` / `_corsivo_`,
 * `` `codice` ``. Il grassetto viene prima del corsivo, così `**x**` non diventa
 * due corsivi annidati. Ciò che non è riconosciuto resta testo.
 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // Ordine deliberato: ** prima di *, ` prima di *.
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) {
      nodes.push({ kind: 'text', text: source.slice(last, match.index) });
    }
    if (match[1] !== undefined || match[2] !== undefined) {
      nodes.push({ kind: 'strong', text: match[1] ?? match[2] });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push({ kind: 'em', text: match[3] ?? match[4] });
    } else if (match[5] !== undefined) {
      nodes.push({ kind: 'code', text: match[5] });
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) nodes.push({ kind: 'text', text: source.slice(last) });
  // Un testo senza marcatori resta un solo nodo di testo: nessun nodo vuoto.
  return nodes.filter(node => node.kind !== 'text' || node.text.length > 0);
}

/** Vero per una riga che apre un blocco (titolo, elenco, citazione, divisore). */
const startsBlock = (line: string): boolean =>
  /^\s*(#{1,4}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|(-{3,}|\*{3,}|_{3,})\s*$)/.test(line);

/** Interpreta il testo in blocchi: titoli, paragrafi, elenchi, citazioni, divisori. */
export function parseBlocks(source: string): BlockNode[] {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', inlines: parseInline(text) });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    }
    list = null;
  };
  const flushQuote = () => {
    const text = quote.join(' ').trim();
    if (text) blocks.push({ kind: 'quote', inlines: parseInline(text) });
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') { flushAll(); continue; }

    // Divisore orizzontale: una riga di soli trattini/asterischi.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushAll(); blocks.push({ kind: 'rule' }); continue; }

    // C01 — il Consulente chiede una figura. Sintassi: una riga sola,
    // `[[chart: tipo]]`. Il tipo è validato qui; le cifre le mette il frontend.
    const chart = /^\[\[\s*chart\s*:\s*([a-zA-Z_]+)\s*\]\]$/.exec(trimmed);
    if (chart) {
      flushAll();
      blocks.push({ kind: 'chart', chartKind: chart[1].toLowerCase() });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push({
        kind: 'heading',
        level: Math.min((heading[1] || '').length, 4) as 1 | 2 | 3 | 4,
        inlines: parseInline(heading[2].trim()),
      });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph(); flushQuote();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet?.[1] ?? numbered?.[1] ?? '').trim());
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(trimmed);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1].trim()); continue; }

    // Riga normale: chiude elenco e citazione, alimenta il paragrafo.
    flushList(); flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return blocks;
}

/** Il testo contiene marcatori che vale la pena rendere? Guardia anti-falso-verde. */
export function hasRichText(source: string): boolean {
  return /(\*\*|__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|^\s*#{1,4}\s|^\s*[-*+]\s|\d+[.)]\s)/m.test(String(source ?? ''));
}
