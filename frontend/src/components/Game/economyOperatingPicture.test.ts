/**
 * COUNTRY-CLARITY — scheda Economia: avanzo, disavanzo, debito, interessi,
 * trend, dati mancanti e scenario storico.
 */
import { describe, it, expect } from 'vitest';
import { economyOperatingPicture, type EconomyInput } from './economyOperatingPicture';

function input(overrides: Partial<EconomyInput> = {}): EconomyInput {
  const { account, resources, ...rest } = overrides;
  return {
    ...rest,
    account: {
      monthlyRevenue: 74, monthlyExpenses: 79, monthlyBalance: -5,
      annualGrowthRate: 1.2, nominalGdpUsdBillions: 2100, debtServicePct: 12,
      ...account,
    },
    resources: {
      debt: 1720, debtRatioPct: 82, annualInterest: 51, creditHeadroom: 80,
      marketRatePct: 4.5, money: 42,
      ...resources,
    },
  };
}

describe('COUNTRY-CLARITY · economia', () => {
  it('disavanzo: diagnosi deterministica e driver del problema', () => {
    const picture = economyOperatingPicture(input());
    expect(picture.diagnosis.title).toBe('DISAVANZO PERSISTENTE');
    expect(picture.diagnosis.detail).toContain('5,00');
    expect(picture.diagnosis.detail).toContain('debito cresce');
    expect(picture.balance).toBe(-5);
    expect(picture.deficitPctOfExpense).toBeCloseTo(6.3, 1);
    expect(picture.treasuryMonths).toBeCloseTo(0.5, 1);
    expect(picture.status).toBe('pressure');
    expect(picture.drivers.some(driver => driver.label.startsWith('Disavanzo'))).toBe(true);
    expect(picture.drivers.some(driver => driver.label.startsWith('Debito al'))).toBe(true);
    expect(picture.drivers.some(driver => driver.label.startsWith('Interessi'))).toBe(true);
    expect(picture.metrics.map(metric => metric.id)).toContain('debtRatio');
    expect(picture.metrics.find(metric => metric.id === 'gdp')?.value).toBe(2100);
  });

  it('avanzo: diagnosi positiva e stato solido', () => {
    const picture = economyOperatingPicture(input({
      account: { monthlyRevenue: 80, monthlyExpenses: 74, monthlyBalance: 6, annualGrowthRate: 2, nominalGdpUsdBillions: 2100 },
      resources: { debt: 400, debtRatioPct: 20, annualInterest: 8, creditHeadroom: 300, marketRatePct: 3, money: 120 },
    }));
    expect(picture.diagnosis.title).toBe('AVANZO');
    expect(picture.diagnosis.detail).toContain('6,00');
    expect(picture.status).toBe('healthy');
    expect(picture.drivers.some(driver => driver.tone === 'positive')).toBe(true);
  });

  it('debito e interessi elevati portano lo stato a critico', () => {
    const picture = economyOperatingPicture(input({
      account: { monthlyRevenue: 74, monthlyExpenses: 79, monthlyBalance: -5, annualGrowthRate: 0.5, nominalGdpUsdBillions: 1000, debtServicePct: 30 },
      resources: { debt: 1600, debtRatioPct: 160, annualInterest: 140, creditHeadroom: 0, marketRatePct: 11, money: -3 },
    }));
    expect(picture.status).toBe('critical');
    expect(picture.drivers.some(driver => driver.label === 'Cassa negativa')).toBe(true);
    expect(picture.drivers.some(driver => driver.tone === 'critical')).toBe(true);
    expect(picture.debtServicePct).toBeGreaterThan(15);
  });

  it('trend: confronto con il punto precedente dello storico', () => {
    const base = input({
      account: { monthlyRevenue: 74, monthlyExpenses: 79, monthlyBalance: -5, annualGrowthRate: 1.2, nominalGdpUsdBillions: 2100 },
      resources: { debt: 1720, debtRatioPct: 82, annualInterest: 51, money: 42 },
    });
    const rising = economyOperatingPicture({
      ...base,
      history: [
        { date: '2026-01-01', account: { monthlyBalance: -8, money: 60, debt: 1600 } as any },
        { date: '2026-02-01', account: { monthlyBalance: -5, money: 42, debt: 1720 } as any },
      ],
    });
    expect(rising.drivers.some(driver => /Saldo in miglioramento/.test(driver.detail ?? ''))).toBe(true);
    expect(rising.drivers.some(driver => /in aumento/.test(driver.detail ?? ''))).toBe(true);

    const falling = economyOperatingPicture({
      ...base,
      history: [
        { date: '2026-01-01', account: { monthlyBalance: -2, money: 80, debt: 1500 } as any },
        { date: '2026-02-01', account: { monthlyBalance: -9, money: 42, debt: 1400 } as any },
      ],
    });
    expect(falling.drivers.some(driver => /in peggioramento/.test(driver.detail ?? ''))).toBe(true);
    expect(falling.drivers.some(driver => /in calo/.test(driver.detail ?? ''))).toBe(true);
  });

  it('zero e dati mancanti: nessun numero inventato, nessuna diagnosi finta', () => {
    const missing = economyOperatingPicture({});
    expect(missing.status).toBe('pressure');
    expect(missing.diagnosis.title).toBe('BILANCIO NON DISPONIBILE');
    expect(missing.balance).toBeNull();
    expect(missing.metrics.every(metric => metric.value === null || metric.value === 0)).toBe(true);
    expect(missing.headline).toContain('non è pubblicato');

    const zero = economyOperatingPicture({ account: { monthlyRevenue: 0, monthlyExpenses: 0, monthlyBalance: 0, nominalGdpUsdBillions: 0 } });
    expect(zero.balance).toBe(0);
    expect(zero.diagnosis.title).toBe('AVANZO');
    expect(zero.deficitPctOfExpense).toBeNull();
    expect(zero.treasuryMonths).toBeNull();
  });

  it('scenario storico (1815): nessun debito moderno, stato letto dai pochi dati presenti', () => {
    const picture = economyOperatingPicture({
      account: { monthlyRevenue: 2.4, monthlyExpenses: 2.6, monthlyBalance: -0.2, annualGrowthRate: 0.4, nominalGdpUsdBillions: 60, government: 'Impero' },
      resources: { money: 4, debt: 0, debtRatioPct: 0, annualInterest: 0, creditLimit: 20, creditHeadroom: 20 },
    });
    expect(picture.diagnosis.title).toBe('DISAVANZO PERSISTENTE');
    expect(picture.status).toBe('pressure');
    expect(picture.metrics.find(metric => metric.id === 'interest')?.value).toBe(0);
    expect(picture.metrics.find(metric => metric.id === 'debtRatio')?.value).toBe(0);
  });
});
