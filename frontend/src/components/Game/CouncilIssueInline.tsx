import { useState } from 'react';
import type { CouncilIssue } from '../../services/api';

export interface CouncilIssueInlineProps {
  issue: CouncilIssue;
  onOpenIssue?: (issue: CouncilIssue, chosenOption?: { title: string; content: string }) => void;
  disabled?: boolean;
}

/** A server-verified discussion proposal. Only the President's click opens a room. */
export function CouncilIssueInline({ issue, onOpenIssue, disabled = false }: CouncilIssueInlineProps) {
  // P02 — La mossa scelta dal Presidente. È una preferenza di PRESENTAZIONE: non
  // invia nulla e non modifica il mondo. Il clic riempie la bozza nella stanza.
  const [chosen, setChosen] = useState<number | null>(null);
  const options = issue.options ?? [];
  return <section className="council-issue-inline" data-issue-id={issue.id} aria-label={`Questione: ${issue.title}`}>
    <h4>{issue.title}</h4>
    <p>{issue.question}</p>
    {options.length > 0 && <ul className="council-issue-options" aria-label="Mosse proposte">
      {options.map((option, index) => (
        <li key={`${issue.id}-opt-${index}`}>
          <button
            type="button"
            className={`council-option${chosen === index ? ' is-chosen' : ''}`}
            aria-pressed={chosen === index}
            disabled={disabled}
            onClick={() => setChosen(chosen === index ? null : index)}
          >
            <span className="council-option-title">{option.title}</span>
            <span className="council-option-content">{option.content}</span>
          </button>
        </li>
      ))}
    </ul>}
    {issue.verifiedFacts.length > 0 && <ul className="council-issue-facts">
      {issue.verifiedFacts.map(fact => <li key={fact.key} title={`${fact.source} · ${fact.sourceRef}`}>
        <span>{fact.label}: </span><strong>{fact.value}</strong>
      </li>)}
    </ul>}
    {onOpenIssue && <button
      type="button"
      className="council-issue-open"
      disabled={disabled}
      onClick={() => onOpenIssue(issue, chosen === null ? undefined : options[chosen])}
    >Porta al Consiglio</button>}
  </section>;
}
