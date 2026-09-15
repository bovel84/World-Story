/**
 * World Story — Lettura del governo e del bilancio (frontend, puro)
 * ================================================================
 * Funzioni di sola presentazione: traducono le cifre pubblicate dal motore
 * (conto nazionale + snapshot del governo) in etichette, toni e un giudizio
 * leggibile su «come sta andando la nazione». Nessun valore è stimato qui:
 * il giudizio è una soglia applicata ai numeri del motore, non una cifra nuova.
 */

import type {
  FactionLever,
  FactionStance,
  GovernmentFaction,
  NationalBudgetDetail,
} from '../../services/api';

export type VerdictTone = 'positive' | 'warning' | 'negative' | 'neutral';
export type VerdictLevel = 'solida' | 'equilibrata' | 'fragile' | 'critica';

/** Etichette italiane delle posizioni di una fazione. */
export const STANCE_LABEL: Record<FactionStance, string> = {
  alleato: 'Alleato',
  favorevole: 'Favorevole',
  neutrale: 'Neutrale',
  critico: 'Critico',
  ostile: 'Ostile',
};

export function stanceTone(stance: FactionStance): VerdictTone {
  if (stance === 'alleato' || stance === 'favorevole') return 'positive';
  if (stance === 'neutrale') return 'neutral';
  if (stance === 'critico') return 'warning';
  return 'negative';
}

/** Etichette italiane delle leve che una fazione può spingere. */
export const LEVER_LABEL: Record<FactionLever, string> = {
  difesa: 'Difesa',
  tasse: 'Fisco',
  welfare: 'Welfare',
  istruzione: 'Istruzione e ricerca',
  infrastrutture: 'Infrastrutture',
  debito: 'Conti pubblici',
  ordine: 'Ordine pubblico',
};

/** Tono di soddisfazione di una fazione (0-100). */
export function satisfactionTone(value: number): VerdictTone {
  if (value >= 62) return 'positive';
  if (value >= 45) return 'neutral';
  if (value >= 28) return 'warning';
  return 'negative';
}

/** Tono della pressione politica (0-100): più è alta, più è un problema. */
export function pressureTone(value: number): VerdictTone {
  if (value >= 55) return 'negative';
  if (value >= 35) return 'warning';
  return 'positive';
}

export function pressureLabel(value: number): string {
  if (value >= 70) return 'preme con forza';
  if (value >= 45) return 'preme';
  if (value >= 25) return 'sollecita';
  return 'osserva';
}

/** Giudizio sintetico sullo stato della nazione. */
export interface NationalVerdict {
  level: VerdictLevel;
  tone: VerdictTone;
  title: string;
  detail: string;
  /** Segnali letti dal conto (non inventati). */
  signals: string[];
}

export interface VerdictAccount {
  nominalGdpUsdBillions?: number;
  monthlyRevenue?: number;
  monthlyExpenses?: number;
  monthlyBalance?: number;
  annualGrowthRate?: number;
  stability?: number;
  socialTension?: number;
  defenceBurdenPct?: number;
}

const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const number = (value: unknown): number =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

/**
 * «Come sta andando la nazione»: un giudizio unico che intreccia saldo, debito
 * implicito, crescita, stabilità e tensione. Le soglie sono dichiarate e
 * derivano solo dai numeri del conto nazionale.
 */
export function nationalVerdict(
  account?: VerdictAccount | null,
  budget?: NationalBudgetDetail | null,
): NationalVerdict {
  const gdp = Math.max(0, number(account?.nominalGdpUsdBillions));
  const balance = number(account?.monthlyBalance);
  const revenue = number(account?.monthlyRevenue);
  const expenses = number(account?.monthlyExpenses);
  const growthPct = number(account?.annualGrowthRate) * 100;
  const stability = Math.max(0, Math.min(100, number(account?.stability)));
  const tension = Math.max(0, Math.min(100, number(account?.socialTension)));
  const taxRatePct = budget?.effectiveTaxRatePct ?? (gdp > 0 ? (revenue * 12 / gdp) * 100 : 0);
  const defencePct = budget?.defenceBurdenPct ?? number(account?.defenceBurdenPct);
  // Disavanzo annuo in percentuale del PIL: il saldo è mensile.
  const deficitPct = gdp > 0 ? (balance * 12 / gdp) * 100 : 0;

  const signals: string[] = [];
  signals.push(`Saldo ${balance >= 0 ? 'attivo' : 'passivo'} di ${round(Math.abs(balance), 2)} mld al mese (${round(deficitPct)}% del PIL l'anno)`);
  signals.push(`Pressione fiscale effettiva ${round(taxRatePct)}% del PIL`);
  if (defencePct > 0) signals.push(`Difesa ${round(defencePct)}% del PIL`);
  signals.push(`Crescita annua ${growthPct >= 0 ? '+' : ''}${round(growthPct)}%`);
  signals.push(`Stabilità ${round(stability)}/100 · tensione ${round(tension)}/100`);
  if (expenses > 0 && revenue > 0) {
    signals.push(`Copertura delle uscite con le entrate: ${round((revenue / expenses) * 100)}%`);
  }

  let level: VerdictLevel;
  if (balance < 0 && (deficitPct <= -5 || tension >= 60)) level = 'critica';
  else if (balance < 0 || growthPct < 0 || tension >= 50) level = 'fragile';
  else if (growthPct >= 1.5 && stability >= 55 && tension < 35) level = 'solida';
  else level = 'equilibrata';

  const tone: VerdictTone = level === 'solida' ? 'positive'
    : level === 'equilibrata' ? 'neutral'
      : level === 'fragile' ? 'warning' : 'negative';

  const title = level === 'solida' ? 'Nazione solida'
    : level === 'equilibrata' ? 'Nazione in equilibrio'
      : level === 'fragile' ? 'Nazione fragile'
        : 'Nazione in difficoltà';

  const detail = level === 'solida'
    ? 'Le entrate coprono le uscite, l\'economia cresce e la piazza tiene. È il momento di consolidare.'
    : level === 'equilibrata'
      ? 'I conti tengono ma senza margini ampi: una guerra o una spesa straordinaria possono cambiare il quadro.'
      : level === 'fragile'
        ? 'Il saldo o il consenso vacillano: ogni nuova spesa va motivata e il debito va sorvegliato.'
        : 'Disavanzo e tensione si alimentano a vicenda: senza una correzione il governo rischia il tracollo.';

  return { level, tone, title, detail, signals };
}

/** Tono del saldo mensile (positivo/negativo). */
export function balanceTone(value: number): VerdictTone {
  return value >= 0 ? 'positive' : 'negative';
}

/** Vero se lo snapshot contiene un bilancio pubblicato dal motore. */
export function hasBudgetDetail(detail?: NationalBudgetDetail | null): boolean {
  return !!detail && (detail.revenue.length > 0 || detail.expense.length > 0);
}

/**
 * Trasforma la richiesta di una fazione in una bozza d'ordine concreta.
 * Serve a collegare le anime del governo al ciclo reale degli ordini: la
 * fazione propone, il giocatore decide se portarla in consiglio.
 */
export function factionOrderText(faction: GovernmentFaction): string {
  const direction = faction.demand.direction === 'abbassa'
    ? 'Ridurre'
    : faction.demand.direction === 'alza'
      ? 'Aumentare'
      : 'Mantenere';
  return [
    `${direction} la leva «${LEVER_LABEL[faction.demand.lever]}» su richiesta di ${faction.name}.`,
    `${faction.demand.title}.`,
    faction.demand.detail,
    'Valutare copertura di bilancio, tempi e conseguenze prima di procedere.',
  ].join(' ');
}
