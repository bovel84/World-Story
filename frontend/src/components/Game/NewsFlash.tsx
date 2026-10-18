import { useRef, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import type { FeedItem } from './EventFeed';
import { publicNarrativeText } from '../../services/publicNarrative';
import { classifyDispatch } from './dispatchCategory';
import { compactEventText } from './compactEventText';

interface NewsFlashProps {
  item: FeedItem | null;
  pendingCount: number;
  onClose: () => void;
  onNext: () => void;
  onOpenArchive: () => void;
  playerPolityName?: string;
  locationLabel?: string;
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
export function NewsFlash({ item, pendingCount, onClose, onNext, onOpenArchive, playerPolityName, locationLabel }: NewsFlashProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!item) return null;
  const category = classifyDispatch(item.text, item.detail);
  const headline = compactEventText(publicNarrativeText(item.text.replace(/^Evento \\d+:\\s*/, ''), playerPolityName), 105);
  const detail = compactEventText(
    item.detail ? publicNarrativeText(item.detail, playerPolityName) : 'Non sono ancora disponibili ulteriori particolari su questo sviluppo.',
    240,
  );
  const expanded = expandedId === item.id;
  const canExpand = headline.shortened || detail.shortened;

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
          {locationLabel && <span className="simulation-reader-location">{locationLabel}</span>}
        </header>
        <div className="news-flash-body">
          <span className="news-flash-mark" aria-hidden="true">▤</span>
          <h2 id="news-flash-title">{expanded ? publicNarrativeText(item.text.replace(/^Evento \\d+:\\s*/, ''), playerPolityName) : headline.text}</h2>
          <p>{expanded && item.detail ? publicNarrativeText(item.detail, playerPolityName) : detail.text}</p>
          {canExpand && (
            <button type="button" className="news-flash-more" aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : item.id)}>
              {expanded ? 'Mostra meno' : 'Leggi tutto'}
            </button>
          )}
          {/* §3.2/8: l'ordine da cui nasce il dispaccio, quando esiste. Nel
              focolaio centrale il giocatore vede subito la causa che ha voluto;
              un dispaccio del mondo non ne ha e il blocco non compare. */}
          {item.actionText ? (
            <details className="news-flash-order" role="note">
              <summary>L'ordine che ha generato la notizia</summary>
              <p>{publicNarrativeText(item.actionText, playerPolityName)}</p>
            </details>
          ) : null}
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
