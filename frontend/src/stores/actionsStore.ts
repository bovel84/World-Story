/**
 * World Story — Actions Store (Zustand)
 * ====================================
 * Stores suggestions and manual action input
 */

import { create } from 'zustand';

export interface SuggestedAction {
  title: string;
  content: string;
}

export interface Suggestion {
  topic: string;
  description: string;
  actions: SuggestedAction[];
}

interface ActionsState {
  // Suggestions from API
  suggestions: Suggestion[];

  // Manual action text input
  newActionText: string;

  // Actions
  setSuggestions: (suggestions: Suggestion[]) => void;
  setNewActionText: (text: string) => void;
  clearSuggestions: () => void;

  // Computed
  reset: () => void;
}

const initialState = {
  suggestions: [],
  newActionText: '',
};

export const useActionsStore = create<ActionsState>((set) => ({
  ...initialState,

  setSuggestions: (suggestions) => set({ suggestions }),
  setNewActionText: (text) => set({ newActionText: text }),
  clearSuggestions: () => set({ suggestions: [] }),

  reset: () => set(initialState),
}));
