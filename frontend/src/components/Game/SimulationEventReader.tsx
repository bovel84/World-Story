import { useEffect, useRef } from 'react';

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
}: SimulationEventReaderProps) {
  const readerRef = useRef<HTMLElement>(null);

  // Quando arriva una nuova pagina, rendiamo disponibile al lettore di
  // tastiera il punto decisionale senza spostare la mappa o la cronaca.
  useEffect(() => {
    readerRef.current?.focus({ preventScroll: true });
  }, [playback.event.id, playback.revision]);

  const checkpointLabel = playback.revision != null
    ? `Revisione ${playback.revision}`
    : 'Checkpoint registrato';

  // Il lettore conserva solo le pagine già autorizzate. In particolare non
  // riceve né rende inferibile il contenuto di `remainingEvents` nel run.
  const disclosed = (playback.disclosedEvents?.length
    ? playback.disclosedEvents
    : [playback.event]).filter((event, index, all) =>
      all.findIndex(candidate => candidate.id === event.id) === index,
    );

  return (
    <div className="simulation-reader-scrim" role="presentation">
      <section
        ref={readerRef}
        id="simulation-event-reader"
        className="simulation-event-reader"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Lettore della sessione attiva"
        aria-live="polite"
      >
        <header className="simulation-reader-header">
          <div className="simulation-reader-heading">
            <span className="simulation-reader-kicker">Timeline del salto</span>
            <strong>dal {disclosed[0]?.date || playback.event.date}</strong>
          </div>
          <div className="simulation-reader-anchor" title={playback.checkpointId ? `Checkpoint ${playback.checkpointId}` : undefined}>
            {checkpointLabel}
          </div>
        </header>

        <div className="simulation-reader-progress" aria-label="Stato del playback">
          <span className="simulation-reader-live-dot" aria-hidden="true" />
          <span>Tempo fermo al checkpoint corrente</span>
          <span className="simulation-reader-sealed">
            {playback.remaining > 0
              ? `${playback.remaining} ${playback.remaining === 1 ? 'evento sigillato' : 'eventi sigillati'}`
              : 'Chiusura del periodo disponibile'}
          </span>
        </div>

        <ol className="simulation-reader-events">
          {disclosed.map((event, index) => {
            const current = event.id === playback.event.id;
            return (
              <li key={event.id} className={`simulation-reader-event${current ? ' is-current' : ''}`}>
                <div className="simulation-reader-event-rail" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <i />
                </div>
                <article>
                  <time>{event.date}</time>
                  <h3>{event.headline}</h3>
                  {event.detail && <p>{event.detail}</p>}
                  {current && <small>Checkpoint attivo</small>}
                </article>
              </li>
            );
          })}
        </ol>

        <footer className="simulation-reader-actions">
          <button type="button" className="btn-continue-next" onClick={onContinue} disabled={loading}>
            {playback.remaining > 0
              ? 'Evento successivo'
              : `Procedi fino al ${playback.destination}`}
          </button>
          <button
            type="button"
            className="btn-intervene"
            onClick={onIntervene}
            disabled={loading}
            title="Chiude il salto a questo checkpoint"
          >
            Intervieni
          </button>
        </footer>
        <p className="simulation-reader-note">
          Le proposte non ancora lette restano sigillate; l'archivio non modifica questo checkpoint.
        </p>
      </section>
    </div>
  );
}
