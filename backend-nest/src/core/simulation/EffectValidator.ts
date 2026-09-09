/**
 * M06 µ2 — EffectValidator strict
 * ================================
 * Confine strict: la LLM non muta beni/mappa/stats direttamente.
 *
 * Regole (piano M06 passi 3–4, 6):
 *  - `worldChanges` assoluti (PIL/fondi/militare/territorio/popolazione/feature)
 *    sono vietati in strict: nessun `worldChanges` crea ricchezza per testo.
 *  - `mapChanges` LLM diretti (build_facility/spawn_battalion/transfer/...) sono
 *    vietati senza resolver+autorità del modello: la proiezione mappa deriva da
 *    progetto/unità verificati, non da comandi LLM.
 *  - Gli effetti strict hanno causale e tipi consentiti
 *    (`ledger|project_tick|shipment|qualitative`); gli eventi qualitativi senza
 *    mutazioni restano possibili.
 *  - Protocollo, ID o effetti invalidi → `EffectValidationError` (errore/pausa
 *    all'ultimo checkpoint), MAI simulazione riuscita per fallback.
 *
 * Il validatore è puro e deterministico: nessuna rete, nessun DB, nessun effetto.
 */

export type StrictEffectKind = 'ledger' | 'project_tick' | 'shipment' | 'qualitative';

export interface StrictEffect {
  readonly kind: StrictEffectKind;
  readonly effectId: string;
  /** Causale obbligatoria per ogni effetto materiale (ledger/project_tick/shipment). */
  readonly cause?: string;
  /** Ledger: conto/valuta/importo. */
  readonly account?: string;
  readonly currency?: string;
  readonly amount?: string;
  /** Shipment: risorsa/quantità. */
  readonly resource?: string;
  readonly quantity?: string;
  /** project_tick: progetto/processo. */
  readonly projectId?: string;
  /** Data dell'effetto (YYYY-MM-DD). */
  readonly date?: string;
}

export class EffectValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EffectValidationError';
    this.code = code;
  }
}

const ALLOWED_KINDS: readonly StrictEffectKind[] = ['ledger', 'project_tick', 'shipment', 'qualitative'];
const MATERIAL_KINDS: readonly StrictEffectKind[] = ['ledger', 'project_tick', 'shipment'];

function nonEmpty(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0
    : !!value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Chiavi di `worldChanges` che in strict non possono mai essere mutate dalla LLM. */
const FORBIDDEN_WORLD_KEYS: readonly string[] = [
  'regionOwners',
  'regionColors',
  'regionGDP',
  'regionMilitary',
  'regionPopulation',
  'newFeatures',
  'deletedFeatures',
];

/**
 * `worldChanges` assoluti (PIL/fondi/militare/territorio/popolazione/feature)
 * sono vietati in strict. Un oggetto vuoto o assente è ammesso.
 */
export function validateStrictWorldChanges(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new EffectValidationError('MALFORMED_WORLD_CHANGES', 'strict: worldChanges deve essere un oggetto');
  }
  const raw = value as Record<string, unknown>;
  for (const key of FORBIDDEN_WORLD_KEYS) {
    if (nonEmpty(raw[key])) {
      throw new EffectValidationError(
        'UNAUTHORIZED_WORLD_CHANGE',
        `strict: worldChanges.${key} diretto vietato (nessuna mutazione materiale per testo)`,
      );
    }
  }
}

/**
 * `mapChanges` LLM diretti sono vietati in strict senza resolver+autorità del
 * modello. Un array vuoto o assente è ammesso.
 */
export function validateStrictMapChanges(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw new EffectValidationError('MALFORMED_MAP_CHANGES', 'strict: mapChanges deve essere un array');
  }
  if (value.length) {
    throw new EffectValidationError(
      'UNAUTHORIZED_MAP_CHANGE',
      'strict: mapChanges LLM diretto vietato senza resolver/autorizzazione del modello',
    );
  }
}

/**
 * Rifiuta esplicitamente comandi materiali LLM legacy prima di ogni fallback.
 * `build_facility`/`spawn_battalion`/`spawn_unit`/`grant_funds`/`set_gdp` non
 * sono più comandi LLM diretti nel percorso strict.
 */
export function rejectDirectMaterialCommand(command: string): void {
  if (/\b(build_facility|spawn_battalion|spawn_unit|grant_funds|set_gdp)\b/i.test(command)) {
    throw new EffectValidationError(
      'DIRECT_MATERIAL_COMMAND',
      'comando materiale LLM diretto vietato in strict',
    );
  }
}

/**
 * Valida un singolo effetto strict: tipo ammesso, effectId non vuoto, causale
 * obbligatoria per gli effetti materiali. Protocollo invalido → errore, mai
 * accettazione implicita.
 */
