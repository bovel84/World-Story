import { useId, type ReactNode } from 'react';
import { councilOpenQuestions, councilMeasureValue, type CouncilPosition, type CouncilRoomState } from './councilRoom';
import { seatSpeaker } from './councilMeeting';
import {
  activeProposal, MEASURE_SOURCE_LABEL, MEASURE_STATUS_LABEL, type DecisionMeasure,
} from './decisionWorkspace';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';

export interface CouncilRoomBoardProps {
  room: CouncilRoomState;
  busy?: boolean;
  canPrepare?: boolean;
  onConfirm?: () => void;
  onExclude?: (label: string) => void;
  onPrepare?: () => void;
  onConvene?: (seat: CabinetSeat) => void;
  /** P0 — Il Presidente CONFERMA una strada (proposta dai ministri o conosciuta dal motore). */
  onConfirmPressureOption?: (optionId: string) => void;
  /** P0 — Il Presidente ESCLUDE una strada dalla risposta. */
  onExcludePressureOption?: (optionId: string) => void;
  children?: ReactNode;
}

const POSITION_LABEL: Record<CouncilPosition['status'], string> = {
  support: 'Favorevole',
  conditional: 'Favorevole con condizioni',
  oppose: 'Contrario',
  pending: 'In attesa',
};

function MeasureRow({ measure, onExclude, busy }: { measure: DecisionMeasure; onExclude?: (label: string) => void; busy: boolean }) {

  return (
    <li className="council-board-measure" data-status={measure.status} data-source={measure.source}>
      <span className="council-board-measure-label">{measure.label}</span>
      <span className="council-board-measure-value">{councilMeasureValue(measure)}</span>
      <span className="council-board-measure-status">
        {measure.status === 'accepted' ? 'confermata' : MEASURE_STATUS_LABEL[measure.status]}
      </span>
      <span className="council-board-provenance">{MEASURE_SOURCE_LABEL[measure.source]}</span>
      {onExclude && measure.status !== 'rejected' && <button type="button" className="council-board-exclude" disabled={busy} onClick={() => onExclude(measure.label)} aria-label={`Escludi ${measure.label}`}>Escludi</button>}
    </li>
  );
}

