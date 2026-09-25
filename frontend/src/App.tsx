/**
 * World Story — Main App (Redesign)
 * ==============================
 */

import { Suspense, lazy } from 'react';
// DISATTIVATO: editor mappe (temporaneo)
// import { MapEditor, type EditorRegion, type EditorObject } from './components/Editor';
// import { CreateWorld, type WorldConfig } from './components/WorldBuilder/CreateWorld';
import { TemplateSelector } from './components/Game/TemplateSelector';
import { Landing } from './components/Game/Landing';
const LLMSettingsModal = lazy(() => import('./components/Game/LLMSettingsModal'));
import { GameLoader, WORLD_GEN_PHASES } from './components/Game/GameLoader';
// DISATTIVATO: editor mappe (temporaneo) — mapApi era usato solo dall’editor/«Le mie mappe»
import { useGameStore, useUIStore } from './stores';
import { useNationSnapshot } from './hooks/useNationSnapshot';
import { useWorldTimeline } from './hooks/useWorldTimeline';
import { useFeed } from './hooks/useFeed';
import { useOrderQueue } from './hooks/useOrderQueue';
import { useSimulationPlayback } from './hooks/useSimulationPlayback';
import { useSimulationStream } from './hooks/useSimulationStream';
import { useWorldAdvance } from './hooks/useWorldAdvance';
import { useResumeSave } from './hooks/useResumeSave';
import { useShellState } from './hooks/useShellState';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { CountryStage } from './components/Game/CountryStage';
import { GameScreen } from './components/Game/GameScreen';
import { GameModals } from './components/Game/GameModals';
import { useToast } from './components/ui/ToastProvider';

// DISATTIVATO: editor mappe (temporaneo) — helper e wiring di riattivazione in
// components/Editor/REATTIVAZIONE_EDITOR.md

