/**
 * U02 µ2 — lettura strutturata dell'assessment di fattibilità (M03).
 * ==================================================================
 * La route `/actions/check-feasibility` appiattisce i blocker in
 * prerequisiti/rischi/avvisi ma conserva l'assessment completo in
 * `rawAssessment`. Questo modulo puro ne ricava, senza inventare nulla:
 *  - i blocker con il loro **reason code** e ciò che manca;
 *  - le **alternative** proposte dal motore (`research` / `alternative_path`),
 *    sempre marcate `requiresConfirmation: true`: nessuna viene avviata da sola;
 *  - la distinzione tra **dati mancanti** (`needs_data`) e ordine **bloccato**.
 *
 * Nessun effetto collaterale: input `unknown` → vista tipizzata o vuota.
 */

export type FeasibilityStatus =
  | 'needs_data'
  | 'blocked'
  | 'feasible'
  | 'feasible_with_conditions'
  | 'unknown';

export interface FeasibilityBlockerView {
  readonly code: string;
  /** Etichetta leggibile per il reason code (fallback: il codice stesso). */
  readonly label: string;
  readonly detail: string;
  readonly missing: readonly string[];
  readonly targetId?: string;
}

export interface FeasibilityAlternativeView {
  readonly kind: 'research' | 'alternative_path';
  readonly label: string;
  readonly missing: readonly string[];
  /** Le alternative sono proposte, mai azioni silenziose. */
  readonly requiresConfirmation: true;
}

export interface FeasibilityExplanation {
  readonly status: FeasibilityStatus;
  readonly needsData: boolean;
  readonly blockers: readonly FeasibilityBlockerView[];
  readonly alternatives: readonly FeasibilityAlternativeView[];
  /** Righe sintetiche sui soli dati mancanti (codice DATA_UNAVAILABLE). */
  readonly dataNotes: readonly string[];
}

const REASON_LABEL: Record<string, string> = {
  UNKNOWN_ENTITY: 'Riferimento non riconosciuto',
  AMBIGUOUS_TARGET: 'Obiettivo ambiguo',
  UNAUTHORIZED_ACTOR: 'Non autorizzato',
  UNSUPPORTED_CAPABILITY: 'Capacità non supportata',
  KNOWLEDGE_MISSING: 'Conoscenza mancante',
  INDUSTRIAL_CAPABILITY_MISSING: 'Capacità industriale mancante',
  DATA_UNAVAILABLE: 'Dati autorevoli non disponibili',
  DEPENDENCY_BLOCKED: 'Dipende da un passo precedente',
};

const ALTERNATIVE_LABEL: Record<FeasibilityAlternativeView['kind'], string> = {
  research: 'Pianifica la ricerca',
  alternative_path: 'Percorso alternativo',
};

const STATUSES: readonly FeasibilityStatus[] = [
  'needs_data', 'blocked', 'feasible', 'feasible_with_conditions',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readBlockers(raw: Record<string, unknown>): FeasibilityBlockerView[] {
  if (!Array.isArray(raw.blockers)) return [];
  const out: FeasibilityBlockerView[] = [];
  for (const item of raw.blockers) {
    const blocker = asRecord(item);
    if (!blocker) continue;
    const code = asString(blocker.code);
    if (!code) continue;
    const detail = asString(blocker.detail) ?? REASON_LABEL[code] ?? code;
    const targetId = asString(blocker.targetId) ?? asString(blocker.target_id) ?? undefined;
    out.push({
      code,
      label: REASON_LABEL[code] ?? code,
      detail,
      missing: asStringArray(blocker.missing),
      ...(targetId ? { targetId } : {}),
    });
  }
  return out;
}

function readAlternatives(raw: Record<string, unknown>): FeasibilityAlternativeView[] {
  if (!Array.isArray(raw.alternatives)) return [];
  const out: FeasibilityAlternativeView[] = [];
  for (const item of raw.alternatives) {
    const alternative = asRecord(item);
    if (!alternative) continue;
    const kind = alternative.kind;
    if (kind !== 'research' && kind !== 'alternative_path') continue;
    out.push({
      kind,
      label: ALTERNATIVE_LABEL[kind],
      missing: asStringArray(alternative.missing),
      requiresConfirmation: true,
    });
  }
  return out;
}

/** Vista strutturata dell'assessment; per input non valido ritorna `unknown` vuoto. */
export function explainFeasibility(raw: unknown): FeasibilityExplanation {
  const record = asRecord(raw);
  if (!record) {
    return { status: 'unknown', needsData: false, blockers: [], alternatives: [], dataNotes: [] };
  }
  const statusValue = asString(record.status);
  const status: FeasibilityStatus = statusValue && (STATUSES as readonly string[]).includes(statusValue)
    ? (statusValue as FeasibilityStatus)
    : 'unknown';
  const blockers = readBlockers(record);
  const alternatives = readAlternatives(record);
  const dataNotes = [...new Set(
    blockers.filter(blocker => blocker.code === 'DATA_UNAVAILABLE').map(blocker => blocker.detail),
  )];
  return {
    status,
    needsData: status === 'needs_data' || dataNotes.length > 0,
    blockers,
    alternatives,
    dataNotes,
  };
}
