/**
 * WS-GOV-REALITY-ADVISOR-HARDENING — SIGNAL LAYER deterministico.
 *
 * I segnali NON sono quest: nessuna opzione, nessun effetto di inazione, nessuna
 * scadenza, nessuna risoluzione. Descrivono SOLO ciò che il motore ha misurato
 * (fatti e delta reali) e servono al Consulente per decidere di cosa parlare.
 *
 * Ogni segnale referenzia chiavi di `VerifiedWorldSnapshot.facts`: il Consulente
 * non può citare un fatto che non esista lì.
 */
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import { governmentSalienceInput } from './GovernmentSalienceSnapshot';
import { evaluateGovernmentSalience } from './GovernmentSalience';
import { formatGovernmentNumber } from './GovernmentNumberFormat';

export type RealitySignalDomain =
  | 'economy' | 'food' | 'military' | 'diplomacy' | 'infrastructure' | 'social' | 'project' | 'report' | 'decision' | 'inaction';

/**
 * §5 — Classificazione interna del Capo di Gabinetto. NON è una lista di cose da
 * mostrare: serve a decidere cosa merita attenzione e cosa può restare in
 * sottofondo. Un turno senza emergenze è un turno valido.
 */
export type RealitySignalClass = 'URGENT' | 'WATCH' | 'OPPORTUNITY';

export function realitySignalClass(importance: number): RealitySignalClass {
  if (importance >= 3) return 'URGENT';
  if (importance === 2) return 'WATCH';
  return 'OPPORTUNITY';
}

