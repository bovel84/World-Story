/**
 * World Story — Fase 2: `GameScreen`
 * =================================
 * La vista della partita: HUD, rail dei moduli, mappa e desk. Era la funzione
 * `renderGame()` di `App.tsx` (~215 righe di JSX). Qui è un componente.
 *
 * Gli hook di gioco restano montati in `App` (devono sopravvivere al ritorno
 * alla landing per la ripresa di un salvataggio): questo componente riceve i
 * loro valori già calcolati come «bundle» tipizzati, mentre legge dagli store
 * Zustand tutto ciò che è già stato globale (gioco, UI, chat, bozza d'ordine).
 * Nessuna logica di gioco nuova: solo presentazione e selezione.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Region } from '../../types';
import { selectTotalUnread, useActionsStore, useChatStore, useGameStore, useUIStore } from '../../stores';
import { useOrderDraftStore } from '../../stores/orderDraftStore';
import { useToast } from '../ui/ToastProvider';
import { deriveNationalContext } from './nationalContext';
import { councilPresence } from './governmentDossier';
import { deriveWorldPresence } from './worldPresence';
import { deriveStrategicBriefing } from './strategicBriefing';
import { deriveImpactAtDate } from './checkpointImpact';
import { CompactBriefing } from './CompactBriefing';
import type { NationSnapshot } from '../../hooks/useNationSnapshot';
import type { WorldTimeline } from '../../hooks/useWorldTimeline';
import type { Feed } from '../../hooks/useFeed';
import type { OrderQueue } from '../../hooks/useOrderQueue';
import type { SimulationPlayback } from '../../hooks/useSimulationPlayback';
import type { WorldAdvance } from '../../hooks/useWorldAdvance';
import type { ShellState } from '../../hooks/useShellState';
import { GameShell } from '../Shell/GameShell';
import { HudBar } from './HudBar';
import { NewsFlash } from './NewsFlash';
import { SimulationEventReader } from './SimulationEventReader';
import { GameMenu } from '../Shell/GameMenu';
import { CommandRail } from '../Shell/CommandRail';
import { DeskContent } from '../Shell/DeskContent';
import { GovernmentOffice } from './GovernmentOffice';
import { ProvinceInspector } from '../Shell/ProvinceInspector';
import { GameMap } from './GameMap';
import { deriveRailItems } from './nationalContext';
import { countOpenQuestions } from './pressureWindow';
import { countTroubledUnits } from './operationalObjects';
import { actionSnapshotKey } from './actionSnapshot';
import type { MapFilters, MapLayer } from '../Map/mapModel';
import {
  buildMapContextIndex,
  mapContextRegionId,
  resolveMapContext,
  type MapContextSelection,
} from '../Map/mapContext';
import type { ActiveModule } from '../../stores/moduleState';
import { buildThematicMapModel } from '../Map/thematicMapModel';
import { assetsForStatus } from '../Map/mapThematicContext';

export interface GameScreenProps {
  nation: NationSnapshot;
  timeline: WorldTimeline;
  feed: Feed;
  orders: OrderQueue;
  playback: SimulationPlayback;
  advance: WorldAdvance;
  shell: ShellState;
}

export function GameScreen({ nation, timeline, feed, orders, playback, advance, shell }: GameScreenProps) {
  // P02 — La seduta del gabinetto arriva dall'hook degli ordini, non dallo
  // store della bozza: è una lettura del Governo, non una proprietà del testo.
  const { cabinet, cabinetLoading, cabinetError, loadCabinet, queuePlayerAction } = orders;
  const {
    currentGame, currentWorld, selectedRegion, setSelectedRegion, setCurrentGame, setCurrentWorld,
    setHistory, pendingActions, changedRegions, history: actionHistory,
  } = useGameStore();
  const { suggestions } = useActionsStore();
  const { loading, activeModule, openModule, closeModule, setShowPromptEditor, setCurrentView } = useUIStore();
  const {
    text: orderDraftText, enhancedPreview, enhanceLoading, enhanceError,
    update: updateOrderDraft, acceptEnhanced: acceptOrderEnhanced, rejectEnhanced: rejectOrderEnhanced,
  } = useOrderDraftStore();
  const totalUnread = useChatStore(selectTotalUnread);
  const { notify } = useToast();

  // Legenda mappa: livello attivo e filtri
  const [mapLegendLayer, setMapLegendLayer] = useState<MapLayer>('political');
  const [mapLegendFilters, setMapLegendFilters] = useState<MapFilters>({
    showCities: true,
    showPorts: true,
    showIndustry: true,
    showUnits: true,
  });
  // MAP P4 — un solo contesto della mappa, composto esclusivamente da ID.
  const [mapContextSelection, setMapContextSelection] = useState<MapContextSelection>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState<{ regionId: string; requestId: number } | null>(null);

  // Keep map props stable when chat/HUD state changes without a world update.
  const regions: Region[] = useMemo(() => Object.values(currentWorld?.regions || {}), [currentWorld?.regions]);
  // MAP P2.1: uno snapshot precedente non resta mai presentato come stato
  // operativo attuale in caso di errore (fail-closed), ma durante il pending il
  // read model resta quello pubblicato e il banner di caricamento lo dichiara:
  // P4 non cambia questa semantica. La sicurezza della preview è garantita dal
  // reset su `snapshotKey` in UnitActionPanel; MAP P4.1 passa la stessa identità
  // sia al context inspector della mappa sia al dossier nazionale (DeskContent
  // → NationDock → ObjectsBoard), così non esistono due nozioni di snapshot.
  const mapContextIndex = useMemo(() => buildMapContextIndex({
    regions, units: nation.militaryUnits, fronts: nation.militaryFronts,
  }), [regions, nation.militaryUnits, nation.militaryFronts]);
  const mapContext = useMemo(
    () => resolveMapContext(mapContextSelection, mapContextIndex),
    [mapContextSelection, mapContextIndex],
  );
  const contextRegionId = mapContextRegionId(mapContext);
  // La stessa identità di snapshot alimenta i **due** punti d'uso di
  // `UnitActionPanel`: context inspector della mappa e sala di governo del
  // dossier nazionale (DeskContent → NationDock → ObjectsBoard).
  const snapshotKey = actionSnapshotKey(currentGame);

  useEffect(() => {
    if (!currentWorld) return;
    if (selectedRegion && !currentWorld.regions[selectedRegion]) setSelectedRegion(null);
  }, [currentWorld?.regions, selectedRegion, setSelectedRegion]);
  // Nuova partita/mondo: un ID omonimo non eredita il vecchio contesto.
  useEffect(() => {
    setMapContextSelection(null);
    setMapFocusRequest(null);
  }, [currentGame?.id, currentWorld?.id]);
  // Rewind/restore/refresh: durante il pending conserviamo soltanto l'ID; alla
  // risposta, un oggetto davvero assente/chiuso fa chiudere il contesto.
  useEffect(() => {
    if (mapContextSelection && !mapContext && !nation.militaryStateLoading) {
      setMapContextSelection(null);
      if (mapContextSelection.kind !== 'region') setSelectedRegion(null);
    }
  }, [mapContextSelection, mapContext, nation.militaryStateLoading, setSelectedRegion]);
  // Un modulo sostituisce il dossier contestuale: non deve riapparire alla chiusura.
  useEffect(() => {
    if (activeModule !== 'none') setMapContextSelection(null);
  }, [activeModule]);

  const selectRegionContext = useCallback((regionId: string) => {
    if (!mapContextIndex.regionsById.has(regionId)) return;
    setMapContextSelection({ kind: 'region', regionId });
    setSelectedRegion(regionId);
    if (activeModule !== 'none') closeModule();
  }, [activeModule, closeModule, mapContextIndex, setSelectedRegion]);

  const selectUnitContext = useCallback((unitId: string) => {
    const unit = mapContextIndex.unitsById.get(unitId);
    if (!unit || unit.status === 'destroyed') return;
    setMapContextSelection({ kind: 'unit', unitId });
    setSelectedRegion(unit.regionId || null);
    if (activeModule !== 'none') closeModule();
  }, [activeModule, closeModule, mapContextIndex, setSelectedRegion]);

  const selectFrontContext = useCallback((frontId: string) => {
    const front = mapContextIndex.frontsById.get(frontId);
    if (!front || front.status === 'closed') return;
    setMapContextSelection({ kind: 'front', frontId });
    const regionId = front.objectiveRegionId || front.regionIds[0];
    setSelectedRegion(regionId || null);
    if (activeModule !== 'none') closeModule();
  }, [activeModule, closeModule, mapContextIndex, setSelectedRegion]);

  const focusMapRegion = useCallback((regionId: string) => {
    if (!mapContextIndex.regionsById.has(regionId)) return;
    setMapFocusRequest(previous => ({ regionId, requestId: (previous?.requestId || 0) + 1 }));
  }, [mapContextIndex]);

  const closeMapContext = useCallback(() => {
    const closing = mapContextSelection;
    setMapContextSelection(null);
    setSelectedRegion(null);
    requestAnimationFrame(() => {
      const id = closing?.kind === 'unit' ? closing.unitId : closing?.kind === 'front' ? closing.frontId : null;
      const selector = closing?.kind === 'unit' ? 'data-unit-id' : closing?.kind === 'front' ? 'data-front-id' : null;
      const trigger = id && selector
        ? document.querySelector<HTMLElement>(`[${selector}="${CSS.escape(id)}"]`)
        : null;
      (trigger || document.querySelector<HTMLElement>('.map-keyboard-surface'))?.focus({ preventScroll: true });
    });
  }, [mapContextSelection, setSelectedRegion]);

  // WS-GOVOFFICE-03 — Il percorso «la fazione propone → una bozza d'ordine nel
  // compositore» è uscito insieme al compositore libero: la bozza non aveva più
  // un posto dove essere vista. La richiesta di una fazione resta nel pannello
  // del consiglio, in lettura, e il giocatore la porta al ministro a parole.

  // P02 — La seduta del gabinetto si carica all'apertura del Governo: è una
  // lettura, e il momento in cui serve è quello in cui il giocatore entra.
  useEffect(() => {
    if (activeModule === 'orders') void loadCabinet();
  }, [activeModule, loadCabinet]);

  const {
    currentRegion,
    playerPolityId,
    nationalName,
    nationalAccount,
    governmentType,
    externalRegionSelected,
  } = deriveNationalContext({
    regions,
    currentGame,
    selectedRegion,
    nationalAccounts: nation.nationalAccounts,
    // N01 — il nome della nazione viene dalla stessa risposta che porta la
    // matrice diplomatica: una sola fonte di nomi, e nessuna deduzione dalla
    // geografia.
    relationshipNames: nation.relationshipNames,
  });

  // MAP P5 — un solo modello tematico P3 per mappa e dossier: stesse soglie,
  // stessi bucket, stessi siti. Nessun fetch al click, nessuna duplicazione.
  // MAP P6.1 — tre stati distinti, mai confusi:
  //  · `canonical` → giacimenti e impianti canonici **mondiali** del catalogo;
  //  · `legacy` (canonical:false) → fallback player-scoped P5.1 (oggetti
  //    operativi `mine` con `regionId` pubblicato): il mondo non ha catalogo;
  //  · `error` → **nessun** fallback: mostrare una mappa mondiale parziale solo
  //    del giocatore la farebbe sembrare corrente. Fail-closed.
  //  · `loading` → nessun asset corrente (mai quello dello snapshot precedente).
  // Mai due sorgenti insieme: nessuna miniera doppia, nessuna dedup per nome.
  const assetSources = useMemo(() => assetsForStatus({
    status: nation.worldMapAssetsStatus,
    assets: nation.worldMapAssets,
    playerPicture: nation.nationalArms?.objects,
  }), [nation.worldMapAssetsStatus, nation.worldMapAssets, nation.nationalArms?.objects]);
  const worldFacilities = assetSources.facilities;
  const resourceCandidates = assetSources.resources;
  const thematicModel = useMemo(() => buildThematicMapModel({
    regions, relationships: nation.relationships, playerPolityId, resourceCandidates, worldFacilities,
  }), [regions, nation.relationships, playerPolityId, resourceCandidates, worldFacilities]);

  const railItems = deriveRailItems({
    activeModule,
    totalUnread,
    unreadFeedCount: feed.unreadFeedCount,
    // V01 — il distintivo dice quante sfide attendono una risposta: è la
    // stessa lista che monta il pannello, contata dalla funzione pura.
    openQuestions: countOpenQuestions(nation.nationalPressures),
    // D-1 — il distintivo di «Forze» sono i reparti con un problema.
    troubledUnits: countTroubledUnits(nation.nationalArms?.objects ?? null),
    openModule: (module) => openModule(module as ActiveModule),
  });

  // LW04 — presenza del consiglio al momento della decisione (desk del tempo).
  const council = useMemo(() => councilPresence(nation.nationalGovernment), [nation.nationalGovernment]);

  // LW05 — presenza del mondo: variazioni estere già simulate, rese osservabili.
  const worldFacts = useMemo(() => deriveWorldPresence({
    regions,
    changedRegionIds: changedRegions,
    playerPolityId,
    feedItems: feed.feedItems,
  }).facts, [regions, changedRegions, playerPolityId, feed.feedItems]);

  // LW01/LW06.1 — il briefing è derivato UNA sola volta, qui, e condiviso con
  // la striscia compatta nella HUD e con la card nel Dossier. Stesso read model,
  // nessuna seconda verità.
  const briefing = useMemo(() => deriveStrategicBriefing({
    account: nationalAccount,
    resources: nation.nationalResources,
    crisis: nation.nationalCrisis,
    pressures: nation.nationalPressures,
    ongoingProcesses: timeline.ongoingProcesses,
    mandateDecisions: nation.mandateDecisions,
    maintenanceObligations: nation.maintenanceObligations,
    government: nation.nationalGovernment,
    fiscalPolicy: nation.nationalFiscalPolicy,
    worldFacts,
    // GAMEPLAY-LONG: una riga sulla strategia più urgente fra le potenze.
    strategicAgenda: nation.strategicAgenda,
    playerPolityId,
    commitments: nation.commitments,
    today: currentGame?.currentDate || '',
  }), [
    nationalAccount, nation.nationalResources, nation.nationalCrisis, nation.nationalPressures,
    timeline.ongoingProcesses, nation.mandateDecisions, nation.maintenanceObligations,
    nation.nationalGovernment, nation.nationalFiscalPolicy, worldFacts,
    nation.strategicAgenda, playerPolityId, nation.commitments, currentGame?.currentDate,
  ]);

  // LW06.1 / MIGLIORIA 2 — variazioni reali del periodo del checkpoint in
  // lettura, derivate dallo storico conti del motore (stessa data del punto).
  const checkpointImpact = useMemo(() => (
    playback.pausedReader ? deriveImpactAtDate(nation.nationalHistory, playback.pausedReader.event.date) : null
  ), [playback.pausedReader, nation.nationalHistory]);

  // DECISION-IMPACT: le decisioni del turno in lettura, con l'effetto che il
  // motore ha loro attribuito (nessun ricalcolo client). La chiave è la stessa
  // del delta LW02: la data registrata del checkpoint. Se nessuna decisione
  // riletta corrisponde, il blocco mostra solo la variazione del periodo.
  const readerDecisions = useMemo(() => {
    const date = playback.pausedReader?.event?.date;
    if (!date) return [];
    return actionHistory
      .filter(item => item.periodEnd === date)
      .map(item => ({ turn: item.turn, action: item.action, settlement: item.settlement ?? null }));
  }, [actionHistory, playback.pausedReader?.event?.date]);

  const handleRewind = () => {
    if (!currentGame || loading) return;
    shell.setShowRewindConfirm(true);
  };

  const mapContent = (
    <GameMap
      worldId={currentWorld?.id}
      regions={regions}
      activeLayer={mapLegendLayer}
      onLayerChange={setMapLegendLayer}
      filters={mapLegendFilters}
      onFiltersChange={(partial) => setMapLegendFilters(prev => ({ ...prev, ...partial }))}
      selectedRegion={mapContextSelection ? contextRegionId || undefined : selectedRegion || undefined}
      onRegionClick={selectRegionContext}
      onUnitClick={selectUnitContext}
      onFrontClick={selectFrontContext}
      focusRegionRequest={mapFocusRequest}
      changedRegionIds={changedRegions}
      temporalScars={playback.temporalScars}
      events={feed.feedItems}
      currentDate={currentGame?.currentDate}
      militaryUnits={nation.militaryUnits}
      militaryFronts={nation.militaryFronts}
      militaryStateLoading={nation.militaryStateLoading}
      militaryStateError={nation.militaryStateError}
      relationships={nation.relationships}
      resourceCandidates={resourceCandidates}
      worldFacilities={worldFacilities}
      resourcesUnavailableReason={nation.worldMapAssetsError}
      showFlags={!!useGameStore.getState().selectedCountry}
      playerCountryCode={playerPolityId}
      onBackToScenarios={() => {
        setMapContextSelection(null);
        setCurrentView('menu');
        setCurrentWorld(null);
        setCurrentGame(null);
      }}
    />
  );

  return (
    <>
      <GovernmentOffice
        open={activeModule === 'orders'}
        onClose={closeModule}
        gameId={currentGame?.id ?? ''}
        session={cabinet}
        sessionLoading={cabinetLoading}
        sessionError={cabinetError}
        onQueueOrder={queuePlayerAction}
        pendingActions={pendingActions}
        nationalName={nationalName}
        onWithdrawOrder={id => void orders.removeQueuedAction(id)}
        currentDate={currentGame?.currentDate ?? null}
        currentTurn={currentGame?.currentTurn ?? null}
        pictureSources={{
          regions,
          account: nationalAccount,
          resources: nation.nationalResources,
          arms: nation.nationalArms,
          government: nation.nationalGovernment,
          commitments: nation.commitments,
          accountHistory: nation.nationalHistory,
          ongoingProcesses: timeline.ongoingProcesses,
          maintenanceObligations: nation.maintenanceObligations,
          crisis: nation.nationalCrisis,
          pressures: nation.nationalPressures,
          today: currentGame?.currentDate ?? undefined,
        }}
      />
      <GameShell
      hud={
        <>
          <HudBar
            worldName={currentWorld?.name || ''}
            turn={currentGame?.currentTurn || 1}
            // N08: la HUD non inventa una data. Il fallback era «1951-01-01», e
            // in uno scenario del 1815 o del 2026 mostrava per un istante il
            // 1° gennaio 1951 — un dato falso, non un dato mancante.
            dateISO={currentGame?.currentDate || ''}
            loading={loading}
            timeline={timeline.timeline}
            timelineLoading={timeline.timelineLoading}
            timelineError={timeline.timelineError}
            timelineHasMore={timeline.timelineHasMore}
            timelineLoadingOlder={timeline.timelineLoadingOlder}
            ongoingProcesses={timeline.ongoingProcesses}
            dispatchCount={feed.unreadFeedCount}
            dispatchLive={shell.isProcessingTurn}
            advancing={shell.isProcessingTurn}
            pendingOrdersCount={pendingActions.length}
            pendingOrders={pendingActions.map(action => ({ id: action.id, text: action.text }))}
            history={nation.nationalHistory}
            decisions={actionHistory}
            council={council}
            onOpenDispatches={() => openModule('news')}
            onTimelineOpen={timeline.handleTimelineOpen}
            onLoadOlder={timeline.loadOlderTimeline}
            onBack={() => {
              setCurrentView('menu');
              setCurrentWorld(null);
              setCurrentGame(null);
              setHistory([]);
            }}
            onRewind={handleRewind}
            onTimeSkip={advance.handleTimeSkip}
            onRestoreCheckpoint={advance.handleRestoreCheckpoint}
            onContinueFrom={advance.handleContinueFrom}
            activePlayback={playback.pausedReader ? {
              simulationId: playback.pausedReader.simulationId,
              eventId: playback.pausedReader.event.id,
              revision: playback.pausedReader.revision,
            } : null}
            onFocusPlaybackReader={() => document.getElementById('simulation-event-reader')?.focus({ preventScroll: true })}
            playerPolityName={nationalName}
            menu={(
              <GameMenu
                onSave={() => shell.setShowSaveModal(true)}
                onLoad={() => shell.setShowSavePicker(true)}
                onEditWorld={() => setShowPromptEditor(true)}
                onEditModel={() => shell.setShowLLMSettings(true)}
                disabled={shell.isProcessingTurn}
              />
            )}
          />
          {feed.newsOpen && (
            <NewsFlash
              item={feed.newsQueue[0] || null}
              pendingCount={feed.newsQueue.length}
              onClose={() => feed.dismissNews(false)}
              onNext={() => feed.dismissNews(true)}
              onOpenArchive={() => {
                feed.dismissNews(false);
                openModule('news');
              }}
              playerPolityName={nationalName}
            />
          )}
          <CompactBriefing briefing={briefing} onOpenDossier={() => openModule('nation')} />
          {shell.isProcessingTurn && (
            <div className="turn-progress-banner" role="status" aria-live="polite">
              <span className="turn-progress-spinner" aria-hidden="true" />
              <span className="turn-progress-text">{shell.turnProgress || 'Elaborazione mossa...'}</span>
              <button
                className="btn-intervene"
                onClick={advance.handleIntervene}
                title="Ferma la simulazione dopo l'evento corrente"
              >
                ⏸ Intervene
              </button>
            </div>
          )}
          {playback.pausedReader && (
            <SimulationEventReader
              playback={playback.pausedReader}
              loading={loading}
              onContinue={playback.handleContinueNext}
              onIntervene={playback.handleInterveneHere}
              impact={checkpointImpact}
              decisions={readerDecisions}
              playerPolityName={nationalName}
            />
          )}
        </>
      }
      rail={
        <>
          <CommandRail
            items={railItems}
            activeModule={activeModule}
            onModuleClick={openModule}
          />
        </>
      }
      map={mapContent}
      desk={
        mapContext && activeModule === 'none' ? (
          <ProvinceInspector
            context={mapContext}
            index={mapContextIndex}
            allRegions={regions}
            playerPolityId={playerPolityId}
            operatingPicture={nation.nationalArms?.objects}
            snapshotKey={snapshotKey}
            activeLayer={mapLegendLayer}
            thematicModel={thematicModel}
            relationships={nation.relationships}
            changedRegionIds={changedRegions}
            strategicAgenda={nation.strategicAgenda}
            commitments={nation.commitments?.commitments ?? null}
            onClose={closeMapContext}
            onSelectRegion={selectRegionContext}
            onSelectUnit={selectUnitContext}
            onSelectFront={selectFrontContext}
            onFocusRegion={focusMapRegion}
            onOpenArmedForces={() => { setMapContextSelection(null); openModule('nation'); }}
            onUnitAction={nation.unitAction}
            onUnitOrder={nation.unitOrder}
          />
        ) : (
          <DeskContent
            activeModule={activeModule}
            closeModule={closeModule}
            openModule={(module) => openModule(module as ActiveModule)}
            currentGame={currentGame}
            currentWorld={currentWorld}
            currentRegion={currentRegion ?? null}
            selectedRegion={selectedRegion}
            externalRegionSelected={externalRegionSelected}
            nationalName={nationalName}
            governmentType={governmentType}
            nationalAccount={nationalAccount}
            nationalResources={nation.nationalResources}
            nationalArms={nation.nationalArms}
            procureEquipment={nation.procureEquipment}
            onPreviewFormation={nation.previewFormation}
            onRaiseFormation={nation.raiseFormation}
            onUnitAction={nation.unitAction}
            onUnitOrder={nation.unitOrder}
            snapshotKey={snapshotKey}
            tradeResource={nation.tradeNaturalResource}
            nationalHistory={nation.nationalHistory}
            // C01: gli asset territoriali canonici servono ai grafici del Consulente.
            worldMapAssets={nation.worldMapAssets}
            nationalGovernment={nation.nationalGovernment}
            nationalFiscalPolicy={nation.nationalFiscalPolicy}
            onSetFiscalPolicy={nation.setFiscalPolicy}
            fiscalPolicyBusy={nation.fiscalPolicyBusy}
            nationalPressures={nation.nationalPressures}
            recentPressures={nation.recentPressures}
            onResolvePressure={nation.resolvePressure}
            pressureBusy={nation.pressureBusy}
            nationalCrisis={nation.nationalCrisis}
            strategicAgenda={nation.strategicAgenda}
            commitments={nation.commitments}
            briefing={briefing}
            governmentVoices={nation.governmentVoices}
            governmentVoicesLoading={nation.governmentVoicesLoading}
            governmentVoicesError={nation.governmentVoicesError}
            onLoadGovernmentVoices={nation.loadGovernmentVoices}
            onBorrowDebt={nation.borrowSovereignDebt}
            isProcessingTurn={shell.isProcessingTurn}
            ongoingProcesses={timeline.ongoingProcesses}
            completedProcesses={timeline.completedProcesses}
            mandateDecisions={nation.mandateDecisions}
            maintenanceObligations={nation.maintenanceObligations}
            onAcknowledgeMandateDecision={nation.acknowledgeMandateDecision}
            feedItems={feed.feedItems}
            onFocusRegion={(regionId) => {
              // G4-C / MAP P4: selezione e inspector condividono lo stesso ID.
              selectRegionContext(regionId);
              focusMapRegion(regionId);
            }}
            onMarkFeedRead={feed.markFeedRead}
            onMarkAllFeedRead={feed.markAllFeedRead}
            playerPolityId={playerPolityId}
            currentGameId={currentGame?.id}
          />
        )
      }
      deskOpen={(activeModule !== 'none' && activeModule !== 'orders') || mapContext !== null}
    />
    </>
  );
}
