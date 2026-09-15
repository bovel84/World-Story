import { describe, expect, it } from 'vitest';
import type { GovernmentFaction, NationalBudgetDetail } from '../../services/api';
import {
  factionOrderText,
  hasBudgetDetail,
  nationalVerdict,
  pressureTone,
  satisfactionTone,
  stanceTone,
} from './governmentDossier';

const budget = (overrides: Partial<NationalBudgetDetail> = {}): NationalBudgetDetail => ({
  currency: 'mld',
  revenue: [{ id: 'incomeTax', label: 'Imposta sul reddito', amount: 10, sharePct: 100 }],
  expense: [{ id: 'defence', label: 'Difesa', amount: 5, sharePct: 100 }],
  revenueTotal: 10,
  expenseTotal: 5,
  balance: 5,
  effectiveTaxRatePct: 12,
  defenceBurdenPct: 3,
  socialBurdenPct: 6,
  educationBurdenPct: 4,
  ...overrides,
});

describe('governmentDossier — lettura del governo e del bilancio', () => {
  it('classifica una nazione solida quando cresce, è stabile e in attivo', () => {
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 2000, monthlyRevenue: 25, monthlyExpenses: 18,
      monthlyBalance: 7, annualGrowthRate: 0.03, stability: 70, socialTension: 20,
    }, budget());
    expect(verdict.level).toBe('solida');
    expect(verdict.tone).toBe('positive');
    expect(verdict.signals.length).toBeGreaterThan(3);
  });

  it('classifica critica una nazione in forte disavanzo e con tensione alta', () => {
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 1000, monthlyRevenue: 8, monthlyExpenses: 15,
      monthlyBalance: -7, annualGrowthRate: 0.005, stability: 35, socialTension: 65,
    }, budget({ balance: -7, revenueTotal: 8, expenseTotal: 15 }));
    expect(verdict.level).toBe('critica');
    expect(verdict.tone).toBe('negative');
  });

  it('classifica fragile un disavanzo contenuto', () => {
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 2000, monthlyRevenue: 20, monthlyExpenses: 22,
      monthlyBalance: -2, annualGrowthRate: 0.01, stability: 55, socialTension: 30,
    }, budget({ balance: -2, revenueTotal: 20, expenseTotal: 22 }));
    expect(verdict.level).toBe('fragile');
    expect(verdict.tone).toBe('warning');
  });

  it('un conto assente non produce un giudizio positivo inventato', () => {
    const verdict = nationalVerdict(null, null);
    expect(verdict.level).toBe('equilibrata');
    expect(verdict.signals.length).toBeGreaterThan(0);
  });

  it('riconosce un dettaglio di bilancio pubblicato dal motore', () => {
    expect(hasBudgetDetail(budget())).toBe(true);
    expect(hasBudgetDetail(null)).toBe(false);
    expect(hasBudgetDetail({ ...budget(), revenue: [], expense: [] })).toBe(false);
  });

  it('mappa posizione e pressione in toni coerenti', () => {
    expect(stanceTone('alleato')).toBe('positive');
    expect(stanceTone('ostile')).toBe('negative');
    expect(stanceTone('critico')).toBe('warning');
    expect(satisfactionTone(80)).toBe('positive');
    expect(satisfactionTone(20)).toBe('negative');
    expect(pressureTone(70)).toBe('negative');
    expect(pressureTone(10)).toBe('positive');
  });

  it('trasforma la richiesta di una fazione in una bozza d’ordine azionabile', () => {
    const faction: GovernmentFaction = {
      id: 'militari', name: 'Forze armate', interest: 'Difesa',
      powerPct: 20, satisfaction: 30, stance: 'critico', pressure: 60,
      demand: {
        lever: 'difesa', title: 'Riarmo: portare la spesa militare al 4% del PIL',
        detail: 'La difesa vale il 2% del PIL.', direction: 'alza', urgency: 70,
      },
      footprint: 'Spinge la spesa militare.',
    };
    const text = factionOrderText(faction);
    expect(text).toContain('Aumentare');
    expect(text).toContain('Difesa');
    expect(text).toContain('Riarmo');
    expect(text).toContain('copertura di bilancio');
  });
});
