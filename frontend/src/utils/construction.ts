import type { MapObject } from '../types';

const PHASES: Record<string, string> = {
  preparation: 'Preparazione del sito', foundations: 'Fondazioni', structure: 'Strutture',
  installation: 'Installazione degli impianti', testing: 'Collaudo',
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 280) : '';
const date = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
};

/** Only saved qualitative facts: elapsed time is not a completion percentage. */
export function constructionReport(object: MapObject): { label: string; value: string }[] {
  if (object.type !== 'construction_site') return [];
  const meta = object.metadata || {};
  return [
    { label: 'Stato', value: meta.status === 'paused' ? 'Lavori sospesi' : 'Cantiere aperto' },
    { label: 'Fase', value: PHASES[text(meta.phase)] || '' },
    { label: 'Avvio', value: date(meta.startedDate) },
    { label: 'Ultimo aggiornamento', value: date(meta.lastUpdatedDate) },
    { label: 'Previsione (non garantita)', value: date(meta.expectedDate) },
    { label: 'Impedimento', value: text(meta.blocker) },
    { label: 'Prossimo passo', value: text(meta.nextStep) },
  ].filter(row => row.value);
}
