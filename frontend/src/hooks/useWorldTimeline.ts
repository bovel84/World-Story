/**
 * World Story — Fase 2: `useWorldTimeline`
 * =======================================
 * La cronaca del mondo — timeline persistita, paginazione e processi in corso —
 * era un blocco di stato, ref e funzioni asincrone incastonato in `App.tsx`.
 * Questo hook lo possiede: gli stessi fetch, la stessa guardia di richiesta
 * (`timelineRequestRef`) e la stessa regola di appartenenza della partita
 * (`useChatStore.getState().gameId`).
 *
 * Contratto invariato rispetto ad `App.tsx`:
 *  - `resetTimeline()` invalida le richieste in volo al cambio partita;
 *  - l'apertura carica pagina 0 + processi; la paginazione usa `nextAfter`;
 *  - i processi in corso si ricaricano al cambio partita e al cambio turno.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { gameApi, type TimelineEntry } from '../services/api';
import { useChatStore } from '../stores';

export interface OngoingProcess {
  id: string;
  title: string;
  summary: string;
  started_date: string;
  expected_date?: string | null;
  progress?: number | null;
  progress_note?: string | null;
}

export interface CompletedProcess {
  id: string;
  title: string;
  summary: string;
  started_date: string;
  expected_date?: string | null;
  completed_date?: string | null;
}

export interface UseWorldTimelineOptions {
  gameId: string | null;
  currentTurn: number | undefined;
}

export interface WorldTimeline {
  timeline: TimelineEntry[];
  setTimeline: React.Dispatch<React.SetStateAction<TimelineEntry[]>>;
  timelineLoading: boolean;
  timelineError: string;
  timelineHasMore: boolean;
  setTimelineHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  timelineNextAfter: number;
  setTimelineNextAfter: React.Dispatch<React.SetStateAction<number>>;
  timelineLoadingOlder: boolean;
  ongoingProcesses: OngoingProcess[];
  setOngoingProcesses: React.Dispatch<React.SetStateAction<OngoingProcess[]>>;
  completedProcesses: CompletedProcess[];
  setCompletedProcesses: React.Dispatch<React.SetStateAction<CompletedProcess[]>>;
  handleTimelineOpen: () => Promise<void>;
  loadOlderTimeline: () => Promise<void>;
  /** Invalida le richieste in volo e svuota la cronaca (cambio partita). */
  resetTimeline: () => void;
}

export function useWorldTimeline({ gameId, currentTurn }: UseWorldTimelineOptions): WorldTimeline {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [ongoingProcesses, setOngoingProcesses] = useState<OngoingProcess[]>([]);
  const [completedProcesses, setCompletedProcesses] = useState<CompletedProcess[]>([]);
  const timelineRequestRef = useRef(0);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineNextAfter, setTimelineNextAfter] = useState(0);
  const [timelineLoadingOlder, setTimelineLoadingOlder] = useState(false);

  const resetTimeline = useCallback(() => {
    timelineRequestRef.current++;
    setTimeline([]);
    setTimelineError('');
    setTimelineLoading(false);
  }, []);

  // I progetti in corso portano la percentuale di realizzazione calcolata dal
  // motore: senza questa lettura il Dossier restava senza avanzamento.
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    gameApi.ongoingProcesses(gameId)
      .then((processData) => { if (!cancelled) { setOngoingProcesses(processData.processes || []); setCompletedProcesses(processData.completed || []); } })
      .catch(error => console.warn('[App] Impossibile caricare i processi in corso:', error));
    return () => { cancelled = true; };
  }, [gameId, currentTurn]);

  const handleTimelineOpen = async () => {
    const requestedGameId = gameId;
    if (!requestedGameId) return;
    const requestId = ++timelineRequestRef.current;
    setTimelineLoading(true);
    setTimelineError('');
    try {
      const [data, processData] = await Promise.all([
        gameApi.timeline(requestedGameId, { after: 0, limit: 200 }),
        gameApi.ongoingProcesses(requestedGameId),
      ]);
      if (requestId === timelineRequestRef.current && useChatStore.getState().gameId === requestedGameId) {
        setTimeline(data.timeline || []);
        setTimelineHasMore(Boolean(data.hasMore));
        setTimelineNextAfter(data.nextAfter ?? 0);
        setOngoingProcesses(processData.processes || []);
        setCompletedProcesses(processData.completed || []);
      }
    } catch (e) {
      console.error('[App] Impossibile caricare la timeline:', e);
      if (requestId === timelineRequestRef.current) {
        setTimelineError(e instanceof Error ? e.message : 'Impossibile caricare la timeline.');
      }
    } finally {
      if (requestId === timelineRequestRef.current) setTimelineLoading(false);
    }
  };

  // §11.3 — recupero progressivo della cronaca persistita (paginazione).
  const loadOlderTimeline = async () => {
    const requestedGameId = gameId;
    if (!requestedGameId || timelineLoadingOlder || !timelineHasMore) return;
    const requestId = timelineRequestRef.current;
    setTimelineLoadingOlder(true);
    try {
      const data = await gameApi.timeline(requestedGameId, { after: timelineNextAfter, limit: 200 });
      if (requestId === timelineRequestRef.current && useChatStore.getState().gameId === requestedGameId) {
        setTimeline(prev => {
          const seen = new Set(prev.map(e => e.turn));
          return [...prev, ...(data.timeline || []).filter(e => !seen.has(e.turn))];
        });
        setTimelineHasMore(Boolean(data.hasMore));
        setTimelineNextAfter(data.nextAfter ?? timelineNextAfter);
      }
    } catch (e) {
      console.error('[App] Impossibile caricare la cronaca precedente:', e);
    } finally {
      if (requestId === timelineRequestRef.current) setTimelineLoadingOlder(false);
    }
  };

  return {
    timeline, setTimeline,
    timelineLoading,
    timelineError,
    timelineHasMore, setTimelineHasMore,
    timelineNextAfter, setTimelineNextAfter,
    timelineLoadingOlder,
    ongoingProcesses, setOngoingProcesses,
    completedProcesses, setCompletedProcesses,
    handleTimelineOpen,
    loadOlderTimeline,
    resetTimeline,
  };
}
