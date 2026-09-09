/**
 * World Story — UI Store (Zustand)
 * ==============================
 */

import { create } from 'zustand';
import type { WorldTemplate } from '../types';
import {
  initialModuleState,
  openModule as openModuleReducer,
  closeModule as closeModuleReducer,
  toggleModule as toggleModuleReducer,
  type ActiveModule,
} from './moduleState';

export type ViewType = 'menu' | 'select-template' | 'select-country' | 'select-map' | 'create-world' | 'game' | 'editor';

export interface LocalMap {
  id: string;
  name: string;
  width?: number;
  height?: number;
  regions: { id: string; name: string; color: string; path: string }[];
  objects?: { id: string; type: string; name: string; x: number; y: number; regionId?: string }[];
}

type SavedMapsUpdater = (maps: LocalMap[]) => LocalMap[];

interface UIState {
  // Navigation
  currentView: ViewType;
  loading: boolean;

  // Time jump
  showJumpMenu: boolean;
  jumpDays: number;

  // Saves menu
  showSavesMenu: boolean;

  // Prompt editor
  showPromptEditor: boolean;
  editingPrompt: string;

  // Modulo operativo attivo (U01): un solo modulo alla volta.
  activeModule: ActiveModule;

  // Actions panel
  actionsMaximized: boolean;
  actionsSize: { width: number; height: number };
  isResizing: boolean;

  // Map selection
  selectedMapForWorld: LocalMap | null;
  savedMaps: LocalMap[];

  // Template selection
  selectedTemplate: WorldTemplate | null;

  // Actions
  setCurrentView: (view: ViewType) => void;
  setLoading: (loading: boolean) => void;
  setShowJumpMenu: (show: boolean) => void;
  setJumpDays: (days: number) => void;
  setShowSavesMenu: (show: boolean) => void;
  setShowPromptEditor: (show: boolean) => void;
  setEditingPrompt: (prompt: string) => void;
  openModule: (module: ActiveModule) => void;
  closeModule: () => void;
  toggleModule: (module: ActiveModule) => void;
  setActionsMaximized: (maximized: boolean) => void;
  setActionsSize: (size: { width: number; height: number }) => void;
  setIsResizing: (resizing: boolean) => void;
  setSelectedMapForWorld: (map: LocalMap | null) => void;
  setSavedMaps: (maps: LocalMap[] | SavedMapsUpdater) => void;
  addSavedMap: (map: LocalMap) => void;
  setSelectedTemplate: (template: WorldTemplate | null) => void;

  // Computed
  resetUI: () => void;
}

const initialState = {
  currentView: 'menu' as ViewType,
  loading: false,
  showJumpMenu: false,
  jumpDays: 30,
  showSavesMenu: false,
  showPromptEditor: false,
  editingPrompt: '',
  activeModule: initialModuleState.activeModule,
  actionsMaximized: false,
  actionsSize: { width: 400, height: 500 },
  isResizing: false,
  selectedMapForWorld: null,
  savedMaps: [] as LocalMap[],
  selectedTemplate: null,
};

export const useUIStore = create<UIState>((set) => ({
  ...initialState,

  setCurrentView: (view) => set({ currentView: view }),
  setLoading: (loading) => set({ loading }),
  setShowJumpMenu: (show) => set({ showJumpMenu: show }),
  setJumpDays: (days) => set({ jumpDays: days }),
  setShowSavesMenu: (show) => set({ showSavesMenu: show }),
  setShowPromptEditor: (show) => set({ showPromptEditor: show }),
  setEditingPrompt: (prompt) => set({ editingPrompt: prompt }),
  openModule: (module) => set((state) => ({
    activeModule: openModuleReducer({ activeModule: state.activeModule }, module).activeModule,
  })),
  closeModule: () => set((state) => ({
    activeModule: closeModuleReducer({ activeModule: state.activeModule }).activeModule,
  })),
  toggleModule: (module) => set((state) => ({
    activeModule: toggleModuleReducer({ activeModule: state.activeModule }, module).activeModule,
  })),
  setActionsMaximized: (maximized) => set({ actionsMaximized: maximized }),
  setActionsSize: (size) => set({ actionsSize: size }),
  setIsResizing: (resizing) => set({ isResizing: resizing }),
  setSelectedMapForWorld: (map) => set({ selectedMapForWorld: map }),
  setSavedMaps: (mapsOrUpdater) => set((state) => ({
    savedMaps: typeof mapsOrUpdater === 'function'
      ? mapsOrUpdater(state.savedMaps)
      : mapsOrUpdater
  })),
  addSavedMap: (map) => set((state) => ({ savedMaps: [...state.savedMaps, map] })),
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),

  resetUI: () => set(initialState),
}));
