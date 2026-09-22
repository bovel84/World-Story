/**
 * DELETE SAVES — regola dei salvataggi riservati (lato client)
 * ============================================================
 * Specchio della regola del backend (`backend-nest/src/game/SaveReservations.ts`):
 * lo spazio dei nomi `__…__` appartiene agli snapshot interni del motore
 * (`__rewind__`, `__n__`). Il client la usa per **non mostrarli** e per **non
 * crearli**; il backend resta l'autorità (fail-closed su cancellazione e
 * creazione), quindi un elenco «sporco» non è un rischio: al massimo manca il
 * pulsante, e la richiesta verrebbe comunque rifiutata.
 */

export const RESERVED_SAVE_NAME_PATTERN = /^__.+__$/;

/** `true` se il nome appartiene allo spazio riservato (nome assente = riservato). */
export function isReservedSaveName(name: unknown): boolean {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value === '') return true;
  return RESERVED_SAVE_NAME_PATTERN.test(value);
}

export function isReservedSave(save?: { name?: string } | null): boolean {
  return isReservedSaveName(save?.name);
}

/** Motivo per cui un nome non può essere salvato dall'utente (`null` = va bene). */
export function saveNameProblem(name: string): 'reserved' | null {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') return null; // vuoto = «Salva» disabilitato, non un errore
  return isReservedSaveName(trimmed) ? 'reserved' : null;
}

export const RESERVED_SAVE_NAME_HINT =
  'Nome riservato: usa un nome senza doppi underscore (sono gli snapshot interni del motore).';
