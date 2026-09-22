/**
 * DELETE SAVES — regola unica dei salvataggi RISERVATI
 * ====================================================
 * `saves` contiene due famiglie di righe:
 *
 *  1. i **salvataggi dell'utente** (nome scelto nella modale «Salva partita»);
 *  2. gli **snapshot interni del motore**: `__rewind__` (rewind di un turno, usato
 *     da `GamePersistenceService` e `TurnPipelineService`) e il nome storico
 *     `__n__`. Sono dati di servizio: il motore li scrive direttamente, la UI
 *     non li mostra.
 *
 * La regola è il **pattern**: qualunque nome racchiuso fra doppi underscore è
 * riservato — così un nuovo snapshot interno non deve ricordarsi di aggiornare
 * un elenco. Da qui derivano due protezioni, entrambe nel backend:
 *
 *  - **cancellazione** (`DELETE /api/saves/:id`): rifiutata con `403 reserved_save`
 *    (fail-closed: nessuna richiesta, per quanto esplicita, cancella uno snapshot);
 *  - **creazione** (`POST /api/games/:id/save`): rifiutata con `400`, così un
 *    utente non può creare una riga indistinguibile da uno snapshot interno
 *    (che poi non sarebbe più cancellabile).
 *
 * Nessun motore nuovo, nessuna tabella: una funzione pura e due guardie.
 */

export const RESERVED_SAVE_NAMES = ['__rewind__', '__n__'] as const;
export const RESERVED_SAVE_NAME_PATTERN = /^__.+__$/;

/**
 * `true` se il nome appartiene allo spazio riservato del motore.
 * Un nome assente/vuoto è considerato riservato: mai cancellabile né creabile.
 */
export function isReservedSaveName(name: unknown): boolean {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value === '') return true;
  return RESERVED_SAVE_NAME_PATTERN.test(value)
    || (RESERVED_SAVE_NAMES as readonly string[]).includes(value);
}
