/**
 * World Story — Fase 2: `useSimulationStream`
 * ==========================================
 * La sottoscrizione SSE — turni, eventi di salto, dispacci committati, chat
 * diplomatica live, crisi e fine partita — era un blocco di ~240 righe dentro
 * `App.tsx`. Questo hook lo possiede, con il contratto invariato:
 *
 *  - le anteprime LLM non mutano mai data, mappa o bollettino: solo il
 *    checkpoint committato aggiorna il client (I11);
 *  - HTTP, SSE e polling possono arrivare in ordine diverso: gli ID canonici
 *    rendono innocui replay e duplicati;
 *  - alla riconnessione si reinvia la chiave browser prima della prossima
 *    elaborazione LLM;
 *  - l'errore SSE non sblocca «Avanza»: il job HTTP asincrono resta autorevole.
 *
 * Feed, playback e timeline sono hook con stato proprio: qui ricevono i loro
 * valori dall'unica istanza creata in `App`, mai da una seconda chiamata.
 */
import { useEffect, useRef } from 'react';
import { chatsApi, gameApi } from '../services/api';
import type { GameEnding } from '../services/api';
import { normalizeWorldEventPayload } from '../services/dispatches';
import { useSSE } from '../services/sse';
import { useChatStore, useGameStore } from '../stores';
import { useSimulationStore } from '../stores/simulationRuntime';
import { useToast } from '../components/ui/ToastProvider';

export interface UseSimulationStreamOptions {
  gameId: string | null;
  pushFeed: (
    text: string,
    kind: any,
    date?: string,
    detail?: string,
    eventId?: string,
    announce?: boolean,
    regionIds?: string[],
  ) => void;
  setFeedItems: React.Dispatch<React.SetStateAction<any[]>>;
  applyCheckpointRegions: (changedRegions: any[] | undefined) => void;
  setPausedReader: React.Dispatch<React.SetStateAction<any>>;
  pausedReader: any;
  handleTimelineOpen: () => Promise<void>;
  rehydrateBrowserApiKey: () => Promise<void>;
  setGameEnding: React.Dispatch<React.SetStateAction<GameEnding | null>>;
  setIsProcessingTurn: React.Dispatch<React.SetStateAction<boolean>>;
  setTurnProgress: React.Dispatch<React.SetStateAction<string>>;
}

export interface SimulationStream {
  /** ID del run in corso visto dallo stream: usato da Intervieni e dalla ripresa. */
  activeSimulationIdRef: React.MutableRefObject<string | undefined>;
}

