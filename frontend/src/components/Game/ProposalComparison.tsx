/**
 * WS-MINISTER-UX-03 — Il confronto tra le proposte
 * ===============================================
 * Quando il Presidente dice «confronta le due strade», la tavola non ripete una
 * lista: mette **fianco a fianco** ciò che il motore ha già dichiarato per
 * ciascuna strada — costo immediato, guadagno atteso, se è la raccomandata — con
 * le stesse cifre dell'atto, senza ricalcolare nulla e senza inventare effetti
 * sociali.
 *
 * Non firma: l'ordine nasce dall'atto del Tesoro, che resta il punto unico della
 * coda. Qui si **confronta**, che è ciò che il ministro ha promesso di fare.
 */
import type { TreasuryRoad } from './treasuryAct';

export interface ProposalComparisonProps {
  roads: TreasuryRoad[];
}

export function ProposalComparison({ roads }: ProposalComparisonProps) {
  // Al massimo due strade: la raccomandata e la sua alternativa reale. Se ce ne
  // sono di più, si prendono le prime due nell'ordine dichiarato dal motore.
  const shown = roads.slice(0, 2);
  return (
    <section className="proposal-comparison" aria-label="Confronto tra le proposte">
      <header className="proposal-comparison-head">
        <span className="seat-table-kicker">Confronto</span>
        <span className="seat-table-note">
          Le strade dichiarate dal motore, con costo e guadagno atteso. Le firma il Presidente dall’atto.
        </span>
      </header>
      {shown.length === 0 ? (
        <p className="proposal-comparison-empty">
          Nessuna alternativa dichiarata per questa sedia: la tavola non ne inventa una.
        </p>
      ) : (
        <div className={`proposal-comparison-grid${shown.length === 1 ? ' single' : ''}`}>
          {shown.map(road => (
            <article key={road.id} className={`proposal-card${road.recommended ? ' recommended' : ''}`}>
              <div className="proposal-card-head">
                <h4>{road.title}</h4>
                {road.recommended && <span className="proposal-badge">raccomandata</span>}
              </div>
              <p className="proposal-voice">{road.voice}</p>
              <dl className="proposal-figures">
                <div>
                  <dt>Costo immediato</dt>
                  <dd>{road.declaredCost}</dd>
                </div>
                <div>
                  <dt>Guadagno atteso</dt>
                  <dd>{road.expectedGain}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default ProposalComparison;
