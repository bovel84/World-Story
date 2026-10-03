/** View/context model del dialogo. Nessuno stato di gioco o seconda persistenza. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { CabinetItem, CabinetSeat } from './Cabinet';
import { colleagueRedirect, colleagueRedirectContext, currentSeatAngle, type ColleagueRedirectContext, briefingFor } from './MinisterChat';
import { MINISTER_DIALOGUE_STYLE, MINISTER_DIALOGUE_PROTOCOL } from './MinisterDialogueRules';
import { personaFor, type MinisterPersona } from './MinisterPersona';
import { renderMinisterWorldContext, type MinisterWorldContext } from '../../prompts/national-context';
import { stripNarrativeDirectives } from './MeetingNarrative';
import type { AdvisorMessage } from '../../prompts/types';

const text = z.string().max(400);
const measureSchema = z.object({
  id: text.optional(), label: text, kind: z.enum(['allocation','priority','target','region','work','constraint','other']),
  value: text.optional(), amount: z.number().finite().optional(), unit: text.optional(),
  sharePct: z.number().min(0).max(100).optional(),
  status: z.enum(['proposed','accepted','rejected','unresolved']), source: z.enum(['engine','minister','president']),
});
const decisionSchema = z.object({
  objective: text.nullable().optional(), revision: z.number().int().nonnegative().optional(),
  measures: z.array(measureSchema).max(30).optional(), constraints: z.array(text).max(20).optional(), unresolved: z.array(text).max(20).optional(),
});
export type MinisterCurrentDecision = z.infer<typeof decisionSchema>;

/** Client context is discussion, never a verified engine fact; unknown fields cannot become instructions. */
export function normalizeCurrentDecision(raw: unknown): MinisterCurrentDecision | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const measures = Array.isArray(value.measures) ? value.measures.slice(0,30).flatMap(item => {
    const parsed = measureSchema.safeParse(item); return parsed.success ? [parsed.data] : [];
  }) : undefined;
  const parsed = decisionSchema.safeParse({ ...value, measures });
  return parsed.success ? parsed.data : undefined;
}

/** Bridge per richiesta HTTP: consente il trasporto senza modificare GameSession congelata. */
interface MinisterDialogueRequest { gameId: string; seat: string; currentDecision?: MinisterCurrentDecision }
const requestContext = new AsyncLocalStorage<MinisterDialogueRequest>();
export function withMinisterDialogueRequest<T>(gameId: string, seat: string, currentDecision: unknown, run: () => T): T {
  return requestContext.run({ gameId, seat, currentDecision: normalizeCurrentDecision(currentDecision) }, run);
}
export function currentMinisterDialogueRequest(gameId: string, seat: CabinetSeat): MinisterDialogueRequest | undefined {
  const request = requestContext.getStore();
  return request?.gameId === gameId && request.seat === seat ? request : undefined;
}

export interface MinisterDialogueBrief {
  readonly seat: CabinetSeat;
  readonly persona: MinisterPersona;
  readonly worldContext: MinisterWorldContext;
  readonly memory?: { readonly context: string };
  readonly currentIssues: readonly CabinetItem[];
  readonly currentDecision?: MinisterCurrentDecision;
  readonly presidentMessage: string;
  readonly recentHistory: readonly AdvisorMessage[];
  readonly redirect: ColleagueRedirectContext | null;
}

export function buildMinisterDialogueBrief(input: Omit<MinisterDialogueBrief, 'persona' | 'redirect'>): MinisterDialogueBrief {
  return { ...input, currentDecision: normalizeCurrentDecision(input.currentDecision), persona: personaFor(input.seat), redirect: colleagueRedirectContext(input.seat, input.presidentMessage) };
}

/** Preserva gli scambi, ma non ripete i blocchi tecnici: lo stato attuale viaggia nella decisione. */
export function dialogueHistory(history: readonly AdvisorMessage[]): AdvisorMessage[] {
  return history.filter(item => item.content.trim()).slice(-20).map(item => ({ role: item.role, content: stripNarrativeDirectives(item.content) }));
}

