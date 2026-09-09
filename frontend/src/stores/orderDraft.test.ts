import { describe, it, expect } from 'vitest';
import {
  initialOrderDraft,
  updateDraft,
  startEnhance,
  enhanceSuccess,
  enhanceFailure,
  acceptEnhanced,
  rejectEnhanced,
  clearDraft,
} from './orderDraft';

describe('orderDraft (U02 µ1 — compositore libero, UI02/UI13)', () => {
  it('stato iniziale: bozza vuota, nessuna anteprima, nessun errore', () => {
    expect(initialOrderDraft).toEqual({
      text: '',
      enhancedPreview: null,
      enhanceLoading: false,
      enhanceError: null,
    });
  });

  it('updateDraft aggiorna il testo e cancella gli errori tecnici precedenti', () => {
    const s = enhanceFailure(initialOrderDraft, 'rete non disponibile');
    const next = updateDraft(s, 'Costruire un impianto');
    expect(next.text).toBe('Costruire un impianto');
    expect(next.enhanceError).toBeNull();
  });

  it('startEnhance non muta la bozza e segnala il caricamento', () => {
    const s = updateDraft(initialOrderDraft, 'Costruire un impianto');
    const next = startEnhance(s);
    expect(next.text).toBe('Costruire un impianto');
    expect(next.enhanceLoading).toBe(true);
  });

  it('enhanceSuccess mostra l\'anteprima e conserva la bozza originale', () => {
    const s = updateDraft(initialOrderDraft, 'Costruire un impianto');
    const next = enhanceSuccess(startEnhance(s), 'Costruire un impianto di acciaio a Torino');
    expect(next.enhancedPreview).toBe('Costruire un impianto di acciaio a Torino');
    expect(next.text).toBe('Costruire un impianto');
    expect(next.enhanceLoading).toBe(false);
  });

  it('enhanceFailure PRESERVA la bozza e registra l\'errore tecnico (UI13)', () => {
    const s = updateDraft(initialOrderDraft, 'Costruire un impianto');
    const next = enhanceFailure(startEnhance(s), 'rete non disponibile');
    expect(next.text).toBe('Costruire un impianto');
    expect(next.enhanceError).toBe('rete non disponibile');
    expect(next.enhanceLoading).toBe(false);
  });

  it('acceptEnhanced sposta l\'anteprima nella bozza e chiude l\'anteprima', () => {
    const s = enhanceSuccess(
      startEnhance(updateDraft(initialOrderDraft, 'Costruire un impianto')),
      'Costruire un impianto di acciaio a Torino',
    );
    const next = acceptEnhanced(s);
    expect(next.text).toBe('Costruire un impianto di acciaio a Torino');
    expect(next.enhancedPreview).toBeNull();
  });

  it('acceptEnhanced senza anteprima è un no-op (nessuna mutazione)', () => {
    const s = updateDraft(initialOrderDraft, 'Costruire un impianto');
    const next = acceptEnhanced(s);
    expect(next).toBe(s);
  });

  it('rejectEnhanced conserva la bozza originale e chiude l\'anteprima', () => {
    const s = enhanceSuccess(
      startEnhance(updateDraft(initialOrderDraft, 'Costruire un impianto')),
      'Costruire un impianto di acciaio a Torino',
    );
    const next = rejectEnhanced(s);
    expect(next.text).toBe('Costruire un impianto');
    expect(next.enhancedPreview).toBeNull();
  });

  it('clearDraft svuota tutto dopo la registrazione', () => {
    const s = enhanceSuccess(
      startEnhance(updateDraft(initialOrderDraft, 'Costruire un impianto')),
      'Costruire un impianto di acciaio a Torino',
    );
    expect(clearDraft(s)).toEqual(initialOrderDraft);
  });

  it('la bozza non viene persa su errore di rete anche dopo un\'anteprima rifiutata', () => {
    const s = updateDraft(initialOrderDraft, 'Avviare la ricerca sulla fusione');
    const withPreview = enhanceSuccess(startEnhance(s), 'Avviare la ricerca sulla fusione nucleare');
    const rejected = rejectEnhanced(withPreview);
    const failed = enhanceFailure(startEnhance(rejected), 'timeout');
    expect(failed.text).toBe('Avviare la ricerca sulla fusione');
    expect(failed.enhanceError).toBe('timeout');
  });
});
