/**
 * DELETE SAVES — meccanismo unico di eliminazione di un salvataggio
 * ==================================================================
 * La stessa azione distruttiva serve due superfici: l'archivio in-game
 * (`SavePickerModal`) e la home (`Landing`). Conferma, stato occupato, messaggi e
 * traduzione degli errori vivono **qui**: le due UI non duplicano nulla e non
 * possono divergere.
 *
 *   request(save) → dialogo di conferma → confirm() → DELETE → voce rimossa
 *
 * Regole non negoziabili, in un solo posto:
 *  - **mai** al primo clic: la cancellazione parte solo da `confirm()`;
 *  - **nessuna rimozione ottimistica**: la voce sparisce dopo la risposta del
 *    backend, e in errore resta dov'è (solo un messaggio);
 *  - gli snapshot interni del motore (`__…__`) non sono nemmeno candidati
 *    (`request()` li ignora): doppia difesa, il backend risponde comunque 403.
 */
import { useCallback, useState } from 'react';
import { savesApi } from '../../services/api';
import { isReservedSave } from './reservedSaves';

export interface SaveSummary {
  id: string;
  game_id: string;
  name: string;
  current_turn?: number;
  current_date?: string;
  saved_at?: string;
}

export const formatSaveDate = (value?: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Data non disponibile';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
};

const formatDate = formatSaveDate;

/** Elenco visibile: solo salvataggi dell'utente, dal più recente. */
export function visibleSaves(data: unknown): SaveSummary[] {
  return (Array.isArray(data) ? data : [])
    .filter((save: any) => save?.id && !isReservedSave(save))
    .sort((a: any, b: any) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')));
}

/** Rimozione locale della voce dopo una cancellazione riuscita (nessun refetch). */
export function removeSaveFromList(saves: SaveSummary[], saveId: string): SaveSummary[] {
  return saves.filter((save) => save.id !== saveId);
}

export function saveTitle(save: SaveSummary): string {
  return save?.name || 'Salvataggio senza nome';
}

/** Etichetta accessibile del pulsante: inizia con la parola visibile «Elimina». */
export function saveDeleteLabel(save: SaveSummary): string {
  return `Elimina il salvataggio “${saveTitle(save)}”`;
}

export function saveDeleteConfirmText(save: SaveSummary): string {
  return `“${saveTitle(save)}” · Mossa ${save.current_turn ?? '—'} · ${formatDate(save.current_date)}. `
    + 'Il salvataggio viene rimosso dall’archivio. La partita in corso e il suo stato non vengono toccati.';
}

export const DELETE_SAVE_ERROR = 'Impossibile eliminare il salvataggio. Riprova.';
export const DELETE_SAVE_RESERVED_ERROR = 'Salvataggio riservato: non cancellabile.';

/** Messaggio di esito mostrato dopo una cancellazione riuscita. */
export function saveDeletedNotice(save: SaveSummary): string {
  return `Salvataggio “${saveTitle(save)}” eliminato.`;
}

export type DeleteSaveOutcome = { ok: true } | { ok: false; message: string };

/**
 * Cancella davvero: **una sola** chiamata, esito tradotto in messaggio.
 * Il remover è iniettabile per poter provare i tre esiti senza rete.
 */
export async function deleteSave(
  saveId: string,
  remove: (id: string) => Promise<unknown> = savesApi.remove,
): Promise<DeleteSaveOutcome> {
  try {
    await remove(saveId);
    return { ok: true };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return { ok: false, message: status === 403 ? DELETE_SAVE_RESERVED_ERROR : DELETE_SAVE_ERROR };
  }
}

export interface SaveDeletion {
  /** Salvataggio in attesa di conferma (`null` = nessuna conferma aperta). */
  pending: SaveSummary | null;
  /** Id in corso di eliminazione: la voce che lo possiede è occupata. */
  deletingId: string | null;
  notice: string;
  error: string;
  /** Chiede la conferma: NON cancella nulla. */
  request: (save: SaveSummary) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
  /** Azzera lo stato (apertura/chiusura della superficie). */
  reset: () => void;
}

/**
 * `onDeleted` riceve il salvataggio **solo** dopo che il backend ha confermato:
 * è il punto in cui la superficie rimuove la voce dalla propria lista.
 */
export function useSaveDeletion(onDeleted: (save: SaveSummary) => void): SaveDeletion {
  const [pending, setPending] = useState<SaveSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const request = useCallback((save: SaveSummary) => {
    if (!save?.id || isReservedSave(save)) return; // mai candidato: snapshot interno o voce senza id
    setError('');
    setNotice('');
    setPending(save);
  }, []);

  const cancel = useCallback(() => {
    if (deletingId) return; // durante l'operazione la conferma non si chiude
    setPending(null);
  }, [deletingId]);

  const reset = useCallback(() => {
    setPending(null);
    setNotice('');
    setError('');
  }, []);

  const confirm = useCallback(async () => {
    if (!pending || deletingId) return false;
    const target = pending;
    setDeletingId(target.id);
    setError('');
    setNotice('');
    const outcome = await deleteSave(target.id);
    if (outcome.ok) {
      onDeleted(target); // la voce sparisce solo ora
      setNotice(saveDeletedNotice(target));
    } else {
      setError(outcome.message); // in errore la lista non viene toccata
    }
    setPending(null);
    setDeletingId(null);
    return outcome.ok;
  }, [pending, deletingId, onDeleted]);

  return { pending, deletingId, notice, error, request, cancel, confirm, reset };
}