/** Il contesto JEV, quando presente, possiede già WORLD/MEMORY/HISTORY/VERIFIED STATE. */
export function composeMinisterDialoguePrompt(brief: MinisterDialogueBrief, context?: { base: string; hasHistory: boolean; hasWorld: boolean }): string {
  const dossier = briefingFor({ seat: brief.seat, label: '', reads: '', opening: '', items: brief.currentIssues }, { voices: [], headline: '', canonicalMutation: false }).context;
  const base = context?.base ?? [
    '[WORLD]', renderMinisterWorldContext(brief.worldContext, brief.seat),
    dossier,
  ].filter(Boolean).join('\n\n');
  // Nel legacy/JEV il dossier termina con stile/protocollo: spostali dopo il contesto
  // corrente, una sola volta, così sono regole della risposta e non «fatti verificati».
  const styleStart = base.lastIndexOf('\n[DIALOGUE STYLE]\n');
  const factualBase = styleStart < 0 ? base : base.slice(0, styleStart);
  const history = context?.hasHistory ? '' : `[RECENT CONVERSATION]\n${JSON.stringify(dialogueHistory(brief.recentHistory))}`;
  return [
    context && !context.hasWorld ? `[WORLD]\n${renderMinisterWorldContext(brief.worldContext, brief.seat)}` : '',
    factualBase, context ? '' : brief.memory?.context ?? '', history,
    '[CURRENT DECISION — snapshot della discussione, NON stato verificato del motore]',
    JSON.stringify(brief.currentDecision ?? { unresolved: ['Nessuna proposta corrente trasmessa: usa la conversazione recente senza fingere accordi.'] }),
    '[COLLEAGUE REDIRECT — solo se pertinente]', JSON.stringify(brief.redirect),
    'Se il redirect è presente, nomina il collega competente e spiega cosa aggiungi dalla tua sedia; NON dire «Non è la mia materia» o recitare targetReads. Non inventare un costo o una disponibilità.',
    '[PROTOCOL]', MINISTER_DIALOGUE_PROTOCOL,
    '[DIALOGUE STYLE]', MINISTER_DIALOGUE_STYLE,
    '[PRESIDENT MESSAGE]', brief.presidentMessage,
  ].filter(Boolean).join('\n\n');
}

/** Guardrail stilistico ristretto; non è un nuovo fact checker e non cambia direttive/provenance. */
export function dialogueResponseIsNatural(response: string, brief: MinisterDialogueBrief): boolean {
  const prose = stripNarrativeDirectives(response);
  if (!prose.trim()) return false;
  const explicitlyStructured = /(?:sezion|elenc|riepilog|schem|report|fatti:|lettura:|proposta:|alternative:|conclusione:)/i.test(brief.presidentMessage);
  if (!explicitlyStructured && /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:Fatti|Lettura|Proposta|Alternative|Conclusione)\s*(?:\*\*)?(?::|(?=\n|$))/i.test(prose)) return false;
  if (/Ho \d+ (?:cos[ae]|questioni)|Non è la mia materia|Tocca a te decidere|Dimmi tu qual è la priorità|Perché adesso:/i.test(prose)) return false;
  // Una signature già detta non deve diventare una risposta/catchphrase.
  const signature = brief.persona.signature.replace(/[«»]/g, '');
  if (prose.includes(signature) && (prose.trim().replace(/[«»]/g, '') === signature || brief.recentHistory.some(item => item.role === 'assistant' && item.content.includes(signature)))) return false;
  const detailed = /approfond|dettagli|spiega.*(?:bene|tutto)|riepilog|report/i.test(brief.presidentMessage);
  const words = prose.split(/\s+/).length;
  const show = /fammi vedere|mostra|mett.*confront/i.test(brief.presidentMessage);
  const shortFollowUp = /^(?:e il resto|quanto|perch[eé]|non sono convinto|va bene|e se|metà e metà|mettiamo|confermo|ok)(?=$|[\s.!?])/i.test(brief.presidentMessage.trim()) && brief.presidentMessage.trim().split(/\s+/).length <= 12;
  return detailed || words <= (show || shortFollowUp ? 80 : 140);
}

