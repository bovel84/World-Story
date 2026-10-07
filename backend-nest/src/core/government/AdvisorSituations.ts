/**
 * WS-CONSULENTE-SITUAZIONI — La SITUAZIONE è un oggetto di prima classe,
 * distinto dalla PROPOSTA (`CouncilIssue`).
 *
 * Una `AdvisorSituation` è ciò che merita attenzione nel paese: nasce SEMPRE da
 * una o più `RealitySignal` canoniche del `VerifiedWorldSnapshot`. Il modello
 * scrive titolo e sintesi e può raggruppare più segnali quando raccontano lo
 * stesso problema politico; il server risolve le `signalKeys` contro i segnali
 * REALI: una chiave ignota invalida la scheda. La derivazione deterministica
 * resta la base, così il modello non può far sparire un problema reale né
 * inventarne uno che il motore non ha misurato.
 *
 * `parseAdvisorResponse` è il punto unico che separa `situations` da `issues`:
 * una situazione NON crea automaticamente una CouncilIssue.
 */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { buildRealitySignals, type RealitySignal } from './RealitySignals';
import { MAX_BRIEFING_COUNCIL_ISSUES, isPreparatoryCouncilIssue, parseCouncilIssues, type CouncilIssue, type CouncilIssueOrigin, type CouncilIssueParseOptions } from './CouncilIssue';
import { buildCouncilProposalAnchors } from './CouncilProposalAnchors';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export interface AdvisorSituation {
  id: string;
  title: string;
  summary: string;
  /** Chiavi dei segnali canonici: il server le ricalcola, mai il client. */
  signalKeys: string[];
  /** 1 = marginale, 2 = rilevante, 3 = critico. Derivata dai segnali, non dal modello. */
  importance: number;
}

/** Cap tecnico di sicurezza: non è una quota da riempire. */
export const MAX_ADVISOR_SITUATIONS = 24;

const key = z.string().trim().min(1).max(240);
/** Il modello fornisce titolo, sintesi e chiavi; la gravità è ricalcolata dal server.
 *  `signalKeys` va da 1 a 5: una situazione politica può nascere da più fatti
 *  canonici (la sicurezza nel nord = stabilità + prontezza + rifornimenti +
 *  rapporti col Sudan), ma ogni chiave deve risolversi contro i `RealitySignals`.
 *  Due problemi distinti (Sudan e Congo) restano due situazioni. */
export const advisorSituationInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(600),
  signalKeys: z.array(key).min(1).max(5),
});

/** WS-CONSULENTE-SITUAZIONI — Focus canonico di un approfondimento: UNA sola
 *  signalKey. Titolo e sintesi del client NON sono fonte di fatti. */
export const focusSituationInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  signalKey: key,
});

export class InvalidAdvisorSituationError extends Error {
  constructor(message = 'Situazione non valida: chiavi di segnale canoniche richieste') {
    super(message); this.name = 'InvalidAdvisorSituationError';
  }
}

/** Fail closed: ogni chiave ignota invalida la scheda, mai accettata in parte. */
function resolveSignalLinks(snapshot: VerifiedWorldSnapshot, signalKeys: readonly string[]): { signalKeys: string[]; signals: RealitySignal[] } {
  const byKey = new Map(buildRealitySignals(snapshot).map(signal => [signal.key, signal]));
  const resolved: string[] = [];
  const signals: RealitySignal[] = [];
  for (const signalKey of signalKeys) {
    const signal = byKey.get(signalKey);
    if (!signal) throw new InvalidAdvisorSituationError(`Unknown reality signal key: ${signalKey}`);
    if (resolved.includes(signalKey)) continue;
    resolved.push(signalKey);
    signals.push(signal);
  }
  return { signalKeys: resolved, signals };
}

export function resolveAdvisorSituation(snapshot: VerifiedWorldSnapshot, raw: unknown): AdvisorSituation {
  const parsed = advisorSituationInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAdvisorSituationError();
  const input = parsed.data;
  const { signalKeys, signals } = resolveSignalLinks(snapshot, input.signalKeys);
  if (!signals.length) throw new InvalidAdvisorSituationError();
  const importance = signals.reduce((max, signal) => Math.max(max, signal.importance), 1);
  return {
    id: input.id ?? `situation-${shortId()}`,
    title: input.title,
    summary: input.summary,
    signalKeys,
    importance,
  };
}

