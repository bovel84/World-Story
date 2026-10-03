/**
 * WS-GOV-SITUATIONS — Dalla Pressure canonica alla Situazione del Consiglio
 * =========================================================================
 * Il motore ha già un sistema di pressioni di pace (`PeacetimePressures.ts`):
 * sono deterministiche, hanno una finestra di calendario, opzioni con effetti e
 * un costo per l'inerzia, e vengono persistite. Questo modulo NON lo duplica e
 * NON lo sostituisce: ne è il **read model** per la Sala del Consiglio.
 *
 * La catena è quella richiesta dal progetto:
 *
 *   ACTIVE PRESSURE → GOVERNMENT SITUATION → MINISTRO RESPONSABILE → SEDUTA
 *
 * Da cui le regole:
 *
 *  - **I fatti sono del motore, non del modello.** `briefing`, `source`,
 *    `options`, `inaction` e le finestre vengono dalla Pressure canonica; i
 *    `verifiedFacts` sono misure reali della nazione, formattate per la prosa.
 *    Nessun numero è inventato e nessun effetto è anticipato: la decisione passa
 *    per il normale motore di risoluzione.
 *  - **Solo il Presidente convoca.** Il modulo *suggerisce* il ministro
 *    competente e i colleghi da sentire; non convoca e non fa parlare nessuno.
 *  - **La provenienza è dedotta, non narrata.** Se la stessa questione è già
 *    stata chiusa (per decisione o per inerzia), la situazione lo dichiara: è il
 *    motivo per cui una crisi esiste. Il campo non viene dal modello.
 *  - **Modulo puro**: riceve record, finestra e misure già lette, restituisce la
 *    vista. Nessuna scrittura.
 */

import type { CabinetSeat } from './Cabinet';
import type { PressureEffect, PressureOption } from '../simulation/PeacetimePressures';
import { formatGovernmentNumber } from './GovernmentNumberFormat';

/** Da dove nasce una situazione: stato, decisione passata, inerzia, o altro. */
export type SituationOriginType = 'state' | 'previous-decision' | 'inaction' | 'foreign-action' | 'project' | 'faction';

export interface SituationOrigin {
  readonly type: SituationOriginType;
  readonly sourceId?: string;
}

/** Uno dei corsi d'azione che il motore già conosce per questa questione. */
export interface SituationOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** La nota dell'effetto, come la dichiara il motore. Non è una promessa calcolata. */
  readonly effectNote: string;
}

/** La vista che il Consiglio mostra: fatti verificabili + decisione richiesta. */
export interface GovernmentSituation {
  readonly id: string;
  readonly pressureId: string;
  readonly title: string;
  readonly briefing: string;
  readonly source: string;
  readonly severity: number;
  readonly priority: string;
  readonly openedDate: string;
  readonly deadline: string | null;
  readonly daysLeft: number;
  readonly leadMinister: CabinetSeat;
  readonly suggestedMinisters: readonly CabinetSeat[];
  readonly verifiedFacts: readonly string[];
  readonly decisionQuestion: string;
  readonly options: readonly SituationOption[];
  readonly inaction: { readonly note: string };
  readonly affectedDomains: readonly string[];
  readonly origin: SituationOrigin;
}

/** Le misure reali della nazione, già lette dal motore, da cui nascono i fatti. */
export interface SituationFactSource {
  readonly socialTension: number;
  readonly stability: number;
  readonly deficitRatioPct: number;
  readonly debtRatioPct: number;
  readonly taxRatePct: number;
  readonly militaryPower: number;
  readonly mobilized: number;
  readonly forces?: number;
  readonly foodCoverageMonths: number | null;
}

/** Il minimo della Pressure che serve alla vista (record persistito o generato). */
export interface SituationPressureInput {
  readonly id: string;
  readonly kind: 'internal' | 'external';
  readonly template: string;
  readonly title: string;
  readonly detail: string;
  readonly severity: number;
  readonly source: string;
  readonly options: readonly PressureOption[];
  readonly inaction: PressureEffect;
  readonly createdDate: string;
}

/** Un record chiuso, per dedurre la provenienza di una situazione nuova. */
export interface SituationHistoryEntry {
  readonly id: string;
  readonly template: string;
  readonly status: string;
  readonly createdTurn: number;
}

