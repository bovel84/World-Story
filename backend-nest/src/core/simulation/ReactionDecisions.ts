/**
 * World Story — Reaction decisions (contratto motore ↔ LLM)
 * ========================================================
 * Il motore decide **chi** può reagire e **quali categorie di decisione** sono
 * possibili (`ReactionContext`). L'LLM sceglie una di quelle opzioni e la
 * racconta. Questo modulo è il controllo deterministico, puro e fail-closed di
 * quella scelta:
 *
 *   output LLM → validateReactionDecisions → (un solo repair di formato) → LLMContractError
 *
 * Regole:
 *  - `actorId` deve esistere ed essere un `RelevantActor` del contesto;
 *  - `optionId` deve appartenere alle opzioni di **QUEL** attore (non basta
 *    che l'id sia presente in `allowedOptionIds`: impedisce a un attore di
 *    scegliere l'opzione di un altro);
 *  - numero di reazioni ≤ `maxReactions`;
 *  - nessun attore fuori dal contesto;
 *  - una reazione legacy (senza `actorId`/`optionId`) resta leggibile nei dati
 *    persistiti, ma **non** è un output valido del nuovo contratto;
 *  - `reactions: []` è valido: un fatto esclusivamente interno non deve
 *    forzare una reazione NPC.
 *
 * Nessun accesso a DB e nessuna chiamata LLM dentro il validator: l'eventuale
 * repair è iniettato come callback, così resta testabile e limitato a UN tentativo.
 */
import type { ReactionContext } from './ReactionContext';
import { LLMContractError } from '../../llm/contract-error';

/** Forma minima di una reazione per il validator (nessuna dipendenza da prompts/). */
export interface ReactionDecisionLike {
  actorId?: string;
  optionId?: string;
  polityName?: string;
  counterAction?: string;
  response?: string;
  note?: string;
}

/** Evento minimo con reactions: rende il modulo indipendente da SimulationEvent. */
export interface ReactionEventLike {
  headline?: string;
  date?: string;
  description?: string;
  mapChanges?: Array<{ type?: string }>;
  reactions?: ReactionDecisionLike[];
}

export type ReactionDecisionCode =
  | 'missing_actor_id'
  | 'unknown_actor'
  | 'missing_option_id'
  | 'unknown_option'
  | 'option_not_owned_by_actor'
  | 'too_many_reactions'
  | 'material_scope_violation';

export interface ReactionDecisionIssue {
  /** Indice della reazione nell'elenco dell'evento (-1 = problema dell'evento). */
  index: number;
  code: ReactionDecisionCode;
  message: string;
  actorId?: string;
  optionId?: string;
}

/** Categoria di effetto materiale ammessa per una categoria di opzione. */
export type MaterialCategory = 'military' | 'construction' | 'trade';

/**
 * Relazione MINIMA fra `optionId` e categoria materiale ammessa. Non è un
 * motore: serve solo a impedire che una decisione negoziale venga accompagnata
 * da un effetto materiale arbitrario (es. `:negotiate` + invasione).
 * `undefined` = reazione legacy senza `optionId`: si conserva il comportamento
 * precedente (nessun irrigidimento retroattivo).
 */
export function optionMaterialScope(optionId: string | undefined): MaterialCategory[] | undefined {
  if (!optionId) return undefined;
  const suffix = String(optionId).split(':').pop() || '';
  switch (suffix) {
    // Mobilitare o controagire nel proprio territorio può giustificare effetti
    // militari (e le difese costruite a supporto), comunque validati dal motore.
    case 'mobilize':
    case 'counter':
      return ['military', 'construction'];
    case 'embargo':
      return ['trade'];
    // Negoziare, accettare con condizioni, respingere, mediare, sostenere,
    // opporsi, assorbire o resistere non producono effetti materiali propri.
    default:
      return [];
  }
}

/** Categoria materiale di una mapChange; `undefined` = non materiale. */
export function measureMaterialCategory(type: string | undefined): MaterialCategory | undefined {
  switch (String(type || '')) {
    case 'start_mobilization':
    case 'complete_mobilization':
    case 'cancel_mobilization':
    case 'spawn_unit':
    case 'move_unit':
    case 'remove_unit':
    case 'spawn_battalion':
    case 'move_battalion':
      return 'military';
    case 'start_construction':
    case 'update_construction':
    case 'complete_construction':
    case 'cancel_construction':
    case 'build_facility':
      return 'construction';
    default:
      return undefined;
  }
}

/**
 * Una reazione con `optionId` può giustificare la categoria materiale indicata?
 * Senza `optionId` (legacy) la risposta è sempre vera: nessuna rottura storica.
 */
export function reactionAllowsMaterialCategory(
  reaction: ReactionDecisionLike,
  category: MaterialCategory | undefined,
): boolean {
  const scope = optionMaterialScope(reaction.optionId);
  if (scope === undefined) return true;
  if (category === undefined) return true;
  return scope.includes(category);
}

export function findReactionActor(context: ReactionContext, actorId: string | undefined) {
  if (!actorId) return undefined;
  return context.actors.find(actor => actor.id === actorId);
}