/**
 * Risolve il focus dell'approfondimento sul SOLO segnale canonico: il client
 * manda una signalKey, il server ricostruisce titolo e sintesi dal motore. Una
 * chiave ignota (o assente) fallisce chiuso.
 */
export function resolveFocusSituation(snapshot: VerifiedWorldSnapshot, raw: unknown): AdvisorSituation {
  const parsed = focusSituationInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAdvisorSituationError();
  const signal = buildRealitySignals(snapshot).find(candidate => candidate.key === parsed.data.signalKey);
  if (!signal) throw new InvalidAdvisorSituationError(`Unknown reality signal key: ${parsed.data.signalKey}`);
  return {
    id: parsed.data.id ?? `situation-${signal.key}`,
    title: signalSituationTitle(signal),
    summary: signal.reason,
    signalKeys: [signal.key],
    importance: signal.importance,
  };
}

/**
 * Titolo concreto e specifico del problema reale (mai «Economia» o «Difesa»).
 * Con un soggetto canonico (polity, opera) cita direttamente l'entità.
 */
export function signalSituationTitle(signal: RealitySignal): string {
  if (signal.title) return signal.title;
  if (signal.subject) {
    switch (signal.domain) {
      case 'diplomacy': return `Tensioni con ${signal.subject}`;
      case 'project': return `Ritardo: ${signal.subject}`;
      case 'military': return `Fronte con ${signal.subject}`;
      default: return signal.subject;
    }
  }
  switch (signal.key) {
    case 'food-coverage': return 'Scorte alimentari sotto soglia';
    case 'monthly-balance': return 'Bilancio mensile in deficit';
    case 'debt-burden': return 'Peso degli interessi sul debito';
    case 'cash-runway': return 'Cassa insufficiente per il disavanzo';
    case 'economy-change': return 'Variazione delle finanze';
    case 'social-tension': return 'Tensione sociale';
    case 'stability': return 'Stabilità interna';
    case 'military-readiness': return 'Prontezza delle forze';
    case 'military-mobilization': return 'Mobilizzazione in corso';
    case 'military-change': return 'Variazione delle forze';
    case 'military-operations': return 'Operazioni militari in corso';
    case 'late-projects': return 'Opere oltre la data attesa';
    case 'follow-ups': return 'Rapporti su atti precedenti';
    case 'inaction': return 'Decisioni non prese';
    case 'hostile-relations': return 'Rapporti ostili con i vicini';
    default: return signal.reason;
  }
}

/**
 * Una situazione deterministica per ogni segnale realmente misurato (zero se
 * non c'è nulla). Le decisioni già prese non sono problemi da approfondire.
 */
export function buildAdvisorSituations(snapshot: VerifiedWorldSnapshot, max = MAX_ADVISOR_SITUATIONS): AdvisorSituation[] {
  return buildRealitySignals(snapshot)
    .filter(signal => signal.domain !== 'decision')
    .slice(0, Math.max(0, max))
    .map(signal => ({
      id: `situation-${signal.key}`,
      title: signalSituationTitle(signal),
      summary: signal.reason,
      signalKeys: [signal.key],
      importance: signal.importance,
    }));
}

