import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

let openDialogCount = 0;
let previousBodyOverflow = '';
let previousRootAriaHidden: string | null = null;
let previousRootInert = false;

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function setApplicationInert(inert: boolean) {
  const appRoot = document.getElementById('root');
  if (!appRoot) return;
  const root = appRoot as HTMLElement & { inert: boolean };

  if (inert) {
    previousRootAriaHidden = root.getAttribute('aria-hidden');
    previousRootInert = root.inert;
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
    return;
  }

  root.inert = previousRootInert;
  if (previousRootAriaHidden === null) root.removeAttribute('aria-hidden');
  else root.setAttribute('aria-hidden', previousRootAriaHidden);
}

export interface AccessibleDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className: string;
  overlayClassName: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaLive?: 'off' | 'polite' | 'assertive';
  id?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

/**
 * Dialog modale in portal: conserva/ripristina il focus, intrappola Tab e
 * rende inerte l'app sottostante. Il contenuto resta libero di mantenere le
 * proprie classi e il proprio layout legacy durante la migrazione CSS.
 */
export function AccessibleDialog({
  open,
  onClose,
  children,
  className,
  overlayClassName,
  ariaLabel,
  ariaLabelledBy,
  ariaLive,
  id,
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (openDialogCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setApplicationInert(true);
    }
    openDialogCount += 1;

    const focusInitial = () => {
      const fallback = dialogRef.current;
      const explicitTarget = initialFocusRef?.current;
      const firstFocusable = fallback?.querySelector<HTMLElement>(focusableSelector);
      const target = explicitTarget && !explicitTarget.matches(':disabled')
        ? explicitTarget
        : firstFocusable || fallback;
      target?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      openDialogCount -= 1;
      if (openDialogCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
        setApplicationInert(false);
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, [open, initialFocusRef, closeOnEscape]);

  if (!open) return null;

  return createPortal(
    <div
      className={overlayClassName}
      onMouseDown={closeOnBackdrop ? (event) => {
        if (event.target === event.currentTarget) onClose();
      } : undefined}
    >
      <div
        ref={dialogRef}
        id={id}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-live={ariaLive}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
