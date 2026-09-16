/**
 * World Story — Fase 2: `useAppLifecycle`
 * ======================================
 * Effetti di ciclo di vita dell'app, prima sparsi in `App.tsx`:
 *  - collegamento di `chatStore` alla partita corrente (azzera il feed del
 *    consulente al cambio partita e ricarica le chat);
 *  - visibilità del pannello chat in base al modulo attivo;
 *  - rehydration della chiave API LLM solo-browser (config dal server +
 *    reinvio della chiave salvata per provider/modello).
 *
 * Sono preoccupazioni di sessione/app, non di shell di gioco: per questo non
 * vivono in `useShellState`.
 */
import { useCallback, useEffect } from 'react';
import { llmApi } from '../services/api';
import { getStoredKey, migrateLegacyKey } from '../services/llmKeyStore';
import { useChatStore, type FloatingPanelTab } from '../stores';
import type { ActiveModule } from '../stores/moduleState';

export interface AppLifecycleOptions {
  gameId: string | null;
  activeModule: ActiveModule;
  /** Azzera la cronaca quando cambia la partita. */
  resetTimeline: () => void;
}

export interface AppLifecycle {
  /** Ripristina la chiave API del modello attivo dal solo storage del browser. */
  rehydrateBrowserApiKey: () => Promise<void>;
}

/** U01 µ1: mappa il modulo attivo sulla tab del pannello flottante. */
export function moduleToPanelTab(m: ActiveModule): FloatingPanelTab {
  switch (m) {
    case 'orders': return 'suggestions';
    case 'diplomacy': return 'chats';
    case 'advisor': return 'advisor';
    case 'news': return 'news';
    case 'nation': return 'nation';
    case 'none': return 'suggestions';
  }
}

export function useAppLifecycle({ gameId, activeModule, resetTimeline }: AppLifecycleOptions): AppLifecycle {
  // Collegamento di chatStore alla partita corrente (cambiando partita il feed
  // del consulente si azzera).
  useEffect(() => {
    const chatStore = useChatStore.getState();
    chatStore.setGameId(gameId);
    resetTimeline();
    if (gameId) chatStore.refreshChats();
  }, [gameId, resetTimeline]);

  // U01 µ1: un solo modulo attivo alla volta. I valori legacy (showActions,
  // panelTab) sono DERIVATI da activeModule, non più booleans concorrenti.
  const showActions = activeModule !== 'none' && activeModule !== 'nation';
  const panelTab = moduleToPanelTab(activeModule);
  useEffect(() => {
    useChatStore.getState().setChatPanelVisible(
      Boolean(showActions && panelTab === 'chats' && gameId)
    );
  }, [activeModule, gameId]);

  // Chiavi API solo-browser, con fallback per provider (services/llmKeyStore.ts):
  // a ogni apertura di partita (o avvio app) chiediamo al server la config attiva
  // e reinviamo la chiave salvata per quel modello o endpoint del provider — il
  // server non la conserva né su disco né tra un riavvio e l'altro.
  const rehydrateBrowserApiKey = useCallback(async () => {
    try {
      const cfg = await llmApi.config();
      const d = cfg.default;
      migrateLegacyKey(d.provider || '', d.baseUrl || '', d.model || '');
      const storedKey = getStoredKey(d.provider || '', d.baseUrl || '', d.model || '');
      if (!storedKey) return;
      await llmApi.save({
        default: { apiKey: storedKey },
        persistApiKey: false,
      });
    } catch { /* silenzioso: la UI segnalerà comunque un eventuale errore LLM */ }
  }, []);

  useEffect(() => {
    void rehydrateBrowserApiKey();
  }, [gameId, rehydrateBrowserApiKey]);

  return { rehydrateBrowserApiKey };
}
