/**
 * World Story — «World pulse» (WS-NARR-DISPATCH-PAX-QUALITY)
 * =========================================================
 * Passaggio **separato e opzionale** (`narrative.worldPulse`, spento di
 * default): propone **fino a 3 eventi narrativi** di nazioni non giocate che
 * hanno un **trigger dinamico** verificabile. Zero eventi è sempre valido.
 *
 * Differenze chiave rispetto alla prima versione:
 *  - una **relazione non è una causa**: `hostile`/`ally` sono **contesto**, non
 *    un trigger. Serve almeno un trigger dinamico (fatto recente, impegno in
 *    vigore, agenda NPC esplicita, cambiamento relazionale del turno).
 *  - il pulse vede lo **stato post-turno**: relazioni effettive (matrice +
 *    `relationshipChanges` del turno) ed eventi appena prodotti.
 *  - **narrativa-only**: descrizioni e `counterAction` non possono dichiarare
 *    mutazioni materiali che il motore non applica.
 *  - **finestra temporale** e **divergenceDate** esplicite.
 *
 * Il modulo è puro: selezione, prompt, guard e validazione si provano senza
 * provider. `EffectValidator` e `ReactionDecisions` non vengono duplicati.
 */
import type { PromptVariables, SimulationResult, SimulationEvent } from '../types';
import type { ReactionContext, RelevantActor } from '../../core/simulation/ReactionContext';
import { validateReactionDecisions, type ReactionDecisionIssue } from '../../core/simulation/ReactionDecisions';
import { validateStrictMapChanges, EffectValidationError } from '../../core/simulation/EffectValidator';
import { EVENT_DESCRIPTION_GUIDE } from '../immersion';
import { parseIncrementalSimulationResponse } from './parse';

/** Zero eventi è sempre lecito: un pulse corto è meglio di un pulse inventato. */
export const WORLD_PULSE_MIN_EVENTS = 0;
export const WORLD_PULSE_MAX_EVENTS = 3;
/** Tetto di candidati per non gonfiare il prompt. */
export const WORLD_PULSE_MAX_CANDIDATES = 6;

/** Istruzione di sistema breve: il pulse è cronaca del mondo, non del giocatore. */
export const WORLD_PULSE_SYSTEM =
  'Sei il cronista delle nazioni non giocate: proponi solo fatti con un trigger ' +
  'dinamico verificabile, non dichiarare mutazioni materiali e rispondi in NDJSON valido.';

export interface WorldPulsePolity {
  id: string;
  name: string;
}

export interface WorldPulseRelation {
  from: string;
  to: string;
  relation: string;
}

export interface WorldPulseRecentEvent {
  date: string;
  headline: string;
  detail?: string;
}

export interface WorldPulseRelationshipChange {
  from: string;
  to: string;
  relationship: string;
}

/** Tutto ciò che serve alla selezione deterministica, già estratto dal gioco. */
export interface WorldPulseSelectionInput {
  playerPolityId: string;
  polities: WorldPulsePolity[];
  /** Matrice relazionale **effettiva** (già con i cambi del turno applicati). */
  relationships: WorldPulseRelation[];
  /** Testo del registro impegni in vigore (una voce per riga). */
  commitments: string;
  /** Fatti recenti, dal più recente, con gli eventi del turno in testa. */
  recentEvents: WorldPulseRecentEvent[];
  /** Dossier NPC (identità/agenda), testo già composto dal motore. */
  npcDossiers: string;
  /** Confine inferiore della finestra: un trigger più vecchio non conta. */
  originDate: string;
}

/**
 * Una nazione è candidata **solo** con almeno un trigger dinamico.
 *
 * `triggers` autorizzano la candidatura; `relevantRelations` arricchiscono il
 * contesto ma **non** autorizzano da soli.
 */
export interface WorldPulseCandidate {
  polityId: string;
  polityName: string;
  triggers: string[];
  relevantRelations: string[];
  activeCommitments: string[];
  recentTriggers: string[];
  agendaTriggers: string[];
}

function mentions(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return text.toLowerCase().includes(needle);
}

function linesMentioning(text: string, name: string): string[] {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && mentions(line, name));
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Un trigger recente deve cadere fra `originDate - LOOKBACK` e oggi. */
const RECENT_TRIGGER_LOOKBACK_DAYS = 180;

