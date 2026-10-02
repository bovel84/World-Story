/**
 * WS-GAME-OPENING — Il flag UI dell'apertura, per partita.
 *
 * È **UX, non simulazione**: non tocca lo stato del motore, non entra nel
 * salvataggio. Serve solo a non riproporre il prologo a ogni refresh, a ogni
 * caricamento o a ogni turno. Vive nello storage del browser, con la chiave
 * `world-story:opening-seen:<gameId>`.
 */

const KEY_PREFIX = 'world-story:opening-seen:';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function openingSeenKey(gameId: string): string {
  return `${KEY_PREFIX}${gameId}`;
}

/** Vero se l'apertura è già stata mostrata per questa partita. */
export function hasSeenOpening(gameId: string | null | undefined): boolean {
  if (!gameId) return false;
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(openingSeenKey(gameId)) === '1';
  } catch {
    return false;
  }
}

/** Segna l'apertura come vista per questa partita. Non lancia mai. */
export function markOpeningSeen(gameId: string | null | undefined): void {
  if (!gameId) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(openingSeenKey(gameId), '1');
  } catch {
    /* storage pieno o non disponibile: l'apertura resta solo in memoria. */
  }
}

/** Dimentica il flag (per riproporre l'apertura a una nuova partita omonima). */
export function clearOpeningSeen(gameId: string | null | undefined): void {
  if (!gameId) return;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(openingSeenKey(gameId));
  } catch {
    /* no-op */
  }
}
