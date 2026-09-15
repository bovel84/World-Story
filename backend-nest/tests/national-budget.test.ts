import { describe, expect, it } from 'vitest';
import { allocateBudget, nationalBudgetDetail } from '../src/core/simulation/NationalBudget';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';

const accountFor = (objects: Array<{ type: string; level?: number }> = []) =>
  WorldStateEngine.accounts([
    { id: 'p1', owner: 'ITA', population: 60_000_000, gdp: 2000, militaryPower: 40, objects },
  ]).ITA;

describe('NationalBudget — dettaglio delle entrate e delle uscite', () => {
  it('la somma delle voci è esattamente il totale pubblicato dal motore', () => {
    const account = accountFor([
      { type: 'factory', level: 4 }, { type: 'port', level: 2 },
      { type: 'university', level: 3 }, { type: 'army', level: 5 },
      { type: 'mobilization', level: 2 },
    ]);
    const budget = nationalBudgetDetail(account);
    const revenueSum = budget.revenue.reduce((sum, line) => sum + line.amount, 0);
    const expenseSum = budget.expense.reduce((sum, line) => sum + line.amount, 0);

    expect(revenueSum).toBeCloseTo(account.monthlyRevenue, 2);
    expect(expenseSum).toBeCloseTo(account.monthlyExpenses, 2);
    expect(budget.balance).toBeCloseTo(account.monthlyBalance, 2);
  });

  it('la voce Difesa corrisponde alla quota del PIL dichiarata dal conto', () => {
    const account = accountFor([{ type: 'army', level: 6 }]);
    const budget = nationalBudgetDetail(account);
    const defence = budget.expense.find((line) => line.id === 'defence');
    expect(defence).toBeDefined();
    const expected = account.nominalGdpUsdBillions * (account.defenceBurdenPct / 100) / 12;
    expect(defence!.amount).toBeCloseTo(expected, 2);
    expect(budget.defenceBurdenPct).toBeCloseTo(account.defenceBurdenPct, 1);
  });

  it('più fabbriche spostano le entrate verso imprese e produzione', () => {
    const poor = nationalBudgetDetail(accountFor());
    const industrial = nationalBudgetDetail(accountFor([
      { type: 'factory', level: 6 }, { type: 'port', level: 3 },
    ]));
    const share = (budget: ReturnType<typeof nationalBudgetDetail>, id: string) =>
      budget.revenue.find((line) => line.id === id)?.sharePct ?? 0;
    expect(share(industrial, 'corporateTax')).toBeGreaterThan(share(poor, 'corporateTax'));
    expect(share(industrial, 'tradeDuties')).toBeGreaterThanOrEqual(share(poor, 'tradeDuties'));
  });

  it('espone aliquota effettiva e peso sociale in percentuale del PIL', () => {
    const budget = nationalBudgetDetail(accountFor([{ type: 'university', level: 2 }]));
    expect(budget.effectiveTaxRatePct).toBeGreaterThan(0);
    expect(budget.socialBurdenPct).toBeGreaterThan(0);
    expect(budget.educationBurdenPct).toBeGreaterThan(0);
  });

  it('allocateBudget conserva il totale anche con pesi tutti nulli', () => {
    const lines = allocateBudget(10, [
      { id: 'a', label: 'A', weight: 0 },
      { id: 'b', label: 'B', weight: 0 },
      { id: 'c', label: 'C', weight: 0 },
    ]);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(10, 2);
    expect(lines).toHaveLength(3);
  });

  it('un conto assente non produce voci inventate', () => {
    const budget = nationalBudgetDetail(null);
    expect(budget.revenueTotal).toBe(0);
    expect(budget.expenseTotal).toBe(0);
    expect(budget.balance).toBe(0);
    expect(budget.revenue.every((line) => line.amount === 0)).toBe(true);
  });
});
