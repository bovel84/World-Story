/**
 * Open-Pax — HUD Bar + Timeline Panel
 * ===================================
 * Barra superiore in stile riferimento realistico (Schermata 2026-09-03):
 *  - a sinistra: pulsante circolare «☰» (torna al menu) + logo «🌐 Open-Pax»;
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

import React, { useEffect, useState } from 'react';
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
  ongoingProcesses?: Array<{ id: string; title: string; summary: string; started_date: string; expected_date?: string | null }>;
  /** Selezione del salto (0 = fino al prossimo evento importante) */
  onTimeSkip: (days: number) => void;
  onRestoreCheckpoint?: (simulationId: string) => void;
  /** Continua da un evento: restore + prossimo salto canonico. */
  onContinueFrom?: (simulationId: string) => void;
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

/** Data a days giorni da dateISO, formattata in italiano; '' se la data non è leggibile */
function formatDatePlusDays(dateISO: string, days: number): string {
  const d = parseISODate(dateISO);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Aggiunge mesi/anni reali, mantenendo l'ultimo giorno valido del mese. */
function addCalendarMonths(dateISO: string, months: number): Date | null {
  const start = parseISODate(dateISO);
  if (!start) return null;
  const day = start.getDate();
  const targetMonthIndex = start.getMonth() + months;
  const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(day, lastDay));
}

function formatCalendarDate(date: Date | null): string {
  return date ? `${date.getDate()} ${MONTHS_IT[date.getMonth()]} ${date.getFullYear()}` : '';
}

function calendarDaysUntil(dateISO: string, target: Date | null): number | null {
  const start = parseISODate(dateISO);
  if (!start || !target) return null;
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcTarget = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((utcTarget - utcStart) / 86_400_000);
}

// ============================================================================
// Preset time-skip (come in pax_jump2.png)
// ============================================================================

