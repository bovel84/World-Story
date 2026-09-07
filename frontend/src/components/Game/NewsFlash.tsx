import type { FeedItem } from './EventFeed';

interface NewsFlashProps {
  item: FeedItem | null;
  pendingCount: number;
  onClose: () => void;
  onNext: () => void;
  onOpenArchive: () => void;
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
export function NewsFlash({ item, pendingCount, onClose, onNext, onOpenArchive }: NewsFlashProps) {
  if (!item) return null;

  return (
    <div className="news-flash-overlay" role="presentation">
      <article className="news-flash" role="dialog" aria-modal="true" aria-labelledby="news-flash-title">
        <header className="news-flash-header">
          <span className="news-flash-kicker">{SECTION[item.kind]}</span>
          <span className="news-flash-date">{item.date || 'Ora'}</span>
        </header>
        <div className="news-flash-body">
          <span className="news-flash-mark" aria-hidden="true">▤</span>
          <h2 id="news-flash-title">{item.text.replace(/^Evento \d+:\s*/, '')}</h2>
          <p>{item.detail || 'Il fatto è stato registrato nella cronaca del mondo. Le sue conseguenze emergeranno con i prossimi aggiornamenti.'}</p>
        </div>
        <footer className="news-flash-footer">
          <button type="button" className="news-flash-archive" onClick={onOpenArchive}>Apri archivio</button>
          <span className="news-flash-pending">{pendingCount > 1 ? `${pendingCount - 1} aggiornamenti dopo questo` : 'Aggiornamento corrente'}</span>
          <div className="news-flash-actions">
            <button type="button" className="news-flash-close" onClick={onClose}>Chiudi</button>
            {pendingCount > 1 && <button type="button" className="news-flash-next" onClick={onNext}>Prossima notizia →</button>}
          </div>
        </footer>
      </article>
    </div>
  );
}

export default NewsFlash;
