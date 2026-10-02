/**
 * WS-GAME-OPENING — Carica la narrativa dell'apertura (sola lettura).
 *
 * Una sola richiesta per partita, annullabile. Se la rete o il backend non
 * rispondono, il read model usa i fallback locali: l'apertura non si blocca
 * mai su una chiamata di rete.
 */
import { useEffect, useRef, useState } from 'react';
import { gameApi, type OpeningNarrativeResponse } from '../services/api';

export function useOpeningNarrative(
  gameId: string | null,
  enabled: boolean,
): OpeningNarrativeResponse | null {
  const [data, setData] = useState<OpeningNarrativeResponse | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!gameId || !enabled) return;
    const request = ++requestRef.current;
    let cancelled = false;
    gameApi.openingNarrative(gameId)
      .then(response => {
        if (!cancelled && request === requestRef.current) setData(response);
      })
      .catch(() => {
        if (!cancelled && request === requestRef.current) setData(null);
      });
    return () => { cancelled = true; };
  }, [gameId, enabled]);

  return data;
}
