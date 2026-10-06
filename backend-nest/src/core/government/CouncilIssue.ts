/** A discussion proposal, never an engine mutation or a Pressure. */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { CABINET_SEATS, type CabinetSeat } from './Cabinet';
import { buildRealitySignals } from './RealitySignals';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import type { SituationBrief } from './MinisterOpening';

export type CouncilIssueOrigin = 'advisor' | 'president' | 'minister' | 'event' | 'follow-up';
export interface CouncilIssue {
  id: string;
  title: string;
  question: string;
  /** Chiavi dei segnali canonici che hanno originato la scheda (ricalcolabili dal server). */
  signalKeys?: string[];
  verifiedFacts: Array<{ key: string; label: string; value: string; source: string; sourceRef: string }>;
  suggestedMinisters: CabinetSeat[];
  origin: CouncilIssueOrigin;
  sourceRefs: string[];
  createdDate: string;
}

const key = z.string().trim().min(1).max(240);
/** `factKeys` (legacy) o `signalKeys` (collegamento canonico a una RealitySignal).
 *  Labels, valori e sourceRefs del modello sono sempre scartati. */
export const councilIssueInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(600),
  // Liste vuote ammesse: una issue con soli signalKeys torna dal client con
  // `verifiedFacts: []`. La presence di almeno una fonte è richiesta dal refine.
  factKeys: z.array(key).max(24).optional(),
  verifiedFacts: z.array(z.object({ key })).max(24).optional(),
  signalKeys: z.array(key).min(1).max(24).optional(),
  suggestedMinisters: z.array(z.enum(CABINET_SEATS)).min(1).max(7),
  origin: z.enum(['advisor', 'president', 'minister', 'event', 'follow-up']).optional(),
}).refine(value => Boolean(value.factKeys?.length || value.verifiedFacts?.length || value.signalKeys?.length), { message: 'Verified fact keys or signal keys required' });

export class InvalidCouncilIssueError extends Error {
  constructor(message = 'Council issue non valida: chiavi di fatto o di segnale richieste') {
    super(message); this.name = 'InvalidCouncilIssueError';
  }
}

/** Il server risolve le `signalKeys` contro i segnali REALI: mai fidarsi del modello. */
function resolveSignalLinks(snapshot: VerifiedWorldSnapshot, signalKeys: readonly string[]): { signalKeys: string[]; factKeys: string[]; sourceRefs: string[] } {
  const resolved: string[] = [];
  const factKeys: string[] = [];
  const sourceRefs: string[] = [];
  if (!signalKeys.length) return { signalKeys: resolved, factKeys, sourceRefs };
  const byKey = new Map(buildRealitySignals(snapshot).map(signal => [signal.key, signal]));
  for (const signalKey of signalKeys) {
    const signal = byKey.get(signalKey);
    if (!signal) throw new InvalidCouncilIssueError(`Unknown reality signal key: ${signalKey}`);
    if (resolved.includes(signalKey)) continue;
    resolved.push(signalKey);
    factKeys.push(...signal.factKeys);
    sourceRefs.push(...signal.sourceRefs);
  }
  return { signalKeys: resolved, factKeys, sourceRefs };
}

/** Fail closed on ANY unknown key, never partially accept a fact list. */
export function resolveCouncilIssue(snapshot: VerifiedWorldSnapshot, raw: unknown, origin?: CouncilIssueOrigin): CouncilIssue {
  const parsed = councilIssueInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidCouncilIssueError();
  const input = parsed.data;
  const linked = resolveSignalLinks(snapshot, input.signalKeys ?? []);
  // If several representations were supplied, none may smuggle an unknown key.
  const keys = [...new Set([...(input.factKeys ?? []), ...(input.verifiedFacts ?? []).map(fact => fact.key), ...linked.factKeys])];
  const verifiedFacts = keys.map(key => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.facts, key)) throw new InvalidCouncilIssueError(`Unknown verified fact key: ${key}`);
    const fact = snapshot.facts[key];
    return { key: fact.key, label: fact.label, value: fact.value, source: fact.source, sourceRef: fact.sourceRef };
  });
  // I riferimenti sono SEMPRE canonici: solo quelli della signal, mai quelli del modello.
  const sourceRefs = [...new Set([...verifiedFacts.map(fact => fact.sourceRef), ...linked.sourceRefs])];
  // Una signal canonica senza factKeys resta valida se porta un riferimento canonico.
  if (!verifiedFacts.length && !sourceRefs.length) throw new InvalidCouncilIssueError('Council issue senza fatto né riferimento canonico');
  return {
    id: input.id ?? `issue-${shortId()}`, title: input.title, question: input.question,
    // Si conservano SOLO le signalKeys realmente risolte (deduplicate): il
    // round-trip del client non può aggiungere chiavi inventate.
    ...(linked.signalKeys.length ? { signalKeys: linked.signalKeys } : {}),
    verifiedFacts, suggestedMinisters: [...new Set(input.suggestedMinisters)],
    origin: origin ?? input.origin ?? 'advisor', sourceRefs,
    createdDate: snapshot.date ?? 'unknown',
  };
}

