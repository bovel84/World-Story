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
 * V01 — `questioni` è il pannello delle sfide di pace, **fuori** dal dossier
 * nazionale: il dossier è un documento di stato, le risposte alle pressioni si
 * danno qui. Il modulo non aggiunge dati: monta le stesse pressioni che il
 * dossier riceveva (`nationalPressures`, `onResolvePressure`).
 *
 * D-1 — `forze` è la **sala operativa** (`ObjectsBoard`), anch'essa fuori dal
 * dossier per lo stesso principio: creare reparti, comprare equipaggiamento e
 * impartire ordini sono azioni, non cifre da leggere. Come Questioni, non
 * aggiunge dati: monta le stesse props che il dossier riceveva.
 *
 * Funzioni pure, testate prima di collegarle a React (pattern F06).
 */

export type ActiveModule =
  | 'none' | 'orders' | 'diplomacy' | 'advisor' | 'news' | 'nation'
  | 'questioni' | 'forze';

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
