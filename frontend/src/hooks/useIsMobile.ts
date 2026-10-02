/**
 * WS-GOV-MOBILE-FOCUS — Il discriminante di presentazione mobile.
 * ==============================================================
 * Il mobile non è «CSS piccolo»: è una diversa composizione dello stesso stato.
 * L'unica cosa che il componente deve sapere è **quale modalità di
 * presentazione** usare. La soglia è la stessa delle media query esistenti
 * (767px), così CSS e JS non divergono.
 *
 * Non è dominio: il gioco non cambia con la larghezza della finestra.
 */
import { useEffect, useState } from 'react';

export const MOBILE_MAX_WIDTH = 767;

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches);
    setIsMobile(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}
