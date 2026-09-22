/**
 * DELETE SAVES — conferma esplicita dell'eliminazione (componente condiviso)
 * ========================================================================
 * Estratto dal picker in-game perché **anche la home** deve cancellare un
 * salvataggio: un solo dialogo, un solo testo, un solo comportamento di focus.
 * Un'azione distruttiva non può avere due implementazioni che divergono.
 *
 *  - `save === null` → chiuso;
 *  - focus iniziale su **Annulla** (la scelta sicura);
 *  - `busy` → entrambi i pulsanti disabilitati, `Esc`/backdrop non chiudono;
 *  - nessuna chiamata al backend qui: la conferma è solo una decisione.
 */
import { useRef } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { saveDeleteConfirmText, type SaveSummary } from './saveDeletion';

export interface SaveDeleteConfirmDialogProps {
  save: SaveSummary | null;
  /** Operazione in corso: nessuna azione disponibile finché non finisce. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SaveDeleteConfirmDialog({ save, busy = false, onCancel, onConfirm }: SaveDeleteConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AccessibleDialog
      open={save !== null}
      onClose={onCancel}
      overlayClassName="save-delete-overlay"
      className="save-delete-confirm"
      ariaLabel="Conferma eliminazione del salvataggio"
      initialFocusRef={cancelRef}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
    >
      <h3>Eliminare il salvataggio?</h3>
      {save && <p data-save-delete-target={save.id}>{saveDeleteConfirmText(save)}</p>}
      <div className="save-delete-actions">
        <button ref={cancelRef} type="button" className="save-delete-cancel" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
        <button type="button" className="save-delete-confirm-button" onClick={onConfirm} disabled={busy}>
          {busy ? 'Eliminazione…' : 'Elimina definitivamente'}
        </button>
      </div>
    </AccessibleDialog>
  );
}
