/**
 * World Story — ReactionContext
 * =============================
 * Il *motore* decide cosa è vero e possibile; l'LLM sceglie soltanto fra le
 * possibilità materialmente valide. Questo modulo formalizza:
 *
 *  - `Trigger`: la causa esplicita dell'evento (ordine del giocatore, evento
 *    precedente, processo mondiale, reazione diplomatica, pressione economica,
 *    sviluppo militare o pressione interna);
 *  - `RelevantActor`: chi è coinvolto e **perché** (collegamento causale),
 *    con le opzioni materialmente ammesse per quell'attore;
 *  - `MaterialConstraint`: i vincoli materiali già calcolati dal motore
 *    (bilancio, militare, risorse, trattati, interno, geografia);
 *  - `ReactionContext`: il pacchetto già filtrato e limitato che viene passato
 *    all'LLM.
 *
 * Tutto è puro e deterministico: nessun accesso a DB, nessuna chiamata LLM.
 * Le catene non sono infinite: il contesto fissa un tetto di reazioni e ogni
 * attore esiste solo se esiste un collegamento causale documentato.
 */

export type TriggerKind =
  | 'player_action'
  | 'prior_event'
  | 'world_process'
  | 'diplomatic_reaction'
  | 'economic_pressure'
  | 'military_development'
  | 'internal_pressure';

export interface Trigger {
  kind: TriggerKind;
  /** Descrizione materiale della causa, mai un'etichetta vuota. */
  summary: string;
  /** Riferimento alla causa (actionId, projectId, pressureId, evento). */
  sourceRef?: string;
}

export type RelevantActorRole =
  | 'counterparty'
  | 'ally'
  | 'rival'
  | 'mediator'
  | 'neighbour'
  | 'trade_partner'
  | 'internal_faction'
  | 'economic_sector'
  | 'observer';

export interface ActorOption {
  id: string;
  label: string;
  /** Vincolo materiale che limita o abilita questa opzione. */
  constraint?: string;
}

export interface RelevantActor {
  /** polityId per le politie, `faction:<n>` / `sector:<n>` per gli attori interni. */
  id: string;
  name: string;
  role: RelevantActorRole;
  /** Perché è rilevante: collegamento causale esplicito, non un'etichetta. */
  because: string;
  interests: string[];
  options: ActorOption[];
}

export type MaterialConstraintKind = 'budget' | 'military' | 'resource' | 'treaty' | 'internal' | 'geography';

export interface MaterialConstraint {
  kind: MaterialConstraintKind;
  description: string;
}

export interface ReactionContext {
  trigger: Trigger;
  actors: RelevantActor[];
  constraints: MaterialConstraint[];
  /** Unione degli id-opzione ammessi: l'LLM sceglie solo fra questi. */
  allowedOptionIds: string[];
  /** Tetto di reazioni: nessuna catena infinita. */
  maxReactions: number;
}

export interface ReactionRegionInput {
  id: string;
  name: string;
  owner: string;
  borders?: string[];
  population?: number;
}

export interface ReactionAccountInput {
  militaryPower?: number;
  effectiveMilitaryPower?: number;
  stability?: number;
  socialTension?: number;
  gdp?: number;
  government?: string;
}

export interface ReactionContextInput {
  playerPolityId: string;
  playerPolityName: string;
  /** Ordini/azioni del turno corrente (solo testo, senza ID canonico). */
  focusTexts: string[];
  /**
   * Ordini del turno CORRENTE con il loro ID canonico. NON è lo storico:
   * lo storico azioni non deve mai determinare il trigger del turno.
   */
  currentActions?: CurrentReactionAction[];
  polityNames: Record<string, string>;
  regions: Record<string, ReactionRegionInput>;
  relationships?: Record<string, Record<string, string>>;
  accounts?: Record<string, ReactionAccountInput>;
  resources?: {
    debt?: number;
    creditLimit?: number;
    creditHeadroom?: number;
    stock?: Record<string, number>;
  };
  government?: { factions?: Array<{ id?: string; name?: string; pressure?: number; stance?: string }> };
  pressures?: Array<{ id: string; kind: string; title: string; detail: string }>;
  ongoingProcesses?: Array<{ id: string; title: string; sourceActionId: string }>;
  crisis?: { level?: string; headline?: string };
}

/** Ordine del turno corrente: testo + ID canonico della stessa azione. */
export interface CurrentReactionAction {
  actionId?: string;
  text: string;
}

