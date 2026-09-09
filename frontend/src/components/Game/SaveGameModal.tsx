/**
* World Story — Fase 6: SaveGameModal
 * =================================
* Modale di salvataggio della partita (sostituisce prompt()).
 * Overlay scuro, input del nome, «Salva»/«Annulla».
* Enter — salva, Escape / clic sull'overlay — annulla.
* Stili: fine di frontend/src/index.css, sezione «Fase 6: Landing».
 */

import { useEffect, useRef, useState } from 'react';

export interface SaveGameModalProps {
/** Visibilità della modale */
  open: boolean;
  /** Nome predefinito, es. `Partita 12.01.2025` */
  defaultName: string;
/** Conferma con il nome inserito (senza spazi) */
  onSave: (name: string) => void;
/** Chiusura senza salvare */
  onClose: () => void;
}

export function SaveGameModal({ open, defaultName, onSave, onClose }: SaveGameModalProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  // All'apertura — riportiamo il nome a defaultName e diamo il focus all'input
  useEffect(() => {
    if (open) {
      setName(defaultName || `Partita ${new Date().toLocaleDateString('it-IT')}`);
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open, defaultName]);

  // Escape chiude la modale
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = name.trim();
  const submit = () => {
    if (trimmed) onSave(trimmed);
  };

  return (
    <div className="save-modal-overlay" onClick={onClose}>
      <div
        className="save-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Salva partita"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="save-modal-header">
          <h3>Salva partita</h3>
          <button className="save-modal-close" onClick={onClose} title="Chiudi" aria-label="Chiudi">
            ✕
          </button>
        </div>

        <div className="save-modal-body">
          <label className="save-modal-label" htmlFor="save-modal-name">
            Nome del salvataggio
          </label>
          <input
            id="save-modal-name"
            ref={inputRef}
            className="save-modal-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={`Partita ${new Date().toLocaleDateString('it-IT')}`}
            maxLength={80}
          />
        </div>

        <div className="save-modal-footer">
          <button className="save-modal-cancel" onClick={onClose}>
            Annulla
          </button>
          <button className="save-modal-submit" onClick={submit} disabled={!trimmed}>
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