export interface SituationWindowInput {
  readonly daysLeft: number;
  readonly expired: boolean;
}

/**
 * Il ministro competente per la natura della questione. Deterministico: stesso
 * template, stessa sedia. I template senza una competenza esplicita ricadono
 * sulla natura (interna → Interno, esterna → Esteri), mai su un caso.
 */
const LEAD_MINISTER: Record<string, CabinetSeat> = {
  'border-incident': 'guerra',
  'neighbour-buildup': 'guerra',
  'alliance-offer': 'esteri',
  'diplomatic-feeler': 'esteri',
  'trade-dispute': 'esteri',
  'sanctions-threat': 'esteri',
  'refugee-flow': 'interno',
  'inflation-spiral': 'tesoro',
  'veterans-unrest': 'interno',
  'material-shortage': 'lavori',
  'harvest-failure': 'interno',
  'separatist-movement': 'interno',
  'strike-wave': 'interno',
  'corruption-scandal': 'interno',
  'emigration-wave': 'interno',
  'public-opinion': 'interno',
};

/** I colleghi da sentire: sono suggeriti, non convocati automaticamente. */
const SUGGESTED_MINISTERS: Record<string, readonly CabinetSeat[]> = {
  'border-incident': ['tesoro', 'esteri', 'interno'],
  'neighbour-buildup': ['tesoro', 'esteri'],
  'alliance-offer': ['tesoro', 'guerra'],
  'diplomatic-feeler': ['tesoro'],
  'trade-dispute': ['tesoro', 'lavori'],
  'sanctions-threat': ['tesoro', 'esteri'],
  'refugee-flow': ['esteri', 'tesoro'],
  'inflation-spiral': ['interno', 'lavori'],
  'veterans-unrest': ['guerra', 'tesoro'],
  'harvest-failure': ['tesoro', 'lavori'],
  'separatist-movement': ['guerra', 'tesoro'],
  'strike-wave': ['lavori', 'tesoro'],
  'corruption-scandal': ['tesoro'],
  'emigration-wave': ['tesoro', 'lavori'],
  'public-opinion': ['tesoro'],
};

/** I domini toccati, per il dossier. Deterministici, non inventati dal modello. */
const AFFECTED_DOMAINS: Record<string, readonly string[]> = {
  'border-incident': ['difesa', 'diplomazia', 'ordine pubblico'],
  'neighbour-buildup': ['difesa', 'diplomazia'],
  'alliance-offer': ['diplomazia', 'difesa'],
  'diplomatic-feeler': ['diplomazia'],
  'trade-dispute': ['commercio', 'entrate'],
  'sanctions-threat': ['commercio', 'entrate', 'diplomazia'],
  'refugee-flow': ['ordine pubblico', 'spesa sociale', 'diplomazia'],
  'inflation-spiral': ['moneta', 'entrate'],
  'veterans-unrest': ['difesa', 'spesa sociale'],
  'harvest-failure': ['approvvigionamenti', 'ordine pubblico'],
  'separatist-movement': ['coesione', 'ordine pubblico'],
  'strike-wave': ['produzione', 'lavoro'],
  'corruption-scandal': ['spesa pubblica', 'credibilità'],
  'emigration-wave': ['popolazione', 'produzione'],
  'public-opinion': ['consenso'],
};

/** La domanda che il Consiglio deve sciogliere, per template. */
const DECISION_QUESTION: Record<string, string> = {
  'border-incident': 'Come rispondiamo all’incidente?',
  'neighbour-buildup': 'Come controbilanciamo il riarmo del vicino?',
  'alliance-offer': 'Accettiamo il patto proposto?',
  'diplomatic-feeler': 'Diamo seguito alle consultazioni?',
  'trade-dispute': 'Come rispondiamo ai dazi?',
  'sanctions-threat': 'Come ci prepariamo alle sanzioni?',
  'refugee-flow': 'Come gestiamo il flusso di profughi?',
  'inflation-spiral': 'Come freniamo l’inflazione?',
  'veterans-unrest': 'Come rispondiamo ai reduci?',
  'harvest-failure': 'Come copriamo il fabbisogno alimentare?',
  'separatist-movement': 'Come teniamo insieme le province?',
  'strike-wave': 'Come sblocchiamo lo sciopero?',
  'corruption-scandal': 'Come rispondiamo allo scandalo?',
  'emigration-wave': 'Come tratteniamo chi parte?',
  'public-opinion': 'Quale segnale di governo diamo?',
};

