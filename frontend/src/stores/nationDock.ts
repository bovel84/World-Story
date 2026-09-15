/**
 * World Story — Stato delle sezioni del Dossier Nazione (U03 µ1)
 * ===========================================================
 * Il dossier è organizzato in sezioni progressive, senza duplicazioni:
 *  1. Situazione — decisioni che richiedono attenzione, tesoreria, stabilità
 *  2. Governo    — le anime del governo che spingono per i loro interessi
 *  3. Progetti   — ciò che è già avviato e la prossima scadenza registrata
 *  4. Cassa      — tesoreria, debito, credito e flussi: la valuta al centro
 *  5. Risorse    — scorte materiali, industria, risorse naturali e mercato
 *  6. Armamenti  — arsenale, qualità, produzione e catalogo
 *  7. Conoscenze — tecnologie sbloccate, capitale umano e formazione
 *  8. Politiche  — assetto istituzionale e coesione interna
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
  | 'governo'
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
  'governo',
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
  governo: 'Governo',
  progetti: 'Progetti',
  bilancio: 'Cassa',
  risorse: 'Risorse e industria',
  armamenti: 'Armamenti',
  conoscenze: 'Conoscenze',
  politiche: 'Politiche',
};
