/** A discussion proposal, never an engine mutation or a Pressure. */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { CABINET_SEATS, type CabinetSeat } from './Cabinet';
import { buildRealitySignals } from './RealitySignals';
import { buildCouncilProposalAnchors } from './CouncilProposalAnchors';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import type { SituationBrief } from './MinisterOpening';

export type CouncilIssueOrigin = 'advisor' | 'president' | 'minister' | 'event' | 'follow-up';
export interface CouncilIssue {
  id: string;
  title: string;
  question: string;
  /** Chiavi dei segnali canonici che hanno originato la scheda (ricalcolabili dal server). */
  signalKeys?: string[];
  /** Chiavi degli anchor canonici (opportunità) che hanno originato la scheda. */
  anchorKeys?: string[];
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
  // `anchorKeys` (opportunità): stessa disciplina delle signalKeys, namespace
  // distinto per non confondere «ciò che merita attenzione» con «ciò che può
  // sostenere una proposta». Il server risolve sempre factKeys/sourceRefs.
  anchorKeys: z.array(key).min(1).max(24).optional(),
  suggestedMinisters: z.array(z.enum(CABINET_SEATS)).min(1).max(7),
  origin: z.enum(['advisor', 'president', 'minister', 'event', 'follow-up']).optional(),
}).refine(value => Boolean(value.factKeys?.length || value.verifiedFacts?.length || value.signalKeys?.length || value.anchorKeys?.length), { message: 'Verified fact keys or signal keys required' });

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

/** Gli anchor si risolvono come le signal: chiave ignota → reject, fatti ricalcolati. */
function resolveAnchorLinks(snapshot: VerifiedWorldSnapshot, anchorKeys: readonly string[]): { anchorKeys: string[]; factKeys: string[]; sourceRefs: string[] } {
  const resolved: string[] = [];
  const factKeys: string[] = [];
  const sourceRefs: string[] = [];
  if (!anchorKeys.length) return { anchorKeys: resolved, factKeys, sourceRefs };
  const byKey = new Map(buildCouncilProposalAnchors(snapshot).map(anchor => [anchor.key, anchor]));
  for (const anchorKey of anchorKeys) {
    const anchor = byKey.get(anchorKey);
    if (!anchor) throw new InvalidCouncilIssueError(`Unknown council anchor key: ${anchorKey}`);
    if (resolved.includes(anchorKey)) continue;
    resolved.push(anchorKey);
    factKeys.push(...anchor.factKeys);
    sourceRefs.push(...anchor.sourceRefs);
  }
  return { anchorKeys: resolved, factKeys, sourceRefs };
}

