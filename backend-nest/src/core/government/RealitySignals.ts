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
    case 'military': return 'Come ristabiliamo la prontezza delle forze?';
    case 'diplomacy': return 'Come gestiamo i rapporti con i vicini ostili?';
    case 'project': return 'Come sblocchiamo le opere in ritardo?';
    case 'report': return 'Cosa facciamo con i rapporti sugli atti precedenti?';
    case 'decision': return 'Come proseguiamo le decisioni appena prese?';
    case 'inaction': return 'Su cosa decidiamo, ora che la finestra si è chiusa?';
    default: return 'Su cosa vuole che ci concentriamo?';
  }
}

/**
 * §3B/§3C — La situazione reale del paese e le 1-3 questioni che ne derivano:
 * testo PIANO, dalla stessa fonte del briefing del Consulente (nessuna seconda
 * realtà, nessun termine tecnico, nessuna cifra inventata).
 */
export function nationalQuestions(snapshot: VerifiedWorldSnapshot, max = 3): string[] {
  return buildRealitySignals(snapshot).slice(0, max).map(questionForSignal);
}

export function nationalSituationLines(snapshot: VerifiedWorldSnapshot, max = 3): string[] {
  return stripTechnicalLines(buildRealitySignals(snapshot).slice(0, max).map(signal => `- ${signal.reason}`).join('\n'))
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
      const infrastructure = (snapshot.infrastructure.factories?.length ?? 0) + (snapshot.infrastructure.ports?.length ?? 0);
      return `Presidente, le scorte e il bilancio non indicano urgenze: possiamo valutare opportunità senza moltiplicare gli impegni. ${infrastructure > 0
        ? 'Concentrerei gli investimenti sulle infrastrutture che già controlliamo, oppure chiederei ai ministri quali eventuali colli di bottiglia ne limitino il rendimento.'
        : 'Chiederei a Tesoro di valutare la copertura di un investimento mirato, oppure agli Esteri di esplorare contatti senza promettere accordi.'} Il margine va preservato: eviterei di impegnarlo prima di conoscere costi e condizioni.`;
    }
    return 'Presidente, il quadro disponibile non basta per giudicare la solidità della nostra posizione. Prima di impegnare altre risorse chiederei ai ministri di chiarire la copertura dei programmi e i vincoli operativi: l’assenza di segnali non dimostra che tutto vada bene.';
  }
  let assessment: string;
  let recommendations: string;
  let caution: string;
  switch (dominant.domain) {
    case 'food':
      assessment = `Le scorte coprono ${snapshot.facts.foodCoverageMonths.value}: questo limita il tempo per intervenire`;
      recommendations = 'Darei priorità a un piano di approvvigionamento con Interno e Tesoro, oppure ridurrei gli impieghi non essenziali delle scorte';
      caution = 'Un nuovo impegno senza copertura alimentare rischierebbe di aggravare la vulnerabilità';
      break;
    case 'economy':
      assessment = dominant.key === 'debt-burden' ? 'Il peso del debito restringe la libertà di manovra' : 'Le uscite superano le entrate: nuovi impegni potrebbero erodere la cassa';
      recommendations = 'Chiederei a Tesoro di proteggere le spese essenziali e rinviare quelle meno urgenti, oppure valuterei nuove entrate prima di finanziare altri programmi';
      caution = 'La posizione fiscale richiede prudenza: eviterei di aprire più programmi senza una copertura verificata';
      break;
    case 'social':
      assessment = 'La tenuta interna merita priorità rispetto a nuove iniziative';
      recommendations = 'Affiderei a Interno un confronto sulle cause della fragilità, oppure concentrerei le risorse sui servizi essenziali prima di ampliare gli impegni';
      caution = 'Misure brusche potrebbero irrigidire il consenso: eviterei di trattare la stabilità come acquisita';
      break;
    case 'military':
      assessment = snapshot.military.mobilizations.length ? 'La mobilitazione in corso richiede una scelta chiara sulle priorità' : 'La bassa prontezza dei reparti limita le opzioni di sicurezza';
      recommendations = 'Chiederei a Guerra di privilegiare la preparazione delle forze disponibili, oppure riesaminerei con Tesoro la sostenibilità del loro impiego';
      caution = 'Eviterei nuovi fronti prima di conoscere tempi e copertura: l’impegno militare potrebbe ridurre il margine su altri programmi';
      break;
    case 'diplomacy':
      assessment = 'I rapporti ostili rendono delicata la nostra libertà di manovra esterna';
      recommendations = 'Chiederei agli Esteri di sondare una distensione, oppure cercherei interlocutori alternativi senza promettere intese';
      caution = 'Una rottura potrebbe restringere ulteriormente le opzioni: eviterei mosse che presumano reazioni favorevoli';
      break;
    case 'project':
      assessment = 'Le opere oltre la data attesa richiedono attenzione prima di avviarne altre';
      recommendations = 'Chiederei a Lavori di individuare gli ostacoli, oppure concentrerei la copertura sui programmi completabili prima di aprirne di nuovi';
      caution = 'La dispersione delle risorse potrebbe prolungare i ritardi';
      break;
    default:
      assessment = dominant.reason;
      recommendations = 'Riesaminerei con i ministri gli impegni già presi, oppure confronterei le alternative prima di autorizzarne altri';
      caution = 'Eviterei di scambiare una decisione per un risultato già ottenuto';
  }
  const secondary = signals.find(signal => signal.domain !== dominant.domain && signal.importance >= 2);
  const secondaryAssessment = secondary ? ({ economy: 'Anche le finanze limitano le alternative', food: 'Va protetta anche la copertura alimentare',
    military: 'Va considerata anche la disponibilità operativa delle forze', social: 'Conta anche la tenuta interna', diplomacy: 'Pesano anche i rapporti esterni',
    project: 'Occorre inoltre seguire le opere in ritardo', report: 'I rapporti sugli atti precedenti meritano un riesame',
    decision: 'Le decisioni recenti restano parte del quadro', inaction: 'Restano questioni sulle quali non abbiamo deciso', infrastructure: 'Contano anche i collegamenti disponibili' } satisfies Record<RealitySignalDomain, string>)[secondary.domain] : '';
  const signed = snapshot.recent.signedActs.length ? ` L’atto «${snapshot.recent.signedActs[0].text}» è già firmato, ma i suoi effetti restano da attendere.` : '';
  return `Presidente, ${assessment.charAt(0).toLocaleLowerCase()}${assessment.slice(1)}. ${secondaryAssessment ? `${secondaryAssessment}. ` : ''}${recommendations}. ${caution}.${signed}`;
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

  // ECONOMY — saldo mensile e debito.
  const balance = factNumber('monthlyBalance');
  if (has('monthlyBalance') && balance !== null && balance < 0) {
    push({
      key: 'monthly-balance', domain: 'economy', importance: balance < -1 ? 3 : 2,
      factKeys: ['monthlyBalance', ...(has('treasury') ? ['treasury'] : []), ...(has('debt') ? ['debt'] : [])],
      sourceRefs: [ref('monthlyBalance')].filter(Boolean),
      reason: `saldo mensile ${facts.monthlyBalance.value}`,
    });
  }
  const debt = factNumber('debt');
  const revenue = factNumber('revenue');
  if (has('debt') && debt !== null && revenue !== null && revenue > 0 && debt > revenue * 3) {
    push({
      key: 'debt-burden', domain: 'economy', importance: 2, factKeys: ['debt', 'revenue'],
      sourceRefs: [ref('debt')].filter(Boolean),
      reason: `debito ${facts.debt.value} rispetto a entrate ${facts.revenue.value}`,
    });
  }

  // SOCIAL — tensione e stabilità.
  const tension = factNumber('socialTension');
  if (has('socialTension') && tension !== null && tension >= 55) {
    push({
      key: 'social-tension', domain: 'social', importance: tension >= 70 ? 3 : 2,
      factKeys: ['socialTension'], sourceRefs: [ref('socialTension')].filter(Boolean),
      reason: `tensione sociale ${facts.socialTension.value}`,
    });
  }
  const stability = factNumber('stability');
  if (has('stability') && stability !== null && stability <= 45) {
    push({
      key: 'stability', domain: 'social', importance: stability <= 30 ? 3 : 2,
      factKeys: ['stability'], sourceRefs: [ref('stability')].filter(Boolean),
      reason: `stabilità ${facts.stability.value}`,
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

  // DIPLOMACY — rapporti ostili registrati.
  const hostile = (snapshot.diplomacy.relations ?? []).filter(relation => relation.relationship === 'hostile');
  if (hostile.length) {
    push({
      key: 'hostile-relations', domain: 'diplomacy', importance: hostile.length > 1 ? 3 : 2,
      factKeys: [], sourceRefs: hostile.map(relation => relation.sourceRef).slice(0, 4),
      reason: `${hostile.length === 1 ? 'un rapporto ostile registrato' : `${hostile.length} rapporti ostili registrati`}`,
    });
  }

  // MILITARY — unità reali con prontezza bassa o mobilitazioni in corso.
  const lowReadiness = (snapshot.military.readiness ?? []).filter(entry => entry.value < 0.4);
  if (lowReadiness.length || snapshot.military.mobilizations.length) {
    const refs = lowReadiness.map(entry => `military.units.${entry.unitId}.readiness`);
    push({
      key: 'military-readiness', domain: 'military', importance: lowReadiness.length > 2 ? 3 : 2,
      factKeys: lowReadiness.flatMap(entry => has(`military.units.${entry.unitId}.readiness`) ? [`military.units.${entry.unitId}.readiness`] : []),
      sourceRefs: refs.slice(0, 4),
      reason: snapshot.military.mobilizations.length
        ? 'mobilitazioni registrate in corso'
        : `${lowReadiness.length} reparti con prontezza bassa`,
    });
  }

  // INFRASTRUCTURE — progetti oltre la data attesa (dato canonico del motore).
  const late = (snapshot.economy.ongoingProjects ?? []).filter(project => project.expectedDate && snapshot.date && project.expectedDate < snapshot.date);
  if (late.length) {
    push({
      key: 'late-projects', domain: 'project', importance: 2, factKeys: [],
      sourceRefs: late.map(project => `ongoingProcesses.${project.id}`).slice(0, 4),
      reason: `${late.length} ${late.length === 1 ? 'opera oltre la data attesa' : 'opere oltre la data attesa'}`,
    });
  }

  // Ordinamento deterministico: importanza, poi chiave.
  return signals.sort((left, right) => right.importance - left.importance || left.key.localeCompare(right.key));
}
