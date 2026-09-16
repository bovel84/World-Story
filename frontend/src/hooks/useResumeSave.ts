/**
 * World Story — Fase 2: `useResumeSave`
 * ====================================
 * La ripresa di una partita salvata dalla landing era una funzione di ~90 righe
 * in `App.tsx` che riallineava ogni read model e sostituiva lo snapshot
 * canonico del client. Questo hook la possiede.
 *
 * Contratto invariato (F06 passo 4):
 *  - i read model sono letti dallo stesso snapshot prima di pubblicarli;
 *  - il caricamento esplicito di un save sostituisce lo snapshot canonico
 *    (mappa INCLUSI oggetti, coda, history, news, chat, advisor, reader) e
 *    invalida tutti i comandi in volo — l'init effect non basta, perché il
 *    gameId può coincidere con la sessione precedente;
 *  - il playback in pausa sopravvive al caricamento (§9.3).
 */
import { gameApi } from '../services/api';
import { useActionsStore, useChatStore, useGameStore, useUIStore } from '../stores';
import { useOrderDraftStore } from '../stores/orderDraftStore';
import { useSimulationStore } from '../stores/simulationRuntime';
import { useToast } from '../components/ui/ToastProvider';

export interface UseResumeSaveOptions {
  // timeline
  setTimeline: React.Dispatch<React.SetStateAction<any[]>>;
  setTimelineHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setTimelineNextAfter: React.Dispatch<React.SetStateAction<number>>;
  setOngoingProcesses: React.Dispatch<React.SetStateAction<any[]>>;
  setCompletedProcesses: React.Dispatch<React.SetStateAction<any[]>>;
  // nazione
  setNationalAccounts: React.Dispatch<React.SetStateAction<any>>;
  setNationalHistory: React.Dispatch<React.SetStateAction<any[]>>;
  setNationalGovernment: React.Dispatch<React.SetStateAction<any>>;
  setGovernmentVoices: React.Dispatch<React.SetStateAction<any>>;
  setGovernmentVoicesError: React.Dispatch<React.SetStateAction<string | null>>;
  // feed
  setFeedItems: React.Dispatch<React.SetStateAction<any[]>>;
  // coda ordini
  setEditingActionId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingActionText: React.Dispatch<React.SetStateAction<string>>;
  // playback
  scarTimersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setTemporalScars: React.Dispatch<React.SetStateAction<any[]>>;
  restorePausedReader: (game: any) => Promise<void>;
}

export interface ResumeSave {
  handleResumeSave: (save: any) => Promise<void>;
}

export function useResumeSave(options: UseResumeSaveOptions): ResumeSave {
  const { notify } = useToast();
  const { setLoading, setCurrentView } = useUIStore();
  const {
    setCurrentGame, setCurrentWorld, setPendingActions, setHistory,
    setSelectedRegion, setSelectedCountry, clearChangedRegions,
  } = useGameStore();
  const { clearSuggestions } = useActionsStore();
  const clearOrderDraft = useOrderDraftStore((s) => s.clear);

  const handleResumeSave = async (save: any) => {
    if (!save?.id || !save?.game_id) return;
    setLoading(true);
    try {
      await gameApi.loadSave(save.id);
      const game = await gameApi.get(save.game_id);
      // Riallineamento atomico: i read model sono letti dallo stesso snapshot
      // prima di pubblicarlo al client, anche quando il gameId non cambia.
      const [queueData, timelineData, processData, nationalData] = await Promise.all([
        gameApi.getPendingActions(game.id),
        gameApi.timeline(game.id, { after: 0, limit: 200 }),
        gameApi.ongoingProcesses(game.id),
        gameApi.nationalState(game.id),
      ]);
      setCurrentGame(game);
      setCurrentWorld(game.world);
      setPendingActions(queueData.pendingActions || []);
      options.setTimeline(timelineData.timeline || []);
      options.setTimelineHasMore(Boolean(timelineData.hasMore));
      options.setTimelineNextAfter(timelineData.nextAfter ?? 0);
      options.setOngoingProcesses(processData.processes || []);
      options.setCompletedProcesses(processData.completed || []);
      options.setNationalAccounts(nationalData.accounts || {});
      options.setNationalHistory(nationalData.history || []);
      options.setNationalGovernment(nationalData.government ?? null);
      options.setGovernmentVoices(null);
      options.setGovernmentVoicesError(null);
      options.setFeedItems([]);
      clearOrderDraft();
      clearSuggestions();
      options.setEditingActionId(null);
      options.setEditingActionText('');
      options.scarTimersRef.current.forEach(clearTimeout);
      options.scarTimersRef.current = [];
      options.setTemporalScars([]);
      clearChangedRegions();
      // Forza il reset anche se si carica un save della stessa partita.
      const chatStore = useChatStore.getState();
      chatStore.setGameId(null);
      chatStore.setGameId(game.id);
      void chatStore.refreshChats();
      // F06 passo 4: il caricamento esplicito di un save sostituisce lo
      // snapshot canonico (mappa INCLUSI oggetti, coda, history, news, chat,
      // advisor, reader) e invalida tutti i comandi in volo. L'init effect
      // non basta: il gameId può coincidere con la sessione precedente.
      const savedRegions = Array.isArray(game.world.regions)
        ? game.world.regions
        : Object.values(game.world.regions || {});
      useSimulationStore.getState().branchReplace({
        gameId: game.id,
        branchId: game.headBranchId || 'unknown',
        anchor: { revision: game.worldRevision ?? 0 },
        snapshot: {
          date: game.currentDate,
          mapRegions: Object.fromEntries((savedRegions as any[]).map((region: any) => [
            region.id,
            { owner: region.owner, color: region.color, objects: region.objects || [] },
          ])),
          pendingActions: [],
          history: [],
          news: [],
          chats: [],
        },
      });
      useSimulationStore.getState().invalidateCommand();
      // §9.3: anche il playback in pausa sopravvive al caricamento.
      await options.restorePausedReader(game);
      const regionId = game.players?.[0]?.regionId;
      if (regionId) {
        setSelectedRegion(regionId);
        // Ripristiniamo il codice paese del giocatore (per le bandiere sulla mappa).
        // Nei mondi provinciali l'id regione è una provincia: il codice paese
        // giusto è la polity del giocatore (owner della regione).
        const regionOwner = Object.values(game.world?.regions || {})
          .find((r: any) => r.id === regionId)?.owner;
        const code = game.players[0]?.polityId || regionOwner || String(regionId).split('_').pop();
        if (code) setSelectedCountry(String(code));
      }
      setHistory([]);
      setCurrentView('game');
    } catch (e) {
      console.error('[Save] Failed to resume save:', e);
      notify('Errore di caricamento del salvataggio.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return { handleResumeSave };
}