const MAX_ACTORS = 8;
const MAX_REACTIONS = 4;

function normalizeName(value: string): string {
  return String(value || '')
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Cittadini della nazione giocatore: chi confina con il territorio del giocatore. */
function frontierOwnerIds(input: ReactionContextInput): Set<string> {
  const regions = Object.values(input.regions);
  const byId = new Map(regions.map(region => [region.id, region]));
  const owners = new Set<string>();
  for (const region of regions) {
    if (region.owner !== input.playerPolityId) continue;
    for (const borderId of region.borders || []) {
      const other = byId.get(borderId)?.owner;
      if (other && other !== 'neutral' && other !== input.playerPolityId) owners.add(other);
    }
  }
  return owners;
}

/** Politie nominate esplicitamente negli ordini del turno. */
function mentionedPolityIds(input: ReactionContextInput): string[] {
  const owners = [...new Set(Object.values(input.regions).map(region => region.owner))]
    .filter(owner => owner && owner !== 'neutral' && owner !== input.playerPolityId);
  const found: string[] = [];
  for (const text of input.focusTexts) {
    const normalized = ` ${normalizeName(text)} `;
    for (const owner of owners) {
      if (found.includes(owner)) continue;
      const aliases = [
        input.polityNames[owner],
        owner,
        ...Object.values(input.regions).filter(region => region.owner === owner).map(region => region.name),
      ]
        .filter((name): name is string => typeof name === 'string' && name.length >= 3)
        .map(normalizeName);
      if (aliases.some(alias => alias && normalized.includes(` ${alias} `))) found.push(owner);
    }
  }
  return found;
}

function stance(input: ReactionContextInput, from: string, to: string): string {
  return input.relationships?.[from]?.[to] || 'neutral';
}

function actorRole(input: ReactionContextInput, polityId: string, mentioned: string[], adjacent: Set<string>): RelevantActorRole {
  if (mentioned.includes(polityId)) {
    const relation = stance(input, polityId, input.playerPolityId);
    if (relation === 'ally') return 'ally';
    if (relation === 'hostile') return 'rival';
    return 'counterparty';
  }
  const relation = stance(input, polityId, input.playerPolityId);
  if (relation === 'ally') return 'ally';
  if (relation === 'hostile') return 'rival';
  if (adjacent.has(polityId)) return 'neighbour';
  if (relation !== 'neutral') return 'trade_partner';
  return 'observer';
}

function because(input: ReactionContextInput, polityId: string, mentioned: string[], adjacent: Set<string>): string {
  const name = input.polityNames[polityId] || polityId;
  if (mentioned.includes(polityId)) return `nominata esplicitamente negli ordini del turno (${input.focusTexts.find(text => normalizeName(text).includes(normalizeName(name))) || name})`;
  const relation = stance(input, polityId, input.playerPolityId);
  if (relation !== 'neutral') return `${name} ha un rapporto registrato "${relation}" con ${input.playerPolityName}`;
  if (adjacent.has(polityId)) return `${name} confina con il territorio di ${input.playerPolityName}`;
  return `${name} è nello scacchiere per un legame documentato dalla cronaca`;
}

/** Opzioni materialmente ammesse per una politia, già filtrate dai vincoli. */
function polityOptions(
  input: ReactionContextInput,
  polityId: string,
  role: RelevantActorRole,
  creditHeadroom: number,
): ActorOption[] {
  const account = input.accounts?.[polityId] || {};
  const hasArmy = Number(account.militaryPower || account.effectiveMilitaryPower || 0) > 0;
  const options: ActorOption[] = [
    { id: `${polityId}:negotiate`, label: 'Aprire o proseguire un negoziato' },
    { id: `${polityId}:reject`, label: 'Respingere la richiesta' },
    { id: `${polityId}:condition`, label: 'Accettare con condizioni verificabili' },
  ];
  if (hasArmy) {
    options.push({
      id: `${polityId}:mobilize`,
      label: 'Mobilitare o schierare forze',
      constraint: `${account.militaryPower || 0} di potenza militare di mappa`,
    });
    options.push({
      id: `${polityId}:counter`,
      label: 'Controazione materiale nel proprio territorio',
      constraint: 'solo se materialmente avviata nel periodo',
    });
  }
  if (role === 'neighbour' || role === 'mediator') {
    options.push({ id: `${polityId}:mediate`, label: 'Offrire mediazione regionale' });
  }
  if (creditHeadroom <= 0) {
    options.push({
      id: `${polityId}:embargo`,
      label: 'Embargo o ritorsione commerciale',
      constraint: 'nessun margine di credito proprio: la leva è commerciale, non finanziaria',
    });
  } else {
    options.push({ id: `${polityId}:embargo`, label: 'Embargo o ritorsione commerciale' });
  }
  return options;
}

/**
 * Costruisce il contesto di reazione: chi è coinvolto, perché, quali opzioni
 * sono materialmente possibili e quali vincoli limitano la scelta.
 */
export function buildReactionContext(input: ReactionContextInput): ReactionContext {
  const mentioned = mentionedPolityIds(input);
  const adjacent = frontierOwnerIds(input);
  const resources = input.resources || {};
  const creditHeadroom = Number(resources.creditHeadroom ?? 0);
  const playerAccount = input.accounts?.[input.playerPolityId] || {};

  // Trigger: la causa esplicita, in ordine di priorità. Gli ordini del turno
  // corrente vengono PRIMA dello storico (che qui non entra mai): `summary` e
  // `sourceRef` devono riferirsi alla stessa azione. Se esiste solo il testo
  // (focusTexts) senza ID canonico, non si associa l'ID di una vecchia azione.
  const currentAction = (input.currentActions || []).find(
    action => action && typeof action.text === 'string' && action.text.trim().length > 0,
  );
  const firstFocus = input.focusTexts.find(text => typeof text === 'string' && text.trim().length > 0);
  const trigger: Trigger = currentAction
    ? (currentAction.actionId
      ? { kind: 'player_action', summary: currentAction.text, sourceRef: currentAction.actionId }
      : { kind: 'player_action', summary: currentAction.text })
    : firstFocus
    ? { kind: 'player_action', summary: firstFocus }
    : input.ongoingProcesses?.length
      ? { kind: 'world_process', summary: input.ongoingProcesses[0].title, sourceRef: input.ongoingProcesses[0].id }
      : input.pressures?.find(pressure => pressure.kind === 'external')
        ? { kind: 'economic_pressure', summary: input.pressures.find(pressure => pressure.kind === 'external')!.title, sourceRef: input.pressures.find(pressure => pressure.kind === 'external')!.id }
        : input.pressures?.length
          ? { kind: 'internal_pressure', summary: input.pressures[0].title, sourceRef: input.pressures[0].id }
          : { kind: 'prior_event', summary: 'Nessuna nuova azione: il mondo prosegue i filoni documentati.' };

  // Attori: nominati, vicini, con rapporto registrato. Nessuna terza nazione arbitraria.
  const polityIds = [...new Set([...mentioned, ...adjacent, ...Object.keys(input.relationships || {})])]
    .filter(id => id && id !== 'neutral' && id !== input.playerPolityId)
    .filter(id => Object.values(input.regions).some(region => region.owner === id))
    .slice(0, MAX_ACTORS);

  const actors: RelevantActor[] = polityIds.map(polityId => {
    const role = actorRole(input, polityId, mentioned, adjacent);
    return {
      id: polityId,
      name: input.polityNames[polityId] || polityId,
      role,
      because: because(input, polityId, mentioned, adjacent),
      interests: [stance(input, polityId, input.playerPolityId) === 'hostile' ? 'sicurezza' : 'interesse nazionale'],
      options: polityOptions(input, polityId, role, creditHeadroom),
    };
  });

  // Attori interni: fazioni del governo e settori economici toccati.
  const factions = (input.government?.factions || []).slice(0, 2);
  for (const faction of factions) {
    const id = `faction:${faction.id || normalizeName(faction.name || 'fazione')}`;
    actors.push({
      id,
      name: faction.name || faction.id || 'Fazione interna',
      role: 'internal_faction',
      because: `fazione interna con pressione ${faction.pressure ?? 'registrata'} sulla decisione`,
      interests: [faction.stance || 'consenso interno'],
      options: [
        { id: `${id}:support`, label: 'Sostenere pubblicamente la decisione' },
        { id: `${id}:oppose`, label: 'Opporsi o chiedere una correzione' },
      ],
    });
  }
  if (factions.length > 0 || (input.ongoingProcesses?.length || 0) > 0) {
    const id = 'sector:economy';
    actors.push({
      id,
      name: 'Settori economici della nazione',
      role: 'economic_sector',
      because: 'la decisione ha un costo o un beneficio materiale misurabile',
      interests: ['produzione', 'occupazione', 'bilancio'],
      options: [
        { id: `${id}:absorb`, label: 'Assorbire il costo senza crisi' },
        { id: `${id}:resist`, label: 'Resistere: razionamenti o ritardi' },
      ],
    });
  }

  // Vincoli materiali già calcolati dal motore.
  const constraints: MaterialConstraint[] = [];
  if (creditHeadroom <= 0) {
    constraints.push({ kind: 'budget', description: `Nessun margine di credito (debito ${resources.debt ?? 0} su tetto ${resources.creditLimit ?? 0}): niente nuove spese nette.` });
  } else {
    constraints.push({ kind: 'budget', description: `Margine di credito disponibile: ${Math.round(creditHeadroom * 100) / 100} mld.` });
  }
  const playerMilitary = Number(playerAccount.effectiveMilitaryPower ?? playerAccount.militaryPower ?? 0);
  const strongestRival = Math.max(0, ...polityIds.map(id => Number(input.accounts?.[id]?.effectiveMilitaryPower ?? input.accounts?.[id]?.militaryPower ?? 0)));
  constraints.push({ kind: 'military', description: `Potenza effettiva del giocatore ${playerMilitary}; attore più forte in scena ${strongestRival}.` });
  const stock = resources.stock || {};
  if (Number(stock.weapons ?? 0) <= 0 || Number(stock.fuel ?? 0) <= 0) {
    constraints.push({ kind: 'resource', description: 'Scorte di armamenti o carburante insufficienti per operazioni prolungate.' });
  }
  if (input.relationships && Object.keys(input.relationships).length > 0) {
    constraints.push({ kind: 'treaty', description: 'I rapporti registrati (alleato/ostile) vincolano le risposte: nessun accordo senza consenso esplicito della controparte.' });
  }
  if (input.crisis?.level === 'critical' || Number(playerAccount.socialTension ?? 0) >= 70) {
    constraints.push({ kind: 'internal', description: `Crisi interna (${input.crisis?.headline || 'tensione sociale alta'}): nessun successo pieno mentre lo Stato è a rischio.` });
  }
  if (adjacent.size > 0) {
    constraints.push({ kind: 'geography', description: 'Vincolo geografico: reagiscono la controparte e i vicini, non potenze lontane senza interesse.' });
  }

  const allowedOptionIds = [...new Set(actors.flatMap(actor => actor.options.map(option => option.id)))];
  return {
    trigger,
    actors,
    constraints,
    allowedOptionIds,
    maxReactions: Math.min(MAX_REACTIONS, Math.max(1, actors.filter(actor => actor.role !== 'economic_sector' && actor.role !== 'internal_faction').length)),
  };
}

/** Rende il contesto come blocco compatto da inserire nel prompt. */
export function renderReactionContext(context: ReactionContext): string {
  const lines: string[] = [];
  lines.push(`CAUSA (${context.trigger.kind}${context.trigger.sourceRef ? `, ${context.trigger.sourceRef}` : ''}): ${context.trigger.summary}`);
  if (context.constraints.length > 0) {
    lines.push('VINCOLI MATERIALI (calcolati dal motore):');
    for (const constraint of context.constraints) lines.push(`- [${constraint.kind}] ${constraint.description}`);
  }
  if (context.actors.length === 0) {
    lines.push('ATTORI RILEVANTI: nessuno oltre al governo del giocatore (fatto esclusivamente interno).');
  } else {
    lines.push('ATTORI RILEVANTI E OPZIONI AMMESSE (scegli solo fra queste):');
    for (const actor of context.actors) {
      const options = actor.options.map(option => option.constraint ? `${option.id} (${option.constraint})` : option.id).join(' | ');
      lines.push(`- ${actor.name} [${actor.id}] ruolo=${actor.role} — perché: ${actor.because}`);
      lines.push(`  opzioni: ${options}`);
    }
  }
  lines.push(`Rispondono al massimo ${context.maxReactions} attori pertinenti. Ogni evento genera un seguito solo se esiste una nuova conseguenza materialmente significativa.`);
  return lines.join('\n');
}

/** Nomi ammessi per le reazioni: le politie del contesto (il giocatore a parte). */
export function allowedActorIds(context: ReactionContext): Set<string> {
  return new Set(context.actors.filter(actor => !actor.id.includes(':')).map(actor => actor.id));
}
