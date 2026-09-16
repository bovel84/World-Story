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

/**
 * Digest compatto e limitato della FORMA delle reactions.
 *
 * Serve a diagnosticare i fallimenti reali del contratto: quando un modello
 * remoto non produce `actorId`/`optionId` non basta sapere *che* manca il campo,
 * serve sapere *come* ha chiamato i campi. Il digest non contiene la narrazione:
 * solo i nomi delle chiavi presenti e i valori identificativi (troncati), quindi
 * può stare nel messaggio d'errore persistito in `simulation_jobs.error`.
 */
export function describeReactionShape(
  events: readonly ReactionEventLike[],
  options: { maxReactions?: number; maxLength?: number } = {},
): string {
  const maxReactions = options.maxReactions ?? 4;
  const maxLength = options.maxLength ?? 600;
  const parts: string[] = [];
  events.forEach((event, eventIndex) => {
    const reactions = Array.isArray(event.reactions) ? event.reactions : [];
    for (const reaction of reactions.slice(0, maxReactions)) {
      const raw = reaction as unknown as Record<string, unknown>;
      const value = (key: string) => {
        const rawValue = raw[key];
        if (rawValue === undefined) return 'assente';
        if (rawValue === null) return 'null';
        if (typeof rawValue === 'object') return Array.isArray(rawValue) ? `[${rawValue.length}]` : '{}';
        return `"${String(rawValue).slice(0, 40)}"`;
      };
      parts.push(
        `e${eventIndex}{keys=[${Object.keys(raw).join(',')}] actorId=${value('actorId')}`
        + ` optionId=${value('optionId')} polityName=${value('polityName')}}`,
      );
    }
  });
  const text = parts.slice(0, maxReactions * 2).join(' ') || '(nessuna reaction)';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export type ReactionDecisionCode =
  | 'missing_actor_id'
  | 'unknown_actor'
  | 'missing_option_id'
  | 'unknown_option'
  | 'option_not_owned_by_actor'
  | 'too_many_reactions';

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
    // La leva di un embargo è commerciale, non militare: la categoria dichiara
    // l'intento di §7. Oggi il rilevamento automatico del motore non produce
    // alcuna misura classificata `trade`, quindi l'effetto pratico è che una
    // decisione di embargo non auto-materializza unità o cantieri.
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
    // Riduzioni: oggi il rilevamento automatico del motore non le produce
    // (`detectNpcMaterialMeasure` emette solo avvii e cantieri), quindi la
    // classificazione è qui per completezza e non restringe alcun percorso.
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

/**
 * Il tetto `maxReactions` del motore conta soltanto le politie: gli attori
 * interni (fazioni, settori) hanno un budget proprio e non consumano quello
 * delle reazioni diplomatiche. Il validator deve contare come il motore, o
 * segnalerebbe `too_many_reactions` su un output che il motore stesso ammette.
 */
function countsTowardReactionBudget(reaction: ReactionDecisionLike, context: ReactionContext): boolean {
  const actor = findReactionActor(context, reaction.actorId);
  if (!actor) return true; // attore ignoto: è già un errore, conta comunque
  return actor.role !== 'internal_faction' && actor.role !== 'economic_sector';
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
  const budgeted = list.filter(reaction => countsTowardReactionBudget(reaction, context)).length;
  if (budgeted > context.maxReactions) {
    issues.push({
      index: -1,
      code: 'too_many_reactions',
      message: `${budgeted} reactions superano il tetto di ${context.maxReactions} deciso dal motore.`,
    });
  }
  list.forEach((reaction, index) => {
    issues.push(...validateReactionDecision(reaction, context, index));
  });
  return issues;
}

export interface ReactionRepairInput {
  events: ReactionEventLike[];
  issues: ReactionDecisionIssue[];
  context: ReactionContext;
}

/**
 * Repair di formato (una sola chiamata). Può correggere o **omettere** una
 * reaction, ma deve restituire gli stessi eventi: stesso numero, stesse
 * `headline`/`date`, stesse `mapChanges`.
 */
export type ReactionRepairFn = (input: ReactionRepairInput) => Promise<ReactionEventLike[]>;

export interface ReactionRepairResult {
  events: ReactionEventLike[];
  issues: ReactionDecisionIssue[];
  /** true se è stato necessario un repair (massimo uno). */
  repaired: boolean;
}

/** Impronta canonica di una mapChange: l'ordine delle chiavi non conta. */
function canonicalMapChange(change: any): string {
  const feature = change?.feature || {};
  return JSON.stringify([
    String(change?.type || ''),
    String(change?.regionName || change?.regionId || ''),
    String(change?.targetRegionName || ''),
    String(change?.newOwner || ''),
    String(feature?.type || ''),
    String(feature?.name || ''),
  ]);
}

/**
 * Cronaca dell'evento che il repair NON può toccare: headline, data,
 * descrizione e effetti materiali. Solo reazioni e testo diplomatico possono
 * cambiare, altrimenti il "repair di formato" diventerebbe una seconda
 * simulazione (o un modo per iniettare effetti non legati alla decisione).
 */
function eventChronicleKey(event: ReactionEventLike): string {
  const changes = (event.mapChanges || []).map(canonicalMapChange);
  return JSON.stringify([
    String(event.headline || '').trim(),
    String(event.date || '').trim(),
    String(event.description || '').trim(),
    changes,
  ]);
}

/** Attori ammessi dal motore che compaiono nelle reazioni di un evento. */
function allowedActorKeys(event: ReactionEventLike, context: ReactionContext): string[] {
  return (event.reactions || [])
    .map(reaction => findReactionActor(context, reaction.actorId)?.id)
    .filter((actorId): actorId is string => !!actorId)
    .sort();
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
 *  - invalido → una chiamata `repair` che deve preservare la cronaca (stesso
 *    numero di eventi, stesse headline/date/descrizione/mapChanges) e può solo
 *    correggere od omettere le reazioni fuori contratto;
 *  - ancora invalido, cronaca alterata o reazione di un attore AMMESSO persa a
 *    sproposito → `LLMContractError`.
 *
 * Le reazioni di attori fuori contesto possono essere omesse (non esistono
 * actorId/optionId compatibili con cui sostituirle): è la degradazione
 * documentata, e non silenziosa, del percorso fail-closed. L'unica eccezione
 * in cui si possono perdere anche reazioni di attori ammessi è la correzione di
 * `too_many_reactions`, cioè quando il motore ha chiesto di ridurne il numero.
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
  const mayTrimReactions = issues.some(issue => issue.code === 'too_many_reactions');
  const repairedEvents = await repair({ events, issues, context });

  // Il repair NON rigenera la simulazione: gli eventi devono restare quelli.
  if (!Array.isArray(repairedEvents) || repairedEvents.length !== events.length) {
    const count = Array.isArray(repairedEvents) ? repairedEvents.length : 'non-array';
    throw new LLMContractError(
      `reaction repair: il numero di eventi è cambiato (${events.length} → ${count}; la simulazione non va rigenerata)`
      + ` — forma: ${describeReactionShape(repairedEvents || [])}`,
      { mechanic: 'jump' },
    );
  }
  for (let index = 0; index < events.length; index += 1) {
    if (eventChronicleKey(repairedEvents[index]) !== eventChronicleKey(events[index])) {
      throw new LLMContractError(
        `reaction repair: evento ${index} alterato nella cronaca (headline, data, descrizione e mapChanges devono restare identici)`,
        { mechanic: 'jump' },
      );
    }
  }
  if (!mayTrimReactions) {
    for (let index = 0; index < events.length; index += 1) {
      const before = allowedActorKeys(events[index], context);
      const after = allowedActorKeys(repairedEvents[index], context);
      if (before.join('|') !== after.join('|')) {
        throw new LLMContractError(
          `reaction repair: evento ${index} ha perso la reazione di un attore ammesso dal motore (${before.join(', ')} → ${after.join(', ') || 'nessuna'})`,
          { mechanic: 'jump' },
        );
      }
    }
  }

  const remaining = reactionIssuesPerEvent(repairedEvents, context);
  if (remaining.size > 0) {
    const codes = [...remaining.values()].flat().map(issue => issue.code).join(', ');
    // La forma osservata è l'unico modo per capire un modello che rinomina i campi:
    // senza di essa un fallimento in produzione non è diagnosticabile.
    const shape = describeReactionShape(repairedEvents);
    throw new LLMContractError(`reactions fuori contratto dopo un repair (${codes}) — forma: ${shape}`, {
      mechanic: 'jump',
    });
  }
  return { events: repairedEvents, issues: [], repaired: true };
}
