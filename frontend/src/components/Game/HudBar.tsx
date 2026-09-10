/**
 * World Story — HUD Bar + Timeline Panel
 * ===================================
 * Barra superiore in stile riferimento realistico (Schermata 2026-09-03):
 *  - a sinistra: pulsante circolare «☰» (torna al menu) + logo «🌐 World Story»;
 *  - al centro: nome del mondo + badge «TURNO N»;
 *  - a destra: data in evidenza «‹ 20 aprile 2000 ›»
 *    (‹ — torna al turno precedente, › — apre il pannello «Timeline»).
 *
 * Pannello «Timeline» (TimelinePanel, esportato dallo stesso file):
 *  - «⏭ Fino al prossimo evento importante» → onTimeSkip(0);
 *  - preset: 1 settimana (7), 1 mese (30), 3 mesi (90), 6 mesi (180), 12 mesi (365);
 *  - salto personalizzato: input numerico + «giorni» + pulsante ✓;
 *  - chiusura: clic sull’overlay, Esc, la X o la scelta di una voce.
 *
 * Componente autosufficiente: non chiama API, invoca solo i callback delle props.
 * Stili — alla fine di frontend/src/index.css, sezione «Fase 6: HUD-bar e timeline».
 */

import React, { useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { TimeDesk } from './TimeDesk';
import type { TimelineEntry, TimelineEvent } from '../../services/api';

// ============================================================================
// Tipi
// ============================================================================

export interface HudBarProps {
  /** Nome del mondo (al centro della barra) */
  worldName: string;
  /** Numero del turno corrente */
  turn: number;
  /** Data corrente del mondo in ISO (YYYY-MM-DD) — formattata internamente */
  dateISO: string;
  /** Elaborazione del turno in corso — blocca ◀ e i pulsanti del pannello */
  loading: boolean;
  /** Cronaca del mondo per il pannello Timeline (eventi per turno) */
  timeline?: TimelineEntry[];
  /** Fetch della timeline in corso */
  timelineLoading?: boolean;
  /** Errore leggibile durante il fetch. */
  timelineError?: string;
  /** C'è altra cronaca persistente da caricare (§11.3). */
  timelineHasMore?: boolean;
  /** Caricamento in corso della pagina precedente. */
  timelineLoadingOlder?: boolean;
  /** Processi avviati ma non ancora conclusi. */
  ongoingProcesses?: Array<{ id: string; title: string; summary: string; started_date: string; expected_date?: string | null }>;
  /** Dispacci pronti da consultare nella cronaca laterale. */
  dispatchCount?: number;
  dispatchLive?: boolean;
  /** Ordini già registrati: saranno presi in carico al salto. */
  pendingOrdersCount?: number;
  onOpenDispatches?: () => void;
  /** Chiamato quando il pannello Timeline si apre — il padre (ri)carica gli eventi */
  onTimelineOpen?: () => void;
  /** Recupera la pagina successiva della cronaca persistente. */
  onLoadOlder?: () => void;
  /** Torna al menu */
  onBack: () => void;
  /** Torna al turno precedente */
  onRewind: () => void;
  /** Time-skip: days = 0 → «fino al prossimo evento importante», altrimenti salto di N giorni */
  onTimeSkip: (days: number) => void;
  /** Ripristina il checkpoint del run che ha prodotto un evento. */
  onRestoreCheckpoint?: (simulationId: string) => void;
  /** Continua da questo evento: ripristina il checkpoint e lancia subito il prossimo salto. */
  onContinueFrom?: (simulationId: string) => void;
  /** G22: il checkpoint in lettura è gestito solo dal lettore di sessione. */
  activePlayback?: { simulationId: string; eventId: string; revision?: number } | null;
  onFocusPlaybackReader?: () => void;
}

export interface TimelinePanelProps {
  /** Data corrente del mondo in ISO — per il sottotitolo e il calcolo delle date dei preset */
  dateISO: string;
  /** Blocco dei pulsanti durante l’elaborazione */
  loading: boolean;
  /** Cronaca del mondo (eventi per turno, dal più recente) */
  timeline?: TimelineEntry[];
  /** Caricamento della cronaca in corso */
  timelineLoading?: boolean;
  /** Errore durante il caricamento. */
  timelineError?: string;
  timelineHasMore?: boolean;
  timelineLoadingOlder?: boolean;
  onLoadOlder?: () => void;
  onRestoreCheckpoint?: (simulationId: string) => void;
  /** Continua da un evento: restore + prossimo salto canonico. */
  onContinueFrom?: (simulationId: string) => void;
  /** Checkpoint attivo: la timeline resta solo consultazione. */
  activePlayback?: { simulationId: string; eventId: string; revision?: number } | null;
  onFocusPlaybackReader?: () => void;
  /** Chiudi il pannello */
  onClose: () => void;
}

// ============================================================================
// Date (locale italiana, senza scostamento di fuso orario)
// ============================================================================

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** Parsing di YYYY-MM-DD come mezzanotte LOCALE (new Date('YYYY-MM-DD') darebbe UTC e slitterebbe di un giorno) */
function parseISODate(dateISO: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateISO || '').trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const fallback = new Date(dateISO);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** «12 gennaio 1951»; con data non leggibile restituisce la stringa originale */
export function formatDateIt(dateISO: string): string {
  const d = parseISODate(dateISO);
  if (!d) return dateISO;
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}

// ============================================================================
// Pannello «Timeline»
// ============================================================================

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  dateISO,
  loading,
  timeline,
  timelineLoading,
  timelineError,
  timelineHasMore,
  timelineLoadingOlder,
  onLoadOlder,
  onRestoreCheckpoint,
  onContinueFrom,
  activePlayback,
  onFocusPlaybackReader,
  onClose,
}) => {
  const [showHistory, setShowHistory] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const controlsLocked = loading || !!activePlayback;

  // Eventi appiattiti e ordinati dal più recente. Il fallback tollera risposte
  // precedenti, dove events era ancora string[].
  const events = (timeline || []).flatMap(entry => {
    if (!entry.events?.length && entry.narration) {
      return [{
        id: `turn-${entry.turn}`,
        date: entry.date,
        headline: `Turno ${entry.turn}`,
        detail: entry.narration,
        source: 'world' as const,
        turn: entry.turn,
      }];
    }
    return (entry.events || []).map((event, index) => {
      const normalized: TimelineEvent = typeof event === 'string'
        ? {
            id: `turn-${entry.turn}-${index}`,
            date: entry.date,
            headline: event,
            detail: entry.narration,
            source: 'world',
          }
        : event;
      return { ...normalized, turn: entry.turn };
    });
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.turn - a.turn);

  return (
    <div className="hud-timeline-panel-content">
      {/* Header: titolo + data corrente + X */}
      <div className="hud-timeline-header">
        <div className="hud-timeline-heading">
          <div className="hud-timeline-title">Timeline</div>
          <div className="hud-timeline-subtitle">Adesso: {formatDateIt(dateISO)} · il tempo scorre per tutte le nazioni</div>
        </div>
        <button
          type="button"
          className="hud-timeline-close"
          onClick={onClose}
          title="Chiudi"
          aria-label="Chiudi il pannello timeline"
        >
          ✕
        </button>
      </div>

      {/* Cronaca del mondo: una linea datata, con dettagli apribili. */}
      <button
        type="button"
        className="hud-timeline-history-toggle"
        onClick={() => setShowHistory(v => !v)}
        aria-expanded={showHistory}
      >
        <span>{showHistory ? '▾' : '▸'} Cronaca del mondo</span>
        {events.length > 0 && <span className="hud-timeline-count">{events.length}</span>}
      </button>
      {showHistory && (
        <div className="hud-timeline-events">
          {timelineLoading && events.length === 0 ? (
            <div className="hud-timeline-empty">Caricamento della cronaca…</div>
          ) : timelineError ? (
            <div className="hud-timeline-empty error">{timelineError}</div>
          ) : events.length === 0 ? (
            <div className="hud-timeline-empty">La storia è ancora da scrivere.</div>
          ) : (
            events.map(event => {
              const expanded = expandedEventId === event.id;
              const isActivePlaybackEvent = activePlayback?.simulationId === event.simulationId
                && activePlayback?.eventId === event.id;
              return (
                <article
                  key={event.id}
                  className={`hud-timeline-entry ${event.source === 'diplomacy' ? 'diplomacy' : ''}`}
                >
                  <span className="hud-timeline-node" aria-hidden="true" />
                  <button
                    type="button"
                    className="hud-timeline-entry-head"
                    onClick={() => setExpandedEventId(expanded ? null : event.id)}
                    aria-expanded={expanded}
                  >
                    <span className="hud-timeline-entry-meta">
                      <span className="hud-timeline-entry-date">
                        {event.date ? formatDateIt(event.date) : `Turno ${event.turn}`}
                      </span>
                      <span className="hud-timeline-entry-turn">T{event.turn}</span>
                      {event.source === 'diplomacy' && <span className="hud-timeline-source">Diplomazia</span>}
                    </span>
                    <span className="hud-timeline-entry-title">{event.headline}</span>
                    <span className="hud-timeline-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
                  </button>
                  {expanded && event.detail && (
                    <div className="hud-timeline-entry-detail">{event.detail}</div>
                  )}
                  {expanded && isActivePlaybackEvent && (
                    <div className="hud-timeline-active-reader">
                      <span>Checkpoint attivo · revisione {activePlayback?.revision ?? '—'}</span>
                      <button type="button" onClick={onFocusPlaybackReader}>Apri il lettore di sessione</button>
                    </div>
                  )}
                  {expanded && event.simulationId && !isActivePlaybackEvent && (
                    <div className="hud-timeline-entry-actions">
                      {onRestoreCheckpoint && (
                        <button
                          type="button"
                          className="hud-timeline-entry-restore"
                          onClick={() => onRestoreCheckpoint(event.simulationId!)}
                          disabled={controlsLocked}
                        >
                          Ripristina il checkpoint di questo evento
                        </button>
                      )}
                      {onContinueFrom && (
                        <button
                          type="button"
                          className="hud-timeline-entry-restore hud-timeline-entry-continue"
                          onClick={() => onContinueFrom(event.simulationId!)}
                          disabled={controlsLocked}
                        >
                          Continua da qui
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
          {timelineHasMore && (
            <button
              type="button"
              className="hud-timeline-load-older"
              onClick={onLoadOlder}
              disabled={timelineLoadingOlder}
            >
              {timelineLoadingOlder ? 'Caricamento…' : 'Carica la cronaca precedente'}
            </button>
          )}
        </div>
      )}
      <p className="hud-timeline-readonly-note">La cronaca è consultazione. Per scegliere una destinazione usa «Avanza» nella barra di comando.</p>
    </div>
  );
};

// ============================================================================
// Barra HUD superiore
// ============================================================================

export const HudBar: React.FC<HudBarProps> = ({
  worldName,
  turn,
  dateISO,
  loading,
  timeline,
  timelineLoading,
  timelineError,
  timelineHasMore,
  timelineLoadingOlder,
  onLoadOlder,
  ongoingProcesses,
  dispatchCount = 0,
  dispatchLive = false,
  pendingOrdersCount = 0,
  onOpenDispatches,
  onTimelineOpen,
  onBack,
  onRewind,
  onTimeSkip,
  onRestoreCheckpoint,
  onContinueFrom,
  activePlayback,
  onFocusPlaybackReader,
}) => {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeDeskOpen, setTimeDeskOpen] = useState(false);

  /** Apertura del pannello: notifichiamo il padre così (ri)carica la cronaca */
  const toggleTimeline = () => {
    setTimelineOpen((v) => {
      const next = !v;
      if (next) onTimelineOpen?.();
      return next;
    });
  };

  const openTimeDesk = () => {
    onTimelineOpen?.(); // aggiorna anche processi in corso e cronaca in background
    setTimeDeskOpen(true);
  };

  const handleTimeSkip = (days: number) => {
    setTimeDeskOpen(false);
    onTimeSkip(days);
  };

  return (
    <div className={`hud-bar${loading ? ' hud-loading' : ''}`}>
      {/* Parte sinistra: pulsante menu circolare (stile riferimento) + logo */}
      <div className="hud-left">
        <button type="button" className="hud-icon-btn" onClick={onBack} title="Torna al menu principale" aria-label="Torna al menu principale">
          ☰
        </button>
        <div className="hud-logo">
          <span className="hud-logo-text">World Story</span>
        </div>
        <button
          type="button"
          className="hud-dispatch-toggle"
          onClick={onOpenDispatches}
          title="Apri gli aggiornamenti del mondo"
          aria-label={`Apri aggiornamenti${dispatchCount ? `, ${dispatchCount} dispacci` : ''}`}
        >
          <span className="hud-dispatch-icon" aria-hidden="true">▤</span>
          <span className="hud-dispatch-label">Dispacci</span>
          {dispatchCount > 0 && <span className="hud-dispatch-count">{dispatchCount > 99 ? '99+' : dispatchCount}</span>}
          {dispatchLive && <span className="hud-dispatch-live" aria-label="Nuovi aggiornamenti in arrivo" />}
        </button>
      </div>

      {/* Centro: nome del mondo + badge del turno */}
      <div className="hud-center">
        <div className="hud-world-name" title={worldName}>
          {worldName}
        </div>
        <div className="hud-turn-badge">TURNO {turn}</div>
      </div>

      {/* Parte destra: data in evidenza con navigazione (stile riferimento: ‹ 20 aprile 2000 ›) */}
      <div className="hud-right">
        <button
          type="button"
          className="hud-advance-btn"
          onClick={openTimeDesk}
          disabled={loading || !!activePlayback}
          aria-label={pendingOrdersCount ? `Avanza il tempo: ${pendingOrdersCount} ordini pronti` : 'Avanza il tempo'}
        >
          <span>Avanza</span>
          {pendingOrdersCount > 0 && <b>{pendingOrdersCount}</b>}
        </button>
        <div className="hud-date-pill">
          <button
            type="button"
            className="hud-date-nav"
            onClick={onRewind}
            disabled={loading}
            title="Torna al turno precedente"
            aria-label="Torna al turno precedente"
          >
            ‹
          </button>
          <div className="hud-date-display" title={dateISO}>
            {formatDateIt(dateISO)}
          </div>
          <button
            type="button"
            className={`hud-date-nav hud-timeline-toggle${timelineOpen ? ' active' : ''}`}
            onClick={toggleTimeline}
            title="Apri la cronaca"
            aria-label="Apri la cronaca"
            aria-expanded={timelineOpen}
          >
            ›
          </button>
        </div>
      </div>

      {/* Pannello timeline + overlay per la chiusura al clic esterno */}
      {timelineOpen && (
          <AccessibleDialog
            open={true}
            onClose={() => setTimelineOpen(false)}
            overlayClassName="hud-timeline-overlay"
            className="hud-timeline-panel"
            ariaLabel="Timeline"
          >
          <TimelinePanel
            dateISO={dateISO}
            loading={loading}
            timeline={timeline}
            timelineLoading={timelineLoading}
            timelineError={timelineError}
            timelineHasMore={timelineHasMore}
            timelineLoadingOlder={timelineLoadingOlder}
            onLoadOlder={onLoadOlder}
            onRestoreCheckpoint={onRestoreCheckpoint}
            onContinueFrom={onContinueFrom}
            activePlayback={activePlayback}
            onFocusPlaybackReader={onFocusPlaybackReader}
            onClose={() => setTimelineOpen(false)}
          />
          </AccessibleDialog>
      )}

      {timeDeskOpen && (
        <AccessibleDialog
          open={true}
          onClose={() => setTimeDeskOpen(false)}
          overlayClassName="time-desk-overlay"
          className="time-desk"
          ariaLabel="Avanza il tempo"
        >
          <TimeDesk
            dateISO={dateISO}
            loading={loading}
            pendingOrdersCount={pendingOrdersCount}
            ongoingProcesses={ongoingProcesses}
            activePlayback={!!activePlayback}
            onTimeSkip={handleTimeSkip}
            onClose={() => setTimeDeskOpen(false)}
          />
        </AccessibleDialog>
      )}
    </div>
  );
};

export default HudBar;