export function validateStrictEffect(effect: unknown): asserts effect is StrictEffect {
  if (!effect || typeof effect !== 'object') {
    throw new EffectValidationError('INVALID_EFFECT', 'effetto non valido (non-oggetto)');
  }
  const e = effect as Record<string, unknown>;
  if (!ALLOWED_KINDS.includes(e.kind as StrictEffectKind)) {
    throw new EffectValidationError('UNSUPPORTED_EFFECT', `effect kind non ammesso: ${String(e.kind)}`);
  }
  if (!isNonEmptyString(e.effectId)) {
    throw new EffectValidationError('INVALID_EFFECT_ID', 'effectId obbligatorio e non vuoto');
  }
  const kind = e.kind as StrictEffectKind;
  if (MATERIAL_KINDS.includes(kind)) {
    if (!isNonEmptyString(e.cause)) {
      throw new EffectValidationError('MISSING_CAUSE', `effetto materiale (${kind}) senza causale`);
    }
    // Campi specifici per tipo: un effetto materiale senza bersaglio è sospetto.
    if (kind === 'ledger' && !isNonEmptyString(e.account)) {
      throw new EffectValidationError('MISSING_ACCOUNT', 'effetto ledger senza conto');
    }
    if (kind === 'shipment' && !isNonEmptyString(e.resource)) {
      throw new EffectValidationError('MISSING_RESOURCE', 'effetto shipment senza risorsa');
    }
    if (kind === 'project_tick' && !isNonEmptyString(e.projectId)) {
      throw new EffectValidationError('MISSING_PROJECT', 'effetto project_tick senza progetto');
    }
  }
}

/**
 * Valida una lista di effetti strict. Un effetto invalido interrompe l'intero
 * lotto: nessun effetto viene applicato parzialmente.
 */
export function validateStrictEffects(effects: readonly unknown[]): void {
  if (!Array.isArray(effects)) {
    throw new EffectValidationError('INVALID_EFFECTS', 'effects deve essere un array');
  }
  for (const effect of effects) validateStrictEffect(effect);
}

/**
 * Valida un esito (actionOutcome) strict: actionId canonico non vuoto, status
 * ammesso, summary non vuoto. Un esito senza actionId non è accettabile nel
 * percorso canonico (nessun fallback posizionale).
 */
export function validateStrictOutcome(outcome: unknown): void {
  if (!outcome || typeof outcome !== 'object') {
    throw new EffectValidationError('INVALID_OUTCOME', 'outcome non valido (non-oggetto)');
  }
  const o = outcome as Record<string, unknown>;
  if (!isNonEmptyString(o.actionId)) {
    throw new EffectValidationError('MISSING_ACTION_ID', 'outcome senza actionId canonico');
  }
  if (!['accepted', 'partial', 'rejected'].includes(o.status as string)) {
    throw new EffectValidationError('INVALID_OUTCOME_STATUS', `status outcome non ammesso: ${String(o.status)}`);
  }
  if (!isNonEmptyString(o.summary)) {
    throw new EffectValidationError('MISSING_OUTCOME_SUMMARY', 'outcome senza summary');
  }
}

/**
 * Valida l'intero risultato di simulazione strict in un solo punto:
 * worldChanges, mapChanges (da ogni evento), actionOutcomes ed effects.
 * Qualsiasi mutazione materiale non autorizzata → `EffectValidationError`.
 */
export function validateStrictResult(result: unknown): void {
  if (!result || typeof result !== 'object') {
    throw new EffectValidationError('INVALID_RESULT', 'risultato di simulazione non valido');
  }
  const r = result as Record<string, unknown>;

  validateStrictWorldChanges(r.worldChanges);

  // mapChanges da ogni evento: vietati in strict senza resolver/autorizzazione.
  if (r.events !== undefined && !Array.isArray(r.events)) {
    throw new EffectValidationError('MALFORMED_EVENTS', 'strict: events deve essere un array');
  }
  if (Array.isArray(r.events)) {
    for (const event of r.events) {
      if (!event || typeof event !== 'object') {
        throw new EffectValidationError('MALFORMED_EVENT', 'strict: evento non valido');
      }
      validateStrictMapChanges((event as Record<string, unknown>).mapChanges);
    }
  }

  // Esiti uno-a-uno: ogni outcome deve avere actionId canonico e status valido.
  if (r.actionOutcomes !== undefined && !Array.isArray(r.actionOutcomes)) {
    throw new EffectValidationError('MALFORMED_OUTCOMES', 'strict: actionOutcomes deve essere un array');
  }
  if (Array.isArray(r.actionOutcomes)) {
    for (const outcome of r.actionOutcomes) validateStrictOutcome(outcome);
  }

  // Effetti strict: tipi consentiti + causale.
  if (r.effects !== undefined) validateStrictEffects(r.effects as readonly unknown[]);
}

/**
 * Wrapper fuzz-safe: converte qualsiasi errore imprevisto in
 * `EffectValidationError` (mai crash non gestito, mai fallback di successo).
 */
export function validateStrictResultSafe(result: unknown): void {
  try {
    validateStrictResult(result);
  } catch (err) {
    if (err instanceof EffectValidationError) throw err;
    throw new EffectValidationError(
      'MALFORMED_RESULT',
      `strict: risultato malformato (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}
