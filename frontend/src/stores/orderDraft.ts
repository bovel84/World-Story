/**
 * World Story — U02 µ1: stato puro della bozza d'ordine (compositore libero).
 *
 * Invarianti (piano U02 passo 1, maestro §10.6, UI02/UI13):
 *  - La bozza (`text`) non viene MAI persa su errore di rete o su rifiuto
 *    dell'anteprima (UI13: «errori di rete conservano bozza/coda»).
 *  - «Registra ordine» non avanza il tempo né spende risorse: la fattibilità
 *    e i costi sono valutati dal simulatore al salto (UI02).
 *  - L'anteprima «Migliora formulazione» è una proposta da confermare
 *    esplicitamente; accettarla sposta il testo nella bozza, rifiutarla
 *    conserva la bozza originale. Nessuna chiamata a pagamento silenziosa.
 */

export interface OrderDraftState {
  /** Testo libero dell'ordine (bozza). */
  text: string;
  /** Proposta riformulata da confermare (null = nessuna anteprima). */
  enhancedPreview: string | null;
  /** True mentre il server riformula. */
  enhanceLoading: boolean;
  /** Errore tecnico dell'ultima riformulazione (la bozza resta intatta). */
  enhanceError: string | null;
}

export const initialOrderDraft: OrderDraftState = {
  text: '',
  enhancedPreview: null,
  enhanceLoading: false,
  enhanceError: null,
};

/** Aggiorna la bozza; cancella gli errori tecnici precedenti. */
export function updateDraft(state: OrderDraftState, text: string): OrderDraftState {
  return { ...state, text, enhanceError: null };
}

/** Avvia la riformulazione (nessuna mutazione della bozza). */
export function startEnhance(state: OrderDraftState): OrderDraftState {
  return { ...state, enhanceLoading: true, enhanceError: null };
}

/** Riformulazione riuscita: mostra l'anteprima, la bozza resta intatta. */
export function enhanceSuccess(state: OrderDraftState, preview: string): OrderDraftState {
  return { ...state, enhanceLoading: false, enhancedPreview: preview, enhanceError: null };
}

/** Riformulazione fallita: la bozza è PRESERVATA (UI13). */
export function enhanceFailure(state: OrderDraftState, error: string): OrderDraftState {
  return { ...state, enhanceLoading: false, enhanceError: error };
}

/** Accetta l'anteprima: la sposta nella bozza e chiude l'anteprima. */
export function acceptEnhanced(state: OrderDraftState): OrderDraftState {
  if (!state.enhancedPreview) return state;
  return { ...state, text: state.enhancedPreview, enhancedPreview: null, enhanceError: null };
}

/** Rifiuta l'anteprima: conserva la bozza originale. */
export function rejectEnhanced(state: OrderDraftState): OrderDraftState {
  return { ...state, enhancedPreview: null };
}

/** Svuota la bozza dopo la registrazione. */
export function clearDraft(state: OrderDraftState): OrderDraftState {
  return { ...initialOrderDraft };
}
