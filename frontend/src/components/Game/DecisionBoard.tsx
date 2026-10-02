/**
 * WS-GOV-DIALOGUE-TO-ACT — La proposta corrente sulla tavola (Parte E/G/O)
 * =======================================================================
 * Presentazione pura del `DecisionWorkspace`: la **proposta corrente** è il
 * centro della tavola, con la sua gerarchia —
 *
 *   QUESTIONE / OBIETTIVO
 *   PROPOSTA CORRENTE   ← grande e centrale
 *   DA DECIDERE
 *   CONSEGUENZE / RISCHI
 *   REVISIONI
 *   ATTO                ← solo quando preparato / pronto
 *
 * Nessun numero è ricalcolato qui: le misure arrivano dal workspace, con la loro
 * provenienza (motore / Presidente / ministro). L'atto non domina: è il risultato
 * finale, e quando non è più attuale lo dichiara e si rigenera.
 */
import {
  activeProposal, actStaleness, isReadyForAct,
  MEASURE_SOURCE_LABEL, MEASURE_STATUS_LABEL, WORKSPACE_STATUS_LABEL, workspaceStatus,
  type DecisionMeasure, type DecisionWorkspace,
} from './decisionWorkspace';
import { EVIDENCE_KEYS, evidenceLabel, type EvidenceKey } from './presentation';

export interface DecisionBoardProps {
  workspace: DecisionWorkspace;
  /** La questione della sedia (es. il bisogno portato in consiglio). */
  question?: string | null;
  /** La revisione su cui poggia l'atto preparato, se c'è. */
  actRevision?: number | null;
  /** «Trasforma questa proposta in atto»: mai automatico. */
  onPrepareAct?: () => void;
  /** «Rigenera atto» quando la proposta è avanzata. */
  onRegenerateAct?: () => void;
}

function MeasureRow({ measure }: { measure: DecisionMeasure }) {
  return (
    <li className={`decision-measure status-${measure.status}`} data-status={measure.status} data-source={measure.source}>
      <span className="decision-measure-label">{measure.label}</span>
      <span className="decision-measure-value">
        {measure.sharePct !== undefined
          ? `${measure.sharePct}%`
          : measure.value !== undefined
            ? `${measure.value}${measure.unit ? ` ${measure.unit}` : ''}`
            : measure.amount !== undefined
              ? `${measure.amount}${measure.unit ? ` ${measure.unit}` : ''}`
              : ''}
      </span>
      <span className="decision-measure-tags">
        <span className="decision-measure-status">{MEASURE_STATUS_LABEL[measure.status]}</span>
        <span className={`decision-measure-source source-${measure.source}`}>{MEASURE_SOURCE_LABEL[measure.source]}</span>
      </span>
    </li>
  );
}

export function DecisionBoard({
  workspace, question = null, actRevision = null, onPrepareAct, onRegenerateAct,
}: DecisionBoardProps) {
  const proposal = activeProposal(workspace);
  if (!workspace.objective && !proposal) return null;

  const ready = isReadyForAct(workspace);
  const stale = actStaleness(workspace, actRevision);
  const status = workspaceStatus(workspace, actRevision);
  const evidenceRefs = workspace.evidenceIds.filter((id): id is EvidenceKey => (EVIDENCE_KEYS as readonly string[]).includes(id));
  const toDecide = [
    ...(proposal?.unresolvedQuestions ?? []),
    ...(proposal?.measures.filter(measure => measure.status === 'unresolved').map(measure => measure.label) ?? []),
  ];

  return (
    <section className="decision-board" data-status={status} aria-label="Proposta corrente della seduta">
      <header className="decision-head">
        <span className="decision-kicker">La decisione in corso</span>
        <span className="decision-status">{WORKSPACE_STATUS_LABEL[status]}</span>
        <span className="decision-revision">revisione {workspace.revision}</span>
      </header>

      {question && (
        <p className="decision-question">
          <span className="decision-section-label">Questione</span>
          {question}
        </p>
      )}

      {workspace.objective && (
        <p className="decision-objective">
          <span className="decision-section-label">Obiettivo</span>
          {workspace.objective}
        </p>
      )}

      <div className="decision-current">
        <span className="decision-section-label">Proposta corrente</span>
        {proposal && proposal.measures.length > 0 ? (
          <ul className="decision-measures">
            {proposal.measures.map(measure => <MeasureRow key={measure.id} measure={measure} />)}
          </ul>
        ) : (
          <p className="decision-empty">
            Nessuna misura ancora fissata: chiedi al ministro una proposta concreta, oppure indica tu i valori.
          </p>
        )}
      </div>

      {toDecide.length > 0 && (
        <div className="decision-todo">
          <span className="decision-section-label">Da decidere</span>
          <ul>
            {toDecide.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}

      {proposal && (proposal.risks.length > 0 || proposal.expectedEffects.length > 0 || proposal.constraints.length > 0) && (
        <div className="decision-consequences">
          <span className="decision-section-label">Conseguenze e rischi</span>
          <ul>
            {proposal.expectedEffects.map((item, index) => <li key={`e-${index}`} className="decision-effect">Atteso: {item}</li>)}
            {proposal.risks.map((item, index) => <li key={`r-${index}`} className="decision-risk">Rischio: {item}</li>)}
            {proposal.constraints.map((item, index) => <li key={`c-${index}`} className="decision-constraint">Vincolo: {item}</li>)}
          </ul>
        </div>
      )}

      {evidenceRefs.length > 0 && (
        <div className="decision-evidence">
          <span className="decision-section-label">Evidenze a supporto</span>
          <ul>
            {evidenceRefs.map(id => <li key={id}>{evidenceLabel(id)}</li>)}
          </ul>
        </div>
      )}

      {workspace.history.length > 0 && (
        <details className="decision-history">
          <summary className="decision-history-summary">Revisioni ({workspace.history.length})</summary>
          <ol>
            {workspace.history.map(entry => (
              <li key={entry.revision}>
                <span className="decision-history-rev">v{entry.revision}</span>
                <span className="decision-history-text">{entry.summary}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {stale ? (
        <div className="decision-act-stale" role="status">
          <span>
            Atto non più attuale: basato sulla revisione {stale.from}, la proposta è ora alla revisione {stale.to}.
          </span>
          {onRegenerateAct && (
            <button type="button" className="decision-regenerate" onClick={onRegenerateAct}>
              Rigenera atto
            </button>
          )}
        </div>
      ) : status === 'act-prepared' ? (
        <p className="decision-act-current" role="status">
          Atto preparato sulla proposta corrente (revisione {workspace.revision}).
        </p>
      ) : ready ? (
        <div className="decision-act-ready">
          <span>La proposta è sufficientemente definita per diventare atto.</span>
          {onPrepareAct && (
            <button type="button" className="decision-prepare" onClick={onPrepareAct}>
              Trasforma questa proposta in atto
            </button>
          )}
        </div>
      ) : (
        <p className="decision-continue" role="status">
          Continua la discussione: la proposta non è ancora pronta per l’atto.
        </p>
      )}
    </section>
  );
}

export default DecisionBoard;
