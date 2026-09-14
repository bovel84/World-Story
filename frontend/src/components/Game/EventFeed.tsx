/**
 * World Story — EventFeed (Cronaca live)
 * ====================================
 * Feed degli eventi SEMPRE in vista, sovrapposto alla mappa:
 * accumula gli eventi di tutti i turni (azione del giocatore + simulazione
 * live del mondo) ed evidenzia quelli della nazione in focus.
 * Collapsabile in una linguetta per non ostacolare la vista.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { publicNarrativeText } from '../../services/publicNarrative';
import { classifyDispatch } from './dispatchCategory';

export interface FeedItem {
  id: string;
  date?: string;
  text: string;
  /** Corpo completo del dispaccio, quando disponibile dalla timeline/LLM. */
  detail?: string;
  kind: 'timeline' | 'world' | 'live';
  /** G4-C: regioni toccate dall'evento, per «Mostra sulla mappa». */
  regionIds?: string[];
  /** Letto dal giocatore: i dispacci nuovi arrivano senza questo flag. */
  read?: boolean;
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
  /** G4-C: seleziona una regione sulla mappa e chiude l'articolo. */
  onFocusRegion?: (regionId: string) => void;
  /** Segna un singolo dispaccio come letto (all'apertura dell'articolo). */
  onMarkRead?: (id: string) => void;
  /** Segna tutti i dispacci come letti. */
  onMarkAllRead?: () => void;
  /** La persona al comando compare sempre come la nazione governata. */
  playerPolityName?: string;
}

export function EventFeed({
  items,
  processing,
  focusedRegionName,
  onFocusRegion,
  onMarkRead,
  onMarkAllRead,
  playerPolityName,
}: EventFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const closeArticleRef = useRef<HTMLButtonElement>(null);
  const [openArticle, setOpenArticle] = useState<FeedItem | null>(null);
  const unreadCount = items.reduce((total, item) => total + (item.read ? 0 : 1), 0);

  const openItem = (item: FeedItem) => {
    setOpenArticle(item);
    if (!item.read) onMarkRead?.(item.id);
  };

  // Auto-scroll: resta in coda (ultimi eventi in basso) solo se l'utente
  // non ha scrollato indietro manualmente.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // L'archivio è una scheda della scrivania di comando (come Chat,
  // Consulente e Ordini), non una finestra sovrapposta alla mappa.
  return (
      <section className="world-news-panel" aria-label="Dispacci del mondo">
      <div className="event-feed-header">
        <span className="event-feed-title">
          Dispacci del mondo
          <span className="event-feed-readonly">cronaca internazionale</span>
          {processing && <span className="feed-live-dot" title="Elaborazione in corso" />}
        </span>
        <span className="btn-feed-live" title="Il tempo avanza solo con un comando manuale">
          tempo manuale
        </span>
      </div>

      {(unreadCount > 0 || items.length > 0) && (
        <div className="event-feed-unread-bar">
          {unreadCount > 0 ? (
            <span className="event-feed-unread-count" role="status">
              <span className="event-feed-unread-dot" aria-hidden="true" />
              {unreadCount === 1 ? '1 dispaccio da leggere' : `${unreadCount} dispacci da leggere`}
            </span>
          ) : (
            <span className="event-feed-unread-count read-all">Tutti i dispacci letti</span>
          )}
          {unreadCount > 0 && onMarkAllRead && (
            <button type="button" className="event-feed-mark-all" onClick={onMarkAllRead}>
              Segna tutti come letti
            </button>
          )}
        </div>
      )}

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
            const publicHeadline = publicNarrativeText(item.text, playerPolityName);
            const category = classifyDispatch(item.text, item.detail);
            const isFocus = !!focusedRegionName && publicHeadline.includes(focusedRegionName);
            const unread = !item.read;
            return (
              <button
                key={item.id}
                type="button"
                className={`event-feed-item kind-${item.kind} cat-${category.key}${isFocus ? ' focused' : ''}${unread ? ' unread' : ''}`}
                onClick={() => openItem(item)}
                aria-label={`${unread ? 'Non letto. ' : ''}[${category.label}] Apri il dispaccio: ${publicHeadline}`}
              >
                <span className="feed-item-date">{formatFeedDate(item.date)}</span>
                <span className="feed-item-text">
                  <span className={`feed-item-badge cat-${category.key}`}>{category.label}</span>
                  {publicHeadline}
                </span>
                {unread && <span className="feed-item-new" title="Da leggere">NUOVO</span>}
              </button>
            );
          })
        )}
      </div>

      {openArticle && (() => {
        const articleCategory = classifyDispatch(openArticle.text, openArticle.detail);
        return (
        <AccessibleDialog
          open={true}
          onClose={() => setOpenArticle(null)}
          overlayClassName="article-overlay"
          className="newspaper-article"
          ariaLabelledBy="article-headline"
          initialFocusRef={closeArticleRef}
        >
            <header className="newspaper-article-header">
              <div className="newspaper-masthead">World Story · Archivio</div>
              <div className="newspaper-article-meta">
                <span>{ARTICLE_SECTION[openArticle.kind]}</span>
                <span className={`feed-item-badge cat-${articleCategory.key}`}>
                  {articleCategory.label}
                </span>
                <span>{formatFeedDate(openArticle.date)}</span>
              </div>
              <button ref={closeArticleRef} type="button" className="newspaper-article-close" onClick={() => setOpenArticle(null)}>
                Chiudi
              </button>
            </header>
            <div className="newspaper-article-body">
              <p className="newspaper-article-kicker">Corrispondenza</p>
              <h1 id="article-headline">{publicNarrativeText(openArticle.text.replace(/^Evento \d+:\s*/, ''), playerPolityName)}</h1>
              <div className="newspaper-article-rule" />
              {openArticle.detail ? (
                <p className="newspaper-article-why" role="note">
                  <span className="article-why-label">Perché è accaduto:</span>{' '}
                  {publicNarrativeText(openArticle.detail, playerPolityName)}
                </p>
              ) : (
                <p className="newspaper-article-lead">
                  Non sono ancora disponibili ulteriori particolari su questo sviluppo.
                </p>
              )}
              {openArticle.regionIds?.length ? (
                <div className="newspaper-article-actions">
                  <button
                    type="button"
                    className="btn-article-show-map"
                    onClick={() => {
                      onFocusRegion?.(openArticle.regionIds![0]);
                      setOpenArticle(null);
                    }}
                  >
                    Mostra sulla mappa
                  </button>
                </div>
              ) : null}
              <p className="newspaper-article-byline">World Story · Redazione internazionale</p>
            </div>
        </AccessibleDialog>
        );
      })()}
      </section>
  );
}