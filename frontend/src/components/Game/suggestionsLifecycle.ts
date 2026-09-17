/**
 * ARMY-MOVE Parte 3 — ciclo di vita delle proposte elaborate
 * =========================================================
 * Le proposte sono una **fotografia del turno che il giocatore sta guardando**:
 * ordini concreti costruiti sulla mappa, sulla cronaca e sulla strategia di
 * quel momento. Quando il mondo avanza quella fotografia non esiste più: se le
 * proposte restano nel pannello, il giocatore pianifica la prossima mossa su
 * una situazione che non c'è più (era il caso segnalato: turno 8, 05/05/1816,
 * con le proposte dei turni precedenti ancora a schermo).
 *
 * Qui vive soltanto la **decisione**; l'azzeramento riusa il percorso di stato
 * già esistente (`useActionsStore.clearSuggestions`, lo stesso usato dal resume
 * di un salvataggio). Nessun nuovo store, nessuna seconda verità: il server non
 * conserva proposte, le rigenera solo su richiesta esplicita.
 */

/**
 * Esiti possibili di un avanzamento (`POST /games/:id/simulation-jobs`).
 * Elencati dal contratto di `gameApi.timeSkip`.
 */
export type AdvanceOutcome =
  | 'world_advanced'
  | 'actions_processed'
  | 'awaiting_next'
  | 'date_advanced'
  | 'simulation_replayed'
  | 'no_event_found';

/**
 * `true` quando l'esito ha committato un turno (o comunque cambiato lo stato
 * del mondo) e quindi la fotografia su cui erano costruite le proposte è
 * superata.
 *
 * `no_event_found` è l'unica eccezione: il server ha eseguito la ricerca ma non
 * ha committato nulla (`lastCommittedResult === null`, turno e data ripristinati
 * a `periodStart`), quindi le proposte restano vere e si conservano insieme a
 * data, mappa, cronaca e coda.
 *
 * Un esito assente o sconosciuto viene trattato come cambiamento: meglio un
 * pannello vuoto con la sua chiamata all'azione che proposte stantie.
 */
export function shouldResetSuggestions(outcomeType: string | null | undefined): boolean {
  if (!outcomeType) return true;
  return outcomeType !== 'no_event_found';
}

/** Testo dello stato vuoto del pannello: spiega perché non c'è nulla da leggere. */
export function suggestionsEmptyHint(): string {
  return 'Nessuna proposta attiva. Le proposte elaborate valgono per il turno in corso e si azzerano quando il mondo avanza: chiedi «Elabora proposte» per pianificare la prossima mossa.';
}
