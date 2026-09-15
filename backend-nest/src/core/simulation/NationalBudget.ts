/**
 * World Story — Dettaglio del bilancio nazionale
 * ==============================================
 * Il conto nazionale pubblica entrate e uscite mensili come **totali**. Perché
 * il giocatore capisca *come sta andando la nazione* servono le voci: quanto
 * pesa la difesa, l'istruzione, il welfare, le imposte.
 *
 * Questo modulo non inventa un secondo bilancio: **ripartisce** i totali
 * pubblicati da `WorldStateEngine` (o dal loro overlay) sulle singole voci,
 * usando come pesi le grandezze reali già presenti nel conto (fabbriche, porti,
 * università, riserve, popolazione). La somma delle voci è sempre uguale al
 * totale, al centesimo: nessuna cifra nuova, solo lettura leggibile di quelle
 * esistenti.
 *
 * La difesa è l'unica voce **esatta**: il conto dichiara già la quota del PIL
 * (`defenceBurdenPct`), quindi la riga Difesa è calcolata da quella, non da un
 * peso arbitrario.
 */

import type { NationalAccount } from './WorldStateEngine';

export interface BudgetLine {
  id: string;
  label: string;
  /** Importo mensile in miliardi di USD. */
  amount: number;
  /** Quota sul totale della voce (0-100). */
  sharePct: number;
}

export interface NationalBudgetDetail {
  currency: 'mld';
  revenue: BudgetLine[];
  expense: BudgetLine[];
  revenueTotal: number;
  expenseTotal: number;
  balance: number;
  /** Aliquota effettiva implicita (entrate annue / PIL), in percentuale. */
  effectiveTaxRatePct: number;
  /** Spesa militare in percentuale del PIL (quota dichiarata dal conto). */
  defenceBurdenPct: number;
  /** Spesa sociale (sanità + sostegno) in percentuale del PIL. */
  socialBurdenPct: number;
  /** Spesa per istruzione e ricerca in percentuale del PIL. */
  educationBurdenPct: number;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const nonNegative = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

interface Weight {
  id: string;
  label: string;
  weight: number;
}

/**
 * Ripartisce un totale su voci pesate con il metodo del resto maggiore:
 * arrotondamento e correzione sul resto più alto, così la somma torna esatta.
 */
export function allocateBudget(total: number, weights: Weight[], decimals = 2): BudgetLine[] {
  const safeTotal = nonNegative(total);
  if (weights.length === 0) return [];
  const safeWeights = weights.map((entry) => Math.max(0, nonNegative(entry.weight)));
  const weightSum = safeWeights.reduce((sum, value) => sum + value, 0);
  const factor = 10 ** decimals;
  const exact = safeWeights.map((value) =>
    safeTotal * (weightSum > 0 ? value / weightSum : 1 / weights.length));
  const amounts = exact.map((value) => Math.round(value * factor) / factor);
  // Correzione del resto: si sposta il residuo (positivo o negativo) sulle voci
  // con la parte frazionaria maggiore, una unità minima per volta.
  let diff = Math.round((safeTotal - amounts.reduce((sum, value) => sum + value, 0)) * factor);
  const order = exact
    .map((value, index) => ({ index, remainder: value * factor - Math.floor(value * factor) }))
    .sort((a, b) => b.remainder - a.remainder);
  let guard = 0;
  while (diff !== 0 && order.length > 0 && guard < factor * 10) {
    const step = diff > 0 ? 1 : -1;
    const target = order[guard % order.length].index;
    if (step > 0 || amounts[target] > 0) {
      amounts[target] = round(amounts[target] + step / factor, decimals);
      diff -= step;
    }
    guard++;
  }
  return weights.map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    amount: round(amounts[index], decimals),
    sharePct: safeTotal > 0 ? round((amounts[index] / safeTotal) * 100, 1) : 0,
  }));
}

const line = (id: string, label: string, amount: number, total: number): BudgetLine => ({
  id,
  label,
  amount: round(nonNegative(amount), 2),
  sharePct: total > 0 ? round((nonNegative(amount) / total) * 100, 1) : 0,
});

