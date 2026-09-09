/**
 * World Story — Simulation Runtime (F06 µ2)
 * ======================================
 * Store runtime (Zustand) che incolla il reducer puro di `simulationStore.ts`
 * al ciclo delle viste: HTTP, SSE e polling inviano gli stessi envelope a
 * `dispatch()`, e l'ordine è deciso SOLO dal reducer. Include la guardia
 * anti-stale: game switch e restore invalidano TUTTI i comandi in volo
 * (chat, advisor, coda, preflight — non soltanto il polling della cronaca).
 */

import { create } from 'zustand';
import {
  applyBranchReplace,
  applyEnvelope,
  initialSimulationState,
  replaceCanonicalSnapshot,
  type CanonicalSnapshot,
  type SimulationEnvelope,
  type SimulationUiState,
} from './simulationStore';

interface SimulationRuntimeState {
  state: SimulationUiState | null;
  /** Generazione dei comandi: game switch e restore invalidano i token vecchi. */
  commandGeneration: number;
  initGame: (gameId: string, branchId: string, worldRevision: number) => void;
  dispatch: (envelope: SimulationEnvelope) => void;
  replaceSnapshot: (replacement: { branchId?: string; worldRevision: number; queueVersion?: number; snapshot: CanonicalSnapshot }) => void;
  branchReplace: (replacement: { gameId: string; branchId: string; anchor: { checkpointId?: string; revision: number }; snapshot: CanonicalSnapshot }) => void;
  /** Token per i comandi in volo: risposte con token scaduto sono scartate. */
  beginCommand: () => number;
  isStale: (token: number) => boolean;
  /** Game switch e restore: invalida TUTTI i comandi in volo. */
  invalidateCommand: () => void;
}

export const useSimulationStore = create<SimulationRuntimeState>((set, get) => ({
  state: null,
  commandGeneration: 0,
  initGame: (gameId, branchId, worldRevision) => set({
    state: initialSimulationState(gameId, branchId, worldRevision),
    commandGeneration: get().commandGeneration + 1,
  }),
  dispatch: (envelope) => set(s => s.state ? { state: applyEnvelope(s.state, envelope) } : s),
  replaceSnapshot: (replacement) => set(s => s.state ? { state: replaceCanonicalSnapshot(s.state, replacement) } : s),
  branchReplace: (replacement) => set(s => s.state ? { state: applyBranchReplace(s.state, replacement) } : s),
  beginCommand: () => {
    const generation = get().commandGeneration + 1;
    set({ commandGeneration: generation });
    return generation;
  },
  isStale: (token) => get().commandGeneration !== token,
  invalidateCommand: () => set(s => ({ commandGeneration: s.commandGeneration + 1 })),
}));