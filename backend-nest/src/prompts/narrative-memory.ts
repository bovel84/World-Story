import { CONSTRAINED_NARRATIVE_BUDGETS, type NarrativeBudgets } from '../llm/modelTier';

interface HistoryTurn {
  turn: number;
  date?: string;
  narration: string;
  events?: string[];
  timelineEvents?: Array<{ date: string; headline: string; detail: string }>;
}

const clip = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

/** Fits the compact model's 4,500-character allowance without dropping the
 * latest committed event behind an oversized historical summary. Newest first
 * is deliberate: truncation can only remove older context, never the trigger.
 *
 * I tetti dipendono dalla fascia del modello (`narrativeBudgetsFor`): con
 * `narrative.tieredMemory` i modelli forti ricevono più cronaca e più memoria
 * canonica; senza flag restano i valori storici (fascia vincolata). */
export function buildNarrativeMemory(
  results: HistoryTurn[],
  consolidated?: string,
  budgets: NarrativeBudgets = CONSTRAINED_NARRATIVE_BUDGETS,
): string {
  const memory = consolidated?.trim();
  // Il budget recente si riduce quando esiste una memoria canonica: la quota
  // 3.000/4.200 storica è preservata per la fascia vincolata.
  const recentBudget = memory
    ? Math.round((budgets.recentMemoryChars * 3_000) / 4_200)
    : budgets.recentMemoryChars;
  const turns = results.slice(-5).reverse();
  const recent: string[] = [];
  let remaining = recentBudget;
  for (const [index, turn] of turns.entries()) {
    const events = (turn.timelineEvents?.length ? turn.timelineEvents : (turn.events || []).map(headline => ({
      headline, date: turn.date || '', detail: '',
    }))).slice(-4).reverse();
    const lines = [`Turno ${turn.turn}${turn.date ? ` (${turn.date})` : ''}`];
    // Actual event context precedes the period summary, not the other way round.
    for (const event of events) {
      lines.push(`- ${event.date || ''} ${clip(event.headline, 160)}${event.detail ? `: ${clip(event.detail, index === 0 ? 650 : 280)}` : ''}`);
    }
    if (turn.narration) lines.push(`Sintesi: ${clip(turn.narration, 300)}`);
    const limit = Math.min(remaining, index === 0 ? budgets.newestTurnChars : budgets.recentTurnChars);
    if (limit < 100) break;
    const text = lines.join('\n');
    const excerpt = text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
    recent.push(excerpt);
    remaining -= excerpt.length + 2;
  }
  return [
    recent.length ? `[Cronaca recente — dal più recente al più antico; date vincolanti]\n${recent.join('\n\n')}` : '',
    memory ? `[Memoria canonica dei turni precedenti]\n${clip(memory, budgets.canonicalMemoryChars)}` : '',
  ].filter(Boolean).join('\n\n');
}
