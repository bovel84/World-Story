/**
 * World Story — Fase 2: `useSimulationPlayback`
 * ============================================
 * Il playback «un evento alla volta» dei salti fissi — lettore del checkpoint,
 * cicatrici temporali del confine appena cambiato, ripresa dopo refresh,
 * «Continua» e «Intervieni qui» — viveva in `App.tsx`. Questo hook lo possiede.
 *
 * Contratto invariato (§9.3/F06):
 *  - un run in pausa possiede il turno; il lettore è ricostruito dal server,
 *    mai indovinato dal client;
 *  - la coda persistita è riletta dopo ogni decisione del lettore;
 *  - la cicatrice temporale segna solo un vero cambio di padronanza e decade
 *    da sola dopo qualche secondo;
 *  - HTTP e SSE possono arrivare in ordine diverso: l'ID canonico evita
 *    duplicati nel foglio degli eventi divulgati.
 */
import { useEffect, useRef, useState } from 'react';
import { gameApi } from '../services/api';
import type { Game } from '../types';
import type { TemporalScar } from '../components/Map/TemporalScarLayer';
import type { PlaybackReaderState } from '../components/Game/SimulationEventReader';
import { useGameStore, useUIStore } from '../stores';

export interface RunCompletionOutcome {
  type: string;
  simulationId: string;
  actions?: any[];
  newDate: string;
  newTurn: number;
  result?: { turn: number; narration: string; events: string[]; eventDetails?: any[]; periodStart: string; periodEnd: string };
}

export interface SimulationPlayback {
  pausedReader: PlaybackReaderState | null;
  setPausedReader: React.Dispatch<React.SetStateAction<PlaybackReaderState | null>>;
  temporalScars: TemporalScar[];
  setTemporalScars: React.Dispatch<React.SetStateAction<TemporalScar[]>>;
  scarTimersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  applyCheckpointRegions: (changedRegions: any[] | undefined) => void;
  applyRunCompletion: (outcome: RunCompletionOutcome) => Promise<void>;
  restorePausedReader: (game: Game) => Promise<void>;
  handleContinueNext: () => Promise<void>;
  handleInterveneHere: () => Promise<void>;
}

