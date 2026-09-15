/**
 * Test del debito sovrano come portafoglio di titoli. Verifica:
 *  - tasso di mercato crescente con durata e rapporto debito/PIL;
 *  - emissione con scadenza e interessi passivi;
 *  - scadenza e rollover al tasso di mercato corrente;
 *  - riflessi sociali (tensione/stabilità) del debito alto.
 */
import { describe, it, expect } from 'vitest';
import {
  addYears, annualInterestMld, averageMaturityYears, baseRatePct, debtPrincipal,
  describeDebtTranche, issueDebtTranche, marketRatePct, maturedDebts, riskPremiumPct,
  rolloverTranche, tensionFromDebtRatio, type SovereignDebt,
} from '../src/core/simulation/SovereignDebt';

function tranche(overrides: Partial<SovereignDebt> = {}): SovereignDebt {
  return {
    id: 'debt-1', label: 'Titolo 10 anni', principal: 100, annualRatePct: 3,
    issuedDate: '2024-01-01', maturityDate: '2034-01-01', termYears: 10,
    ...overrides,
  };
}

describe('SovereignDebt — prezzo del denaro', () => {
  it('il tasso base cresce con la durata ed è limitato', () => {
    expect(baseRatePct(1)).toBeLessThan(baseRatePct(30));
    expect(baseRatePct(1000)).toBeLessThanOrEqual(6);
  });

  it('il premio di rischio è nullo sotto il 60% e cresce sopra', () => {
    expect(riskPremiumPct(40)).toBe(0);
    expect(riskPremiumPct(60)).toBe(0);
    expect(riskPremiumPct(90)).toBeGreaterThan(0);
    expect(riskPremiumPct(200)).toBeGreaterThan(riskPremiumPct(120));
  });

  it('il tasso di mercato somma durata e rischio, con un tetto', () => {
    expect(marketRatePct(30, 10)).toBeLessThan(marketRatePct(200, 10));
    expect(marketRatePct(200, 10)).toBeGreaterThan(marketRatePct(200, 5));
    expect(marketRatePct(1000, 1000)).toBeLessThanOrEqual(18);
  });
});

describe('SovereignDebt — emissione e portafoglio', () => {
  it('emette un titolo con scadenza e tasso di mercato', () => {
    const { debts, tranche: issued } = issueDebtTranche([], {
      amountMld: 50, termYears: 10, date: '2024-06-15', debtRatioPct: 70,
    });
    expect(debts).toHaveLength(1);
    expect(issued.principal).toBe(50);
    expect(issued.issuedDate).toBe('2024-06-15');
    expect(issued.maturityDate).toBe('2034-06-15');
    expect(issued.annualRatePct).toBe(marketRatePct(70, 10));
    expect(debtPrincipal(debts)).toBe(50);
    expect(annualInterestMld(debts)).toBeCloseTo(50 * issued.annualRatePct / 100, 3);
  });

  it('cumula più titoli e ne misura la scadenza media ponderata', () => {
    const first = issueDebtTranche([], { amountMld: 100, termYears: 5, date: '2024-01-01', debtRatioPct: 50 }).debts;
    const second = issueDebtTranche(first, { amountMld: 100, termYears: 15, date: '2024-01-01', debtRatioPct: 50 }).debts;
    expect(debtPrincipal(second)).toBe(200);
    expect(averageMaturityYears(second, '2024-01-01')).toBeCloseTo(10, 0);
  });

  it('addYears rispetta anni bisestili e date sporche', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('non-una-data', 0)).toBe('1970-01-01');
  });

  it('normalizza e descrive un titolo in modo leggibile', () => {
    expect(debtPrincipal(undefined)).toBe(0);
    expect(annualInterestMld(undefined)).toBe(0);
    expect(averageMaturityYears(undefined, '2024-01-01')).toBe(0);
    expect(describeDebtTranche(tranche())).toContain('100 mld');
    expect(describeDebtTranche(tranche())).toContain('2034-01-01');
  });
});

describe('SovereignDebt — scadenze e rollover', () => {
  it('riconosce solo i titoli maturati entro la data', () => {
    const portfolio = [tranche({ id: 'a', maturityDate: '2026-01-01' }), tranche({ id: 'b', maturityDate: '2040-01-01' })];
    const matured = maturedDebts(portfolio, '2026-01-01');
    expect(matured.map(debt => debt.id)).toEqual(['a']);
    expect(maturedDebts(portfolio, '2039-01-01').map(debt => debt.id)).toEqual(['a']);
    expect(maturedDebts(undefined, '2039-01-01')).toEqual([]);
  });

  it('il rollover conserva il capitale e rinnova tasso e scadenza', () => {
    const rolled = rolloverTranche(tranche({ maturityDate: '2025-01-01' }), '2025-01-01', 90);
    expect(rolled.principal).toBe(100);
    expect(rolled.issuedDate).toBe('2025-01-01');
    expect(rolled.maturityDate).toBe('2035-01-01');
    // Il nuovo tasso è quello di mercato per un debito al 90% del PIL.
    expect(rolled.annualRatePct).toBe(marketRatePct(90, 10));
    expect(rolled.label).toContain('10 anni');
  });
});

describe('SovereignDebt — riflessi sociali', () => {
  it('un debito moderato non genera tensione', () => {
    const calm = tensionFromDebtRatio(40, 0);
    expect(calm.socialTension).toBe(0);
    expect(calm.stability).toBe(0);
  });

  it('il debito alto alza la tensione e abbassa la stabilità, con limiti', () => {
    const high = tensionFromDebtRatio(180, 30);
    expect(high.socialTension).toBeGreaterThan(0);
    expect(high.stability).toBeLessThan(0);
    expect(high.socialTension).toBeLessThanOrEqual(38);
    expect(tensionFromDebtRatio(500, 500).socialTension).toBeLessThanOrEqual(38);
  });

  it('un servizio del debito pesante pesa anche a debito moderato', () => {
    expect(tensionFromDebtRatio(50, 0).socialTension).toBe(0);
    expect(tensionFromDebtRatio(50, 20).socialTension).toBeGreaterThan(0);
  });
});
