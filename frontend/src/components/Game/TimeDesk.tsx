import React, { useState } from 'react';

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(value: Date | null): string {
  return value ? `${value.getDate()} ${MONTHS_IT[value.getMonth()]} ${value.getFullYear()}` : '';
}

function addDays(dateISO: string, days: number): Date | null {
  const date = parseISODate(dateISO);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(dateISO: string, months: number): Date | null {
  const start = parseISODate(dateISO);
  if (!start) return null;
  const day = start.getDate();
  const targetMonth = start.getMonth() + months;
  const target = new Date(start.getFullYear(), targetMonth, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function daysUntil(dateISO: string, targetISO: string): number | null {
  const start = parseISODate(dateISO);
  const target = parseISODate(targetISO);
  if (!start || !target) return null;
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

const PRESETS = [
  { label: '1 settimana', days: 7 },
  { label: '1 mese', months: 1 },
  { label: '3 mesi', months: 3 },
  { label: '6 mesi', months: 6 },
  { label: '12 mesi', months: 12 },
] as const;

interface TimeDeskProps {
  dateISO: string;
  loading: boolean;
  pendingOrdersCount: number;
  /** LW03 — gli ordini registrati, mostrati come «piano» prima del salto. */
  pendingOrders?: Array<{ id: string; text: string }>;
  ongoingProcesses?: Array<{
    id: string;
    title: string;
    summary: string;
    started_date: string;
    expected_date?: string | null;
  }>;
  activePlayback?: boolean;
  onTimeSkip: (days: number) => void;
  onClose: () => void;
}

/**
 * G4-A — Superficie operativa dedicata al tempo.
 * La cronaca rimane fuori da questa vista: qui si dichiara solo la destinazione
 * e si rende esplicito che cosa sarà preso in carico dal salto.
 */
export function TimeDesk({
  dateISO,
  loading,
  pendingOrdersCount,
  pendingOrders = [],
  ongoingProcesses = [],
  activePlayback = false,
  onTimeSkip,
  onClose,
}: TimeDeskProps) {
  const [customDate, setCustomDate] = useState('');
  const locked = loading || activePlayback;
  const customDays = customDate ? daysUntil(dateISO, customDate) : null;
  const customValid = customDays !== null && customDays > 0 && customDays <= 36_500;

  const beginSkip = (days: number) => {
    if (locked) return;
    onTimeSkip(days);
  };

  return (
    <section className="time-desk-content" aria-labelledby="time-desk-title">
      <header className="time-desk-heading">
        <div>
          <p className="time-desk-kicker">Tempo fermo</p>
          <h2 id="time-desk-title">Avanza il tempo</h2>
          <p>Adesso: <strong>{formatDate(parseISODate(dateISO)) || dateISO}</strong></p>
        </div>
        <button type="button" className="time-desk-close" onClick={onClose} aria-label="Chiudi avanza il tempo">×</button>
      </header>

      {activePlayback ? (
        <div className="time-desk-checkpoint" role="status">
          <span aria-hidden="true">●</span>
          Un checkpoint attende la tua decisione. Continua o intervieni prima di avviare un nuovo salto.
        </div>
      ) : (
        <>
          <section className="time-desk-context" aria-label="Elementi che saranno presi in carico">
            <div className="time-desk-context-item">
              <span>Ordini pronti</span>
              <strong>{pendingOrdersCount}</strong>
              <small>{pendingOrdersCount === 1 ? 'sarà eseguito al salto' : 'saranno eseguiti al salto'}</small>
            </div>
            <div className="time-desk-context-item">
              <span>Processi in corso</span>
              <strong>{ongoingProcesses.length}</strong>
              <small>potrebbero maturare nel periodo</small>
            </div>
          </section>

          {pendingOrders.length > 0 && (
            <section className="time-desk-plan" aria-label="Piano in esecuzione al salto">
              <h3>Piano</h3>
              <ul>
                {pendingOrders.map((order, index) => (
                  <li key={order.id}>
                    <span className="time-desk-plan-index" aria-hidden="true">{index + 1}</span>
                    <span>{order.text}</span>
                  </li>
                ))}
              </ul>
              <p className="time-desk-plan-note">Gli ordini sono già registrati: il salto li prende in carico, non li riscrive.</p>
            </section>
          )}

          {ongoingProcesses.length > 0 && (
            <section className="time-desk-process-list" aria-label="Processi che potrebbero maturare">
              <h3>Processi in corso</h3>
              <ul>
                {ongoingProcesses.slice(0, 3).map((process) => (
                  <li key={process.id}>
                    <strong>{process.title}</strong>
                    <span>{process.summary}</span>
                    {process.expected_date && <small>Stimato: {formatDate(parseISODate(process.expected_date))}</small>}
                  </li>
                ))}
              </ul>
              {ongoingProcesses.length > 3 && <p>+{ongoingProcesses.length - 3} altri processi</p>}
            </section>
          )}

          <div className="time-desk-rule"><span>scegli una destinazione</span></div>
          <button type="button" className="time-desk-next" onClick={() => beginSkip(0)} disabled={locked}>
            {pendingOrders.length > 0 ? 'Esegui piano e avanza' : 'Vai al prossimo evento importante'}
          </button>

          <div className="time-desk-presets" aria-label="Destinazioni rapide">
            {PRESETS.map((preset) => {
              const target = 'months' in preset ? addMonths(dateISO, preset.months) : addDays(dateISO, preset.days);
              const days = 'months' in preset ? daysUntil(dateISO, target?.toISOString().slice(0, 10) || '') : preset.days;
              return (
                <button key={preset.label} type="button" onClick={() => beginSkip(days || 0)} disabled={locked || !days}>
                  <strong>{formatDate(target)}</strong>
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>

          <div className="time-desk-custom">
            <label htmlFor="time-desk-date">Oppure scegli una data</label>
            <div>
              <input
                id="time-desk-date"
                type="date"
                min={dateISO}
                value={customDate}
                disabled={locked}
                onChange={(event) => setCustomDate(event.target.value)}
              />
              <button type="button" onClick={() => customDays !== null && beginSkip(customDays)} disabled={locked || !customValid}>Avanza</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default TimeDesk;