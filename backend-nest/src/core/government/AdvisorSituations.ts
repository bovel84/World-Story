/**
 * WS-CONSULENTE-SITUAZIONI — La SITUAZIONE è un oggetto di prima classe,
 * distinto dalla PROPOSTA (`CouncilIssue`).
 *
 * Una `AdvisorSituation` è ciò che merita attenzione nel paese: nasce SEMPRE da
 * una `RealitySignal` canonica del `VerifiedWorldSnapshot`. Il modello può
 * proporne titolo e sintesi, ma il server risolve le `signalKeys` contro i
 * segnali REALI: una chiave ignota invalida la scheda. La derivazione
 * deterministica resta la base, così il modello non può far sparire un problema
 * reale né inventarne uno che il motore non ha misurato.
 *
 * `parseAdvisorResponse` è il punto unico che separa `situations` da `issues`:
 * una situazione NON crea automaticamente una CouncilIssue.
 */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { buildRealitySignals, type RealitySignal } from './RealitySignals';
import { parseCouncilIssues, type CouncilIssue, type CouncilIssueOrigin, type CouncilIssueParseOptions } from './CouncilIssue';
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
 *  `signalKeys` ha lunghezza ESATTAMENTE 1: una situazione rappresenta un solo
 *  problema canonico (Sudan e Congo restano due situazioni distinte). Un problema
 *  sistemico deve essere un singolo `RealitySignal` sistemico. */
export const advisorSituationInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(600),
  signalKeys: z.array(key).length(1),
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
  const seen = new Set<string>();
  const reply = text.replace(/```advisor_situation\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (situations.length < MAX_ADVISOR_SITUATIONS) {
        const situation = resolveAdvisorSituation(snapshot, JSON.parse(json.trim()));
        const dedupe = situation.signalKeys.slice().sort().join('|');
        if (!seen.has(dedupe)) { seen.add(dedupe); situations.push(situation); }
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

/** La base deterministica resta: il modello non nasconde un segnale reale. */
export function mergeAdvisorSituations(snapshot: VerifiedWorldSnapshot, model: readonly AdvisorSituation[]): AdvisorSituation[] {
  const base = buildAdvisorSituations(snapshot);
  if (!model.length) return base;
  const covered = new Set(model.flatMap(situation => situation.signalKeys));
  const seen = new Set<string>();
  return [...model, ...base.filter(situation => !situation.signalKeys.some(key => covered.has(key)))]
    .sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title))
    .filter(situation => {
      const dedupe = situation.signalKeys.slice().sort().join('|');
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    })
    .slice(0, MAX_ADVISOR_SITUATIONS);
}

export interface AdvisorResponse {
  reply: string;
  situations: AdvisorSituation[];
  issues: CouncilIssue[];
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
  const parsedIssues = parseCouncilIssues(snapshot, parsedSituations.reply, origin, options);
  return {
    reply: parsedIssues.reply,
    situations: options.includeDeterministicSituations
      ? mergeAdvisorSituations(snapshot, parsedSituations.situations)
      : parsedSituations.situations,
    issues: parsedIssues.issues,
  };
}

/** Serializza entrambi i tipi di blocco: il round-trip interno li conserva distinti. */
export function serializeAdvisorResponse(result: AdvisorResponse): string {
  return [
    result.reply,
    ...result.situations.map(situation => `\`\`\`advisor_situation\n${JSON.stringify(situation)}\n\`\`\``),
    ...result.issues.map(issue => `\`\`\`council_issue\n${JSON.stringify(issue)}\n\`\`\``),
  ].filter(Boolean).join('\n\n');
}
