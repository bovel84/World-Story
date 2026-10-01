/**
 * WS-JEV-W2 — Fast path deterministico dell'ingestion narrativa.
 *
 * Questo modulo è **puro**: nessun I/O, nessun database, nessuna chiamata a un
 * modello. Decide se un fatto narrativo merita di entrare in `jev_memory`:
 *  - KEEP  → evento noto oppure esito numerico verificato dal motore;
 *  - DROP  → rumore UI, testo vuoto o troppo grande;
 *  - DEFER → ambiguo. Con `llmFallbackEnabled=false` (default) non si salva e
 *            **non si interroga nessun LLM**: il determinismo resta del motore.
 *
 * JEV non modifica mai lo stato deterministico: qui si decide solo cosa
 * raccontare, mai un numero di gioco.
 */
import type { JevIngestInput } from './jev.types';

export type JevIngestDecision = 'KEEP' | 'DEFER' | 'DROP';

export interface JevClassification {
  decision: JevIngestDecision;
  reason: string;
}

/** Eventi di sola interfaccia: non sono memoria narrativa. */
const UI_EVENT_TYPES = new Set(['ui_notification', 'ui_event', 'screen_update', 'render']);

/** Eventi con semantica politica già nota: si conservano senza interpetazione. */
const KNOWN_EVENT_TYPES = new Set([
  'war_declared', 'treaty_signed',
  'government_decision', 'government_favor', 'government_grievance',
  'government_promise', 'government_kept', 'government_broken',
  'minister_statement', 'minister_promise', 'minister_decision',
  'player_decision', 'player_order',
  // WS-JEV-W5 — diplomazia: fatto condiviso e percezione dichiarata.
  'diplomacy_relationship', 'diplomacy_alliance',
  'diplomatic_exchange', 'diplomatic_view',
]);

/** Oltre questa soglia il testo non è una memoria, è una cronologia. */
const MAX_TEXT_LENGTH = 4000;

export function classifyJevIngest(input: JevIngestInput): JevClassification {
  // 1. Rumore UI (lo `source` 'ui' non è nella union: arriva da cast difensivo).
  if ((input.eventType !== undefined && UI_EVENT_TYPES.has(input.eventType))
    || (input as { source?: unknown }).source === 'ui') {
    return { decision: 'DROP', reason: 'ui_noise' };
  }
  // 2. Testo vuoto.
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { decision: 'DROP', reason: 'empty_text' };
  // 3. Testo troppo grande per una memoria narrativa.
  if (text.length > MAX_TEXT_LENGTH) return { decision: 'DROP', reason: 'text_too_large' };
  // 4. Evento noto.
  if (input.eventType !== undefined && KNOWN_EVENT_TYPES.has(input.eventType)) {
    return { decision: 'KEEP', reason: 'known_event_type' };
  }
  // 5. Esito verificato dal motore deterministico.
  if (input.source === 'simulation' && input.metadata?.hasNumericOutcome === true) {
    return { decision: 'KEEP', reason: 'verified_simulation_outcome' };
  }
  // 6. Ambigui: nessun LLM. Il chiamante non salva.
  return { decision: 'DEFER', reason: 'ambiguous_no_llm' };
}