export function useSimulationStream({
  gameId,
  pushFeed,
  setFeedItems,
  applyCheckpointRegions,
  setPausedReader,
  pausedReader,
  handleTimelineOpen,
  rehydrateBrowserApiKey,
  setGameEnding,
  setIsProcessingTurn,
  setTurnProgress,
}: UseSimulationStreamOptions): SimulationStream {
  const { setCurrentGame, setCurrentWorld, setChangedRegions, clearChangedRegions, addHistory } = useGameStore();
  const { notify } = useToast();

  const activeSimulationIdRef = useRef<string | undefined>();
  const streamedEventCountRef = useRef(0);

  useSSE(gameId, {
    onTurnStart: (data) => {
      console.log('[SSE] Turn started:', data);
      activeSimulationIdRef.current = data?.simulationId;
      streamedEventCountRef.current = 0;
      setIsProcessingTurn(true);
      setTurnProgress('Elaborazione mossa...');
    },
    onGeneratingNarration: () => {
      console.log('[SSE] Generating narration...');
      setTurnProgress('Generazione narrazione...');
    },
    onLLMProgress: (data) => {
      const ready = data.eventsReady ?? streamedEventCountRef.current;
      setTurnProgress(ready > 0
        ? `Generazione del prossimo evento… ${ready} già ${ready === 1 ? 'pubblicato' : 'pubblicati'}`
        : `Generazione del primo evento… ${data.chars} car.`);
    },
    onJumpEvent: (data) => {
      // §9.3: checkpoint per-evento committato — data, mappa e lettore si
      // aggiornano insieme al checkpoint, con ID canonico per la dedup HTTP/SSE.
      if (data.checkpoint) {
        // F06 µ2: l’evento va allo stesso reducer di HTTP e polling.
        useSimulationStore.getState().dispatch({
          scope: 'timeline',
          worldRevision: data.revision,
          sequence: data.revision ?? data.index + 1,
          eventId: data.eventId || (data.simulationId ? `${data.simulationId}-${data.index}` : undefined),
          payload: {
            event: { id: data.eventId || (data.simulationId ? `${data.simulationId}-${data.index}` : ''), date: data.event?.date || '', headline: data.event?.headline || '', detail: data.event?.description, source: 'world' },
            changedRegions: data.changedRegions,
            awaitingNext: data.awaitingNext ? { remaining: data.awaitingNext.remaining, destination: data.awaitingNext.destination } : undefined,
            checkpointId: data.checkpointId,
          },
        });
        if (data.event?.date) {
          setCurrentGame(prev => prev ? { ...prev, currentDate: data.event.date } : prev);
        }
        applyCheckpointRegions(data.changedRegions);
        if (data.event?.headline) {
          // Il checkpoint che richiede decisione è già presentato dal lettore
          // G22: non sovrapponiamo una seconda notizia centrale.
          pushFeed(data.event.headline, 'world', data.event.date, data.event.description, data.eventId, !data.awaitingNext, (data.changedRegions || []).map((r: any) => r.id));
        }
        if (data.awaitingNext && data.simulationId) {
          const event = {
            id: data.eventId || `${data.simulationId}-${data.index}`,
            date: data.event.date,
            headline: data.event.headline,
            detail: data.event.description,
            source: 'world',
          };
          setPausedReader((previous: any) => {
            const earlier = previous && previous.simulationId === data.simulationId
              ? (previous.disclosedEvents || [previous.event])
              : [];
            return {
              simulationId: data.simulationId!, event,
              remaining: data.awaitingNext!.remaining,
              destination: data.awaitingNext!.destination,
              checkpointId: data.checkpointId, revision: data.revision,
              disclosedEvents: [...earlier.filter((item: any) => item.id !== event.id), event],
            };
          });
        }
        setTurnProgress(`Evento applicato: ${data.event?.headline || ''}`);
        return;
      }
      const number = data.index + 1;
      streamedEventCountRef.current = Math.max(streamedEventCountRef.current, number);
      setTurnProgress(`Evento ${number}: ${data.event?.headline || ''}`);
      // Feed live: l'evento appare nel momento esatto in cui il modello lo completa.
      // F06 passo 6: le ANTEPRIME non commesse non aprono mai il bollettino
      // (news flash riservato ai checkpoint commessi); restano solo in cronaca.
      if (data.event?.headline) {
        pushFeed(`Evento ${number}: ${data.event.headline}`, 'live', data.event.date, data.event.description, undefined, false);
      }
      // Anteprime LLM non mutano mai il client: data e mappa si aggiornano
      // solo con il checkpoint committato (turn_complete).
      if (data.checkpoint && data.event?.date) {
        setCurrentGame(prev => prev ? { ...prev, currentDate: data.event.date } : prev);
      }
      if (data.checkpoint && data.changedRegions?.length) {
        const liveWorld = useGameStore.getState().currentWorld;
        if (liveWorld) {
          const regions = { ...liveWorld.regions };
          for (const changed of data.changedRegions || []) {
            if (regions[changed.id]) regions[changed.id] = { ...regions[changed.id], ...changed };
          }
          setCurrentWorld({ ...liveWorld, regions });
        }
        const ids = data.changedRegions.map((region: any) => region.id);
        setChangedRegions(ids);
        setTimeout(() => clearChangedRegions(), 3000);
      }
    },
    onActionVoided: (data) => {
      setTurnProgress(`⊘ Azione rifiutata: ${data.reason || data.action}`);
    },
    // La nazione è caduta: la partita si chiude con un epilogo, non con un
    // ennesimo turno. Il pannello resta finché il giocatore non sceglie.
    onGameOver: (data) => {
      if (data?.ending) {
        setGameEnding(data.ending);
        setIsProcessingTurn(false);
        setTurnProgress('');
      }
    },
    // Messaggio diplomatico live: aggiorna thread/lista e badge senza polling.
    onChatMessage: (data) => {
      const chatStore = useChatStore.getState();
      const isNewChannel = !chatStore.chats.some(chat => chat.id === data.chatId);
      chatStore.handleIncomingChatMessage(data);
      if (isNewChannel) {
        const interlocutors = (data.participants || [])
          .filter(participant => participant.role !== 'player')
          .map(participant => participant.name);
        const label = interlocutors.length > 1 ? 'Nuova riunione diplomatica' : 'Nuovo canale diplomatico';
        notify(`${label}${interlocutors.length ? `: ${interlocutors.join(', ')}` : ''}`, 'info');
      }
      const updated = useChatStore.getState();
      if (updated.chatPanelVisible && updated.activeChatId === data.chatId && gameId) {
        chatsApi.markRead(gameId, data.chatId)
          .then(() => useChatStore.getState().markRead(data.chatId))
          .catch(e => console.warn('[App] Impossibile segnare la chat come letta:', e));
      }
    },
    // Fase 3: commento proattivo del consulente dopo il turno — nel feed con nota
    onAdvisorProactive: (data) => {
      if (data?.content) {
        useChatStore.getState().addAdvisorMessage({
          role: 'assistant',
          content: data.content,
          proactive: true,
        });
      }
    },
    // Dispacci committati: l'outbox F02 invia un evento canonico alla volta;
    // advanceDate e i server precedenti possono ancora inviare un blocco.
    onWorldEvent: (data) => {
      console.log('[SSE] World event:', data);
      for (const dispatch of normalizeWorldEventPayload(data)) {
        pushFeed(
          dispatch.headline,
          'world',
          dispatch.date,
          dispatch.detail,
          dispatch.eventId,
          true,
          dispatch.regionIds,
        );
      }
      // Aggiorna data/turno e le regioni cambiate (payload aggregato legacy).
      // L'evento outbox singolo viene seguito dal turn_complete autorevole.
      if (data.newTurn && data.newDate) {
        setCurrentGame(prev => prev ? {
          ...prev,
          currentTurn: data.newTurn!,
          currentDate: data.newDate!,
        } : prev);
      }
      if (data.changedRegions?.length) {
        applyCheckpointRegions(data.changedRegions);
      }
    },
    onTurnComplete: (data) => {
      console.log('[SSE] Turn complete:', data);
      setIsProcessingTurn(false);
      activeSimulationIdRef.current = undefined;
      setTurnProgress('');
      // Il run scaglionato è chiuso: il lettore non chiede più decisioni.
      setPausedReader(null);
      if (data?.pausedBudget) {
        pushFeed('Nessun ulteriore sviluppo viene confermato nel periodo. Avanza di nuovo per proseguire la cronaca.', 'world', data.newDate);
      }

      // Il feed: gli eventi «live» di questo turno diventano eventi definitivi
      setFeedItems(prev => {
        const keep = prev.filter(i => i.kind !== 'live');
        const next = [...keep];
        for (const [index, ev] of (data?.events || []).entries()) {
          const eventId = data?.eventDetails?.[index]?.id;
          const id = eventId ? `tl-${eventId}` : `tc-${Date.now()}-${index}`;
          if (next.some(item => item.id === id)) continue;
          next.push({
            id,
            date: data?.eventDetails?.[index]?.date || data?.newDate,
            text: ev,
            detail: data?.eventDetails?.[index]?.detail || data?.narration,
            kind: 'world',
          });
        }
        return next.length > 120 ? next.slice(next.length - 120) : next;
      });

      // Add to history
      if (data) {
        addHistory({
          turn: data.turn,
          action: data.action || 'Mossa',
          result: data.narration,
          events: data.events,
          eventDetails: data.eventDetails,
          periodEnd: data.newDate,
        });

        // Update current game state
        if (data.newTurn && data.newDate) {
          setCurrentGame(prev => prev ? {
            ...prev,
            currentTurn: data.newTurn,
            currentDate: data.newDate,
          } : prev);
        }
        if (data.changedRegions?.length) {
          const liveWorld = useGameStore.getState().currentWorld;
          if (liveWorld) {
            const regions = { ...liveWorld.regions };
            for (const changed of data.changedRegions) {
              if (regions[changed.id]) regions[changed.id] = { ...regions[changed.id], ...changed };
            }
            setCurrentWorld({ ...liveWorld, regions });
          }
          setChangedRegions(data.changedRegions.map((region: any) => region.id));
          setTimeout(() => clearChangedRegions(), 3000);
        }
        void handleTimelineOpen();
      }
    },
    onConnected: () => {
      console.log('[SSE] Connected to game events');
      // Una riconnessione SSE spesso indica un riavvio del backend: reinvia
      // subito la chiave browser prima della prossima elaborazione LLM.
      void rehydrateBrowserApiKey();
    },
    onError: (error) => {
      console.error('[SSE] Error:', error);
      // Il job HTTP asincrono resta autorevole anche se il proxy interrompe
      // temporaneamente SSE: non nascondere il progresso né sbloccare Avanza.
    },
  });

  // F06 passo 6: se SSE cade, il polling del run recupera i checkpoint già
  // commessi: gli eventi vanno allo stesso reducer (la dedup per eventId rende
  // innocui i doppioni) e il lettore in pausa si riconcilia con awaitingNext.
  useEffect(() => {
    if (!gameId) return;
    const timer = window.setInterval(async () => {
      const runId = activeSimulationIdRef.current || pausedReader?.simulationId;
      if (!runId) return;
      try {
        const data = await gameApi.getSimulationRun(gameId, runId);
        const sim = useSimulationStore.getState();
        const runClosed = !data.awaitingNext && data.run?.status === 'completed';
        for (const event of data.events || []) {
          sim.dispatch({
            scope: 'timeline',
            eventId: event.id,
            payload: {
              event: { id: event.id, date: event.date, headline: event.headline, detail: event.detail, source: event.source || 'world' },
              changedRegions: [],
              checkpointId: event.checkpointId,
              awaitingNext: data.awaitingNext && data.awaitingNext.eventId === event.id
                ? { remaining: data.awaitingNext.remaining, destination: data.awaitingNext.destination }
                : undefined,
              runCompleted: runClosed && event.id === data.events?.[data.events.length - 1]?.id,
            },
          });
        }
        if (data.awaitingNext && pausedReader?.simulationId === runId
            && (pausedReader.remaining !== data.awaitingNext.remaining
                || pausedReader.destination !== data.awaitingNext.destination)) {
          setPausedReader((prev: any) => prev && prev.simulationId === runId ? {
            ...prev,
            remaining: data.awaitingNext!.remaining,
            destination: data.awaitingNext!.destination,
            revision: data.awaitingNext!.revision ?? prev.revision,
            checkpointId: data.awaitingNext!.checkpointId ?? prev.checkpointId,
          } : prev);
        }
        if (runClosed && pausedReader?.simulationId === runId) {
          setPausedReader(null);
        }
      } catch { /* run non più in memoria: nessuna azione */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [gameId, pausedReader?.simulationId, pausedReader?.remaining, pausedReader?.destination]);

  return { activeSimulationIdRef };
}

