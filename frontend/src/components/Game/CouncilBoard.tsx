/**
 * WS-GOV-SEAT-BOARDS — La Tavola comune del Consiglio (B25)
 * ========================================================
 * Quando più ministri sono convocati, la loro proposta non si riusa da una sola
 * sedia: le contribuzioni **confluiscono** in una Tavola comune. Ogni riga è una
 * competenza (LAVORI, TESORO, …) letta dal `DecisionWorkspace` vivo di quella
 * sedia — nessuna copia, nessun dato duplicato.
 *
 * La Tavola del Tesoro **non** è la Tavola comune: qui l'aggregazione è il
 * punto, e le sezioni sono quelle delle sedie convocate.
 */
import {
  councilContributions, councilStatus, seatsNotConvened,
  type CouncilLookup, type CouncilWorkspace,
} from './councilWorkspace';
import { seatBoardConfig, type CabinetSeat } from './seatDecisionBoards';

export interface CouncilBoardProps {
  council: CouncilWorkspace;
  /** La lettura del workspace vivo di una sedia. */
  lookup: CouncilLookup;
  /** Convoca un'altra sedia nella riunione. */
  onConveneSeat?: (seat: CabinetSeat) => void;
  /** Apri la seduta di una sedia già convocata (per aggiungere la sua parte). */
  onOpenSeat?: (seat: CabinetSeat) => void;
  /** Chiudi la riunione e torna alla seduta del singolo ministro. */
  onLeaveCouncil?: () => void;
}

const SEAT_SHORT: Record<CabinetSeat, string> = {
  tesoro: 'Tesoro',
  lavori: 'Lavori',
  istruzione: 'Istruzione',
  sanita: 'Sanità',
  esteri: 'Esteri',
  interno: 'Interno',
  guerra: 'Guerra',
};

export function CouncilBoard({ council, lookup, onConveneSeat, onOpenSeat, onLeaveCouncil }: CouncilBoardProps) {
  const contributions = councilContributions(council, lookup);
  const status = councilStatus(council, lookup);
  const convene = onConveneSeat ? seatsNotConvened(council) : [];
  const participants = council.seats.map(seat => SEAT_SHORT[seat]).join(' · ');

  return (
    <section className="council-board" data-status={status} aria-label="Tavola comune del Consiglio">
      <header className="council-board-head">
        <span className="council-board-kicker">Il Consiglio</span>
        <span className="council-board-status">
          {status === 'ready-for-act' ? 'pronta per l’atto' : 'riunione aperta'}
        </span>
        <span className="council-board-revision">revisione {council.revision}</span>
      </header>
      <p className="council-board-participants">
        <span className="council-board-label">Partecipano</span>
        {participants}
      </p>

      {council.objective && (
        <p className="council-board-objective">
          <span className="council-board-label">Piano comune</span>
          {council.objective}
        </p>
      )}

      <div className="council-board-contributions">
        {contributions.map(contribution => (
          <article key={contribution.seat} className="council-contribution" data-seat={contribution.seat}>
            <header className="council-contribution-head">
              <span className="council-contribution-name">{SEAT_SHORT[contribution.seat]}</span>
              <span className="council-contribution-competence">{seatBoardConfig(contribution.seat).competence}</span>
              {onOpenSeat && (
                <button
                  type="button"
                  className="council-contribution-open"
                  onClick={() => onOpenSeat(contribution.seat)}
                  title={`Apri la seduta del ${SEAT_SHORT[contribution.seat]}`}
                >
                  Apri
                </button>
              )}
            </header>
            {contribution.measures.length > 0 ? (
              <ul className="council-contribution-measures">
                {contribution.measures.map(measure => (
                  <li key={measure.id} data-status={measure.status}>
                    <span className={`council-mark council-mark-${measure.status}`} aria-hidden="true">
                      {measure.status === 'accepted' ? '✓' : measure.status === 'rejected' ? '×' : '·'}
                    </span>
                    {measure.sharePct !== undefined
                      ? `${measure.sharePct}% ${measure.label}`
                      : measure.value !== undefined
                        ? `${measure.label}: ${measure.value}${measure.unit ? ` ${measure.unit}` : ''}`
                        : measure.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="council-contribution-empty">Nessuna misura ancora portata.</p>
            )}
            {contribution.unresolved.length > 0 && (
              <ul className="council-contribution-unresolved">
                {contribution.unresolved.map((item, index) => (
                  <li key={`${item}-${index}`}>
                    <span className="council-mark council-mark-unresolved" aria-hidden="true">?</span>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      {convene.length > 0 && onConveneSeat && (
        <div className="council-board-convene">
          <span className="council-board-label">Convoca nel Consiglio</span>
          <div className="council-board-convene-list">
            {convene.map(seat => (
              <button
                key={seat}
                type="button"
                className="council-convene-seat"
                data-seat={seat}
                onClick={() => onConveneSeat(seat)}
              >
                {SEAT_SHORT[seat]}
              </button>
            ))}
          </div>
        </div>
      )}

      {onLeaveCouncil && (
        <button type="button" className="council-board-leave" onClick={onLeaveCouncil}>
          Torna alla seduta del ministro
        </button>
      )}
    </section>
  );
}

export default CouncilBoard;
