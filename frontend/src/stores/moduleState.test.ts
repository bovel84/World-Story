/**
 * World Story — U01 µ1: test dello stato dei moduli operativi (UI01)
 * ===============================================================
 * Verifica le invarianti del `activeModule` enum:
 *  - all'ingresso la mappa è libera (activeModule === 'none');
 *  - un solo modulo attivo alla volta (aprire un modulo chiude il precedente);
 *  - aprire Chat/Ordini/Consulente/Notizie chiude Nazione e viceversa;
 *  - 'none' è l'unico stato senza pannello.
 */
import { describe, it, expect } from 'vitest';
import {
  initialModuleState,
  openModule,
  closeModule,
  toggleModule,
  type ActiveModule,
} from './moduleState';

const MODULES: ActiveModule[] = ['orders', 'diplomacy', 'advisor', 'news', 'nation'];

describe('moduleState (U01 µ1, UI01)', () => {
  it('all’ingresso la mappa è libera: activeModule === none', () => {
    expect(initialModuleState.activeModule).toBe('none');
  });

  it('aprire un modulo chiude sempre il precedente (un solo modulo attivo)', () => {
    let state = initialModuleState;
    for (const module of MODULES) {
      state = openModule(state, module);
      expect(state.activeModule).toBe(module);
    }
  });

  it('aprire un modulo diverso chiude quello attivo', () => {
    const state = openModule(openModule(initialModuleState, 'orders'), 'diplomacy');
    expect(state.activeModule).toBe('diplomacy');
  });

  it('aprire Nazione e poi Ordini chiude Nazione (e viceversa)', () => {
    const nationThenOrders = openModule(openModule(initialModuleState, 'nation'), 'orders');
    expect(nationThenOrders.activeModule).toBe('orders');

    const ordersThenNation = openModule(openModule(initialModuleState, 'orders'), 'nation');
    expect(ordersThenNation.activeModule).toBe('nation');
  });

  it('openModule(none) chiude qualsiasi modulo attivo', () => {
    const state = openModule(openModule(initialModuleState, 'news'), 'none');
    expect(state.activeModule).toBe('none');
  });

  it('closeModule riporta la mappa libera', () => {
    const state = closeModule(openModule(initialModuleState, 'nation'));
    expect(state.activeModule).toBe('none');
  });

  it('toggleModule apre un modulo chiuso e chiude quello già attivo', () => {
    expect(toggleModule(initialModuleState, 'orders').activeModule).toBe('orders');
    expect(toggleModule(openModule(initialModuleState, 'orders'), 'orders').activeModule).toBe('none');
  });

  it('toggleModule su un modulo diverso apre quello nuovo', () => {
    const state = toggleModule(openModule(initialModuleState, 'orders'), 'advisor');
    expect(state.activeModule).toBe('advisor');
  });

  it('toggleModule(none) non apre alcun pannello', () => {
    expect(toggleModule(initialModuleState, 'none').activeModule).toBe('none');
  });
});
