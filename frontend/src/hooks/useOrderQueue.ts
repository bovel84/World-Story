/**
 * World Story — Fase 2: `useOrderQueue`
 * ====================================
 * La coda degli ordini del giocatore — suggerimenti, accodamento, modifica
 * prima della presa in carico, «migliora formulazione» e verifica di
 * fattibilità — era distribuita in `App.tsx` fra stato locale, azioni di
 * store e chiamate al motore. Questo hook la possiede.
 *
 * Contratto invariato:
 *  - registrare o modificare un ordine non esegue lavori e non contabilizza
 *    costi materiali (I02): qui si scrive solo nella coda, mai nel mondo;
 *  - la verifica di fattibilità è una preview, non una garanzia: solo l'esito
 *    `feasible` accoda, e l'accodamento resta server-authoritative;
 *  - un ordine duplicato (stesso testo) è idempotente;
 *  - la bozza d'ordine resta intatta se la verifica o l'accodamento falliscono.
 */
import { useCallback, useState } from 'react';
import { gameApi } from '../services/api';
import type { FeasibilityResult } from '../components/Game/FeasibilityCheck';
import { useActionsStore, useGameStore } from '../stores';
import { useOrderDraftStore } from '../stores/orderDraftStore';
import { simulationErrorMessage } from '../utils/errors';

export interface UseOrderQueueOptions {
  gameId: string | null;
}

export interface OrderQueue {
  suggestionsLoading: boolean;
  suggestionsError: string;
  editingActionId: string | null;
  setEditingActionId: React.Dispatch<React.SetStateAction<string | null>>;
  editingActionText: string;
  setEditingActionText: React.Dispatch<React.SetStateAction<string>>;
  showFeasibility: boolean;
  setShowFeasibility: React.Dispatch<React.SetStateAction<boolean>>;
  verifyingText: string;
  feasibilityResult: FeasibilityResult | null;
  feasibilityLoading: boolean;
  feasibilityError: string | null;
  generateSuggestions: () => Promise<void>;
  queuePlayerAction: (text: string) => Promise<boolean>;
  removeQueuedAction: (actionId: string) => Promise<void>;
  updateQueuedAction: (actionId: string, newText: string) => Promise<void>;
  enhanceOrder: (text: string) => Promise<void>;
  verifyOrder: (text: string) => Promise<void>;
  handleFeasibilityRegister: () => Promise<void>;
  handleFeasibilityBack: () => void;
  handleFeasibilityReverify: () => void;
  registerOrder: (text: string) => Promise<void>;
}