/** Un errore del provider non genera una decisione fittizia né cancella ciò che è già concordato. */
export function fallbackMinisterDialogue(brief: MinisterDialogueBrief): string {
  const redirect = colleagueRedirect(brief.seat, brief.presidentMessage);
  if (redirect) return redirect;
  const message = brief.presidentMessage.toLowerCase().trim();
  if (/fammi vedere|mostra/.test(message)) return 'Guardiamo il confronto sulla tavola, senza cambiare la proposta.\n```tavola\n{"op":"compare"}\n```';
  if (/non sono convinto/.test(message)) return 'Capisco l’obiezione. Non voglio farti accettare una scelta per inerzia: rivediamo il compromesso appena discusso, senza perdere di vista quello che dobbiamo proteggere. Quale conseguenza ti preoccupa di più?';
  if (/prima.*(?:ora|adesso)|cambio idea/.test(message)) return 'Ho capito il cambio di direzione. La scelta precedente non è più quella da sviluppare; prima di aggiornare la proposta dobbiamo verificare cosa resta compatibile con la nuova intenzione.';
  if (/^(va bene|d'accordo|confermo|procediamo|ok)[.!]?$/.test(message)) {
    // Una conferma semplice può fissare il draft già trasmesso, mai inventarne uno.
    const changes = (brief.currentDecision?.measures ?? []).filter(measure => measure.source !== 'engine' && measure.status !== 'rejected' && measure.status !== 'unresolved')
      .map(measure => ({ ...measure, source: 'president', status: 'accepted' }));
    if (changes.length) {
      const blocks: string[] = [];
      for (let start = 0; start < changes.length; start += 12) {
        blocks.push(`\`\`\`decision\n${JSON.stringify({ op: 'update-proposal', objective: brief.currentDecision?.objective ?? undefined, changes: changes.slice(start, start + 12) })}\n\`\`\``);
      }
      return `Va bene, segno la scelta nella proposta, senza riaprire ciò che hai appena confermato. Restano da precisare soltanto i punti ancora aperti.\n${blocks.join('\n')}`;
    }
  }
  if (/va bene|mettiamo|metà e metà|confermo/.test(message)) return 'Ho capito la direzione. Ora non riesco ad aggiornare la proposta: prima di firmare verifica che la tavola riporti la tua scelta, non una ripartizione precedente.';
  const last = brief.currentDecision?.measures?.filter(measure => measure.status !== 'rejected') ?? [];
  if (/resto/.test(message) && last.some(measure => /invest/i.test(measure.label))) return 'Per il resto mi riferisco alla quota per gli investimenti che abbiamo appena discusso. La ripartizione resta quella della proposta: va precisato l’impiego, non rimessa in discussione la quota del debito. Quale investimento vuoi confrontare per primo?';
  if (/resto/.test(message) && last.length) return `Per il resto intendo la parte ancora da destinare, dopo ciò che abbiamo discusso per «${last[0].label.slice(0, 100)}». Io eviterei di impegnarla senza una copertura chiara. Quale impiego vuoi mettere a confronto?`;
  if (/perch[eé]/.test(message)) return 'Perché voglio che la scelta resti sostenibile anche dopo questo primo passo. Il mio consiglio è prudente, non obbligatorio: possiamo rivederlo se il vantaggio giustifica il rischio. Vuoi confrontare questo compromesso con l’alternativa appena discussa?';
  return `Ripartiamo dalla scelta che stavamo discutendo, senza ricominciare dai conti. ${currentSeatAngle(brief.seat)} Quale dettaglio della proposta vuoi chiarire prima di procedere?`;
}
