/**
 * World Story — Epilogo di partita
 * ================================
 * La nazione è caduta: rivolta, default o invasione. Il pannello non è una
 * scusa narrativa, è il punto finale calcolato dal motore. Da qui il giocatore
 * non governa più: può solo tornare indietro di un turno (se lo snapshot
 * esiste) o ricominciare da un altro mondo.
 */

import { useRef } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import type { CrisisDimension, GameEnding } from '../../services/api';

const ENDING_LABEL: Record<GameEnding['kind'], string> = {
  revolution: 'Rivolta',
  default: 'Default sovrano',
  invasion: 'Invasione',
};

const DIMENSION_LABEL: Record<CrisisDimension, string> = {
  revolt: 'Rivolta interna',
  insolvency: 'Default sul debito',
  invasion: 'Invasione straniera',
};

export interface GameOverOverlayProps {
  ending: GameEnding;
  /** Data e turno dell'epilogo, per l'intestazione. */
  date?: string;
  turn?: number;
  onRewind?: () => void;
  onNewGame?: () => void;
  onClose?: () => void;
  busy?: boolean;
}

export function GameOverOverlay({
  ending,
  date,
  turn,
  onRewind,
  onNewGame,
  onClose,
  busy = false,
}: GameOverOverlayProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const collapse = ending.criticalDimensions?.length
    ? ending.criticalDimensions.map((dimension) => DIMENSION_LABEL[dimension] ?? dimension).join(' e ')
    : DIMENSION_LABEL[ending.dimension] ?? ending.dimension;

  return (
    <AccessibleDialog
      open={true}
      onClose={onClose ?? (() => {})}
      overlayClassName="game-over-overlay"
      className={`game-over game-over--${ending.kind}`}
      ariaLabel={ending.title}
      initialFocusRef={primaryRef}
      closeOnEscape={Boolean(onClose)}
      closeOnBackdrop={false}
    >
      <header className="game-over-header">
        <span className="game-over-kicker">Partita finita · {ENDING_LABEL[ending.kind]}</span>
        <h2>{ending.title}</h2>
        {date && (
          <p className="game-over-date">
            {date}
            {turn ? ` · turno ${turn}` : ''}
          </p>
        )}
      </header>
      <div className="game-over-body">
        <p className="game-over-summary">{ending.summary}</p>
        <p className="game-over-collapse">Le cause: {collapse}.</p>
        <p className="game-over-note">
          La nazione non è caduta per una singola mossa: i rischi sono cresciuti
          mentre i conti, il consenso o le difese restavano scoperti. Da qui si
          può tornare indietro di un turno e correggere la rotta, oppure
          ricominciare altrove.
        </p>
      </div>
      <footer className="game-over-footer">
        {onRewind && (
          <button
            ref={primaryRef}
            type="button"
            className="game-over-rewind"
            onClick={onRewind}
            disabled={busy}
          >
            {busy ? 'Ripristino…' : '↩ Torna al turno precedente'}
          </button>
        )}
        {onNewGame && (
          <button
            type="button"
            className="game-over-new"
            onClick={onNewGame}
            disabled={busy}
          >
            Nuova partita
          </button>
        )}
        {onClose && (
          <button type="button" className="game-over-close" onClick={onClose} disabled={busy}>
            Guarda il mondo
          </button>
        )}
      </footer>
    </AccessibleDialog>
  );
}
