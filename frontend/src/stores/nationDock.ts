/**
 * World Story — Stato delle sezioni del Dossier Nazione (U03 µ1)
 * ===========================================================
 * Il dossier è organizzato in sezioni progressive, senza duplicazioni:
 *  1. Situazione — decisioni che richiedono attenzione, tesoreria, stabilità
 *  2. Progetti   — ciò che è già avviato e la prossima scadenza registrata
 *  3. Cassa      — tesoreria, debito, credito e flussi: la valuta al centro
 *  4. Risorse    — scorte materiali, industria, risorse naturali e mercato
 *  5. Armamenti  — arsenale, qualità, produzione e catalogo
 *  6. Conoscenze — tecnologie sbloccate, capitale umano e formazione
 *  7. Politiche  — assetto istituzionale e coesione interna
 *
 * Ogni cifra compare in una sola sezione: le infrastrutture stanno in Risorse,
 * il denaro in Cassa, il combattente in Armamenti.
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
  | 'armamenti'
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
  'armamenti',
  'conoscenze',
  'politiche',
];

/** Etichetta leggibile di ogni sezione (italiano). */
export const NATION_SECTION_LABEL: Record<NationSection, string> = {
  situazione: 'Situazione',
  progetti: 'Progetti',
  bilancio: 'Cassa',
  risorse: 'Risorse e industria',
  armamenti: 'Armamenti',
  conoscenze: 'Conoscenze',
  politiche: 'Politiche',
};