/** Il ministro competente: dal template, o dalla natura della questione. */
export function leadMinisterFor(pressure: Pick<SituationPressureInput, 'template' | 'kind'>): CabinetSeat {
  return LEAD_MINISTER[pressure.template] ?? (pressure.kind === 'external' ? 'esteri' : 'interno');
}

/** I colleghi suggeriti, senza doppioni e senza il relatore stesso. */
export function suggestedMinistersFor(pressure: Pick<SituationPressureInput, 'template' | 'kind'>): readonly CabinetSeat[] {
  const lead = leadMinisterFor(pressure);
  const explicit = SUGGESTED_MINISTERS[pressure.template] ?? [];
  return explicit.filter((seat, index, list) => seat !== lead && list.indexOf(seat) === index);
}

/**
 * I fatti verificabili della situazione: solo misure reali della nazione,
 * pertinenti al dominio della questione. Una misura mancante non diventa zero:
 * viene omessa.
 */
export function situationFacts(pressure: Pick<SituationPressureInput, 'template' | 'kind'>, facts: SituationFactSource): readonly string[] {
  const out: string[] = [];
  const tension = `Tensione sociale ${formatGovernmentNumber(facts.socialTension, 'ratio')}/100`;
  const stability = `Stabilità ${formatGovernmentNumber(facts.stability, 'ratio')}/100`;
  const deficit = `Disavanzo annuo ${formatGovernmentNumber(facts.deficitRatioPct, 'percent')}% del PIL`;
  const debt = `Debito ${formatGovernmentNumber(facts.debtRatioPct, 'percent')}% del PIL`;
  const tax = `Prelievo effettivo ${formatGovernmentNumber(facts.taxRatePct, 'percent')}%`;
  const army = `Potenziale militare ${formatGovernmentNumber(facts.militaryPower, 'integer')}`;
  const mobilized = `Forze mobilitate ${formatGovernmentNumber(facts.mobilized, 'integer')}`;
  const food = facts.foodCoverageMonths !== null
    ? `Copertura alimentare ${formatGovernmentNumber(facts.foodCoverageMonths, 'ratio')} mesi`
    : null;
  const domains = AFFECTED_DOMAINS[pressure.template] ?? [];

  if (pressure.kind === 'external') {
    out.push(army, mobilized);
    if (domains.includes('diplomazia')) out.push(tension);
    if (domains.includes('commercio') || domains.includes('entrate')) out.push(debt, tax);
    if (domains.includes('spesa sociale') && food) out.push(food);
  } else {
    if (domains.includes('moneta') || domains.includes('entrate') || domains.includes('spesa pubblica')) out.push(deficit, debt);
    if (domains.includes('ordine pubblico') || domains.includes('coesione') || domains.includes('consenso')) out.push(tension, stability);
    if (domains.includes('produzione') || domains.includes('lavoro')) out.push(tension, tax);
    if (domains.includes('difesa') || domains.includes('spesa sociale')) out.push(mobilized);
    if ((domains.includes('approvvigionamenti') || domains.includes('popolazione')) && food) out.push(food);
    if (domains.includes('popolazione') || domains.includes('dipendenti')) out.push(stability);
  }
  return [...new Set(out)];
}

/**
 * La provenienza: se la stessa questione è già stata chiusa, la nuova situazione
 * lo dichiara. Una chiusura per scadenza è **inerzia**; una per scelta è una
 * **decisione precedente**. È il motivo per cui il giocatore può dire «questa
 * crisi esiste perché…» senza che il modello inventi nulla.
 */
export function originFor(record: Pick<SituationPressureInput, 'template' | 'id'>, history: readonly SituationHistoryEntry[]): SituationOrigin {
  const previous = history
    .filter(entry => entry.template === record.template && entry.id !== record.id && entry.status !== 'active')
    .sort((left, right) => right.createdTurn - left.createdTurn)[0];
  if (!previous) return { type: 'state' };
  return previous.status === 'expired'
    ? { type: 'inaction', sourceId: previous.id }
    : { type: 'previous-decision', sourceId: previous.id };
}

