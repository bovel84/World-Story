import { describe, expect, it } from 'vitest';
import { adaptiveAutoHorizon, jumpHorizon, addDays } from '../src/core/simulation/calendar';
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
describe('Auto-jump — finestra adattiva, non limite agli eventi', () => {
  it('senza ordini consulta settimane anziché un anno e conserva gli intervalli espliciti', () => {
    expect(adaptiveAutoHorizon({ currentDate: '2000-01-01', hasOrders: false })).toBe(60);
    expect(adaptiveAutoHorizon({ currentDate: '2000-01-01', hasOrders: true })).toBe(90);
    expect(jumpHorizon(120)).toBe(120);
    expect(addDays('2000-01-01', 60)).toBe('2000-03-01');
  });

  it('reagisce a crisi documentate e non oltrepassa le scadenze', () => {
    const args = { currentDate: '2000-01-01', hasOrders: false };
    expect(adaptiveAutoHorizon({ ...args, crisisLevel: 'critical' })).toBe(14);
    expect(adaptiveAutoHorizon({ ...args, hasOrders: true, crisisLevel: 'critical' })).toBe(14);
    expect(adaptiveAutoHorizon({ ...args, crisisLevel: 'watch' })).toBe(30);
    expect(adaptiveAutoHorizon({ ...args, pressures: [{ severity: 3 }] })).toBe(14);
    expect(adaptiveAutoHorizon({ ...args, pressures: [{ severity: 2 }] })).toBe(30);
    expect(adaptiveAutoHorizon({ ...args, pressures: [{ severity: 2, deadlineDate: '2000-01-09' }] })).toBe(8);
    expect(adaptiveAutoHorizon({ ...args, pressures: [{ severity: 1, deadlineDate: '1999-12-31' }] })).toBe(60);
  });
});

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
