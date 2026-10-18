/** Grounded proposal development shared by briefing, conversation and stream.
 * Every completion is revalidated; proposals never mutate the simulation. */
import { CABINET_SEATS } from './Cabinet';
import { ADVISOR_ACTION_PROTOCOL, isPreparatoryCouncilIssue, parseCouncilIssues, serializeCouncilIssues, MAX_BRIEFING_COUNCIL_ISSUES, MAX_COUNCIL_ISSUES, type CouncilIssue } from './CouncilIssue';
import { bestMatchingSituation, parseAdvisorSituations, uncoveredAdvisorSituations, withAdvisorBriefingCoverage, type AdvisorResponse, type AdvisorSituation } from './AdvisorSituations';
import { buildCouncilProposalAnchors } from './CouncilProposalAnchors';
import { guardRealityAdvisorOutput, type RealityAdvisorContext } from './RealityAdvisor';
import { buildRealitySignals } from './RealitySignals';
import { buildStrategicThreadEvidence } from './StrategicThreads';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export const ADVISOR_BRIEFING_REPAIR_SYSTEM = [
  'Sei il Primo Consulente: completa solo le questioni politiche verificate mancanti per questa richiesta. Il Consulente propone alternative; il Consiglio ne verifica la fattibilità prima di qualsiasi atto.',
  'Sviluppa le situazioni indicate: prima un blocco fenced ```advisor_situation con id, title, summary, signalKeys ed evidenceKeys originali (puoi migliorare titolo e sintesi, non cambiare tema o fonti), poi la relativa ```council_issue. Nessuna prosa esterna.',
  'JSON: {"title":"...","question":"...","options":[{"title":"azione 1","content":"..."},{"title":"azione 2","content":"..."},{"title":"azione 3","content":"..."},{"title":"azione 4","content":"..."}],"situationId":"...","signalKeys":["chiave canonica"],"anchorKeys":["chiave canonica"],"evidenceKeys":["chiave del contesto verificato"],"suggestedMinisters":["tesoro"]}. Includi solo le liste di chiavi pertinenti e non vuote.',
  `Ministri ammessi: ${CABINET_SEATS.join(', ')}.`,
  'Ogni questione deve riferirsi a una situazione scoperta e usare situationId uguale alla sua id. Anche le opportunità devono essere già documentate in quelle situazioni; gli anchor descrivono vincoli, non obbligano a nuove schede.',
  'Se la situazione è un segnale urgente, non proporre soltanto studio o monitoraggio: se esiste una vera scelta politica sostenuta dai fatti, sviluppala; altrimenti non forzare una decisione. Una questione concreta per ciascuna situazione validata: il Presidente deve percepire una scelta difficile tra interessi in contrasto, non un elenco di uffici da incaricare. Normalmente 3-5 opzioni, quattro vie davvero differenti se sostenute da fatti. Ogni opzione deve chiarire (1) ordine politico e interlocutore/teatro, (2) obiettivo pratico, (3) costo, reazione plausibile oppure leva persa: cosa cambia se il Presidente sceglie questa via anziché le altre? Condizionali per reazioni e futuri; nessun risultato garantito. Evita ripetizioni e slogan. Le alternative sono proposte, mai azioni autorizzate.',
  'SVILUPPO DELLA SITUAZIONE: nella summary (massimo 600 caratteri) racconta il fatto attestato, gli attori e i loro interessi, il vincolo e la posta della scelta. Mantieni una scena politica specifica del paese, non un bollettino di indicatori. La question esplicita il bivio senza ripetere la sintesi. Non inventare un incidente o un ultimatum per animare la scena.',
  'Sviluppa normalmente quattro strategie distinguibili per strumento o interlocutore, non quattro formulazioni della stessa azione. Un negoziato deve indicare cosa chiediamo e cosa siamo disposti a concedere; una riforma chi sostiene il costo; una scelta militare obiettivo e limite. Se pertinenti, includi una via diplomatica e una scelta interna. Non imporre categorie fuori contesto.',
  ...ADVISOR_ACTION_PROTOCOL,
  'Completa anche le opportunità documentate nelle situazioni scoperte, senza aggiungere temi estranei. Parti dallo scenario del preset, poi dai fatti correnti e dal focus del Presidente.',
  'La decisione deve essere concreta ma NON già risolta. Esempio: scorte militari insufficienti → «Come garantiamo continuità logistica alle forze senza compromettere la sostenibilità finanziaria?». Le alternative devono indicare strumenti coerenti con i mezzi verificati.',
  'Approfondire, monitorare, valutare da soli NON sono decisioni. Esplicita i vincoli di copertura del Tesoro e disponibilità effettiva: niente cifre, spese o capacità inventate.',
  'Usa SOLO fonti canoniche fornite. La premessa del preset è contesto iniziale, non prova di inventari/accordi presenti. Non inventare attori, territori, forze, infrastrutture, risorse o tecnologie fuori epoca.',
  'Non duplicare questioni già presenti o atti firmati. Non inventare cifre, eventi, accordi, ultimatum, perdite o reazioni avvenute per aumentare il dramma: formula soltanto previsioni condizionali e conflitti di interessi tratti dalle prove. Se manca una decisione verificabile non emettere un blocco artificiale. Usa chiavi verificabili presenti in situations.verifiedSignals o anchors: le evidenceKeys verificate sostengono anche council_issue politiche senza allarmi numerici. Copiale dalle situazioni: non agganciare un tema storico a scorte o bilancio estranei solo per ottenere una chiave. Alla data iniziale valgono le questioni documentate ancora aperte; dopo richiedono continuità corrente. Restano contesto politico, mai inventari disponibili o effetti eseguiti.',
].join('\n');