const TIME_PRESETS: { label: string; days?: number; months?: number }[] = [
  { label: '1 settimana', days: 7 },
  { label: '1 mese', months: 1 },
  { label: '3 mesi', months: 3 },
  { label: '6 mesi', months: 6 },
  { label: '12 mesi', months: 12 },
];

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
  ongoingProcesses = [],
  onTimeSkip,
  onRestoreCheckpoint,
  onContinueFrom,
  onClose,
}) => {
  const [customDays, setCustomDays] = useState('30');
  const [showHistory, setShowHistory] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const parsedCustom = parseInt(customDays, 10);
  const customValid = Number.isFinite(parsedCustom) && parsedCustom > 0 && parsedCustom <= 36500;

  const submitCustom = () => {
    if (customValid && !loading) onTimeSkip(parsedCustom);
  };

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
    <div className="hud-timeline-panel" role="dialog" aria-label="Timeline">
      {/* Header: titolo + data corrente + X */}
      <div className="hud-timeline-header">
        <div className="hud-timeline-heading">
          <div className="hud-timeline-title">Timeline</div>
          <div className="hud-timeline-subtitle">Adesso: {formatDateIt(dateISO)}</div>
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
                  {expanded && event.simulationId && (
                    <div className="hud-timeline-entry-actions">
                      {onRestoreCheckpoint && (
                        <button
                          type="button"
                          className="hud-timeline-entry-restore"
                          onClick={() => onRestoreCheckpoint(event.simulationId!)}
                          disabled={loading}
                        >
                          Ripristina il checkpoint di questo evento
                        </button>
                      )}
                      {onContinueFrom && (
                        <button
                          type="button"
                          className="hud-timeline-entry-restore hud-timeline-entry-continue"
                          onClick={() => onContinueFrom(event.simulationId!)}
                          disabled={loading}
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
      {ongoingProcesses.length > 0 && (
        <section className="hud-timeline-processes" aria-label="Processi in corso">
          <div className="hud-timeline-processes-title">Processi in corso</div>
          {ongoingProcesses.map(process => (
            <article key={process.id} className="hud-timeline-process">
              <strong>{process.title}</strong>
              <span>{process.summary}</span>
              <small>
                Avviato: {formatDateIt(process.started_date)}
                {process.expected_date ? ` · stimato: ${formatDateIt(process.expected_date)}` : ''}
              </small>
            </article>
          ))}
        </section>
      )}

      <div className="hud-timeline-divider">
        <span>prosegui nel tempo</span>
      </div>

      {/* Azione principale — salto fino al prossimo evento importante */}
      <button
        type="button"
        className="hud-timeline-next-event"
        onClick={() => onTimeSkip(0)}
        disabled={loading}
      >
        Vai al prossimo evento importante
      </button>

      <div className="hud-timeline-divider">
        <span>oppure</span>
      </div>

      {/* Preset: data di destinazione grande, etichetta periodo piccola (come nell’originale) */}
      <div className="hud-timeline-presets">
        {TIME_PRESETS.map((preset) => {
          const target = preset.months
            ? addCalendarMonths(dateISO, preset.months)
            : null;
          const calendarDays = target ? calendarDaysUntil(dateISO, target) : null;
          const days = calendarDays ?? preset.days ?? 0;
          const targetDate = target ? formatCalendarDate(target) : formatDatePlusDays(dateISO, days);
          return (
            <button
              type="button"
              key={preset.label}
              className="hud-timeline-preset"
              onClick={() => onTimeSkip(days)}
              disabled={loading || days <= 0}
            >
              <span className="hud-timeline-preset-date">
                {targetDate || `+${days} gg.`}
              </span>
              <span className="hud-timeline-preset-label">{preset.label}</span>
            </button>
          );
        })}
      </div>

      <div className="hud-timeline-divider" />

      {/* Salto personalizzato su un numero arbitrario di giorni */}
      <div className="hud-timeline-custom">
        <input
          className="hud-timeline-input"
          type="number"
          min={1}
          max={36500}
          step={1}
          value={customDays}
          disabled={loading}
          onChange={(e) => setCustomDays(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCustom();
          }}
          aria-label="Numero di giorni per il salto"
        />
        <span className="hud-timeline-custom-label">giorni</span>
        <button
          type="button"
          className="hud-timeline-custom-go"
          onClick={submitCustom}
          disabled={loading || !customValid}
          title="Salta al numero di giorni indicato"
          aria-label="Conferma il salto"
        >
          Vai
        </button>
      </div>
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
  onTimelineOpen,
  onBack,
  onRewind,
  onTimeSkip,
  onRestoreCheckpoint,
  onContinueFrom,
}) => {
  const [timelineOpen, setTimelineOpen] = useState(false);

  /** Apertura del pannello: notifichiamo il padre così (ri)carica la cronaca */
  const toggleTimeline = () => {
    setTimelineOpen((v) => {
      const next = !v;
      if (next) onTimelineOpen?.();
      return next;
    });
  };

  /** Scelta di una voce del pannello: la chiudiamo e inoltriamo il salto verso l’alto */
  const handleTimeSkip = (days: number) => {
    setTimelineOpen(false);
    onTimeSkip(days);
  };

  // Esc chiude il pannello timeline
  useEffect(() => {
    if (!timelineOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTimelineOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [timelineOpen]);

  return (
    <div className={`hud-bar${loading ? ' hud-loading' : ''}`}>
      {/* Parte sinistra: pulsante menu circolare (stile riferimento) + logo */}
      <div className="hud-left">
        <button type="button" className="hud-icon-btn" onClick={onBack} title="Torna al menu principale" aria-label="Torna al menu principale">
          ☰
        </button>
        <div className="hud-logo">
          <span className="hud-logo-text">Open-Pax</span>
        </div>
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
            title="Timeline e time-skip"
            aria-label="Apri il pannello timeline"
            aria-expanded={timelineOpen}
          >
            ›
          </button>
        </div>
      </div>

      {/* Pannello timeline + overlay per la chiusura al clic esterno */}
      {timelineOpen && (
        <>
          <div className="hud-timeline-overlay" onClick={() => setTimelineOpen(false)} />
          <TimelinePanel
            dateISO={dateISO}
            loading={loading}
            timeline={timeline}
            timelineLoading={timelineLoading}
            timelineError={timelineError}
            timelineHasMore={timelineHasMore}
            timelineLoadingOlder={timelineLoadingOlder}
            onLoadOlder={onLoadOlder}
            ongoingProcesses={ongoingProcesses}
            onTimeSkip={handleTimeSkip}
            onRestoreCheckpoint={onRestoreCheckpoint}
            onContinueFrom={onContinueFrom}
            onClose={() => setTimelineOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export default HudBar;
