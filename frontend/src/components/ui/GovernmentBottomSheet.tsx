/**
 * WS-GOV-MOBILE-FOCUS (H18) — Il foglio di fondo mobile, uno solo e riusabile
 * ==========================================================================
 * Sul mobile le azioni secondarie non occupano la pagina: si aprono da un
 * foglio in fondo allo schermo (convocare un ministro, altre azioni, fonti,
 * scelta di un'opzione). È un unico componente generico, così ogni azione non
 * reinventa un modale.
 *
 * Non implementa un dialogo per conto proprio: delega a `AccessibleDialog`, che
 * possiede già portal, focus trap, Escape, overlay e ripristino del focus.
 * Qui si aggiungono solo l'ancoraggio in basso e la maniglia.
 */
import type { ReactNode, RefObject } from 'react';
import { AccessibleDialog } from './AccessibleDialog';

export interface GovernmentBottomSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Il pulsante che ha aperto il foglio: il focus torna lì alla chiusura. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly labelledBy?: string;
  /**
   * P0.5 — Azione a sinistra dell'intestazione (es. «Torna al Consiglio»).
   *
   * Con `trailingAction` permette DUE uscite sempre visibili e distinte:
   * chiudere il foglio e chiudere l'intero ufficio. Sul default resta la sola ✕,
   * quindi i fogli esistenti non cambiano.
   */
  readonly leadingAction?: ReactNode;
  readonly trailingAction?: ReactNode;
}

export function GovernmentBottomSheet({
  open,
  title,
  onClose,
  children,
  initialFocusRef,
  labelledBy = 'government-bottom-sheet-title',
  leadingAction,
  trailingAction,
}: GovernmentBottomSheetProps) {
  return (
    <AccessibleDialog
      open={open}
      onClose={onClose}
      className="gov-sheet"
      overlayClassName="gov-sheet-overlay"
      ariaLabelledBy={labelledBy}
      initialFocusRef={initialFocusRef}
    >
      <div className="gov-sheet-grip" aria-hidden="true" />
      <header className="gov-sheet-head">
        <div className="gov-sheet-head-leading">{leadingAction}</div>
        <h2 className="gov-sheet-title" id={labelledBy}>{title}</h2>
        <div className="gov-sheet-head-trailing">
          {trailingAction ?? <button type="button" className="gov-sheet-close" onClick={onClose} aria-label="Chiudi il foglio">✕</button>}
        </div>
      </header>
      <div className="gov-sheet-body">{children}</div>
    </AccessibleDialog>
  );
}

export default GovernmentBottomSheet;