/** One question and one live proposal; declarations remain attributed to their speakers. */
export function CouncilRoomBoard({
  room, busy = false, canPrepare = false, onConfirm, onExclude, onPrepare, onConvene, onConfirmPressureOption, onExcludePressureOption, children,
}: CouncilRoomBoardProps) {
  const prepareReasonId = useId();
  const proposal = activeProposal(room.sharedBoard);
  const measures = proposal?.measures ?? [];
  const hasProposedMeasures = measures.some(measure => measure.status === 'proposed');
  const hasDraftableMeasures = measures.some(measure => measure.status === 'proposed' || measure.status === 'accepted');
  const agreements = CABINET_SEATS.flatMap(seat =>
    (room.assessments[seat]?.agreements ?? []).map(text => ({ seat, text })),
  );
  const openQuestions = councilOpenQuestions(room);
  const invitations = room.invitations.filter(invitation => !room.participants.includes(invitation.minister));
  const prepareReason = !hasDraftableMeasures
    ? 'Nessuna misura definita: indica una proposta concreta prima di preparare la bozza comune.'
    : busy
      ? 'Attendi la fine dell’intervento in corso.'
      : !canPrepare
        ? 'Continua la discussione prima di preparare la bozza comune.'
        : !onPrepare
          ? 'Preparazione della bozza comune non disponibile.'
          : null;

  return (
    <section className="council-room-board" aria-label="Tavola del Consiglio" aria-busy={busy}
      data-room-id={room.id} data-phase={room.phase}>
      <header className="council-board-header">
        <h2>Tavola del Consiglio</h2>
        <span className="council-board-revision">revisione {room.sharedBoard.revision}</span>
      </header>

      {room.sourceFollowUp && (
        <section className="council-board-section council-board-follow-up" aria-label="RAPPORTO" data-pressure-id={room.sourceFollowUp.pressureId}>
          <h3>RAPPORTO</h3>
          <p className="council-board-situation-title">{room.sourceFollowUp.label}</p>
          <p className="council-board-situation-meta">Relatore: {seatSpeaker(room.sourceFollowUp.owner)} · previsto per {room.sourceFollowUp.dueDate}</p>
          {room.sourceFollowUp.outcome.length > 0 && (
            <ul className="council-board-situation-facts">
              {room.sourceFollowUp.outcome.map(fact => <li key={fact}>{fact}</li>)}
            </ul>
          )}
          <p className="council-board-situation-origin">
            Origine: una decisione precedente{room.sourceFollowUp.originDecision ? ` — ${room.sourceFollowUp.originDecision}` : ''}.
          </p>
          {room.sourceFollowUp.checks.length > 0 && (
            <details className="council-board-response-options">
              <summary>Verifiche del rapporto</summary>
              <ul className="council-board-response-list">
                {room.sourceFollowUp.checks.map(check => <li key={check}>{check}</li>)}
              </ul>
            </details>
          )}
        </section>
      )}

      {room.sourceSituation && (
        <section className="council-board-section council-board-situation" aria-label="SITUAZIONE" data-pressure-id={room.sourceSituation.pressureId}>
          <h3>SITUAZIONE</h3>
          <p className="council-board-situation-title">{room.sourceSituation.title}</p>
          <p className="council-board-situation-meta">Fonte: {room.sourceSituation.source} · restano {room.sourceSituation.daysLeft} {room.sourceSituation.daysLeft === 1 ? 'giorno' : 'giorni'}</p>
          {room.sourceSituation.verifiedFacts.length > 0 && (
            <ul className="council-board-situation-facts">
              {room.sourceSituation.verifiedFacts.map(fact => <li key={fact}>{fact}</li>)}
            </ul>
          )}
          <p className="council-board-situation-inaction">Se non decidiamo: {room.sourceSituation.inaction.note}</p>
          {room.sourceSituation.origin.type !== 'state' && (
            <p className="council-board-situation-origin" data-origin={room.sourceSituation.origin.type}>
              Origine della situazione: {room.sourceSituation.origin.type === 'inaction' ? 'una mancata decisione' : 'una decisione precedente'}.
            </p>
          )}
          <section className="council-board-decision" aria-label="DECISIONE DA PRENDERE">
            <h4>DECISIONE DA PRENDERE</h4>
            <p>{room.sourceSituation.decisionQuestion}</p>
          </section>
          <section className="council-board-proposals" aria-label="PROPOSTE DEI MINISTRI">
            <h4>PROPOSTE DEI MINISTRI</h4>
            {room.proposedPressureOptions.length > 0 ? (
              <ul className="council-board-response-list">
                {room.proposedPressureOptions.map(proposal => {
                  const option = room.sourceSituation?.options.find(candidate => candidate.id === proposal.optionId);
                  if (!option) return null;
                  const confirmed = room.selectedPressureOptions.includes(proposal.optionId);
                  return (
                    <li key={proposal.optionId} className="council-board-minister-proposal" data-option={proposal.optionId} data-confirmed={confirmed}>
                      <span className="council-board-proposal-label">○ {option.label}</span>
                      <span className="council-board-proposal-by">proposto da {seatSpeaker(proposal.proposedBy)}</span>
                      {!confirmed && onConfirmPressureOption && (
                        <button type="button" className="council-board-response-toggle" disabled={busy} onClick={() => onConfirmPressureOption(proposal.optionId)} aria-label={`Conferma ${option.label}`}>Conferma</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="council-board-empty">Nessuna proposta dai ministri: discutete, e le strade emergeranno.</p>
            )}
          </section>
          <section className="council-board-response" aria-label="RISPOSTA DEL PRESIDENTE">
            <h4>RISPOSTA DEL PRESIDENTE</h4>
            {room.selectedPressureOptions.length > 0 ? (
              <ul className="council-board-response-list">
                {room.selectedPressureOptions.map(optionId => {
                  const option = room.sourceSituation?.options.find(candidate => candidate.id === optionId);
                  if (!option) return null;
                  return (
                    <li key={optionId} className="council-board-response-picked" data-option={optionId}>
                      <span>✓ {option.label}</span>
                      {onExcludePressureOption && <button type="button" className="council-board-response-toggle" disabled={busy} onClick={() => onExcludePressureOption(optionId)} aria-label={`Escludi ${option.label}`}>Escludi</button>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="council-board-empty">Nessuna strada confermata: solo il Presidente conferma le misure.</p>
            )}
            <details className="council-board-response-options">
              <summary>Corsi d’azione conosciuti dal motore</summary>
              <ul className="council-board-response-list">
                {room.sourceSituation.options.map(option => {
                  const selected = room.selectedPressureOptions.includes(option.id);
                  return (
                    <li key={option.id} data-option={option.id} data-selected={selected}>
                      <button type="button" className="council-board-response-toggle" disabled={busy || !onConfirmPressureOption} onClick={() => onConfirmPressureOption?.(option.id)}>
                        {selected ? '✓ ' : '+ '}{option.label}
                      </button>
                      <span className="council-board-response-detail">{option.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        </section>
      )}

      <section className="council-board-section council-board-question" aria-label="QUESTIONE">
        <h3>QUESTIONE</h3>
        <p>{room.topic || room.sharedBoard.objective || room.sharedBoard.problem || 'Questione da definire con il Presidente.'}</p>
      </section>

      <section className="council-board-section council-board-proposal" aria-label="PROPOSTA ATTUALE">
        <h3>PROPOSTA ATTUALE</h3>
        {measures.length > 0 ? (
          <ul className="council-board-list">
            {measures.map(measure => <MeasureRow key={measure.id} measure={measure} onExclude={onExclude} busy={busy} />)}
          </ul>
        ) : (
          <p className="council-board-empty">Nessuna misura ancora proposta: porta una proposta concreta nella discussione.</p>
        )}
      </section>

      <section className="council-board-section council-board-agreements" aria-label="ACCORDI DICHIARATI">
        <h3>ACCORDI DICHIARATI</h3>
        {agreements.length > 0 ? (
          <ul className="council-board-list">
            {agreements.map(({ seat, text }, index) => (
              <li key={`${seat}-${index}`} className="council-board-agreement" data-seat={seat}>
                <span className="council-board-provenance">{seatSpeaker(seat)}: </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="council-board-empty">Nessun accordo ancora dichiarato dai ministri.</p>
        )}
      </section>

      <section className="council-board-section council-board-open-questions" aria-label="QUESTIONI APERTE">
        <h3>QUESTIONI APERTE</h3>
        {openQuestions.length > 0 || invitations.length > 0 ? (
          <ul className="council-board-list">
            {openQuestions.map(question => {
              const dissenters = room.participants.filter(seat => room.assessments[seat]?.disagreements.includes(question));
              return (
                <li key={question} className="council-board-open-question">
                  <span>{question}</span>
                  {dissenters.length > 0 ? (
                    <span className="council-board-provenance">
                      {' · Dissenso dichiarato da '}{dissenters.map(seatSpeaker).join(', ')}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {invitations.map(invitation => (
              <li key={invitation.id} className="council-board-invitation" data-minister={invitation.minister}>
                <p className="council-board-provenance">
                  Parere richiesto a {seatSpeaker(invitation.minister)} da {seatSpeaker(invitation.from)}
                </p>
                <p>{invitation.question}</p>
                <button type="button" className="council-board-convene" disabled={busy || !onConvene}
                  onClick={() => onConvene?.(invitation.minister)}>
                  Convoca {seatSpeaker(invitation.minister)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="council-board-empty">Nessuna questione aperta dichiarata.</p>
        )}
      </section>

      <section className="council-board-section council-board-positions" aria-label="POSIZIONI">
        <h3>POSIZIONI</h3>
        <ul className="council-board-list">
          {room.participants.map(seat => {
            const position = room.positions[seat];
            const status = position?.status ?? 'pending';
            const stale = position !== undefined && position.revision < room.sharedBoard.revision;
            return (
              <li key={seat} className="council-board-position" data-seat={seat} data-status={status}
                data-revision={position?.revision} data-stale={stale}>
                <span className="council-board-position-speaker">{seatSpeaker(seat)}</span>
                <span className="council-board-position-status">{POSITION_LABEL[status]}</span>
                <p className="council-board-position-reason">{position?.reason || 'Non ha ancora dichiarato una posizione.'}</p>
                {stale ? (
                  <p className="council-board-position-stale">
                    Da aggiornare: posizione riferita alla revisione {position.revision}; proposta alla revisione {room.sharedBoard.revision}.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="council-board-actions">
        {hasProposedMeasures ? (
          <>
            <button type="button" className="council-board-confirm" disabled={busy || !onConfirm} onClick={onConfirm}>
              Conferma proposta
            </button>
            <p className="council-board-action-note">
              La conferma del Presidente non chiude le questioni aperte e non sostituisce i pareri dei ministri.
            </p>
          </>
        ) : null}
        <button type="button" className="council-board-prepare" disabled={prepareReason !== null}
          aria-describedby={prepareReason ? prepareReasonId : undefined} onClick={onPrepare}>
          Prepara bozza comune
        </button>
        {prepareReason ? <p id={prepareReasonId} className="council-board-action-reason">{prepareReason}</p> : null}
      </div>

      {children}
    </section>
  );
}

export default CouncilRoomBoard;
