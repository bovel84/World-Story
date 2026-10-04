/**
 * WS-GAME-OPENING-IMMERSION — Il renderer narrativo dell'apertura (I3)
 * ==================================================================
 * **Una sola** chiamata LLM aggregata che trasforma l'`OpeningContext`
 * verificato in prosa: `world narrative` + `nation framing` + fino a tre voci
 * del consiglio. È **read-only**: nessuna memoria, nessun JEV, nessuna action,
 * nessun evento, nessuna mutazione del motore, nessuna direttiva di decisione.
 *
 * L'output NON è creduto sulla parola: `validateOpeningWorldNarrative` /
 * `validateTextAgainstContext` rifiutano cifre non presenti e proper noun nuovi.
 * Qualsiasi fallimento (provider assente, timeout, output invalido) restituisce
 * `null` e il chiamante usa il **fallback deterministico**. Il gioco non si
 * blocca mai sull'LLM.
 */
import {
  type OpeningContext,
  type OpeningNarrativeResponse,
  OPENING_NARRATIVE_SYSTEM,
  buildDeterministicOpeningResponse,
  composeOpeningNarrativePrompt,
  parseOpeningNarrativeJson,
  validateOpeningWorldNarrative,
  validateTextAgainstContext,
} from './OpeningNarrative';

const RENDER_TIMEOUT_MS = 12_000;

/**
 * Tenta il renderer. `null` se non disponibile o se l'output non supera la
 * validazione: il chiamante deve ricadere sul fallback deterministico.
 */
export async function renderOpeningNarrative(
  context: OpeningContext,
  signal?: AbortSignal,
): Promise<OpeningNarrativeResponse | null> {
  const deterministic = buildDeterministicOpeningResponse(context);
  try {
    const { getLLMRouter } = await import('../../llm');
    const router = getLLMRouter();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

    let content = '';
    try {
      const response = await router.generate(
        'advisor',
        OPENING_NARRATIVE_SYSTEM,
        composeOpeningNarrativePrompt(context),
        { temperature: 0.5, jsonMode: true, signal: controller.signal },
      );
      content = String(response?.content ?? '');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    const parsed = parseOpeningNarrativeJson(content);
    if (!parsed) return null;
    if (!validateOpeningWorldNarrative(parsed.world, context).ok) return null;

    const nationFraming = parsed.nationFraming
      && validateTextAgainstContext(parsed.nationFraming, context).ok
      ? parsed.nationFraming
      : deterministic.nation.framing;

    // Mapping esatto seat→seat: nessun ministro aggiuntivo, nessuna sostituzione.
    const council = context.council.map(entry => {
      const candidate = parsed.council.find(line => line.seat === entry.seat);
      const line = candidate && validateTextAgainstContext(candidate.line, context).ok
        ? candidate.line
        : entry.line;
      return { ...entry, line };
    });

    return {
      generated: true,
      deterministic: false,
      world: {
        ...deterministic.world,
        // §3 — La frase sul PAESE (dal quadro verificato) resta sempre in prima
        // pagina: il renderer può migliorare il mondo, non sostituire la realtà
        // del paese con una riga generica.
        narrative: {
          ...deterministic.world.narrative,
          ...parsed.world,
          stakesForNation: deterministic.world.narrative.stakesForNation || parsed.world.stakesForNation,
        },
      },
      nation: { framing: nationFraming, questions: [...context.nation.questions] },
      council,
    };
  } catch {
    return null;
  }
}
