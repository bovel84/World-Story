/**
 * World Story — Stato delle sezioni del Dossier Nazione (U03 µ1, V03)
 * ====================================================================
 * V03: le otto sezioni a scheda diventano **quattro dense**, stile cancelleria:
 *
 *  1. Situazione     — il giudizio, gli indicatori, la crisi, le decisioni.
 *                      È la prima cosa che si vede, e l'unica apertura coerente.
 *  2. Regno          — governo, politiche, popolo: la dimensione civile.
 *  3. Tesoro         — cassa, risorse, progetti: tutta la materia economica.
 *  4. Stato maggiore — forze armate, impegni, strategie: forza ed estero.
 *
 * Ogni cifra compare in una sola sezione. Il principio D01 non cambia: cambia
 * l'accorpamento, non la regola — la dimensione civile (prima spezzata in tre
 * schede da 2, 1 e 3 blocchi) sta in Regno, l'economia (prima spezzata in tre)
 * sta in Tesoro, forza ed estero in Stato maggiore.
 *
 * Invarianti (UI01/UI04, immutate):
 *  - all'apertura del dossier la sezione attiva è «Situazione», mai una sezione
 *    di dettaglio;
 *  - una sola sezione attiva alla volta;
 *  - cambiare sezione non muta lo stato del mondo (solo navigazione).
 *
 * Funzioni pure, testate prima di collegarle a React (pattern F06/U01).
 */

export type NationSection = 'situazione' | 'regno' | 'tesoro' | 'statoMaggiore';

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
  'regno',
  'tesoro',
  'statoMaggiore',
];

/** Etichetta leggibile di ogni sezione (italiano). */
export const NATION_SECTION_LABEL: Record<NationSection, string> = {
  situazione: 'Situazione',
  regno: 'Regno',
  tesoro: 'Tesoro',
  statoMaggiore: 'Stato maggiore',
};
