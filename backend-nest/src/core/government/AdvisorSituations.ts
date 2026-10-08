/**
 * WS-CONSULENTE-SITUAZIONI — La SITUAZIONE è un oggetto di prima classe,
 * distinto dalla PROPOSTA (`CouncilIssue`).
 *
 * Il modello interpreta uno StrategicThread da stato, storia e segnali nella
 * stessa completion. Una situazione ha segnali canonici oppure prove del thread
 * risolte dal server (baseline ammessa come base solo all'apertura). Una chiave
 * ignota o scaduta invalida la scheda. Il fallback resta deterministico.
 *
 * `parseAdvisorResponse` è il punto unico che separa `situations` da `issues`:
 * una situazione NON crea automaticamente una CouncilIssue.
 */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { buildRealitySignals, signalDomainToSeat, type RealitySignal } from './RealitySignals';
import { MAX_BRIEFING_COUNCIL_ISSUES, isPreparatoryCouncilIssue, parseCouncilIssues, resolveCouncilIssue, type CouncilIssue, type CouncilIssueOrigin, type CouncilIssueParseOptions, type CouncilOption } from './CouncilIssue';
import { buildCouncilProposalAnchors } from './CouncilProposalAnchors';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import { resolveStrategicThreadEvidence, type StrategicThread, type StrategicThreadContext } from './StrategicThreads';

export interface AdvisorSituation extends StrategicThread {
  id: string;
  title: string;
  summary: string;
  /**
   * T02 — Le MOSSE della situazione: la stessa forma di `CouncilIssue.options`
   * (`{title, content}`), lo stesso schema (2-5, titolo 2-80, contenuto 10-400).
   * Assente sulle schede vecchie e sulle situazioni che il modello interpreta
   * senza una decisione da proporre: una situazione senza mosse resta valida
   * (`T-I5`) e resta approfondibile.
   *
   * Sono PROSA, non fatti: nessuna chiave, nessuna cifra. Il server non le
   * inventa mai — le conserva se il modello le ha scritte e lo schema le accetta.
   */
  options?: CouncilOption[];
  /** Chiavi dei segnali canonici: il server le ricalcola, mai il client. */
  signalKeys: string[];
  /** Derivata dai segnali; senza alert: 2 per problemi, 1 per opportunità. */
  importance: number;
}

/**
 * T02 — Lo schema delle mosse di una situazione è lo STESSO delle proposte.
 * `options` è opzionale perché la forma con le mosse convive con quella senza
 * (`T-I5`, come P-I5 per le proposte): le schede vecchie restano valide.
 *
 * **NON `.strict()`**, e la correzione è stata trovata dalla verifica
 * indipendente (T08). La prima versione lo era, con l'idea che una mova con una
 * chiave dentro scartasse la scheda intera. Sbagliato per due ragioni:
 *
 * 1. **Contraddiceva P09** — «la chiave ignota degrada, non uccide». Lo schema
 *    delle proposte non è `.strict()`: una mossa con una chiave in più la perde
 *    in silenzio e la scheda vive. Uccidere la situazione era più severo del
 *    principio che dicevo di applicare, e incoerente col resto del sistema.
 * 2. **Non era più sicuro.** Una chiave dentro una MOSSA non raggiunge il motore
 *    comunque: le mosse sono prosa, e i fatti li portano le `signalKeys` della
 *    situazione, che il server rivalida sempre. Perderla è sufficiente.
 *
 * Zod, senza `.strict()`, **scarta** le chiavi ignote: una mossa con una chiave
 * dentro perde la chiave e la scheda resta. La mossa sola resta invece invalida
 * (`.min(2)`): quella è la definizione di «una scelta», e resta severa.
 */
const advisorOptionsSchema = z.array(z.object({
  title: z.string().trim().min(2).max(80),
  content: z.string().trim().min(10).max(400),
})).min(2).max(5).optional();

/** Le mosse della situazione: prosa pura, titolo + contenuto. Nessuna chiave. */
function advisorOptions(raw: readonly CouncilOption[] | undefined): CouncilOption[] {
  return (raw ?? []).map(option => ({ title: option.title, content: option.content }));
}

/** Cap tecnico di sicurezza: non è una quota da riempire. */
export const MAX_ADVISOR_SITUATIONS = 24;

