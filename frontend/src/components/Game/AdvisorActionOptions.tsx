import type { CouncilIssue } from '../../services/api';

/** Read-only proposals; selecting one only prepares an editable council message. */
export function AdvisorActionOptions({ issue, onOpenIssue, disabled = false }: {
  issue: CouncilIssue;
  onOpenIssue?: (issue: CouncilIssue, optionIndex?: number) => void;
  disabled?: boolean;
}) {
  if (!issue.options?.length) return null;
  return <section className="advisor-action-options" aria-label={`Azioni possibili: ${issue.title}`}>
    <h6>Azioni possibili</h6>
    <ul>
      {issue.options.map((option, index) => <li key={`${index}-${option.title}`}>
        <h6>{option.title}</h6>
        <p>{option.content}</p>
        {onOpenIssue && <button type="button" className="advisor-situation-deepen" disabled={disabled}
          aria-label={`Discuti al Consiglio: ${option.title}`}
          onClick={() => onOpenIssue(issue, index)}>Discuti questa azione <span aria-hidden="true">→</span></button>}
      </li>)}
    </ul>
  </section>;
}
