import { validateDirective, MAX_NEW_EVIDENCES_PER_REPLY, MAX_MAP_PREVIEW_REGIONS, type PresentationDirective } from './presentation';

export const NO_VERIFIED_GEOGRAPHY = 'Non dispongo di un riferimento geografico verificato per questa area.';
/**
 * M-INTENT — Cosa chiede il Presidente. Tre casi distinti, e non intercambiabili:
 * - `national`: chiede il **proprio** paese (territorio posseduto), anche se la
 *   questione contiene segnali diplomatici o militari che non risolvono;
 * - `situation`: chiede il **contesto** della questione (confine, crisi, fronte):
 *   valgono solo i riferimenti verificati, mai un fallback nazionale silenzioso;
 * - `generic`: chiede «la mappa»: prima i riferimenti verificati, poi — solo se
 *   non ce ne sono — la mappa politica nazionale, dichiarata neutra.
 */
export type GovernmentMapIntent = 'national' | 'situation' | 'generic';
export interface GovernmentMapRequest {
  readonly requested: true;
  /** Captured on receipt, never re-stamped while rendering old messages. */
  scopeKey?: string;
  /** L'intento, deciso una volta sola dal testo del Presidente (o generico
   *  quando il modello chiede la mappa di sua iniziativa). Mai ricalcolato a
   *  render-time: un'apertura salvata non cambia intento al reload. */
  intent?: GovernmentMapIntent;
  signalKeys: readonly string[];
  regionIds?: readonly string[];
}

const SHOW_VERB = '(?:fammi\\s+vedere|mostra(?:mi)?|vedere|visualizza|apri)';
/** Il Presidente chiede esplicitamente il **proprio** paese o la mappa nazionale. */
function isNationalMapRequest(text: string): boolean {
  return new RegExp(`\\b${SHOW_VERB}\\b[^.!?\\n]{0,40}\\b(?:nostro|nostra|nostri|nostre|proprio|propria|propri)\\s+(?:paese|nazione|territorio|territori)\\b`, 'i').test(text)
    || /\bmappa\s+(?:politica\s+)?nazionale\b/i.test(text)
    || /\bmappa\s+d(?:el|ella)\s+(?:nostro\s+|nostra\s+)?(?:paese|nazione)\b/i.test(text);
}

/** Il Presidente chiede il contesto geografico **della questione in corso**. */
const SITUATION_INTENT = /\b(?:confine|confini|crisi|fronte|fronti|guerra|schieramento|zona|area|contes[oa]|territori\s+contesi|vicin[oi]|dove\s+si\s+trov\w+)\b/i;

/** L'intento, dal solo testo del Presidente. Vuoto ⇒ generico (direttiva del modello). */
export function classifyGovernmentMapIntent(text: string): GovernmentMapIntent {
  if (isNationalMapRequest(text)) return 'national';
  if (SITUATION_INTENT.test(text)) return 'situation';
  return 'generic';
}

/** Recognize intent only. Place names in prose are never geographic evidence. */
export function isGovernmentMapRequest(text: string): boolean {
  return isNationalMapRequest(text)
    || /\b(?:fammi\s+vedere|mostra(?:mi)?|vedere)\b[^.!?\n]{0,60}(?:mappa|confine|situazione\s+geografica)/i.test(text)
    || /dove\s+si\s+trov\w+[^.!?\n]{0,40}(?:territori|regioni|fronte|fronti|confine|crisi)/i.test(text);
}

export function captureGovernmentMapRequest(input: {
  presidentText?: string;
  directives: readonly PresentationDirective[];
  signalKeys?: readonly string[];
  contextRegionIds?: readonly string[];
  scopeKey?: string;
}): GovernmentMapRequest | undefined {
  const chosen = input.directives.some(directive => directive.evidence === 'mappa' && ['show', 'focus'].includes(directive.op));
  if (!chosen && !isGovernmentMapRequest(input.presidentText ?? '')) return undefined;
  return { requested: true, scopeKey: input.scopeKey, intent: classifyGovernmentMapIntent(input.presidentText ?? ''),
    signalKeys: [...new Set(input.signalKeys ?? [])],
    ...(input.contextRegionIds?.length ? { regionIds: input.contextRegionIds } : {}) };
}

// Optional UI-only metadata in the existing Advisor cache. Revalidate on load;
// never drop an internal rejection flag or re-stamp the original epoch.
export function readGovernmentVisualMetadata(input: { evidence?: unknown; visualRequest?: unknown }): { evidence?: readonly PresentationDirective[]; visualRequest?: GovernmentMapRequest } {
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, MAX_NEW_EVIDENCES_PER_REPLY).flatMap(raw => {
    const parsed = validateDirective(JSON.stringify(raw));
    return parsed ? [{ ...parsed, ...(raw?.invalidRegionIds === true ? { invalidRegionIds: true } : {}) }] : [];
  }) : [];
  const request = input.visualRequest as Partial<GovernmentMapRequest> | null | undefined;
  const strings = (value: unknown, limit: number): value is string[] => Array.isArray(value) && value.length <= limit && value.every(id => typeof id === 'string' && id.length <= 256);
  const valid = request?.requested === true && (request.scopeKey === undefined || typeof request.scopeKey === 'string' && request.scopeKey.length <= 2048)
    && strings(request.signalKeys, 64);
  // M02 — Un insieme canonico ampio (il territorio di una nazione) non deve far
  // **sparire** la richiesta al ricaricamento. Il tetto qui difende l'input non
  // fidato, non cancella una mappa: se gli id superano il tetto di resa, si
  // mantiene la richiesta e si scartano solo gli id.
  const regionIds = request?.regionIds === undefined ? undefined : strings(request.regionIds, MAX_MAP_PREVIEW_REGIONS) ? [...request.regionIds] : undefined;
  const intent = request?.intent === 'national' || request?.intent === 'situation' || request?.intent === 'generic' ? request.intent : undefined;
  return { ...(evidence.length ? { evidence } : {}), ...(valid ? { visualRequest: { requested: true as const, scopeKey: request.scopeKey, ...(intent ? { intent } : {}), signalKeys: [...request.signalKeys!],
    ...(regionIds ? { regionIds } : {}) } } : {}) };
}

/** A model's visibility claim is not evidence that a card was rendered.
 * Keep the rest of the reply; do not rewrite ordinary nonvisual discussion. */
export function safeGovernmentVisualText(text: string, hasVisual: boolean): string {
  return hasVisual ? text : text.replace(/(?:^|(?<=[.!?\n]))[ \t]*(?:(?:signor\s+)?presidente[, :]\s*)?(?:la mappa (?:conferma|mostra|evidenzia)|come (?:vede|vedete) (?:sulla|nella) mappa|le mostro (?:questa|la) (?:zona|mappa))[^.!?\n]*[.!?]?/gi, NO_VERIFIED_GEOGRAPHY);
}