export function useOrderQueue({ gameId }: UseOrderQueueOptions): OrderQueue {
  const { suggestions, setSuggestions } = useActionsStore();
  const { pendingActions, setPendingActions, addPendingAction, removePendingAction } = useGameStore();
  const { startEnhance: startOrderEnhance, enhanceSuccess: orderEnhanceSuccess, enhanceFailure: orderEnhanceFailure, clear: clearOrderDraft } = useOrderDraftStore();

  // Brainstorm di azioni: stato e messaggio sono visibili anche al primo caricamento.
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  // Modifica di un ordine in coda prima della presa in carico (G04 / §6.1).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingActionText, setEditingActionText] = useState('');

  const [showFeasibility, setShowFeasibility] = useState(false);
  const [verifyingText, setVerifyingText] = useState('');
  const [feasibilityResult, setFeasibilityResult] = useState<FeasibilityResult | null>(null);
  const [feasibilityLoading, setFeasibilityLoading] = useState(false);
  const [feasibilityError, setFeasibilityError] = useState<string | null>(null);

  const generateSuggestions = useCallback(async () => {
    if (!gameId || suggestionsLoading) return;
    setSuggestionsLoading(true);
    setSuggestionsError('');
    try {
      const data = await gameApi.getSuggestions(gameId);
      setSuggestions(data.suggestions || []);
      if (!data.suggestions?.length) {
        setSuggestionsError('Nessuna proposta ricevuta. Prova a generarle di nuovo.');
      }
    } catch (e) {
      console.error('[Suggestions] Generation failed:', e);
      setSuggestionsError(simulationErrorMessage(e));
    } finally {
      setSuggestionsLoading(false);
    }
  }, [gameId, suggestionsLoading, setSuggestions]);

  const queuePlayerAction = useCallback(async (text: string): Promise<boolean> => {
    if (!gameId || !text.trim()) return false;
    if (pendingActions.some(action => action.text.trim() === text.trim())) return true;
    setSuggestionsError('');
    try {
      const queued = await gameApi.queueAction(gameId, text.trim());
      addPendingAction({ id: queued.id, text: queued.text });
      return true;
    } catch (e) {
      console.error('[Actions] Failed to queue action:', e);
      setSuggestionsError('Impossibile aggiungere l’azione alla coda. Riprova.');
      return false;
    }
  }, [gameId, pendingActions, addPendingAction]);

  const removeQueuedAction = useCallback(async (actionId: string) => {
    if (!gameId) return;
    setSuggestionsError('');
    try {
      await gameApi.removePendingAction(gameId, actionId);
      removePendingAction(actionId);
    } catch (e) {
      console.error('[Actions] Failed to remove action:', e);
      setSuggestionsError('L’azione è già in elaborazione o non può essere rimossa.');
    }
  }, [gameId, removePendingAction]);

  // Modifica persistita di un ordine in coda: non fa passare tempo e non
  // altera l'intenzione originale oltre il testo che il giocatore conferma.
  const updateQueuedAction = useCallback(async (actionId: string, newText: string) => {
    if (!gameId) return;
    setSuggestionsError('');
    try {
      const { action } = await gameApi.updatePendingAction(gameId, actionId, newText);
      setPendingActions(pendingActions.map(a => a.id === action.id ? { ...a, text: action.text } : a));
      setEditingActionId(null);
      setEditingActionText('');
    } catch (e) {
      console.error('[Actions] Failed to update action:', e);
      setSuggestionsError('L’azione è già in elaborazione o non può essere modificata.');
    }
  }, [gameId, pendingActions, setPendingActions]);

  // G24 — «Migliora formulazione»: produce un'anteprima riformulata senza
  // accodare né simulare. L'accettazione della proposta è un click esplicito.
  const enhanceOrder = useCallback(async (text: string) => {
    if (!gameId) return;
    setSuggestionsError('');
    startOrderEnhance();
    try {
      const { enhanced } = await gameApi.enhanceAction(gameId, text);
      orderEnhanceSuccess(enhanced);
    } catch (e) {
      console.error('[Actions] Failed to enhance action:', e);
      orderEnhanceFailure('Il miglioramento della formulazione non è disponibile ora.');
    }
  }, [gameId, startOrderEnhance, orderEnhanceSuccess, orderEnhanceFailure]);

  // G4-B: verifica fattibilità da testo libero («Registra ordine» apre la verifica;
  // solo un esito fattibile accoda l'ordine). L'errore tecnico conserva la bozza.
  const verifyOrder = useCallback(async (text: string) => {
    if (!gameId) return;
    setVerifyingText(text);
    setFeasibilityLoading(true);
    setFeasibilityError(null);
    setFeasibilityResult(null);
    try {
      const result = await gameApi.checkFeasibility(gameId, text);
      setFeasibilityResult(result);
      setFeasibilityLoading(false);
      setShowFeasibility(true);
    } catch (e) {
      console.error('[Actions] Failed to verify feasibility:', e);
      setFeasibilityError('La verifica di fattibilità non è disponibile ora.');
      setFeasibilityLoading(false);
      setShowFeasibility(true);
    }
  }, [gameId]);

  const handleFeasibilityRegister = useCallback(async () => {
    if (feasibilityResult?.feasible && verifyingText.trim()) {
      if (await queuePlayerAction(verifyingText.trim())) {
        clearOrderDraft();
        setShowFeasibility(false);
        setVerifyingText('');
        setFeasibilityResult(null);
      }
    }
  }, [feasibilityResult, verifyingText, queuePlayerAction, clearOrderDraft]);

  const handleFeasibilityBack = useCallback(() => {
    setShowFeasibility(false);
    setVerifyingText('');
    setFeasibilityResult(null);
  }, []);

  const handleFeasibilityReverify = useCallback(() => {
    if (verifyingText.trim()) {
      void verifyOrder(verifyingText);
    }
  }, [verifyingText, verifyOrder]);

  // U02 µ1 / G4-B: «Registra ordine» apre la verifica di fattibilità; solo un
  // esito fattibile accoda. La bozza resta intatta finché l'accodamento non riesce.
  const registerOrder = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await verifyOrder(trimmed);
  }, [verifyOrder]);

  return {
    suggestionsLoading,
    suggestionsError,
    editingActionId,
    setEditingActionId,
    editingActionText,
    setEditingActionText,
    showFeasibility,
    setShowFeasibility,
    verifyingText,
    feasibilityResult,
    feasibilityLoading,
    feasibilityError,
    generateSuggestions,
    queuePlayerAction,
    removeQueuedAction,
    updateQueuedAction,
    enhanceOrder,
    verifyOrder,
    handleFeasibilityRegister,
    handleFeasibilityBack,
    handleFeasibilityReverify,
    registerOrder,
  };
}
