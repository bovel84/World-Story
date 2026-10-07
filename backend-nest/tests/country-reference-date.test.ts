import { describe, expect, it } from 'vitest';
import * as facts from '../src/utils/country-facts';

describe('date-correct country references', () => {
  it('restricts the 2024 registry to the reference year', () => {
    expect(facts.hasModernReferenceFacts('2024-01-01')).toBe(true);
    expect(facts.hasModernReferenceFacts('2024-12-31')).toBe(true);
    for (const date of ['1990-01-01', '2000-01-01', '2023-12-31', '2025-01-01', '2026-01-01']) {
      expect(facts.hasModernReferenceFacts(date), date).toBe(false);
    }
  });

  it('rejects missing and malformed reference dates', () => {
    for (const date of [undefined, null, '', 'invalid', '2024garbage', '2024-13-01', '2024-02-30']) {
      expect(facts.hasModernReferenceFacts(date), String(date)).toBe(false);
    }
    expect(facts.hasModernReferenceFacts('2024')).toBe(true);
  });

  it('uses Bosnia 2000 GDP instead of the 2024 GDP, even with a stale modern flag', () => {
    expect(facts.estimatedNominalGdpUsdBillions('BIH', 3_750_000, { startDate: '2000-01-01' })).toBe(5.5);
    expect(facts.estimatedNominalGdpUsdBillions('BIH', 3_750_000, {
      modernFacts: true, startDate: '2000-01-01',
    })).toBe(5.5);
    expect(facts.estimatedNominalGdpUsdBillions('BIH', 3_750_000, { startDate: '2024-01-01' })).toBe(29.7);
  });

  it('exposes historical estimates separately from the undated 2024 registry', () => {
    expect(facts.referenceGdpUsdBillionsForDate('BIH', '2000-01-01')).toBe(5.5);
    expect(facts.referenceGdpUsdBillionsForDate('USA', '2000-01-01')).toBe(10_252);
    expect(facts.referencePopulationForDate('BIH', '2000-01-01')).toBe(3_750_000);
    expect(facts.referencePopulationForDate('USA', '2000-01-01')).toBe(282_200_000);
    // No justified historical Bosnia debt series is registered: unknown is not zero or the 2024 ratio.
    expect(facts.referenceDebtToGdpPctForDate('BIH', '2000-01-01')).toBeNull();
    expect(facts.referenceDebtToGdpPctForDate('USA', '2000-01-01')).toBe(55);
    expect(facts.referenceGdpUsdBillionsForDate('BIH', '2024-01-01')).toBe(29.7);
    expect(facts.referencePopulationForDate('BIH', '2024-01-01')).toBe(3_164_253);
    expect(facts.referenceDebtToGdpPctForDate('BIH', '2024-01-01')).toBe(29.4);
  });

  it('only exact-year observations are authoritative; older GDP remains a weak deterministic fallback', () => {
    for (const [polityId, date] of [['FRA', '1940-01-01'], ['ARG', '1982-01-01'], ['UGA', '2000-01-01'], ['KHM', '1975-01-01']]) {
      expect(facts.referencePopulationForDate(polityId, date)).toBeNull();
      expect(facts.referenceGdpUsdBillionsForDate(polityId, date)).toBeNull();
      expect(facts.referenceDebtToGdpPctForDate(polityId, date)).toBeNull();
      expect(facts.historicalNominalGdpUsdBillions(polityId, 10_000_000, { startDate: date })).toBeGreaterThan(0);
    }
    expect(facts.referenceGdpUsdBillionsForDate('JPN', '2000-01-01')).toBeGreaterThan(0);
    expect(facts.referencePopulationForDate('JPN', '2000-01-01')).toBeNull();
    expect(facts.referenceDebtToGdpPctForDate('JPN', '2000-01-01')).toBeNull();
  });

  it('never chooses a historical table from after the requested year', () => {
    expect(facts.historicalGdpYear('1936-01-01')).toBe(1914);
    expect(facts.historicalGdpYear('1999-01-01')).toBe(1989);
    expect(facts.historicalGdpYear('1800-01-01')).toBeNull();
    expect(facts.referenceGdpUsdBillionsForDate('BIH', '1999-01-01')).toBeNull();
    expect(facts.referencePopulationForDate('BIH', '1999-01-01')).toBeNull();
    expect(facts.referenceDebtToGdpPctForDate('USA', '1999-01-01')).toBeNull();
  });

  it('returns unknown for unregistered, invalid, and non-reference-year dates without leaking 2024 values', () => {
    for (const date of [undefined, null, '', '2024garbage', '2024-02-30', '2025-01-01']) {
      expect(facts.referencePopulationForDate('BIH', date)).toBeNull();
      expect(facts.referenceDebtToGdpPctForDate('BIH', date)).toBeNull();
    }
    for (const select of [facts.referencePopulationForDate, facts.referenceGdpUsdBillionsForDate, facts.referenceDebtToGdpPctForDate]) {
      expect(select('UNKNOWN', '2000-01-01')).toBeNull();
      expect(select('toString', '2024-01-01')).toBeNull();
      expect(select('BIH', 'invalid')).toBeNull();
    }
    expect(facts.referenceGdpUsdBillionsForDate('BIH', '2025-01-01')).toBeNull();
    // Legacy estimates may still use an older observation, explicitly weak.
    expect(facts.historicalNominalGdpUsdBillions('BIH', 3_750_000, { startDate: '2025-01-01' })).toBe(5.5);
  });
});
