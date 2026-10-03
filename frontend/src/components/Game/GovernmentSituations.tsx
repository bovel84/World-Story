/**
 * WS-GOV-SITUATIONS — La porta del Governo: le situazioni, non un menu
 * ====================================================================
 * La schermata iniziale del Governo non deve chiedere solo «scegli un
 * ministro». Deve mostrare **cosa preme sul paese adesso**, con i fatti del
 * motore e il ministro competente, e **cosa è tornato da riferire** dopo una
 * decisione. Da qui il Presidente apre la Sala del Consiglio sulla questione.
 *
 * Questa vista è un **read model**: non genera pressioni, non calcola effetti e
 * non decide nulla. Le opportunità stanno separate dalle urgenze; i seguiti
 * mostrano solo quelli dovuti o prossimi, mai una pila di scadenze lontane.
 */
import { seatSpeaker } from './councilMeeting';
import type { CabinetSeat } from './seatDecisionBoards';
import type { GovernmentFollowUpView, GovernmentSituationView, PeacetimePressure } from '../../services/api';

export interface GovernmentSituationsProps {
  readonly pressures?: readonly PeacetimePressure[] | null;
  readonly followUps?: readonly GovernmentFollowUpView[] | null;
  readonly onOpen: (situation: GovernmentSituationView) => void;
  readonly onOpenFollowUp?: (followUp: GovernmentFollowUpView) => void;
}

/** Il seguito merita la home solo se è dovuto o imminente (finestra utile). */
const FOLLOW_UP_WINDOW_DAYS = 7;

function isUrgent(situation: GovernmentSituationView): boolean {
  return situation.priority === 'critica' || situation.priority === 'rilevante' || situation.severity >= 2;
}

/** Le situazioni del Governo: prima ciò che richiede una decisione, poi il resto. */
export function GovernmentSituations({ pressures, followUps, onOpen, onOpenFollowUp }: GovernmentSituationsProps) {
  const situations = (pressures ?? [])
    .map(pressure => pressure.situation)
    .filter((situation): situation is GovernmentSituationView => Boolean(situation));
  const due = (followUps ?? []).filter(followUp => followUp.daysLeft <= FOLLOW_UP_WINDOW_DAYS);
  if (situations.length === 0 && due.length === 0) return null;

  const decisions = situations.filter(isUrgent).slice(0, 3);
  const opportunities = situations.filter(situation => !isUrgent(situation));

  const render = (situation: GovernmentSituationView) => (
    <li key={situation.id} className="gov-situation" data-severity={situation.severity}
      data-priority={situation.priority} data-lead={situation.leadMinister}
      data-origin={situation.origin.type}>
      <p className="gov-situation-title">{situation.title}</p>
      <p className="gov-situation-meta">
        <span>{seatSpeaker(situation.leadMinister as CabinetSeat)}</span>
        <span>restano {situation.daysLeft} {situation.daysLeft === 1 ? 'giorno' : 'giorni'}</span>
        <span>{situation.source}</span>
      </p>
      <p className="gov-situation-briefing">{situation.briefing}</p>
      {situation.verifiedFacts.length > 0 && (
        <ul className="gov-situation-facts">
          {situation.verifiedFacts.map(fact => <li key={fact}>{fact}</li>)}
        </ul>
      )}
      <p className="gov-situation-question">{situation.decisionQuestion}</p>
      <p className="gov-situation-inaction">Se non decidiamo: {situation.inaction.note}</p>
      <button type="button" className="gov-situation-open" onClick={() => onOpen(situation)}>Apri Consiglio</button>
    </li>
  );

  return (
    <section className="government-situations" aria-label="Situazioni del Governo">
      <h3 className="gov-situations-heading">GOVERNO</h3>
      {due.length > 0 && (
        <div className="gov-situations-group" aria-label="Da riferire">
          <h4>DA RIFERIRE</h4>
          <ul className="gov-situations-list">
            {due.map(followUp => (
              <li key={followUp.id} className="gov-situation gov-follow-up" data-pressure-id={followUp.pressureId} data-origin={followUp.origin.type}>
                <p className="gov-situation-title">{followUp.label}</p>
                <p className="gov-situation-meta">
                  <span>{seatSpeaker(followUp.owner as CabinetSeat)}</span>
                  <span>{followUp.daysLeft <= 0 ? 'previsto oggi' : `tra ${followUp.daysLeft} ${followUp.daysLeft === 1 ? 'giorno' : 'giorni'}`}</span>
                </p>
                {followUp.outcome.length > 0 && (
                  <ul className="gov-situation-facts">
                    {followUp.outcome.map(fact => <li key={fact}>{fact}</li>)}
                  </ul>
                )}
                <button type="button" className="gov-situation-open" disabled={!onOpenFollowUp} onClick={() => onOpenFollowUp?.(followUp)}>Apri rapporto</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {decisions.length > 0 && (
        <div className="gov-situations-group">
          <h4>RICHIEDE UNA DECISIONE</h4>
          <ul className="gov-situations-list">{decisions.map(render)}</ul>
        </div>
      )}
      {opportunities.length > 0 && (
        <div className="gov-situations-group">
          <h4>OPPORTUNITÀ</h4>
          <ul className="gov-situations-list">{opportunities.map(render)}</ul>
        </div>
      )}
    </section>
  );
}

export default GovernmentSituations;
