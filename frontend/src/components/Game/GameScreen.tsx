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
import { ProvinceInspector } from '../Shell/ProvinceInspector';
import { GameMap } from './GameMap';
import { deriveRailItems } from './nationalContext';
import type { MapFilters, MapLayer } from '../Map/mapModel';
import type { ActiveModule } from '../../stores/moduleState';

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
  const {
    currentGame, currentWorld, selectedRegion, setSelectedRegion, setCurrentGame, setCurrentWorld,
    setHistory, pendingActions, changedRegions,
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
  // Provincia selezionata per ispettore (click su mappa)
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);

  // Keep map props stable when chat/HUD state changes without a world update.
  const regions: Region[] = useMemo(() => Object.values(currentWorld?.regions || {}), [currentWorld?.regions]);
  useEffect(() => {
    if (!currentWorld) return;
    if (selectedRegion && !currentWorld.regions[selectedRegion]) setSelectedRegion(null);
    if (selectedProvinceId && !currentWorld.regions[selectedProvinceId]) setSelectedProvinceId(null);
  }, [currentWorld?.regions, selectedRegion, selectedProvinceId, setSelectedRegion]);

  // Scegli il paese (click su mappa: seleziona regione + apre ispettore provincia)
  const handleCountryChange = (regionId: string) => {
    setSelectedRegion(regionId);
    setSelectedProvinceId(regionId);
    // Se un modulo è aperto, lo chiudiamo per mostrare l'ispettore
    if (activeModule !== 'none') closeModule();
  };

  // Una fazione del governo propone: la richiesta diventa una bozza d'ordine
  // reale nel compositore. Nessuna spesa finché l'ordine non è registrato e il
  // tempo non avanza; il giocatore resta l'unico a decidere.
  const draftGovernmentPetition = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    updateOrderDraft(trimmed);
    openModule('orders');
    notify('Richiesta portata in consiglio: completa l’ordine e registralo.', 'info');
  }, [updateOrderDraft, openModule, notify]);

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
  });

  const railItems = deriveRailItems({
    activeModule,
    totalUnread,
    unreadFeedCount: feed.unreadFeedCount,
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
  }), [
    nationalAccount, nation.nationalResources, nation.nationalCrisis, nation.nationalPressures,
    timeline.ongoingProcesses, nation.mandateDecisions, nation.maintenanceObligations,
    nation.nationalGovernment, nation.nationalFiscalPolicy, worldFacts,
  ]);

  // LW06.1 / MIGLIORIA 2 — variazioni reali del periodo del checkpoint in
  // lettura, derivate dallo storico conti del motore (stessa data del punto).
  const checkpointImpact = useMemo(() => (
    playback.pausedReader ? deriveImpactAtDate(nation.nationalHistory, playback.pausedReader.event.date) : null
  ), [playback.pausedReader, nation.nationalHistory]);

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
      selectedRegion={selectedRegion || undefined}
      onRegionClick={handleCountryChange}
      changedRegionIds={changedRegions}
      temporalScars={playback.temporalScars}
      events={feed.feedItems}
      currentDate={currentGame?.currentDate}
      showFlags={!!useGameStore.getState().selectedCountry}
      playerCountryCode={playerPolityId}
      onBackToScenarios={() => {
        setCurrentView('menu');
        setCurrentWorld(null);
        setCurrentGame(null);
      }}
    />
  );

  return (
    <GameShell
      hud={
        <>
          <HudBar
            worldName={currentWorld?.name || ''}
            turn={currentGame?.currentTurn || 1}
            dateISO={currentGame?.currentDate || '1951-01-01'}
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
        selectedProvinceId && activeModule === 'none' ? (
          <ProvinceInspector
            region={regions.find(r => r.id === selectedProvinceId) ?? null}
            allRegions={regions}
            onClose={() => setSelectedProvinceId(null)}
          />
        ) : (
          <DeskContent
            activeModule={activeModule}
            closeModule={closeModule}
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
            tradeResource={nation.tradeNaturalResource}
            nationalHistory={nation.nationalHistory}
            nationalGovernment={nation.nationalGovernment}
            nationalFiscalPolicy={nation.nationalFiscalPolicy}
            onSetFiscalPolicy={nation.setFiscalPolicy}
            fiscalPolicyBusy={nation.fiscalPolicyBusy}
            nationalPressures={nation.nationalPressures}
            recentPressures={nation.recentPressures}
            onResolvePressure={nation.resolvePressure}
            pressureBusy={nation.pressureBusy}
            nationalCrisis={nation.nationalCrisis}
            briefing={briefing}
            onDraftGovernmentPetition={draftGovernmentPetition}
            governmentVoices={nation.governmentVoices}
            governmentVoicesLoading={nation.governmentVoicesLoading}
            governmentVoicesError={nation.governmentVoicesError}
            onLoadGovernmentVoices={nation.loadGovernmentVoices}
            onBorrowDebt={nation.borrowSovereignDebt}
            pendingActions={pendingActions}
            suggestions={suggestions}
            orderDraftText={orderDraftText}
            updateOrderDraft={updateOrderDraft}
            enhancedPreview={enhancedPreview}
            enhanceLoading={enhanceLoading}
            enhanceError={enhanceError}
            enhanceOrder={orders.enhanceOrder}
            acceptOrderEnhanced={acceptOrderEnhanced}
            rejectOrderEnhanced={rejectOrderEnhanced}
            registerOrder={orders.registerOrder}
            queuePlayerAction={orders.queuePlayerAction}
            removeQueuedAction={orders.removeQueuedAction}
            updateQueuedAction={orders.updateQueuedAction}
            editingActionId={orders.editingActionId}
            editingActionText={orders.editingActionText}
            setEditingActionId={orders.setEditingActionId}
            setEditingActionText={orders.setEditingActionText}
            isProcessingTurn={shell.isProcessingTurn}
            ongoingProcesses={timeline.ongoingProcesses}
            completedProcesses={timeline.completedProcesses}
            mandateDecisions={nation.mandateDecisions}
            maintenanceObligations={nation.maintenanceObligations}
            onAcknowledgeMandateDecision={nation.acknowledgeMandateDecision}
            feedItems={feed.feedItems}
            onFocusRegion={(regionId) => {
              // G4-C: «Mostra sulla mappa» seleziona la regione toccata
              // dall'evento; la selezione esistente guida già zoom e highlight.
              setSelectedRegion(regionId);
            }}
            onMarkFeedRead={feed.markFeedRead}
            onMarkAllFeedRead={feed.markAllFeedRead}
            playerPolityId={playerPolityId}
            onGenerateSuggestions={orders.generateSuggestions}
            suggestionsLoading={orders.suggestionsLoading}
            suggestionsError={orders.suggestionsError}
            currentGameId={currentGame?.id}
          />
        )
      }
      deskOpen={activeModule !== 'none' || selectedProvinceId !== null}
    />
  );
}
