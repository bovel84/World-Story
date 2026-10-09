/** First Government opening: primary LLM generation with a non-blocking,
 * deterministic verified fallback. Kept out of the component so the transport
 * contract (primary → context) is unit-testable without a DOM. */
import { advisorApi, type RealityAdvisorResponse } from '../../services/api';
import type { AdvisorOpening } from './advisorMemory';
import type { GovernmentVisualMessage } from './governmentVisual';
import { parsePresentation } from './presentation';
import { captureGovernmentMapRequest } from './governmentVisualRequest';

/** M-APERTURA — La risposta iniziale è la stessa risposta del Consulente: se il
 * modello v'ha scritto un blocco `tavola`, va estratto come in ogni altro turno,
 * il testo visibile resta senza JSON e la richiesta geografica eredita le
 * `signalKeys` di situazioni e proposte. Lo `scopeKey` è quello dello snapshot
 * al momento della generazione: un'apertura salvata non si ri-attribuisce a un
 * mondo nuovo (il resolver la scarta se lo scope non coincide). */
export function toAdvisorOpening(result: RealityAdvisorResponse, scopeKey?: string): AdvisorOpening {
  const parsed = parsePresentation(result.reply);
  const situations = result.situations?.length ? result.situations : undefined;
  const signalKeys = [
    ...(situations ?? []).flatMap(situation => situation.signalKeys ?? []),
    ...result.issues.flatMap(issue => issue.signalKeys ?? []),
  ];
  const visualRequest = captureGovernmentMapRequest({ directives: parsed.directives, signalKeys, scopeKey });
  return {
    reply: parsed.text,
    issues: result.issues,
    // Retrocompatibile: una vecchia risposta senza situazioni equivale a nessuna.
    ...(situations ? { situations } : {}),
    ...(parsed.directives.length ? { evidence: parsed.directives } : {}),
    ...(visualRequest ? { visualRequest } : {}),
    date: result.advisorContext?.verifiedWorldSnapshot?.date ?? null,
  };
}

export async function fetchAdvisorOpening(gameId: string, signal?: AbortSignal, scopeKey?: string): Promise<AdvisorOpening> {
  try {
    return toAdvisorOpening(await advisorApi.opening(gameId, signal), scopeKey);
  } catch (error) {
    // A cancellation of the primary request must not be turned into a second call.
    if (signal?.aborted) throw error;
    return toAdvisorOpening(await advisorApi.context(gameId, signal), scopeKey);
  }
}

/** M-APERTURA — L'apertura entra in `GovernmentMessageVisuals` con lo stesso
 * contratto dei turni: testo già privo del blocco tecnico, `evidence` e
 * `visualRequest` persistiti. Una cache vecchia senza metadati mostra il testo
 * pulito ma nessuna mappa: non si inventa uno scope nuovo. */
export function advisorOpeningMessage(opening: AdvisorOpening, snapshotScope?: string): GovernmentVisualMessage {
  // Una richiesta nata per un altro snapshot non si mostra: niente mappa, né il
  // falso messaggio di assenza geografica. Il testo resta.
  const stale = Boolean(opening.visualRequest?.scopeKey && snapshotScope && opening.visualRequest.scopeKey !== snapshotScope);
  return {
    role: 'assistant',
    content: parsePresentation(opening.reply).text,
    ...(opening.situations ? { situations: opening.situations } : {}),
    ...(opening.issues.length ? { issues: opening.issues } : {}),
    ...(opening.evidence?.length && !stale ? { evidence: opening.evidence } : {}),
    ...(opening.visualRequest && !stale ? { visualRequest: opening.visualRequest } : {}),
  };
}