export interface RealitySignal {
  key: string;
  domain: RealitySignalDomain;
  /** 1 = marginale, 2 = rilevante, 3 = critico. Determina l'ordine del briefing. */
  importance: number;
  /** Entità canonica del problema (polity ostile, opera in ritardo): rende il titolo concreto. */
  subject?: string;
  /** Titolo già leggibile fornito dal motore (es. «Fronte A–B»), usato verbatim. */
  title?: string;
  factKeys: string[];
  sourceRefs: string[];
  reason: string;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * I segnali come sezione breve per il contesto dei ministri: classificazione +
 * motivo, NESSUN menu di opzioni e nessuna scadenza. Sostituisce il vecchio
 * blocco delle Pressure (che portava titolo, opzioni e «chi preme»).
 */
export function renderRealityConcerns(snapshot: VerifiedWorldSnapshot): string | undefined {
  const signals = buildRealitySignals(snapshot).slice(0, 5);
  if (!signals.length) return undefined;
  return stripTechnicalLines([
    '[SEGNALI DEL MOMENTO — non sono quest: nessuna opzione da scegliere]',
    ...signals.map(signal => `- [${realitySignalClass(signal.importance)}] ${signal.reason}`),
  ].join('\n'));
}

/**
 * WS-GOV-PRESET-REALITY-PIPELINE §4/§11 — VOCABOLARIO TECNICO VIETATO al giocatore.
 * Se una riga ne contiene uno, non deve uscire: era il Consulente che sembrava
 * un debugger del database.
 */
const TECHNICAL_VOCABULARY = /\b(?:FACT|inventory|account|sourceRefs?|source_refs?|canonical|fallback|JSON|field|fields|registrat[oaie]|non registrat[oaie]|ai fini del gioco|dati interni|VerifiedWorldSnapshot)\b/i;

export function hasTechnicalVocabulary(text: string): boolean {
  return TECHNICAL_VOCABULARY.test(String(text ?? ''));
}

/** Rimuove le righe con linguaggio tecnico; `undefined` se non resta nulla. */
export function stripTechnicalLines(text: string): string | undefined {
  const kept = String(text ?? '').split('\n').filter(line => line.trim() && !hasTechnicalVocabulary(line));
  return kept.length ? kept.join('\n') : undefined;
}

/** La domanda politica che corrisponde a un segnale: testo piano, senza cifre. */
function questionForSignal(signal: RealitySignal): string {
  switch (signal.domain) {
    case 'food': return 'Come garantiamo le scorte alimentari?';
    case 'economy': return 'Come teniamo sotto controllo le finanze?';
    case 'social': return 'Come riduciamo la tensione sociale?';
    case 'military': return signal.key === 'military-readiness' ? 'Come ristabiliamo la prontezza delle forze?' : 'Come rivediamo la postura delle forze?';
    case 'diplomacy': return 'Come gestiamo i rapporti con i vicini ostili?';
    case 'project': return 'Come sblocchiamo le opere in ritardo?';
    case 'report': return 'Cosa facciamo con i rapporti sugli atti precedenti?';
    case 'decision': return 'Come proseguiamo le decisioni appena prese?';
    case 'inaction': return 'Su cosa decidiamo, ora che la finestra si è chiusa?';
    default: return 'Su cosa vuole che ci concentriamo?';
  }
}

/**
 * §3B/§3C — La situazione reale del paese e le questioni che ne derivano:
 * testo PIANO, dalla stessa fonte del briefing del Consulente (nessuna seconda
 * realtà, nessun termine tecnico, nessuna cifra inventata).
 *
 * WS-CONSULENTE-SITUAZIONI — Il numero NON è fisso: è quello dei segnali
 * realmente misurati (zero quando non c'è nulla, molti quando il paese è sotto
 * pressione). `max` resta solo un tetto tecnico opzionale per i chiamanti che
 * lo richiedono.
 */
export function nationalQuestions(snapshot: VerifiedWorldSnapshot, max?: number): string[] {
  const signals = buildRealitySignals(snapshot);
  return (max === undefined ? signals : signals.slice(0, Math.max(0, max))).map(questionForSignal);
}

export function nationalSituationLines(snapshot: VerifiedWorldSnapshot, max?: number): string[] {
  const signals = buildRealitySignals(snapshot);
  const selected = max === undefined ? signals : signals.slice(0, Math.max(0, max));
  return stripTechnicalLines(selected.map(signal => `- ${signal.reason}`).join('\n'))
    ?.split('\n').map(line => line.replace(/^-\s*/, '').trim()).filter(Boolean) ?? [];
}

/** Cost-free opening: interpret the dominant measured concern, not its raw fields. */
export function advisorBriefingSentences(snapshot: VerifiedWorldSnapshot): string {
  const signals = buildRealitySignals(snapshot);
  const dominant = signals[0];
  if (!dominant) {
    const balance = finite(snapshot.facts.monthlyBalance?.rawValue);
    const food = finite(snapshot.facts.foodCoverageMonths?.rawValue);
    if (balance !== null && balance >= 0 && food !== null && food >= 2) {
      return 'Presidente, le scorte e il bilancio non indicano urgenze. Il margine disponibile non prova che nuovi impegni siano sostenibili: costi, durata e vincoli dei programmi restano determinanti.';
    }
    return 'Presidente, il quadro disponibile non basta per giudicare la solidità della nostra posizione. La copertura dei programmi e i vincoli operativi restano incerti: l’assenza di segnali non dimostra che tutto vada bene.';
  }
  let assessment: string;
  let constraints: string;
  let caution: string;
  switch (dominant.domain) {
    case 'food':
      assessment = `Le scorte coprono ${snapshot.facts.foodCoverageMonths.value}: questo limita il tempo per intervenire`;
      constraints = 'La copertura alimentare sotto due mesi lascia poco margine a shock o nuovi impieghi delle scorte';
      caution = 'Un nuovo impegno senza copertura alimentare rischierebbe di aggravare la vulnerabilità';
      break;
    case 'economy':
      assessment = dominant.importance === 1 ? 'Il miglioramento osservato delle finanze apre un margine da verificare'
        : dominant.key === 'debt-burden' ? 'Gli interessi sul debito restringono la libertà di manovra'
        : dominant.key === 'economy-change' ? 'Il peggioramento osservato delle finanze merita una verifica'
        : 'Le uscite superano le entrate: nuovi impegni potrebbero erodere la cassa';
      constraints = dominant.importance === 1
        ? 'Un miglioramento puntuale non dimostra che il margine durerà per l’intera durata dei programmi'
        : 'Spese essenziali e impegni già assunti limitano la quota disponibile per altri programmi';
      caution = 'Più programmi concorrenti possono consumare la stessa copertura';
      break;
    case 'social':
      assessment = 'La tenuta interna merita priorità rispetto a nuove iniziative';
      constraints = 'La fragilità del consenso riduce il margine per misure impopolari o nuovi sacrifici';
      caution = 'Misure brusche potrebbero irrigidire il consenso: la stabilità non è acquisita';
      break;
    case 'military':
      assessment = dominant.key === 'military-readiness' ? 'La bassa prontezza osservata nei reparti limita le opzioni di sicurezza'
        : dominant.key === 'military-mobilization' ? 'La mobilitazione in corso richiede una scelta chiara sulle priorità'
        : dominant.key === 'military-change' ? 'La variazione osservata nelle forze richiede una revisione della postura'
        : 'Gli impegni operativi e i rifornimenti richiedono una verifica';
      constraints = 'Preparazione, rifornimenti e tempi di impiego delle forze disponibili condizionano le opzioni effettive';
      caution = 'Nuovi fronti potrebbero ridurre il margine su altri programmi';
      break;
    case 'diplomacy':
      assessment = 'I rapporti ostili rendono delicata la nostra libertà di manovra esterna';
      constraints = 'Ogni rapporto ostile costituisce un fronte distinto; le possibili reazioni degli altri interlocutori condizionano il margine diplomatico';
      caution = 'Una rottura potrebbe restringere ulteriormente le opzioni: reazioni favorevoli non sono garantite';
      break;
    case 'project':
      assessment = 'Le opere oltre la data attesa richiedono attenzione prima di avviarne altre';
      constraints = 'I programmi non conclusi continuano a competere per copertura, materiali e capacità esecutiva';
      caution = 'La dispersione delle risorse potrebbe prolungare i ritardi';
      break;
    default:
      assessment = dominant.reason;
      constraints = 'Gli impegni già presi condizionano il margine per nuove decisioni';
      caution = 'Una decisione non prova che il risultato sia già stato ottenuto';
  }
  const secondary = signals.find(signal => signal.domain !== dominant.domain && signal.importance >= 2);
  const secondaryAssessment = secondary ? ({ economy: 'Anche le finanze limitano le alternative', food: 'Anche la copertura alimentare lascia poco margine',
    military: 'Conta anche la disponibilità operativa delle forze', social: 'Conta anche la tenuta interna', diplomacy: 'Pesano anche i rapporti esterni',
    project: 'Pesano inoltre le opere in ritardo', report: 'I rapporti sugli atti precedenti meritano un riesame',
    decision: 'Le decisioni recenti restano parte del quadro', inaction: 'Restano questioni sulle quali non abbiamo deciso', infrastructure: 'Contano anche i collegamenti disponibili' } satisfies Record<RealitySignalDomain, string>)[secondary.domain] : '';
  const signed = snapshot.recent.signedActs.length ? ` L’atto «${snapshot.recent.signedActs[0].text}» è già firmato, ma i suoi effetti restano da attendere.` : '';
  return `Presidente, ${assessment.charAt(0).toLocaleLowerCase()}${assessment.slice(1)}. ${secondaryAssessment ? `${secondaryAssessment}. ` : ''}${constraints}. ${caution}.${signed}`;
}

/**
 * H07 — La `domain` di un filone è una **sedia del gabinetto** (standard H01),
 * non un dominio-segnale. Questa mappa traduce l'una nell'altro, in un punto
 * solo: è il confine tra lo standard dei filoni e il motore dei segnali.
 */
const SEAT_TO_SIGNAL_DOMAIN: Record<string, RealitySignalDomain> = {
  tesoro: 'economy', lavori: 'infrastructure', istruzione: 'social', sanita: 'social',
  esteri: 'diplomacy', interno: 'social', guerra: 'military',
};

export function seatToSignalDomain(seat: string): RealitySignalDomain {
  return SEAT_TO_SIGNAL_DOMAIN[seat] ?? 'diplomacy';
}

export function buildRealitySignals(snapshot: VerifiedWorldSnapshot): RealitySignal[] {
  const signals: RealitySignal[] = [];
  const facts = snapshot.facts;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(facts, key);
  const ref = (key: string) => facts[key]?.sourceRef ?? key;
  const delta = (key: string) => snapshot.changes.deltas.find(item => item.key === key);

  // Un segnale è valido con FATTI verificati OPPURE con soli riferimenti
  // canonici (rapporti ostili, opere in ritardo, mobilitazioni): scartarlo
  // perché non ha una chiave in `facts` lo farebbe sparire dal briefing.
  const push = (signal: RealitySignal): void => {
    if (signal.factKeys.length || signal.sourceRefs.length) signals.push(signal);
  };

  // I segnali leggono i FATTI dello snapshot: `facts` è la proiezione canonica
  // dei numeri del motore, quindi nessun segnale può nascere da un campo non
  // verificato o divergere dal briefing.
  const factNumber = (key: string): number | null => finite(facts[key]?.rawValue);

  // FOOD — copertura alimentare misurata.
  const food = factNumber('foodCoverageMonths');
  if (has('foodCoverageMonths') && food !== null && food < 2) {
    const declining = (delta('foodCoverageMonths')?.delta ?? 0) < 0;
    push({
      key: 'food-coverage', domain: 'food', importance: food < 1 || declining ? 3 : 2,
      factKeys: ['foodCoverageMonths', ...(has('treasury') ? ['treasury'] : [])],
      sourceRefs: [ref('foodCoverageMonths')].filter(Boolean),
      reason: `copertura alimentare ${facts.foodCoverageMonths.value}${declining ? ', in calo sul rilevamento precedente' : ''}`,
    });
  }

  // ECONOMY — stessa policy dell'agenda: saldo MENSILE / PIL ANNUO,
  // interessi / entrate e variazioni misurate. Debito/PIL da solo non è crisi.
  const input = governmentSalienceInput(snapshot);
  const policy = evaluateGovernmentSalience(input);
  const balance = factNumber('monthlyBalance');
  const treasury = factNumber('treasury');
  // Additional documented liquidity trigger: measured cash covers less than
  // three months of the current monthly deficit. No GDP guess is needed.
  const runway = balance !== null && balance < 0 && treasury !== null ? Math.max(0, treasury) / -balance : null;
  const shortRunway = runway !== null && runway < 3;
  if (policy.treasury || shortRunway) {
    const balanceStress = input.cashFlow !== undefined && input.cashFlow.balancePct <= -1;
    const serviceStress = input.debt.servicePct >= 15;
    const balanceChange = policy.treasury?.figures.some(figure => figure.basis.kind === 'measured' && figure.basis.source === 'salience.previous.balancePct') ?? false;
    const serviceChange = policy.treasury?.figures.some(figure => figure.basis.kind === 'measured' && figure.basis.source === 'salience.previous.debtServicePct') ?? false;
    const improvement = !balanceStress && !serviceStress && !shortRunway
      && (!balanceChange || input.cashFlow!.balancePct > input.salience!.previous!.balancePct!)
      && (!serviceChange || input.debt.servicePct < input.salience!.previous!.debtServicePct!);
    const keys = [...new Set([
      ...(balanceStress || balanceChange ? ['monthlyBalance', 'nominalGdpUsdBillions'] : []),
      ...(serviceStress || serviceChange ? ['debtServicePct'] : []),
      ...(shortRunway ? ['monthlyBalance', 'treasury'] : []),
    ])].filter(has);
    const comparisonKeys = [
      ...(balanceChange ? ['monthlyBalance', 'nominalGdpUsdBillions'] : []),
      ...(serviceChange ? ['debtServicePct'] : []),
    ];
    const refs = keys.map(ref);
    for (const key of comparisonKeys) {
      const change = delta(key);
      if (change) refs.push(change.sourceRef, change.previousSourceRef);
    }
    const reasons = [
      ...(balanceStress ? [`saldo mensile ${facts.monthlyBalance.value}, pari al ${formatGovernmentNumber(input.cashFlow!.balancePct, 'percent')}% del PIL nominale annuo`] : []),
      ...(serviceStress ? [`gli interessi assorbono il ${formatGovernmentNumber(input.debt.servicePct, 'percent')}% delle entrate`] : []),
      ...(balanceChange ? [`saldo mensile/PIL annuo ${input.cashFlow!.balancePct > input.salience!.previous!.balancePct! ? 'migliorato' : 'peggiorato'} dal ${formatGovernmentNumber(input.salience!.previous!.balancePct!, 'percent')}% al ${formatGovernmentNumber(input.cashFlow!.balancePct, 'percent')}%`] : []),
      ...(serviceChange ? [`interessi/entrate ${input.debt.servicePct < input.salience!.previous!.debtServicePct! ? 'diminuiti' : 'aumentati'} dal ${formatGovernmentNumber(input.salience!.previous!.debtServicePct!, 'percent')}% al ${formatGovernmentNumber(input.debt.servicePct, 'percent')}%`] : []),
      ...(shortRunway ? [`la cassa copre ${formatGovernmentNumber(runway!, 'ratio')} mesi del disavanzo mensile, meno di tre mesi`] : []),
    ];
    push({
      key: balanceStress ? 'monthly-balance' : serviceStress ? 'debt-burden' : shortRunway ? 'cash-runway' : 'economy-change',
      domain: 'economy', importance: shortRunway || policy.treasury?.urgency === 'critica' ? 3 : improvement ? 1 : 2,
      factKeys: keys, sourceRefs: [...new Set(refs)].filter(Boolean), reason: reasons.join('; '),
    });
  }

  // SOCIAL — same selection as Agenda, including observed significant changes.
  for (const [key, signalKey, condition, critical] of [
    ['socialTension', 'social-tension', policy.education, (factNumber('socialTension') ?? 0) >= 70],
    ['stability', 'stability', policy.health, (factNumber('stability') ?? Infinity) <= 30],
  ] as const) {
    if (!condition || !has(key)) continue;
    const change = delta(key);
    push({ key: signalKey, domain: 'social', importance: critical ? 3 : 2,
      factKeys: [key], sourceRefs: [...new Set([ref(key), ...(change ? [change.previousSourceRef] : [])])],
      reason: condition.because,
    });
  }

  // REPORT — follow-up di atti già eseguiti (mai Pressure scadute).
  const followUps = snapshot.recent.followUps ?? [];
  if (followUps.length) {
    push({
      key: 'follow-ups', domain: 'report', importance: 2,
      factKeys: followUps.flatMap(report => report.factKeys).slice(0, 6),
      sourceRefs: followUps.map(report => report.sourceRef).slice(0, 4),
      reason: `${followUps.length} rapporti di verifica su atti precedenti`,
    });
  }

  // DECISION — atti e decisioni recenti: il Consulente li CONOSCE e li porta
  // nel nuovo turno senza riproporli come questioni aperte.
  // §5 — Solo decisioni REALMENTE prese: una finestra chiusa senza scelta
  // (`expired`) non è una decisione del Presidente, è inazione.
  const decisions = (snapshot.recent.decisions ?? []).filter(decision => decision.status === 'resolved');
  if (decisions.length) {
    const latest = decisions.slice(-3);
    push({
      key: 'recent-decisions', domain: 'decision', importance: 2, factKeys: [],
      sourceRefs: latest.map(decision => `decisions.${decision.id}`),
      reason: latest.length === 1
        ? `decisione presa: «${latest[0].title}»${latest[0].resolution ? ` — ${latest[0].resolution}` : ''}`
        : `decisioni prese di recente: ${latest.map(decision => `«${decision.title}»`).join(', ')}`,
    });
  }

  // INAZIONE — finestre di decisione chiuse senza una scelta: il Consulente lo
  // dice come tale, senza attribuire al Presidente una decisione che non c'è.
  const inactions = (snapshot.recent.decisions ?? []).filter(decision => decision.status === 'expired');
  if (inactions.length) {
    const latest = inactions.slice(-2);
    push({
      key: 'inaction', domain: 'inaction', importance: 2, factKeys: [],
      sourceRefs: latest.map(decision => `decisions.${decision.id}`),
      reason: latest.length === 1
        ? `nessuna decisione presa su «${latest[0].title}»: la finestra si è chiusa`
        : `nessuna decisione presa su ${latest.map(decision => `«${decision.title}»`).join(', ')}`,
    });
  }

  // DIPLOMACY — rapporti ostili registrati. WS-CONSULENTE-SITUAZIONI: problemi
  // separati restano separati. Un segnale per entità ostile, con il nome
  // canonico come soggetto; la chiave resta `hostile-relations` per un solo
  // rapporto (retrocompatibile), altrimenti `hostile-relations:<polityId>`.
  const hostile = (snapshot.diplomacy.relations ?? []).filter(relation => relation.relationship === 'hostile');
  const singleHostile = hostile.length === 1;
  for (const relation of hostile) {
    const name = relation.polityName?.trim() || relation.polityId;
    push({
      key: singleHostile ? 'hostile-relations' : `hostile-relations:${relation.polityId}`,
      domain: 'diplomacy', importance: hostile.length > 1 ? 3 : 2,
      subject: name,
      factKeys: [], sourceRefs: [relation.sourceRef],
      reason: `rapporto ostile con ${name}`,
    });
  }

  // MILITARY — stessa proiezione e soglie. La sola ostilità è già un segnale
  // diplomatico: non duplicarla e non descriverla come guerra.
  const military = evaluateGovernmentSalience({ ...input,
    salience: { ...input.salience, hostileRelations: undefined },
  }).defence;
  if (military) {
    const keys: string[] = [];
    const refs: string[] = [];
    const addFact = (key: string, baseline = false) => {
      if (has(key)) { keys.push(key); refs.push(ref(key)); }
      if (baseline) {
        const change = delta(key);
        if (change) refs.push(change.sourceRef, change.previousSourceRef);
      }
    };
    const previousFigures = military.figures.flatMap(figure => {
      const source = figure.basis.kind === 'measured' ? figure.basis.source : undefined;
      return source?.startsWith('salience.previous.') ? [source.slice('salience.previous.'.length)] : [];
    });
    const readinessConcern = military.figures.some(figure => figure.label === 'Prontezza');
    if (readinessConcern && input.salience?.initialReadinessEstimate) addFact('military.initialReadinessPct');
    else if (readinessConcern) {
      for (const entry of snapshot.military.readiness ?? []) {
        if (entry.value < 0 || entry.value > 1 || !Number.isFinite(entry.value)) continue;
        const key = `military.units.${entry.unitId}.readiness`;
        addFact(key, previousFigures.includes('readinessPct'));
        const unit = snapshot.military.units.find(unit => unit.id === entry.unitId);
        if (!has(key) && unit) refs.push(`${unit.sourceRef}.readiness`);
      }
    }
    if (input.defence && input.defence.mobilized >= 1000) {
      addFact('mobilized');
      refs.push(...snapshot.military.mobilizations.map(entry => entry.sourceRef));
      if (!has('mobilized') && snapshot.military.mobilized !== null) refs.push(`worldState.accounts.${snapshot.polityId}.mobilized`);
    }
    for (const key of previousFigures.filter(key => key !== 'readinessPct')) addFact(key, true);
    if ((input.salience?.ongoingMilitaryOrders ?? 0) > 0) {
      refs.push(...snapshot.military.units.filter(unit => ['operational', 'degraded', 'retreating'].includes(String(unit.raw.status))
        && ['attack', 'defend', 'withdraw'].includes(String(unit.raw.order))).map(unit => `${unit.sourceRef}.order`));
    }
    if ((input.salience?.activeConflicts ?? 0) > 0) {
      refs.push(...snapshot.military.fronts.filter(front => ['active', 'stalemate', 'breakthrough'].includes(String(front.raw.status))
        && Number(front.raw.attackerPolityId === snapshot.polityId ? front.raw.defenderPressure : front.raw.attackerPressure) > 0).map(front => front.sourceRef));
    }
    if (input.salience?.supplyCoverageMonths !== undefined && input.salience.supplyCoverageMonths !== null && input.salience.supplyCoverageMonths < 1) {
      for (const resource of ['fuel', 'weapons'] as const) {
        addFact(`resources.${resource}`);
        const consumers = [
          ...(snapshot.military.units.length ? snapshot.military.units : snapshot.military.formations),
        ];
        for (const consumer of consumers) {
          const needs = consumer.raw.monthlyNeeds as Record<string, unknown> | undefined;
          if (needs && typeof needs === 'object' && (finite(needs[resource]) ?? 0) > 0) refs.push(`${consumer.sourceRef}.monthlyNeeds.${resource}`);
        }
        if (resource === 'fuel') refs.push(...snapshot.military.ships.filter(ship => (finite(ship.raw.monthlyFuel) ?? 0) > 0)
          .map(ship => `${ship.sourceRef}.monthlyFuel`));
      }
    }
    push({
      key: military.priority === 'readiness' ? 'military-readiness' : military.priority === 'mobilization' ? 'military-mobilization'
        : military.priority === 'change' ? 'military-change' : 'military-operations',
      domain: 'military', importance: military.urgency === 'critica' ? 3 : 2,
      factKeys: [...new Set(keys)], sourceRefs: [...new Set(refs)].filter(Boolean),
      reason: military.because.replace(/Sono registrati/g, 'Sono presenti'),
    });
  }

  // CONFLITTI — un fronte attivo per entità: problemi separati restano separati.
  // Il nome canonico del fronte è già leggibile («Fronte A–B»), lo si usa verbatim.
  const activeFronts = snapshot.military.fronts.filter(front => ['active', 'stalemate', 'breakthrough'].includes(String(front.raw.status)));
  for (const front of activeFronts) {
    const name = typeof front.raw.name === 'string' && front.raw.name.trim() ? front.raw.name.trim() : front.id;
    push({
      key: `conflict:${front.id}`, domain: 'military', importance: 3, title: name,
      factKeys: [], sourceRefs: [front.sourceRef], reason: `fronte attivo: ${name}`,
    });
  }

  // INFRASTRUCTURE — progetti oltre la data attesa (dato canonico del motore).
  // WS-CONSULENTE-SITUAZIONI: un segnale per opera distinta quando i dati lo
  // permettono; chiave legacy `late-projects` con una sola opera.
  const late = (snapshot.economy.ongoingProjects ?? []).filter(project => project.expectedDate && snapshot.date && project.expectedDate < snapshot.date);
  const singleLate = late.length === 1;
  for (const project of late) {
    const name = project.title?.trim() || project.name?.trim() || project.id;
    push({
      key: singleLate ? 'late-projects' : `late-projects:${project.id}`,
      domain: 'project', importance: 2,
      subject: name,
      factKeys: [], sourceRefs: [`ongoingProcesses.${project.id}`],
      reason: `«${name}» oltre la data attesa`,
    });
  }

  // FILONI DEL PRESET — H07. Un filone che tocca il giocatore è una questione
  // reale del mondo: entra come segnale con la sua chiave, così il Consulente
  // può riconoscerlo e proporne la storia. NON è un fatto del motore (nessun
  // factKey): è significato del preset, subordinato allo stato (H-I2).
  for (const storyline of snapshot.storylines ?? []) {
    push({
      key: `storyline:${storyline.id}`, domain: seatToSignalDomain(storyline.domain), importance: Math.max(1, Math.min(3, storyline.pressure)),
      title: storyline.title, subject: storyline.title,
      factKeys: [], sourceRefs: [`storylines.${storyline.id}`],
      reason: `${storyline.title}: ${storyline.summary}`,
    });
  }

  // Ordinamento deterministico: importanza, poi chiave.
  return signals.sort((left, right) => right.importance - left.importance || left.key.localeCompare(right.key));
}
