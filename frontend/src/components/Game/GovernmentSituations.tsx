/**
 * LEGACY — le card «sfida» non sono più la home del Governo (WS-GOV-REALITY-ADVISOR):
 * la porta è il Primo Consulente con i fatti verificati. Questo componente resta
 * solo per compatibilità dei test e non è montato dalla home.
 */
/**
 * WS-GOV-ADVISOR-HUB — La porta del Governo: le situazioni, non un menu.
 * =====================================================================
 * La home del Governo mostra **cosa preme** e **cosa è tornato da riferire**,
 * con card COMPATTE: i fatti vivono in `[Esamina]`, non in una parete di numeri.
 *
 * Questa vista è un read model: non genera pressioni, non calcola effetti e non
 * decide nulla. Il Consulente le interpreta; il Presidente porta al Consiglio.
 */
import { seatSpeaker } from './councilMeeting';
import type { CabinetSeat } from './seatDecisionBoards';
import type { GovernmentFollowUpView, GovernmentSituationView, PeacetimePressure } from '../../services/api';

export interface GovernmentSituationsProps {
  readonly pressures?: readonly PeacetimePressure[] | null;
  readonly followUps?: readonly GovernmentFollowUpView[] | null;
  readonly onOpen: (situation: GovernmentSituationView) => void;
  readonly onOpenFollowUp?: (followUp: GovernmentFollowUpView) => void;
  /** P5 — Il Presidente vuole che il Consulente entri nel contesto di QUESTA situazione. */
  readonly onExamine?: (situation: GovernmentSituationView) => void;
}

/** Il seguito merita la home solo se è dovuto o imminente (finestra utile). */
const FOLLOW_UP_WINDOW_DAYS = 7;

function isUrgent(situation: GovernmentSituationView): boolean {
  return situation.priority === 'critica' || situation.priority === 'rilevante' || situation.severity >= 2;
}

/** WS-GOV-ADVISOR-HUB P7 — La natura della questione: problema, opportunità, rapporto. */
export type SituationNature = 'problem' | 'opportunity' | 'report';

export function situationNature(situation: GovernmentSituationView): SituationNature {
  if (situation.origin.type === 'previous-decision' || situation.origin.type === 'inaction') return 'report';
  return isUrgent(situation) ? 'problem' : 'opportunity';
}

export function GovernmentSituations({ pressures, followUps, onOpen, onOpenFollowUp, onExamine }: GovernmentSituationsProps) {
  const situations = (pressures ?? [])
    .map(pressure => pressure.situation)
    .filter((situation): situation is GovernmentSituationView => Boolean(situation));
  const due = (followUps ?? []).filter(followUp => followUp.daysLeft <= FOLLOW_UP_WINDOW_DAYS);
  if (situations.length === 0 && due.length === 0) return null;

  // WS-CONSULENTE-SITUAZIONI — Nessun troncamento a 3: si mostrano tutte le
  // situazioni-problema che il read model pubblica.
  const decisions = situations.filter(situation => situationNature(situation) === 'problem');
  const opportunities = situations.filter(situation => situationNature(situation) === 'opportunity');

  const situationCard = (situation: GovernmentSituationView) => (
    <li key={situation.id} className="gov-situation" data-severity={situation.severity}
      data-priority={situation.priority} data-lead={situation.leadMinister}
      data-nature={situationNature(situation)} data-origin={situation.origin.type}>
      <p className="gov-situation-title">{situation.title}</p>
      <p className="gov-situation-meta">
        <span>{seatSpeaker(situation.leadMinister as CabinetSeat)}</span>
        <span>restano {situation.daysLeft} {situation.daysLeft === 1 ? 'giorno' : 'giorni'}</span>
        <span>{situation.source}</span>
      </p>
      <p className="gov-situation-briefing">{situation.briefing}</p>
      <div className="gov-situation-actions">
        {onExamine && <button type="button" className="gov-situation-examine" onClick={() => onExamine(situation)}>Esamina</button>}
        <button type="button" className="gov-situation-open" onClick={() => onOpen(situation)}>Porta al Consiglio</button>
      </div>
      <details className="gov-situation-details">
        <summary>Dettagli</summary>
        {situation.verifiedFacts.length > 0 && (
          <ul className="gov-situation-facts">
            {situation.verifiedFacts.map(fact => <li key={fact}>{fact}</li>)}
          </ul>
        )}
        <p className="gov-situation-question">{situation.decisionQuestion}</p>
        <p className="gov-situation-inaction">Se non decidiamo: {situation.inaction.note}</p>
      </details>
    </li>
  );

  const group = (heading: string, items: readonly GovernmentSituationView[]) => (
    <div className="gov-situations-group">
      <h4>{heading}</h4>
      <ul className="gov-situations-list">{items.map(situationCard)}</ul>
    </div>
  );

  return (
    <section className="government-situations" aria-label="Situazioni del Governo">
      <h3 className="gov-situations-heading">GOVERNO</h3>
      {due.length > 0 && (
        <div className="gov-situations-group" aria-label="Rapporti da leggere">
          <h4>RAPPORTI DA LEGGERE</h4>
          <ul className="gov-situations-list">
            {due.map(followUp => (
              <li key={followUp.id} className="gov-situation gov-follow-up" data-nature="report" data-pressure-id={followUp.pressureId} data-origin={followUp.origin.type}>
                <p className="gov-situation-title">{followUp.label}</p>
                <p className="gov-situation-meta">
                  <span>{seatSpeaker(followUp.owner as CabinetSeat)}</span>
                  <span>{followUp.daysLeft <= 0 ? 'previsto oggi' : `tra ${followUp.daysLeft} ${followUp.daysLeft === 1 ? 'giorno' : 'giorni'}`}</span>
                </p>
                <div className="gov-situation-actions">
                  <button type="button" className="gov-situation-open" disabled={!onOpenFollowUp} onClick={() => onOpenFollowUp?.(followUp)}>Apri rapporto</button>
                </div>
                {followUp.outcome.length > 0 && (
                  <details className="gov-situation-details">
                    <summary>Esiti</summary>
                    <ul className="gov-situation-facts">
                      {followUp.outcome.map(fact => <li key={fact}>{fact}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {decisions.length > 0 && group('PROBLEMI CHE RICHIEDONO DECISIONE', decisions)}
      {opportunities.length > 0 && group('OPPORTUNITÀ', opportunities)}
    </section>
  );
}

export default GovernmentSituations;