export interface AdvisorBriefingRepairDeps {
  complete: (prompt: string) => Promise<string>;
  onDiscard?: (reason: string, situationId?: string) => void;
  /** Absent for legacy situation-only callers; server-derived for live requests. */
  context?: RealityAdvisorContext;
  message?: string;
  signal?: AbortSignal;
}

function relevantProposalAnchors(snapshot: VerifiedWorldSnapshot, context?: RealityAdvisorContext) {
  const anchors = buildCouncilProposalAnchors(snapshot);
  const focus = context?.focusSituation ?? context?.focusIssue;
  if (!focus) return anchors;
  const signals = buildRealitySignals(snapshot).filter(signal => focus.signalKeys?.includes(signal.key));
  const facts = new Set([...signals.flatMap(signal => signal.factKeys), ...(context?.focusIssue?.verifiedFacts.map(fact => fact.key) ?? [])]);
  const domains = new Set(signals.map(signal => signal.domain));
  return anchors.filter(anchor => domains.has(anchor.domain)
    || anchor.factKeys.some(key => facts.has(key)) || context?.focusIssue?.anchorKeys?.includes(anchor.key));
}

export function buildAdvisorBriefingRepairPrompt(
  snapshot: VerifiedWorldSnapshot,
  uncovered: readonly AdvisorSituation[],
  request?: { context: RealityAdvisorContext; message: string; missingOpportunities: number; existingIssues: readonly CouncilIssue[] },
): string {
  const relevant = relevantProposalAnchors(snapshot, request?.context);
  const signalsByKey = new Map(buildRealitySignals(snapshot).map(signal => [signal.key, signal]));
  const focus = request?.context.focusSituation ?? request?.context.focusIssue;
  // Second phase only: carry verified facts behind the chosen themes, not the
  // entire historical registry again. Evidence keys are looked up server-side.
  const evidence = new Map((request?.context
    ? buildStrategicThreadEvidence(snapshot, request.context.fullStrategicHistory
      ? { ...request.context, resolveFullHistory: true } : request.context)
    : []).map(item => [item.key, item]));
  return JSON.stringify({
    task: 'Per ogni situazione scoperta formula un DILEMMA DI GOVERNO, non un resoconto, con situationId identico e chiavi canoniche risolvibili. Nelle options sviluppa strategie davvero diverse con obiettivo, strumento, prezzo politico e possibili reazioni coerenti con le prove. Non inventare fatti per dare enfasi. Sviluppa la sintesi della situazione e le sue alternative in blocchi advisor_situation e council_issue, con identità e fonti invariate. Non aggiungere altre situazioni.',
    situations: uncovered.map(({ id, title, summary, signalKeys, evidenceKeys }) => ({
      id, title, summary, signalKeys,
      verifiedSignals: signalKeys.flatMap(key => {
        const signal = signalsByKey.get(key);
        return signal ? [{ key, domain: signal.domain, reason: signal.reason,
          facts: signal.factKeys.map(factKey => snapshot.facts[factKey]).filter(Boolean)
            .map(fact => ({ key: fact.key, value: fact.value })) }] : [];
      }),
      ...(evidenceKeys?.length ? {
        evidenceKeys,
        verifiedContext: evidenceKeys.flatMap(key => {
          const item = evidence.get(key);
          return item ? [{ key, kind: item.kind, text: item.text }] : [];
        }),
      } : {}),
    })),
    anchors: relevant.map(anchor => ({ key: anchor.key, domain: anchor.domain, reason: anchor.reason,
      facts: anchor.factKeys.map(key => snapshot.facts[key]).filter(Boolean).map(({ key, label, value }) => ({ key, label, value })),
    })),
    signedActs: snapshot.recent.signedActs.map(({ id, text }) => ({ id, text })),
    ...(request ? { request: {
      message: request.message, preset: request.context.presetContext ? {
        name: request.context.presetContext.name, startDate: request.context.presetContext.startDate,
        premise: request.context.presetContext.premise,
      } : undefined,
      countryName: snapshot.polityName, polityId: snapshot.polityId, currentDate: snapshot.date,
      temporalScope: request.context.temporalScope,
      // Legacy solutions are not input to question repair.
      focus: focus ? { ...focus, options: undefined } : undefined,
      strategicHistory: request.context.strategicHistory,
      missingOpportunities: request.missingOpportunities,
      existingProposals: request.existingIssues.map(({ title, question }) => ({ title: title.slice(0, 120), question: question.slice(0, 300) })),
    } } : {}),
  });
}

