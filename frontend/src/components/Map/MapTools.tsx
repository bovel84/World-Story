import { useId, useMemo, useRef, useState } from 'react';
import type { Region } from '../../types';
import { buildMapSearchIndex, searchMap, type MapSearchEntry } from './mapModel';

interface MapToolsProps {
  regions: Region[];
  recentRegionIds: string[];
  ready: boolean;
  hasPlayer: boolean;
  onLocate: (entry: MapSearchEntry) => void;
  onWorld: () => void;
  onPlayer: () => void;
}

/** Native inputs/buttons keep search fully usable without a canvas or mouse. */
export function MapTools({ regions, recentRegionIds, ready, hasPlayer, onLocate, onWorld, onPlayer }: MapToolsProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const index = useMemo(() => buildMapSearchIndex(regions), [regions]);
  const matches = useMemo(() => searchMap(index, query), [index, query]);
  const recent = useMemo(() => recentRegionIds.flatMap(id => {
    const entry = index.find(item => item.id === id);
    return entry ? [entry] : [];
  }), [index, recentRegionIds]);
  const results = showChanges ? recent : matches;
  const close = () => { setOpen(false); setShowChanges(false); };
  const locate = (entry: MapSearchEntry) => {
    onLocate(entry);
    close();
    setQuery('');
    input.current?.focus();
    // Focus should not reopen the results after choosing a destination.
    setOpen(false);
  };

  return (
    <section className="map-tools" aria-label="Esplora la mappa" onKeyDown={event => {
      if (event.key === 'Escape') { close(); input.current?.focus(); setOpen(false); }
    }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
    }}>
      <form className="map-search" role="search" onSubmit={event => {
        event.preventDefault();
        if (results[0]) locate(results[0]);
      }}>
        <span aria-hidden="true">⌕</span>
        <input ref={input} type="search" aria-label="Cerca territorio o città"
          placeholder="Cerca luoghi, unità e cantieri…" value={query} disabled={!ready}
          aria-description="Cerca anche unità militari, mobilitazioni e cantieri per nome."
          aria-controls={open ? resultsId : undefined} autoComplete="off"
          onFocus={() => { if (query) setOpen(true); }}
          onChange={event => { setQuery(event.target.value); setShowChanges(false); setOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              document.getElementById(resultsId)?.querySelector<HTMLButtonElement>('li button')?.focus();
            }
          }} />
      </form>
      <div className="map-shortcuts" aria-label="Navigazione rapida">
        <button type="button" onClick={onWorld} disabled={!ready} title="Mostra tutto il mondo (0 con il focus sulla mappa)">◎ Mondo</button>
        <button type="button" onClick={onPlayer} disabled={!ready || !hasPlayer}>⌂ La mia nazione</button>
        <button type="button" className="map-changes-button" disabled={!ready || !recent.length}
          aria-expanded={open && showChanges} aria-controls={open && showChanges ? resultsId : undefined}
          onClick={() => { setOpen(!(open && showChanges)); setShowChanges(true); }}>
          <span className="map-change-dot" aria-hidden="true" /> Modifiche {recent.length > 0 ? recent.length : ''}
        </button>
      </div>
      {open && (query.trim() || showChanges) && (
        <div className="map-search-results" id={resultsId}>
          <div className="map-results-heading">
            <strong>{showChanges ? 'Ultimi territori aggiornati' : 'Risultati sulla mappa'}</strong>
            <button type="button" aria-label="Chiudi risultati" onClick={close}>×</button>
          </div>
          <p className="map-results-count" role="status">{results.length
            ? `${results.length}${!showChanges && results.length === 12 ? '+' : ''} risultati · seleziona per raggiungere il luogo`
            : 'Nessun luogo trovato. Prova un altro nome.'}</p>
          <ul>
            {results.map(entry => <li key={entry.id}>
              <button type="button" onClick={() => locate(entry)}>
                <span>{entry.name}<small>{entry.context}</small></span><span aria-hidden="true">↗</span>
              </button>
            </li>)}
          </ul>
          {showChanges && <p className="map-results-count">Ultimi 20 territori segnalati durante questa sessione. Zoom e posizione restano invariati agli aggiornamenti.</p>}
        </div>
      )}
    </section>
  );
}
