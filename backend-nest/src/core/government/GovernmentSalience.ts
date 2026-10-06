/** Pure salience policy: snapshots remain readable; only actionable facts become agenda. */
import type { Figure, GovernmentAgendaInput, VoiceUrgency } from './GovernmentAgenda';
import { formatGovernmentNumber, governmentFigureValue } from './GovernmentNumberFormat';

/** Unknown inputs stay unknown: absence is not zero, peace, or a baseline. */
export interface GovernmentSalienceContext {
  readinessPct?: number | null;
  /** Initial profile estimate, only while the canonical fingerprint is unchanged. Never a crisis trigger. */
  initialReadinessEstimate?: boolean;
  /** Weakest live unit, diagnostic detail only: the national figure is `readinessPct` (personnel-weighted). */
  minReadinessPct?: number | null;
  cashRunwayMonths?: number | null;
  hostileRelations?: number;
  activeConflicts?: number;
  ongoingMilitaryOrders?: number;
  supplyCoverageMonths?: number | null;
  previous?: {
    balancePct?: number;
    debtServicePct?: number;
    readinessPct?: number | null;
    forces?: number;
    mobilized?: number;
    stability?: number;
    socialTension?: number;
  };
}

/**
 * Policy thresholds, not claimed engine laws:
 * - Balance is MONTHLY balance / ANNUAL nominal GDP * 100, never annualized here.
 *   ±0.3 is routine; <= -1 is severe (<= -2 critical); >= 1 is investible only
 *   alongside a candidate whose caller-supplied cash/material requirements are covered.
 *   A 0.75 pp balance change, 5 pp interest/revenue change or cash runway < 3
 *   months warrants review. The latter is critical even with a modest deficit.
 * - Interest/revenue >= 15% is material, >= 25% critical; debt/GDP alone is not.
 * - Readiness <= 50% (<= 35 critical), explicit threat/conflict/orders, supply < 1
 *   month, or >= 1000 mobilized warrant review. Standing forces or budget never do.
 *   `readinessPct` is the personnel-weighted MEASURED national readiness:
 *   a single weak unit does not define the country, and the initial profile
 *   estimate (`initialReadinessEstimate`) never triggers a crisis on its own.
 *   Observed readiness changes >= 10 pp, forces >= 20% AND >= 1 formation, and
 *   mobilization changes >= 1000 are meaningful in either direction. A formation
 *   is not a soldier: requiring 100 would hide severe losses in small countries.
 *   An explicit zero baseline uses the one-formation floor (no division by zero).
 * - Social tension >= 65, stability <= 40, or observed changes >= 15 points
 *   justify civilian review, not a diagnosis of inadequate sector budgets.
 */
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const fmt = (value: number) => formatGovernmentNumber(value, 'ratio');
const fact = (label: string, value: number, unit: string, source: string): Figure => ({
  label, value: governmentFigureValue(value, unit === 'uomini' || unit === 'reparti' || unit === 'conteggio' ? 'integer' : 'ratio'),
  unit, basis: { kind: 'measured', source },
});

interface Condition {
  readonly because: string;
  readonly figures: readonly Figure[];
  readonly urgency: VoiceUrgency;
  /** Treasury review was driven by cash runway alone, not a debt-service change. */
  readonly cashRunwayOnly?: boolean;
}
interface DefenceCondition extends Condition {
  readonly priority: 'readiness' | 'threat' | 'operations' | 'mobilization' | 'change';
  readonly need: string;
}

function delta(current: number | null | undefined, previous: number | null | undefined, minimum: number): boolean {
  return finite(current) && finite(previous) && Math.abs(current - previous) >= minimum;
}

