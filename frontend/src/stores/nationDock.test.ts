/**
 * World Story — U03 µ1: test dello stato delle sezioni del Dossier Nazione
 * =====================================================================
 * Verifica le invarianti del `nationDock`:
 *  - all'apertura la sezione attiva è «Situazione» (decisioni richieste);
 *  - una sola sezione attiva alla volta;
 *  - cambiare sezione è solo navigazione (nessuna mutazione del mondo).
 */
import { describe, it, expect } from 'vitest';
import {
  initialNationDockState,
  setSection,
  NATION_SECTIONS,
  NATION_SECTION_LABEL,
  type NationSection,
} from './nationDock';

describe('nationDock (U03 µ1, UI01/UI04)', () => {
  it('all’apertura del dossier la sezione attiva è «Situazione» (decisioni richieste)', () => {
    expect(initialNationDockState.activeSection).toBe('situazione');
  });

  it('le sei sezioni del maestro §10.3 sono presenti nell’ordine canonico', () => {
    expect(NATION_SECTIONS).toEqual([
      'situazione',
      'progetti',
      'bilancio',
      'risorse',
      'conoscenze',
      'politiche',
    ]);
  });

  it('ogni sezione ha un’etichetta leggibile in italiano', () => {
    for (const section of NATION_SECTIONS) {
      expect(NATION_SECTION_LABEL[section]).toBeTruthy();
    }
  });

  it('setSection imposta una sola sezione attiva alla volta', () => {
    let state = initialNationDockState;
    for (const section of NATION_SECTIONS) {
      state = setSection(state, section);
      expect(state.activeSection).toBe(section);
    }
  });

  it('cambiare sezione non muta lo stato del mondo (solo navigazione)', () => {
    const state = setSection(initialNationDockState, 'bilancio');
    expect(state).toEqual({ activeSection: 'bilancio' });
    // Nessun campo aggiuntivo: il reducer restituisce solo la sezione attiva.
    expect(Object.keys(state)).toEqual(['activeSection']);
  });

  it('setSection è puro: non modifica lo stato in ingresso', () => {
    const before = initialNationDockState;
    const after = setSection(before, 'progetti');
    expect(before.activeSection).toBe('situazione');
    expect(after.activeSection).toBe('progetti');
  });

  it('tutte le sezioni sono valori validi del tipo NationSection', () => {
    const valid: NationSection[] = ['situazione', 'progetti', 'bilancio', 'risorse', 'conoscenze', 'politiche'];
    for (const section of NATION_SECTIONS) {
      expect(valid).toContain(section);
    }
  });
});