/** La vista completa, dalla Pressure canonica. Nessun effetto viene ricalcolato. */
export function buildGovernmentSituation(input: {
  readonly pressure: SituationPressureInput;
  readonly window: SituationWindowInput;
  readonly priority: string;
  readonly facts: SituationFactSource;
  readonly history?: readonly SituationHistoryEntry[];
  /** P1.7 — provenienza esplicita (per i follow-up); altrimenti dedotta. */
  readonly origin?: SituationOrigin;
}): GovernmentSituation {
  const { pressure, window, priority, facts } = input;
  return {
    id: `situation:${pressure.id}`,
    pressureId: pressure.id,
    title: pressure.title,
    briefing: pressure.detail,
    source: pressure.source,
    severity: pressure.severity,
    priority,
    openedDate: pressure.createdDate,
    deadline: null,
    daysLeft: Math.max(0, Math.round(window.daysLeft)),
    leadMinister: leadMinisterFor(pressure),
    suggestedMinisters: suggestedMinistersFor(pressure),
    verifiedFacts: situationFacts(pressure, facts),
    decisionQuestion: DECISION_QUESTION[pressure.template] ?? (pressure.kind === 'external' ? 'Come rispondiamo alla pressione esterna?' : 'Come rispondiamo alla questione interna?'),
    options: pressure.options.map(option => ({ id: option.id, label: option.label, detail: option.detail, effectNote: option.effect.note })),
    inaction: { note: pressure.inaction.note },
    affectedDomains: AFFECTED_DOMAINS[pressure.template] ?? [],
    origin: input.origin ?? originFor(pressure, input.history ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * P1.8 — Il follow-up di un atto: il ministro torna a riferire
 * ------------------------------------------------------------------ */

/** Giorni dopo i quali un atto chiuso produce un seguito da riferire. */
export const SITUATION_FOLLOW_UP_DAYS = 30;

/** Il seguito di una decisione: chi lo porta, quando, e con quali fatti reali. */
export interface GovernmentFollowUp {
  readonly id: string;
  readonly pressureId: string;
  readonly owner: CabinetSeat;
  readonly dueDate: string;
  /** Giorni che restano alla data del seguito (≤ 0 quando è già dovuto). */
  readonly daysLeft: number;
  /** Cosa era stato deciso, come l'ha registrato il motore. */
  readonly label: string;
  /** Cosa verificare, derivato dall'effetto realmente applicato (mai inventato). */
  readonly checks: readonly string[];
  /** I fatti di oggi, misurati: il ministro li porta al Presidente. */
  readonly outcome: readonly string[];
  readonly origin: SituationOrigin;
  readonly situation: GovernmentSituation;
}

/**
 * Il seguito di una pressione chiusa. Non crea effetti nuovi: legge ciò che il
 * motore ha già applicato (`resolution`) e le misure di oggi, e prepara ciò che
 * il ministro deve riferire. Le `checks` sono derivate dall'effetto reale — una
 * cassa spesa chiede di verificare la copertura, non altro.
 */
export function buildGovernmentFollowUp(input: {
  readonly pressure: SituationPressureInput & { readonly status: string; readonly resolution?: string | null; readonly resolvedOption?: string | null };
  readonly owner: CabinetSeat;
  readonly dueDate: string;
  readonly daysLeft: number;
  readonly facts: SituationFactSource;
  readonly priority?: string;
}): GovernmentFollowUp {
  const closed = input.pressure.status === 'expired';
  const origin: SituationOrigin = { type: closed ? 'inaction' : 'previous-decision', sourceId: input.pressure.id };
  const checks: string[] = [];
  if (input.pressure.resolution) checks.push(`Verificare l’effetto dichiarato: ${input.pressure.resolution}`);
  return {
    id: `follow-up:${input.pressure.id}`,
    pressureId: input.pressure.id,
    owner: input.owner,
    dueDate: input.dueDate,
    daysLeft: Math.round(input.daysLeft),
    label: input.pressure.resolution ?? input.pressure.title,
    checks,
    outcome: situationFacts(input.pressure, input.facts),
    origin,
    situation: buildGovernmentSituation({
      pressure: input.pressure,
      window: { daysLeft: 0, expired: false },
      priority: input.priority ?? 'rilevante',
      facts: input.facts,
      origin,
    }),
  };
}
