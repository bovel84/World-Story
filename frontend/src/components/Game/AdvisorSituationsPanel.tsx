/**
 * WS-CONSULENTE-SITUAZIONI — Le SITUAZIONI cliccabili del Consulente.
 *
 * Una situazione è un problema/opportunità da approfondire: la card apre la
 * discussione col Consulente («Approfondisci») e NON il Consiglio. Solo una
 * `CouncilIssue` ha il pulsante «Porta al Consiglio».
 */
import type { AdvisorSituation } from '../../services/api';

/** Il testo che «Approfondisci» invia al Consulente: la situazione diventa il focus. */
export function buildSituationFocusMessage(situation: AdvisorSituation): string {
  const summary = situation.summary?.trim();
  return `Approfondiamo la situazione «${situation.title}»${summary ? `: ${summary}` : ''}.`;
}

export interface AdvisorSituationsPanelProps {
  situations: AdvisorSituation[];
  onDeepen: (situation: AdvisorSituation) => void;
  disabled?: boolean;
}

export function AdvisorSituationsPanel({ situations, onDeepen, disabled = false }: AdvisorSituationsPanelProps) {
  if (!situations.length) return null;
  return <section className="advisor-situations" aria-label="Situazioni da approfondire">
    <h4 className="advisor-situations-heading">Situazioni</h4>
    <ul className="advisor-situation-list">
      {situations.map(situation => <li key={situation.id} className="advisor-situation-card" data-situation-id={situation.id}>
        <p className="advisor-situation-title">{situation.title}</p>
        <p className="advisor-situation-summary">{situation.summary}</p>
        <button type="button" className="advisor-situation-deepen" disabled={disabled}
          onClick={() => onDeepen(situation)}>Approfondisci</button>
      </li>)}
    </ul>
  </section>;
}

export default AdvisorSituationsPanel;
