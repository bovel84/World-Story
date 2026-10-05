/** First Government opening: primary LLM generation with a non-blocking,
 * deterministic verified fallback. Kept out of the component so the transport
 * contract (primary → context) is unit-testable without a DOM. */
import { advisorApi, type RealityAdvisorResponse } from '../../services/api';
import type { AdvisorOpening } from './advisorMemory';

export function toAdvisorOpening(result: RealityAdvisorResponse): AdvisorOpening {
  return {
    reply: result.reply,
    issues: result.issues,
    date: result.advisorContext?.verifiedWorldSnapshot?.date ?? null,
  };
}

export async function fetchAdvisorOpening(gameId: string, signal?: AbortSignal): Promise<AdvisorOpening> {
  try {
    return toAdvisorOpening(await advisorApi.opening(gameId, signal));
  } catch (error) {
    // A cancellation of the primary request must not be turned into a second call.
    if (signal?.aborted) throw error;
    return toAdvisorOpening(await advisorApi.context(gameId, signal));
  }
}
