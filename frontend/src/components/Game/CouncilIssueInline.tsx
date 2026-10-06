import type { CouncilIssue } from '../../services/api';

export interface CouncilIssueInlineProps {
  issue: CouncilIssue;
  onOpenIssue?: (issue: CouncilIssue) => void;
  disabled?: boolean;
}

/** A server-verified discussion proposal. Only the President's click opens a room. */
export function CouncilIssueInline({ issue, onOpenIssue, disabled = false }: CouncilIssueInlineProps) {
  return <section className="council-issue-inline" data-issue-id={issue.id} aria-label={`Questione: ${issue.title}`}>
    <h4>{issue.title}</h4>
    <p>{issue.question}</p>
    {issue.verifiedFacts.length > 0 && <ul className="council-issue-facts">
      {issue.verifiedFacts.map(fact => <li key={fact.key} title={`${fact.source} · ${fact.sourceRef}`}>
        <span>{fact.label}: </span><strong>{fact.value}</strong>
      </li>)}
    </ul>}
    {onOpenIssue && <button type="button" className="council-issue-open" disabled={disabled} onClick={() => onOpenIssue(issue)}>Porta al Consiglio</button>}
  </section>;
}
