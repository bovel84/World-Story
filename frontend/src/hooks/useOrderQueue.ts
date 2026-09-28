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
import type { CabinetAddressView, CabinetItemView, CabinetPathView, CabinetSessionView } from '../services/api';

/** P03 — la dichiarazione d'opera: quella che il motore accetta per un cantiere. */
export interface WorkDeclarationInput {
  workId: string;
  payerActorId: string;
  materialActorId: string;
  funded: boolean;
}

/**
 * P03 — La dichiarazione di una voce, se è registrabile come costruzione.
 *
 * `null` in tre casi, tutti dichiarati al giocatore: la voce non riguarda
 * un'opera; il server non ha risolto i detentori; nessun attore della nazione
 * copre la distinta (`materialActorId: null`).
 */
export function cabinetDeclarationFor(item: CabinetItemView): WorkDeclarationInput | null {
  const declaration = item.declaration;
  if (!declaration || !declaration.materialActorId) return null;
  return {
    workId: declaration.workId,
    payerActorId: declaration.payerActorId,
    materialActorId: declaration.materialActorId,
    funded: declaration.funded,
  };
}
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
  /** P03 — la dichiarazione d'opera della bozza corrente, se ne ha una. */
  pendingDeclaration: WorkDeclarationInput | null;
  /** La scarta quando la bozza cambia natura (ordine scritto a mano). */
  clearPendingDeclaration: () => void;
  /** P02 — la seduta del gabinetto, e le due azioni che la usano. */
  cabinet: CabinetSessionView | null;
  cabinetLoading: boolean;
  cabinetError: string;
  loadCabinet: () => Promise<void>;
  chooseCabinetPath: (item: CabinetAddressView['items'][number], path: CabinetPathView) => void;
}

export function useOrderQueue({ gameId }: UseOrderQueueOptions): OrderQueue {
  const { suggestions, setSuggestions } = useActionsStore();
  const { pendingActions, setPendingActions, addPendingAction, removePendingAction } = useGameStore();
  // P03 — Scrivere la bozza dal Governo: si usa lo stesso store del compositore,
  // così la proposta del ministro e l'ordine scritto a mano sono la STESSA cosa,
  // non due percorsi paralleli.
  const {
    startEnhance: startOrderEnhance, enhanceSuccess: orderEnhanceSuccess,
    enhanceFailure: orderEnhanceFailure, clear: clearOrderDraft,
    update: setOrderDraftText,
  } = useOrderDraftStore();

  // Brainstorm di azioni: stato e messaggio sono visibili anche al primo caricamento.
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  // P02 — La seduta del gabinetto: i ministri che hanno qualcosa da dire.
  // Sola lettura: caricarla non impegna nulla.
  const [cabinet, setCabinet] = useState<CabinetSessionView | null>(null);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState('');
  /**
   * P03 — La dichiarazione d'opera della bozza corrente: quella che il ministro
   * ha portato e che il giocatore conferma registrando. `null` per un ordine in
   * prosa — un testo libero non ha un'opera da dichiarare.
   */
  const [pendingDeclaration, setPendingDeclaration] = useState<WorkDeclarationInput | null>(null);

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

  /**
   * P02 — Carica la seduta del gabinetto. Sola lettura: nessuna spesa, nessuna
   * registrazione. Se il server non risponde, la pagina lo dice e il resto del
   * modulo resta usabile.
   */
  const clearPendingDeclaration = useCallback((): void => setPendingDeclaration(null), []);

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

  /**
   * P02/P03 — Scelta una strada, si compone la **bozza**: l'ordine scritto con
   * i termini della strada, pronto per il preflight.
   *
   * Non registra e non accoda: apre la bozza nel compositore, dove il giocatore
   * la corregge e la conferma. È l'invariante MG-I1 — un ministro propone, il
   * giocatore decide — e la ragione per cui questa funzione non chiama
   * `queuePlayerAction`.
   */
  const chooseCabinetPath = useCallback((
    item: CabinetAddressView['items'][number],
    path: CabinetPathView,
  ): void => {
    // P03 — La bozza nasce dal bisogno e dalla strada scelta. Il testo è per la
    // PERSONA: leggibile e correggibile. Se la voce riguarda un'opera, la
    // dichiarazione che il motore pretende viaggia ACCANTO, non dentro la
    // prosa: un numero scritto in una frase non è un numero che il motore legge.
    const missing = item.figures
      .filter(figure => figure.basis.kind !== 'measured' || figure.label.toLowerCase().includes('mancante'))
      .map(figure => figure.label);
    const declaration = cabinetDeclarationFor(item);
    const lines = [
      path.title,
      `— ${item.need}`,
      `Strada scelta: ${path.detail}`,
      `Prerequisiti: ${path.prerequisites.length > 0 ? path.prerequisites.join(', ') : 'nessuno'}`,
      `Esito atteso: ${path.expected}`,
      missing.length > 0 ? `Vincoli da sciogliere: ${missing.join(', ')}` : '',
    ];
    if (item.work && !declaration) {
      // L'opera c'è ma la distinta non è coperta: si dice, invece di scrivere un
      // ordine che non aprirebbe alcun cantiere.
      const mancanti = item.declaration?.missingMaterials
        ?.map(material => `${material.resourceId} (${material.missing})`) ?? [];
      lines.push(
        mancanti.length > 0
          ? `Attenzione: mancano ${mancanti.join(', ')}. Registrare non aprirebbe il cantiere.`
          : 'Attenzione: la distinta non è coperta. Registrare non aprirebbe il cantiere.',
      );
    }
    setOrderDraftText(lines.filter(Boolean).join('\n'));
    // La dichiarazione vive accanto alla bozza, nello stato del modulo: è ciò
    // che la coda invierà al motore.
    setPendingDeclaration(declaration);
  }, [setOrderDraftText, setPendingDeclaration]);

  const queuePlayerAction = useCallback(async (
    text: string,
    // MG02 µ6 / P03 — la dichiarazione d'opera, quando l'ordine è una
    // costruzione. Arriva dal server (verifica di fattibilità o Governo), non
    // dal giocatore: se il chiamante non la passa, si usa quella della bozza.
    work?: WorkDeclarationInput,
  ): Promise<boolean> => {
    if (!gameId || !text.trim()) return false;
    if (pendingActions.some(action => action.text.trim() === text.trim())) return true;
    setSuggestionsError('');
    try {
      const declared = work ?? pendingDeclaration ?? undefined;
      const queued = await gameApi.queueAction(gameId, text.trim(), declared ?? undefined);
      addPendingAction({ id: queued.id, text: queued.text });
      return true;
    } catch (e) {
      console.error('[Actions] Failed to queue action:', e);
      setSuggestionsError('Impossibile aggiungere l’azione alla coda. Riprova.');
      return false;
    }
  }, [gameId, pendingActions, addPendingAction, pendingDeclaration]);

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
    cabinet,
    cabinetLoading,
    cabinetError,
    loadCabinet,
    chooseCabinetPath,
    pendingDeclaration,
    clearPendingDeclaration,
  };
}
