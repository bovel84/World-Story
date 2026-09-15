/**
 * World Story — Menù di gioco (fuori dal dossier)
 * ==============================================
 * Un solo pulsante nella barra HUD che raccoglie le azioni globali di partita:
 * salvataggio, caricamento, modifica del mondo e del modello IA. Prima vivevano
 * in fondo al Dossier Nazione, dove finivano confusi con i dati della nazione;
 * qui restano sempre raggiungibili senza aprire alcun modulo.
 *
 * Componente autosufficiente: non chiama API, invoca solo i callback delle props.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface GameMenuProps {
  /** Apre il modale di salvataggio. */
  onSave: () => void;
  /** Apre il selettore dei salvataggi da caricare. */
  onLoad: () => void;
  /** Apre l'editor del prompt del mondo. */
  onEditWorld: () => void;
  /** Apre le impostazioni del modello IA. */
  onEditModel: () => void;
  /** Blocca il menù durante l'elaborazione del turno. */
  disabled?: boolean;
}

export const GameMenu: React.FC<GameMenuProps> = ({
  onSave,
  onLoad,
  onEditWorld,
  onEditModel,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Chiusura al clic esterno e con Esc: il menù è un popover, non un modale.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="game-menu" ref={rootRef}>
      <button
        type="button"
        className="hud-icon-btn game-menu-btn"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Salva, carica e impostazioni"
        title="Salva, carica e impostazioni"
        disabled={disabled}
      >
        ⚙
      </button>
      {open && (
        <div className="game-menu-dropdown" role="menu" aria-label="Salva, carica e impostazioni">
          <button type="button" role="menuitem" className="game-menu-item" onClick={choose(onSave)}>
            <span aria-hidden="true">💾</span> Salva
          </button>
          <button type="button" role="menuitem" className="game-menu-item" onClick={choose(onLoad)}>
            <span aria-hidden="true">📂</span> Carica
          </button>
          <span className="game-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="game-menu-item" onClick={choose(onEditWorld)}>
            <span aria-hidden="true">🌍</span> Mondo
          </button>
          <button type="button" role="menuitem" className="game-menu-item" onClick={choose(onEditModel)}>
            <span aria-hidden="true">🧠</span> Modello
          </button>
        </div>
      )}
    </div>
  );
};

export default GameMenu;
