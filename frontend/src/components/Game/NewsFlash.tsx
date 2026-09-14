import { useRef } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import type { FeedItem } from './EventFeed';
import { publicNarrativeText } from '../../services/publicNarrative';
import { classifyDispatch } from './dispatchCategory';

interface NewsFlashProps {
  item: FeedItem | null;
  pendingCount: number;
  onClose: () => void;
  onNext: () => void;
  onOpenArchive: () => void;
  playerPolityName?: string;
}

const SECTION: Record<FeedItem['kind'], string> = {
  timeline: 'Archivio internazionale',
  world: 'Notizia dal mondo',
  live: 'Ultima ora',
};

/**
 * Presenta solo un dispaccio appena arrivato: non legge la timeline e non può
 * quindi anticipare eventi futuri. L'archivio completo resta nella HUD.
 */
export function NewsFlash({ item, pendingCount, onClose, onNext, onOpenArchive, playerPolityName }: NewsFlashProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  if (!item) return null;
  const category = classifyDispatch(item.text, item.detail);

  return (
    <AccessibleDialog
      open={true}
      onClose={onClose}
      overlayClassName="news-flash-overlay"
      className="news-flash"
      ariaLabelledBy="news-flash-title"
      initialFocusRef={closeButtonRef}
      closeOnBackdrop={false}
    >
        <header className="news-flash-header">
          <span className="news-flash-kicker">{SECTION[item.kind]}</span>
          <span className={`feed-item-badge cat-${category.key}`}>{category.label}</span>
          <span className="news-flash-date">{item.date || 'Ora'}</span>
        </header>
        <div className="news-flash-body">
          <span className="news-flash-mark" aria-hidden="true">▤</span>
          <h2 id="news-flash-title">{publicNarrativeText(item.text.replace(/^Evento \d+:\s*/, ''), playerPolityName)}</h2>
          <p>{item.detail
            ? publicNarrativeText(item.detail, playerPolityName)
            : 'Non sono ancora disponibili ulteriori particolari su questo sviluppo.'}</p>
        </div>
        <footer className="news-flash-footer">
          <button type="button" className="news-flash-archive" onClick={onOpenArchive}>Apri archivio</button>
          <span className="news-flash-pending">{pendingCount > 1 ? `${pendingCount - 1} aggiornamenti dopo questo` : 'Aggiornamento corrente'}</span>
          <div className="news-flash-actions">
            <button ref={closeButtonRef} type="button" className="news-flash-close" onClick={onClose}>Chiudi</button>
            {pendingCount > 1 && <button type="button" className="news-flash-next" onClick={onNext}>Prossima notizia →</button>}
          </div>
        </footer>
    </AccessibleDialog>
  );
}

export default NewsFlash;
