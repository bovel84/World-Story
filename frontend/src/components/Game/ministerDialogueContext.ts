import type { AdvisorHistoryItem, MinisterCurrentDecision } from '../../services/api';
import { activeProposal, type DecisionWorkspace } from './decisionWorkspace';

// Match normalizeCurrentDecision's transport limits; this is not engine state.
const bounded = (text: string): string => text.slice(0, 400);

/** Detached dialogue snapshot; never promote recommendations or mutate the workspace. */
export function projectCurrentDecision(workspace: DecisionWorkspace | null): MinisterCurrentDecision | undefined {
  if (!workspace) return undefined;
  const proposal = activeProposal(workspace);
  const objective = proposal?.objective ?? workspace.objective;
  if (!proposal && !objective) return undefined;
  return {
    objective: objective === null ? null : bounded(objective),
    ...(Number.isInteger(workspace.revision) && workspace.revision >= 0 ? { revision: workspace.revision } : {}),
    measures: proposal?.measures.slice(0, 30).map(measure => ({
      id: bounded(measure.id),
      label: bounded(measure.label),
      kind: measure.kind,
      ...(measure.value !== undefined ? { value: bounded(measure.value) } : {}),
      ...(measure.unit !== undefined ? { unit: bounded(measure.unit) } : {}),
      ...(measure.amount !== undefined && Number.isFinite(measure.amount) ? { amount: measure.amount } : {}),
      ...(measure.sharePct !== undefined && Number.isFinite(measure.sharePct) && measure.sharePct >= 0 && measure.sharePct <= 100 ? { sharePct: measure.sharePct } : {}),
      // Even rejected/unresolved measures retain their exact provenance.
      status: measure.status,
      source: measure.source,
    })) ?? [],
    constraints: proposal?.constraints.slice(0, 20).map(bounded) ?? [],
    unresolved: proposal?.unresolvedQuestions.slice(0, 20).map(bounded) ?? [],
  };
}

/** Guard only the exact assistant opening, not repeated or similar subsequent turns. */
export function hasMinisterOpening(messages: readonly AdvisorHistoryItem[], openingText: string): boolean {
  return Boolean(openingText) && messages.some(message => message.role === 'assistant' && message.content === openingText);
}

export function buildMinisterHistory(messages: readonly AdvisorHistoryItem[], openingText: string): AdvisorHistoryItem[] {
  return openingText && !hasMinisterOpening(messages, openingText)
    ? [{ role: 'assistant', content: openingText }, ...messages]
    : [...messages];
}
