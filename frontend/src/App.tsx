/**
 * Open-Pax — Main App (Redesign)
 * ==============================
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapboxMapView } from './components/Map/MapboxMapView';
import { MapView } from './components/Map/MapView';
// DISATTIVATO: editor mappe (temporaneo)
// import { MapEditor, type EditorRegion, type EditorObject } from './components/Editor';
// import { CreateWorld, type WorldConfig } from './components/WorldBuilder/CreateWorld';
import { TemplateSelector } from './components/Game/TemplateSelector';
import { CountrySelector } from './components/Game/CountrySelector';
import { DiplomacyPanel } from './components/Game/DiplomacyPanel';
import { ChatsPanel } from './components/Game/ChatsPanel';
import { AdvisorChat } from './components/Game/AdvisorChat';
import { Landing } from './components/Game/Landing';
import { SaveGameModal } from './components/Game/SaveGameModal';
import { LLMSettingsModal } from './components/Game/LLMSettingsModal';
import { HudBar } from './components/Game/HudBar';
import { GameLoader, WORLD_GEN_PHASES } from './components/Game/GameLoader';
import { Fab } from './components/Game/Fab';
// DISATTIVATO: editor mappe (temporaneo) — mapApi era usato solo dall’editor/«Le mie mappe»
import { chatsApi, gameApi, worldApi, savesApi, llmApi, type TimelineEntry } from './services/api';
import type { Region, World, Game } from './types';
import { useGameStore, useUIStore, useActionsStore, useChatStore, selectTotalUnread } from './stores';
import { useSSE } from './services/sse';
import { EventFeed, type FeedItem } from './components/Game/EventFeed';

// DISATTIVATO: editor mappe (temporaneo) — helper punti nel path SVG usato solo
// al salvataggio mappe dall’editor (handleSaveMapLocal/handleSaveMap)
// // Funzione di supporto: punti nel path SVG
// const pointsToPath = (points: { x: number; y: number }[]): string => {
//   if (points.length === 0) return '';
//   return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
// };

// Funzione di supporto: formattazione intervallo di date
const formatDateRange = (start: string, end: string): string => {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);

    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

    const startStr = `${startDate.getDate()} ${months[startDate.getMonth()]} ${startDate.getFullYear()}`;
    const endStr = `${endDate.getDate()} ${months[endDate.getMonth()]} ${endDate.getFullYear()}`;

    return `${startStr} — ${endStr}`;
  } catch {
    return `${start} — ${end}`;
  }
};

function App() {
  // Stores
  const {
    currentGame, currentWorld, selectedRegion, history, pendingActions, changedRegions,
    generatedWorld, selectedCountry,
    setCurrentGame, setCurrentWorld, setSelectedRegion, setHistory, addHistory,
    setPendingActions, addPendingAction, removePendingAction, clearPendingActions,
    setChangedRegions, clearChangedRegions, setGeneratedWorld, setSelectedCountry,
    reset: resetGame
  } = useGameStore();

  const {
    currentView, loading, showJumpMenu, jumpDays, showSavesMenu,
    showPromptEditor, editingPrompt,
    showActions, actionsMaximized, actionsSize, isResizing,
    // DISATTIVATO: editor mappe (temporaneo) — selectedMapForWorld, savedMaps,
    selectedTemplate,
    setCurrentView, setLoading, setShowJumpMenu, setJumpDays, setShowSavesMenu,
    setShowPromptEditor, setEditingPrompt,
    setShowActions, setActionsMaximized, setActionsSize, setIsResizing,
    // DISATTIVATO: editor mappe (temporaneo) — setSelectedMapForWorld, setSavedMaps, addSavedMap,
    setSelectedTemplate,
    resetUI
  } = useUIStore();

  const {
    suggestions, newActionText,
    setSuggestions, setNewActionText, clearSuggestions,
    reset: resetActions
  } = useActionsStore();

  // Brainstorm di azioni: stato e messaggio sono visibili anche al primo caricamento.
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  // Modifica di un ordine in coda prima della presa in carico (G04 / §6.1).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingActionText, setEditingActionText] = useState('');

  // G24 — anteprima «Migliora formulazione»: proposta riformulata da confermare.
  const [enhanceLoading, setEnhanceLoading] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);

  // Fase 3: Consulente live (tab del pannello flottante) + chat diplomatiche riattivate.
  const panelTab = useChatStore(s => s.panelTab);
  const setPanelTab = useChatStore(s => s.setPanelTab);
  const totalUnread = useChatStore(selectTotalUnread);

  // Timeline del mondo: eventi del turno correnti + fetch quando il pannello si apre
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [ongoingProcesses, setOngoingProcesses] = useState<Array<{
    id: string; title: string; summary: string; started_date: string; expected_date?: string | null;
  }>>([]);
  const timelineRequestRef = useRef(0);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineNextAfter, setTimelineNextAfter] = useState(0);
  const [timelineLoadingOlder, setTimelineLoadingOlder] = useState(false);
  const handleTimelineOpen = async () => {
    const requestedGameId = currentGame?.id;
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
    const requestedGameId = currentGame?.id;
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

  // Collegamento di chatStore alla partita corrente (cambiando partita il feed del consulente si azzera)
  const currentGameId = currentGame?.id || null;
  const [nationalAccounts, setNationalAccounts] = useState<Record<string, any>>({});
  useEffect(() => {
    const chatStore = useChatStore.getState();
    chatStore.setGameId(currentGameId);
    timelineRequestRef.current++;
    setTimeline([]);
    setTimelineError('');
    setTimelineLoading(false);
    setFeedItems([]); // la cronaca riparte dalla timeline della nuova partita
    if (currentGameId) chatStore.refreshChats();
  }, [currentGameId]);

  // Chiave API solo-browser: a ogni apertura di partita (o avvio app) la
  // reinviamo al server in memoria — il server non la conserva su disco.
  useEffect(() => {
    const storedKey = localStorage.getItem('openpax_llm_apikey');
    if (!storedKey) return;
    llmApi.save({
      default: { apiKey: storedKey },
      persistApiKey: false,
    }).catch(() => {}); // silenzioso: la UI segnalerà comunque un eventuale errore LLM
  }, [currentGameId]);

  // ── Cronaca live (feed eventi sempre in vista) ─────────────────────────
  // Accumula gli eventi di TUTTI i turni (azione del giocatore + simulazione
  // live del mondo). I «live» sono gli eventi jump che arrivano in streaming
  // durante l'elaborazione; i «world» arrivano dal battito del mondo.
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const feedSeqRef = useRef(0);
  const streamedEventCountRef = useRef(0);
  const activeSimulationIdRef = useRef<string | undefined>();
  const [feedOpen, setFeedOpen] = useState(() => {
    // Mobile: sempre ripiegata all'avvio (il tab "Dispacci N" basta)
    if (window.innerWidth <= 720) return false;
    if (localStorage.getItem('openpax_feed_open') !== null) {
      return localStorage.getItem('openpax_feed_open') !== '0';
    }
    return true;
  });
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 720 && localStorage.getItem('openpax_panel_open') !== '0');

  const pushFeed = useCallback((
    text: string,
    kind: FeedItem['kind'],
    date?: string,
    detail?: string,
    eventId?: string,
  ) => {
    // Gli eventi provenienti dal server hanno un ID stabile: riusarlo rende
    // innocui replay SSE, riconnessioni e refetch della cronaca.
    const item: FeedItem = {
      id: eventId ? `tl-${eventId}` : `f${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      kind,
      date,
      detail,
    };
    setFeedItems(prev => {
      if (eventId && prev.some(existing => existing.id === item.id)) return prev;
      const next = [...prev, item];
      // Cap: tieni gli ultimi 120 eventi
      return next.length > 120 ? next.slice(next.length - 120) : next;
    });
  }, []);

  // Al cambio partita: prediscarica la cronaca storica dalla timeline
  useEffect(() => {
    if (!currentGameId) return;
    let cancelled = false;
    const refreshTimeline = () => gameApi.timeline(currentGameId)
      .then(data => {
        if (cancelled) return;
        const items: FeedItem[] = [];
        for (const entry of data.timeline || []) {
          for (const ev of entry.events || []) {
            items.push({ id: `tl-${ev.id}`, date: ev.date, text: ev.headline, detail: ev.detail || entry.narration, kind: 'timeline' });
          }
        }
        setTimeline(data.timeline || []);
        setFeedItems(prev => {
          // SSE è istantaneo quando il proxy lo consente; questo merge è il
          // recupero affidabile quando lo stream viene chiuso da Cloudflare.
          const byId = new Map(prev.map(item => [item.id, item]));
          for (const item of items) byId.set(item.id, item);
          return [...byId.values()].slice(-120);
        });
      })
      .catch(e => console.warn('[App] Feed: impossibile aggiornare la timeline:', e));
    void refreshTimeline();
    const timer = window.setInterval(() => void refreshTimeline(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentGameId]);


  // Il bollettino usa dati aggregati dal motore, non formule del browser.
  useEffect(() => {
    if (!currentGameId) { setNationalAccounts({}); return; }
    let cancelled = false;
    gameApi.nationalState(currentGameId)
      .then(data => { if (!cancelled) setNationalAccounts(data.accounts || {}); })
      .catch(error => console.warn('[App] Impossibile caricare il dossier nazionale:', error));
    return () => { cancelled = true; };
  }, [currentGameId, currentGame?.currentTurn]);

  useEffect(() => {
    useChatStore.getState().setChatPanelVisible(
      Boolean(showActions && panelTab === 'chats' && currentGameId)
    );
  }, [showActions, panelTab, currentGameId]);

  // Refs (not in store - DOM refs)
  const actionsRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Scorri la cronologia in basso
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Resize handler for actions panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !actionsRef.current) return;
      const rect = actionsRef.current.getBoundingClientRect();
      const newWidth = Math.max(300, Math.min(800, e.clientX - rect.left));
      const newHeight = Math.max(300, Math.min(700, window.innerHeight - rect.top - 20));
      setActionsSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setActionsSize, setIsResizing]);

  // DISATTIVATO: editor mappe (temporaneo) — caricamento mappe salvate per «Le mie mappe»/editor
  // useEffect(() => {
  //   const loadMaps = async () => {
  //     const maps: LocalMap[] = [];
  //
  //     try {
  //       const serverMaps = await mapApi.list();
  //       for (const m of serverMaps) {
  //         try {
  //           const fullMap = await mapApi.get(m.id);
  //           maps.push({
  //             id: `server_${m.id}`,
  //             name: fullMap.name,
  //             regions: fullMap.regions.map(r => ({
  //               id: r.id,
  //               name: r.name,
  //               color: r.color,
  //               path: r.path,
  //             })),
  //           });
  //         } catch (e) { /* skip */ }
  //       }
  //     } catch (e) { /* skip */ }
  //
  //     for (let i = 0; i < localStorage.length; i++) {
  //       const key = localStorage.key(i);
  //       if (key?.startsWith('map_')) {
  //         try {
  //           const data = JSON.parse(localStorage.getItem(key) || '{}');
  //           if (!maps.find(m => m.name === data.name)) {
  //             maps.push({ id: key, ...data });
  //           }
  //         } catch (e) { /* skip */ }
  //       }
  //     }
  //
  //     setSavedMaps(maps);
  //   };
  //
  //   loadMaps();
  // }, [setSavedMaps]);

  // DISATTIVATO: editor mappe (temporaneo) — salvataggio mappe, scelta mappa e creazione mondo
  // da mappa personalizzata (handleSaveMapLocal / handleSaveMap / handleSelectMap / handleCreateWorld)
  /*
  // Salva la mappa localmente
  const handleSaveMapLocal = (regions: EditorRegion[], mapName: string, objects?: EditorObject[]): LocalMap => {
    const mapData: LocalMap = {
      id: `map_${Date.now()}`,
      name: mapName,
      regions: regions.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        path: pointsToPath(r.points),
      })),
      objects: objects?.map(o => ({
        id: o.id,
        type: o.type,
        name: o.name,
        x: o.x,
        y: o.y,
        regionId: o.regionId,
      })),
    };
    localStorage.setItem(mapData.id, JSON.stringify(mapData));
    addSavedMap(mapData);
    return mapData;
  };

  // Salva la mappa sul server
  const handleSaveMap = async (regions: EditorRegion[], mapName: string, objects?: EditorObject[]) => {
    setLoading(true);
    const mapRegions = regions.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      path: pointsToPath(r.points),
    }));

    let serverMapId = null;
    try {
      const mapData = {
        name: mapName,
        width: 2000,
        height: 1500,
        regions: mapRegions,
        objects: objects?.map(o => ({
          id: o.id,
          type: o.type,
          name: o.name,
          x: o.x,
          y: o.y,
          regionId: o.regionId,
        })) || [],
      };
      const result = await mapApi.create(mapData);
      serverMapId = result.id;
      alert(`Mappa "${mapName}" salvata sul server!`);
    } catch (e) {
      console.warn('Failed to save map to server:', e);
    }

    const localMap = handleSaveMapLocal(regions, mapName, objects);
    if (serverMapId) {
      const updatedMap = { ...localMap, id: `server_${serverMapId}` };
      localStorage.removeItem(localMap.id);
      localStorage.setItem(updatedMap.id, JSON.stringify(updatedMap));
      setSavedMaps(prev => prev.filter(m => m.id !== localMap.id).concat(updatedMap));
    }

    setCurrentView('menu');
    setLoading(false);
  };

  // Scegli la mappa per creare il mondo
  const handleSelectMap = (map: LocalMap) => {
    setSelectedMapForWorld(map);
    setCurrentView('create-world');
  };

  // Crea il mondo dalla configurazione
  const handleCreateWorld = async (config: WorldConfig) => {
    setLoading(true);

    if (!selectedMapForWorld?.id.startsWith('server_')) {
      alert('Prima salva la mappa sul server (pulsante "Salva" nell’editor di mappe)!');
      setLoading(false);
      return;
    }

    const mapId = selectedMapForWorld.id.replace('server_', '');

    const initialOwners = config.regions
      .filter(r => r.owner !== 'neutral')
      .map(r => ({ id: r.id, owner: r.owner }));

    try {
      const result = await worldApi.createFromMap({
        mapId,
        name: config.name,
        description: config.description,
        startDate: config.startDate,
        basePrompt: config.basePrompt,
        historicalAccuracy: config.historicalAccuracy / 100,
        initialOwners,
      });

      const world = await worldApi.get(result.world_id);
      const mapObjects = selectedMapForWorld?.objects || [];

      const regions: Region[] = Object.values(world.regions || {}).map((r: any) => {
        const regionObjects = mapObjects
          .filter((o: any) => o.regionId === r.id)
          .map((o: any) => ({
            id: o.id,
            type: o.type,
            name: o.name,
            x: o.x,
            y: o.y,
            level: 1,
            metadata: {},
          }));

        return {
          id: r.id,
          name: r.name,
          svgPath: r.svgPath,
          color: r.color,
          owner: r.owner || 'neutral',
          population: r.population || 1000000,
          gdp: r.gdp || 100,
          militaryPower: r.militaryPower || 100,
          objects: regionObjects,
          borders: r.borders || [],
          status: r.status || 'active',
          metadata: {},
        };
      });

      setCurrentWorld({
        ...world,
        regions: regions.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}),
      } as World);

      const playerRegionInWorld = regions.find(r => r.owner === 'player');
      const initialPlayerRegionId = playerRegionInWorld?.id || regions[0]?.id || null;

      if (result.world_id && initialPlayerRegionId) {
        try {
          const gameResponse = await gameApi.create({
            world_id: result.world_id,
            player_name: 'Player',
            player_region_id: initialPlayerRegionId,
            difficulty,
          });
          const game = await gameApi.get(gameResponse.game_id);
          setCurrentGame(game);

          const playerRegionId = game.players[0]?.regionId || initialPlayerRegionId;
          setSelectedRegion(playerRegionId);
        } catch (e) {
          console.error('[DEBUG] Failed to create game via API:', e);
          setCurrentGame({
            id: 'local_' + Date.now(),
            world: { ...world, regions: regions.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}) } as World,
            players: [{ id: 'player_1', name: 'Player', regionId: initialPlayerRegionId, color: '#ff0000' }],
            currentTurn: 1,
            maxTurns: 100,
            status: 'playing' as any,
          } as Game);
          setSelectedRegion(initialPlayerRegionId);
        }
      }

      setCurrentView('game');
    } catch (e) {
      console.error('[DEBUG] Failed to create world via API:', e);
      const mapObjects = selectedMapForWorld?.objects || [];
      const regions: Region[] = selectedMapForWorld?.regions.map(r => {
        const regionObjects = mapObjects
          .filter((o: any) => o.regionId === r.id)
          .map((o: any) => ({
            id: o.id,
            type: o.type,
            name: o.name,
            x: o.x,
            y: o.y,
            level: 1,
            metadata: {},
          }));

        return {
          id: r.id,
          name: r.name,
          svgPath: r.path,
          color: r.color,
          owner: 'neutral',
          population: 1000000,
          gdp: 100,
          militaryPower: 100,
          objects: regionObjects,
          borders: [],
          status: 'active' as any,
          metadata: {},
        };
      }) || [];

      const regionsWithOwner = regions.map(r => {
        const ownerConfig = config.regions.find(cr => cr.id === r.id);
        return {
          ...r,
          owner: ownerConfig?.owner || 'neutral',
        };
      });

      setCurrentWorld({
        id: selectedMapForWorld?.id || 'local',
        name: selectedMapForWorld?.name || 'Local World',
        description: 'Mappa locale',
        startDate: '1951-01-01',
        basePrompt: 'Storia alternativa',
        historicalAccuracy: 0.8,
        regions: regionsWithOwner.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}),
        blocs: {},
      });

      const playerConfigRegion = config.regions.find(cr => cr.owner === 'player');
      const playerRegionId = playerConfigRegion?.id || regions[0]?.id || null;
      setSelectedRegion(playerRegionId);

      if (playerRegionId) {
        setCurrentGame({
          id: 'local_' + Date.now(),
          world: { ...currentWorld, regions: regionsWithOwner.reduce((acc: any, r) => { acc[r.id] = r; return acc; }, {}) },
          players: [{ id: 'player_1', name: 'Player', regionId: playerRegionId, color: '#ff0000' }],
          currentTurn: 1,
          maxTurns: 100,
          status: 'playing' as any,
        } as Game);
      }

      setCurrentView('game');
    }
    setLoading(false);
  };
  */

  // Invia le azioni (più di una)
  const handleSubmitActions = async (actions: string[]) => {
    if (!currentGame || actions.length === 0 || !selectedRegion) {
      return;
    }

    setLoading(true);

    const turn = currentGame.currentTurn;
    const actionsText = actions.join(' | ');

    if (currentGame.id.startsWith('local_')) {
      addHistory({
        turn,
        action: actionsText,
        result: `Il mondo ha reagito a ${actions.length} azioni in ${jumpDays} giorni...`,
        date: `${jumpDays} giorni`,
      });
      setCurrentGame({ ...currentGame, currentTurn: turn + 1 });
      setLoading(false);
      return;
    }

    try {
      const result = await gameApi.submitAction({
        game_id: currentGame.id,
        player_id: currentGame.players[0].id,
        text: actionsText,
      });

      // L'ordine è soltanto registrato. La data, mappa e cronaca restano
      // intatte fino al comando esplicito dal pannello Timeline.
      addPendingAction({ id: result.action.id, text: result.action.text });
      const authoritativeQueue = await gameApi.getPendingActions(currentGame.id);
      setPendingActions(authoritativeQueue.pendingActions || []);
    } catch (e) {
      // Un fallimento di registrazione non è un evento del mondo e non deve
      // produrre una falsa voce nella cronaca.
      console.error('Failed to queue action:', e);
    }

    setLoading(false);
  };

  // Time-skip handler (Phase 4)
  const handleTimeSkip = async (days: number) => {
    if (!currentGame) return;
    // §9.3/§9.2: un run in pausa possiede il turno. Un nuovo salto è rifiutato
    // finché il giocatore non decide sul checkpoint mostrato.
    if (pausedReader) {
      setTurnProgress('⏸ Un evento attende la tua decisione: Continua o Intervieni prima di avanzare di nuovo.');
      setTimeout(() => setTurnProgress(''), 5000);
      return;
    }

    setLoading(true);

    try {
      const idempotencyKey = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `jump-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await gameApi.timeSkip(currentGame.id, days, idempotencyKey);

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

      // Il checkpoint server è autorevole anche per la mappa: HTTP e SSE
      // possono arrivare in ordini diversi o lo stream può essere perso.
      const authoritativeGame = await gameApi.get(currentGame.id);
      setCurrentGame(authoritativeGame);
      if (authoritativeGame.world && currentWorld) {
        const regions = { ...currentWorld.regions };
        const serverRegions = Array.isArray(authoritativeGame.world.regions)
          ? authoritativeGame.world.regions
          : Object.values(authoritativeGame.world.regions);
        for (const region of serverRegions as any[]) {
          if (regions[region.id]) {
            regions[region.id] = {
              ...regions[region.id],
              owner: region.owner,
              color: region.color,
              population: region.population,
              militaryPower: region.militaryPower,
              gdp: region.gdp,
              objects: region.objects ?? regions[region.id].objects,
            };
          }
        }
        setCurrentWorld({ ...currentWorld, regions });
      }
      await handleTimelineOpen();
    } catch (e) {
      console.error('Time-skip failed:', e);
    }

    setLoading(false);
  };

  // Fase 2: Rewind — torna al turno precedente
  const handleRewind = async () => {
    if (!currentGame || loading) return;
    if (!window.confirm('Annullare l\'ultima mossa? Il mondo tornerà allo stato precedente.')) return;

    setLoading(true);
    try {
      await gameApi.rewind(currentGame.id);
      const updatedGame = await gameApi.get(currentGame.id);
      setCurrentGame(updatedGame);

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
      alert('Impossibile annullare la mossa — lo snapshot è disponibile dopo la prima mossa giocata.');
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

  // =========================================================================
  // §9.3 — Playback «un evento alla volta» per i salti fissi
  // =========================================================================

  /** Aggiorna la mappa col delta di un checkpoint per-evento committato. */
  const applyCheckpointRegions = (changedRegions: any[] | undefined) => {
    if (!changedRegions?.length) return;
    const liveWorld = useGameStore.getState().currentWorld;
    if (liveWorld) {
      const regions = { ...liveWorld.regions };
      for (const changed of changedRegions) {
        if (regions[changed.id]) regions[changed.id] = { ...regions[changed.id], ...changed };
      }
      setCurrentWorld({ ...liveWorld, regions });
    }
    setChangedRegions(changedRegions.map((region: any) => region.id));
    setTimeout(() => clearChangedRegions(), 3000);
  };

  /** Il run scaglionato è chiuso: finalizza cronaca, data e turno con gli
   * stessi percorsi di actions_processed/world_advanced. */
  const applyRunCompletion = async (outcome: {
    type: string;
    simulationId: string;
    actions?: any[];
    newDate: string;
    newTurn: number;
    result?: { turn: number; narration: string; events: string[]; eventDetails?: any[]; periodStart: string; periodEnd: string };
  }) => {
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
        });
      } else {
        setPausedReader(null);
      }
    } catch (e) {
      console.warn('[App] Impossibile ricostruire il run in pausa:', e);
      setPausedReader(null);
    }
  };

  /** «Continua»: autorizza il checkpoint per-evento successivo del run sospeso. */
  const handleContinueNext = async () => {
    if (!currentGame || !pausedReader || loading) return;
    setLoading(true);
    try {
      const result = await gameApi.continueSimulation(currentGame.id, pausedReader.simulationId);
      if (result.type === 'awaiting_next' && result.event) {
        setPausedReader({
          simulationId: result.simulationId,
          event: result.event,
          remaining: result.remaining ?? 0,
          destination: result.destination ?? '',
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
      const result = await gameApi.intervene(currentGame.id, pausedReader.simulationId);
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

  // Scegli il paese
  const handleCountryChange = (regionId: string) => {
    setSelectedRegion(regionId);
  };

  const generateSuggestions = async () => {
    if (!currentGame || suggestionsLoading) return;
    setSuggestionsLoading(true);
    setSuggestionsError('');
    try {
      const data = await gameApi.getSuggestions(currentGame.id);
      setSuggestions(data.suggestions || []);
      if (!data.suggestions?.length) {
        setSuggestionsError('Nessuna proposta ricevuta. Prova a generarle di nuovo.');
      }
    } catch (e) {
      console.error('[Suggestions] Generation failed:', e);
      setSuggestionsError('Il brainstorming non è disponibile ora. Riprova tra poco.');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const queuePlayerAction = async (text: string): Promise<boolean> => {
    if (!currentGame || !text.trim()) return false;
    if (pendingActions.some(action => action.text.trim() === text.trim())) return true;
    setSuggestionsError('');
    try {
      const queued = await gameApi.queueAction(currentGame.id, text.trim());
      addPendingAction({ id: queued.id, text: queued.text });
      return true;
    } catch (e) {
      console.error('[Actions] Failed to queue action:', e);
      setSuggestionsError('Impossibile aggiungere l’azione alla coda. Riprova.');
      return false;
    }
  };

  const removeQueuedAction = async (actionId: string) => {
    if (!currentGame) return;
    setSuggestionsError('');
    try {
      await gameApi.removePendingAction(currentGame.id, actionId);
      removePendingAction(actionId);
    } catch (e) {
      console.error('[Actions] Failed to remove action:', e);
      setSuggestionsError('L’azione è già in elaborazione o non può essere rimossa.');
    }
  };

  // Modifica persistita di un ordine in coda: non fa passare tempo e non
  // altera l'intenzione originale oltre il testo che il giocatore conferma.
  const updateQueuedAction = async (actionId: string, newText: string) => {
    if (!currentGame) return;
    setSuggestionsError('');
    try {
      const { action } = await gameApi.updatePendingAction(currentGame.id, actionId, newText);
      setPendingActions(pendingActions.map(a => a.id === action.id ? { ...a, text: action.text } : a));
      setEditingActionId(null);
      setEditingActionText('');
    } catch (e) {
      console.error('[Actions] Failed to update action:', e);
      setSuggestionsError('L’azione è già in elaborazione o non può essere modificata.');
    }
  };

  // G24 — «Migliora formulazione»: produce un'anteprima riformulata senza
  // accodare né simulare. L'accettazione della proposta è un click esplicito.
  const enhanceOrder = async (text: string) => {
    if (!currentGame) return;
    setSuggestionsError('');
    setEnhanceLoading(true);
    try {
      const { enhanced } = await gameApi.enhanceAction(currentGame.id, text);
      setEnhancedPreview(enhanced);
    } catch (e) {
      console.error('[Actions] Failed to enhance action:', e);
      setSuggestionsError('Il miglioramento della formulazione non è disponibile ora.');
    }
    setEnhanceLoading(false);
  };

  // Apertura del pannello: riallinea sempre la coda locale con quella server.
  const openActionsPanel = (brainstorm = false) => {
    setShowActions(true);
    if (currentGame) {
      gameApi.getPendingActions(currentGame.id)
        .then(data => setPendingActions(data.pendingActions || []))
        .catch(e => console.error('[Actions] Failed to sync queue:', e));
    }
    if (brainstorm && suggestions.length === 0) void generateSuggestions();
  };

  // Fase 6: ripresa di una partita salvata dalla landing
  const handleResumeSave = async (save: any) => {
    if (!save?.id || !save?.game_id) return;
    setLoading(true);
    try {
      await gameApi.loadSave(save.id);
      const game = await gameApi.get(save.game_id);
      setCurrentGame(game);
      setCurrentWorld(game.world);
      // §9.3: anche il playback in pausa sopravvive al caricamento.
      await restorePausedReader(game);
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
      alert('Errore di caricamento del salvataggio');
    } finally {
      setLoading(false);
    }
  };

  // Render del menu principale — Fase 6: landing in stile pax_home
  const renderMenu = () => (
    <Landing
      onNewGame={() => setCurrentView('select-template')}
      onOpenModelSettings={() => setShowLLMSettings(true)}
      // DISATTIVATO: editor mappe (temporaneo) — onOpenEditor={() => setCurrentView('editor')}
      // DISATTIVATO: editor mappe (temporaneo) — onSelectMap={handleSelectMap}
      onResumeSave={handleResumeSave}
      // DISATTIVATO: editor mappe (temporaneo) — savedMaps={savedMaps}
    />
  );

  // Format date for display
  const formatDate = (dateStr: string): string => {
    const months = [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
    ];
    const date = new Date(dateStr);
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  // Fase 7: bottom-sheet del pannello su mobile
  const [panelSheetOpen, setPanelSheetOpen] = useState(false);
  // All'apertura della partita su telefono il foglio resta chiuso: la mappa
  // deve essere subito utilizzabile, il pannello si apre con il suo handle.
  useEffect(() => {
    if (currentView === 'game' && window.innerWidth <= 720) setPanelSheetOpen(false);
  }, [currentView]);
  // SSE real-time updates
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [turnProgress, setTurnProgress] = useState<string>('');
  /** §9.3: lettore del playback «un evento alla volta» di un salto fisso. */
  const [pausedReader, setPausedReader] = useState<{
    simulationId: string;
    event: { id: string; date: string; headline: string; detail: string; source: string };
    remaining: number;
    destination: string;
  } | null>(null);
  // Fase 2: difficoltà della nuova partita
  const [difficulty, setDifficulty] = useState<string>('normal');

  // Fase 6: modale di salvataggio (al posto di prompt()) e fasi del loader di generazione del mondo
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [genPhase, setGenPhase] = useState(0);
  // Avanzamento reale (0..1) della generazione del mondo, dal polling del job
  const [genProgress, setGenProgress] = useState<number | null>(null);
  // Menu di scelta del modello IA (landing + pannello di gioco)
  const [showLLMSettings, setShowLLMSettings] = useState(false);

  // Rotazione delle fasi del loader mentre avviene la generazione del mondo nella schermata di scelta paese
  useEffect(() => {
    if (!loading || currentView !== 'select-country') return;
    setGenPhase(0);
    setGenProgress(null);
    const t = setInterval(() => {
      setGenPhase(p => Math.min(p + 1, WORLD_GEN_PHASES.length - 1));
    }, 12000);
    return () => clearInterval(t);
  }, [loading, currentView]);

  useSSE(currentGame?.id || null, {
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
        if (data.event?.date) {
          setCurrentGame(prev => prev ? { ...prev, currentDate: data.event.date } : prev);
        }
        applyCheckpointRegions(data.changedRegions);
        if (data.event?.headline) {
          pushFeed(data.event.headline, 'world', data.event.date, data.event.description, data.eventId);
        }
        if (data.awaitingNext && data.simulationId) {
          setPausedReader({
            simulationId: data.simulationId,
            event: {
              id: data.eventId || `${data.simulationId}-${data.index}`,
              date: data.event.date,
              headline: data.event.headline,
              detail: data.event.description,
              source: 'world',
            },
            remaining: data.awaitingNext.remaining,
            destination: data.awaitingNext.destination,
          });
        }
        setTurnProgress(`Evento applicato: ${data.event?.headline || ''}`);
        return;
      }
      const number = data.index + 1;
      streamedEventCountRef.current = Math.max(streamedEventCountRef.current, number);
      setTurnProgress(`Evento ${number}: ${data.event?.headline || ''}`);
      // Feed live: l'evento appare nel momento esatto in cui il modello lo completa.
      if (data.event?.headline) {
        pushFeed(`Evento ${number}: ${data.event.headline}`, 'live', data.event.date, data.event.description);
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
    // Messaggio diplomatico live: aggiorna thread/lista e badge senza polling.
    onChatMessage: (data) => {
      const chatStore = useChatStore.getState();
      chatStore.handleIncomingChatMessage(data);
      const updated = useChatStore.getState();
      if (updated.chatPanelVisible && updated.activeChatId === data.chatId && currentGame?.id) {
        chatsApi.markRead(currentGame.id, data.chatId)
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
    // Eventi del battito del mondo: la simulazione live avanza anche senza azioni
    onWorldEvent: (data) => {
      console.log('[SSE] World event:', data);
      for (const [index, ev] of (data.events || []).entries()) {
        const detail = data.eventDetails?.[index];
        pushFeed(ev, 'world', detail?.date || data.newDate, detail?.detail, detail?.id);
      }
      // Aggiorna data/turno e le regioni cambiate (conquisti NPC ecc.)
      if (data.newTurn && data.newDate) {
        setCurrentGame(prev => prev ? {
          ...prev,
          currentTurn: data.newTurn,
          currentDate: data.newDate,
        } : prev);
      }
      if (data.changedRegions?.length && currentWorld) {
        const updated = { ...currentWorld.regions };
        for (const cr of data.changedRegions) {
          if (updated[cr.id]) {
            updated[cr.id] = {
              ...updated[cr.id],
              owner: cr.owner,
              color: cr.color,
              population: cr.population,
              gdp: cr.gdp,
              militaryPower: cr.militaryPower,
            };
          }
        }
        setCurrentWorld({ ...currentWorld, regions: updated });
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
        pushFeed('⏸ Budget di simulazione esaurito: destinazione non raggiunta. Avanza di nuovo per continuare il periodo.', 'world', data.newDate);
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
    },
    onError: (error) => {
      console.error('[SSE] Error:', error);
      setIsProcessingTurn(false);
      activeSimulationIdRef.current = undefined;
      setTurnProgress('');
    },
  });

  const renderGame = () => {
    if (!currentWorld) return null;

    const regions: Region[] = Object.values(currentWorld.regions);
    const currentRegion = regions.find(r => r.id === selectedRegion);
    const provinceMetadata = currentRegion?.metadata || {};
    const isPaxProvince = Boolean(provinceMetadata.pax_region_id);
    const provinceAssets = (currentRegion?.objects || []).reduce((assets, object) => {
      if (object.type === 'factory') assets.factories += 1;
      else if (object.type === 'port') assets.ports += 1;
      else if (object.type === 'radar') assets.infrastructure += 1;
      else if (object.type === 'capital') assets.capital = true;
      else if (object.type === 'city') assets.cities += 1;
      else if (object.type === 'army' || object.type === 'battalion' || object.type === 'fleet') assets.units += 1;
      return assets;
    }, { factories: 0, ports: 0, infrastructure: 0, cities: 0, units: 0, capital: false });
    const infrastructureLevel = Number(provinceMetadata.infrastructure_level)
      || Math.min(5, 1 + provinceAssets.infrastructure + (provinceAssets.capital ? 2 : provinceAssets.cities > 0 ? 1 : 0));

    // Polis del giocatore (owner = polityId; da players.polityId, oppure dedotto dalla regione capitale)
    const playerPolityId = currentGame?.players?.[0]?.polityId
      ?? regions.find(r => r.id === currentGame?.players?.[0]?.regionId)?.owner
      ?? 'player';
    const nationalRegions = regions.filter(region => region.owner === playerPolityId);
    const nationalReference = nationalRegions.find(region => region.id === currentGame?.players?.[0]?.regionId) || nationalRegions[0];
    const nationalName = nationalReference?.polityName || nationalReference?.name || playerPolityId;
    const nationalAccount = nationalAccounts[playerPolityId];
    const nationalGdp = Number(nationalAccount?.nominalGdpUsdBillions ?? nationalRegions.reduce((sum, region) => sum + Number(region.gdp || 0), 0));
    const nationalPopulation = Number(nationalAccount?.population ?? nationalRegions.reduce((sum, region) => sum + Number(region.population || 0), 0));
    const estimatedRevenue = Number(nationalAccount?.monthlyRevenue ?? 0);
    const estimatedExpenses = Number(nationalAccount?.monthlyExpenses ?? 0);
    const campaignProgress = currentGame ? Math.round((currentGame.currentTurn / currentGame.maxTurns) * 100) : 0;
    const governmentTypes: Record<string, string> = {
      PSE: 'Autorità nazionale palestinese', USA: 'Repubblica federale presidenziale',
      RUS: 'Repubblica federale presidenziale', CHN: 'Repubblica popolare a partito unico',
      GBR: 'Monarchia parlamentare', FRA: 'Repubblica semipresidenziale',
      DEU: 'Repubblica federale parlamentare', ITA: 'Repubblica parlamentare',
    };
    const governmentType = nationalAccount?.government || governmentTypes[playerPolityId] || 'Repubblica presidenziale';
    const playerRegionId = currentGame?.players?.[0]?.regionId || nationalReference?.id || null;
    // Provincia esterna selezionata: il bollettino nazionale si nasconde, resta solo il dettaglio provincia.
    const externalRegionSelected = Boolean(currentRegion && currentRegion.id !== playerRegionId && currentRegion.owner !== playerPolityId);
    const selectedIsPlayerProvince = Boolean(currentRegion && (currentRegion.id === playerRegionId || currentRegion.owner === playerPolityId));
    const selectedRegionOwnerName = currentRegion?.polityName || currentRegion?.owner || null;
    const latestNationalNarration = timeline.length > 0 ? timeline[timeline.length - 1].narration : 'In attesa del primo dispaccio della simulazione.';

    return (
      <div className="game-wrapper">
        {/* Fase 6: HUD-bar in stile originale (data, rewind, pannello «Timeline») */}
        <HudBar
          worldName={currentWorld?.name || ''}
          turn={currentGame?.currentTurn || 1}
          dateISO={currentGame?.currentDate || '1951-01-01'}
          loading={loading}
          timeline={timeline}
          timelineLoading={timelineLoading}
          timelineError={timelineError}
          timelineHasMore={timelineHasMore}
          timelineLoadingOlder={timelineLoadingOlder}
          ongoingProcesses={ongoingProcesses}
          onTimelineOpen={handleTimelineOpen}
          onLoadOlder={loadOlderTimeline}
          onBack={() => {
            setCurrentView('menu');
            setCurrentWorld(null);
            setCurrentGame(null);
            setHistory([]);
          }}
          onRewind={handleRewind}
          onTimeSkip={handleTimeSkip}
          onRestoreCheckpoint={handleRestoreCheckpoint}
          onContinueFrom={handleContinueFrom}
        />

        <div className={`game-container${panelOpen ? '' : ' panel-closed'}`}>
          {/* Fase 2: banner di avanzamento turno + Intervene */}
          {isProcessingTurn && (
            <div className="turn-progress-banner">
              <span className="turn-progress-text">{turnProgress || 'Elaborazione mossa...'}</span>
              <button
                className="btn-intervene"
                onClick={handleIntervene}
                title="Ferma la simulazione dopo l'evento corrente"
              >
                ⏸ Intervene
              </button>
            </div>
          )}
          {/* §9.3: lettore del playback «un evento alla volta» — il tempo resta
              fermo finché il giocatore non autorizza il checkpoint successivo. */}
          {pausedReader && (
            <div className="event-reader-banner" role="region" aria-label="Evento in lettura">
              <div className="event-reader-meta">
                <span className="event-reader-date">{pausedReader.event.date}</span>
                <span className="event-reader-remaining">
                  {pausedReader.remaining > 0
                    ? `${pausedReader.remaining} ${pausedReader.remaining === 1 ? 'evento' : 'eventi'} ancora in sospeso`
                    : 'Ultimo evento del salto'}
                </span>
              </div>
              <h3 className="event-reader-title">{pausedReader.event.headline}</h3>
              {pausedReader.event.detail && (
                <p className="event-reader-detail">{pausedReader.event.detail}</p>
              )}
              <div className="event-reader-actions">
                <button
                  type="button"
                  className="btn-continue-next"
                  onClick={handleContinueNext}
                  disabled={loading}
                >
                  {pausedReader.remaining > 0
                    ? '▶ Continua'
                    : `▶ Avanza fino al ${pausedReader.destination}`}
                </button>
                <button
                  type="button"
                  className="btn-intervene"
                  onClick={handleInterveneHere}
                  disabled={loading}
                  title="Chiude il salto qui: il mondo resta a questa data"
                >
                  ⏸ Intervieni qui
                </button>
              </div>
              <p className="event-reader-note">Il tempo è fermo: il mondo riprende solo con la tua conferma.</p>
            </div>
          )}
          {/* Mappa a sinistra */}
          <div className="game-map">
            {regions.some(r => r.geojson) ? (
              <MapboxMapView
                regions={regions}
                selectedRegionId={selectedRegion || undefined}
                onRegionClick={handleCountryChange}
                changedRegionIds={changedRegions}
                showFlags={!!selectedCountry}
                playerCountryCode={selectedCountry || undefined}
              />
            ) : regions.some(r => r.svgPath) ? (
              <MapView
                regions={regions}
                selectedRegionId={selectedRegion || undefined}
                onRegionClick={handleCountryChange}
                changedRegionIds={changedRegions}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0a0a0f',
                color: '#667eea',
                padding: '40px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
                <h3>Caricamento mappa…</h3>
                <p style={{ color: '#888', maxWidth: '300px' }}>
                  Le regioni del mondo non hanno ancora una geometria.
                </p>
              </div>
            )}

            {/* Cronaca: feed eventi SEMPRE in vista, sovrapposto alla mappa.
                Gli eventi si accumulano turno dopo turno (azioni + simulazione
                live del mondo) ed evidenziano quelli della nazione in focus. */}
            <EventFeed
              items={feedItems}
              processing={isProcessingTurn}
              open={feedOpen}
              onToggleOpen={() => {
                setFeedOpen(o => {
                  localStorage.setItem('openpax_feed_open', o ? '0' : '1');
                  return !o;
                });
              }}
              focusedRegionName={currentRegion?.name}
            />
          </div>

          {/* Linguetta del pannello a scomparsa: sempre visibile sul bordo */}
          <button
            className="panel-toggle"
            onClick={() => {
              setPanelOpen(o => {
                localStorage.setItem('openpax_panel_open', o ? '0' : '1');
                return !o;
              });
            }}
            title={panelOpen ? 'Nascondi i dettagli della nazione' : 'Mostra i dettagli della nazione'}
          >
            {panelOpen ? '›' : '‹'}
          </button>

            {/* Accessi rapidi ad azioni e diplomazia, con badge live SSE. */}
            {!showActions && (
              <Fab items={[
                {
                  icon: 'ORD',
                  title: 'Ordini',
                  active: panelTab === 'suggestions',
                  onClick: () => {
                    setPanelTab('suggestions');
                    openActionsPanel(false);
                  },
                },
                {
                  icon: 'DIP',
                  title: 'Diplomazia',
                  active: panelTab === 'chats',
                  badge: totalUnread > 0 ? totalUnread : undefined,
                  onClick: () => {
                    setPanelTab('chats');
                    openActionsPanel(false);
                  },
                },
                {
                  icon: 'CON',
                  title: 'Consulente',
                  active: panelTab === 'advisor',
                  onClick: () => {
                    setPanelTab('advisor');
                    openActionsPanel(false);
                  },
                },
              ]} />
            )}

          {/* Bottone NAZIONE: fuori dal pannello, apre il bottom-sheet (mobile) */}
          <button
            className="nation-open-btn"
            onClick={() => {
              setPanelOpen(true);
              setPanelSheetOpen(true);
            }}
            title="Apri il pannello nazione"
          >☰ NAZIONE</button>

{showActions && (
              <div
                ref={actionsRef}
                className={`floating-advisor-panel ${actionsMaximized ? 'maximized' : ''}`}
                style={{
                  width: actionsMaximized ? '90%' : `${actionsSize.width}px`,
                  height: actionsMaximized ? '80vh' : `${actionsSize.height}px`,
                  left: actionsMaximized ? '5%' : '20px',
                  bottom: actionsMaximized ? '10vh' : '80px',
                }}
              >
                {/* Resize handle */}
                {!actionsMaximized && (
                  <div
                    className="resize-handle"
                    onMouseDown={() => setIsResizing(true)}
                  />
                )}

                <div className="floating-advisor-header">
                  <div className="panel-title">
                    {panelTab === 'suggestions' ? 'Ordini di governo' : panelTab === 'advisor' ? 'Consulente' : 'Relazioni estere'}
                  </div>
                  <div className="header-buttons">
                    <button
                      className="btn-maximize"
                      onClick={() => setActionsMaximized(!actionsMaximized)}
                      title={actionsMaximized ? 'Riduci' : 'Espandi'}
                    >
                      {actionsMaximized ? '−' : '□'}
                    </button>
                    <button className="btn-close" onClick={() => setShowActions(false)}>×</button>
                  </div>
                </div>

                {/* Actions Content */}
                {panelTab === 'suggestions' && (
                <div className="suggestions-content">
                  {/* Brainstorm nello stesso punto del pannello Azioni di Pax Historia. */}
                  <div className="council-head">
                    <div className="council-title">Pianifica la prossima mossa</div>
                    <div className="council-sub">Ordini concreti costruiti sulla mappa, la cronaca e la tua strategia</div>
                    <button
                      className="btn-generate-suggestions"
                      disabled={suggestionsLoading}
                      onClick={() => void generateSuggestions()}
                    >
                      {suggestionsLoading
                        ? <span className="council-working"><i></i><i></i><i></i> Analisi dello scenario…</span>
                        : 'Elabora proposte'}
                    </button>
                    {suggestionsError && (
                      <div className="suggestions-error" role="alert">{suggestionsError}</div>
                    )}
                  </div>

                  {/* Actions List */}
                  {suggestions.length > 0 && (
                    <div className="suggestions-list">
                      {suggestions.map((s, i) => (
                        <div key={i} className="suggestion-item">
                          <div className="suggestion-topic">{s.topic}</div>
                          <div className="suggestion-description">{s.description}</div>
                          {s.actions?.map((a: any, ai: number) => {
                            const queued = pendingActions.some(action => action.text.trim() === String(a.content || '').trim());
                            return (
                              <button
                                type="button"
                                key={ai}
                                className={`suggestion-action${queued ? ' queued' : ''}`}
                                disabled={queued}
                                onClick={() => void queuePlayerAction(a.content)}
                                title={queued ? 'Azione già in coda' : 'Aggiungi questa azione alla coda'}
                              >
                                <span className="suggestion-action-plus" aria-hidden="true">{queued ? '✓' : '+'}</span>
                                <span className="suggestion-action-body">
                                  <b>{a.title}</b>
                                  <span>{a.content}</span>
                                </span>
                                <span className="suggestion-action-cta">{queued ? 'Aggiunta' : 'Usa'}</span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pending Actions Section */}
                  <div className="pending-actions-section">
                    <div className="pending-header">In attesa di elaborazione:</div>
                    {pendingActions.length === 0 ? (
                      <div className="pending-empty">Nessuna azione</div>
                    ) : (
                      <div className="pending-list">
                        {pendingActions.map((action, index) => (
                          <div key={action.id} className="pending-item">
                            <span className="pending-number">{index + 1}.</span>
                            {editingActionId === action.id ? (
                              <>
                                <textarea
                                  className="pending-edit-input"
                                  value={editingActionText}
                                  onChange={(e) => setEditingActionText(e.target.value)}
                                  rows={2}
                                  aria-label={`Modifica azione ${index + 1}`}
                                />
                                <button
                                  className="btn-save-pending"
                                  disabled={!editingActionText.trim()}
                                  onClick={() => void updateQueuedAction(action.id, editingActionText)}
                                  title="Salva la modifica"
                                  aria-label={`Salva modifica azione ${index + 1}`}
                                >
                                  ✓
                                </button>
                                <button
                                  className="btn-cancel-pending"
                                  onClick={() => { setEditingActionId(null); setEditingActionText(''); }}
                                  title="Annulla la modifica"
                                  aria-label={`Annulla modifica azione ${index + 1}`}
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="pending-text">{action.text}</span>
                                <button
                                  className="btn-edit-pending"
                                  onClick={() => { setEditingActionId(action.id); setEditingActionText(action.text); }}
                                  title="Modifica l'ordine prima della presa in carico"
                                  aria-label={`Modifica azione ${index + 1}`}
                                >
                                  ✎
                                </button>
                                <button
                                  className="btn-remove-pending"
                                  onClick={() => void removeQueuedAction(action.id)}
                                  title="Rimuovi dalla coda"
                                  aria-label={`Rimuovi azione ${index + 1}`}
                                >
                                  ×
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Ordine libero: il convertitore LLM interpreta l'intenzione,
                      il motore verifica limiti e applica le conseguenze. */}
                  <div className="manual-action-input">
                    <label className="free-order-label" htmlFor="free-player-order">Ordine al governo</label>
                    <textarea
                      id="free-player-order"
                      value={newActionText}
                      onChange={(e) => setNewActionText(e.target.value)}
                      placeholder="Descrivi ciò che vuoi tentare. Il simulatore valuterà risorse, tempi, confini e conseguenze."
                      rows={3}
                    />
                    <div className="manual-action-actions">
                      <button
                        className="btn-enhance-pending"
                        onClick={() => void enhanceOrder(newActionText)}
                        disabled={!newActionText.trim() || enhanceLoading}
                        title="Migliora la formulazione senza inviare l'ordine"
                      >
                        {enhanceLoading ? 'Riformulo…' : 'Migliora formulazione'}
                      </button>
                      <button
                        className="btn-add-pending"
                        onClick={async () => {
                          const text = newActionText.trim();
                          if (text && await queuePlayerAction(text)) {
                            setNewActionText('');
                            setEnhancedPreview(null);
                          }
                        }}
                        disabled={!newActionText.trim()}
                      >
                        Invia ordine
                      </button>
                    </div>
                    {enhancedPreview && (
                      <div className="enhance-preview" role="status">
                        <div className="enhance-preview-label">Formulazione proposta</div>
                        <p className="enhance-preview-text">{enhancedPreview}</p>
                        <div className="enhance-preview-actions">
                          <button
                            className="btn-enhance-accept"
                            onClick={async () => {
                              if (await queuePlayerAction(enhancedPreview)) {
                                setNewActionText('');
                                setEnhancedPreview(null);
                              }
                            }}
                          >
                            Usa questa formulazione
                          </button>
                          <button
                            className="btn-enhance-reject"
                            onClick={() => setEnhancedPreview(null)}
                          >
                            Scarta
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* Fase 3: tab del Consulente live (streaming + sintesi proattive) */}
                {panelTab === 'advisor' && currentGame && (
                  <AdvisorChat gameId={currentGame.id} />
                )}

                {/* Chat diplomatiche (stile Pax Historia: anche chat di gruppo) */}
                {panelTab === 'chats' && currentGame && (
                  <ChatsPanel
                    gameId={currentGame.id}
                    regions={regions}
                    playerPolityId={playerPolityId}
                  />
                )}

                {/* Submit Button */}
                {panelTab === 'suggestions' && (
                <div className="suggestions-footer">
                  <button
                    className="btn-submit-actions"
                    disabled={pendingActions.length === 0 || loading}
                    onClick={async () => {
                      if (!currentGame || pendingActions.length === 0) return;
                      setLoading(true);
                      try {
                        const result = await gameApi.processAllActions(currentGame.id, 30);

                        for (const action of result.actions) {
                          if (action.result) {
                            addHistory({
                              turn: action.result.turn,
                              action: action.text,
                              result: action.result.narration,
                              events: action.result.events,
                              periodStart: action.result.periodStart,
                              periodEnd: action.result.periodEnd,
                            });
                          }
                        }

                        const lastAction = result.actions[result.actions.length - 1];
                        if (lastAction?.result) {
                          setCurrentGame(prev => prev ? {
                            ...prev,
                            currentTurn: (lastAction.result as any).turn + 1,
                            currentDate: (lastAction.result as any).periodEnd,
                          } : prev);
                        }

                        clearPendingActions();
                      } catch (e) {
                        console.error('Failed to process actions:', e);
                      }
                      setLoading(false);
                    }}
                  >
                    {loading ? 'Sto pensando...' : `Invia ${pendingActions.length} azione(i) →`}
                  </button>
                </div>
                )}
              </div>
            )}

          {/* Pannello a destra (a scomparsa: la linguetta a bordo mappa lo ripiega) */}
          <div
              className={`game-panel${panelSheetOpen ? ' sheet-open' : ''}${panelOpen ? '' : ' panel-collapsed'}`}
            >
            <div className="turn-header" style={{ display: 'none' }}>
              <span className="turn-number">MOSSA {currentGame?.currentTurn || 1}</span>
            </div>

            {/* Handle di chiusura del bottom-sheet (mobile): tap per richiudere */}
            <button
              className="sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setPanelSheetOpen(false);
                setPanelOpen(false);
              }}
              title="Chiudi il pannello"
            >✕</button>

            {selectedRegion && !externalRegionSelected && (
            <section className="nation-bulletin nation-bulletin-card" aria-label={`Bollettino di ${nationalName}`}>
              <div className="nation-bulletin-kicker">Stato della nazione</div>
              <h2>{nationalName}</h2>
              <p className="nation-government">{governmentType}</p>
              <div className="nation-progress"><span>Avanzamento campagna</span><b>{campaignProgress}%</b><i><em style={{ width: `${campaignProgress}%` }} /></i></div>
              <div className="nation-ledger">
                <span><small>POPOLAZIONE</small><b>{nationalPopulation.toLocaleString('it-IT')}</b></span>
                <span><small>PIL NOM.</small><b>${nationalGdp.toLocaleString('it-IT', { maximumFractionDigits: 1 })} mld</b></span>
                <span><small>ENTRATE / MESE</small><b>+${estimatedRevenue.toFixed(2)} mld</b></span>
                <span><small>USCITE / MESE</small><b>−${estimatedExpenses.toFixed(2)} mld</b></span>
              </div>
              <p className="nation-narration">{latestNationalNarration}</p>
            </section>
            )}

            {/* Country selector - locked to player's region */}
            {selectedRegion && !externalRegionSelected && (
            <div className="country-selector">
              <label>La tua nazione:</label>
              <div className="country-locked">
                {currentGame?.players[0] && (
                  <span style={{ color: currentRegion?.color || '#fff' }}>
                    {currentRegion?.name || 'Sconosciuto'}
                  </span>
                )}
              </div>
            </div>
            )}

            {/* Current country info */}
            {currentRegion && (
              <div className="country-info province-detail-card">
                <div className="province-detail-kicker">{selectedIsPlayerProvince ? 'Provincia · La tua nazione' : 'Provincia selezionata'}</div>
                <div className="country-name province-detail-title" style={{ color: currentRegion.color }}>
                  {currentRegion.name}
                </div>
                {!selectedIsPlayerProvince && selectedRegionOwnerName && (
                  <div className="province-owner">Appartenente a: {selectedRegionOwnerName}</div>
                )}
                <div className="country-stats">
                  <span><b>POP.</b> {currentRegion.population?.toLocaleString() || '1,000,000'}</span>
                  <span><b>PIL</b> {currentRegion.gdp || 100}</span>
                  <span><b>FORZE</b> {currentRegion.militaryPower || 100}</span>
                </div>
                {isPaxProvince && selectedIsPlayerProvince && (
                  <div className="province-dossier">
                    <div className="province-dossier-kicker">Provincia · {provinceMetadata.surface_type || 'Terra'}</div>
                    <div className="province-assets">
                      <span title="Livello infrastrutture, sviluppabile con gli ordini">⌁ INFRA <b>L{infrastructureLevel}</b></span>
                      <span title="Impianti industriali presenti">⚙ FAB. <b>{provinceAssets.factories}</b></span>
                      <span title="Porti presenti">⚓ PORTI <b>{provinceAssets.ports}</b></span>
                      <span title="Centri urbani nella provincia">● CITTÀ <b>{provinceAssets.cities + (provinceAssets.capital ? 1 : 0)}</b></span>
                      <span title="Unità militari schierate">▲ UNITÀ <b>{provinceAssets.units}</b></span>
                    </div>
                    {Array.isArray(provinceMetadata.tags) && provinceMetadata.tags.length > 0 && (
                      <div className="province-tags">{provinceMetadata.tags.slice(0, 3).join(' · ')}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Diplomacy panel: solo per la nazione del giocatore o province sue */}
            {currentGame && selectedRegion && !externalRegionSelected && (
              <DiplomacyPanel
                gameId={currentGame.id}
                selectedRegionId={selectedRegion}
                regions={regions}
                refreshKey={currentGame.currentTurn}
              />
            )}

            {/* Save/Load buttons */}
            <div className="save-load-section">
              <button
                className="btn-save"
                onClick={() => setShowSaveModal(true)}
              >
                Salva
              </button>
              <button
                className="btn-load"
                onClick={async () => {
                  try {
                    const data = await savesApi.list();
                    if (data.saves.length === 0) {
                      alert('Nessun salvataggio');
                      return;
                    }
                    const save = data.saves[0];
                    if (save && confirm(`Carica "${save.name}" (Mossa ${save.current_turn})?`)) {
                      await gameApi.loadSave(save.id);
                      if (currentGame) {
                        const game = await gameApi.get(currentGame.id);
                        setCurrentGame(game);
                        setHistory([]);
                        alert('Partita caricata!');
                      }
                    }
                  } catch (e) {
                    console.error(e);
                    alert('Errore di caricamento');
                  }
                }}
              >
                Carica
              </button>
              <button
                className="btn-edit-prompt"
                onClick={() => {
                  setEditingPrompt(currentWorld?.basePrompt || '');
                  setShowPromptEditor(true);
                }}
                title="Modifica il prompt del mondo"
              >
                Mondo
              </button>
              <button
                className="btn-edit-prompt"
                onClick={() => setShowLLMSettings(true)}
                title="Scegli il modello IA (provider e modello)"
              >
                Modello
              </button>
            </div>

            {/* Gli eventi sono nel feed «Cronaca» sulla mappa: sempre visibili,
                si accumulano turno dopo turno e restano in vista anche col
                pannello ripiegato o col focus su un'altra nazione. */}





            {/* History */}
            <div className="history-section">
              <h4>Storico</h4>
              <div className="history-list">
                {history.map((item, i) => (
                  <div key={i} className="history-item">
                    <div className="history-header">
                      <span className="history-turn">Mossa {item.turn}</span>
                      {item.periodStart && item.periodEnd ? (
                        <span className="history-date">
                          📅 {formatDateRange(item.periodStart, item.periodEnd)}
                        </span>
                      ) : item.date && (
                        <span className="history-date">📅 {item.date}</span>
                      )}
                    </div>
                    <div className="history-action">{item.action}</div>
                    <div
                      className="history-result"
                      style={{ '--nation-color': currentRegion?.color || '#667eea' } as React.CSSProperties}
                    >
                      {item.result}
                    </div>
                    {item.events && item.events.length > 0 && (
                      <div className="history-events">
                        {item.events.map((event, ei) => (
                          <div key={ei} className="history-event">• {event}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={historyEndRef} />
              </div>
            </div>

            {/* Back button */}
            <button className="btn-back" onClick={() => {
              setCurrentView('menu');
              setCurrentWorld(null);
              setCurrentGame(null);
              setHistory([]);
            }}>
              ← Al menu
            </button>

            {/* Fase 6: modale di salvataggio partita (al posto di prompt()) */}
            <SaveGameModal
              open={showSaveModal}
              defaultName={`Partita ${new Date().toLocaleString('it-IT')}`}
              onClose={() => setShowSaveModal(false)}
              onSave={async (name) => {
                if (!currentGame) return;
                try {
                  await gameApi.saveGame(currentGame.id, name);
                  setShowSaveModal(false);
                } catch (e) {
                  console.error(e);
                  alert('Errore di salvataggio');
                }
              }}
            />

            {/* Prompt Editor Modal */}
            {showPromptEditor && (
              <div className="prompt-editor-modal">
                <div className="prompt-editor-overlay" onClick={() => setShowPromptEditor(false)} />
                <div className="prompt-editor-content">
                  <div className="prompt-editor-header">
                    <h3>📝 Modifica prompt del mondo</h3>
                    <button className="btn-close-prompt" onClick={() => setShowPromptEditor(false)}>×</button>
                  </div>
                  <p className="prompt-editor-desc">
                    Questo prompt definisce la storia del tuo mondo, il comportamento degli NPC e gli eventi possibili.
                    Le modifiche avranno effetto dalle prossime mosse.
                  </p>
                  <textarea
                    className="prompt-editor-textarea"
                    value={editingPrompt}
                    onChange={(e) => setEditingPrompt(e.target.value)}
                    placeholder="Descrivi le caratteristiche chiave del tuo mondo..."
                    rows={10}
                  />
                  <div className="prompt-editor-footer">
                    <span className="char-count">{editingPrompt.length} caratteri</span>
                    <div className="prompt-editor-actions">
                      <button className="btn-cancel-prompt" onClick={() => setShowPromptEditor(false)}>
                        Annulla
                      </button>
                      <button
                        className="btn-save-prompt"
                        onClick={async () => {
                          if (!currentWorld) return;
                          try {
                            await worldApi.updatePrompt(currentWorld.id, editingPrompt);
                            setCurrentWorld({ ...currentWorld, basePrompt: editingPrompt });
                            setShowPromptEditor(false);
                            alert('Prompt del mondo aggiornato!');
                          } catch (e) {
                            console.error(e);
                            alert('Errore di salvataggio del prompt');
                          }
                        }}
                      >
                        💾 Salva
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // DISATTIVATO: editor mappe (temporaneo) — render dell’editor e della creazione mondo da mappa
  /*
  // Render dell’editor
  const renderEditor = () => (
    <MapEditor
      onSave={handleSaveMap}
      onCancel={() => setCurrentView('menu')}
    />
  );

  const renderCreateWorld = () => {
    if (!selectedMapForWorld) {
      return (
        <div className="error-container">
          <p>Nessuna mappa selezionata</p>
          <button onClick={() => setCurrentView('menu')}>Torna al menu</button>
        </div>
      );
    }

    return (
      <CreateWorld
        mapId={selectedMapForWorld.id.startsWith('server_')
          ? selectedMapForWorld.id.replace('server_', '')
          : selectedMapForWorld.id.replace('map_', '')}
        mapName={selectedMapForWorld.name}
        regions={selectedMapForWorld.regions}
        onSave={handleCreateWorld}
        onCancel={() => {
          setSelectedMapForWorld(null);
          setCurrentView('menu');
        }}
      />
    );
  };
  */

  return (
    <div className="app">
      {/* Fase 6: loader a schermo intero della generazione del mondo con fasi */}
      {loading && currentView === 'select-country' && (
        <GameLoader
          title="Creazione del mondo…"
          phase={WORLD_GEN_PHASES[genPhase]}
          progress={genProgress ?? undefined}
        />
      )}
      {/* Fase 6: loader durante la ripresa di una partita salvata */}
      {loading && currentView === 'menu' && (
        <GameLoader title="Caricamento dati di gioco…" />
      )}
      {currentView === 'menu' && renderMenu()}
      {currentView === 'select-template' && (
        <TemplateSelector
          onSelect={(template) => {
            setSelectedTemplate(template);
            setCurrentView('select-country');
          }}
          onBack={() => setCurrentView('menu')}
        />
      )}
      {currentView === 'select-country' && selectedTemplate && (
        <div>
          <div className="difficulty-selector">
            <label htmlFor="difficulty-select">Difficoltà:</label>
            <select
              id="difficulty-select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="story">Storia (molto facile)</option>
              <option value="easy">Facile</option>
              <option value="normal">Normale</option>
              <option value="hard">Difficile</option>
              <option value="very_hard">Molto difficile</option>
            </select>
          </div>
          <CountrySelector
          template={selectedTemplate}
          onSelect={async (countryCode) => {
            setSelectedCountry(countryCode);
            setLoading(true);
            try {
              const worldData = await worldApi.generateFromTemplate(
                selectedTemplate.id,
                countryCode,
                (p) => {
                  // Avanzamento reale dal backend + fase coerente col progresso
                  const ratio = p.total > 0 ? p.done / p.total : 0;
                  setGenProgress(ratio);
                  setGenPhase(Math.min(
                    WORLD_GEN_PHASES.length - 1,
                    Math.floor(ratio * WORLD_GEN_PHASES.length)
                  ));
                }
              );
              setGeneratedWorld(worldData);

              // Use correct region ID (prefixed with worldId)
              const actualRegionId = worldData.regionIds?.[countryCode] || countryCode;

              const gameResponse = await gameApi.create({
                world_id: worldData.worldId,
                player_name: 'Player',
                player_region_id: actualRegionId,
                difficulty,
              });

              const game = await gameApi.get(gameResponse.game_id);
              setCurrentGame(game);
              setCurrentWorld(game.world);
              setSelectedRegion(actualRegionId);
              setCurrentView('game');
            } catch (e) {
              console.error('[Game] Failed to generate world:', e);
              alert('Generazione del mondo fallita. Riprova.');
              setCurrentView('menu');
            } finally {
              setLoading(false);
            }
          }}
          onBack={() => setCurrentView('select-template')}
        />
        </div>
      )}
      {currentView === 'game' && renderGame()}
      {/* Menu di scelta del modello IA (Landing + pannello di gioco) */}
      <LLMSettingsModal
        open={showLLMSettings}
        onClose={() => setShowLLMSettings(false)}
      />
      {/* DISATTIVATO: editor mappe (temporaneo) — rotte 'editor' e 'create-world'
      {currentView === 'editor' && renderEditor()}
      {currentView === 'create-world' && renderCreateWorld()}
      */}
    </div>
  );
}

export default App;