const key = z.string().trim().min(1).max(240);
/** Il modello fornisce titolo, sintesi e chiavi; la gravità è ricalcolata dal server.
 *  `signalKeys` va da 0 a 5 (zero richiede evidenceKeys verificate): una situazione politica può nascere da più fatti
 *  canonici (la sicurezza nel nord = stabilità + prontezza + rifornimenti +
 *  rapporti col Sudan), ma ogni chiave deve risolversi contro i `RealitySignals`.
 *  Due problemi distinti (Sudan e Congo) restano due situazioni. */
export const advisorSituationInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(600),
  // T02 — le mosse della situazione, same-form/same-schema delle proposte.
  options: advisorOptionsSchema,
  signalKeys: z.array(key).max(5),
  evidenceKeys: z.array(key).min(1).max(8).optional(),
  kind: z.enum(['problem', 'opportunity']).optional(),
}).refine(value => value.signalKeys.length > 0 || !!value.evidenceKeys?.length);

/** WS-CONSULENTE-SITUAZIONI — Focus canonico di un approfondimento. Il client
 *  invia solo riferimenti strutturali: id + signalKeys/evidenceKeys canoniche.
 *  Titolo e sintesi del client NON sono fonte di fatti. `signalKey` resta solo
 *  come compatibilità deprecata e viene unito a `signalKeys`. */
export const focusSituationInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  signalKeys: z.array(key).max(5).optional(),
  evidenceKeys: z.array(key).min(1).max(8).optional(),
  signalKey: key.optional(),
}).refine(value => (value.signalKeys?.length ?? 0) + (value.signalKey ? 1 : 0) > 0 || !!value.evidenceKeys?.length);