/** No I/O, dates, random numbers, mutation, country identities, or inferred baselines. */
export function evaluateGovernmentSalience(input: GovernmentAgendaInput): {
  treasury?: Condition;
  defence?: DefenceCondition;
  education?: Condition;
  health?: Condition;
  investmentCandidates: GovernmentAgendaInput['buildable'];
} {
  const context = input.salience;
  const previous = context?.previous;
  const flow = input.cashFlow;
  const covered = flow && finite(flow.balancePct) && flow.balancePct >= 1
    ? input.buildable.filter(work => work.missing.length === 0) : [];
  const fiscalReasons: string[] = [];
  const fiscalFigures: Figure[] = [];
  if (flow && finite(flow.balancePct) && flow.balancePct <= -1) {
    fiscalReasons.push('Il saldo mensile sul PIL nominale annuo supera la soglia di disavanzo rilevante (-1%).');
  }
  if (covered.length > 0) {
    fiscalReasons.push(`L’avanzo mensile sul PIL nominale annuo supera la soglia dell’1% e la distinta è coperta per: ${covered.map(w => w.name).join(', ')}; occorre ancora il preflight prima di impegnare.`);
  }
  if (finite(context?.cashRunwayMonths) && context.cashRunwayMonths < 3) {
    fiscalReasons.push(`La cassa copre ${fmt(context.cashRunwayMonths)} mesi del disavanzo mensile: meno di tre mesi di margine.`);
  }
  if (finite(input.debt.servicePct) && input.debt.servicePct >= 15) {
    fiscalReasons.push('Gli interessi assorbono almeno il 15% delle entrate: una sola scelta fiscale, non due voci duplicate.');
  }
  if (delta(flow?.balancePct, previous?.balancePct, 0.75)) {
    fiscalReasons.push(`Il saldo mensile/PIL annuo è passato dal ${fmt(previous!.balancePct!)}% precedente al ${fmt(flow!.balancePct)}% attuale (variazione di almeno 0,75 punti).`);
    fiscalFigures.push(fact('Saldo su PIL precedente', previous!.balancePct!, '% mensile/PIL annuo', 'salience.previous.balancePct'));
  }
  if (delta(input.debt.servicePct, previous?.debtServicePct, 5)) {
    fiscalReasons.push(`Il servizio del debito è passato dal ${fmt(previous!.debtServicePct!)}% precedente al ${fmt(input.debt.servicePct)}% attuale delle entrate (variazione di almeno 5 punti).`);
    fiscalFigures.push(fact('Interessi su entrate precedenti', previous!.debtServicePct!, '%', 'salience.previous.debtServicePct'));
  }
  const runwayTriggered = finite(context?.cashRunwayMonths) && context.cashRunwayMonths < 3;
  const otherFiscalTrigger = Boolean((flow && finite(flow.balancePct) && flow.balancePct <= -1) || covered.length > 0
    || (finite(input.debt.servicePct) && input.debt.servicePct >= 15)
    || delta(flow?.balancePct, previous?.balancePct, 0.75) || delta(input.debt.servicePct, previous?.debtServicePct, 5));
  const treasury: Condition | undefined = fiscalReasons.length > 0 ? {
    because: fiscalReasons.join(' '), figures: fiscalFigures,
    cashRunwayOnly: runwayTriggered && !otherFiscalTrigger,
    urgency: input.debt.servicePct >= 25 || (flow && flow.balancePct <= -2)
      || runwayTriggered ? 'critica' : 'urgente',
  } : undefined;

  const militaryReasons: string[] = [];
  const militaryFigures: Figure[] = [];
  let priority: DefenceCondition['priority'] = 'change';
  let urgency: VoiceUrgency = 'urgente';
  if (finite(context?.readinessPct) && context.readinessPct <= 50 && !context.initialReadinessEstimate) {
    priority = 'readiness';
    militaryReasons.push(`La prontezza operativa delle forze è ${fmt(context.readinessPct)}%, sotto la soglia operativa di revisione del 50%.`);
    militaryFigures.push(fact('Prontezza', context.readinessPct, '%', 'salience.readinessPct'));
    if (finite(context.minReadinessPct) && context.minReadinessPct < context.readinessPct - 10) {
      militaryReasons.push(`Alcuni reparti risultano sotto la soglia operativa (${fmt(context.minReadinessPct)}%).`);
    }
    if (context.readinessPct <= 35) urgency = 'critica';
  }
  if (finite(context?.activeConflicts) && context.activeConflicts > 0) {
    if (priority !== 'readiness') priority = 'threat';
    urgency = 'critica';
    militaryReasons.push(`Sono registrati ${fmt(context.activeConflicts)} conflitti attivi.`);
    militaryFigures.push(fact('Conflitti attivi', context.activeConflicts, 'conteggio', 'salience.activeConflicts'));
  }
  if (finite(context?.hostileRelations) && context.hostileRelations > 0) {
    if (priority !== 'readiness') priority = 'threat';
    militaryReasons.push(`Sono registrate ${fmt(context.hostileRelations)} relazioni ostili: una minaccia documentata, non un conflitto presunto.`);
    militaryFigures.push(fact('Relazioni ostili', context.hostileRelations, 'conteggio', 'salience.hostileRelations'));
  }
  if (finite(context?.ongoingMilitaryOrders) && context.ongoingMilitaryOrders > 0) {
    if (priority === 'change') priority = 'operations';
    militaryReasons.push(`Sono in corso ${fmt(context.ongoingMilitaryOrders)} ordini militari effettivi.`);
    militaryFigures.push(fact('Ordini militari in corso', context.ongoingMilitaryOrders, 'conteggio', 'salience.ongoingMilitaryOrders'));
  }
  if (finite(context?.supplyCoverageMonths) && context.supplyCoverageMonths < 1) {
    if (priority === 'change') priority = 'operations';
    urgency = 'critica';
    militaryReasons.push(`La copertura dei rifornimenti è ${fmt(context.supplyCoverageMonths)} mesi, inferiore a un mese.`);
    militaryFigures.push(fact('Copertura rifornimenti', context.supplyCoverageMonths, 'mesi', 'salience.supplyCoverageMonths'));
  }
  if (finite(input.defence?.mobilized) && input.defence.mobilized >= 1000) {
    if (priority === 'change') priority = 'mobilization';
    militaryReasons.push(`La mobilitazione osservata coinvolge ${fmt(input.defence.mobilized)} uomini (soglia di revisione: 1000).`);
  }
  const forceChange = delta(input.defence?.forces, previous?.forces, 1)
    && finite(previous?.forces) && previous.forces >= 0
    && (previous.forces === 0 || Math.abs(input.defence!.forces - previous.forces) / previous.forces >= 0.2);
  for (const change of [
    { changed: delta(context?.readinessPct, previous?.readinessPct, 10), current: context?.readinessPct, previous: previous?.readinessPct, label: 'Prontezza', unit: '%', key: 'readinessPct' },
    { changed: forceChange, current: input.defence?.forces, previous: previous?.forces, label: 'Reparti in forza', unit: 'reparti', key: 'forces' },
    { changed: delta(input.defence?.mobilized, previous?.mobilized, 1000), current: input.defence?.mobilized, previous: previous?.mobilized, label: 'Mobilitati', unit: 'uomini', key: 'mobilized' },
  ]) {
    if (!change.changed) continue;
    militaryReasons.push(`${change.label}: dal valore precedente ${fmt(change.previous!)} al valore attuale ${fmt(change.current!)} ${change.unit}; variazione significativa osservata.`);
    militaryFigures.push(fact(`${change.label} precedente`, change.previous!, change.unit, `salience.previous.${change.key}`));
    // Readiness is not part of the national-account figures emitted by Agenda.
    if (change.key === 'readinessPct' && !militaryFigures.some(f => f.label === 'Prontezza')) {
      militaryFigures.push(fact('Prontezza', change.current!, '%', 'salience.readinessPct'));
    }
  }
  const defence: DefenceCondition | undefined = militaryReasons.length > 0 ? {
    priority, urgency, figures: militaryFigures, because: militaryReasons.join(' '),
    need: {
      readiness: 'La prontezza militare richiede una verifica operativa',
      threat: 'Una minaccia documentata richiede una scelta di postura',
      operations: 'Le operazioni e i rifornimenti militari richiedono una verifica',
      mobilization: 'La mobilitazione richiede una scelta di sostenibilità',
      change: 'Lo strumento militare è cambiato significativamente: rivedere la postura',
    }[priority],
  } : undefined;

  const civilian = (current: number | undefined, baseline: number | undefined, label: string, key: string, stressed: boolean): Condition | undefined => {
    if (!finite(current)) return undefined;
    const changed = delta(current, baseline, 15);
    if (!stressed && !changed) return undefined;
    return {
      because: `${label} osservata: ${fmt(current)}/100.${changed ? ` Dal valore precedente ${fmt(baseline!)}: variazione di almeno 15 punti.` : ' Superata la soglia di revisione sociale.'} La quota di spesa stimata non dimostra da sola la causa né l’effetto di un intervento.`,
      urgency: 'urgente',
      figures: changed ? [fact(`${label} precedente`, baseline!, '/100', `salience.previous.${key}`)] : [],
    };
  };
  return {
    treasury, defence, investmentCandidates: covered,
    education: civilian(input.education?.socialTension, previous?.socialTension, 'Tensione sociale', 'socialTension',
      finite(input.education?.socialTension) && input.education.socialTension >= 65),
    health: civilian(input.health?.stability, previous?.stability, 'Stabilità', 'stability',
      finite(input.health?.stability) && input.health.stability <= 40),
  };
}
