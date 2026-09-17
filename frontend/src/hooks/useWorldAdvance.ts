/**
 * World Story — Fase 2: `useWorldAdvance`
 * ======================================
 * I comandi che fanno avanzare (o tornare indietro nel) mondo: salto temporale,
 * rewind, ripristino di un checkpoint, «Continua da qui», «Intervieni». Erano
 * ~320 righe di orchestrazione in `App.tsx`. Questo hook li possiede.
 *
 * Contratti invariati:
 *  - un run in pausa possiede il turno: un nuovo salto è rifiutato finché il
 *    giocatore non decide sul checkpoint mostrato;
 *  - F06: un game switch o un restore invalidano le risposte in volo (token di
 *    generazione e `invalidateCommand`);
 *  - HTTP, SSE e polling possono arrivare in ordine diverso: dopo ogni comando
 *    la coda persistita è riletta e il gioco è rifetchato dal server;
 *  - il 409 non è un errore generico: si riconcilia e si riapre il checkpoint.
 */
import { gameApi } from '../services/api';
import type { GameEnding } from '../services/api';
import { useActionsStore, useChatStore, useGameStore, useUIStore } from '../stores';
import { shouldResetSuggestions } from '../components/Game/suggestionsLifecycle';
import { useSimulationStore } from '../stores/simulationRuntime';
import { useToast } from '../components/ui/ToastProvider';
import { simulationErrorMessage } from '../utils/errors';

export interface UseWorldAdvanceOptions {
  publishEventDetails: (details: any[]) => void;
  applyCheckpointRegions: (changedRegions: any[] | undefined) => void;
  setPausedReader: React.Dispatch<React.SetStateAction<any>>;
  restorePausedReader: (game: any) => Promise<void>;
  pausedReader: any;
  handleTimelineOpen: () => Promise<void>;
  setGameEnding: React.Dispatch<React.SetStateAction<GameEnding | null>>;
  setNationalCrisis: React.Dispatch<React.SetStateAction<any>>;
  activeSimulationIdRef: React.MutableRefObject<string | undefined>;
  setIsProcessingTurn: React.Dispatch<React.SetStateAction<boolean>>;
  setTurnProgress: React.Dispatch<React.SetStateAction<string>>;
}

export interface WorldAdvance {
  handleTimeSkip: (days: number) => Promise<void>;
  handleRewindConfirmed: () => Promise<void>;
  handleRestoreCheckpoint: (simulationId: string) => Promise<void>;
  handleContinueFrom: (simulationId: string) => Promise<void>;
  handleIntervene: () => Promise<void>;
}

