/**
 * WORLD-ALIVE P1 — Toggle delle azioni proposte (aggiungi ⇄ rimuovi).
 * ==================================================================
 * Le proposte del desk erano bottoni `disabled` quando già in coda: una
 * volta aggiunte non si potevano più togliere da lì. La decisione
 * «questa proposta è già nel piano?» è una funzione pura, così il ciclo
 * aggiungi → rimuovi è verificabile senza DOM e il componente resta
 * dichiarativo.
 *
 * Non introduce percorsi nuovi: `remove` restituisce l'id dell'azione già
 * in coda, che il desk passa alla `removeQueuedAction` esistente
 * (`useOrderQueue` → `gameApi.removePendingAction`).
 */

export interface PendingActionLike {
  id: string;
  text: string;
}

export type SuggestionToggle =
  | { kind: 'add' }
  | { kind: 'remove'; id: string };

/**
 * Confronto sul testo normalizzato (trim), come già faceva il desk per
 * riconoscere i duplicati: stesso testo ⇒ stessa azione ⇒ si rimuove.
 */
export function resolveSuggestionToggle(
  pendingActions: readonly PendingActionLike[],
  content: string,
): SuggestionToggle {
  const normalized = content.trim();
  const queued = pendingActions.find(item => item.text.trim() === normalized);
  return queued ? { kind: 'remove', id: queued.id } : { kind: 'add' };
}
