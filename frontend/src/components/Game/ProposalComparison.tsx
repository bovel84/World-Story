/**
 * WS-MINISTER-UX-04 — Il confronto tra le proposte e le loro conseguenze
 * ======================================================================
 * Quando il Presidente dice «confronta le due strade», la tavola mette fianco a
 * fianco le strade del motore su **le stesse dimensioni** — costo immediato,
 * spesa ricorrente, tempi, copertura, vincoli, benefici, incertezza — e dichiara
 * per ciascuna la provenienza. Poi mostra la **catena delle conseguenze**
 * (finanziamento → opera → servizio → società) distinguendo ciò che il motore
 * simula da ciò che il catalogo dichiara e da ciò che non è simulato affatto.
 *
 * Non firma e non calcola: l'ordine nasce dall'atto del Tesoro, i numeri dal
 * `consequences.ts`.
 */
import {
  COMPARISON_DIMENSIONS, compareRoads, countUnavailable, SOCIAL_EFFECTS_NOTE,
  type ConsequenceBasis, type ConsequenceStep, type RoadComparison,
} from './consequences';
import type { TreasuryRoad } from './treasuryAct';

const BASIS_LABEL: Record<ConsequenceBasis, string> = {
  measured: 'misurato',
  estimated: 'stimato',
  declared: 'dichiarato',
  unavailable: 'non dichiarato',
};

const KIND_LABEL: Record<ConsequenceStep['kind'], string> = {
  simulated: 'simulato dal motore',
  declared: 'dichiarato dal catalogo',
  'not-simulated': 'non simulato',
};

export interface ProposalComparisonProps {
  roads: TreasuryRoad[];
}

export function ProposalComparison({ roads }: ProposalComparisonProps) {
  // Al massimo due strade: la raccomandata e la sua alternativa reale.
  const comparison: RoadComparison[] = compareRoads(roads.slice(0, 2));
  const missing = countUnavailable(comparison);

  return (
    <section className="proposal-comparison" aria-label="Confronto tra le proposte">
      <header className="proposal-comparison-head">
        <span className="seat-table-kicker">Confronto</span>
        <span className="seat-table-note">
          Le stesse dimensioni per ogni strada, ciascuna con la sua provenienza. Le firma il Presidente dall’atto.
        </span>
      </header>

      {comparison.length === 0 ? (
        <p className="proposal-comparison-empty">
          Nessuna alternativa dichiarata per questa sedia: la tavola non ne inventa una.
        </p>
      ) : (
        <>
          <div className={`proposal-comparison-grid${comparison.length === 1 ? ' single' : ''}`}>
            {comparison.map(road => (
              <article key={road.roadId} className={`proposal-card${road.recommended ? ' recommended' : ''}`}>
                <div className="proposal-card-head">
                  <h4>{road.title}</h4>
                  {road.recommended && <span className="proposal-badge">raccomandata</span>}
                </div>
                <p className="proposal-voice">{road.voice}</p>
                <dl className="proposal-figures">
                  {COMPARISON_DIMENSIONS.map(dimension => {
                    const cell = road.cells[dimension.id];
                    return (
                      <div key={dimension.id} className={`proposal-row basis-${cell.basis}`}>
                        <dt>{dimension.label}</dt>
                        <dd>
                          <span className="proposal-value">{cell.value}</span>
                          <span className={`proposal-basis proposal-basis-${cell.basis}`}>{BASIS_LABEL[cell.basis]}</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>

          <div className="proposal-flows">
            {comparison.map(road => (
              <div key={road.roadId} className="proposal-flow">
                <h5 className="proposal-flow-title">{road.title}</h5>
                <ol className="proposal-flow-steps">
                  {road.flow.map((step, index) => (
                    <li key={`${road.roadId}-${index}`} className={`proposal-flow-step kind-${step.kind}`}>
                      <span className="proposal-flow-label">{step.label}</span>
                      <span className={`proposal-flow-kind proposal-flow-kind-${step.kind}`}>{KIND_LABEL[step.kind]}</span>
                      <span className="proposal-flow-detail">{step.detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <p className="proposal-comparison-note">
            {missing > 0
              ? `${missing} dimensioni su ${comparison.length * COMPARISON_DIMENSIONS.length} non sono dichiarate dal motore. `
              : ''}
            {SOCIAL_EFFECTS_NOTE}
          </p>
        </>
      )}
    </section>
  );
}

export default ProposalComparison;