/**
 * Estrae dal dossier NPC le agende **realmente attive**, per id di politia.
 *
 * Il dossier è prodotto dal motore con marker stabili: ogni blocco inizia con
 * `- Nome [ID]` e contiene una riga `Agenda strategica: ...`; quando non c'è
 * un'agenda attiva il motore scrive il fallback «nessun obiettivo attivo
 * registrato». Il fallback è esplicitamente escluso: **fallisci chiuso**.
 */
export function dossierActiveAgendas(dossiers: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of String(dossiers || '').split(/\n(?=- )/)) {
    const idMatch = block.match(/\[([A-Za-z0-9_-]+)\]/);
    if (!idMatch) continue;
    const agendaMatch = block.match(/Agenda strategica:\s*(.+)/i);
    if (!agendaMatch) continue;
    const text = agendaMatch[1].trim();
    if (/nessun obiettivo attivo/i.test(text)) continue;
    out.set(idMatch[1], text);
  }
  return out;
}

/**
 * Selezione deterministica: nessun LLM, nessun criterio geografico. Ordina per
 * numero di trigger, poi per nome.
 */
export function selectWorldPulseCandidates(input: WorldPulseSelectionInput): WorldPulseCandidate[] {
  const playerId = input.playerPolityId;
  const agendas = dossierActiveAgendas(input.npcDossiers);
  const candidates: WorldPulseCandidate[] = [];

  for (const polity of input.polities) {
    if (!polity?.id || polity.id === playerId || polity.id === 'neutral') continue;

    // Le relazioni sono CONTESTO: non creano da sole il candidato.
    const relevantRelations: string[] = [];
    for (const rel of input.relationships) {
      if (rel.from !== polity.id && rel.to !== polity.id) continue;
      const otherId = rel.from === polity.id ? rel.to : rel.from;
      const otherName = input.polities.find(p => p.id === otherId)?.name || otherId;
      const relation = rel.relation.trim().toLowerCase();
      if (!relation || relation === 'neutral') continue;
      relevantRelations.push(`${polity.name} ↔ ${otherName}: ${relation}`);
    }

    const activeCommitments = linesMentioning(input.commitments, polity.name);

    const recentTriggers: string[] = [];
    for (const event of input.recentEvents) {
      if (!mentions(`${event.headline} ${event.detail || ''}`, polity.name)) continue;
      const age = daysBetween(event.date, input.originDate);
      if (!Number.isFinite(age) || age > RECENT_TRIGGER_LOOKBACK_DAYS || age < 0) continue;
      recentTriggers.push(`${event.date}: ${event.headline}`);
    }

    const agendaText = agendas.get(polity.id);
    const agendaTriggers = agendaText ? [agendaText] : [];

    const triggers = [
      ...recentTriggers.map(trigger => `fatto recente: ${trigger}`),
      ...activeCommitments.map(commitment => `impegno in vigore: ${commitment}`),
      ...agendaTriggers.map(agenda => `agenda NPC attiva: ${agenda}`),
    ];
    if (triggers.length === 0) continue;

    candidates.push({
      polityId: polity.id,
      polityName: polity.name,
      triggers: [...new Set(triggers)],
      relevantRelations,
      activeCommitments,
      recentTriggers,
      agendaTriggers,
    });
  }

  candidates.sort((a, b) => b.triggers.length - a.triggers.length || a.polityName.localeCompare(b.polityName));
  return candidates;
}

/**
 * Contesto di reazione **del pulse**, costruito solo dai candidati scelti.
 * Non è il reaction context del giocatore e non autorizza attori esterni.
 */
export function buildWorldPulseContext(candidates: WorldPulseCandidate[]): ReactionContext {
  const actors: RelevantActor[] = candidates.map(candidate => ({
    id: candidate.polityId,
    name: candidate.polityName,
    role: 'neighbour',
    because: candidate.triggers.slice(0, 2).join('; ') || 'trigger canonico nel pulse',
    interests: candidate.triggers.slice(0, 3),
    options: [{ id: `${candidate.polityId}:pulse`, label: 'Iniziativa autonoma motivata' }],
  }));
  return {
    trigger: { kind: 'world_process', summary: 'Respiro del mondo: fatti di nazioni con trigger canonico' },
    actors,
    constraints: [],
    allowedOptionIds: actors.flatMap(actor => actor.options.map(option => option.id)),
    maxReactions: Math.max(1, actors.length),
  };
}

export interface WorldPulseInput {
  originDate: string;
  targetDate: string;
  /** Data di divergenza: `REAL HISTORY < divergenceDate`, `GAME HISTORY >=`. */
  divergenceDate: string;
  playerPolity: string;
  candidates: WorldPulseCandidate[];
  /** Eventi appena prodotti dal turno: trigger e vincolo anti-contraddizione. */
  mainEvents: Array<{ date: string; headline: string; description?: string }>;
  /** Cambi di relazione del turno: autoritativi per questo periodo. */
  relationshipChanges: WorldPulseRelationshipChange[];
  recentChronicle: string;
}

