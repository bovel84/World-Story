/**
 * World Story — Stato dei moduli operativi (U01 µ1)
 * ===============================================
 * Un solo modulo attivo alla volta. Sostituisce i booleans concorrenti
 * (showActions / panelOpen / panelTab) con un enum canonico `activeModule`.
 *
 * Invarianti (UI01):
 *  - all'ingresso/ripristino partita la mappa è libera: activeModule === 'none';
 *  - aprire un modulo chiude sempre il precedente (un solo modulo attivo);
 *  - aprire Chat/Ordini/Consulente/Notizie chiude Nazione e viceversa;
 *  - 'none' è l'unico stato senza pannello.
 *
 * Funzioni pure, testate prima di collegarle a React (pattern F06).
 */

export type ActiveModule = 'none' | 'orders' | 'diplomacy' | 'advisor' | 'news' | 'nation';

export interface ModuleState {
  activeModule: ActiveModule;
}

export const initialModuleState: ModuleState = { activeModule: 'none' };

/** Apre un modulo: chiude sempre il precedente (un solo modulo attivo). */
export function openModule(state: ModuleState, module: ActiveModule): ModuleState {
  if (module === 'none') return { activeModule: 'none' };
  return { activeModule: module };
}

/** Chiude il modulo attivo: la mappa torna libera. */
export function closeModule(state: ModuleState): ModuleState {
  return { activeModule: 'none' };
}

/** Alterna un modulo: se già attivo lo chiude, altrimenti lo apre. */
export function toggleModule(state: ModuleState, module: ActiveModule): ModuleState {
  if (module === 'none') return { activeModule: 'none' };
  return { activeModule: state.activeModule === module ? 'none' : module };
}