/** Cap tecnico di sicurezza: NON è una quota da riempire, solo un limite anti-abuso. */
export const MAX_COUNCIL_ISSUES = 8;

export const COUNCIL_ISSUE_PROTOCOL = [
  'Puoi proporre questioni interministeriali, NON aprire una seduta o creare una crisi. Il Presidente decide se portarle al Consiglio.',
  'Se nel testo identifichi una questione concreta che richiede una decisione del Presidente o del Governo, DEVI emettere anche la relativa scheda fenced ```council_issue, una per ogni questione distinta, con JSON {"title":"...","question":"...","signalKeys":["chiave-segnale canonica"],"suggestedMinisters":["lavori","tesoro"]}. Un turno senza decisioni può avere zero schede: solo allora non proporre nulla.',
  'Proponi tutte e sole le questioni strategiche realmente distinte e salienti che meritano una decisione: possono essere nessuna, una o più di tre. Non duplicare lo stesso problema e non creare questioni per riempire una quota. Ogni questione deve poter essere portata separatamente al Consiglio, con fatti canonici a sostegno e solo ministri pertinenti alla domanda.',
  `Sedie ammesse: ${CABINET_SEATS.join(', ')}. Usa solo chiavi presenti in facts del VerifiedWorldSnapshot se ricorri a factKeys; per il collegamento canonico preferisci signalKeys presi dai SEGNALI DEL MOMENTO / CURRENT STRATEGIC SIGNALS. Niente valori, sourceRefs, fatti nuovi, costi inventati, opzioni Pressure o effetti.`,
  'Per una nuova opera distingui intenzione e inventario esistente; Lavori verifica tracciato e materiali, Tesoro la copertura. Una proposta non certifica fattibilità o autorizzazione.',
].join('\n');

/** Conservative identity, not semantic similarity: shared facts/ministers/titles are not duplicates. */
function councilQuestionKey(question: string): string {
  return question.normalize('NFKC').toLowerCase().trim()
    .replace(/[.!?…]+$/u, '').trim().replace(/\s+/g, ' ');
}

/** Strip invalid/unfinished/duplicate proposals; model text never supplies canonical facts. */
export interface CouncilIssueParseOptions {
  /** Motivo dello scarto: callback per i test, altrimenti il server logga. */
  onDiscard?: (reason: string) => void;
}

export function parseCouncilIssues(snapshot: VerifiedWorldSnapshot, text: string, origin: CouncilIssueOrigin = 'advisor', options: CouncilIssueParseOptions = {}): { reply: string; issues: CouncilIssue[] } {
  const issues: CouncilIssue[] = [];
  const questions = new Set<string>();
  const reply = text.replace(/```council_issue\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (issues.length < MAX_COUNCIL_ISSUES) {
        const issue = resolveCouncilIssue(snapshot, JSON.parse(json.trim()), origin);
        const questionKey = councilQuestionKey(issue.question) || issue.question;
        if (!questions.has(questionKey)) {
          questions.add(questionKey);
          issues.push(issue);
        }
      }
    } catch (error) {
      // Mai in silenzio: il motivo dello scarto resta leggibile.
      const reason = error instanceof Error ? error.message : String(error);
      if (options.onDiscard) options.onDiscard(reason);
      else console.warn(`[CouncilIssue] proposta scartata: ${reason}`);
    }
    return '';
  }).trim();
  return { reply, issues };
}

/** Legacy text/plain transports keep ONLY server-validated issue blocks. */
export function serializeCouncilIssues(result: { reply: string; issues: CouncilIssue[] }): string {
  return [result.reply, ...result.issues.map(issue => `\`\`\`council_issue\n${JSON.stringify(issue)}\n\`\`\``)].filter(Boolean).join('\n\n');
}

/** Title/question are discussion, the facts are canonical and there is no option menu. */
export function councilIssueSituation(issue: CouncilIssue): SituationBrief {
  return {
    factsVerified: true,
    title: issue.title, briefing: 'Tema proposto per la discussione; i fatti correnti sono elencati separatamente.',
    decisionQuestion: issue.question,
    verifiedFacts: issue.verifiedFacts.map(fact => `${fact.label}: ${fact.value}`),
    source: issue.sourceRefs.join('; '), suggestedMinisters: issue.suggestedMinisters, originType: issue.origin,
  };
}
