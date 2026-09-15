/**
 * World Story — Categorie dei progetti nazionali
 * ==============================================
 * Il Dossier elenca i progetti in corso in un unico flusso. Questo modulo
 * classifica ogni progetto in base a parole chiave concrete, così il lettore
 * distingue a colpo d'occhio un'opera pubblica da un riarmo, una ricerca o un
 * negoziato. È deterministico e tollerante: nel dubbio restituisce «Altro».
 */

export type ProjectCategoryKey =
  | 'military'
  | 'infrastructure'
  | 'economy'
  | 'research'
  | 'society'
  | 'diplomacy'
  | 'other';

export interface ProjectCategoryInfo {
  key: ProjectCategoryKey;
  label: string;
  /** Ordine di presentazione: prima le categorie più «materiali». */
  order: number;
}

const CATEGORIES: Record<ProjectCategoryKey, ProjectCategoryInfo> = {
  military: { key: 'military', label: 'Difesa', order: 0 },
  infrastructure: { key: 'infrastructure', label: 'Infrastrutture', order: 1 },
  economy: { key: 'economy', label: 'Economia e industria', order: 2 },
  research: { key: 'research', label: 'Ricerca e tecnologia', order: 3 },
  society: { key: 'society', label: 'Società', order: 4 },
  diplomacy: { key: 'diplomacy', label: 'Diplomazia', order: 5 },
  other: { key: 'other', label: 'Altro', order: 6 },
};

const PATTERNS: Array<{ key: ProjectCategoryKey; pattern: RegExp }> = [
  {
    key: 'military',
    // NB: niente «riserva/riserve» (scorte civili) né «forte» (aggettivo) né il
    // generico «esercit»: classificavano come Difesa progetti petroliferi, di
    // ricerca o civili. Restano solo termini non ambigui.
    pattern: /\b(riarm|armament|mobilitazion|reclutament|coscrizion|esercitazion|esercito|battaglion|division|brigat|reggiment|flotta|marina|naval|aviazione|aereo|caccia|bombardier|missil|artiglier|carro armato|fortificaz|base militar|base aerea|radar|caserma|difesa|militar|guarnigion|riservist|richiamo alle armi)\w*/i,
  },
  {
    key: 'infrastructure',
    pattern: /\b(ferrovia|strada|autostrada|ponte|tunnel|porto|canale|diga|acquedotto|rete idrica|rete elettrica|elettrodotto|infrastruttur|linea ferroviaria|stazione|aeroporto|metropolitana|pipeline|oleodotto|gasdotto)\w*/i,
  },
  {
    key: 'economy',
    pattern: /\b(fabbric|industri|acciaieria|miniera|estrazione|raffineria|impianto|produzion|mercato|commercio|export|import|banca|credito|moneta|valuta|agricoltur|raccolto|allevament|pesca|turismo|energia|centrale|petrolio|gas natural)\w*/i,
  },
  {
    key: 'research',
    pattern: /\b(ricerc|scientific|laboratori|universit|tecnolog|innovazion|sviluppo tecnico|programma spazial|satellit|informatic|calcolator|reattor|nuclear|medicina avanzat|vaccin|prototip)\w*/i,
  },
  {
    key: 'society',
    pattern: /\b(ospedal|sanit|scuola|istruzion|educazion|pension|welfare|assistenz|alloggi|quartier|casa popolar|acqua potabile|igiene|epidemi|vaccinazion|diritti|cultura|museo|teatro|sport|giovani|famiglia)\w*/i,
  },
  {
    key: 'diplomacy',
    pattern: /\b(trattat|alleanz|negoziat|vertice|summit|ambasciat|consolato|missione diplomatic|accordo|patto|intesa|cooperazion internazional|organizzazion internazional|candidatura|adesion)\w*/i,
  },
];

/** Classifica un progetto dal titolo e dal riassunto. Testo vuoto → «Altro». */
export function classifyProject(title: string | undefined, summary?: string): ProjectCategoryInfo {
  const haystack = `${title || ''} ${summary || ''}`.trim();
  if (!haystack) return CATEGORIES.other;
  for (const { key, pattern } of PATTERNS) {
    if (pattern.test(haystack)) return CATEGORIES[key];
  }
  return CATEGORIES.other;
}

export function projectCategoryLabel(key: ProjectCategoryKey): string {
  return CATEGORIES[key].label;
}

/**
 * Raggruppa i progetti per categoria, nell'ordine di presentazione, saltando le
 * categorie vuote. Non muta l'input.
 */
export function groupProjectsByCategory<
  T extends { title?: string; summary?: string },
>(projects: T[]): Array<{ category: ProjectCategoryInfo; projects: T[] }> {
  const buckets = new Map<ProjectCategoryKey, T[]>();
  for (const project of projects) {
    const { key } = classifyProject(project.title, project.summary);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(project);
    else buckets.set(key, [project]);
  }
  return [...buckets.entries()]
    .map(([key, items]) => ({ category: CATEGORIES[key], projects: items }))
    .sort((a, b) => a.category.order - b.category.order);
}