export class InvalidAdvisorSituationError extends Error {
  constructor(message = 'Situazione non valida: servono segnali canonici o prove del thread') {
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

export function resolveAdvisorSituation(snapshot: VerifiedWorldSnapshot, raw: unknown, context: StrategicThreadContext = {}): AdvisorSituation {
  const parsed = advisorSituationInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAdvisorSituationError();
  const input = parsed.data;
  const { signalKeys, signals } = resolveSignalLinks(snapshot, input.signalKeys);
  const evidence = resolveStrategicThreadEvidence(snapshot, input.evidenceKeys ?? [], context, signals.length > 0);
  if (!signals.length && !evidence.length) throw new InvalidAdvisorSituationError();
  const thread: StrategicThread = {
    title: input.title, summary: input.summary, signalKeys,
    ...(evidence.length ? { evidenceKeys: evidence.map(item => item.key) } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
  };
  const importance = signals.reduce((max, signal) => Math.max(max, signal.importance), signals.length || input.kind === 'opportunity' ? 1 : 2);
  const options = advisorOptions(input.options);
  return {
    id: input.id ?? `situation-${shortId()}`,
    ...thread,
    ...(options.length ? { options } : {}),
    importance,
  };
}

/**
 * Risolve il focus dell'approfondimento sulla STESSA Strategic Situation:
 * id + più signalKeys/evidenceKeys canoniche, tutte verificate server-side.
 * Una chiave ignota o scaduta invalida l'intero focus. Con evidenceKeys il
 * titolo resta neutro: il thread NON viene rinominato col primo segnale.
 */
export function resolveFocusSituation(snapshot: VerifiedWorldSnapshot, raw: unknown, context: StrategicThreadContext = {}): AdvisorSituation {
  const parsed = focusSituationInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidAdvisorSituationError();
  const input = parsed.data;
  const { signalKeys, signals } = resolveSignalLinks(snapshot, [...(input.signalKeys ?? []), ...(input.signalKey ? [input.signalKey] : [])]);
  const evidence = resolveStrategicThreadEvidence(snapshot, input.evidenceKeys ?? [], context, signals.length > 0);
  if (!signals.length && !evidence.length) throw new InvalidAdvisorSituationError();
  return {
    id: input.id ?? (signalKeys[0] ? `situation-${signalKeys[0]}` : `situation-${shortId()}`),
    title: focusSituationTitle(signals, evidence),
    summary: focusSituationSummary(signals, evidence),
    signalKeys,
    ...(evidence.length ? { evidenceKeys: evidence.map(item => item.key) } : {}),
    importance: signals.reduce((max, signal) => Math.max(max, signal.importance), 2),
  };
}

/** Neutral fallback title: with evidence the thread keeps its own identity and
 *  must not become the name of the first technical signal. */
function focusSituationTitle(signals: RealitySignal[], evidence: readonly unknown[]): string {
  if (evidence.length) return 'Situazione strategica in esame';
  return signals.length === 1 ? signalSituationTitle(signals[0]) : 'Situazione strategica in esame';
}

function focusSituationSummary(signals: RealitySignal[], evidence: readonly { text: string }[]): string {
  return (evidence.length ? evidence.map(item => item.text).join(' ') : signals.map(signal => signal.reason).join(' ')).slice(0, 600);
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
export function parseAdvisorSituations(snapshot: VerifiedWorldSnapshot, text: string, options: AdvisorResponseParseOptions = {}): { reply: string; situations: AdvisorSituation[] } {
  const situations: AdvisorSituation[] = [];
  const reply = text.replace(/```advisor_situation\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (situations.length < MAX_ADVISOR_SITUATIONS) {
        const situation = resolveAdvisorSituation(snapshot, JSON.parse(json.trim()), options.strategicContext);
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
export function situationsOverlap(left: Pick<AdvisorSituation, 'signalKeys' | 'evidenceKeys'>, right: Pick<AdvisorSituation, 'signalKeys' | 'evidenceKeys'>): boolean {
  // Distinct grounded political threads may share generic constraints.
  if (left.evidenceKeys?.length || right.evidenceKeys?.length) {
    const a = new Set(left.evidenceKeys ?? []);
    const b = new Set(right.evidenceKeys ?? []);
    return a.size > 0 && a.size === b.size && [...a].every(key => b.has(key))
      && left.signalKeys.length === right.signalKeys.length && left.signalKeys.every(key => right.signalKeys.includes(key));
  }
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
  issue: Pick<CouncilIssue, 'signalKeys' | 'anchorKeys' | 'situationId'>,
  situation: Pick<AdvisorSituation, 'signalKeys'> & { id?: string },
): boolean {
  if (issue.situationId) return issue.situationId === situation.id;
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
function proposalMatchScore(issue: Pick<CouncilIssue, 'signalKeys' | 'situationId'>, situation: Pick<AdvisorSituation, 'signalKeys' | 'id'>): number {
  if (issue.situationId === situation.id) return 10_000;
  const proposal = issue.signalKeys ?? [];
  const situationKeys = new Set(situation.signalKeys);
  let shared = 0;
  for (const signalKey of proposal) if (situationKeys.has(signalKey)) shared += 1;
  const union = new Set([...proposal, ...situation.signalKeys]).size || 1;
  return (proposal[0] === situation.signalKeys[0] ? 1 : 0) * 1_000 + shared * 10 + shared / union;
}

/** La situazione migliore per una proposta, o null se nessuna corrisponde.
 *  Stessa identità di `proposalMatchesSituation`: una sola primaria non basta. */
export function bestMatchingSituation(
  issue: Pick<CouncilIssue, 'signalKeys' | 'anchorKeys' | 'situationId'>,
  situations: readonly Pick<AdvisorSituation, 'signalKeys' | 'id'>[],
): Pick<AdvisorSituation, 'signalKeys' | 'id'> | null {
  let best: Pick<AdvisorSituation, 'signalKeys' | 'id'> | null = null;
  let bestScore = -1;
  for (const situation of situations) {
    if (!proposalMatchesSituation(issue, situation)) continue;
    const score = proposalMatchScore(issue, situation);
    if (score > bestScore) { bestScore = score; best = situation; }
  }
  return best;
}

/** Indici coperti: ogni proposta seleziona al massimo UNA situazione (la migliore). */
function coveredSituationIndexes(result: Pick<AdvisorResponse, 'situations' | 'issues'>): Set<number> {
  const covered = new Set<number>();
  for (const issue of result.issues) {
    const best = bestMatchingSituation(issue, result.situations);
    if (best) covered.add(result.situations.indexOf(best as AdvisorSituation));
  }
  return covered;
}

/** La base deterministica resta: il modello non nasconde un segnale reale. */
export function mergeAdvisorSituations(snapshot: VerifiedWorldSnapshot, model: readonly AdvisorSituation[]): AdvisorSituation[] {
  const base = buildAdvisorSituations(snapshot);
  if (!model.length) return base;
  const covered = new Set(model.flatMap(situation => situation.signalKeys));
  const kept: AdvisorSituation[] = [];
  // Preserve the model's political ordering; append only important uncovered alerts.
  return [...model, ...base.filter(situation => situation.importance >= 2 && !situation.signalKeys.some(key => covered.has(key)))]
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
  const covered = coveredSituationIndexes(result);
  // Ordine stabile anche dopo la serializzazione: nessun avviso duplicato al round-trip.
  const missing = result.situations
    .filter((_, index) => !covered.has(index))
    .sort((left, right) => (left.signalKeys[0] ?? left.id).localeCompare(right.signalKeys[0] ?? right.id));
  const opportunityKeys = new Set(buildCouncilProposalAnchors(snapshot).filter(anchor => anchor.domain !== 'decision').map(anchor => anchor.key));
  const missingOpportunity = result.situations.length === 0
    && !result.issues.some(issue => issue.anchorKeys?.some(key => opportunityKeys.has(key)));
  return { ...result, briefingCoverage: {
    complete: missing.length === 0 && !missingOpportunity,
    missingSignalKeys: missing.flatMap(situation => situation.signalKeys),
    missingOpportunity,
  } };
}

/** Situazioni che nessuna proposta copre, nell'ordine originale del briefing.
 *  Stessa identità di `withAdvisorBriefingCoverage`, ma espone le schede (non
 *  solo le chiavi) al repair mirato. Non altera il metadata pubblico. */
export function uncoveredAdvisorSituations(
  result: Pick<AdvisorResponse, 'situations' | 'issues'>,
): AdvisorSituation[] {
  const covered = coveredSituationIndexes(result);
  return result.situations.filter((_, index) => !covered.has(index));
}

/**
 * T04 — Una situazione scoperta diventa una proposta, **spostando** le sue mosse.
 *
 * La misura di T01 (§7) dice due cose: senza proposte ogni situazione resta
 * scoperta, e il numero di situazioni dipende dallo stato (da 1 a 8). La rete
 * qui sotto non inventa nulla per coprirle: prende la situazione e ne fa una
 * `council_issue` con il suo titolo, una domanda che è la SCELTA fra le sue
 * mosse, e **le mosse stesse**. Il server le sposta di posto, non le fabbrica
 * (`T-I2`).
 *
 * Restituisce `undefined` quando la situazione **non ha mosse**: senza una
 * decisione da proporre non c'è una proposta da portare al tavolo. È il confine
 * che T01 ha reso evidente — `buildAdvisorSituations` non distingue un problema
 * da un'opportunità e non sa quale decisione sia concretamente disponibile;
 * solo il modello, scrivendo le mosse, dice che una decisione esiste. Dove non
 * l'ha detta, il sistema non la inventa: la copertura lo **dichiara** scoperta.
 */
export function situationAsCouncilIssue(
  snapshot: VerifiedWorldSnapshot,
  situation: AdvisorSituation,
): CouncilIssue | undefined {
  if (!situation.options?.length) return undefined;
  // I ministri competenti si derivano dai SEGNALI RISOLTI della situazione
  // (`signal.domain`), non da un elenco che la situazione non ha. La traduzione
  // dominio→sedia vive in un punto solo (`RealitySignals.signalDomainToSeat`),
  // accanto alla sua inversa.
  const keys = new Set(situation.signalKeys);
  const seats = [...new Set(buildRealitySignals(snapshot)
    .filter(signal => keys.has(signal.key))
    .map(signal => signalDomainToSeat(signal.domain)))];
  return {
    id: `issue-${situation.id}`,
    title: situation.title.slice(0, 240),
    question: `Quale strada scegliamo su «${situation.title}»?`.slice(0, 600),
    options: situation.options.map(option => ({ title: option.title, content: option.content })),
    // I riferimenti canonici viaggiano con la proposta: il server li risolve e
    // li rivalida. Le mosse restano prosa.
    ...(situation.signalKeys.length ? { signalKeys: [...situation.signalKeys] } : {}),
    // Nessun fatto: la situazione non ne porta, e il client non ne inventa.
    verifiedFacts: [],
    // Il titolare della competenza, mai una lista vuota: `interno` risponde del
    // quadro generale quando nessun segnale specifico è in gioco.
    suggestedMinisters: seats.length ? seats.slice(0, 7) : ['interno'],
    origin: 'advisor',
    sourceRefs: [],
    createdDate: '',
    // Il legame con la situazione, per l'identità di copertura.
    situationId: situation.id,
  };
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
export type AdvisorResponseParseOptions = CouncilIssueParseOptions & { includeDeterministicSituations?: boolean; strategicContext?: StrategicThreadContext };

/**
 * T04 — La rete: copre le situazioni scoperte **che hanno mosse**.
 *
 * Sta accanto a `withAdvisorBriefingCoverage`, non al posto suo: la copertura
 * continua a **misurare** ciò che resta scoperto, e resta la fonte di verità su
 * di essa. Questa funzione aggiunge le proposte che il briefing ha mancato,
 * passando dalla validazione del server (`resolveCouncilIssue`), così una
 * proposta derivata è trattata come qualsiasi altra: chiavi ignote scartano la
 * scheda, non la accettano in parte.
 *
 * Il risultato è un `AdvisorResponse` nuovo: la copertura va **ricalcolata**
 * dopo (`withAdvisorBriefingCoverage`), perché le proposte appena aggiunte
 * coprono. Mai dichiarare una copertura che non si è ricalcolata.
 */
export function withSituationDerivedProposals(
  snapshot: VerifiedWorldSnapshot,
  result: AdvisorResponse,
): AdvisorResponse {
  const uncovered = uncoveredAdvisorSituations(result);
  const existing = new Set(result.issues.map(issue => issue.id));
  const added: CouncilIssue[] = [];
  for (const situation of uncovered) {
    const derived = situationAsCouncilIssue(snapshot, situation);
    if (!derived || existing.has(derived.id)) continue;
    try {
      added.push(resolveCouncilIssue(snapshot, derived, 'advisor'));
    } catch (error) {
      // Fail closed e visibile: la proposta derivata non si fabbrica. La
      // situazione resta scoperta e la copertura lo dichiarerà.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[AdvisorSituation] proposta derivata scartata per ${situation.id}: ${reason}`);
    }
  }
  if (!added.length) return result;
  const issues = [...result.issues, ...added];
  return withAdvisorBriefingCoverage(snapshot, { ...result, issues });
}

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
      ? parsedIssues.issues.filter(issue => !isPreparatoryCouncilIssue(issue)
        && (!issue.situationId || parsedSituations.situations.some(situation => situation.id === issue.situationId)))
      : parsedIssues.issues,
  };
  if (!briefing) return result;
  // T04 — La copertura MISURA, poi la rete COPRE ciò che può coprire con le mosse
  // che il modello ha scritto. Mai il contrario, e mai una copertura dichiarata
  // invece che ricalcolata (`withSituationDerivedProposals` la ricalcola).
  //
  // Questo è il punto per cui passa la prosa del modello. L'altro percorso di
  // briefing — `buildRealityAdvisorContext`, il deterministico, quando il
  // provider è giù — chiama la stessa rete separatamente.
  //
  // **Il limite, dichiarato per intero** (misurato in T08): la rete copre solo le
  // situazioni che hanno MOSSE. Le sei situazioni che `buildAdvisorSituations`
  // costruisce dai segnali non ne hanno mai, e non possono averne — è una
  // proiezione, non una scelta politica. Quindi su quel percorso la rete non
  // aggiunge nulla, e la copertura resta `complete: false` con sei situazioni
  // scoperte: la forma del 16:43.
  //
  // Non è un difetto che si chiuda con una riga di codice. Coprirle davvero
  // significherebbe far generare le mosse al modello partendo da quelle sei
  // situazioni — cioè il repair mirato già esistente, che però oggi vede un
  // elenco vuoto perché la rete lo precede. È il seguito naturale di T04, non
  // parte di esso: dichiararlo è meglio che fingere una copertura.
  //
  // Il compromesso sulle situazioni che la rete copre davvero: la domanda è
  // composta dal server («Quale strada scegliamo su «X»?») e non dal modello. Le
  // MOSSE — la sostanza che il Presidente legge e sceglie — restano quelle scritte
  // dal modello, identiche.
  return withSituationDerivedProposals(snapshot, withAdvisorBriefingCoverage(snapshot, result));
}

/** Legacy text/plain chats must not silently discard paid-for proposals.
 * Structured clients still receive the original cards; no Council is opened. */
export function advisorReplyWithProposals(result: AdvisorResponse): string {
  if (!result.issues.length) return result.reply;
  return [result.reply, 'Proposte del Consulente — da decidere:',
    ...result.issues.map(issue => `${issue.title}: ${issue.question}`),
  ].filter(Boolean).join('\n\n');
}

/** Serializza entrambi i tipi di blocco: il round-trip interno li conserva distinti. */
export function serializeAdvisorResponse(result: AdvisorResponse): string {
  return [
    result.reply,
    ...result.situations.map(situation => `\`\`\`advisor_situation\n${JSON.stringify(situation)}\n\`\`\``),
    ...result.issues.map(issue => `\`\`\`council_issue\n${JSON.stringify(issue)}\n\`\`\``),
  ].filter(Boolean).join('\n\n');
}
