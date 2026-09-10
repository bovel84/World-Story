import { useRef } from 'react';
import { AccessibleDialog } from './AccessibleDialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'primary';
}

/**
 * Dialog di conferma accessibile per azioni distruttive/irreversibili.
 * Estende AccessibleDialog con focus su "Annulla" per default (sicuro).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  variant = 'primary',
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <AccessibleDialog
      open={open}
      onClose={onClose}
      overlayClassName="confirm-dialog-overlay"
      className={`confirm-dialog confirm-dialog--${variant}`}
      ariaLabel={title}
      initialFocusRef={cancelButtonRef}
      closeOnEscape={true}
      closeOnBackdrop={true}
    >
      <header className="confirm-dialog-header">
        <h3>{title}</h3>
      </header>
      <div className="confirm-dialog-body">
        <p>{message}</p>
      </div>
      <footer className="confirm-dialog-footer">
        <button
          ref={cancelButtonRef}
          type="button"
          className="confirm-dialog-cancel"
          onClick={onClose}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirm-dialog-confirm confirm-dialog-confirm--${variant}`}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </button>
      </footer>
    </AccessibleDialog>
  );
}