export function useSimulationPlayback(): SimulationPlayback {
  const { loading, setLoading } = useUIStore();
  const {
    currentGame, setCurrentGame, setCurrentWorld,
    setPendingActions, addHistory, setChangedRegions, clearChangedRegions,
  } = useGameStore();

  const [pausedReader, setPausedReader] = useState<PlaybackReaderState | null>(null);
  const [temporalScars, setTemporalScars] = useState<TemporalScar[]>([]);
  const scarTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const applyCheckpointRegions = (changedRegions: any[] | undefined) => {
    if (!changedRegions?.length) return;
    const liveWorld = useGameStore.getState().currentWorld;
    const previousStates: TemporalScar[] = [];
    if (liveWorld) {
      const regions = { ...liveWorld.regions };
      for (const changed of changedRegions) {
        const before = regions[changed.id];
        if (!before) continue;
        // Cicatrice solo su vero cambio di padronanza: aggiornamenti non territoriali
        // (oggetti, statistiche) non lasciano segno sul confine.
        const ownerChanged = !!changed.owner && changed.owner !== before.owner;
        if (ownerChanged) {
          previousStates.push({
            id: changed.id,
            name: changed.name || before.name || changed.id,
            previousOwner: before.owner || '',
            previousColor: before.color || '#8a8f9a',
            startedAt: Date.now(),
          });
        }
        regions[changed.id] = { ...before, ...changed };
      }
      setCurrentWorld({ ...liveWorld, regions });
    }
    if (previousStates.length > 0) {
      const fresh = previousStates.map(scar => ({ ...scar, startedAt: Date.now() }));
      setTemporalScars(prev => [
        // Le cicatrici già presenti sulla stessa regione vengono sostituite:
        // vale l'ultimo confine noto.
        ...prev.filter(existing => !fresh.some(item => item.id === existing.id)),
        ...fresh,
      ]);
      const scarIds = fresh.map(scar => scar.id);
      const timer = setTimeout(() => {
        setTemporalScars(prev => prev.filter(existing => !scarIds.includes(existing.id)));
      }, 9000);
      scarTimersRef.current.push(timer);
    }
    setChangedRegions(changedRegions.map((region: any) => region.id));
    setTimeout(() => clearChangedRegions(), 3000);
  };

  /** Il run scaglionato è chiuso: finalizza cronaca, data e turno con gli
   * stessi percorsi di actions_processed/world_advanced. */
  const applyRunCompletion = async (outcome: RunCompletionOutcome) => {
    setPausedReader(null);
    for (const action of outcome.actions || []) {
      if (action.result) {
        addHistory({
          turn: action.result.turn,
          action: action.text,
          result: action.result.narration,
          events: action.result.events,
          eventDetails: action.result.eventDetails,
          periodStart: action.result.periodStart,
          periodEnd: action.result.periodEnd,
        });
      }
    }
    if (outcome.result && !(outcome.actions || []).some((action: any) => action.result)) {
      addHistory({
        turn: outcome.result.turn,
        action: outcome.type === 'paused_budget' ? '⏸ Salto sospeso: budget esaurito' : 'Salto temporale',
        result: outcome.result.narration,
        events: outcome.result.events,
        eventDetails: outcome.result.eventDetails,
        periodStart: outcome.result.periodStart,
        periodEnd: outcome.result.periodEnd,
      });
    }
    setCurrentGame(prev => prev ? { ...prev, currentTurn: outcome.newTurn, currentDate: outcome.newDate } : prev);
  };

  /** Dopo refresh o ripristino, un run in pausa riapre il lettore al suo
   * checkpoint: il playback scaglionato è durevole (§9.2). */
  const restorePausedReader = async (game: Game) => {
    const paused = (game as any).pausedSimulation;
    if (!paused?.simulationId) {
      setPausedReader(null);
      return;
    }
    try {
      const run = await gameApi.getSimulationRun(game.id, paused.simulationId);
      const lastEvent = run.events?.[run.events.length - 1];
      if (run.awaitingNext && lastEvent) {
        setPausedReader({
          simulationId: paused.simulationId,
          event: {
            id: lastEvent.id,
            date: lastEvent.date,
            headline: lastEvent.headline,
            detail: lastEvent.detail,
            source: lastEvent.source,
          },
          remaining: run.awaitingNext.remaining,
          destination: run.awaitingNext.destination,
          checkpointId: run.awaitingNext.checkpointId,
          revision: run.awaitingNext.revision,
          disclosedEvents: run.events.map(event => ({
            id: event.id, date: event.date, headline: event.headline,
            detail: event.detail, source: event.source,
          })),
        });
      } else {
        setPausedReader(null);
      }
    } catch (e) {
      console.warn('[App] Impossibile ricostruire il run in pausa:', e);
      setPausedReader(null);
    }
  };

  // Riconcilia qualunque percorso che abbia ottenuto un Game già in pausa
  // (apertura diretta, refresh, save/load): il lettore G22 non può restare
  // invisibile mentre il server giustamente blocca un nuovo salto.
  useEffect(() => {
    const runId = currentGame?.pausedSimulation?.simulationId;
    if (runId && pausedReader?.simulationId !== runId) {
      void restorePausedReader(currentGame);
    }
  }, [currentGame?.id, currentGame?.pausedSimulation?.simulationId, pausedReader?.simulationId]);

  /** «Continua»: autorizza il checkpoint per-evento successivo del run sospeso. */
  const handleContinueNext = async () => {
    if (!currentGame || !pausedReader || loading) return;
    setLoading(true);
    try {
      const result = await gameApi.continueSimulation(currentGame.id, pausedReader.simulationId);
      if (result.type === 'awaiting_next' && result.event) {
        setPausedReader(previous => {
          const earlier = previous?.simulationId === result.simulationId
            ? (previous.disclosedEvents || [previous.event])
            : [];
          return {
            simulationId: result.simulationId,
            event: result.event!,
            remaining: result.remaining ?? 0,
            destination: result.destination ?? '',
            checkpointId: result.checkpointId,
            revision: result.revision,
            // HTTP e SSE possono arrivare in ordine diverso: l'ID canonico
            // impedisce di duplicare una pagina già letta nel foglio G22.
            disclosedEvents: [...earlier.filter(event => event.id !== result.event!.id), result.event!],
          };
        });
        setCurrentGame(prev => prev ? { ...prev, currentDate: result.newDate, currentTurn: result.newTurn } : prev);
        applyCheckpointRegions(result.changedRegions);
      } else {
        // run_completed / paused_budget / intervened: il salto è chiuso.
        await applyRunCompletion(result);
      }
      // La coda autorevole dopo ogni decisione del lettore (G14/G15).
      const authoritativeQueue = await gameApi.getPendingActions(currentGame.id);
      setPendingActions(authoritativeQueue.pendingActions || []);
    } catch (e) {
      console.error('Continue simulation failed:', e);
    } finally {
      setLoading(false);
    }
  };

  /** «Intervieni qui»: chiude il salto al checkpoint mostrato (§9.3). */
  const handleInterveneHere = async () => {
    if (!currentGame || !pausedReader || loading) return;
    setLoading(true);
    try {
      const result = await gameApi.intervene(currentGame.id, pausedReader.simulationId,
        pausedReader.revision != null
          ? { eventId: pausedReader.event.id, revision: pausedReader.revision }
          : undefined);
      if (result.intervened) {
        await applyRunCompletion(result as any);
      } else {
        setPausedReader(null);
      }
      const authoritativeQueue = await gameApi.getPendingActions(currentGame.id);
      setPendingActions(authoritativeQueue.pendingActions || []);
    } catch (e) {
      console.error('Intervene here failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return {
    pausedReader, setPausedReader,
    temporalScars, setTemporalScars,
    scarTimersRef,
    applyCheckpointRegions,
    applyRunCompletion,
    restorePausedReader,
    handleContinueNext,
    handleInterveneHere,
  };
}
