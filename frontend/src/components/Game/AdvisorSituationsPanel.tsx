/**
 * WS-CONSULENTE-SITUAZIONI — Le SITUAZIONI cliccabili del Consulente.
 *
 * Una situazione è un problema/opportunità da approfondire: la card apre la
 * discussione col Consulente («Approfondisci») e NON il Consiglio. Solo una
 * `CouncilIssue` ha il pulsante «Porta al Consiglio».
 *
 * La presentazione è una «scrivania del Presidente»: badge di importanza
 * testuale (mai solo colore), titolo concreto, sintesi breve, azione chiara.
 */
import type { AdvisorSituation } from '../../services/api';

/** Il testo che «Approfondisci» invia al Consulente: la situazione diventa il focus. */
export function buildSituationFocusMessage(situation: AdvisorSituation): string {
  const summary = situation.summary?.trim();
  return `Approfondiamo la situazione «${situation.title}»${summary ? `: ${summary}` : ''}.`;
}

/** Etichetta testuale dell'importanza: 3 Urgente, 2 Da seguire, 1 Opportunità.
 *  Il testo è leggibile anche senza colore (accessibilità). */
export function importanceLabel(importance: number): string {
  if (importance >= 3) return 'Urgente';
  if (importance === 2) return 'Da seguire';
  return 'Opportunità';
}

export interface AdvisorSituationsPanelProps {
  situations: AdvisorSituation[];
  onDeepen: (situation: AdvisorSituation) => void;
  /** Situazione attualmente in esame: la card assume lo stato `.active`. */
  activeId?: string;
  disabled?: boolean;
}

export function AdvisorSituationsPanel({ situations, onDeepen, activeId, disabled = false }: AdvisorSituationsPanelProps) {
  if (!situations.length) return null;
  return <section className="advisor-situations" aria-label="Situazioni sul tavolo" data-many={situations.length > 6 ? 'true' : undefined}>
    <header className="advisor-situations-header">
      <h4 className="advisor-situations-heading">Situazioni sul tavolo</h4>
      <p className="advisor-situations-subheading">Questioni che richiedono attenzione</p>
    </header>
    <ul className="advisor-situation-list">
      {situations.map(situation => {
        const active = activeId === situation.id;
        return <li key={situation.id}
          className={`advisor-situation-card${active ? ' active' : ''}`}
          data-situation-id={situation.id} data-importance={situation.importance}>
          <span className="advisor-situation-severity" data-importance={situation.importance}>{importanceLabel(situation.importance ?? 1)}</span>
          <h5 className="advisor-situation-title">{situation.title}</h5>
          <p className="advisor-situation-summary">{situation.summary}</p>
          <button type="button" className="advisor-situation-deepen" disabled={disabled}
            aria-label={`Approfondisci: ${situation.title}`}
            onClick={() => onDeepen(situation)}>Approfondisci <span aria-hidden="true">→</span></button>
        </li>;
      })}
    </ul>
  </section>;
}

export default AdvisorSituationsPanel;
