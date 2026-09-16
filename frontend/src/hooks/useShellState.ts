/**
 * World Story — Fase 2: `useShellState`
 * ====================================
 * Lo stato di shell della partita — avanzamento turno e progresso, difficoltà
 * della nuova partita, modali (salvataggio, modello IA, conferme), fasi del
 * loader di generazione del mondo — con i suoi effetti (reset del modulo
 * all'ingresso in partita, chiusura via evento globale, rotazione delle fasi,
 * riconciliazione dello store di simulazione).
 *
 * Era un blocco di `useState`/`useEffect` sparso in `App.tsx`; qui è coeso.
 */
import { useEffect, useState } from 'react';
import type { SaveSummary } from '../components/Game/SavePickerModal';
import { WORLD_GEN_PHASES } from '../components/Game/GameLoader';
import { useGameStore, useUIStore } from '../stores';
import { useSimulationStore } from '../stores/simulationRuntime';

export interface ShellState {
  isProcessingTurn: boolean;
  setIsProcessingTurn: React.Dispatch<React.SetStateAction<boolean>>;
  turnProgress: string;
  setTurnProgress: React.Dispatch<React.SetStateAction<string>>;
  difficulty: string;
  setDifficulty: React.Dispatch<React.SetStateAction<string>>;
  showSaveModal: boolean;
  setShowSaveModal: React.Dispatch<React.SetStateAction<boolean>>;
  showSavePicker: boolean;
  setShowSavePicker: React.Dispatch<React.SetStateAction<boolean>>;
  genPhase: number;
  setGenPhase: React.Dispatch<React.SetStateAction<number>>;
  genProgress: number | null;
  setGenProgress: React.Dispatch<React.SetStateAction<number | null>>;
  showLLMSettings: boolean;
  setShowLLMSettings: React.Dispatch<React.SetStateAction<boolean>>;
  showRewindConfirm: boolean;
  setShowRewindConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  showLoadSaveConfirm: SaveSummary | null;
  setShowLoadSaveConfirm: React.Dispatch<React.SetStateAction<SaveSummary | null>>;
}

export function useShellState(): ShellState {
  const { currentView, loading, closeModule } = useUIStore();
  const currentGame = useGameStore((s) => s.currentGame);

  // Avanzamento turno: alimenta la HUD e l'overlay di elaborazione.
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [turnProgress, setTurnProgress] = useState<string>('');
  // Fase 2: difficoltà della nuova partita
  const [difficulty, setDifficulty] = useState<string>('normal');
  // Fase 6: modale di salvataggio (al posto di prompt()) e fasi del loader di generazione del mondo
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSavePicker, setShowSavePicker] = useState(false);
  const [genPhase, setGenPhase] = useState(0);
  // Avanzamento reale (0..1) della generazione del mondo, dal polling del job
  const [genProgress, setGenProgress] = useState<number | null>(null);
  // Menu di scelta del modello IA (landing + pannello di gioco)
  const [showLLMSettings, setShowLLMSettings] = useState(false);
  // Dialog di conferma per azioni distruttive
  const [showRewindConfirm, setShowRewindConfirm] = useState(false);
  const [showLoadSaveConfirm, setShowLoadSaveConfirm] = useState<SaveSummary | null>(null);

  // A ogni ingresso in partita la mappa è libera: Nazione si apre soltanto
  // dal suo modulo, sia su desktop sia su telefono.
  useEffect(() => {
    if (currentView !== 'game') return;
    closeModule();
  }, [currentView, closeModule]);

  // Chiusura pannello diplomazia (e altri moduli) via evento globale dal DeskContent
  useEffect(() => {
    if (currentView !== 'game') return;
    const handler = () => closeModule();
    window.addEventListener('ws:close-module', handler);
    return () => window.removeEventListener('ws:close-module', handler);
  }, [currentView, closeModule]);

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

  // F06 µ2: unico stato di riconciliazione — ogni partita caricata inizializza
  // il reducer con ramo e revisione canonica; lo scaricamento invalida i comandi.
  useEffect(() => {
    const sim = useSimulationStore.getState();
    if (currentGame) {
      if (!sim.state || sim.state.gameId !== currentGame.id) {
        sim.initGame(currentGame.id, currentGame.headBranchId || 'unknown', currentGame.worldRevision ?? 0);
      }
    } else if (sim.state) {
      useSimulationStore.getState().invalidateCommand();
    }
  }, [currentGame?.id, currentGame?.headBranchId]);

  return {
    isProcessingTurn, setIsProcessingTurn,
    turnProgress, setTurnProgress,
    difficulty, setDifficulty,
    showSaveModal, setShowSaveModal,
    showSavePicker, setShowSavePicker,
    genPhase, setGenPhase,
    genProgress, setGenProgress,
    showLLMSettings, setShowLLMSettings,
    showRewindConfirm, setShowRewindConfirm,
    showLoadSaveConfirm, setShowLoadSaveConfirm,
  };
}
