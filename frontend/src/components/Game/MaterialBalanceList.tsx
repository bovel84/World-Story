/**
 * World Story — MATERIEL-CLARITY: lista di sintesi del bilancio materiale
 * =====================================================================
 * Presentazione unica e scansionabile: per ogni materiale una riga con
 * disponibilità (dove serve), produzione/mese, consumo/mese, saldo con segno
 * (verde = avanzo, rosso = deficit) e stato.
 *
 * Il dettaglio tecnico non vive qui: le schede tecniche (calibro, gittata…) del
 * Dossier restano disponibili nel blocco «Arsenale», in sezione espandibile.
 * Nessun calcolo: le cifre arrivano dal read model `materialRows`.
 */

import type { MaterialRowView } from './materialBalance';

export function MaterialBalanceList({
  rows,
  showAvailability = true,
  emptyText = 'Il motore non pubblica il bilancio materiale di questa partita.',
}: {
  rows: MaterialRowView[];
  /** false quando la disponibilità è già mostrata altrove nella stessa scheda. */
  showAvailability?: boolean;
  emptyText?: string;
}) {
  if (!rows || rows.length === 0) {
    return <p className="material-balance-empty" role="status">{emptyText}</p>;
  }
  return (
    <ul className="material-balance" aria-label="Bilancio materiale del mese">
      {rows.map(row => (
        <li key={row.kind} className={`material-balance-row state-${row.state}`}>
          <div className="material-balance-name">
            <b>{row.label}</b>
            <span className={`material-balance-state tone-${row.state === 'critico' ? 'negative' : row.state === 'teso' ? 'warning' : row.state === 'al_tetto' ? 'neutral' : row.state === 'ignoto' ? 'neutral' : 'positive'}`}>
              {row.stateLabel}
            </span>
          </div>
          <dl className="material-balance-figures">
            {showAvailability && (
              <div>
                <dt>Disponibilità</dt>
                <dd>{row.availabilityText}</dd>
              </div>
            )}
            <div>
              <dt>Produce</dt>
              <dd>{row.productionText}</dd>
            </div>
            <div>
              <dt>Consuma</dt>
              <dd>{row.consumptionText}</dd>
            </div>
            <div>
              <dt>Saldo</dt>
              <dd className={`tone-${row.balanceTone}`}>{row.balanceText}</dd>
            </div>
          </dl>
          <em className="material-balance-hint">{row.stateHint}</em>
        </li>
      ))}
    </ul>
  );
}