/** Estrae e valida i blocchi `advisor_situation`; le chiavi ignote scartano la scheda. */
export function parseAdvisorSituations(snapshot: VerifiedWorldSnapshot, text: string, options: CouncilIssueParseOptions = {}): { reply: string; situations: AdvisorSituation[] } {
  const situations: AdvisorSituation[] = [];
  const reply = text.replace(/```advisor_situation\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (situations.length < MAX_ADVISOR_SITUATIONS) {
        const situation = resolveAdvisorSituation(snapshot, JSON.parse(json.trim()));
        // Dedup sull'identità del problema (sovrapposizione di signalKeys), non sul titolo.
        if (!situations.some(existing => situationsOverlap(existing, situation))) situations.push(situation);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (options.onDiscard) options.onDiscard(reason);
      else console.warn(`[AdvisorSituation] situazione scartata: ${reason}`);
    }
    return '';
  }).trim();
  return { reply, situations };
}

/** Dedup semplice e identitaria, senza embedding né chiamate LLM.
 *  Duplicato se le due schede hanno lo stesso insieme di chiavi oppure se
 *  condividono ≥ 2 signalKeys con Jaccard ≥ 0.5. Una singola chiave generica
 *  condivisa (o un contenimento con una sola chiave) NON basta, e il titolo non
 *  conta: due situazioni diverse sulla stessa chiave generica restano distinte. */
export function situationsOverlap(left: Pick<AdvisorSituation, 'signalKeys'>, right: Pick<AdvisorSituation, 'signalKeys'>): boolean {
  const a = new Set(left.signalKeys);
  const b = new Set(right.signalKeys);
  if (a.size === 0 || b.size === 0) return false;
  if (a.size === b.size && [...a].every(signalKey => b.has(signalKey))) return true;
  let shared = 0;
  for (const signalKey of a) if (b.has(signalKey)) shared += 1;
  if (shared < 2) return false;
  return shared / (a.size + b.size - shared) >= 0.5;
}

/** Associazione deterministica proposta → situazione, senza embedding e senza
 *  nuove chiamate LLM. Match solo se la primary della proposta coincide con la
 *  primary della situazione, oppure se condividono ≥ 2 signalKeys con Jaccard
 *  ≥ 0.5. Una sola chiave generica condivisa non basta mai. */
export function proposalMatchesSituation(
  issue: Pick<CouncilIssue, 'signalKeys' | 'anchorKeys'>,
  situation: Pick<AdvisorSituation, 'signalKeys'>,
): boolean {
  const proposal = issue.signalKeys ?? [];
  if (proposal.length === 0) return false;
  if (proposal[0] === situation.signalKeys[0]) return true;
  const situationKeys = new Set(situation.signalKeys);
  let shared = 0;
  for (const signalKey of proposal) if (situationKeys.has(signalKey)) shared += 1;
  if (shared < 2) return false;
  return shared / new Set([...proposal, ...situation.signalKeys]).size >= 0.5;
}

/** Punteggio per scegliere LA situazione migliore di una proposta: primary
 *  (dominante), poi chiavi condivise, poi Jaccard. Numerico per confronto stabile. */
function proposalMatchScore(issue: Pick<CouncilIssue, 'signalKeys'>, situation: Pick<AdvisorSituation, 'signalKeys'>): number {
  const proposal = issue.signalKeys ?? [];
  const situationKeys = new Set(situation.signalKeys);
  let shared = 0;
  for (const signalKey of proposal) if (situationKeys.has(signalKey)) shared += 1;
  const union = new Set([...proposal, ...situation.signalKeys]).size || 1;
  return (proposal[0] === situation.signalKeys[0] ? 1 : 0) * 1_000 + shared * 10 + shared / union;
}

/** La base deterministica resta: il modello non nasconde un segnale reale. */
export function mergeAdvisorSituations(snapshot: VerifiedWorldSnapshot, model: readonly AdvisorSituation[]): AdvisorSituation[] {
  const base = buildAdvisorSituations(snapshot);
  if (!model.length) return base;
  const covered = new Set(model.flatMap(situation => situation.signalKeys));
  const kept: AdvisorSituation[] = [];
  return [...model, ...base.filter(situation => !situation.signalKeys.some(key => covered.has(key)))]
    .sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title))
    .filter(situation => {
      if (kept.some(existing => situationsOverlap(existing, situation))) return false;
      kept.push(situation);
      return true;
    })
    .slice(0, MAX_ADVISOR_SITUATIONS);
}

export interface AdvisorResponse {
  reply: string;
  situations: AdvisorSituation[];
  issues: CouncilIssue[];
  /** Solo briefing: copertura ricalcolata dopo tutti i filtri, mai dichiarata dal modello. */
  briefingCoverage?: { complete: boolean; missingSignalKeys: string[]; missingOpportunity: boolean };
}

/** Calcola SOLO metadati di copertura per test, log e debug. NON modifica
 *  `reply`: la prosa del Consulente resta naturale e non espone terminologia
 *  interna («Briefing incompleto», signalKey, coverage).
 *
 *  Ogni proposta seleziona al massimo UNA situazione (la migliore: primary, poi
 *  chiavi condivise, poi Jaccard); una situazione è coperta se almeno una
 *  proposta la seleziona. Nessuna proposta viene fabbricata. */
export function withAdvisorBriefingCoverage(snapshot: VerifiedWorldSnapshot, result: AdvisorResponse): AdvisorResponse {
  const covered = new Set<number>();
  for (const issue of result.issues) {
    let bestIndex = -1;
    let bestScore = -1;
    result.situations.forEach((situation, index) => {
      if (!proposalMatchesSituation(issue, situation)) return;
      const score = proposalMatchScore(issue, situation);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex >= 0) covered.add(bestIndex);
  }
  // Ordine stabile anche dopo la serializzazione: nessun avviso duplicato al round-trip.
  const missing = result.situations
    .filter((_, index) => !covered.has(index))
    .sort((left, right) => left.signalKeys[0].localeCompare(right.signalKeys[0]));
  const opportunityKeys = new Set(buildCouncilProposalAnchors(snapshot).filter(anchor => anchor.domain !== 'decision').map(anchor => anchor.key));
  const missingOpportunity = result.situations.length === 0
    && !result.issues.some(issue => issue.anchorKeys?.some(key => opportunityKeys.has(key)));
  return { ...result, briefingCoverage: {
    complete: missing.length === 0 && !missingOpportunity,
    missingSignalKeys: missing.flatMap(situation => situation.signalKeys),
    missingOpportunity,
  } };
}

/**
 * `includeDeterministicSituations` decide se la risposta espone l'INTERA lista
 * deterministica delle situazioni correnti (`buildAdvisorSituations`).
 *
 * - `true` — solo apertura/turn briefing/fallback iniziale: la lista completa.
 * - `false` (default) — chat normale e approfondimento: solo le eventuali nuove
 *   situazioni emerse dal modello, oppure nessuna. Non si ripubblica la lista a
 *   ogni messaggio.
 */
export type AdvisorResponseParseOptions = CouncilIssueParseOptions & { includeDeterministicSituations?: boolean };

/** Punto unico del Consulente: situazioni e proposte restano separate. */
export function parseAdvisorResponse(snapshot: VerifiedWorldSnapshot, text: string, origin: CouncilIssueOrigin = 'advisor', options: AdvisorResponseParseOptions = {}): AdvisorResponse {
  const parsedSituations = parseAdvisorSituations(snapshot, text, options);
  const briefing = Boolean(options.includeDeterministicSituations) && (origin === 'advisor' || origin === 'president');
  const parsedIssues = parseCouncilIssues(snapshot, parsedSituations.reply, origin, {
    ...options, ...(briefing ? { maxIssues: MAX_BRIEFING_COUNCIL_ISSUES } : {}),
  });
  const result: AdvisorResponse = {
    reply: parsedIssues.reply,
    situations: options.includeDeterministicSituations
      ? mergeAdvisorSituations(snapshot, parsedSituations.situations)
      : parsedSituations.situations,
    // Il Consulente scarta le proposte solo istruttorie; i ministri restano invariati.
    issues: origin === 'advisor' || origin === 'president'
      ? parsedIssues.issues.filter(issue => !isPreparatoryCouncilIssue(issue))
      : parsedIssues.issues,
  };
  return briefing ? withAdvisorBriefingCoverage(snapshot, result) : result;
}

/** Serializza entrambi i tipi di blocco: il round-trip interno li conserva distinti. */
export function serializeAdvisorResponse(result: AdvisorResponse): string {
  return [
    result.reply,
    ...result.situations.map(situation => `\`\`\`advisor_situation\n${JSON.stringify(situation)}\n\`\`\``),
    ...result.issues.map(issue => `\`\`\`council_issue\n${JSON.stringify(issue)}\n\`\`\``),
  ].filter(Boolean).join('\n\n');
}