/** Validazione di UNA reazione. `index` serve solo a localizzare il rilievo. */
export function validateReactionDecision(
  reaction: ReactionDecisionLike,
  context: ReactionContext,
  index = 0,
): ReactionDecisionIssue[] {
  const issues: ReactionDecisionIssue[] = [];
  const actorId = typeof reaction.actorId === 'string' ? reaction.actorId.trim() : '';
  if (!actorId) {
    issues.push({
      index,
      code: 'missing_actor_id',
      message: 'reaction senza actorId: copia l\'ID esatto di un attore del CONTESTO DI REAZIONE.',
    });
    return issues;
  }
  const actor = findReactionActor(context, actorId);
  if (!actor) {
    issues.push({
      index,
      code: 'unknown_actor',
      message: `actorId "${actorId}" non è un attore rilevante del contesto.`,
      actorId,
    });
    return issues;
  }
  const optionId = typeof reaction.optionId === 'string' ? reaction.optionId.trim() : '';
  if (!optionId) {
    issues.push({
      index,
      code: 'missing_option_id',
      message: `reaction di "${actorId}" senza optionId: scegline uno fra le sue opzioni ammesse.`,
      actorId,
    });
    return issues;
  }
  if (!actor.options.some(option => option.id === optionId)) {
    const ownedByOther = context.actors.some(
      other => other.id !== actorId && other.options.some(option => option.id === optionId),
    );
    issues.push({
      index,
      code: ownedByOther ? 'option_not_owned_by_actor' : 'unknown_option',
      message: ownedByOther
        ? `optionId "${optionId}" appartiene a un altro attore: ${actorId} può scegliere solo fra le sue opzioni.`
        : `optionId "${optionId}" non esiste fra le opzioni di ${actorId}.`,
      actorId,
      optionId,
    });
  }
  return issues;
}

/** Validazione di tutte le reazioni di un evento, incluso il tetto. */
export function validateReactionDecisions(
  reactions: ReactionDecisionLike[] | undefined,
  context: ReactionContext,
): ReactionDecisionIssue[] {
  const list = reactions || [];
  const issues: ReactionDecisionIssue[] = [];
  // `reactions: []` è valido: un fatto interno non deve forzare una reazione.
  if (list.length > context.maxReactions) {
    issues.push({
      index: -1,
      code: 'too_many_reactions',
      message: `${list.length} reactions superano il tetto di ${context.maxReactions} deciso dal motore.`,
    });
  }
  list.forEach((reaction, index) => {
    issues.push(...validateReactionDecision(reaction, context, index));
  });
  return issues;
}

/** Violazioni materiali: una reazione non può giustificare effetti fuori scope. */
export function validateReactionMaterialScope(
  reaction: ReactionDecisionLike,
  categories: Array<MaterialCategory | undefined>,
): ReactionDecisionIssue[] {
  const scope = optionMaterialScope(reaction.optionId);
  if (scope === undefined) return [];
  const offending = categories.find(category => category !== undefined && !scope.includes(category));
  if (!offending) return [];
  return [{
    index: -1,
    code: 'material_scope_violation',
    message: `optionId "${reaction.optionId}" non ammette effetti materiali "${offending}".`,
    optionId: reaction.optionId,
  }];
}

export interface ReactionRepairInput {
  events: ReactionEventLike[];
  issues: ReactionDecisionIssue[];
  context: ReactionContext;
}

export type ReactionRepairFn = (input: ReactionRepairInput) => Promise<ReactionEventLike[]>;

export interface ReactionRepairResult {
  events: ReactionEventLike[];
  issues: ReactionDecisionIssue[];
  /** true se è stato necessario un repair (massimo uno). */
  repaired: boolean;
}

function eventKey(event: ReactionEventLike): string {
  return `${String(event.headline || '').trim()}|${String(event.date || '').trim()}`;
}

function reactionIssuesPerEvent(events: ReactionEventLike[], context: ReactionContext): Map<number, ReactionDecisionIssue[]> {
  const byEvent = new Map<number, ReactionDecisionIssue[]>();
  events.forEach((event, index) => {
    const issues = validateReactionDecisions(event.reactions, context);
    if (issues.length > 0) byEvent.set(index, issues);
  });
  return byEvent;
}

/**
 * Fail-closed con UN SOLO repair di formato:
 *  - valido → nessuna chiamata;
 *  - invalido → una chiamata `repair` che deve preservare gli eventi (stesse
 *    headline/date, stesso numero) e correggere solo `actorId`/`optionId`;
 *  - ancora invalido o eventi alterati → `LLMContractError`.
 */
export async function repairReactionDecisions(input: {
  events: ReactionEventLike[];
  context: ReactionContext;
  repair: ReactionRepairFn;
}): Promise<ReactionRepairResult> {
  const { events, context, repair } = input;
  const initial = reactionIssuesPerEvent(events, context);
  if (initial.size === 0) return { events, issues: [], repaired: false };

  const issues = [...initial.values()].flat();
  const repairedEvents = await repair({ events, issues, context });

  // Il repair NON rigenera la simulazione: gli eventi devono restare quelli.
  if (!Array.isArray(repairedEvents) || repairedEvents.length !== events.length) {
    throw new LLMContractError('reaction repair: il numero di eventi è cambiato (la simulazione non va rigenerata)', {
      mechanic: 'jump',
    });
  }
  for (let index = 0; index < events.length; index += 1) {
    if (eventKey(repairedEvents[index]) !== eventKey(events[index])) {
      throw new LLMContractError(`reaction repair: evento ${index} alterato nella cronaca (headline/data devono restare identici)`, {
        mechanic: 'jump',
      });
    }
  }

  const remaining = reactionIssuesPerEvent(repairedEvents, context);
  if (remaining.size > 0) {
    const codes = [...remaining.values()].flat().map(issue => issue.code).join(', ');
    throw new LLMContractError(`reactions fuori contratto dopo un repair (${codes})`, { mechanic: 'jump' });
  }
  return { events: repairedEvents, issues: [], repaired: true };
}
