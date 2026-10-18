import { useEffect, useRef, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { publicNarrativeText } from '../../services/publicNarrative';
import type { CheckpointImpact } from './checkpointImpact';
import { DecisionImpactBlock } from './DecisionImpactBlock';
import { compactEventText } from './compactEventText';
import type { DecisionRecord } from './decisionImpact';
import './simulationEventReader.css';

/** L'ancora canonica della pagina in lettura (§9.3/G22). */
export interface PlaybackReaderState {
  simulationId: string;
  event: { id: string; date: string; headline: string; detail: string; source: string };
  /** Checkpoint persistito da cui è stata materializzata la pagina. */
  checkpointId?: string;
  /** Revisione crescente: protegge Intervieni da un controllo stantio. */
  revision?: number;
  remaining: number;
  destination: string;
  /** Solo checkpoint canonici già letti; le proposte future restano segrete. */
  disclosedEvents?: Array<{ id: string; date: string; headline: string; detail: string; source: string }>;
}

interface SimulationEventReaderProps {
  playback: PlaybackReaderState;
  loading: boolean;
  onContinue: () => void;
  onIntervene: () => void;
  playerPolityName?: string;
  locationLabel?: string;
  /**
   * LW06.1 / MIGLIORIA 2 — variazioni REALI del periodo del checkpoint,
   * derivate dallo storico del motore. Solo presentazione: la semantica del
   * checkpoint (revision, simulationId, continue/intervene) resta invariata.
   * `null`/assente = nessun effetto disponibile, nessun testo inventato.
   */
  impact?: CheckpointImpact | null;
  /**
   * DECISION-IMPACT — le decisioni del turno in lettura con l'effetto misurato
   * dal motore. Assente = nessun effetto attribuibile: resta la sola variazione
   * del periodo (nessun importo inventato).
   */
  decisions?: readonly DecisionRecord[];
}

/**
 * G22 — Lettore della sessione attiva, distinto dall'archivio EventFeed.
 *
 * Questo non è una voce della cronaca: rappresenta l'unico checkpoint che il
 * giocatore sta leggendo e che può ancora governare. La sua ancora
 * eventId/revision è passata a «Intervieni qui» per evitare mutazioni su una
 * pagina ormai superata da un altro comando.
 */
export function SimulationEventReader({
  playback,
  loading,
  onContinue,
  onIntervene,
  playerPolityName,
  locationLabel,
  impact = null,
  decisions = [],
}: SimulationEventReaderProps) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedCheckpoint, setExpandedCheckpoint] = useState<string | null>(null);

  // Keep the keyboard action available on each newly disclosed event.
  useEffect(() => {
    continueButtonRef.current?.focus({ preventScroll: true });
    document.getElementById('simulation-event-reader')?.scrollTo(0, 0);
  }, [playback.event.id, playback.revision]);

  // Read only the current disclosed checkpoint, never the future queue.
  const event = playback.event;
  const firstEventDate = playback.disclosedEvents?.[0]?.date ?? event.date;
  const checkpointKey = `${event.id}:${playback.revision ?? 0}`;
  const expanded = expandedCheckpoint === checkpointKey;
  const headline = compactEventText(publicNarrativeText(event.headline, playerPolityName), 105);
  const detail = compactEventText(publicNarrativeText(event.detail, playerPolityName), 240);
  const canExpand = headline.shortened || detail.shortened;

  return (
    <AccessibleDialog
      open={true}
      onClose={() => undefined}
      overlayClassName="simulation-reader-scrim"
      className="simulation-event-reader"
      id="simulation-event-reader"
      ariaLabel="Lettore della sessione attiva"
      ariaLive="polite"
      initialFocusRef={continueButtonRef}
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
        <header className="simulation-reader-header">
          <div className="simulation-reader-heading">
            <span className="simulation-reader-kicker">Timeline del salto</span>
            <strong>dal {firstEventDate}</strong>
          </div>
          {locationLabel && <span className="simulation-reader-location">{locationLabel}</span>}
        </header>

        <ol className="simulation-reader-events" data-checkpoint-id={playback.checkpointId}>
          <li key={event.id} className="simulation-reader-event is-current">
            <article>
              <time>{event.date}</time>
              <h3>{expanded ? publicNarrativeText(event.headline, playerPolityName) : headline.text}</h3>
              {event.detail && <p>{expanded ? publicNarrativeText(event.detail, playerPolityName) : detail.text}</p>}
              {canExpand && <button type="button" className="simulation-reader-more" aria-expanded={expanded}
                onClick={() => setExpandedCheckpoint(expanded ? null : checkpointKey)}>
                {expanded ? 'Mostra meno' : 'Leggi tutto'}
              </button>}
            </article>
          </li>
        </ol>

        {(impact?.hasChanges || decisions.length > 0) && <details key={event.id} className="simulation-reader-effects">
          <summary>Conseguenze registrate</summary>
        {impact && impact.hasChanges && (
          // Dicitura NON causale: il motore conosce il delta del periodo, non
          // l'attribuzione al singolo evento. Nessuna frase di causalità forte.
          <section className="simulation-reader-impact" aria-label="Variazioni registrate nel periodo">
            <h4>Variazioni registrate nel periodo</h4>
            <ul className="simulation-reader-impact-list">
              {impact.deltas.slice(0, 6).map(delta => (
                <li key={delta.id} className={`tone-${delta.tone}`}>
                  <span>{delta.label}</span>
                  <b>{delta.text}</b>
                </li>
              ))}
            </ul>
            <small>Delta del turno dai conti registrati dal motore; non un giudizio di causa.</small>
          </section>
        )}

        {/* DECISION-IMPACT: quanto hanno inciso le scelte del giocatore, con
            l'effetto attribuito dal motore al momento dell'esecuzione. */}
        <DecisionImpactBlock decisions={decisions} turnImpact={impact} className="simulation-reader-decision-impact" />

        </details>}

        <footer className="simulation-reader-actions">
          <button ref={continueButtonRef} type="button" className="btn-continue-next" onClick={onContinue} disabled={loading}>
            {playback.remaining > 0
              ? 'Evento successivo'
              : `Procedi fino al ${playback.destination}`}
          </button>
          <button
            type="button"
            className="btn-intervene"
            onClick={onIntervene}
            disabled={loading}
            title="Ferma il tempo a questa notizia e apre il governo per decidere come rispondere"
          >
            Intervieni nel governo
          </button>
        </footer>
    </AccessibleDialog>
  );
}
