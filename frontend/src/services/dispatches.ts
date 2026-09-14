/** Normalizzazione dei dispacci SSE: supporta l'outbox canonico a evento singolo
 * e il vecchio payload aggregato di fine turno. */

export interface WorldEventPayload {
  eventId?: string;
  runId?: string;
  date?: string;
  headline?: string;
  detail?: string;
  source?: string;
  sourceActionIds?: string[];
  events?: string[];
  eventDetails?: Array<{
    id?: string;
    date?: string;
    headline?: string;
    detail?: string;
    source?: string;
  }>;
  newTurn?: number;
  newDate?: string;
  changedRegions?: Array<{ id: string; [key: string]: unknown }>;
}

export interface NormalizedDispatch {
  eventId?: string;
  date?: string;
  headline: string;
  detail?: string;
  source: string;
  regionIds: string[];
}

export function normalizeWorldEventPayload(data: WorldEventPayload): NormalizedDispatch[] {
  if (!data || typeof data !== 'object') return [];
  const regionIds = (data.changedRegions || [])
    .map(region => typeof region?.id === 'string' ? region.id : '')
    .filter(Boolean);

  // F02: una riga outbox committata equivale a un singolo dispaccio.
  if (typeof data.headline === 'string' && data.headline.trim()) {
    return [{
      eventId: typeof data.eventId === 'string' ? data.eventId : undefined,
      date: data.date,
      headline: data.headline.trim(),
      detail: typeof data.detail === 'string' ? data.detail : undefined,
      source: typeof data.source === 'string' ? data.source : 'world',
      regionIds,
    }];
  }

  // Compatibilità con advanceDate/vecchi server: eventi e dettagli aggregati.
  return (Array.isArray(data.events) ? data.events : []).flatMap((headline, index) => {
    if (typeof headline !== 'string' || !headline.trim()) return [];
    const detail = data.eventDetails?.[index];
    return [{
      eventId: typeof detail?.id === 'string' ? detail.id : undefined,
      date: detail?.date || data.newDate,
      headline: (detail?.headline || headline).trim(),
      detail: detail?.detail,
      source: detail?.source || 'world',
      regionIds: index === 0 ? regionIds : [],
    }];
  });
}
