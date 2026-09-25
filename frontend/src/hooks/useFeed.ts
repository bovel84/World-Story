/**
 * World Story — Fase 2: `useFeed`
 * ==============================
 * La cronaca live — dispacci, coda delle notizie «arrivate ora», stato di
 * lettura — era un blocco di stato e callback in `App.tsx`. Questo hook lo
 * possiede, con lo stesso contratto:
 *
 *  - gli eventi con ID canonico del server non vengono duplicati (replay SSE,
 *    riconnessioni e refetch restano innocui);
 *  - il feed conserva gli ultimi 120 eventi;
 *  - solo il flusso annunciato mette la notizia in primo piano: l'archivio
 *    ricaricato dalla timeline non riapre vecchi dispacci;
 *  - al cambio partita feed, coda e memo degli annunci ripartono puliti.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameApi, type TimelineEntry } from '../services/api';
import type { FeedItem } from '../components/Game/EventFeed';
import { countUnread, markItemRead, markAllRead } from '../components/Game/feedUnread';
import { useGameStore } from '../stores/gameStore';

export interface UseFeedOptions {
  gameId: string | null;
  /** Setter della timeline: il preload della cronaca la riallinea insieme al feed. */
  setTimeline: React.Dispatch<React.SetStateAction<TimelineEntry[]>>;
}

export interface Feed {
  feedItems: FeedItem[];
  setFeedItems: React.Dispatch<React.SetStateAction<FeedItem[]>>;
  newsQueue: FeedItem[];
  newsOpen: boolean;
  unreadFeedCount: number;
  pushFeed: (
    text: string,
    kind: FeedItem['kind'],
    date?: string,
    detail?: string,
    eventId?: string,
    announce?: boolean,
    regionIds?: string[],
    /** ID degli ordini da cui nasce il dispaccio (§3.2/8). */
    sourceActionIds?: string[],
  ) => void;
  /** Traduce gli ID degli ordini nel loro testo (§3.2/8). */
  actionTextFor: (sourceActionIds?: string[]) => string | undefined;
  publishEventDetails: (details: any[]) => void;
  markFeedRead: (id: string) => void;
  markAllFeedRead: () => void;
  dismissNews: (showNext: boolean) => void;
}

