/**
 * World Story — COUNTRY-CLARITY: scheda Economia
 * =============================================
 * Mette in fila, nello stesso ordine in cui un governo ragiona — dimensione
 * dell'economia → flusso dello Stato → liquidità → debito → costo del debito →
 * trend — i numeri che il motore pubblica già.
 *
 * Diagnosi in una riga, deterministica: avanzo o disavanzo, quanto pesa e che
 * conseguenza ha sul debito. Nessun testo generato da un modello.
 */
import { formatPercent } from '../../utils/format';
import { money } from './NationDock/format';
import type { NationAccount, NationResources, HistoryPoint } from './NationDock/types';
import type { NationalBudgetDetail } from '../../services/api';
import type { Tone } from './NationDock/types';
import { autonomyMonths, finiteOrNull, round1, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

export interface EconomyMetric {
  id: string;
  label: string;
  value: number | null;
  format: 'mld' | 'pct' | 'months' | 'number';
  tone: Tone;
  hint?: string;
}

export interface EconomyDiagnosis {
  tone: DriverTone;
  /** Titolo breve in maiuscoletto: «DISAVANZO PERSISTENTE». */
  title: string;
  /** Conseguenza in una frase, con le cifre del motore. */
  detail: string;
}

export interface EconomyPicture extends DomainStatus {
  metrics: EconomyMetric[];
  diagnosis: EconomyDiagnosis;
  /** Saldo mensile (entrate − uscite), `null` se il conto non è pubblicato. */
  balance: number | null;
  /** Quanto pesa il disavanzo sulle uscite, in %. */
  deficitPctOfExpense: number | null;
  /** Mesi di spesa coperti dalla cassa. */
  treasuryMonths: number | null;
  /** Rapporto debito/PIL usato per la diagnosi. */
  debtRatioPct: number | null;
  /** Interessi annui in % delle entrate annue. */
  debtServicePct: number | null;
}

export interface EconomyInput {
  account?: Partial<NationAccount> | null;
  budget?: Partial<NationalBudgetDetail> | null;
  resources?: Partial<NationResources> | null;
  history?: HistoryPoint[];
  /** Peso degli interessi sulle entrate già calcolato dal governo, se c'è. */
  debtServicePct?: number | null;
}

const mld = (value: number | null): string => (value === null ? '—' : money(value, 2, { sign: true }));

/** Variazione fra l'ultimo punto di storico e il precedente, se ci sono. */
function historyTrend(history: HistoryPoint[] | undefined, pick: (account: any) => unknown): { delta: number; tone: Tone } | null {
  if (!Array.isArray(history) || history.length < 2) return null;
  const last = finiteOrNull(pick(history[history.length - 1].account));
  const prev = finiteOrNull(pick(history[history.length - 2].account));
  if (last === null || prev === null) return null;
  const delta = last - prev;
  if (delta === 0) return { delta, tone: 'neutral' };
  return { delta, tone: delta > 0 ? 'positive' : 'negative' };
}

export function economyOperatingPicture(input: EconomyInput): EconomyPicture {
  const { account, budget, resources, history } = input;

  const revenue = finiteOrNull(account?.monthlyRevenue);
  const expenses = finiteOrNull(account?.monthlyExpenses);
  const balance = finiteOrNull(account?.monthlyBalance) ?? (revenue !== null && expenses !== null ? round1(revenue - expenses) : null);
  const growthPct = finiteOrNull(account?.annualGrowthRate);
  const gdp = finiteOrNull(account?.nominalGdpUsdBillions);
  const treasury = finiteOrNull(resources?.money) ?? finiteOrNull(account?.money);
  const debt = finiteOrNull(resources?.debt);
  const debtRatioPct = finiteOrNull(resources?.debtRatioPct);
  const annualInterest = finiteOrNull(resources?.annualInterest);
  const creditHeadroom = finiteOrNull(resources?.creditHeadroom);
  const marketRatePct = finiteOrNull(resources?.marketRatePct);
  // Il peso degli interessi arriva dal governo (`debt.servicePct`) quando c'è;
  // altrimenti si legge dal conto (`debtServicePct`) o si deriva dagli interessi.
  const debtServicePct = finiteOrNull(input.debtServicePct)
    ?? finiteOrNull(account?.debtServicePct)
    ?? (annualInterest !== null && revenue !== null && revenue > 0 ? round1(annualInterest / (revenue * 12) * 100) : null);
  const treasuryReading = autonomyMonths(treasury, balance === null ? null : -balance, 24);
  const treasuryMonths = treasury !== null && expenses !== null && expenses > 0 ? round1(treasury / expenses) : null;
  const deficitPctOfExpense = balance !== null && expenses !== null && expenses > 0 ? round1(Math.abs(balance) / expenses * 100) : null;

  const balanceTrend = historyTrend(history, (point) => point?.monthlyBalance);
  const debtTrend = historyTrend(history, (point) => point?.debt);
  const treasuryTrend = historyTrend(history, (point) => point?.money);

  const drivers: DomainDriver[] = [];
  if (balance === null) {
    drivers.push({ tone: 'neutral', label: 'Bilancio non pubblicato', detail: 'Questo scenario non espone ancora entrate e uscite mensili.' });
  } else if (balance < 0) {
    drivers.push({
      tone: deficitPctOfExpense !== null && deficitPctOfExpense >= 10 ? 'critical' : 'warning',
      label: `Disavanzo ${mld(balance)} al mese`,
      detail: expenses !== null ? `Le uscite superano le entrate del ${formatPercent(deficitPctOfExpense ?? 0, 0)}.` : undefined,
    });
  } else {
    drivers.push({ tone: 'positive', label: `Avanzo ${mld(balance)} al mese`, detail: 'Le entrate coprono le uscite.' });
  }

  if (debtRatioPct !== null && (debt ?? 0) > 0) {
    drivers.push({
      tone: debtRatioPct >= 120 ? 'critical' : debtRatioPct >= 80 ? 'warning' : 'neutral',
      label: `Debito al ${formatPercent(debtRatioPct, 0)} del PIL`,
      detail: `${money(debt, 0)} in essere${creditHeadroom !== null ? `, ${money(creditHeadroom, 0)} di credito residuo` : ''}`
        + (debtTrend ? ` · ${debtTrend.delta > 0 ? 'in aumento' : debtTrend.delta < 0 ? 'in calo' : 'stabile'} rispetto al turno precedente.` : '.'),
    });
  } else if (debt === 0) {
    drivers.push({ tone: 'positive', label: 'Nessun debito pubblico', detail: 'Il paese può ancora indebitarsi a basso costo.' });
  }

  if (debtServicePct !== null && annualInterest !== null && debtServicePct >= 8) {
    drivers.push({
      tone: debtServicePct >= 20 ? 'critical' : 'warning',
      label: `Interessi ${money(annualInterest, 1)}/anno`,
      detail: `Pari al ${formatPercent(debtServicePct, 1)} delle entrate annue.`,
    });
  }

  if (treasury !== null && treasury < 0) {
    drivers.push({ tone: 'critical', label: 'Cassa negativa', detail: `Scoperto di ${money(Math.abs(treasury), 2)}: è debito, non una riserva.` });
  } else if (treasuryMonths !== null && treasuryMonths < 1) {
    drivers.push({ tone: 'warning', label: 'Cassa sotto il mese di spesa', detail: `La tesoreria copre ${treasuryMonths} mesi di uscite.` });
  } else if (treasuryMonths !== null) {
    drivers.push({
      tone: 'positive',
      label: `Cassa: ${treasuryMonths} mesi di spesa`,
      detail: `Riserva di ${money(treasury ?? 0, 2)}`
        + (treasuryTrend ? `, ${treasuryTrend.delta > 0 ? 'in aumento' : treasuryTrend.delta < 0 ? 'in calo' : 'stabile'}.` : '.'),
    });
  }

  if (growthPct !== null) {
    drivers.push({
      tone: growthPct >= 1.5 ? 'positive' : growthPct >= 0 ? 'neutral' : 'warning',
      label: `Crescita ${formatPercent(growthPct, 1)} all'anno`,
      detail: balanceTrend ? `Saldo ${balanceTrend.delta >= 0 ? 'in miglioramento' : 'in peggioramento'} rispetto al turno precedente.` : undefined,
    });
  }

  // Stato: il peggiore fra tenuta del bilancio, debito e costo del debito.
  let status: EconomyPicture['status'] = 'stable';
  if (balance === null) {
    status = 'pressure';
  } else if (balance >= 0 && (debtRatioPct === null || debtRatioPct < 60)) {
    status = (growthPct ?? 0) > 0 ? 'healthy' : 'stable';
  }
  if (balance !== null && balance < 0) {
    status = (deficitPctOfExpense ?? 0) >= 15 ? 'fragile' : 'pressure';
  }
  if (debtRatioPct !== null && debtRatioPct >= 100 && status !== 'fragile') status = 'fragile';
  if (debtRatioPct !== null && debtRatioPct >= 150) status = 'critical';
  if (debtServicePct !== null && debtServicePct >= 25) status = 'critical';
  if (treasury !== null && treasury < 0 && balance !== null && balance < 0) status = 'critical';

  const headline = balance === null
    ? 'Il conto nazionale non è pubblicato per questa partita.'
    : balance >= 0
      ? `Lo Stato incassa ${mld(balance)} più di quanto spende ogni mese.`
      : `Lo Stato spende ${money(Math.abs(balance), 2)} più di quanto incassa ogni mese.`;

  const diagnosis: EconomyDiagnosis = balance === null
    ? { tone: 'neutral', title: 'BILANCIO NON DISPONIBILE', detail: 'Il motore non pubblica entrate e uscite: nessuna diagnosi possibile.' }
    : balance < 0
      ? {
        tone: (deficitPctOfExpense ?? 0) >= 10 ? 'warning' : 'neutral',
        title: 'DISAVANZO PERSISTENTE',
        detail: `La spesa supera le entrate di ${money(Math.abs(balance), 2)} al mese. `
          + (debt !== null && debt > 0
            ? `Il debito cresce quindi di circa ${money(Math.abs(balance), 1)} al mese.`
            : `La cassa scende di ${money(Math.abs(balance), 1)} al mese.`)
          + (debtServicePct !== null && debtServicePct >= 8 ? ` Gli interessi assorbono già il ${formatPercent(debtServicePct, 1)} delle entrate.` : ''),
      }
      : {
        tone: 'positive',
        title: 'AVANZO',
        detail: `Le entrate superano le uscite di ${money(Math.abs(balance), 2)} al mese. `
          + (debt !== null && debt > 0 ? 'Il debito può quindi essere ridotto invece di crescere.' : 'Il paese non ha bisogno di nuovo debito per chiudere i conti.'),
      };

  const metrics: EconomyMetric[] = [
    { id: 'gdp', label: 'PIL', value: gdp, format: 'mld', tone: 'neutral', hint: 'Prodotto interno lordo pubblicato dal motore' },
    { id: 'growth', label: 'Crescita', value: growthPct, format: 'pct', tone: growthPct === null ? 'neutral' : growthPct >= 0 ? 'positive' : 'negative', hint: 'Tasso annuo' },
    { id: 'revenue', label: 'Entrate', value: revenue, format: 'mld', tone: 'positive', hint: 'Al mese' },
    { id: 'expenses', label: 'Spese', value: expenses, format: 'mld', tone: 'neutral', hint: 'Al mese' },
    { id: 'balance', label: 'Saldo', value: balance, format: 'mld', tone: balance === null ? 'neutral' : balance >= 0 ? 'positive' : 'negative', hint: 'Entrate meno uscite' },
    { id: 'treasury', label: 'Cassa', value: treasury, format: 'mld', tone: treasury === null ? 'neutral' : treasury >= 0 ? 'positive' : 'negative', hint: treasuryReading.text === 'dato non disponibile' ? undefined : `Autonomia ${treasuryReading.text}` },
    { id: 'debt', label: 'Debito', value: debt, format: 'mld', tone: debt === null ? 'neutral' : debt > 0 ? 'warning' : 'positive', hint: 'Titoli emessi più scoperto' },
    { id: 'debtRatio', label: 'Debito / PIL', value: debtRatioPct, format: 'pct', tone: debtRatioPct === null ? 'neutral' : debtRatioPct >= 100 ? 'negative' : debtRatioPct >= 60 ? 'warning' : 'positive' },
    { id: 'interest', label: 'Interessi', value: annualInterest, format: 'mld', tone: annualInterest === null ? 'neutral' : annualInterest > 0 ? 'warning' : 'positive', hint: 'All’anno' },
    { id: 'debtService', label: 'Servizio debito', value: debtServicePct, format: 'pct', tone: debtServicePct === null ? 'neutral' : debtServicePct >= 20 ? 'negative' : debtServicePct >= 8 ? 'warning' : 'positive', hint: 'Quota delle entrate' },
    { id: 'credit', label: 'Credito residuo', value: creditHeadroom, format: 'mld', tone: creditHeadroom === null ? 'neutral' : creditHeadroom > 0 ? 'positive' : 'negative', hint: 'Spazio per nuove spese a debito' },
    { id: 'rate', label: 'Tasso di mercato', value: marketRatePct, format: 'pct', tone: marketRatePct === null ? 'neutral' : marketRatePct >= 8 ? 'negative' : marketRatePct >= 4 ? 'warning' : 'positive', hint: 'Nuova emissione a 10 anni' },
  ];

  // Il budget del governo serve solo a confermare i totali: se c'è ed è
  // pubblicato, il Dossier mostra le voci nella sua scheda dedicata.
  const budgetLineCount = (budget?.revenue?.length ?? 0) + (budget?.expense?.length ?? 0);
  if (budgetLineCount > 0) {
    drivers.push({
      tone: 'neutral',
      label: `${budgetLineCount} voci di bilancio pubblicate`,
      detail: `Pressione fiscale effettiva ${formatPercent(finiteOrNull(budget?.effectiveTaxRatePct) ?? 0, 1)}.`,
    });
  }

  return {
    status,
    headline,
    drivers,
    metrics,
    diagnosis,
    balance,
    deficitPctOfExpense,
    treasuryMonths,
    debtRatioPct,
    debtServicePct,
  };
}
