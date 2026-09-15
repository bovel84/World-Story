/**
 * World Story — Budget e arresto del salto automatico «al prossimo evento»
 * =======================================================================
 * L'auto-jump non deve fermarsi al primo fatto di cronaca in sé: deve
 * proseguire attraverso i fatti di contorno finché una nazione non assume una
 * decisione concreta in risposta agli ordini del giocatore. Questo modulo
 * definisce, con funzioni PURE e testabili:
 *
 *  - il budget di eventi concesso al modello (`autoJumpEventBudget`);
 *  - il predicato che riconosce la decisione NPC che arresta il salto
 *    (`isDecisiveNpcDecision`).
 *
 * Motore (`game-session.ts`) e builder del prompt (`prompt-builder.ts`)
 * condividono lo stesso budget: la finestra di ricerca resta identica su
 * entrambi i lati e nessuno dei due può "guardare" più avanti dell'altro.
 */

/** Struttura minima di una reazione NPC: evita una dipendenza da `prompts/`. */
export interface DecisiveReactionLike {
  role?: string;
  counterAction?: string;
}

export interface DecisiveEventLike {
  reactions?: DecisiveReactionLike[];
}

/** Eventi minimi garantiti all'auto-jump, anche con un solo ordine in coda. */
export const AUTO_JUMP_MIN_EVENTS = 2;
/**
 * Tetto prudente: la ricerca di una decisione NPC non deve trasformare il
 * salto in un anno di cronaca né gonfiare i token del provider.
 */
export const AUTO_JUMP_MAX_EVENTS = 6;
/** Eventi di contesto concessi oltre agli ordini in coda. */
export const AUTO_JUMP_LOOKAHEAD = 2;

/**
 * Budget eventi dell'auto-jump. Cresce con gli ordini in coda (più catene
 * causali possibili) e mantiene almeno `AUTO_JUMP_MIN_EVENTS` eventi per
 * poter attraversare i fatti di contorno e raggiungere la decisione che
 * ferma il salto.
 */
export function autoJumpEventBudget(actionCount: number): number {
  const orders = Number.isFinite(actionCount) && actionCount > 0 ? Math.floor(actionCount) : 0;
  return Math.max(AUTO_JUMP_MIN_EVENTS, Math.min(AUTO_JUMP_MAX_EVENTS, orders + AUTO_JUMP_LOOKAHEAD));
}

/**
 * La decisione NPC che deve arrestare l'auto-jump:
 *  - una controparte diretta che risponde (`role === 'counterparty'`), oppure
 *  - una misura autonoma realmente decisa (`counterAction` non vuoto).
 *
 * Le reazioni di puro contesto (osservatori, mediatori senza misura) NON
 * fermano il salto: il mondo può continuare a raccontarsi finché qualcuno non
 * decide qualcosa che riguarda il giocatore.
 */
export function isDecisiveNpcDecision(event: DecisiveEventLike | null | undefined): boolean {
  return (event?.reactions || []).some(reaction =>
    reaction.role === 'counterparty' || Boolean((reaction.counterAction || '').trim()),
  );
}
