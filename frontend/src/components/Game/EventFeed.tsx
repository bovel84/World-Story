/**
 * Open-Pax — EventFeed (Cronaca live)
 * ====================================
 * Feed degli eventi SEMPRE in vista, sovrapposto alla mappa:
 * accumula gli eventi di tutti i turni (azione del giocatore + simulazione
 * live del mondo) ed evidenzia quelli della nazione in focus.
 * Collapsabile in una linguetta per non ostacolare la vista.
 */

import { useEffect, useRef, useState } from 'react';

export interface FeedItem {
  id: string;
  date?: string;
  text: string;
  /** Corpo completo del dispaccio, quando disponibile dalla timeline/LLM. */
  detail?: string;
  kind: 'timeline' | 'world' | 'live';
}

const ARTICLE_SECTION: Record<FeedItem['kind'], string> = {
  timeline: 'Archivio internazionale',
  world: 'Edizione del mondo',
  live: 'Ultima ora',
};

interface EventFeedProps {
  items: FeedItem[];
  processing: boolean;
  open: boolean;
  onToggleOpen: () => void;
  focusedRegionName?: string;
}

export function EventFeed({
  items,
  processing,
  open,
  onToggleOpen,
  focusedRegionName,
}: EventFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const [openArticle, setOpenArticle] = useState<FeedItem | null>(null);

  // Auto-scroll: resta in coda (ultimi eventi in basso) solo se l'utente
  // non ha scrollato indietro manualmente.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, open]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    if (!openArticle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenArticle(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openArticle]);

  if (!open) {
    return (
      <button
        className="event-feed-collapsed-tab"
        onClick={onToggleOpen}
        title="Apri la cronaca degli eventi"
      >
        <span className="event-feed-tab-label">Dispacci</span>
        {items.length > 0 && <span className="feed-count">{items.length}</span>}
        {processing && <span className="feed-live-dot" />}
        <span className="event-feed-tab-arrow" aria-hidden="true">+</span>
      </button>
    );
  }

  return (
    <aside className="event-feed" aria-label="Dispacci del mondo">
      <div className="event-feed-header">
        <span className="event-feed-title">
          Dispacci
          {processing && <span className="feed-live-dot" title="Elaborazione in corso" />}
        </span>
        <div className="event-feed-actions">
          <span className="btn-feed-live" title="Il tempo avanza solo con un comando manuale">
            tempo manuale
          </span>
          <button
            className="btn-feed-collapse"
            onClick={onToggleOpen}
            title="Riduci la cronaca"
            aria-label="Riduci la cronaca"
          >
            ×
          </button>
        </div>
      </div>

      {focusedRegionName && (
        <div className="event-feed-focus">
In evidenza: <b>{focusedRegionName}</b>
        </div>
      )}

      <div className="event-feed-list" ref={listRef} onScroll={handleScroll}>
        {items.length === 0 ? (
          <div className="event-feed-empty">
In attesa del prossimo dispaccio. Invia un ordine per registrare le sue conseguenze nel mondo.
          </div>
        ) : (
          items.map((item) => {
            const isFocus = !!focusedRegionName && item.text.includes(focusedRegionName);
            return (
              <button
                key={item.id}
                type="button"
                className={`event-feed-item kind-${item.kind}${isFocus ? ' focused' : ''}`}
                onClick={() => setOpenArticle(item)}
                aria-label={`Apri il dispaccio: ${item.text}`}
              >
                <span className="feed-item-date">{item.date || 'Archivio'}</span>
                <span className="feed-item-text">{item.text}</span>
              </button>
            );
          })
        )}
      </div>

      {openArticle && (
        <div className="article-overlay" role="presentation" onMouseDown={() => setOpenArticle(null)}>
          <article
            className="newspaper-article"
            role="dialog"
            aria-modal="true"
            aria-labelledby="article-headline"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="newspaper-article-header">
              <div className="newspaper-masthead">Open-Pax · Gazzetta del Mondo</div>
              <div className="newspaper-article-meta">
                <span>{ARTICLE_SECTION[openArticle.kind]}</span>
                <span>{openArticle.date || 'Data non registrata'}</span>
              </div>
              <button type="button" className="newspaper-article-close" onClick={() => setOpenArticle(null)}>
                Chiudi
              </button>
            </header>
            <div className="newspaper-article-body">
              <p className="newspaper-article-kicker">Dispaccio verificato</p>
              <h1 id="article-headline">{openArticle.text.replace(/^Evento \d+:\s*/, '')}</h1>
              <div className="newspaper-article-rule" />
              <p className="newspaper-article-lead">
                {openArticle.detail || 'Il fatto è stato registrato nella cronaca del turno. Le conseguenze saranno riportate nei prossimi dispacci del mondo.'}
              </p>
              <p className="newspaper-article-byline">Redazione politica · Archivio della simulazione</p>
            </div>
          </article>
        </div>
      )}
    </aside>
  );
}