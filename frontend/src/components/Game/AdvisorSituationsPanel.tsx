/** Situazioni e alternative; il Presidente porta una proposta al Consiglio. */
import type { AdvisorSituation, AdvisorSituationFocus, CouncilIssue } from '../../services/api';
import { seatSpeaker } from './councilMeeting';
import { AdvisorActionOptions } from './AdvisorActionOptions';

export function buildSituationFocusMessage(situation: AdvisorSituation): string {
  return `Approfondiamo la situazione «${situation.title}».`;
}

const cleanKeys = (keys: readonly string[] | undefined): string[] =>
  [...new Set((keys ?? []).map(key => key.trim()).filter(key => key.length > 0))];

/** Al server vanno solo id e riferimenti canonici, mai titolo o sintesi. */
export function buildSituationFocusPayload(situation: AdvisorSituation): AdvisorSituationFocus | undefined {
  const signalKeys = cleanKeys(situation.signalKeys);
  const evidenceKeys = cleanKeys(situation.evidenceKeys);
  if (!situation.id || (!signalKeys.length && !evidenceKeys.length)) return undefined;
  return {
    id: situation.id,
    ...(signalKeys.length ? { signalKeys } : {}),
    ...(evidenceKeys.length ? { evidenceKeys } : {}),
  };
}

/** Riusa la issue server-side integra: il browser non inventa ministri o fonti. */
export function situationAsPortableIssue(situation: AdvisorSituation, issues: readonly CouncilIssue[] = []): CouncilIssue | undefined {
  return issues.find(issue => issue.situationId === situation.id);
}

export function importanceLabel(importance: number): string {
  if (importance >= 3) return 'Urgente';
  if (importance === 2) return 'Da seguire';
  return 'Opportunità';
}

export interface AdvisorSituationsPanelProps {
  situations: AdvisorSituation[];
  issues?: readonly CouncilIssue[];
  onDeepen: (situation: AdvisorSituation) => void;
  onOpenIssue?: (issue: CouncilIssue, optionIndex?: number) => void;
  activeId?: string;
  disabled?: boolean;
}

export function AdvisorSituationsPanel({ situations, issues = [], onDeepen, onOpenIssue, activeId, disabled = false }: AdvisorSituationsPanelProps) {
  if (!situations.length) return null;
  const threads = situations.filter(situation => situation.basis !== 'signal');
  const signals = situations.filter(situation => situation.basis === 'signal');
  const renderCards = (items: AdvisorSituation[]) => (
    <ul className="advisor-situation-list">
      {items.map(situation => {
        const issue = situationAsPortableIssue(situation, issues);
        return <li key={situation.id}
          className={`advisor-situation-card${activeId === situation.id ? ' active' : ''}`}
          data-situation-id={situation.id} data-importance={situation.importance}>
          <details className="advisor-situation-details" open={activeId === situation.id || undefined}>
            <summary className="advisor-situation-toggle">
              <span className="advisor-situation-severity" data-importance={situation.importance}>{importanceLabel(situation.importance ?? 1)}</span>
              <h5 className="advisor-situation-title">{situation.title}</h5>
              {issue?.options?.length ? <span className="advisor-situation-choice-count">{issue.options.length} azioni</span> : null}
            </summary>
            <p className="advisor-situation-summary">{situation.summary}</p>
            {issue?.options?.length ? <AdvisorActionOptions issue={issue} onOpenIssue={onOpenIssue} disabled={disabled} />
              : issue?.question && <p className="advisor-situation-decision"><strong>Da decidere</strong> {issue.question}</p>}
            {issue?.suggestedMinisters.length ? <details className="advisor-question-ministers"><summary>Ministri coinvolti</summary>{issue.suggestedMinisters.map(seatSpeaker).join(' · ')}</details> : null}
            <div className="advisor-question-actions">
              <button type="button" className="advisor-situation-deepen" disabled={disabled}
                aria-label={`Approfondisci: ${situation.title}`}
                onClick={() => onDeepen(situation)}>Approfondisci <span aria-hidden="true">→</span></button>
              {onOpenIssue && <button type="button" className="council-issue-open advisor-situation-open"
                disabled={disabled || !issue}
                title={!issue ? 'Approfondisci per ottenere una questione verificata dal Consulente.' : undefined}
                onClick={() => { if (issue) onOpenIssue(issue); }}>Porta al Consiglio</button>}
            </div>
          </details>
        </li>;
      })}
    </ul>
  );
  return <section className="advisor-situations" aria-label="Situazioni sul tavolo" data-many={situations.length > 6 ? 'true' : undefined}>
    <header className="advisor-situations-header">
      <h4 className="advisor-situations-heading">Situazioni sul tavolo</h4>
      <p className="advisor-situations-subheading">Questioni che richiedono attenzione</p>
    </header>
    {threads.length > 0 && renderCards(threads)}
    {signals.length > 0 && <details className="advisor-signal-register" open={!threads.length || signals.some(signal => signal.id === activeId) || undefined}>
      <summary>Segnali da approfondire ({signals.length}){signals.some(signal => signal.importance === 3) ? ' · priorità urgenti' : ''}</summary>
      {renderCards(signals)}
    </details>}
  </section>;
}

export default AdvisorSituationsPanel;
