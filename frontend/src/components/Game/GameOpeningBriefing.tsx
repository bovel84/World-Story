/**
 * WS-GAME-OPENING — L'apertura: il dossier di insediamento
 * =========================================================
 * Cinque pagine discrete — IL MONDO, IL PAESE, IL QUADRO, IL CONSIGLIO,
 * ORA TOCCA A TE — sopra la mappa già montata da `GameScreen` (che resta visibile
 * dietro il velo: la mappa "racconta", non cambia stato).
 *
 * Non è un tutorial e non è un wizard: niente «step 1 di 5», niente «next»,
 * niente missioni. Le tre porte finali sono **ingressi** alla libertà, non
 * obiettivi obbligatori. Tutto il testo viene dal read model `openingBriefing`
 * (proiezione del preset e dei read model del motore): qui c'è solo resa.
 *
 * L'overlay usa `AccessibleDialog` (portal, focus trap, Esc, sfondo inerte):
 * nessuna seconda implementazione di dialogo nel modulo.
 */
import { useCallback, useMemo, useEffect, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { buildStaticMap } from '../Map/staticMapModel';
import type { Region } from '../../types';
import type { GameOpeningBriefing } from './openingBriefing';

export type OpeningDoor = 'orders' | 'map' | 'advisor';

export interface GameOpeningBriefingProps {
  briefing: GameOpeningBriefing;
  /** Chiude l'apertura. `door` è la porta scelta (o `undefined` = entra diretto). */
  onFinish: (door?: OpeningDoor) => void;
  /** Salta l'intero briefing senza aprire nulla. */
  onSkip: () => void;
  /** Pagina iniziale (default 0). Serve anche ai test statici delle 5 pagine. */
  initialPage?: number;
  /** Geografia già letta dal motore: la mini-mappa della pagina Paese (§11–§12). */
  mapRegions?: readonly Region[];
  /** Regioni del paese del giocatore da evidenziare (mai una mutazione). */
  highlightRegionIds?: readonly string[];
}

export const OPENING_PAGES = ['IL MONDO', 'IL PAESE', 'IL QUADRO', 'IL CONSIGLIO', 'ORA TOCCA A TE'] as const;

const SYMBOL: Record<string, string> = { problem: '⚠', opportunity: '↑', neutral: '●' };

function SymbolGlyph({ symbol }: { symbol: string }) {
  return <span className={`opening-symbol opening-symbol-${symbol}`} aria-hidden="true">{SYMBOL[symbol] ?? '●'}</span>;
}

/**
 * La mini-mappa della pagina Paese: sola **presentazione** della geografia già
 * letta dal motore (`buildStaticMap`, read model puro). Nessun `onRegionClick`,
 * nessuna mutazione: evidenzia il paese del giocatore e lascia il resto in
 * secondo piano. Se il mondo non ha geometria disegnabile, lo dichiara.
 */
function OpeningMap({ regions, highlightRegionIds }: {
  regions: readonly Region[];
  highlightRegionIds: readonly string[];
}) {
  const model = useMemo(() => buildStaticMap(regions), [regions]);
  const highlighted = useMemo(() => new Set(highlightRegionIds), [highlightRegionIds]);
  if (model.paths.length === 0) {
    return <p className="opening-prose opening-empty">La geografia di questo mondo non è disegnabile: la mappa resta nel dossier.</p>;
  }
  return (
    <div className="opening-map" role="group" aria-label="Il tuo paese sulla mappa">
      <p className="opening-sub">IL TUO PAESE SULLA MAPPA</p>
      <svg viewBox={`0 0 ${model.width} ${model.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Mappa politica di ${model.paths.length} province`}>
        {model.paths.map(entry => {
          const on = highlighted.has(entry.id);
          return (
            <path
              key={entry.id}
              d={entry.path}
              fill={entry.color}
              fillOpacity={on ? 1 : 0.45}
              stroke={on ? '#cda65b' : '#0a0a0f'}
              strokeWidth={on ? 2 : 0.4}
            >
              <title>{`${entry.name} — ${entry.owner}`}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Il contenuto del dossier, senza semantica di dialogo: lo monta l'overlay
 * accessibile e lo monta il test statico. Stato locale alla pagina corrente.
 */
export function OpeningPanelContent({ briefing, onFinish, onSkip, initialPage = 0, mapRegions, highlightRegionIds }: GameOpeningBriefingProps) {
  const [page, setPage] = useState(() => Math.max(0, Math.min(OPENING_PAGES.length - 1, initialPage)));

  const last = OPENING_PAGES.length - 1;
  const dateLabel = briefing.world.dateLabel || briefing.world.date;

  const goNext = useCallback(() => setPage(value => Math.min(last, value + 1)), [last]);
  const goPrev = useCallback(() => setPage(value => Math.max(0, value - 1)), []);

  // Le frecce navigano; Esc lo gestisce `AccessibleDialog` (onSkip). Nessun obbligo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goNext();
      else if (event.key === 'ArrowLeft') goPrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const council = useMemo(() => briefing.council.slice(0, 3), [briefing.council]);

  return (
    <>
      <header className="opening-head">
        <p className="opening-date">{dateLabel}</p>
        <h1 className="opening-section" id="opening-section-title">{OPENING_PAGES[page]}</h1>
      </header>

      <div className="opening-body">
        {page === 0 && (
          <section className="opening-page">
            <p className="opening-world-name">{briefing.world.name}</p>
            {briefing.world.paragraphs.length > 0 ? (
              briefing.world.paragraphs.map((paragraph, index) => (
                <p key={index} className="opening-prose">{paragraph}</p>
              ))
            ) : (
              <p className="opening-prose opening-empty">Il mondo non ha ancora una descrizione nel preset.</p>
            )}
          </section>
        )}

        {page === 1 && (
          <section className="opening-page">
            <p className="opening-kicker">TU GOVERNI QUESTO PAESE</p>
            <p className="opening-nation-name">{briefing.nation.name || 'Il tuo paese'}</p>
            <p className="opening-prose">{briefing.nation.identity}</p>

            {mapRegions && mapRegions.length > 0 && (
              <OpeningMap regions={mapRegions} highlightRegionIds={highlightRegionIds ?? []} />
            )}

            {briefing.nation.neighbors.length > 0 && (
              <div className="opening-neighbors" aria-label="Il mondo intorno a te">
                <h2 className="opening-sub">IL MONDO INTORNO A TE</h2>
                <ul>
                  {briefing.nation.neighbors.map(item => (
                    <li key={item.id} className={`opening-neighbor opening-tone-${item.tone}`}>
                      <span className="opening-neighbor-name">{item.name}</span>
                      <span className="opening-neighbor-relation">{item.relation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {briefing.nation.readings.length > 0 && (
              <dl className="opening-readings">
                {briefing.nation.readings.map(reading => (
                  <div key={reading.key} className={`opening-reading opening-tone-${reading.tone}`}>
                    <dt>{reading.label}</dt>
                    <dd>{reading.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        {page === 2 && (
          <section className="opening-page">
            <p className="opening-kicker">IL QUADRO CHE EREDITI</p>
            {briefing.inheritedSituation.length > 0 ? (
              <ul className="opening-situation">
                {briefing.inheritedSituation.map(item => (
                  <li key={item.id} className={`opening-item opening-symbol-${item.symbol}`}>
                    <SymbolGlyph symbol={item.symbol} />
                    <span className="opening-item-text">
                      <span className="opening-item-label">{item.label}</span>
                      {item.detail && <span className="opening-item-detail">{item.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="opening-prose opening-empty">Nessuna criticità rilevata: il paese regge.</p>
            )}
            <p className="opening-legend">
              <span><SymbolGlyph symbol="problem" /> problema</span>
              <span><SymbolGlyph symbol="opportunity" /> opportunità</span>
              <span><SymbolGlyph symbol="neutral" /> neutro</span>
            </p>
          </section>
        )}

        {page === 3 && (
          <section className="opening-page">
            <p className="opening-kicker">IL CONSIGLIO È PRONTO</p>
            {council.length > 0 ? (
              <ul className="opening-council">
                {council.map(voice => (
                  <li key={voice.seat} className="opening-minister">
                    <span className="opening-minister-seat">{voice.label}</span>
                    <span className="opening-minister-line">«{voice.line}»</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="opening-prose opening-empty">Il consiglio non ha ancora nulla da portare: il paese è tranquillo.</p>
            )}
          </section>
        )}

        {page === 4 && (
          <section className="opening-page opening-final">
            <p className="opening-final-title">Il paese è nelle tue mani.</p>
            <p className="opening-prose">Non esiste una strada obbligata. Puoi partire dai problemi che il consiglio ti ha portato, oppure scegliere una direzione completamente diversa.</p>
            <div className="opening-doors">
              <button type="button" className="opening-door" onClick={() => onFinish('orders')}>
                <span aria-hidden="true">🏛</span> Governo
              </button>
              <button type="button" className="opening-door" onClick={() => onFinish('map')}>
                <span aria-hidden="true">🗺</span> Mappa
              </button>
              <button type="button" className="opening-door" onClick={() => onFinish('advisor')}>
                <span aria-hidden="true">✦</span> Consigliere
              </button>
            </div>
            <button type="button" className="opening-direct" onClick={() => onFinish()}>
              Entra direttamente nella partita
            </button>
          </section>
        )}
      </div>

      <footer className="opening-foot">
        <button type="button" className="opening-skip" onClick={onSkip}>Salta il briefing</button>
        <div className="opening-nav">
          {page > 0 && (
            <button type="button" className="opening-back" onClick={goPrev} aria-label="Pagina precedente">←</button>
          )}
          {page < last && (
            <button type="button" className="opening-next" onClick={goNext}>
              Continua <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

/** L'overlay accessibile: portal, focus trap, Esc e sfondo inerte. */
export function GameOpeningBriefing(props: GameOpeningBriefingProps) {
  return (
    <AccessibleDialog
      open
      onClose={props.onSkip}
      className="opening-panel"
      overlayClassName="opening-overlay"
      ariaLabelledBy="opening-section-title"
    >
      <OpeningPanelContent {...props} />
    </AccessibleDialog>
  );
}

// `GameOpeningBriefing` è l'overlay accessibile: portal, focus trap, Esc e
// sfondo inerte. `OpeningPanelContent` resta montabile nei test statici.
