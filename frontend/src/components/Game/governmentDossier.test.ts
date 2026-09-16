import { describe, expect, it } from 'vitest';
import type { GovernmentFaction, GovernmentSnapshot, NationalBudgetDetail } from '../../services/api';
import {
  councilPresence,
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

  it('classifica fragile un disavanzo che pesa sul PIL', () => {
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 2000, monthlyRevenue: 20, monthlyExpenses: 26,
      monthlyBalance: -6, annualGrowthRate: 0.01, stability: 55, socialTension: 30,
    }, budget({ balance: -6, revenueTotal: 20, expenseTotal: 26 }));
    expect(verdict.level).toBe('fragile');
    expect(verdict.tone).toBe('warning');
  });

  it('un avanzo con consenso medio resta in equilibrio, senza contraddirsi', () => {
    // Caso reale: saldo attivo e debito sotto controllo, ma stabilità media.
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 27, monthlyRevenue: 0.2, monthlyExpenses: 0.13,
      monthlyBalance: 0.07, annualGrowthRate: 0.018, stability: 46, socialTension: 29,
    }, budget(), { ratioPct: 54.5, servicePct: 18.2 });
    expect(verdict.level).toBe('equilibrata');
    // Il dettaglio nomina la debolezza reale, non «senza margini ampi».
    expect(verdict.detail).toContain('stabilità politica');
    // Il debito entra tra i segnali letti dal motore.
    expect(verdict.signals.join(' ')).toContain('Debito pubblico 54.5% del PIL');
  });

  it('un debito insostenibile rende fragile una nazione in avanzo', () => {
    const verdict = nationalVerdict({
      nominalGdpUsdBillions: 100, monthlyRevenue: 2, monthlyExpenses: 1.5,
      monthlyBalance: 0.5, annualGrowthRate: 0.01, stability: 60, socialTension: 20,
    }, budget(), { ratioPct: 110, servicePct: 22 });
    expect(verdict.level).toBe('fragile');
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

  it('LW04 — riassume la presenza del consiglio senza inventare dati', () => {
    const faction = (id: string, name: string, powerPct: number): GovernmentFaction => ({
      id, name, interest: 'i', powerPct, satisfaction: 50, stance: 'neutrale', pressure: 40,
      demand: { lever: 'difesa', title: 't', detail: 'd', direction: 'mantieni', urgency: 1 }, footprint: '',
    });
    const snapshot: GovernmentSnapshot = {
      factions: [faction('industriali', 'Industriali', 45), faction('militari', 'Militari', 25)],
      dominantId: 'industriali', angriestId: 'militari', cohesion: 58, pressureIndex: 62,
      headline: 'Il consiglio è diviso.', budget: budget(),
    };
    const presence = councilPresence(snapshot);
    expect(presence?.dominantName).toBe('Industriali');
    expect(presence?.angriestName).toBe('Militari');
    expect(presence?.headline).toContain('coesione 58%');
    expect(presence?.headline).toContain('pressione 62%');
    expect(presence?.detail).toContain('Industriali');
    expect(presence?.tone).toBe('negative');
  });

  it('LW04 — nessun consiglio pubblicato, nessuna presenza inventata', () => {
    expect(councilPresence(null)).toBeNull();
    expect(councilPresence({ factions: [] } as unknown as GovernmentSnapshot)).toBeNull();
  });
});