function App() {
  const { notify } = useToast();

  // Stores
  const {
    currentGame,
    setCurrentGame, setCurrentWorld, setSelectedRegion,
  } = useGameStore();

  const {
    currentView, loading,
    activeModule,
    // DISATTIVATO: editor mappe (temporaneo) — selectedMapForWorld, savedMaps,
    selectedTemplate,
    setCurrentView, setLoading,
    // DISATTIVATO: editor mappe (temporaneo) — setSelectedMapForWorld, setSavedMaps, addSavedMap,
    setSelectedTemplate,
  } = useUIStore();

  // Fase 2: coda ordini, suggerimenti, modifica e fattibilità vivono in `useOrderQueue`.
  const ordersBundle = useOrderQueue({ gameId: currentGame?.id || null });
  const {
    setEditingActionId,
    setEditingActionText,
    showFeasibility,
    setShowFeasibility,
    verifyingText,
    feasibilityResult,
    feasibilityLoading,
    feasibilityError,
    handleFeasibilityRegister,
    handleFeasibilityBack,
    handleFeasibilityReverify,
  } = ordersBundle;

  // Fase 3: Consulente live (tab del pannello flottante) + chat diplomatiche riattivate.

  const currentGameId = currentGame?.id || null;

  // Fase 2: cronaca e processi (timeline, paginazione) vivono in `useWorldTimeline`.
  const timelineBundle = useWorldTimeline({ gameId: currentGameId, currentTurn: currentGame?.currentTurn });
  const {
    setTimeline,
    setTimelineHasMore,
    setTimelineNextAfter,
    setOngoingProcesses,
    setCompletedProcesses,
    handleTimelineOpen,
    resetTimeline,
  } = timelineBundle;


  // Collegamento di chatStore alla partita corrente (cambiando partita il feed del consulente si azzera)
  // Fase 2: lo stato del Dossier Nazione — conti, storico, magazzino, arsenale,
  // governo, fisco, sfide di pace, crisi, voci del consiglio e promemoria dei
  // mandati — e le azioni che lo mutano vivono in `useNationSnapshot`.
  const nationBundle = useNationSnapshot({
    gameId: currentGameId,
    currentTurn: currentGame?.currentTurn,
    currentDate: currentGame?.currentDate,
    worldRevision: currentGame?.worldRevision,
    headBranchId: currentGame?.headBranchId,
    notify,
  });
  const {
    setNationalAccounts,
    setNationalHistory,
    setNationalGovernment,
    setNationalCrisis,
    gameEnding,
    setGameEnding,
    setGovernmentVoices,
    setGovernmentVoicesError,
  } = nationBundle;

  // Fase 2: ciclo di vita di sessione (chat, pannello, chiavi LLM) in `useAppLifecycle`.
  const { rehydrateBrowserApiKey } = useAppLifecycle({
    gameId: currentGameId,
    activeModule,
    resetTimeline,
  });

  // ── Cronaca live (feed eventi sempre in vista) ─────────────────────────
  // Accumula gli eventi di TUTTI i turni (azione del giocatore + simulazione
  // live del mondo). I «live» sono gli eventi jump che arrivano in streaming
  // durante l'elaborazione; i «world» arrivano dal battito del mondo.
  // Fase 2: cronaca live, coda delle notizie e stato di lettura vivono in `useFeed`.
  const feedBundle = useFeed({ gameId: currentGameId, setTimeline });
  const {
    setFeedItems,
    pushFeed,
    actionTextFor,
    publishEventDetails,
  } = feedBundle;

  // La nazione è un modulo su richiesta: non riaprire mai il dossier rimasto
  // dall'ultima sessione sopra la mappa (activeModule parte da 'none').

  // DISATTIVATO: editor mappe (temporaneo) — caricamento mappe, salvataggio e
  // creazione mondo da mappa: codice in components/Editor/REATTIVAZIONE_EDITOR.md

  // Invia le azioni (più di una)
  // Time-skip handler (Phase 4)
  // Fase 2: Rewind — torna al turno precedente
  // =========================================================================
  // §9.3 — Playback «un evento alla volta» per i salti fissi
  // =========================================================================

  /** Aggiorna la mappa col delta di un checkpoint per-evento committato. */
  // G4-C — cicatrici temporali: il confine precedente di ogni regione appena
  // cambiata resta visibile qualche secondo come documentazione del mutamento.
  // Fase 2: playback per-evento, cicatrici e ripresa del run in pausa vivono in
  // `useSimulationPlayback`.
  const playbackBundle = useSimulationPlayback();
  const {
    pausedReader,
    setPausedReader,
    setTemporalScars,
    scarTimersRef,
    applyCheckpointRegions,
    restorePausedReader,
  } = playbackBundle;

  // Fase 2: la ripresa di un salvataggio (riallineamento atomico + reset dello
  // snapshot canonico) vive in `useResumeSave`.
  const { handleResumeSave } = useResumeSave({
    setTimeline,
    setTimelineHasMore,
    setTimelineNextAfter,
    setOngoingProcesses,
    setCompletedProcesses,
    setNationalAccounts,
    setNationalHistory,
    setNationalGovernment,
    setGovernmentVoices,
    setGovernmentVoicesError,
    setFeedItems,
    setEditingActionId,
    setEditingActionText,
    scarTimersRef,
    setTemporalScars,
    restorePausedReader,
  });

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

  // Fase 2: lo stato di shell (turno in corso, difficoltà, modali, fasi del
  // loader) e i suoi effetti vivono in `useShellState`.
  const shellBundle = useShellState();
  const {
    setIsProcessingTurn,
    setTurnProgress,
    difficulty,
    setDifficulty,
    showSaveModal,
    setShowSaveModal,
    showSavePicker,
    setShowSavePicker,
    genPhase,
    setGenPhase,
    genProgress,
    setGenProgress,
    showLLMSettings,
    setShowLLMSettings,
    showRewindConfirm,
    setShowRewindConfirm,
    showLoadSaveConfirm,
    setShowLoadSaveConfirm,
  } = shellBundle;

  // Fase 2: la sottoscrizione SSE (turni, eventi, dispacci, chat, crisi) vive in
  // `useSimulationStream`; il ref del run attivo serve a Intervieni e alla ripresa.
  const { activeSimulationIdRef } = useSimulationStream({
    gameId: currentGame?.id || null,
    pushFeed,
    actionTextFor,
    setFeedItems,
    applyCheckpointRegions,
    setPausedReader,
    pausedReader,
    handleTimelineOpen,
    rehydrateBrowserApiKey,
    setGameEnding,
    setIsProcessingTurn,
    setTurnProgress,
  });

  // Fase 2: i comandi che fanno avanzare o tornare indietro il mondo vivono in
  // `useWorldAdvance`.
  const advanceBundle = useWorldAdvance({
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
  });

  const renderGame = () => (
    <GameScreen
      nation={nationBundle}
      timeline={timelineBundle}
      feed={feedBundle}
      orders={ordersBundle}
      playback={playbackBundle}
      advance={advanceBundle}
      shell={shellBundle}
    />
  );

  // DISATTIVATO: editor mappe (temporaneo) — render editor/create-world:
  // codice da ripristinare in components/Editor/REATTIVAZIONE_EDITOR.md

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
        // Fase 2: la schermata di scelta paese + generazione mondo è `CountryStage`.
        <CountryStage
          template={selectedTemplate}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          onBack={() => setCurrentView('select-template')}
          onProgress={(ratio) => {
            setGenProgress(ratio);
            setGenPhase(Math.min(WORLD_GEN_PHASES.length - 1, Math.floor(ratio * WORLD_GEN_PHASES.length)));
          }}
          onGenerated={(game, actualRegionId) => {
            setCurrentGame(game);
            setCurrentWorld(game.world);
            setSelectedRegion(actualRegionId);
            setCurrentView('game');
          }}
          onFailure={() => {
            notify('Generazione del mondo fallita. Riprova.', 'error');
            setCurrentView('menu');
          }}
          setLoading={setLoading}
        />
      )}
      {currentView === 'game' && renderGame()}
      {/* Menu di scelta del modello IA (Landing + pannello di gioco) */}
      {showLLMSettings && (
        <Suspense fallback={null}>
          <LLMSettingsModal open={true} onClose={() => setShowLLMSettings(false)} />
        </Suspense>
      )}
      {/* Fase 2: i dialoghi sovrapposti della partita vivono in `GameModals`. */}
      <GameModals
        showRewindConfirm={showRewindConfirm}
        onCloseRewind={() => setShowRewindConfirm(false)}
        onConfirmRewind={advanceBundle.handleRewindConfirmed}
        showSavePicker={showSavePicker}
        currentGameId={currentGame?.id}
        onCloseSavePicker={() => setShowSavePicker(false)}
        onSelectSave={(save) => { setShowSavePicker(false); setShowLoadSaveConfirm(save); }}
        showSaveModal={showSaveModal}
        currentGame={currentGame}
        onCloseSaveModal={() => setShowSaveModal(false)}
        gameEnding={gameEnding}
        currentDate={currentGame?.currentDate}
        currentTurn={currentGame?.currentTurn}
        loading={loading}
        onNewGame={() => { setGameEnding(null); setCurrentView('select-template'); }}
        onCloseEnding={() => setGameEnding(null)}
        saveToLoad={showLoadSaveConfirm}
        onCloseLoadConfirm={() => setShowLoadSaveConfirm(null)}
        onConfirmLoad={handleResumeSave}
        showFeasibility={showFeasibility}
        feasibilityResult={feasibilityResult}
        feasibilityLoading={feasibilityLoading}
        feasibilityError={feasibilityError}
        verifyingText={verifyingText}
        onCloseFeasibility={() => setShowFeasibility(false)}
        onRegister={handleFeasibilityRegister}
        onBack={handleFeasibilityBack}
        onReverify={handleFeasibilityReverify}
      />
      {/* DISATTIVATO: editor mappe (temporaneo) — rotte 'editor' e 'create-world'
      {currentView === 'editor' && renderEditor()}
      {currentView === 'create-world' && renderCreateWorld()}
      */}
    </div>
  );
}

export default App;
