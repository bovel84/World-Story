/**
 * World Story — «World pulse» (WS-NARR-DISPATCH-PAX-QUALITY)
 * =========================================================
 * Passaggio **separato e opzionale** (`narrative.worldPulse`, spento di
 * default): propone **fino a 3 eventi** di nazioni lontane che hanno una
 * **causa canonica** già presente nel motore (relazioni, impegni, fatti
 * recenti, dossier NPC). Zero eventi è sempre valido: il mondo può restare
 * fermo.
 *
 * Sicurezza: gli eventi passano dalla stessa disciplina del turno —
 * data nella finestra, `EffectValidator` per `mapChanges`/`effects`,
 * `validateReactionDecisions` contro un contesto **costruito dai candidati**,
 * mai contro il reaction context del giocatore. Nessuna mutazione materiale
 * passa da qui: un evento con `mapChanges` non vuoto viene respinto.
 *
 * Il modulo è puro: selezione candidati, prompt e validazione si provano senza
 * provider.
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

/** Istruzione di sistema breve: il pulse è cronaca del mondo, non del giocatore. */
export const WORLD_PULSE_SYSTEM =
  'Sei il cronista delle nazioni lontane: proponi solo fatti con causa verificabile, ' +
  'rispetti obiettivi e relazioni fornite e rispondi in NDJSON valido.';

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

/** Tutto ciò che serve alla selezione deterministica, già estratto dal gioco. */
export interface WorldPulseSelectionInput {
  playerPolityId: string;
  polities: WorldPulsePolity[];
  relationships: WorldPulseRelation[];
  /** Testo del registro impegni in vigore (una voce per riga). */
  commitments: string;
  /** Fatti recenti della partita, dal più recente. */
  recentEvents: WorldPulseRecentEvent[];
  /** Dossier NPC (identità/agenda), testo già composto dal motore. */
  npcDossiers: string;
  /** Confine inferiore della finestra: un trigger più vecchio non conta. */
  originDate: string;
}

/**
 * Una nazione è candidata **solo** se ha almeno una causa canonica. La
 * lontananza dal giocatore non è una causa e non viene usata.
 */
