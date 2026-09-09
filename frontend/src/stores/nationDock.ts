/**
 * World Story — Stato delle sezioni del Dossier Nazione (U03 µ1)
 * ===========================================================
 * Il dossier (maestro §10.3) è organizzato in sezioni progressive:
 *  1. Situazione   — decisioni che richiedono attenzione, cassa, autonomia
 *  2. Progetti     — attivi/bloccati/previsti, dipendenze, prossima milestone
 *  3. Bilancio     — liquidità, impegni, entrate/uscite reali e previste, debito
 *  4. Risorse      — stock/accesso, filiere, consumi, trasporti
 *  5. Conoscenze   — capacità disponibili/mancanti, ricerca/formazione
 *  6. Politiche    — mandati/delega, servizi essenziali, istituzioni
 *
 * Invarianti (UI01/UI04):
 *  - all'apertura del dossier la sezione attiva è «Situazione» (decisioni
 *    richieste), mai una sezione di dettaglio;
 *  - una sola sezione attiva alla volta;
 *  - cambiare sezione non muta lo stato del mondo (solo navigazione).
 *
 * Funzioni pure, testate prima di collegarle a React (pattern F06/U01).
 */

export type NationSection =
  | 'situazione'
  | 'progetti'
  | 'bilancio'
  | 'risorse'
  | 'conoscenze'
  | 'politiche';

export interface NationDockState {
  activeSection: NationSection;
}

export const initialNationDockState: NationDockState = { activeSection: 'situazione' };

/** Imposta la sezione attiva del dossier. Nessuna mutazione del mondo. */
export function setSection(state: NationDockState, section: NationSection): NationDockState {
  return { activeSection: section };
}

/** Ordine canonico delle sezioni (per la navigazione a schede). */
export const NATION_SECTIONS: NationSection[] = [
  'situazione',
  'progetti',
  'bilancio',
  'risorse',
  'conoscenze',
  'politiche',
];

/** Etichetta leggibile di ogni sezione (italiano). */
export const NATION_SECTION_LABEL: Record<NationSection, string> = {
  situazione: 'Situazione',
  progetti: 'Progetti',
  bilancio: 'Bilancio',
  risorse: 'Risorse e produzione',
  conoscenze: 'Conoscenze e personale',
  politiche: 'Politiche e servizi',
};
