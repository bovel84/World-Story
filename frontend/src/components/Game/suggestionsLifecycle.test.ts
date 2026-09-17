/**
 * ARMY-MOVE Parte 3 — le proposte elaborate si azzerano a ogni turno.
 *
 * Il pannello «Pianifica la prossima mossa» mostrava, al turno 8, le proposte
 * dei turni precedenti: nessuno azzerava lo store all'avanzamento (solo il
 * resume di un salvataggio lo faceva).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { shouldResetSuggestions, suggestionsEmptyHint } from './suggestionsLifecycle';
import { useActionsStore, type Suggestion } from '../../stores/actionsStore';

const PROPOSALS: Suggestion[] = [
  {
    topic: 'Difesa federale',
    description: 'Rafforzare il confine meridionale.',
    actions: [{ title: 'Richiamare le riserve', content: 'Richiamare due battaglioni di riserva.' }],
  },
];

describe('ARMY-MOVE P3 — quando le proposte elaborate vanno azzerate', () => {
  it('ogni esito che committa un turno azzera le proposte', () => {
    for (const outcome of ['world_advanced', 'actions_processed', 'awaiting_next', 'date_advanced', 'simulation_replayed']) {
      expect(shouldResetSuggestions(outcome), outcome).toBe(true);
    }
  });

  it('una ricerca senza eventi non cambia nulla: le proposte restano valide', () => {
    expect(shouldResetSuggestions('no_event_found')).toBe(false);
  });

  it('un esito sconosciuto o assente viene trattato come cambiamento (fail-safe)', () => {
    expect(shouldResetSuggestions('qualcosa_di_nuovo')).toBe(true);
    expect(shouldResetSuggestions(undefined)).toBe(true);
    expect(shouldResetSuggestions(null)).toBe(true);
    expect(shouldResetSuggestions('')).toBe(true);
  });

  it('il testo dello stato vuoto dice come rigenerare le proposte', () => {
    const hint = suggestionsEmptyHint();
    expect(hint).toContain('Elabora proposte');
    expect(hint).toContain('turno in corso');
  });
});

describe('ARMY-MOVE P3 — lo store riusato non accumula proposte fra i turni', () => {
  beforeEach(() => {
    useActionsStore.getState().reset();
  });

  it('azzerare le proposte svuota solo la lista, non la bozza d’ordine', () => {
    const store = useActionsStore.getState();
    store.setSuggestions(PROPOSALS);
    store.setNewActionText('Costruire una ferrovia verso il confine');
    expect(useActionsStore.getState().suggestions).toHaveLength(1);

    useActionsStore.getState().clearSuggestions();

    expect(useActionsStore.getState().suggestions).toEqual([]);
    // La bozza che il giocatore stava scrivendo non è una proposta: resta.
    expect(useActionsStore.getState().newActionText).toBe('Costruire una ferrovia verso il confine');
  });

  it('dopo tre avanzamenti non c’è accumulo: le proposte si rigenerano solo su richiesta', () => {
    for (let turn = 0; turn < 3; turn++) {
      useActionsStore.getState().setSuggestions(PROPOSALS);
      expect(useActionsStore.getState().suggestions).toHaveLength(1);
      // Stesso punto dell'avanzamento in cui il client rilegge la coda: reset.
      expect(shouldResetSuggestions('world_advanced')).toBe(true);
      useActionsStore.getState().clearSuggestions();
      expect(useActionsStore.getState().suggestions).toEqual([]);
    }
    // Nessuna proposta è riapparsa da sola: serve «Elabora proposte».
    expect(useActionsStore.getState().suggestions).toEqual([]);
  });

  it('«Elabora proposte» ripubblica una lista fresca e unica', () => {
    useActionsStore.getState().clearSuggestions();
    useActionsStore.getState().setSuggestions(PROPOSALS);
    useActionsStore.getState().setSuggestions(PROPOSALS);
    expect(useActionsStore.getState().suggestions).toHaveLength(1);
  });
});