export function useFeed({ gameId, setTimeline }: UseFeedOptions): Feed {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  /** Dispacci arrivati ora: mostrati uno per volta, mai dalla timeline storica. */
  const [newsQueue, setNewsQueue] = useState<FeedItem[]>([]);
  const [newsOpen, setNewsOpen] = useState(false);
  const announcedNewsIdsRef = useRef(new Set<string>());

  /**
   * Risolve gli ID degli ordini nel loro testo, leggendo la **coda autorevole**
   * (RAM e DB). È l'ultimo miglio del «Perché è accaduto»: il motore collega il
   * dispaccio all'ordine per ID, e qui l'ID diventa la frase che il giocatore
   * aveva scritto. Se la coda non contiene più l'ordine (è già stato emesso e
   * rimosso), il testo non si inventa: la sezione resta nascosta.
   */
  const actionTextFor = useCallback((sourceActionIds?: string[]): string | undefined => {
    if (!sourceActionIds?.length) return undefined;
    const coda = useGameStore.getState().pendingActions || [];
    const testi = coda
      .filter((action: { id?: string; text?: string }) => sourceActionIds.includes(String(action.id)))
      .map((action: { text?: string }) => String(action.text || '').trim())
      .filter(Boolean);
    return testi.length ? testi.join(' · ') : undefined;
  }, []);

  const pushFeed = useCallback((
    text: string,
    kind: FeedItem['kind'],
    date?: string,
    detail?: string,
    eventId?: string,
    announce = true,
    regionIds?: string[],
    /**
     * §3.2/8: gli ID degli ordini da cui nasce il dispaccio. Il testo si
     * risolve dalla coda, che è la sola fonte del testo originale dell'ordine
     * (mai ricostruito dal titolo del dispaccio).
     */
    sourceActionIds?: string[],
  ) => {
    const actionText = actionTextFor(sourceActionIds);
    // Gli eventi provenienti dal server hanno un ID stabile: riusarlo rende
    // innocui replay SSE, riconnessioni e refetch della cronaca.
    const item: FeedItem = {
      id: eventId ? `tl-${eventId}` : `f${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      kind,
      date,
      detail,
      regionIds: regionIds?.length ? regionIds : undefined,
      actionText: actionText?.trim() ? actionText : undefined,
      // Ogni nuovo dispaccio arriva da leggere; l'archivio viene marcato letto
      // al pre-caricamento della timeline.
      read: false,
    };
    setFeedItems(prev => {
      if (eventId && prev.some(existing => existing.id === item.id)) return prev;
      const next = [...prev, item];
      // Cap: tieni gli ultimi 120 eventi
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
    // Solo il flusso live/SSE mette la notizia in primo piano. La timeline
    // ricaricata è archivio e non deve riaprire vecchie notizie.
    if (announce && !announcedNewsIdsRef.current.has(item.id)) {
      announcedNewsIdsRef.current.add(item.id);
      setNewsQueue(prev => [...prev, item]);
      setNewsOpen(true);
    }
  }, [actionTextFor]);

  useEffect(() => {
    announcedNewsIdsRef.current.clear();
    setNewsQueue([]);
    setNewsOpen(false);
    setFeedItems([]); // la cronaca riparte dalla timeline della nuova partita
  }, [gameId]);

  // Al cambio partita: prediscarica la cronaca storica dalla timeline e la
  // tiene allineata ogni 15s (recupero affidabile quando lo stream SSE viene
  // chiuso dal proxy; i dispacci già presenti conservano lo stato di lettura).
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    const refreshTimeline = () => gameApi.timeline(gameId)
      .then(data => {
        if (cancelled) return;
        const items: FeedItem[] = [];
        for (const entry of data.timeline || []) {
          for (const ev of entry.events || []) {
            items.push({
              id: `tl-${ev.id}`,
              date: ev.date,
              text: ev.headline,
              detail: ev.detail || entry.narration,
              kind: 'timeline',
              read: true,
              // Il collegamento all'ordine viaggia anche nell'archivio: la
              // Timeline espone `sourceActionIds` per evento.
              actionText: actionTextFor(ev.sourceActionIds),
            });
          }
        }
        setTimeline(data.timeline || []);
        setFeedItems(prev => {
          const byId = new Map(prev.map(item => [item.id, item]));
          for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
          return [...byId.values()].slice(-120);
        });
      })
      .catch(e => console.warn('[App] Feed: impossibile aggiornare la timeline:', e));
    void refreshTimeline();
    const timer = window.setInterval(() => void refreshTimeline(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [gameId, setTimeline]);

  /** Riconcilia i dettagli restituiti via HTTP con lo stesso feed dell'SSE.
   * Gli ID canonici rendono innocui ordine di arrivo e duplicati per azione. */
  const publishEventDetails = useCallback((details: any[]) => {
    const unique = new Map<string, any>();
    for (const detail of details || []) {
      if (!detail?.headline) continue;
      const key = detail.id || `${detail.date || ''}|${detail.headline}`;
      if (!unique.has(key)) unique.set(key, detail);
    }
    for (const detail of unique.values()) {
      pushFeed(detail.headline, 'world', detail.date, detail.detail, detail.id, true, undefined, detail.sourceActionIds);
    }
  }, [pushFeed]);

  /** Segna un dispaccio come letto (apertura articolo o dismissione notizia). */
  const markFeedRead = useCallback((id: string) => {
    setFeedItems(prev => markItemRead(prev, id));
  }, []);

  /** «Segna tutti come letti» dal pannello Dispacci. */
  const markAllFeedRead = useCallback(() => {
    setFeedItems(prev => markAllRead(prev));
  }, []);

  const dismissNews = (showNext: boolean) => {
    const current = newsQueue[0];
    if (current) markFeedRead(current.id);
    const hasNext = newsQueue.length > 1;
    setNewsQueue(prev => prev.slice(1));
    setNewsOpen(showNext && hasNext);
  };

  /** Dispacci ancora da leggere: il badge della HUD mostra questo, non il totale. */
  const unreadFeedCount = useMemo(() => countUnread(feedItems), [feedItems]);

  return {
    feedItems,
    setFeedItems,
    newsQueue,
    newsOpen,
    unreadFeedCount,
    pushFeed,
    /** Traduce gli ID degli ordini nel loro testo (§3.2/8). */
    actionTextFor,
    publishEventDetails,
    markFeedRead,
    markAllFeedRead,
    dismissNews,
  };
}
