/**
 * World Story — Filoni del preset: lo standard (`storylines.json`).
 * ================================================================
 * Un preset può dichiarare i **filoni storici** del mondo in un file opzionale
 * `data/presets/<id>/storylines.json`. Un filone è un nodo della storia che il
 * preset sceglie di fissare (il disarmo di Hamas, la questione di Gerusalemme):
 * dà **significato e trigger**, mai numeri, e vive **per partita**.
 *
 * Standard additivo: un preset **senza** il file resta valido e si comporta come
 * prima (H-I7).
 *
 * Regole dello standard (vedi docs/STANDARD_FILONI_PRESET.md):
 *  - `id`   stabile, kebab-case — chiave dell'obiettivo NPC e della cronaca;
 *  - `parties` sono **id di mappa**, non `country_codes` (una política senza
 *    geometria o fuori dal preset può comunque essere nominata);
 *  - `domain` mappa la **sedia del gabinetto** (`CABINET_SEATS`);
 *  - `trajectory` è una **tendenza** (dove il nodo andava se nessuno lo deviava),
 *    mai una profezia — invariante H-I12;
 *  - **zero filoni è valido**, e nessun numero entra nel file (H-I1).
 *
 * Il modulo è **puro**: nessun IO, nessuna dipendenza dal motore. La lettura
 * (disco) e la persistenza vivono altrove. Così validazione, schema ed
 * enumerazione dei campi si provano senza provider né database.
 */
import { CABINET_SEATS, type CabinetSeat } from '../core/government/Cabinet';

/** La versione dello standard che questo codice sa leggere. */
export const STORYLINE_STANDARD_VERSION = 1;

/** Gli stati possibili di un filone. */
export const STORYLINE_STATES = ['aperto', 'congelato', 'risolto', 'divergente'] as const;
export type StorylineState = typeof STORYLINE_STATES[number];

/** Il file, così come sta su disco. */
export interface StorylinesFile {
  version: number;
  /** La data-àncora del file (di norma lo `start_date` del preset). */
  as_of?: string;
  storylines: Storyline[];
}

export interface Storyline {
  /** Stabile, kebab-case, unico nel preset. */
  id: string;
  title: string;
  /** La sedia del gabinetto competente sul filone. */
  domain: CabinetSeat;
  /** Polity coinvolte, per **id di mappa** (non `country_codes`). */
  parties: string[];
  /** Area leggibile (es. «Levante»); non un id tecnico. */
  region?: string;
  state: StorylineState;
  /** 1 marginale, 2 rilevante, 3 critico. */
  pressure: number;
  /** Ciò che il filone significa: significato, mai numeri. */
  summary: string;
  /**
   * Dove il nodo **andava** se nessuno lo deviava. È una **tendenza**, non un
   * fatto futuro: gli NPC la seguono, il giocatore la devia (H-I12).
   */
  trajectory?: string;
  /** Ciò che tiene il filone «acceso». */
  triggers: string[];
  /** Opzionale: il filone è dormiente prima di questa data. */
  active_from?: string;
  /** Opzionale: oltre questa data il filone non si apre. */
  active_until?: string;
}

/** Un problema di conformità, con il percorso esatto nel file. */
export interface StorylineIssue {
  path: string;
  message: string;
}

export class StorylineValidationError extends Error {
  readonly issues: StorylineIssue[];
  constructor(issues: StorylineIssue[]) {
    super(`storylines.json non valido: ${issues.map(issue => `${issue.path} — ${issue.message}`).join('; ')}`);
    this.name = 'StorylineValidationError';
    this.issues = issues;
  }
}

/** Chiavi ammesse in una voce. Un campo ignoto è un refuso, non un'aggiunta. */
const STORYLINE_KEYS = new Set<keyof Storyline>([
  'id', 'title', 'domain', 'parties', 'region', 'state', 'pressure',
  'summary', 'trajectory', 'triggers', 'active_from', 'active_until',
]);

/** Chiavi ammesse nel file. */
const FILE_KEYS = new Set(['version', 'as_of', 'storylines']);

const STORYLINE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isSeat = (value: unknown): value is CabinetSeat =>
  typeof value === 'string' && (CABINET_SEATS as readonly string[]).includes(value);

