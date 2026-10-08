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
import { cabinetDeclarationFor, composeCabinetOrderText, type WorkDeclarationInput } from '../components/Game/cabinetOrder';
import type { CabinetAddressView, CabinetPathView, CabinetSessionView } from '../services/api';
import { useActionsStore, useGameStore } from '../stores';
import { useOrderDraftStore } from '../stores/orderDraftStore';
import { simulationErrorMessage } from '../utils/errors';

export interface UseOrderQueueOptions {
  gameId: string | null;
}

export interface OrderQueue {
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
  queuePlayerAction: (text: string, work?: WorkDeclarationInput, signatureKey?: string) => Promise<boolean>;
  removeQueuedAction: (actionId: string) => Promise<void>;
  updateQueuedAction: (actionId: string, newText: string) => Promise<void>;
  enhanceOrder: (text: string) => Promise<void>;
  verifyOrder: (text: string) => Promise<void>;
  handleFeasibilityRegister: () => Promise<void>;
  handleFeasibilityBack: () => void;
  handleFeasibilityReverify: () => void;
  registerOrder: (text: string) => Promise<void>;
  /** P02 — la seduta del gabinetto, e le azioni che la usano. */
  cabinet: CabinetSessionView | null;
  cabinetLoading: boolean;
  cabinetError: string;
  loadCabinet: () => Promise<void>;
  /**
   * WS-GOVOFFICE-02 — La strada scelta nella seduta entra in coda
   * **automaticamente**: l'ordine matura dalla discussione, non da un atto di
   * conferma separato. Il testo lo compone `composeCabinetOrderText` dai dati
   * del motore.
   */
  queueCabinetPath: (item: CabinetAddressView['items'][number], path: CabinetPathView) => Promise<boolean>;
}

export function useOrderQueue({ gameId }: UseOrderQueueOptions): OrderQueue {
  const { pendingActions, setPendingActions, addPendingAction, removePendingAction } = useGameStore();
  // P03 — Scrivere la bozza dal Governo: si usa lo stesso store del compositore,
  // così la proposta del ministro e l'ordine scritto a mano sono la STESSA cosa,
  // non due percorsi paralleli.
  const {
    startEnhance: startOrderEnhance, enhanceSuccess: orderEnhanceSuccess,
    enhanceFailure: orderEnhanceFailure, clear: clearOrderDraft,
  } = useOrderDraftStore();

  // Brainstorm di azioni: stato e messaggio sono visibili anche al primo caricamento.

  // P02 — La seduta del gabinetto: i ministri che hanno qualcosa da dire.
  // Sola lettura: caricarla non impegna nulla.
  const [cabinet, setCabinet] = useState<CabinetSessionView | null>(null);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState('');
  // Errore della coda d'ordini (nome storico: era anche dei suggerimenti).
  const [suggestionsError, setSuggestionsError] = useState('');

  // Modifica di un ordine in coda prima della presa in carico (G04 / §6.1).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingActionText, setEditingActionText] = useState('');

  const [showFeasibility, setShowFeasibility] = useState(false);
  const [verifyingText, setVerifyingText] = useState('');
  const [feasibilityResult, setFeasibilityResult] = useState<FeasibilityResult | null>(null);
  const [feasibilityLoading, setFeasibilityLoading] = useState(false);
  const [feasibilityError, setFeasibilityError] = useState<string | null>(null);


  /**
   * P02 — Carica la seduta del gabinetto. Sola lettura: nessuna spesa, nessuna
   * registrazione. Se il server non risponde, la pagina lo dice e il resto del
   * modulo resta usabile.
   */
  const loadCabinet = useCallback(async (): Promise<void> => {
    if (!gameId) return;
    setCabinetLoading(true);
    setCabinetError('');
    try {
      const session = await gameApi.governmentCabinet(gameId);
      setCabinet(session);
    } catch (e) {
      console.error('[Government] Failed to load cabinet session:', e);
      setCabinetError('La seduta del Governo non è disponibile ora.');
    } finally {
      setCabinetLoading(false);
    }
  }, [gameId]);

  const queuePlayerAction = useCallback(async (
    text: string,
    // MG02 µ6 / P03 — la dichiarazione d'opera, quando l'ordine è una
    // costruzione. Arriva dal server (verifica di fattibilità o Governo), non
    // dal giocatore.
    work?: WorkDeclarationInput,
    signatureKey?: string,
  ): Promise<boolean> => {
    if (!gameId || !text.trim()) return false;
    if (!signatureKey && pendingActions.some(action => action.text.trim() === text.trim())) return true;
    setSuggestionsError('');
    try {
      const queued = await gameApi.queueAction(gameId, text.trim(), work, signatureKey);
      if (signatureKey) {
        // La ricevuta è l'accettazione originale, non lo stato corrente: un
        // replay dopo revoca/esecuzione non deve ricreare fantasmi nella UI.
        const current = await gameApi.getPendingActions(gameId);
        if (useGameStore.getState().currentGame?.id !== gameId) return false;
        setPendingActions(current.pendingActions);
        if (!current.pendingActions.some(action => action.id === queued.id)) {
          setSuggestionsError('Firma già accettata, ma ordine non più in coda. Per una nuova firma prepara una nuova bozza.');
          return false;
        }
      } else {
        addPendingAction({ id: queued.id, text: queued.text });
      }
      return true;
    } catch (e) {
      console.error('[Actions] Failed to queue action:', e);
      setSuggestionsError('Impossibile aggiungere l’azione alla coda. Riprova.');
      return false;
    }
  }, [gameId, pendingActions, addPendingAction, setPendingActions]);

  /**
   * WS-GOVOFFICE-02 — La strada scelta nella seduta entra in coda
   * **automaticamente** (nessuna conferma separata): è l'esito esplicito della
   * discussione. Il testo lo compone `composeCabinetOrderText` dai dati del
   * motore; la dichiarazione d'opera, se c'è, viaggia accanto.
   *
   * L'invariante MG-I1 cambia qui la sua forma: leggere una seduta non impegna,
   * ma **concludere** una strada sì. Il compositore libero resta separato e
   * continua a passare dalla verifica di fattibilità.
   */
  const queueCabinetPath = useCallback(async (
    item: CabinetAddressView['items'][number],
    path: CabinetPathView,
  ): Promise<boolean> => {
    const declaration = cabinetDeclarationFor(item);
    return queuePlayerAction(composeCabinetOrderText(item, path), declaration ?? undefined);
  }, [queuePlayerAction]);

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
      // La dichiarazione si rimanda solo se il server ha trovato un detentore
      // per i materiali: `materialActorId: null` significa che nessuno copre
      // la distinta, e in quel caso l'ordine resta prosa invece di promettere
      // un cantiere che non nascerebbe.
      const declaration = feasibilityResult.workDeclaration;
      const work = declaration && declaration.materialActorId
        ? {
          workId: declaration.workId,
          payerActorId: declaration.payerActorId,
          materialActorId: declaration.materialActorId,
          funded: declaration.funded,
        }
        : undefined;
      if (await queuePlayerAction(verifyingText.trim(), work)) {
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
    queuePlayerAction,
    removeQueuedAction,
    updateQueuedAction,
    enhanceOrder,
    verifyOrder,
    handleFeasibilityRegister,
    handleFeasibilityBack,
    handleFeasibilityReverify,
    registerOrder,
    cabinet,
    cabinetLoading,
    cabinetError,
    loadCabinet,
    queueCabinetPath,
  };
}
