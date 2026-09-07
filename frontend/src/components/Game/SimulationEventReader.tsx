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

  return (
    <section
      ref={readerRef}
      id="simulation-event-reader"
      className="simulation-event-reader"
      tabIndex={-1}
      aria-label="Lettore della sessione attiva"
      aria-live="polite"
    >
      <header className="simulation-reader-header">
        <div>
          <span className="simulation-reader-kicker">Fascicolo di sessione</span>
          <span className="simulation-reader-stamp">tempo fermo</span>
        </div>
        <div className="simulation-reader-anchor" title={playback.checkpointId ? `Checkpoint ${playback.checkpointId}` : undefined}>
          {checkpointLabel}
        </div>
      </header>

      <div className="simulation-reader-dateline">
        <span>{playback.event.date}</span>
        <span>
          {playback.remaining > 0
            ? `${playback.remaining} ${playback.remaining === 1 ? 'dispaccio sigillato' : 'dispacci sigillati'}`
            : 'Chiusura del periodo'}
        </span>
      </div>
      <h3 className="simulation-reader-title">{playback.event.headline}</h3>
      {playback.event.detail && <p className="simulation-reader-detail">{playback.event.detail}</p>}

      <footer className="simulation-reader-actions">
        <button type="button" className="btn-continue-next" onClick={onContinue} disabled={loading}>
          {playback.remaining > 0
            ? 'Leggi il prossimo dispaccio'
            : `Completa fino al ${playback.destination}`}
        </button>
        <button
          type="button"
          className="btn-intervene"
          onClick={onIntervene}
          disabled={loading}
          title="Chiude il salto a questo checkpoint"
        >
          Intervieni qui
        </button>
      </footer>
      <p className="simulation-reader-note">
        L'archivio resta consultabile: questo è l'unico evento su cui puoi intervenire ora.
      </p>
    </section>
  );
}
