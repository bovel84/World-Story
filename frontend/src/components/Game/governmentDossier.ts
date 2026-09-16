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
  GovernmentSnapshot,
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
 * (rapporto e peso degli interessi), crescita, stabilità e tensione. Le soglie
 * sono dichiarate e derivano solo dai numeri del motore: un avanzo non diventa
 * mai «senza margini», un debito alto non viene ignorato.
 */
export function nationalVerdict(
  account?: VerdictAccount | null,
  budget?: NationalBudgetDetail | null,
  debt?: { ratioPct?: number; servicePct?: number } | null,
): NationalVerdict {
  // Conto assente: nessun giudizio inventato. Si dichiara che i dati non ci
  // sono ancora, senza spacciare l'assenza di informazioni per una crisi.
  if (!account) {
    return {
      level: 'equilibrata',
      tone: 'neutral',
      title: 'Nazione in equilibrio',
      detail: 'Conto nazionale non ancora disponibile: il giudizio arriverà con i primi dati di gioco.',
      signals: ['Nessun dato di bilancio pubblicato dal motore'],
    };
  }
  const gdp = Math.max(0, number(account?.nominalGdpUsdBillions));
  const balance = number(account?.monthlyBalance);
  const growthPct = number(account?.annualGrowthRate) * 100;
  const stability = Math.max(0, Math.min(100, number(account?.stability)));
  const tension = Math.max(0, Math.min(100, number(account?.socialTension)));
  const defencePct = budget?.defenceBurdenPct ?? number(account?.defenceBurdenPct);
  const debtRatio = Math.max(0, number(debt?.ratioPct));
  const debtService = Math.max(0, number(debt?.servicePct));
  // Disavanzo annuo in percentuale del PIL: positivo = disavanzo, negativo = avanzo.
  const deficitPct = gdp > 0 ? (-balance * 12 / gdp) * 100 : 0;

  const signals: string[] = [];
  const fiscalYear = deficitPct > 0.05
    ? `disavanzo ${round(deficitPct)}% del PIL l'anno`
    : deficitPct < -0.05
      ? `avanzo ${round(-deficitPct)}% del PIL l'anno`
      : 'pareggio di bilancio';
  signals.push(`Saldo ${balance >= 0 ? 'attivo' : 'passivo'} di ${round(Math.abs(balance), 2)} mld al mese · ${fiscalYear}`);
  signals.push(`Spesa militare ${round(defencePct)}% del PIL`);
  if (debtRatio > 0) {
    signals.push(`Debito pubblico ${round(debtRatio)}% del PIL${debtService > 0 ? ` · interessi ${round(debtService)}% delle entrate` : ''}`);
  }
  signals.push(`Crescita annua ${growthPct >= 0 ? '+' : ''}${round(growthPct)}%`);
  signals.push(`Stabilità ${round(stability)}/100 · tensione ${round(tension)}/100`);

  let level: VerdictLevel;
  if (deficitPct >= 8 || debtService >= 50 || tension >= 70 || (debtRatio >= 130 && deficitPct > 0)) level = 'critica';
  else if (deficitPct >= 3 || debtRatio >= 100 || debtService >= 30 || stability < 40 || tension >= 55) level = 'fragile';
  else if (deficitPct <= -1 && debtRatio < 60 && stability >= 58 && tension < 35 && growthPct >= 1) level = 'solida';
  else level = 'equilibrata';

  const tone: VerdictTone = level === 'solida' ? 'positive'
    : level === 'equilibrata' ? 'neutral'
      : level === 'fragile' ? 'warning' : 'negative';

  const title = level === 'solida' ? 'Nazione solida'
    : level === 'equilibrata' ? 'Nazione in equilibrio'
      : level === 'fragile' ? 'Nazione fragile'
        : 'Nazione in difficoltà';

  // Il dettaglio nomina la debolezza reale del momento, così non contraddice i
  // segnali (es. un avanzo non viene descritto come «senza margini»).
  const weakness = stability < 55
    ? `la stabilità politica è nella media (${round(stability)}/100) e un evento imprevisto può erodere il consenso`
    : debtRatio >= 60
      ? `il debito è moderato (${round(debtRatio)}% del PIL) e va tenuto sotto controllo`
      : growthPct < 1
        ? `la crescita è lenta (${growthPct >= 0 ? '+' : ''}${round(growthPct)}%)`
        : 'i margini restano contenuti';

  const detail = level === 'solida'
    ? 'Le entrate coprono le uscite, l\'economia cresce, il debito è sotto controllo e la piazza tiene: è il momento di consolidare.'
    : level === 'equilibrata'
      ? `Nessuna crisi aperta, ma ${weakness}.`
      : level === 'fragile'
        ? 'Il saldo o il consenso vacillano: ogni nuova spesa va coperta e il debito sorvegliato.'
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

/** LW04 — presenza del consiglio: chi preme, chi guida, quanto è coeso. */
export interface CouncilPresence {
  tone: VerdictTone;
  /** Frase breve: «Il consiglio preme: coesione 52%, pressione 68%». */
  headline: string;
  /** Chi guida l'agenda e chi è più critico, più la lettura del motore. */
  detail: string;
  dominantName: string | null;
  angriestName: string | null;
  pressureLabel: string;
}

/**
 * Traduce lo snapshot del governo in una riga di presenza politica. Usa solo
 * i campi già calcolati dal motore (coesione, pressione, fazioni); nessuna
 * nuova metrica e nessuna chiamata all'LLM.
 */
export function councilPresence(government?: GovernmentSnapshot | null): CouncilPresence | null {
  if (!government || government.factions.length === 0) return null;
  const dominant = government.factions.find(f => f.id === government.dominantId) ?? null;
  const angriest = government.factions.find(f => f.id === government.angriestId) ?? null;
  const pressure = round(government.pressureIndex);
  const cohesion = round(government.cohesion);
  const parts: string[] = [];
  if (dominant) parts.push(`${dominant.name} guida l'agenda (${round(dominant.powerPct)}% di influenza)`);
  if (angriest && angriest.id !== dominant?.id) parts.push(`${angriest.name} è il più critico`);
  if (government.headline) parts.push(government.headline);
  return {
    tone: pressureTone(government.pressureIndex),
    headline: `Il consiglio ${pressureLabel(government.pressureIndex)}: coesione ${cohesion}%, pressione ${pressure}%`,
    detail: parts.join(' · '),
    dominantName: dominant?.name ?? null,
    angriestName: angriest?.name ?? null,
    pressureLabel: pressureLabel(government.pressureIndex),
  };
}
