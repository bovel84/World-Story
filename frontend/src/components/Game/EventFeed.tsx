/**
 * World Story — EventFeed (Cronaca live)
 * ====================================
 * Feed degli eventi SEMPRE in vista, sovrapposto alla mappa:
 * accumula gli eventi di tutti i turni (azione del giocatore + simulazione
 * live del mondo) ed evidenzia quelli della nazione in focus.
 * Collapsabile in una linguetta per non ostacolare la vista.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

function formatFeedDate(value?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Archivio';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

interface EventFeedProps {
  items: FeedItem[];
  processing: boolean;
  focusedRegionName?: string;
}

export function EventFeed({
  items,
  processing,
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

  // L'archivio è una scheda della scrivania di comando (come Chat,
  // Consulente e Ordini), non una finestra sovrapposta alla mappa.
  return (
      <section className="world-news-panel" aria-label="Dispacci del mondo">
      <div className="event-feed-header">
        <span className="event-feed-title">
          Dispacci del mondo
          <span className="event-feed-readonly">archivio della simulazione</span>
          {processing && <span className="feed-live-dot" title="Elaborazione in corso" />}
        </span>
        <span className="btn-feed-live" title="Il tempo avanza solo con un comando manuale">
          tempo manuale
        </span>
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
                <span className="feed-item-date">{formatFeedDate(item.date)}</span>
                <span className="feed-item-text">{item.text}</span>
              </button>
            );
          })
        )}
      </div>

      {openArticle && createPortal(
        <div className="article-overlay" role="presentation" onMouseDown={() => setOpenArticle(null)}>
          <article
            className="newspaper-article"
            role="dialog"
            aria-modal="true"
            aria-labelledby="article-headline"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="newspaper-article-header">
              <div className="newspaper-masthead">World Story · Archivio</div>
              <div className="newspaper-article-meta">
                <span>{ARTICLE_SECTION[openArticle.kind]}</span>
                <span>{formatFeedDate(openArticle.date)}</span>
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
              <p className="newspaper-article-byline">Archivio della simulazione · Consultazione senza effetti sul mondo</p>
            </div>
          </article>
        </div>,
        document.body,
      )}
      </section>
  );
}