/**
 * Dettaglio del bilancio a partire dal conto nazionale pubblicato dal motore.
 * Deterministico: stesso conto ⇒ stesso dettaglio.
 */
export function nationalBudgetDetail(account?: NationalAccount | null): NationalBudgetDetail {
  const revenueTotal = round(nonNegative(account?.monthlyRevenue), 3);
  const expenseTotal = round(nonNegative(account?.monthlyExpenses), 3);
  const gdp = nonNegative(account?.nominalGdpUsdBillions);
  const factories = nonNegative(account?.factories);
  const ports = nonNegative(account?.ports);
  const universities = nonNegative(account?.universities);
  const mobilized = nonNegative(account?.mobilized);
  const population = nonNegative(account?.population);
  const populationM = population / 1_000_000;
  const defenceBurdenPct = nonNegative(account?.defenceBurdenPct);

  const revenueWeights: Weight[] = [
    { id: 'incomeTax', label: 'Imposta sul reddito', weight: 40 },
    { id: 'corporateTax', label: 'Imposte su imprese e produzione', weight: 14 + factories * 2.4 },
    { id: 'tradeDuties', label: 'Dazi e commercio estero', weight: 8 + ports * 2.8 },
    { id: 'resourceRoyalties', label: 'Royalties e concessioni', weight: 4 + (ports + factories) * 1.1 },
    { id: 'otherRevenue', label: 'Altre entrate', weight: 10 },
  ];
  const revenue = allocateBudget(revenueTotal, revenueWeights).sort((a, b) => b.amount - a.amount);

  // Difesa: voce esatta dalla quota del PIL dichiarata dal conto. Il resto delle
  // uscite si ripartisce sulle funzioni civili.
  const defence = Math.min(expenseTotal, round((gdp * defenceBurdenPct) / 100 / 12, 3));
  const civilTotal = round(expenseTotal - defence, 3);
  const civilWeights: Weight[] = [
    { id: 'administration', label: 'Amministrazione pubblica', weight: 26 },
    { id: 'education', label: 'Istruzione e ricerca', weight: 10 + universities * 2.6 },
    { id: 'health', label: 'Sanità e assistenza', weight: 16 + Math.sqrt(Math.max(0, populationM)) * 4 },
    { id: 'infrastructure', label: 'Infrastrutture e trasporti', weight: 10 + ports * 2.2 + factories * 1.4 },
    { id: 'social', label: 'Sostegno sociale e lavoro', weight: 12 + mobilized * 1.5 },
    { id: 'otherExpense', label: 'Altre uscite', weight: 8 },
  ];
  const civil = allocateBudget(civilTotal, civilWeights);
  const expense: BudgetLine[] = [line('defence', 'Difesa', defence, expenseTotal), ...civil]
    .sort((a, b) => b.amount - a.amount);

  const burden = (id: string) => (gdp > 0
    ? round(((expense.find((entry) => entry.id === id)?.amount ?? 0) * 12 / gdp) * 100, 1)
    : 0);
  const healthShare = expense.find((entry) => entry.id === 'health')?.amount ?? 0;
  const socialShare = expense.find((entry) => entry.id === 'social')?.amount ?? 0;

  return {
    currency: 'mld',
    revenue,
    expense,
    revenueTotal: round(revenue.reduce((sum, entry) => sum + entry.amount, 0), 2),
    expenseTotal: round(expense.reduce((sum, entry) => sum + entry.amount, 0), 2),
    balance: round(revenueTotal - expenseTotal, 3),
    effectiveTaxRatePct: gdp > 0 ? round((revenueTotal * 12 / gdp) * 100, 1) : 0,
    defenceBurdenPct: round(defenceBurdenPct, 1),
    socialBurdenPct: gdp > 0 ? round(((healthShare + socialShare) * 12 / gdp) * 100, 1) : 0,
    educationBurdenPct: burden('education'),
  };
}