/** Fail closed on ANY unknown key, never partially accept a fact list. */
export function resolveCouncilIssue(snapshot: VerifiedWorldSnapshot, raw: unknown, origin?: CouncilIssueOrigin): CouncilIssue {
  const parsed = councilIssueInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidCouncilIssueError();
  const input = parsed.data;
  const linked = resolveSignalLinks(snapshot, input.signalKeys ?? []);
  const linkedAnchors = resolveAnchorLinks(snapshot, input.anchorKeys ?? []);
  // Con signalKeys O anchorKeys presenti sono loro l'AUTORITÀ: factKeys/verifiedFacts
  // del client sono ignorati. Solo in loro assenza vale il percorso legacy fail-closed.
  const hasSignals = linked.signalKeys.length > 0 || linkedAnchors.anchorKeys.length > 0;
  const keys = hasSignals
    ? [...new Set([...linked.factKeys, ...linkedAnchors.factKeys])]
    : [...new Set([...(input.factKeys ?? []), ...(input.verifiedFacts ?? []).map(fact => fact.key)])];
  const verifiedFacts = keys.map(key => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.facts, key)) throw new InvalidCouncilIssueError(`Unknown verified fact key: ${key}`);
    const fact = snapshot.facts[key];
    return { key: fact.key, label: fact.label, value: fact.value, source: fact.source, sourceRef: fact.sourceRef };
  });
  // I riferimenti sono SEMPRE canonici: con signalKeys/anchorKeys solo quelli
  // della fonte, mai quelli del modello.
  const sourceRefs = hasSignals
    ? [...new Set([...linked.sourceRefs, ...linkedAnchors.sourceRefs])]
    : [...new Set(verifiedFacts.map(fact => fact.sourceRef))];
  // Una signal canonica senza factKeys resta valida se porta un riferimento canonico.
  if (!verifiedFacts.length && !sourceRefs.length) throw new InvalidCouncilIssueError('Council issue senza fatto né riferimento canonico');
  return {
    id: input.id ?? `issue-${shortId()}`, title: input.title, question: input.question,
    // Si conservano SOLO le chiavi realmente risolte (deduplicate): il round-trip
    // del client non può aggiungere chiavi inventate.
    ...(linked.signalKeys.length ? { signalKeys: linked.signalKeys } : {}),
    ...(linkedAnchors.anchorKeys.length ? { anchorKeys: linkedAnchors.anchorKeys } : {}),
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
  'Una proposta può nascere da un PROBLEMA (aggancia `signalKeys` dai CURRENT STRATEGIC SIGNALS) oppure da un\'OPPORTUNITÀ concreta (aggancia `anchorKeys` dai COUNCIL PROPOSAL ANCHORS). I segnali dicono ciò che MERITA ATTENZIONE; gli anchor sono fatti canonici che POSSONO SOSTENERE una proposta. Nessuna quota: se non c\'è nulla di specifico, zero schede è una risposta corretta.',
  'Proponi tutte e sole le questioni strategiche realmente distinte e salienti che meritano una decisione: possono essere nessuna, una o più di tre. Non duplicare lo stesso problema e non creare questioni per riempire una quota. Ogni questione deve poter essere portata separatamente al Consiglio, con fatti canonici a sostegno e solo ministri pertinenti alla domanda.',
  `Sedie ammesse: ${CABINET_SEATS.join(', ')}. Usa solo chiavi presenti in facts del VerifiedWorldSnapshot se ricorri a factKeys; per il collegamento canonico preferisci signalKeys (problemi) o anchorKeys (opportunità), presi dai CURRENT STRATEGIC SIGNALS / COUNCIL PROPOSAL ANCHORS. Niente valori, sourceRefs, fatti nuovi, costi inventati, opzioni Pressure o effetti.`,
  'Per una nuova opera distingui intenzione e inventario esistente; Lavori verifica tracciato e materiali, Tesoro la copertura. Una proposta non certifica fattibilità o autorizzazione.',
  'Un atto GIÀ FIRMATO è una decisione presa: non riproporlo come se fosse ancora da decidere.',
].join('\n');

/** Conservative identity, not semantic similarity: shared facts/ministers/titles are not duplicates. */
function councilQuestionKey(question: string): string {
  return question.normalize('NFKC').toLowerCase().trim()
    .replace(/[.!?…]+$/u, '').trim().replace(/\s+/g, ' ');
}

/** Normalizza per il confronto atto↔proposta: punteggiatura e spazi, non semantica. */
function signedActKey(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[.!?…:;,]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Un atto già firmato è una decisione PRESA, non una questione aperta. La
 * proposta che lo ripete (testo dell'atto contenuto in titolo o domanda) non
 * deve tornare al Consiglio. Confronto conservativo: solo identità o
 * contenimento dell'INTERO testo dell'atto, mai somiglianza vaga.
 */
function duplicatesSignedAct(snapshot: VerifiedWorldSnapshot, issue: Pick<CouncilIssue, 'title' | 'question'>): string | null {
  const question = signedActKey(issue.question);
  const title = signedActKey(issue.title);
  for (const act of snapshot.recent.signedActs) {
    const text = signedActKey(act.text);
    if (text.length < 8) continue;
    if (question === text || title === text || question.includes(text) || title.includes(text)) return act.id;
  }
  return null;
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
        // Un atto già firmato è una decisione PRESA: riproporlo non è una nuova
        // questione. Deterministico, così il filtro non dipende dal prompt.
        const signed = duplicatesSignedAct(snapshot, issue);
        if (signed) throw new InvalidCouncilIssueError(`Decision already signed: ${signed}`);
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