export interface WorldPulseCandidate {
  polityId: string;
  polityName: string;
  causes: string[];
  relevantRelations: string[];
  activeCommitments: string[];
  recentTriggers: string[];
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

/** Distanza in giorni fra due date ISO; `NaN` se una non è valida. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Un trigger recente deve cadere fra `originDate - LOOKBACK` e oggi. */
const RECENT_TRIGGER_LOOKBACK_DAYS = 180;

/**
 * Selezione deterministica dei candidati: nessun LLM, nessun criterio
 * geografico. Ordina per numero di cause, poi per nome, e non inventa nulla.
 */
export function selectWorldPulseCandidates(input: WorldPulseSelectionInput): WorldPulseCandidate[] {
  const relationText = (relation: string) => relation.trim().toLowerCase();
  const playerId = input.playerPolityId;
  const candidates: WorldPulseCandidate[] = [];

  for (const polity of input.polities) {
    if (!polity?.id || polity.id === playerId || polity.id === 'neutral') continue;
    const causes: string[] = [];
    const relevantRelations: string[] = [];

    for (const rel of input.relationships) {
      if (rel.from !== polity.id && rel.to !== polity.id) continue;
      const otherId = rel.from === polity.id ? rel.to : rel.from;
      const otherName = input.polities.find(p => p.id === otherId)?.name || otherId;
      const relation = relationText(rel.relation);
      if (!relation || relation === 'neutral') continue;
      relevantRelations.push(`${polity.name} ↔ ${otherName}: ${relation}`);
      causes.push(relation === 'hostile'
        ? `conflitto/ostilità con ${otherName}`
        : `alleanza con ${otherName}`);
    }

    const activeCommitments = linesMentioning(input.commitments, polity.name);
    for (const commitment of activeCommitments) causes.push(`impegno in vigore: ${commitment}`);

    const recentTriggers: string[] = [];
    for (const event of input.recentEvents) {
      if (!mentions(`${event.headline} ${event.detail || ''}`, polity.name)) continue;
      const age = daysBetween(event.date, input.originDate);
      // Solo fatti non più vecchi della finestra; una data illeggibile non è una causa.
      if (!Number.isFinite(age) || age > RECENT_TRIGGER_LOOKBACK_DAYS || age < 0) continue;
      recentTriggers.push(`${event.date}: ${event.headline}`);
      causes.push(`fatto recente: ${event.headline}`);
    }

    if (mentions(input.npcDossiers, polity.name)) {
      causes.push('agenda NPC attiva nel dossier');
    }

    if (causes.length === 0) continue;
    candidates.push({
      polityId: polity.id,
      polityName: polity.name,
      causes: [...new Set(causes)],
      relevantRelations,
      activeCommitments,
      recentTriggers,
    });
  }

  candidates.sort((a, b) => b.causes.length - a.causes.length || a.polityName.localeCompare(b.polityName));
  return candidates;
}

/** Tetto di candidati per non gonfiare il prompt. */
export const WORLD_PULSE_MAX_CANDIDATES = 6;

/**
 * Contesto di reazione **del pulse**, costruito solo dai candidati scelti.
 * Non è il reaction context del giocatore e non autorizza attori esterni.
 */
export function buildWorldPulseContext(candidates: WorldPulseCandidate[]): ReactionContext {
  const actors: RelevantActor[] = candidates.map(candidate => ({
    id: candidate.polityId,
    name: candidate.polityName,
    role: 'neighbour',
    because: candidate.causes.slice(0, 2).join('; ') || 'causa canonica nel pulse',
    interests: candidate.causes.slice(0, 3),
    options: [{ id: `${candidate.polityId}:pulse`, label: 'Iniziativa autonoma motivata' }],
  }));
  return {
    trigger: { kind: 'world_process', summary: 'Respiro del mondo: fatti di nazioni con causa canonica' },
    actors,
    constraints: [],
    allowedOptionIds: actors.flatMap(actor => actor.options.map(option => option.id)),
    maxReactions: Math.max(1, actors.length),
  };
}

export interface WorldPulseInput {
  originDate: string;
  targetDate: string;
  playerPolity: string;
  candidates: WorldPulseCandidate[];
  recentChronicle: string;
}

/**
 * Prompt del pulse. Insiste su causa canonica e su nazioni **non giocate**;
 * chiede esplicitamente «fino a 3», e zero è valido.
 */
export function buildWorldPulsePrompt(input: WorldPulseInput): string {
  const candidates = input.candidates.slice(0, WORLD_PULSE_MAX_CANDIDATES);
  const blocks = candidates.map(candidate => {
    const lines = [
      `- ${candidate.polityName} [${candidate.polityId}]`,
      candidate.causes.length ? `  CAUSE CANONICHE: ${candidate.causes.join(' | ')}` : '',
      candidate.relevantRelations.length ? `  [RELAZIONI CORRENTI] ${candidate.relevantRelations.join(' | ')}` : '',
      candidate.activeCommitments.length ? `  [IMPEGNI ATTIVI] ${candidate.activeCommitments.join(' | ')}` : '',
      candidate.recentTriggers.length ? `  TRIGGER RECENTI: ${candidate.recentTriggers.join(' | ')}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n');

  return `RESPIRO DEL MONDO — EVENTI DI NAZIONI NON GIOCATE
Periodo: ${input.originDate} → ${input.targetDate}.
Il giocatore controlla ${input.playerPolity}: questo passaggio NON racconta i suoi ordini.

CANDIDATI (solo nazioni con causa canonica; NON aggiungerne altre):
${blocks || '(nessun candidato con causa canonica)'}

CRONACA RECENTE:
${input.recentChronicle || '(nessuna cronaca disponibile)'}

REGOLE DEL RESPIRO DEL MONDO:
1. Genera FINO A ${WORLD_PULSE_MAX_EVENTS} eventi di nazioni non giocate, usando SOLO i candidati qui sopra e le loro cause canoniche.
2. Se le cause canoniche non bastano, genera MENO eventi o NESSUN evento. Zero eventi è una risposta valida: non inventare nulla per riempire il budget.
3. Ogni evento deve avere una causa verificabile presa dalle cause/relazioni/impegni/trigger del candidato. Se non la trovi, NON generare l'evento.
4. Non inventare nazioni, leader, cifre, accordi o episodi non presenti nel contesto. Non usare la storia reale oltre il punto di divergenza.
5. ${input.playerPolity} compare solo se un fatto la tocca direttamente.
6. Ogni evento è una notizia: soggetto + decisione concreta, ${EVENT_DESCRIPTION_GUIDE}. Niente mapChanges e niente effetti materiali: sono vietati in questo passaggio.
7. Se un candidato reagisce a un altro, usa actorId/optionId fra quelli ammessi; altrimenti lascia "reactions": [].

OUTPUT NDJSON, una riga JSON per oggetto, niente markdown. Riga evento:
{"type":"event","headline":"attore + decisione concreta","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[]}

ULTIMA riga obbligatoria (anche senza eventi):
{"type":"complete","narration":"sintesi dei soli eventi emessi","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":${JSON.stringify(input.targetDate)}}`;
}

/** Parsing: riusa il parser incrementale esistente, nessun formato nuovo. */
export function parseWorldPulseResponse(text: string): SimulationResult {
  return parseIncrementalSimulationResponse(text);
}

export interface WorldPulseValidationOptions {
  originDate: string;
  targetDate: string;
  /** Contesto costruito dai candidati; assente = nessuna reaction ammessa. */
  context?: ReactionContext | null;
  /** Eventi già prodotti dal turno: non duplicare titolo+data. */
  existingEvents?: SimulationEvent[];
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
 * Pipeline completa del pulse: finestra temporale → `EffectValidator` per le
 * mutazioni materiali → `validateReactionDecisions` contro il contesto dei
 * candidati → deduplica. Qualsiasi evento fuori regola viene **respinto**, non
 * corretto: non esiste una via permissiva parallela.
 */
export function validateWorldPulse(
  result: SimulationResult,
  options: WorldPulseValidationOptions,
): WorldPulseValidation {
  const rejected: WorldPulseValidation['rejected'] = [];
  const accepted: SimulationEvent[] = [];
  const seen = new Set((options.existingEvents || []).map(e => `${e.date}::${String(e.headline).trim().toLowerCase()}`));

  // Effetti materiali a livello di risultato: mai ammessi nel pulse.
  if (Array.isArray(result.effects) && result.effects.length > 0) {
    return { accepted: [], rejected: (result.events || []).map(event => ({ event, reason: 'effects_not_allowed' })) };
  }

  for (const event of result.events || []) {
    const headline = String(event?.headline || '').trim();
    const description = String(event?.description || '').trim();
    const date = String(event?.date || '').trim();
    if (!headline || !description) { rejected.push({ event, reason: 'empty_dispatch' }); continue; }
    if (!inWindow(date, options.originDate, options.targetDate)) { rejected.push({ event, reason: 'date_out_of_window' }); continue; }

    // EffValidator: mapChanges LLM diretti vietati; qui nessuna mutazione passa.
    try {
      validateStrictMapChanges(event.mapChanges);
    } catch (error) {
      if (error instanceof EffectValidationError) { rejected.push({ event, reason: `unauthorized_map_change:${error.code}` }); continue; }
      throw error;
    }

    // Reaction: solo attori/opzioni del contesto dei candidati.
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
