import { useEffect, useRef, useState } from 'react';
import { savesApi } from '../../services/api';
import { AccessibleDialog } from '../ui/AccessibleDialog';

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

const formatDate = (value?: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Data non disponibile';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
};

/** G5-B — unico picker read-only: la selezione non ripristina nulla finché non è confermata. */
export function SavePickerModal({ open, currentGameId, onSelect, onClose }: SavePickerModalProps) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    savesApi.list()
      .then(({ saves: data }) => {
        if (cancelled) return;
        const visible = (Array.isArray(data) ? data : [])
          .filter((save: any) => save?.id && save.name !== '__rewind__')
          .sort((a: any, b: any) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')));
        setSaves(visible);
      })
      .catch(() => { if (!cancelled) setError('Impossibile leggere i salvataggi. Riprova.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  return (
    <AccessibleDialog open={open} onClose={onClose} overlayClassName="save-picker-overlay" className="save-picker" ariaLabel="Carica un salvataggio" initialFocusRef={closeRef}>
      <header className="save-picker-header">
        <div><span>Archivio campagna</span><h2>Carica un salvataggio</h2></div>
        <button ref={closeRef} type="button" className="save-modal-close" onClick={onClose} aria-label="Chiudi archivio">×</button>
      </header>
      <div className="save-picker-body">
        {loading && <p className="save-picker-status" role="status">Lettura salvataggi…</p>}
        {error && <p className="save-picker-status error" role="alert">{error}</p>}
        {!loading && !error && saves.length === 0 && <p className="save-picker-status">Non ci sono salvataggi disponibili.</p>}
        {!loading && !error && saves.map((save) => (
          <button key={save.id} type="button" className="save-picker-item" onClick={() => onSelect(save)}>
            <span className="save-picker-item-main"><b>{save.name || 'Salvataggio senza nome'}</b><small>{save.game_id === currentGameId ? 'Partita attuale' : 'Un’altra partita'}</small></span>
            <span className="save-picker-item-meta">Mossa {save.current_turn ?? '—'} · {formatDate(save.current_date)}</span>
          </button>
        ))}
      </div>
      <footer className="save-picker-footer">Il caricamento sostituisce lo stato locale con lo snapshot del salvataggio.</footer>
    </AccessibleDialog>
  );
}
