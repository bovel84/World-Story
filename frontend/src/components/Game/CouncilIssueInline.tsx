import type { CouncilIssue } from '../../services/api';
import { seatSpeaker } from './councilMeeting';
import { AdvisorActionOptions } from './AdvisorActionOptions';

export interface CouncilIssueInlineProps {
  issue: CouncilIssue;
  onOpenIssue?: (issue: CouncilIssue, optionIndex?: number) => void;
  onDeepen?: (issue: CouncilIssue) => void;
  /** Nel Consulente i fatti restano nel payload, non allungano la card. */
  compact?: boolean;
  disabled?: boolean;
}

/** Questione verificata, mai una soluzione già scelta. Il clic apre la discussione. */
export function CouncilIssueInline({ issue, onOpenIssue, onDeepen, compact = false, disabled = false }: CouncilIssueInlineProps) {
  const body = <>
    <p className={compact ? 'advisor-situation-summary' : undefined}>{issue.question}</p>
    {compact && issue.suggestedMinisters.length > 0 && <p className="advisor-question-ministers">{issue.suggestedMinisters.map(seatSpeaker).join(' · ')}</p>}
    {!compact && issue.verifiedFacts.length > 0 && <ul className="council-issue-facts">
      {issue.verifiedFacts.map(fact => <li key={fact.key} title={`${fact.source} · ${fact.sourceRef}`}>
        <span>{fact.label}: </span><strong>{fact.value}</strong>
      </li>)}
    </ul>}
    <AdvisorActionOptions issue={issue} onOpenIssue={onOpenIssue} disabled={disabled} />
    <div className="advisor-question-actions">
      {onDeepen && <button type="button" className="advisor-situation-deepen" disabled={disabled}
        aria-label={`Approfondisci: ${issue.title}`} onClick={() => onDeepen(issue)}>Approfondisci <span aria-hidden="true">→</span></button>}
      {onOpenIssue && <button type="button" className="council-issue-open" disabled={disabled}
        onClick={() => onOpenIssue(issue)}>Porta al Consiglio</button>}
    </div>
  </>;
  return <section className={`council-issue-inline${compact ? ' advisor-question-card' : ''}`} data-issue-id={issue.id} aria-label={`Questione: ${issue.title}`}>
    {compact ? <details className="advisor-situation-details">
      <summary className="advisor-situation-toggle"><h4>{issue.title}</h4></summary>
      {body}
    </details> : <><h4>{issue.title}</h4>{body}</>}
  </section>;
}
