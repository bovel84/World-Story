import { useEffect, useRef, useState } from 'react';
import { savesApi } from '../../services/api';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { isReservedSave } from './reservedSaves';

export interface SaveSummary {
  id: string;
  game_id: string;
  name: string;
  current_turn?: number;
  current_date?: string;
  saved_at?: string;
}

interface SavePickerModalProps {
  open: boolean;
  currentGameId?: string;
  onSelect: (save: SaveSummary) => void;
  onClose: () => void;
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

/** Rimozione locale dell'item dopo una cancellazione riuscita (nessun refetch). */
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

/** Messaggio di esito mostrato nella modale dopo una cancellazione riuscita. */
export function saveDeletedNotice(save: SaveSummary): string {
  return `Salvataggio “${saveTitle(save)}” eliminato.`;
}

export interface SavePickerListProps {
  saves: SaveSummary[];
  currentGameId?: string;
  onSelect: (save: SaveSummary) => void;
  /** Chiede la conferma: NON cancella nulla. */
  onRequestDelete: (save: SaveSummary) => void;
  /** Id in corso di eliminazione: la riga è occupata. */
  deletingId?: string | null;
}

/**
 * Elenco di presentazione del picker: selezione + eliminazione per riga.
 * I salvataggi riservati non hanno pulsante di eliminazione (doppia difesa:
 * sono già filtrati da `visibleSaves`).
 */
export function SavePickerList({ saves, currentGameId, onSelect, onRequestDelete, deletingId = null }: SavePickerListProps) {
  return (
    <>
      {saves.map((save) => {
        const busy = deletingId === save.id;
        const reserved = isReservedSave(save);
        return (
          <div key={save.id} className="save-picker-row" data-save-row={save.id} aria-busy={busy || undefined}>
            <button type="button" className="save-picker-item" onClick={() => onSelect(save)} disabled={busy}>
              <span className="save-picker-item-main">
                <b>{saveTitle(save)}</b>
                <small>{save.game_id === currentGameId ? 'Partita attuale' : 'Un’altra partita'}</small>
              </span>
              <span className="save-picker-item-meta">Mossa {save.current_turn ?? '—'} · {formatDate(save.current_date)}</span>
            </button>
            {!reserved && (
              <button
                type="button"
                className="save-picker-delete"
                data-save-delete={save.id}
                onClick={() => onRequestDelete(save)}
                disabled={busy}
                aria-label={saveDeleteLabel(save)}
              >
                {busy ? 'Eliminazione…' : 'Elimina'}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * G5-B — picker dei salvataggi: la selezione non ripristina nulla finché non è
 * confermata. `DELETE-SAVES`: ogni salvataggio non riservato può essere
 * eliminato **dopo conferma esplicita**; l'eliminazione non tocca la partita.
 */
export function SavePickerModal({ open, currentGameId, onSelect, onClose }: SavePickerModalProps) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SaveSummary | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setNotice('');
    setDeleteError('');
    setPendingDelete(null);
    savesApi.list()
      .then(({ saves: data }) => {
        if (cancelled) return;
        setSaves(visibleSaves(data));
      })
      .catch(() => { if (!cancelled) setError('Impossibile leggere i salvataggi. Riprova.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    setDeleteError('');
    setNotice('');
    try {
      await savesApi.remove(target.id);
      // Solo dopo la conferma del backend l'item sparisce: nessuna ottimistica.
      setSaves((current) => removeSaveFromList(current, target.id));
      setNotice(saveDeletedNotice(target));
      setPendingDelete(null);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      setDeleteError(status === 403 ? DELETE_SAVE_RESERVED_ERROR : DELETE_SAVE_ERROR);
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  const closeConfirm = () => {
    if (deletingId) return;
    setPendingDelete(null);
  };

  return (
    <>
      <AccessibleDialog
        open={open}
        onClose={onClose}
        overlayClassName="save-picker-overlay"
        className="save-picker"
        ariaLabel="Carica un salvataggio"
        initialFocusRef={closeRef}
        // Con la conferma aperta Esc/backdrop appartengono alla conferma: il
        // picker non deve chiudersi sotto la modale di conferma.
        closeOnBackdrop={pendingDelete === null}
        closeOnEscape={pendingDelete === null}
      >
        <header className="save-picker-header">
          <div><span>Archivio campagna</span><h2>Carica un salvataggio</h2></div>
          <button ref={closeRef} type="button" className="save-modal-close" onClick={onClose} aria-label="Chiudi archivio">×</button>
        </header>
        <div className="save-picker-body">
          {loading && <p className="save-picker-status" role="status">Lettura salvataggi…</p>}
          {error && <p className="save-picker-status error" role="alert">{error}</p>}
          {!loading && !error && saves.length === 0 && <p className="save-picker-status">Non ci sono salvataggi disponibili.</p>}
          {!loading && !error && (
            <SavePickerList
              saves={saves}
              currentGameId={currentGameId}
              onSelect={onSelect}
              onRequestDelete={(save) => { setDeleteError(''); setNotice(''); setPendingDelete(save); }}
              deletingId={deletingId}
            />
          )}
          {notice && <p className="save-picker-status ok" role="status">{notice}</p>}
          {deleteError && <p className="save-picker-status error" role="alert">{deleteError}</p>}
        </div>
        <footer className="save-picker-footer">Il caricamento sostituisce lo stato locale con lo snapshot del salvataggio.</footer>
      </AccessibleDialog>

      {/* Conferma esplicita: azione distruttiva, mai al primo clic. */}
      <AccessibleDialog
        open={pendingDelete !== null}
        onClose={closeConfirm}
        overlayClassName="save-delete-overlay"
        className="save-delete-confirm"
        ariaLabel="Conferma eliminazione del salvataggio"
        initialFocusRef={cancelRef}
        closeOnBackdrop={!deletingId}
        closeOnEscape={!deletingId}
      >
        <h3>Eliminare il salvataggio?</h3>
        {pendingDelete && <p data-save-delete-target={pendingDelete.id}>{saveDeleteConfirmText(pendingDelete)}</p>}
        <div className="save-delete-actions">
          <button ref={cancelRef} type="button" className="save-delete-cancel" onClick={closeConfirm} disabled={deletingId !== null}>Annulla</button>
          <button
            type="button"
            className="save-delete-confirm-button"
            onClick={confirmDelete}
            disabled={deletingId !== null}
          >
            {deletingId ? 'Eliminazione…' : 'Elimina definitivamente'}
          </button>
        </div>
      </AccessibleDialog>
    </>
  );
}
