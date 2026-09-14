/**
 * World Story — Categorizzazione dei dispacci
 * ==========================================
 * La cronaca mescola scontri, diplomazia ed economia in un unico flusso.
 * Questo modulo classifica un dispaccio in base a parole chiave concrete, così
 * il lettore riconosce subito una notizia di guerra da un negoziato o da un
 * bollettino economico. È volutamente deterministico e tollerante: nel dubbio
 * restituisce la categoria generica.
 */

export type DispatchCategory = 'war' | 'diplomacy' | 'economy' | 'politics' | 'society';

export interface DispatchCategoryInfo {
  key: DispatchCategory;
  label: string;
}

const CATEGORIES: Record<DispatchCategory, DispatchCategoryInfo> = {
  war: { key: 'war', label: 'Scontri' },
  diplomacy: { key: 'diplomacy', label: 'Diplomazia' },
  economy: { key: 'economy', label: 'Economia' },
  politics: { key: 'politics', label: 'Politica' },
  society: { key: 'society', label: 'Società' },
};

const PATTERNS: Array<{ key: DispatchCategory; pattern: RegExp }> = [
  {
    key: 'war',
    pattern: /\b(guerra|battaglia|scontro|combattiment|offensiv|contrattacc|invas|occupat|assed|bombard|artiglier|fronte|truppe|unità|mobilitazion|militar|esercit|flotta|marina|aviazione|difesa|attacc|conquist|ritirat|armistizio|tregua|cessate il fuoco|prigionier|perdit|cadut|ferit|blocco navale|missil)\w*/i,
  },
  {
    key: 'diplomacy',
    pattern: /\b(diplomaz|trattat|accordo|alleanz|negoziat|vertice|summit|ambasciat|ultimatum|proposta|mediazion|mediat|consolato|intesa|patto|colloqui|incontro|cancellier|ministro degli esteri)\w*/i,
  },
  {
    key: 'economy',
    pattern: /\b(economic|economia|mercato|commercio|export|import|inflazion|bilancio|debito|valuta|industri|fabbric|acciaio|petrolio|energia|riforma agraria|raccolto|carestia|prezzi|produzione|PIL)\w*/i,
  },
  {
    key: 'society',
    pattern: /\b(riforma|scuola|universit|sanit|popolazion|cittadin|diritti|protest|scioper|manifestazion|religio|chiesa|epidemi|migrazion|profugh|rifugiat)\w*/i,
  },
  {
    key: 'politics',
    pattern: /\b(elezion|governo|parlament|regime|colpo di stato|costituzion|partito|presidente|monarchia|repubblica|dittatur|referendum|dimission|gabinetto|regicid)\w*/i,
  },
];

/** Classifica un dispaccio; testo vuoto → categoria politica generica. */
export function classifyDispatch(text: string | undefined, detail?: string): DispatchCategoryInfo {
  const haystack = `${text || ''} ${detail || ''}`.trim();
  if (!haystack) return CATEGORIES.politics;
  for (const { key, pattern } of PATTERNS) {
    if (pattern.test(haystack)) return CATEGORIES[key];
  }
  return CATEGORIES.politics;
}

export function dispatchCategoryLabel(key: DispatchCategory): string {
  return CATEGORIES[key].label;
}
