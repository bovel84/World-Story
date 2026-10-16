import { describe, expect, it } from 'vitest';
import {
  AUTO_JUMP_MAX_EVENTS,
  AUTO_JUMP_MIN_EVENTS,
  AUTO_JUMP_WORLD_NEWS_EVENTS,
  autoJumpEventBudget,
  isDecisiveNpcDecision,
} from '../src/core/simulation/EventBudget';

/**
 * L'auto-jump senza ordini raccoglie un lotto di notizie documentate;
 * con ordini continua a fermarsi sulla decisione NPC pertinente.
 */
describe('Auto-jump — budget e decisione che ferma il salto', () => {
  it('concede tre dispacci senza ordini e scala con gli ordini entro il tetto', () => {
    expect(autoJumpEventBudget(0)).toBe(AUTO_JUMP_WORLD_NEWS_EVENTS);
    expect(autoJumpEventBudget(1)).toBeGreaterThanOrEqual(AUTO_JUMP_MIN_EVENTS);
    expect(autoJumpEventBudget(2)).toBe(4);
    expect(autoJumpEventBudget(100)).toBe(AUTO_JUMP_MAX_EVENTS);
    // Valori degeneri non devono produrre budget negativi o non finiti.
    expect(autoJumpEventBudget(Number.NaN)).toBe(AUTO_JUMP_WORLD_NEWS_EVENTS);
    expect(autoJumpEventBudget(-3)).toBe(AUTO_JUMP_WORLD_NEWS_EVENTS);
  });

  it('riconosce come decisive la controparte diretta e le misure autonome', () => {
    expect(isDecisiveNpcDecision({ reactions: [{ role: 'counterparty' }] })).toBe(true);
    expect(isDecisiveNpcDecision({ reactions: [{ role: 'observer', counterAction: 'Mobilitazione delle riserve.' }] })).toBe(true);
    expect(isDecisiveNpcDecision({ reactions: [{ role: 'ally' }, { role: 'counterparty', counterAction: 'Embargo.' }] })).toBe(true);
  });

  it('non ferma il salto su reazioni di puro contesto', () => {
    expect(isDecisiveNpcDecision({ reactions: [{ role: 'observer' }] })).toBe(false);
    expect(isDecisiveNpcDecision({ reactions: [{ role: 'mediator', counterAction: '   ' }] })).toBe(false);
    expect(isDecisiveNpcDecision({ reactions: [] })).toBe(false);
    expect(isDecisiveNpcDecision(null)).toBe(false);
    expect(isDecisiveNpcDecision(undefined)).toBe(false);
    expect(isDecisiveNpcDecision({})).toBe(false);
  });
});
