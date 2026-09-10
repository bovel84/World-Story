import React, { useRef, useEffect } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';

export interface FeasibilityResult {
  feasible: boolean;
  cost: { money: number; manpower: number; timeDays: number };
  prerequisites: string[];
  risks: string[];
  warnings: string[];
  summary: string;
  rawAssessment?: any;
}

interface FeasibilityCheckProps {
  /** Risultato verifica (null = in attesa) */
  result: FeasibilityResult | null;
  /** True durante la chiamata API */
  loading: boolean;
  /** Errore tecnico */
  error: string | null;
  /** Testo ordine verificato (per rigenerare) */
  orderText: string;
  /** Chiudi senza registrare */
  onClose: () => void;
  /** Registra l'ordine (chiama queueAction) */
  onRegister: () => void;
  /** Torna alla bozza per modificare */
  onBack: () => void;
  /** Richiama verifica dopo modifica */
  onReverify: () => void;
}

export function FeasibilityCheck({
  result,
  loading,
  error,
  orderText,
  onClose,
  onRegister,
  onBack,
  onReverify,
}: FeasibilityCheckProps) {
  const registerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    registerButtonRef.current?.focus({ preventScroll: true });
  }, [result]);

  if (!result && !loading && !error) return null;

  const statusColor = result?.feasible
    ? 'var(--ws-success, #22c55e)'
    : 'var(--ws-danger, #9F3028)';
  const statusIcon = result?.feasible ? '✓' : '✕';
  const statusText = result?.feasible ? 'Fattibile' : 'Non fattibile';

  return (
    <AccessibleDialog
      open={true}
      onClose={onClose}
      overlayClassName="feasibility-overlay"
      className="feasibility-check"
      ariaLabel="Verifica fattibilità ordine"
      initialFocusRef={registerButtonRef}
      closeOnBackdrop={false}
      closeOnEscape={true}
    >
      <header className="feasibility-header">
        <h2 className="feasibility-title">
          <span className="feasibility-status" style={{ color: statusColor }}>
            {statusIcon} {statusText}
          </span>
          Verifica fattibilità
        </h2>
        <button type="button" className="feasibility-close" onClick={onClose} aria-label="Chiudi verifica">×</button>
      </header>

      {loading && (
        <div className="feasibility-loading" role="status" aria-live="polite">
          <span className="feasibility-spinner" aria-hidden="true" />
          Analisi in corso…
        </div>
      )}

      {error && !loading && (
        <div className="feasibility-error" role="alert">
          Impossibile verificare: {error}
          <button type="button" onClick={onReverify} className="btn-reverify">Riprova</button>
        </div>
      )}

      {result && !loading && (
        <div className="feasibility-content">
          <div className="feasibility-summary">
            <p>{result.summary}</p>
          </div>

          <section className="feasibility-section">
            <h3 className="feasibility-section-title">Costi stimati</h3>
            <dl className="feasibility-costs">
              <div><dt>Denaro</dt><dd>{result.cost.money.toLocaleString('it-IT')}</dd></div>
              <div><dt>Manodopera</dt><dd>{result.cost.manpower.toLocaleString('it-IT')}</dd></div>
              <div><dt>Tempo</dt><dd>{result.cost.timeDays} {result.cost.timeDays === 1 ? 'giorno' : 'giorni'}</dd></div>
            </dl>
          </section>

          {result.prerequisites.length > 0 && (
            <section className="feasibility-section">
              <h3 className="feasibility-section-title">Prerequisiti</h3>
              <ul className="feasibility-list feasibility-prereqs">
                {result.prerequisites.map((req, i) => (
                  <li key={i}><span className="feasibility-checkmark" aria-hidden="true">✓</span>{req}</li>
                ))}
              </ul>
            </section>
          )}

          {result.risks.length > 0 && (
            <section className="feasibility-section">
              <h3 className="feasibility-section-title">Rischi</h3>
              <ul className="feasibility-list feasibility-risks">
                {result.risks.map((risk, i) => (
                  <li key={i}><span className="feasibility-warning" aria-hidden="true">⚠</span>{risk}</li>
                ))}
              </ul>
            </section>
          )}

          {result.warnings.length > 0 && (
            <section className="feasibility-section">
              <h3 className="feasibility-section-title">Avvisi</h3>
              <ul className="feasibility-list feasibility-warnings">
                {result.warnings.map((warn, i) => (
                  <li key={i}><span className="feasibility-info" aria-hidden="true">ℹ</span>{warn}</li>
                ))}
              </ul>
            </section>
          )}

          <footer className="feasibility-actions">
            <button type="button" className="btn-feasibility-back" onClick={onBack} disabled={loading}>Indietro</button>
            <button
              ref={registerButtonRef}
              type="button"
              className={`btn-feasibility-register${result.feasible ? '' : ' disabled'}`}
              onClick={onRegister}
              disabled={loading || !result.feasible}
            >
              {result.feasible ? 'Registra ordine' : 'Non registrabile'}
            </button>
          </footer>
        </div>
      )}
    </AccessibleDialog>
  );
}

export default FeasibilityCheck;