import { validateDirective, MAX_NEW_EVIDENCES_PER_REPLY, MAX_MAP_REGION_IDS, type PresentationDirective } from './presentation';

export const NO_VERIFIED_GEOGRAPHY = 'Non dispongo di un riferimento geografico verificato per questa area.';
export interface GovernmentMapRequest {
  readonly requested: true;
  /** Captured on receipt, never re-stamped while rendering old messages. */
  scopeKey?: string;
  signalKeys: readonly string[];
  regionIds?: readonly string[];
}

/** Recognize intent only. Place names in prose are never geographic evidence. */
export function isGovernmentMapRequest(text: string): boolean {
  return /\b(?:fammi\s+vedere|mostra(?:mi)?|vedere)\b[^.!?\n]{0,60}(?:mappa|confine|situazione\s+geografica)/i.test(text)
    || /dove\s+si\s+trovano[^.!?\n]{0,40}(?:territori|regioni)/i.test(text);
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
  return { requested: true, scopeKey: input.scopeKey, signalKeys: [...new Set(input.signalKeys ?? [])],
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
    && strings(request.signalKeys, 64) && (request.regionIds === undefined || strings(request.regionIds, MAX_MAP_REGION_IDS));
  return { ...(evidence.length ? { evidence } : {}), ...(valid ? { visualRequest: { requested: true as const, scopeKey: request.scopeKey, signalKeys: [...request.signalKeys!],
    ...(request.regionIds ? { regionIds: [...request.regionIds] } : {}) } } : {}) };
}

/** A model's visibility claim is not evidence that a card was rendered.
 * Keep the rest of the reply; do not rewrite ordinary nonvisual discussion. */
export function safeGovernmentVisualText(text: string, hasVisual: boolean): string {
  return hasVisual ? text : text.replace(/(?:^|(?<=[.!?\n]))[ \t]*(?:(?:signor\s+)?presidente[, :]\s*)?(?:la mappa (?:conferma|mostra|evidenzia)|come (?:vede|vedete) (?:sulla|nella) mappa|le mostro (?:questa|la) (?:zona|mappa))[^.!?\n]*[.!?]?/gi, NO_VERIFIED_GEOGRAPHY);
}
