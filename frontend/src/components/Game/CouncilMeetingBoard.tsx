/**
 * WS-GOV-COUNCIL-MEETINGS — La Tavola della riunione (B12)
 * ========================================================
 * La destra della riunione: **una** tavola condivisa, non sette tavole. Mostra
 * il piano per competenza (LAVORI / TESORO), le cose da risolvere, i rischi e
 * gli approfondimenti (chiusi). Ogni riga dichiara la sua **provenienza**: il
 * motore resta l'autorità, il ministro è interprete.
 *
 * Presentazione pura: nessun numero ricalcolato, nessuna prenotazione. L'atto
 * si **prepara** da qui, non si firma qui.
 */
import {
  isMeetingReadyForAct, meetingStatus, seatSpeaker,
  type CouncilMeeting,
} from './councilMeeting';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';

const STATUS_LABEL: Record<ReturnType<typeof meetingStatus>, string> = {
  opening: 'in apertura',
  'gathering-inputs': 'raccolta dati',
  negotiating: 'in negoziato',
  'ready-for-act': 'pronta per l’atto',
  closed: 'chiusa',
};

export interface CouncilMeetingBoardProps {
  meeting: CouncilMeeting;
  /** «Prepara l'atto della riunione»: mai automatico. */
  onPrepareAct?: () => void;
  /** WS-GOV-COUNCIL-MEETINGS (B17) — convocare un'altra sedia nella riunione. */
  onConveneSeat?: (seat: CabinetSeat) => void;
}

export function CouncilMeetingBoard({ meeting, onPrepareAct, onConveneSeat }: CouncilMeetingBoardProps) {
  const status = meetingStatus(meeting);
  const ready = isMeetingReadyForAct(meeting);
  const owners = CABINET_SEATS.filter(seat => meeting.workspace.lines.some(line => line.owner === seat));
  const notConvened = CABINET_SEATS.filter(seat => !meeting.participants.includes(seat));

  return (
    <section className="council-meeting" data-status={status} data-lead={meeting.leadSeat} aria-label="Tavola della riunione">
      <header className="council-meeting-head">
        <span className="council-meeting-kicker">Riunione di Governo</span>
        <span className="council-meeting-status">{STATUS_LABEL[status]}</span>
        <span className="council-meeting-revision">revisione {meeting.revision}</span>
      </header>
      <p className="council-meeting-subject">{meeting.workspace.objective}</p>
      <p className="council-meeting-participants">
        <span className="council-meeting-section-label">Partecipano</span>
        {meeting.participants.map(seat => `${seatSpeaker(seat)}${seat === meeting.leadSeat ? ' (capofila)' : ''}`).join(', ')}
      </p>

      {owners.length > 0 ? (
        <div className="council-meeting-plan">
          {owners.map(owner => (
            <div key={owner} className="council-meeting-competence" data-owner={owner}>
              <span className="council-meeting-competence-label">{seatSpeaker(owner)}</span>
              <ul>
                {meeting.workspace.lines.filter(line => line.owner === owner).map((line, index) => (
                  <li key={`${line.label}-${index}`} className={`council-meeting-line status-${line.status}`} data-status={line.status}>
                    <span className="council-meeting-line-label">{line.label}</span>
                    <span className="council-meeting-line-value">{line.value}</span>
                    <span className="council-meeting-line-source" title={`Fonte: ${line.source}`}>{line.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="council-meeting-empty">Nessun dato ancora letto dal motore: la riunione è in apertura.</p>
      )}

      {meeting.unresolved.length > 0 && (
        <div className="council-meeting-open">
          <span className="council-meeting-section-label">Da risolvere</span>
          <ul>
            {meeting.unresolved.map(item => (
              <li key={item.id} className={item.blocker ? 'is-blocker' : 'is-political'} data-blocker={item.blocker}>
                <span className="council-meeting-req-seat">{seatSpeaker(item.owner)}</span>
                <span>{item.label}</span>
                <span className="council-meeting-req-kind">{item.blocker ? 'blocco del motore' : 'obiezione'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {meeting.workspace.risks.length > 0 && (
        <div className="council-meeting-risks">
          <span className="council-meeting-section-label">Rischi</span>
          <ul>{meeting.workspace.risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul>
        </div>
      )}

      <details className="council-meeting-evidence">
        <summary className="council-meeting-evidence-summary">Evidenze</summary>
        <ul>
          {[...new Set(meeting.contributions.flatMap(contribution => contribution.refs))].map(ref => (
            <li key={ref}>{ref}</li>
          ))}
        </ul>
      </details>

      {notConvened.length > 0 && onConveneSeat && (
        <div className="council-meeting-convene">
          <span className="council-meeting-section-label">Altre competenze</span>
          {notConvened.map(seat => (
            <button key={seat} type="button" className="council-meeting-convene-btn" data-seat={seat} onClick={() => onConveneSeat(seat)}>
              Convoca {seatSpeaker(seat)}
            </button>
          ))}
        </div>
      )}

      <div className="council-meeting-act">
        {ready ? (
          <>
            <span>La riunione ha un piano concordato: può diventare un atto.</span>
            {onPrepareAct && (
              <button type="button" className="council-meeting-prepare" onClick={onPrepareAct}>
                Prepara l’atto della riunione
              </button>
            )}
          </>
        ) : (
          <p className="council-meeting-wait" role="status">
            Prima di preparare l’atto vanno sciolti i blocchi del motore.
          </p>
        )}
      </div>
    </section>
  );
}

export default CouncilMeetingBoard;