export interface AdvisorBriefingRepairOutcome {
  response: AdvisorResponse;
  repairedSituationIds: string[];
  discarded: Array<{ situationId?: string; reason: string }>;
}

export async function repairAdvisorBriefing(
  snapshot: VerifiedWorldSnapshot, result: AdvisorResponse, deps: AdvisorBriefingRepairDeps,
): Promise<AdvisorBriefingRepairOutcome> {
  const uncovered = result.briefingCoverage?.complete === false ? uncoveredAdvisorSituations(result).filter(situation => situation.basis !== 'signal' || (situation.importance ?? 0) >= 2) : [];
  const limit = deps.context?.mode === 'conversation' ? MAX_COUNCIL_ISSUES : MAX_BRIEFING_COUNCIL_ISSUES;
  const headroom = Math.max(0, limit - result.issues.length);
  // Repair authored questions, not every numeric alert or a quota of capacities.
  if (!headroom || !uncovered.length) return { response: result, repairedSituationIds: [], discarded: [] };
  const discarded: AdvisorBriefingRepairOutcome['discarded'] = [];
  const discard = (reason: string, situationId?: string): void => {
    discarded.push({ ...(situationId ? { situationId } : {}), reason });
    if (deps.onDiscard) deps.onDiscard(reason, situationId);
    else console.warn(`[AdvisorBriefing] advisor briefing incomplete situationId=${situationId ?? 'opportunities'} reason=${reason}`);
  };
  let text: string;
  try {
    deps.signal?.throwIfAborted();
    text = await deps.complete(buildAdvisorBriefingRepairPrompt(snapshot, uncovered, deps.context ? {
      context: deps.context, message: deps.message ?? '', missingOpportunities: 0, existingIssues: result.issues,
    } : undefined));
    deps.signal?.throwIfAborted();
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    for (const situation of uncovered) discard('Completion di proposte non riuscita', situation.id);
    return { response: result, repairedSituationIds: [], discarded };
  }
  const parsed = parseCouncilIssues(snapshot, text, 'advisor', { maxIssues: limit, strategicContext: deps.context, onDiscard: reason => discard(reason) });
  const uncoveredById = new Map(uncovered.map(situation => [situation.id, situation]));
  const accepted: CouncilIssue[] = [];
  const issueIds = new Set(result.issues.map(issue => issue.id));
  for (const issue of parsed.issues) {
    if (issueIds.has(issue.id)) { discard('Identificativo di proposta duplicato', issue.situationId); continue; }
    issueIds.add(issue.id);
    const prose = `${issue.title}\n${issue.question}`;
    if (deps.context && guardRealityAdvisorOutput(deps.context, prose) !== prose) {
      discard('Proposta contraddice lo stato verificato', issue.situationId); continue;
    }
    if (isPreparatoryCouncilIssue(issue)) { discard('Proposta istruttoria, non una decisione', issue.situationId); continue; }
    if (issue.situationId) {
      if (!uncoveredById.has(issue.situationId)) { discard('situationId ignoto o già coperto', issue.situationId); continue; }
      accepted.push(issue);
    } else {
      const match = bestMatchingSituation(issue, uncovered);
      if (!match) { discard('Nessuna situazione scoperta o opportunità canonica corrispondente'); continue; }
      accepted.push({ ...issue, situationId: match.id });
    }
  }
  // Reuse canonical question/signed-act dedup across original + repair blocks.
  const existingById = new Map(result.issues.map(issue => [issue.id, issue]));
  const mergedIssues = parseCouncilIssues(snapshot, serializeCouncilIssues({ reply: '', issues: [...result.issues, ...accepted] }), 'advisor', { maxIssues: limit, strategicContext: deps.context, onDiscard: reason => discard(reason) }).issues
    .map(issue => existingById.get(issue.id) ?? issue);
  // Only refine an already validated thread; do not let development change its identity/sources.
  const refinements = parseAdvisorSituations(snapshot, text, { strategicContext: deps.context, onDiscard: reason => discard(reason) }).situations;
  const sameKeys = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every(key => b.includes(key));
  const situations = result.situations.map(original => {
    const refined = refinements.find(item => item.id === original.id
      && sameKeys(item.signalKeys, original.signalKeys) && sameKeys(item.evidenceKeys, original.evidenceKeys));
    if (!refined || !mergedIssues.some(issue => issue.situationId === original.id)) return original;
    const prose = `${refined.title}\n${refined.summary}`;
    if (deps.context && guardRealityAdvisorOutput(deps.context, prose) !== prose) return original;
    return { ...original, title: refined.title, summary: refined.summary };
  });
  const merged = { ...result, situations, issues: mergedIssues };
  const response = result.briefingCoverage ? withAdvisorBriefingCoverage(snapshot, merged) : merged;
  for (const situation of uncoveredAdvisorSituations(response).filter(situation => situation.basis !== 'signal' || (situation.importance ?? 0) >= 2)) discard('Nessuna decisione verificabile dal repair', situation.id);
  return { response, repairedSituationIds: [...new Set(response.issues.filter(issue => !existingById.has(issue.id)).flatMap(issue => issue.situationId ? [issue.situationId] : []))], discarded };
}

