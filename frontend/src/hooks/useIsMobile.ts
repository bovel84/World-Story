/**
 * WS-GOV-MOBILE-FOCUS / WS-GOV-MOBILE-CLEANUP (M4) — Il discriminante di
 * presentazione del Governo.
 * =====================================================================
 * Il mobile non è «CSS piccolo»: è una diversa composizione dello stesso stato.
 * L'unica cosa che il componente deve sapere è **quale modalità di
 * presentazione** usare.
 *
 * WS-GOV-MOBILE-CLEANUP (M4) — la soglia non è più solo la larghezza. Un
 * **telefono in orizzontale** (844×390) è largo ma basso: `max-width: 767px`
 * lo classificava come desktop e mostrava il divisore dialogo|tavola su uno
 * schermo che non lo regge. La modalità compatta è quindi:
 *
 *   width <= 767  OR  (width <= 950 AND height <= 500)
 *
 * Non è dominio: il gioco non cambia con la larghezza della finestra. E non si
 * propaga a tutta World Story: riguarda il **layout del Governo**.
 */
import { useEffect, useState } from 'react';

/** La soglia storica del mobile in verticale. */
export const MOBILE_MAX_WIDTH = 767;
/** La soglia del telefono in orizzontale: largo ma basso. */
export const COMPACT_LANDSCAPE_MAX_WIDTH = 950;
export const COMPACT_LANDSCAPE_MAX_HEIGHT = 500;

/**
 * La query della modalità compatta. È **la stessa** usata dalle media query CSS:
 * JS e CSS non possono divergere.
 */
export const GOVERNMENT_COMPACT_QUERY =
  `(max-width: ${MOBILE_MAX_WIDTH}px), ` +
  `(max-width: ${COMPACT_LANDSCAPE_MAX_WIDTH}px) and (max-height: ${COMPACT_LANDSCAPE_MAX_HEIGHT}px)`;

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(GOVERNMENT_COMPACT_QUERY);
}

/** Il predicato puro, testabile senza finestra: larghezza/altezza → compatto? */
export function isGovernmentCompactSize(width: number, height: number): boolean {
  if (width <= MOBILE_MAX_WIDTH) return true;
  return width <= COMPACT_LANDSCAPE_MAX_WIDTH && height <= COMPACT_LANDSCAPE_MAX_HEIGHT;
}

/**
 * La modalità compatta del Governo. Il nome dice ciò che è: una **presentazione**,
 * non un dispositivo.
 */
export function useGovernmentCompactLayout(): boolean {
  const [compact, setCompact] = useState<boolean>(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const onChange = (event: MediaQueryListEvent): void => setCompact(event.matches);
    setCompact(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return compact;
}

/**
 * Compatibilità: il vecchio nome resta, ma ora delega al criterio compatto.
 * Nessun altro consumatore oltre all'Ufficio del Governo.
 */
export function useIsMobile(): boolean {
  return useGovernmentCompactLayout();
}
