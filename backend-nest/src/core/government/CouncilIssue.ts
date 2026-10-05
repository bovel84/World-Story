/** A discussion proposal, never an engine mutation or a Pressure. */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { CABINET_SEATS, type CabinetSeat } from './Cabinet';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import type { SituationBrief } from './MinisterOpening';

export type CouncilIssueOrigin = 'advisor' | 'president' | 'minister' | 'event' | 'follow-up';
export interface CouncilIssue {
  id: string;
  title: string;
  question: string;
  verifiedFacts: Array<{ key: string; label: string; value: string; source: string; sourceRef: string }>;
  suggestedMinisters: CabinetSeat[];
  origin: CouncilIssueOrigin;
  sourceRefs: string[];
  createdDate: string;
}

const key = z.string().trim().min(1).max(240);
/** Only fact keys are accepted as input. Labels, values and provenance are discarded. */
export const councilIssueInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(600),
  factKeys: z.array(key).min(1).max(24).optional(),
  verifiedFacts: z.array(z.object({ key })).min(1).max(24).optional(),
  suggestedMinisters: z.array(z.enum(CABINET_SEATS)).min(1).max(7),
  origin: z.enum(['advisor', 'president', 'minister', 'event', 'follow-up']).optional(),
}).refine(value => Boolean(value.factKeys?.length || value.verifiedFacts?.length), { message: 'Verified fact keys required' });

export class InvalidCouncilIssueError extends Error {
  constructor(message = 'Council issue non valida: verified fact keys richieste') {
    super(message); this.name = 'InvalidCouncilIssueError';
  }
}

/** Fail closed on ANY unknown key, never partially accept a fact list. */
export function resolveCouncilIssue(snapshot: VerifiedWorldSnapshot, raw: unknown, origin?: CouncilIssueOrigin): CouncilIssue {
  const parsed = councilIssueInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidCouncilIssueError();
  const input = parsed.data;
  // If both representations were supplied, neither may smuggle an unknown key.
  const keys = [...new Set([...(input.factKeys ?? []), ...(input.verifiedFacts ?? []).map(fact => fact.key)])];
  const verifiedFacts = keys.map(key => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.facts, key)) throw new InvalidCouncilIssueError(`Unknown verified fact key: ${key}`);
    const fact = snapshot.facts[key];
    return { key: fact.key, label: fact.label, value: fact.value, source: fact.source, sourceRef: fact.sourceRef };
  });
  return {
    id: input.id ?? `issue-${shortId()}`, title: input.title, question: input.question,
    verifiedFacts, suggestedMinisters: [...new Set(input.suggestedMinisters)],
    origin: origin ?? input.origin ?? 'advisor', sourceRefs: [...new Set(verifiedFacts.map(fact => fact.sourceRef))],
    createdDate: snapshot.date ?? 'unknown',
  };
}

export const COUNCIL_ISSUE_PROTOCOL = [
  'Puoi proporre questioni interministeriali, NON aprire una seduta o creare una crisi. Il Presidente decide se portarle al Consiglio.',
  'Protocollo facoltativo: da 1 a 3 blocchi fenced ```council_issue, uno per questione, ciascuno con JSON {"title":"...","question":"...","factKeys":["chiave canonica"],"suggestedMinisters":["lavori","tesoro"]}. Non è necessario proporre questioni né riempire tre blocchi.',
  'Proponi più questioni solo per direzioni strategiche realmente distinte: per esempio riforma delle forze armate, iniziativa diplomatica e rilancio infrastrutturale. Non duplicare la stessa domanda con titoli diversi. Ogni questione deve poter essere portata separatamente al Consiglio, con fatti canonici a sostegno e solo ministri pertinenti alla domanda.',
  `Sedie ammesse: ${CABINET_SEATS.join(', ')}. Usa solo chiavi presenti in facts del VerifiedWorldSnapshot; niente valori, fatti nuovi, costi inventati, opzioni Pressure o effetti.`,
  'Per una nuova opera distingui intenzione e inventario esistente; Lavori verifica tracciato e materiali, Tesoro la copertura. Una proposta non certifica fattibilità o autorizzazione.',
].join('\n');

/** Conservative identity, not semantic similarity: shared facts/ministers/titles are not duplicates. */
function councilQuestionKey(question: string): string {
  return question.normalize('NFKC').toLowerCase().trim()
    .replace(/[.!?…]+$/u, '').trim().replace(/\s+/g, ' ');
}

/** Strip invalid/unfinished/duplicate proposals; model text never supplies canonical facts. */
export function parseCouncilIssues(snapshot: VerifiedWorldSnapshot, text: string, origin: CouncilIssueOrigin = 'advisor'): { reply: string; issues: CouncilIssue[] } {
  const issues: CouncilIssue[] = [];
  const questions = new Set<string>();
  const reply = text.replace(/```council_issue\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (issues.length < 3) {
        const issue = resolveCouncilIssue(snapshot, JSON.parse(json.trim()), origin);
        const questionKey = councilQuestionKey(issue.question) || issue.question;
        if (!questions.has(questionKey)) {
          questions.add(questionKey);
          issues.push(issue);
        }
      }
    } catch { /* Unsafe proposals are not evidence and are not returned. */ }
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