/** The agenda is a plan, not finished prose. Give each political thread its own
 * development call so later items do not compete for a single output budget.
 * Two workers bound provider pressure; only incomplete items receive one retry. */
export async function developAdvisorBriefing(
  snapshot: VerifiedWorldSnapshot, agenda: AdvisorResponse, deps: AdvisorBriefingRepairDeps,
): Promise<AdvisorResponse> {
  // Urgent verified signals may also justify a real choice; routine indicators do not.
  const threads = agenda.situations.filter(situation => situation.basis !== 'signal' || (situation.importance ?? 0) >= 2);
  const developed: AdvisorResponse[] = new Array(threads.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < threads.length) {
      deps.signal?.throwIfAborted();
      const index = cursor++;
      const situation = threads[index];
      const initial = withAdvisorBriefingCoverage(snapshot, { reply: '', situations: [situation], issues: [] });
      let best = initial;
      let feedback: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const outcome = await repairAdvisorBriefing(snapshot, initial, {
          ...deps,
          complete: prompt => deps.complete(JSON.stringify({ ...JSON.parse(prompt),
            agenda: threads.map(({ id, title }) => ({ id, title })),
            ...(attempt ? { revision: { instruction: 'La precedente elaborazione non ha prodotto alternative valide. Correggi solo questa situazione e restituisci i blocchi completi.', reasons: feedback } } : {}),
          })),
        });
        const options = outcome.response.issues.find(issue => issue.situationId === situation.id)?.options ?? [];
        const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const score = (response: AdvisorResponse) => Math.max(0, ...response.issues.map(issue => {
          const choices = issue.options ?? [];
          return 1 + Math.min(new Set(choices.map(option => normalize(option.content))).size, new Set(choices.map(option => normalize(option.title))).size);
        }));
        if (score(outcome.response) >= score(best)) best = outcome.response;
        const distinct = new Set(options.map(option => normalize(option.content))).size === options.length
          && new Set(options.map(option => normalize(option.title))).size === options.length;
        if (options.length >= 3 && distinct) break;
        feedback = [...outcome.discarded.map(item => item.reason), 'Servono strategie distinte e sviluppate nelle options; normalmente almeno tre, senza duplicati o fonti inventate.'];
      }
      developed[index] = best;
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, threads.length) }, () => worker()));
  const byId = new Map(developed.flatMap(item => item.situations.map(situation => [situation.id, situation] as const)));
  const issues = parseCouncilIssues(snapshot, serializeCouncilIssues({ reply: '', issues: developed.flatMap(item => item.issues) }), 'advisor', {
    maxIssues: MAX_BRIEFING_COUNCIL_ISSUES, strategicContext: deps.context, onDiscard: deps.onDiscard,
  }).issues;
  return withAdvisorBriefingCoverage(snapshot, { ...agenda,
    situations: agenda.situations.map(situation => byId.get(situation.id) ?? situation), issues,
  });
}