/**
 * Prompt del pulse. Trigger espliciti, confine temporale con `divergenceDate`,
 * eventi del turno come contesto, contratto **narrativa-only**, zero valido.
 */
export function buildWorldPulsePrompt(input: WorldPulseInput): string {
  const candidates = input.candidates.slice(0, WORLD_PULSE_MAX_CANDIDATES);
  const blocks = candidates.map(candidate => {
    const lines = [
      `- ${candidate.polityName} [${candidate.polityId}]`,
      candidate.triggers.length ? `  TRIGGER ATTIVI: ${candidate.triggers.join(' | ')}` : '',
      candidate.relevantRelations.length ? `  [RELAZIONI CORRENTI] ${candidate.relevantRelations.join(' | ')}` : '',
      candidate.activeCommitments.length ? `  [IMPEGNI ATTIVI] ${candidate.activeCommitments.join(' | ')}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n');

  const mainEvents = input.mainEvents.slice(0, 12)
    .map(event => `- ${event.date}: ${event.headline}${event.description ? ` — ${event.description.slice(0, 220)}` : ''}`)
    .join('\n');
  const relationshipChanges = input.relationshipChanges.slice(0, 12)
    .map(change => `- ${change.from} ↔ ${change.to}: ${change.relationship}`)
    .join('\n');

  return `RESPIRO DEL MONDO — EVENTI DI NAZIONI NON GIOCATE
Periodo: ${input.originDate} → ${input.targetDate}.
Il giocatore controlla ${input.playerPolity}: questo passaggio NON racconta i suoi ordini.

[CONFINE TEMPORALE]
Divergenza: ${input.divergenceDate}
- REAL HISTORY < ${input.divergenceDate}
- GAME HISTORY >= ${input.divergenceDate}
- dopo la divergenza la storia reale futura NON è canonica: usa soltanto la timeline della partita (stato corrente e post-turno).
- Un Pulse successivo alla divergenza NON può usare eventi reali avvenuti dopo ${input.divergenceDate}.

CANDIDATI (solo nazioni con trigger attivo; NON aggiungerne altre):
${blocks || '(nessun candidato con trigger attivo)'}

[EVENTI APPENA ACCADUTI NEL PERIODO]
${mainEvents || '(nessun evento nel periodo)'}

[CAMBI DI RELAZIONE NEL PERIODO — autoritativi]
${relationshipChanges || '(nessun cambio di relazione)'}

CRONACA RECENTE:
${input.recentChronicle || '(nessuna cronaca disponibile)'}

REGOLE DEL RESPIRO DEL MONDO:
1. Genera FINO A ${WORLD_PULSE_MAX_EVENTS} eventi di nazioni non giocate, usando SOLO i candidati e i loro TRIGGER. Se i trigger non bastano, genera MENO eventi o NESSUN evento: zero è valido, non inventare nulla per riempire il budget.
2. Ogni evento deve nascere da un trigger attivo. Una relazione da sola NON è un trigger.
3. NON contraddire decisioni, accordi, cessate-il-fuoco, cambi di relazione, esiti o processi appena stabiliti negli [EVENTI APPENA ACCADUTI NEL PERIODO]. Se un accordo è appena concluso, non raccontare una ripresa della guerra senza un nuovo trigger successivo.
4. CONTRATTO NARRATIVA-ONLY: puoi raccontare solo atti che non richiedono una mutazione materiale immediata — dichiarazioni, consultazioni, apertura di colloqui, dibattito parlamentare, proteste, segnali politici, annunci di intenzione, pressioni interne, richieste formali, vertici annunciati, minacce espresse come minacce, valutazioni preparatorie.
   VIETATO dichiarare mutazioni materiali: mobilitazioni, spostamenti o schieramenti di unità, costruzioni, conquiste, annessioni, embarghi applicati, trattati/alleanze già in vigore, guerre iniziate, cambi di governo, creazione di asset, trasferimenti territoriali, variazioni numeriche.
   Esempio ammesso: «Il governo annuncia che valuterà una mobilitazione». Esempio vietato: «Il governo mobilita due divisioni».
5. Non inventare nazioni, leader, cifre o episodi non presenti nel contesto. ${input.playerPolity} compare solo se un fatto la tocca direttamente.
6. Ogni evento è una notizia: soggetto + atto concreto, ${EVENT_DESCRIPTION_GUIDE}. Niente mapChanges e niente effetti materiali.
7. Se un candidato reagisce a un altro, usa actorId/optionId fra quelli ammessi; "counterAction" solo se non materiale. Altrimenti lascia "reactions": [].

OUTPUT NDJSON, una riga JSON per oggetto, niente markdown. Riga evento:
{"type":"event","headline":"attore + atto concreto","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[]}

ULTIMA riga obbligatoria (anche senza eventi):
{"type":"complete","narration":"sintesi dei soli eventi emessi","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":${JSON.stringify(input.targetDate)}}`;
}

/** Parsing: riusa il parser incrementale esistente, nessun formato nuovo. */
export function parseWorldPulseResponse(text: string): SimulationResult {
  return parseIncrementalSimulationResponse(text);
}

// --- Guard narrativa-only --------------------------------------------------

/**
 * Verbi/azioni che implicano una mutazione materiale. Lista **prudente**: meglio
 * respingere un pulse dubbio che canonizzare un fatto che il motore non conosce.
 */
const MATERIAL_STEMS = [
  'mobilit', 'schier', 'occup', 'conquist', 'costru', 'annett', 'anness',
  'dichiara guerra', 'dichiarazione di guerra', 'embargo', 'trasferisc',
  'trasferit', 'invasione', 'invade', 'offensiva', 'blocco navale',
  'divisioni', 'battaglion', 'flotta', 'missili', 'crea unità', 'nuova unità',
  'base militare', 'nuova base',
];

/**
 * Marker che trasformano un materiale in un'intenzione: «annuncia che valuterà
 * una mobilitazione» è ammesso, «mobilita due divisioni» no.
 */
const INTENTION_MARKERS = [
  'valuter', 'potrebbe', 'annuncia che', 'intende', 'minacc', 'valuta',
  'non esclude', 'studia', 'esamina', 'ipotesi', 'proposta di', 'chiede',
  'richiede', 'convoca', 'consultazioni', 'dibattito', 'vertice', 'colloqui',
];

/** Ritorna lo stem materiale trovato, o `null` se il testo è narrativa-only. */
export function findMaterialClaim(text: string): string | null {
  const lower = String(text || '').toLowerCase();
  for (const stem of MATERIAL_STEMS) {
    let index = lower.indexOf(stem);
    while (index !== -1) {
      const before = lower.slice(Math.max(0, index - 60), index);
      const intention = INTENTION_MARKERS.some(marker => before.includes(marker));
      if (!intention) return stem;
      index = lower.indexOf(stem, index + stem.length);
    }
  }
  return null;
}

/** Guard narrativa-only: respinge materiali nel testo o in `counterAction`. */
export function validateNarrativeOnlyWorldPulseEvent(event: SimulationEvent): string | null {
  const claim = findMaterialClaim(`${event?.headline || ''} ${event?.description || ''}`);
  if (claim) return `material_claim:${claim}`;
  for (const reaction of event?.reactions || []) {
    const counter = findMaterialClaim(String(reaction?.counterAction || ''));
    if (counter) return `material_counter_action:${counter}`;
  }
  return null;
}

// --- Anti-contraddizione con il turno principale ---------------------------

const CONFLICT_STEMS = [
  'guerra', 'offensiva', 'invasione', 'attacco', 'ostilità', 'ostilita',
  'mobilit', 'occup', 'conquist', 'blocco navale', 'scontri armati',
];

export interface WorldPulseContradictionInput {
  relationshipChanges?: WorldPulseRelationshipChange[];
  /** Riepiloghi degli esiti respinti dal turno: non possono risultare compiuti. */
  rejectedOutcomes?: string[];
  /** Mappa nome→id/name utile a riconoscere le coppie citate. */
  polityNames?: Record<string, string>;
}

function normalize(text: string): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Contraddizioni strutturate, rilevabili senza semantica: una ripresa del
 * conflitto dopo un accordo appena concluso, o un esito respinto raccontato
 * come riuscito. Fail-closed: in dubbio, respingi.
 */
export function detectWorldPulseContradiction(
  event: SimulationEvent,
  input: WorldPulseContradictionInput,
): string | null {
  const text = normalize(`${event?.headline || ''} ${event?.description || ''}`);
  const nameOf = (id: string) => input.polityNames?.[id] || id;

  for (const change of input.relationshipChanges || []) {
    const relationship = String(change.relationship || '').toLowerCase();
    if (relationship !== 'neutral' && relationship !== 'ally') continue;
    const fromName = nameOf(change.from);
    const toName = nameOf(change.to);
    const bothMentioned = text.includes(normalize(fromName)) && text.includes(normalize(toName));
    const conflict = CONFLICT_STEMS.some(stem => text.includes(stem));
    if (bothMentioned && conflict) return `relation_conflict:${change.from}-${change.to}`;
  }

  for (const rejected of input.rejectedOutcomes || []) {
    const summary = normalize(rejected);
    if (summary.length >= 15 && text.includes(summary)) return 'rejected_outcome_reused';
  }
  return null;
}

// --- Pipeline di validazione ----------------------------------------------

export interface WorldPulseValidationOptions {
  originDate: string;
  targetDate: string;
  /** Contesto costruito dai candidati; assente = nessuna reaction ammessa. */
  context?: ReactionContext | null;
  /** Eventi già prodotti dal turno: non duplicare titolo+data. */
  existingEvents?: SimulationEvent[];
  /** Anti-contraddizione con il turno principale. */
  contradictions?: WorldPulseContradictionInput;
}

export interface WorldPulseValidation {
  accepted: SimulationEvent[];
  rejected: Array<{ event: SimulationEvent; reason: string; issues?: ReactionDecisionIssue[] }>;
}

function inWindow(date: string, originDate: string, targetDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date > originDate && date <= targetDate;
}

/**
 * Pipeline completa: finestra temporale → `EffectValidator` → narrativa-only →
 * anti-contraddizione → `validateReactionDecisions` (contesto candidati) →
 * deduplica. Qualsiasi evento fuori regola viene **respinto**, mai corretto.
 */
export function validateWorldPulse(
  result: SimulationResult,
  options: WorldPulseValidationOptions,
): WorldPulseValidation {
  const rejected: WorldPulseValidation['rejected'] = [];
  const accepted: SimulationEvent[] = [];
  const seen = new Set((options.existingEvents || []).map(e => `${e.date}::${String(e.headline).trim().toLowerCase()}`));

  if (Array.isArray(result.effects) && result.effects.length > 0) {
    return { accepted: [], rejected: (result.events || []).map(event => ({ event, reason: 'effects_not_allowed' })) };
  }

  for (const event of result.events || []) {
    const headline = String(event?.headline || '').trim();
    const description = String(event?.description || '').trim();
    const date = String(event?.date || '').trim();
    if (!headline || !description) { rejected.push({ event, reason: 'empty_dispatch' }); continue; }
    if (!inWindow(date, options.originDate, options.targetDate)) { rejected.push({ event, reason: 'date_out_of_window' }); continue; }

    try {
      validateStrictMapChanges(event.mapChanges);
    } catch (error) {
      if (error instanceof EffectValidationError) { rejected.push({ event, reason: `unauthorized_map_change:${error.code}` }); continue; }
      throw error;
    }

    const material = validateNarrativeOnlyWorldPulseEvent(event);
    if (material) { rejected.push({ event, reason: material }); continue; }

    const contradiction = options.contradictions
      ? detectWorldPulseContradiction(event, options.contradictions)
      : null;
    if (contradiction) { rejected.push({ event, reason: contradiction }); continue; }

    const reactions = event.reactions || [];
    if (!options.context) {
      if (reactions.length > 0) { rejected.push({ event, reason: 'reactions_without_context' }); continue; }
    } else {
      const issues = validateReactionDecisions(reactions, options.context);
      if (issues.length > 0) { rejected.push({ event, reason: 'reaction_contract', issues }); continue; }
    }

    const key = `${date}::${headline.toLowerCase()}`;
    if (seen.has(key)) { rejected.push({ event, reason: 'duplicate' }); continue; }
    seen.add(key);
    accepted.push({ ...event, headline, description, date, mapChanges: [] });
  }

  accepted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { accepted: accepted.slice(0, WORLD_PULSE_MAX_EVENTS), rejected };
}

/** Variabili minime da un `PromptVariables` per la cronaca del pulse. */
export function worldPulseChronicleFromVars(vars: PromptVariables): string {
  return vars.ALL_EVENTS_WITH_CONSOLIDATION;
}

/**
 * Merge cronologico **stabile** della timeline: ordina per data crescente e, a
 * parità di data, conserva l'ordine d'inserimento (quindi l'evento principale
 * precede il pulse, che è inserito dopo). Non muta l'array di input.
 */
export function mergeTimelineChronologically<T extends { date: string }>(events: readonly T[]): T[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : a.index - b.index))
    .map(entry => entry.event);
}
