import { useEffect, useRef, useState } from 'react';
import { savesApi } from '../../services/api';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { SaveDeleteConfirmDialog } from './SaveDeleteConfirmDialog';
import { isReservedSave } from './reservedSaves';
import {
  formatSaveDate,
  removeSaveFromList,
  saveDeleteLabel,
  saveTitle,
  useSaveDeletion,
  visibleSaves,
  type SaveSummary,
} from './saveDeletion';

// Meccanismo di eliminazione condiviso con la home (`saveDeletion.ts`):
// gli helper restano esportati da qui per compatibilità degli import esistenti.
export {
  DELETE_SAVE_ERROR,
  DELETE_SAVE_RESERVED_ERROR,
  formatSaveDate,
  removeSaveFromList,
  saveDeleteConfirmText,
  saveDeleteLabel,
  saveDeletedNotice,
  saveTitle,
  visibleSaves,
  type SaveSummary,
} from './saveDeletion';

const formatDate = formatSaveDate;

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

interface SavePickerModalProps {
  open: boolean;
  currentGameId?: string;
  onSelect: (save: SaveSummary) => void;
  onClose: () => void;
}

/**
 * G5-B — picker dei salvataggi: la selezione non ripristina nulla finché non è
 * confermata. `DELETE-SAVES`: ogni salvataggio non riservato può essere
 * eliminato **dopo conferma esplicita**; l'eliminazione non tocca la partita.
 * Conferma e cancellazione sono quelle condivise (`useSaveDeletion` +
 * `SaveDeleteConfirmDialog`), le stesse usate dalla home.
 */
export function SavePickerModal({ open, currentGameId, onSelect, onClose }: SavePickerModalProps) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const deletion = useSaveDeletion((save) => setSaves((current) => removeSaveFromList(current, save.id)));
  const { reset: resetDeletion } = deletion;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    resetDeletion();
    savesApi.list()
      .then(({ saves: data }) => {
        if (cancelled) return;
        setSaves(visibleSaves(data));
      })
      .catch(() => { if (!cancelled) setError('Impossibile leggere i salvataggi. Riprova.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, resetDeletion]);

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
        closeOnBackdrop={deletion.pending === null}
        closeOnEscape={deletion.pending === null}
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
              onRequestDelete={deletion.request}
              deletingId={deletion.deletingId}
            />
          )}
          {deletion.notice && <p className="save-picker-status ok" role="status">{deletion.notice}</p>}
          {deletion.error && <p className="save-picker-status error" role="alert">{deletion.error}</p>}
        </div>
        <footer className="save-picker-footer">Il caricamento sostituisce lo stato locale con lo snapshot del salvataggio.</footer>
      </AccessibleDialog>

      {/* Conferma esplicita: azione distruttiva, mai al primo clic. */}
      <SaveDeleteConfirmDialog
        save={deletion.pending}
        busy={deletion.deletingId !== null}
        onCancel={deletion.cancel}
        onConfirm={deletion.confirm}
      />
    </>
  );
}
