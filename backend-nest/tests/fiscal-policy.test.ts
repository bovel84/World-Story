import { describe, expect, it } from 'vitest';
import {
  clampTaxRatePct,
  DEFAULT_FISCAL_POLICY,
  describeFiscalEffects,
  FISCAL_MAX_PCT,
  FISCAL_MIN_PCT,
  FISCAL_NEUTRAL_PCT,
  fiscalEffects,
  fiscalLabel,
  fiscalShockModifier,
} from '../src/core/simulation/FiscalPolicy';

describe('FiscalPolicy', () => {
  it('blocca l’aliquota nei limiti di gioco e rifiuta i valori non numerici', () => {
    expect(clampTaxRatePct(FISCAL_MIN_PCT - 10)).toBe(FISCAL_MIN_PCT);
    expect(clampTaxRatePct(FISCAL_MAX_PCT + 10)).toBe(FISCAL_MAX_PCT);
    expect(clampTaxRatePct(22.456)).toBe(22.5);
    expect(clampTaxRatePct('17')).toBe(17);
    expect(clampTaxRatePct(Number.NaN)).toBe(FISCAL_NEUTRAL_PCT);
    expect(clampTaxRatePct(undefined)).toBe(DEFAULT_FISCAL_POLICY.taxRatePct);
  });

  it('al riferimento neutro non altera consenso, tensione o crescita', () => {
    expect(fiscalEffects(FISCAL_NEUTRAL_PCT)).toEqual({
      stabilityDelta: 0,
      tensionDelta: 0,
      growthDelta: 0,
    });
  });

  it('è lineare e simmetrica attorno al riferimento', () => {
    const high = fiscalEffects(30, 20);
    const low = fiscalEffects(10, 20);
    expect(high.stabilityDelta).toBeCloseTo(-12, 5);
    expect(high.tensionDelta).toBeCloseTo(9, 5);
    expect(high.growthDelta).toBeCloseTo(-0.006, 5);
    expect(low.stabilityDelta).toBeCloseTo(12, 5);
    expect(low.tensionDelta).toBeCloseTo(-9, 5);
    expect(low.growthDelta).toBeCloseTo(0.006, 5);
    // Il consenso è più sensibile del riequilibrio di cassa: alzare le tasse
    // di 10 punti non è una salita gratuita di stabilità.
    expect(high.stabilityDelta).toBeLessThan(-7.5);
  });

  it('il costo transitorio della manovra cresce con lo scarto ed è nullo sotto i 2 punti', () => {
    expect(fiscalShockModifier(12, 13)).toEqual({ stabilityDelta: 0, tensionDelta: 0 });
    const small = fiscalShockModifier(10, 14);
    const large = fiscalShockModifier(10, 30);
    expect(small.stabilityDelta).toBeLessThan(0);
    expect(large.stabilityDelta).toBeLessThan(small.stabilityDelta);
    expect(large.tensionDelta).toBeGreaterThan(small.tensionDelta);
    // Il tetto evita che una singola manovra azzeri il consenso.
    expect(fiscalShockModifier(0, 100).stabilityDelta).toBeGreaterThanOrEqual(-10);
    expect(fiscalShockModifier(0, 100).tensionDelta).toBeLessThanOrEqual(12);
  });

  it('etichetta e descrizione seguono il livello di prelievo', () => {
    expect(fiscalLabel(4)).toBe('Prelievo minimo');
    expect(fiscalLabel(10)).toBe('Prelievo contenuto');
    expect(fiscalLabel(20)).toBe('Prelievo alto');
    expect(fiscalLabel(45)).toBe('Prelievo molto alto');
    const lines = describeFiscalEffects(30, 10);
    expect(lines[0]).toContain('30% del PIL');
    expect(lines[1]).toContain('Stabilità -24');
    expect(lines[2]).toContain('Crescita annua -1.2%');
  });
});