export function useWorldAdvance({
  publishEventDetails,
  applyCheckpointRegions,
  setPausedReader,
  restorePausedReader,
  pausedReader,
  handleTimelineOpen,
  setGameEnding,
  setNationalCrisis,
  activeSimulationIdRef,
  setIsProcessingTurn,
  setTurnProgress,
}: UseWorldAdvanceOptions): WorldAdvance {
  const { loading, setLoading } = useUIStore();
  const { notify } = useToast();
  // ARMY-MOVE P3: le proposte elaborate sono una fotografia del turno; le
  // azzera qui, nello stesso punto in cui si rilegge la coda autorevole.
  const clearSuggestions = useActionsStore((state) => state.clearSuggestions);
  const {
    currentGame, currentWorld, setCurrentGame, setCurrentWorld,
    setPendingActions, addHistory,
  } = useGameStore();

  const handleTimeSkip = async (days: number) => {
    if (!currentGame) return;
    // §9.3/§9.2: un run in pausa possiede il turno. Un nuovo salto è rifiutato
    // finché il giocatore non decide sul checkpoint mostrato.
    if (pausedReader || currentGame.pausedSimulation?.simulationId) {
      // Un refresh può arrivare prima della ricostruzione del lettore: il run
      // server è comunque autorevole e va riaperto, mai aggirato con un salto.
      if (!pausedReader) await restorePausedReader(currentGame);
      setTurnProgress('⏸ Un evento attende la tua decisione: Continua o Intervieni prima di avanzare di nuovo.');
      setTimeout(() => setTurnProgress(''), 5000);
      return;
    }

    setLoading(true);
    setIsProcessingTurn(true);
    setTurnProgress('Avvio della simulazione…');
    // F06 µ2: token di generazione — game switch e restore invalidano questa risposta.
    const commandToken = useSimulationStore.getState().beginCommand();

    try {
      const idempotencyKey = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `jump-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await gameApi.timeSkip(currentGame.id, days, idempotencyKey);
      // F06 passo 3: guardia all’applicazione per risposte vecchie — un game
      // switch o un restore avvenuti durante l’attesa scartano la risposta.
      if (useSimulationStore.getState().isStale(commandToken)) return;

      // F06 µ2: l’esito va allo stesso reducer di SSE e polling.
      const sim = useSimulationStore.getState();
      if (result.type === 'world_advanced' && result.revision) {
        const details = result.result?.eventDetails || [];
        for (const detail of details) {
          sim.dispatch({ scope: 'timeline', worldRevision: result.revision, sequence: result.revision, eventId: detail.id, payload: { event: { id: detail.id, date: detail.date, headline: detail.headline, detail: detail.detail, source: detail.source }, changedRegions: [] } });
        }
        publishEventDetails(details);
        if (!result.result?.eventDetails?.length && result.simulationId) {
          sim.dispatch({ scope: 'timeline', worldRevision: result.revision, sequence: result.revision, eventId: result.simulationId, payload: { event: { id: result.simulationId, date: result.result?.periodEnd || '', headline: result.result?.narration || 'Periodo', source: 'world' }, changedRegions: [] } });
        }
      }
      if (result.type === 'actions_processed' && result.revision) {
        const details = (result.actions || []).flatMap(a => a.result?.eventDetails || []);
        for (const detail of details) {
          sim.dispatch({ scope: 'timeline', worldRevision: result.revision, sequence: result.revision, eventId: detail.id, payload: { event: { id: detail.id, date: detail.date, headline: detail.headline, detail: detail.detail, source: detail.source }, changedRegions: [] } });
        }
        publishEventDetails(details);
      }
      if (result.type === 'awaiting_next' && result.event) {
        sim.dispatch({ scope: 'timeline', worldRevision: result.revision, sequence: result.revision, eventId: result.event.id, payload: { event: { id: result.event.id, date: result.event.date, headline: result.event.headline, detail: result.event.detail, source: result.event.source }, awaitingNext: { remaining: result.remaining ?? 0, destination: result.destination }, checkpointId: result.checkpointId, changedRegions: result.changedRegions } });
      }

      if (result.type === 'actions_processed') {
        for (const action of result.actions || []) {
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

        const lastAction = result.actions?.[result.actions.length - 1];
        if (lastAction?.result) {
          setCurrentGame(prev => prev ? {
            ...prev,
            currentTurn: (lastAction.result as any).turn + 1,
            currentDate: (lastAction.result as any).periodEnd,
          } : prev);
        }
      } else if (result.type === 'world_advanced' && result.result) {
        addHistory({
          turn: result.result.turn,
          action: days <= 0 ? 'Fino al prossimo evento importante' : 'Salto temporale',
          result: result.result.narration,
          events: result.result.events,
          eventDetails: result.result.eventDetails,
          periodStart: result.result.periodStart,
          periodEnd: result.result.periodEnd,
        });
        setCurrentGame(prev => prev ? {
          ...prev,
          currentTurn: result.newTurn!,
          currentDate: result.newDate!,
        } : prev);
      } else if (result.type === 'no_event_found') {
        // Nessun checkpoint è stato creato: la UI conserva data, mappa,
        // cronaca e coda e comunica soltanto l'esito della ricerca.
        setTurnProgress(`Nessun evento importante fino al ${result.searchedUntil || 'limite di ricerca'}.`);
      } else if (result.type === 'awaiting_next') {
        // §9.3: il salto fisso si è fermato al checkpoint del primo evento.
        // Il resto del periodo NON è svelato e attende la conferma esplicita.
        // Un retry idempotente non riporta l'evento: riconcilia dal server.
        if (result.event) {
          setPausedReader({
            simulationId: result.simulationId!,
            event: result.event,
            remaining: result.remaining ?? 0,
            destination: result.destination ?? '',
            checkpointId: result.checkpointId,
            revision: result.revision,
            disclosedEvents: [result.event],
          });
          setCurrentGame(prev => prev ? { ...prev, currentDate: result.newDate!, currentTurn: result.newTurn! } : prev);
          applyCheckpointRegions(result.changedRegions);
        } else {
          const refreshed = await gameApi.get(currentGame.id);
          setCurrentGame(refreshed);
          await restorePausedReader(refreshed);
        }
      } else if (result.type === 'simulation_replayed') {
        // Un retry HTTP ha già prodotto questo checkpoint: non aggiungere una
        // seconda storia; il refetch autorevole sotto riallinea UI e mappa.
        setTurnProgress('Checkpoint già elaborato: sincronizzazione in corso…');
      } else if (result.type === 'date_advanced') {
        const startDate = currentGame.currentDate || '1951-01-01';
        addHistory({
          turn: currentGame.currentTurn,
          action: `⏭️ Salto temporale`,
          result: `Avanzato di ${days} giorni`,
          periodStart: startDate,
          periodEnd: result.newDate,
        });

        setCurrentGame(prev => prev ? {
          ...prev,
          currentTurn: result.newTurn!,
          currentDate: result.newDate,
        } : prev);
      }

      // HTTP, SSE e polling possono arrivare in ordine diverso: la coda
      // persistita è l'unica sorgente di verità dopo un salto.
      const authoritativeQueue = await gameApi.getPendingActions(currentGame.id);
      setPendingActions(authoritativeQueue.pendingActions || []);
      // ARMY-MOVE P3: chiuso il turno, le proposte elaborate valgono zero —
      // erano costruite sulla fotografia precedente e si rigenerano soltanto
      // su richiesta («Elabora proposte»). `no_event_found` non ha committato
      // nulla e le conserva.
      if (shouldResetSuggestions(result.type)) clearSuggestions();

      // Il checkpoint server è autorevole anche per la mappa: HTTP e SSE
      // possono arrivare in ordini diversi o lo stream può essere perso.
      const authoritativeGame = await gameApi.get(currentGame.id);
      setCurrentGame(authoritativeGame);
      // The complete snapshot includes names, geometry and newly added regions;
      // a whitelist merge against the pre-turn world silently discarded them.
      if (authoritativeGame.world) setCurrentWorld(authoritativeGame.world);
      // Anche senza SSE, il polling finale deve rendere subito visibili nuove
      // riunioni e badge diplomatici nati dagli eventi appena committati.
      await Promise.all([
        handleTimelineOpen(),
        useChatStore.getState().refreshChats(),
      ]);
    } catch (e: any) {
      console.error('Time-skip failed:', e);
      // Se il client è rimasto indietro (tab in background, refresh o SSE
      // perso), il 409 non è un errore da mostrare come fallimento generico:
      // riconciliamo e riapriamo il checkpoint decisionale.
      if (e?.status === 409) {
        try {
          const refreshed = await gameApi.get(currentGame.id);
          setCurrentGame(refreshed);
          await restorePausedReader(refreshed);
          // Il client era indietro: il turno è già committato lato server, la
          // fotografia delle proposte è superata come in un avanzamento normale.
          clearSuggestions();
          setTurnProgress('⏸ Playback ripristinato al checkpoint attivo.');
        } catch (reconcileError) {
          console.error('Unable to reconcile paused simulation:', reconcileError);
        }
      } else {
        setTurnProgress(simulationErrorMessage(e));
        setTimeout(() => setTurnProgress(''), 8000);
      }
    } finally {
      setLoading(false);
      setIsProcessingTurn(false);
    }
  };

  const handleRewindConfirmed = async () => {
    if (!currentGame || loading) return;
    setLoading(true);
    try {
      await gameApi.rewind(currentGame.id);
      const updatedGame = await gameApi.get(currentGame.id);
      setCurrentGame(updatedGame);
      // La mossa annullata riporta il mondo indietro: la fotografia su cui
      // erano costruite le proposte non è più quella.
      clearSuggestions();
      // Il turno annullato cancella anche il collasso: si torna a giocare.
      setGameEnding(null);
      setNationalCrisis(null);

      if (updatedGame.world && currentWorld) {
        const newRegions = { ...currentWorld.regions };
        const gameRegions = Array.isArray(updatedGame.world.regions)
          ? updatedGame.world.regions
          : Object.values(updatedGame.world.regions);
        gameRegions.forEach((r: any) => {
          if (newRegions[r.id]) {
            newRegions[r.id] = {
              ...newRegions[r.id],
              owner: r.owner,
              color: r.color,
              population: r.population,
              militaryPower: r.militaryPower,
              gdp: r.gdp,
            };
          }
        });
        setCurrentWorld({ ...currentWorld, regions: newRegions });
      }

      addHistory({
        turn: updatedGame.currentTurn,
        action: '⏪ Ripristino',
        result: 'Ultima mossa annullata, il mondo è tornato allo stato precedente',
      });
    } catch (e) {
      console.error('Rewind failed:', e);
      notify('Impossibile annullare la mossa: lo snapshot è disponibile dopo la prima mossa giocata.', 'error');
    }

    setLoading(false);
  };

  // Ripristino esplicito del checkpoint che ha prodotto un evento timeline.
  const handleRestoreCheckpoint = async (simulationId: string) => {
    if (!currentGame || loading) return;
    setLoading(true);
    try {
      const restored = await gameApi.restoreSimulationCheckpoint(currentGame.id, simulationId);
      const updatedGame = await gameApi.get(currentGame.id);
      setCurrentGame(updatedGame);
      // Il ripristino sostituisce la fotografia del mondo: le proposte del
      // ramo abbandonato non descrivono più nulla.
      clearSuggestions();
      // F06 µ2: il restore apre un ramo nuovo — reset canonico del client con
      // il suo anchor, e invalidazione di TUTTI i comandi in volo (chat,
      // advisor, coda, preflight — non soltanto il polling della cronaca).
      const rawRegions = Array.isArray(updatedGame.world.regions)
        ? updatedGame.world.regions
        : Object.values(updatedGame.world.regions || {});
      useSimulationStore.getState().branchReplace({
        gameId: currentGame.id,
        branchId: restored.branchId || 'unknown',
        anchor: restored.anchor
          ? { checkpointId: restored.anchor.checkpointId, revision: restored.anchor.revision }
          : { revision: restored.revision },
        snapshot: {
          date: restored.newDate,
          mapRegions: Object.fromEntries((rawRegions as any[]).map((region: any) => [region.id, { owner: region.owner, color: region.color, objects: region.objects || [] }])),
          pendingActions: [],
          history: [],
          news: [],
          chats: [],
        },
      });
      useSimulationStore.getState().invalidateCommand();
      // §9.3: il checkpoint ripristinato può appartenere a un run in pausa.
      await restorePausedReader(updatedGame);
      if (updatedGame.world && currentWorld) {
        const regions = { ...currentWorld.regions };
        const serverRegions = Array.isArray(updatedGame.world.regions)
          ? updatedGame.world.regions
          : Object.values(updatedGame.world.regions);
        for (const region of serverRegions as any[]) {
          if (regions[region.id]) regions[region.id] = {
            ...regions[region.id],
            owner: region.owner,
            color: region.color,
            population: region.population,
            militaryPower: region.militaryPower,
            gdp: region.gdp,
            objects: region.objects ?? regions[region.id].objects,
          };
        }
        setCurrentWorld({ ...currentWorld, regions });
      }
      await handleTimelineOpen();
      addHistory({
        turn: restored.newTurn,
        action: '⏪ Ripristino checkpoint',
        result: `Ripristinato checkpoint ${restored.checkpointId} del run ${restored.simulationId}.`,
        periodEnd: restored.newDate,
      });
    } catch (error) {
      console.error('Checkpoint restore failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // Continua da un evento: ripristina il checkpoint del run e lancia subito
  // il prossimo salto canonico (fino al prossimo evento importante).
  const handleContinueFrom = async (simulationId: string) => {
    if (!currentGame || loading) return;
    await handleRestoreCheckpoint(simulationId);
    // F06 passo 5: «Continua» procede soltanto dopo una risposta restore
    // valida con il suo nuovo anchor: senza ramo nuovo e checkpoint di origine
    // non c'è un futuro legittimo da continuare.
    const canonical = useSimulationStore.getState().state;
    if (!canonical || canonical.branchId === 'unknown' || !canonical.reader?.checkpointId) return;
    await handleTimeSkip(0);
  };

  // Intervene — ferma lo stream dopo l'ultimo evento già pubblicato
  const handleIntervene = async () => {
    if (!currentGame) return;
    try {
      await gameApi.intervene(currentGame.id, activeSimulationIdRef.current);
      setTurnProgress('⏸ Intervieni: arresto dopo l\'evento corrente…');
    } catch (e) {
      console.error('Intervene failed:', e);
    }
  };

  return {
    handleTimeSkip,
    handleRewindConfirmed,
    handleRestoreCheckpoint,
    handleContinueFrom,
    handleIntervene,
  };
}
