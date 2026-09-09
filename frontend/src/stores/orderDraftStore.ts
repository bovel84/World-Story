/**
 * World Story — U02 µ1: store Zustand della bozza d'ordine (compositore libero).
 * Avvolge il reducer puro `orderDraft.ts`; nessuna logica qui.
 */

import { create } from 'zustand';
import {
  OrderDraftState,
  initialOrderDraft,
  updateDraft,
  startEnhance,
  enhanceSuccess,
  enhanceFailure,
  acceptEnhanced,
  rejectEnhanced,
  clearDraft,
} from './orderDraft';

interface OrderDraftStore extends OrderDraftState {
  update: (text: string) => void;
  startEnhance: () => void;
  enhanceSuccess: (preview: string) => void;
  enhanceFailure: (error: string) => void;
  acceptEnhanced: () => void;
  rejectEnhanced: () => void;
  clear: () => void;
}

export const useOrderDraftStore = create<OrderDraftStore>((set) => ({
  ...initialOrderDraft,
  update: (text) => set((s) => updateDraft(s, text)),
  startEnhance: () => set((s) => startEnhance(s)),
  enhanceSuccess: (preview) => set((s) => enhanceSuccess(s, preview)),
  enhanceFailure: (error) => set((s) => enhanceFailure(s, error)),
  acceptEnhanced: () => set((s) => acceptEnhanced(s)),
  rejectEnhanced: () => set((s) => rejectEnhanced(s)),
  clear: () => set((s) => clearDraft(s)),
}));