const isStorylineState = (value: unknown): value is StorylineState =>
  typeof value === 'string' && (STORYLINE_STATES as readonly string[]).includes(value);

/** Una stringa non vuota, ripulita. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Valida un `storylines.json`.
 *
 * Ritorna **tutte** le violazioni, con il percorso esatto: il chiamante decide
 * se bloccante o no. Non lancia da sé — l'unico punto che lancia è
 * `parseStorylinesFile`, così i test possono guardare la lista completa.
 */
export function validateStorylinesFile(raw: unknown, context = 'storylines.json'): StorylineIssue[] {
  const issues: StorylineIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    push(context, 'non è un oggetto');
    return issues;
  }
  const file = raw as Record<string, unknown>;

  for (const key of Object.keys(file)) {
    if (!FILE_KEYS.has(key)) push(`${context}.${key}`, 'campo non riconosciuto');
  }

  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    push(`${context}.version`, 'deve essere un intero ≥ 1');
  } else if (version > STORYLINE_STANDARD_VERSION) {
    push(`${context}.version`, `versione ${version} più nuova di quella supportata (${STORYLINE_STANDARD_VERSION})`);
  }

  if (file.as_of !== undefined && !(typeof file.as_of === 'string' && ISO_DATE_RE.test(file.as_of))) {
    push(`${context}.as_of`, 'deve essere una data YYYY-MM-DD');
  }

  if (!Array.isArray(file.storylines)) {
    push(`${context}.storylines`, 'deve essere un array');
    return issues;
  }

  const seen = new Set<string>();
  file.storylines.forEach((entry, i) => {
    const path = `${context}.storylines[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      push(path, 'non è un oggetto');
      return;
    }
    const item = entry as Record<string, unknown>;

    for (const key of Object.keys(item)) {
      if (!STORYLINE_KEYS.has(key as keyof Storyline)) push(`${path}.${key}`, 'campo non riconosciuto');
    }

    const id = nonEmptyString(item.id);
    if (!id) push(`${path}.id`, 'obbligatorio');
    else if (!STORYLINE_ID_RE.test(id)) push(`${path}.id`, `non valido (serve kebab-case, es. "levante-disarmo-hamas")`);
    else if (seen.has(id)) push(`${path}.id`, `duplicato: "${id}"`);
    else seen.add(id);

    if (!nonEmptyString(item.title)) push(`${path}.title`, 'obbligatorio');

    if (!isSeat(item.domain)) {
      push(`${path}.domain`, `deve essere una sedia del gabinetto (${CABINET_SEATS.join(', ')})`);
    }

    if (!Array.isArray(item.parties) || item.parties.length === 0) {
      push(`${path}.parties`, 'deve essere un array non vuoto di id di mappa');
    } else if (item.parties.some(p => !nonEmptyString(p))) {
      push(`${path}.parties`, 'ogni voce deve essere una stringa non vuota');
    }

    if (item.region !== undefined && !nonEmptyString(item.region)) {
      push(`${path}.region`, 'se presente, deve essere una stringa non vuota');
    }

    if (!isStorylineState(item.state)) {
      push(`${path}.state`, `deve essere uno di: ${STORYLINE_STATES.join(', ')}`);
    }

    if (typeof item.pressure !== 'number' || !Number.isInteger(item.pressure) || item.pressure < 1 || item.pressure > 3) {
      push(`${path}.pressure`, 'deve essere un intero da 1 a 3');
    }

    if (!nonEmptyString(item.summary)) push(`${path}.summary`, 'obbligatorio');

    if (item.trajectory !== undefined && !nonEmptyString(item.trajectory)) {
      push(`${path}.trajectory`, 'se presente, deve essere una stringa non vuota');
    }

    if (!Array.isArray(item.triggers) || item.triggers.length === 0) {
      push(`${path}.triggers`, 'deve essere un array non vuoto');
    } else if (item.triggers.some(t => !nonEmptyString(t))) {
      push(`${path}.triggers`, 'ogni voce deve essere una stringa non vuota');
    }

    for (const key of ['active_from', 'active_until'] as const) {
      const value = item[key];
      if (value !== undefined && !(typeof value === 'string' && ISO_DATE_RE.test(value))) {
        push(`${path}.${key}`, 'se presente, deve essere una data YYYY-MM-DD');
      }
    }
    const from = item.active_from;
    const until = item.active_until;
    if (typeof from === 'string' && typeof until === 'string' && ISO_DATE_RE.test(from) && ISO_DATE_RE.test(until) && from > until) {
      push(path, '`active_from` è posteriore a `active_until`');
    }
  });

  return issues;
}

/** Valida e lancia: il punto unico in cui una non-conformità diventa un errore. */
export function parseStorylinesFile(raw: unknown, context = 'storylines.json'): StorylinesFile {
  const issues = validateStorylinesFile(raw, context);
  if (issues.length > 0) throw new StorylineValidationError(issues);
  const file = raw as Record<string, unknown>;
  return {
    version: Number(file.version),
    ...(typeof file.as_of === 'string' ? { as_of: file.as_of } : {}),
    storylines: (file.storylines as Storyline[]).map(s => ({ ...s })),
  };
}

/**
 * I filoni **attivi** a una data: nessun vincolo, oppure dentro
 * `[active_from, active_until]`. Un filone dormiente non è un filone spento:
 * serve al mondo che copre decenni (un nodo del 2003 in un preset del 2000).
 */
export function activeStorylines(file: StorylinesFile, date: string): Storyline[] {
  if (!ISO_DATE_RE.test(date)) return file.storylines;
  return file.storylines.filter(s => {
    if (s.active_from && date < s.active_from) return false;
    if (s.active_until && date > s.active_until) return false;
    return true;
  });
}

/** Serializza il file canonico (usato dalla specifica e dai test). */
export function serializeStorylinesFile(file: StorylinesFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Lo **schema** dello standard, in forma leggibile e ispezionabile: è la
 * definizione unica usata da validazione, autoring e specifica. Non è JSON
 * Schema formale, è l'elenco dei campi con obbligatorietà e vincolo — così una
 * sola fonte descrive il formato e non nascono «due verità».
 */
export interface StorylineFieldSpec {
  name: keyof Storyline | 'version' | 'as_of' | 'storylines';
  required: boolean;
  constraint: string;
}

export const STORYLINE_STANDARD_SCHEMA: {
  version: number;
  file: StorylineFieldSpec[];
  entry: StorylineFieldSpec[];
} = {
  version: STORYLINE_STANDARD_VERSION,
  file: [
    { name: 'version', required: true, constraint: `intero = ${STORYLINE_STANDARD_VERSION}` },
    { name: 'as_of', required: false, constraint: 'data YYYY-MM-DD' },
    { name: 'storylines', required: true, constraint: 'array (può essere vuoto)' },
  ],
  entry: [
    { name: 'id', required: true, constraint: 'kebab-case, unico nel preset' },
    { name: 'title', required: true, constraint: 'stringa non vuota' },
    { name: 'domain', required: true, constraint: `una sedia (${CABINET_SEATS.join(' | ')})` },
    { name: 'parties', required: true, constraint: 'array non vuoto di id di mappa' },
    { name: 'region', required: false, constraint: 'stringa non vuota' },
    { name: 'state', required: true, constraint: STORYLINE_STATES.join(' | ') },
    { name: 'pressure', required: true, constraint: 'intero 1–3' },
    { name: 'summary', required: true, constraint: 'stringa non vuota (significato, non numeri)' },
    { name: 'trajectory', required: false, constraint: 'tendenza, mai una profezia (H-I12)' },
    { name: 'triggers', required: true, constraint: 'array non vuoto di stringhe' },
    { name: 'active_from', required: false, constraint: 'data YYYY-MM-DD' },
    { name: 'active_until', required: false, constraint: 'data YYYY-MM-DD' },
  ],
};

/** I nomi dei campi obbligatori di una voce (derivati dallo schema, non a mano). */
export const REQUIRED_STORYLINE_FIELDS: readonly (keyof Storyline)[] =
  STORYLINE_STANDARD_SCHEMA.entry.filter(f => f.required).map(f => f.name as keyof Storyline);
