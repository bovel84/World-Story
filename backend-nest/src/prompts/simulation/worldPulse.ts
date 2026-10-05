/**
 * World Story — «World pulse» (WS-NARR-DISPATCH-PAX-QUALITY)
 * =========================================================
 * Passaggio **separato e opzionale** (`narrative.worldPulse`, spento di
 * default) che propone 3-6 eventi di **nazioni lontane** partendo da
 * `NpcAgenda`, dalle relazioni e dallo stato del motore. Ogni evento deve avere
 * una causa verificabile e passa dalle **stesse validazioni esistenti** delle
 * reazioni (`validateReactionDecisions`).
 *
 * Perché è separato: il «respiro del mondo» non è una conseguenza diretta degli
 * ordini del giocatore, quindi non deve alterare la **regola causale degli
 * eventi del giocatore**. Questo modulo produce solo un prompt e una
 * validazione; non tocca `EffectValidator`, `ReactionDecisions` né il contratto
 * delle reazioni.
 */
import type { PromptVariables } from '../types';
import type { SimulationResult, SimulationEvent } from '../types';
import type { ReactionContext } from '../../core/simulation/ReactionContext';
import { validateReactionDecisions, type ReactionDecisionIssue } from '../../core/simulation/ReactionDecisions';
import { EVENT_DESCRIPTION_GUIDE } from '../immersion';
import { parseIncrementalSimulationResponse } from './parse';

/** Un pulse troppo corto non dà respiro al mondo; troppo lungo diventa rumore. */
export const WORLD_PULSE_MIN_EVENTS = 3;
export const WORLD_PULSE_MAX_EVENTS = 6;

/** Istruzione di sistema breve: il pulse è cronaca del mondo, non del giocatore. */
export const WORLD_PULSE_SYSTEM =
  'Sei il cronista delle nazioni lontane: proponi solo fatti con causa verificabile, ' +
  'rispetti obiettivi e relazioni fornite e rispondi in NDJSON valido.';

export interface WorldPulseInput {
  originDate: string;
  targetDate: string;
  /** Nazione del giocatore: il pulse NON la mette in scena se non è toccata. */
  playerPolity: string;
  /** `describeAgenda()` per le nazioni NPC: obiettivi attivi e progresso. */
  npcAgenda: string;
  /** Relazioni correnti fra politie (solo quelle note al motore). */
  relationships: string;
  /** Stato strategico/mappa: da qui devono venire i riferimenti materiali. */
  strategicState: string;
  /** Cronaca recente, per agganciare il pulse a fatti già aperti. */
  recentChronicle: string;
  /** Contesto di reazione, se il motore lo ha già filtrato. */
  reactionContext?: string;
}

/**
 * Prompt del pulse. Insiste su **causa verificabile** e su **nazioni lontane**,
 * e vieta di mettere in scena il giocatore o di inventare fatti: il pulse
 * racconta ciò che già preme nel mondo, non apre filoni nuovi.
 */
export function buildWorldPulsePrompt(input: WorldPulseInput): string {
  return `RESPIRO DEL MONDO — EVENTI DI NAZIONI LONTANE
Periodo: ${input.originDate} → ${input.targetDate}.
Il giocatore controlla ${input.playerPolity}: questo passaggio NON racconta i suoi ordini.

OBIETTIVI ATTIVI DELLE NAZIONI NPC (fonte vincolante):
${input.npcAgenda || '(nessun obiettivo attivo registrato)'}

RELAZIONI FRA POLITIE:
${input.relationships || '(nessuna relazione registrata)'}

STATO STRATEGICO E MAPPA:
${input.strategicState || '(nessuno stato disponibile)'}

CRONACA RECENTE:
${input.recentChronicle || '(nessuna cronaca disponibile)'}
${input.reactionContext ? `\nCONTESTO DI REAZIONE (attori e opzioni ammesse):\n${input.reactionContext}\n` : ''}
REGOLE DEL RESPIRO DEL MONDO:
1. Proponi da ${WORLD_PULSE_MIN_EVENTS} a ${WORLD_PULSE_MAX_EVENTS} eventi di NAZIONI LONTANE dal giocatore: fatti che maturano nel mondo senza dipendere dai suoi ordini.
2. Ogni evento deve avere una causa verificabile presa da obiettivi attivi, relazioni, stato strategico o cronaca. Se non trovi una causa, NON generare l'evento: meglio un pulse corto e vero.
3. Non inventare nazioni, leader, cifre o episodi non presenti nel contesto. Non aprire filoni nuovi solo per coprire più paesi.
4. ${input.playerPolity} compare solo se un fatto la tocca direttamente; non aggiungere righe di pura presenza.
5. Ogni evento resta una notizia di cronaca: soggetto + decisione concreta, ${EVENT_DESCRIPTION_GUIDE}.
6. Se una nazione reagisce a un'altra, indica la reazione con actorId/optionId presi dal contesto (se fornito) e una misura autonoma solo se realmente decisa.

OUTPUT NDJSON, una riga JSON per oggetto, niente markdown. Riga evento:
{"type":"event","headline":"attore + decisione concreta","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[]}

ULTIMA riga obbligatoria:
{"type":"complete","narration":"sintesi dei soli eventi emessi","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":${JSON.stringify(input.targetDate)}}`;
}

/** Parsing: riusa il parser incrementale esistente, nessun formato nuovo. */
export function parseWorldPulseResponse(text: string): SimulationResult {
  return parseIncrementalSimulationResponse(text);
}

export interface WorldPulseValidation {
  /** Eventi accettati, nell'ordine emesso. */
  accepted: SimulationEvent[];
  /** Eventi respinti perché le reazioni violano il contratto del motore. */
  rejected: Array<{ event: SimulationEvent; issues: ReactionDecisionIssue[] }>;
}

/**
 * Stesse validazioni delle reazioni del turno: un evento del pulse con
 * `actorId`/`optionId` fuori contratto viene respinto, non eseguito. Senza
 * contesto di reazione non c'è nulla da validare (dati legacy/assenti).
 */
export function validateWorldPulse(
  result: SimulationResult,
  context?: ReactionContext | null,
): WorldPulseValidation {
  const events = result.events || [];
  if (!context) return { accepted: events, rejected: [] };
  const accepted: SimulationEvent[] = [];
  const rejected: WorldPulseValidation['rejected'] = [];
  for (const event of events) {
    const issues = validateReactionDecisions(event.reactions, context);
    if (issues.length > 0) rejected.push({ event, issues });
    else accepted.push(event);
  }
  return { accepted, rejected };
}

/** Comodità: il pulse è ammesso solo con il flag acceso e un budget minimo. */
export function shouldRunWorldPulse(enabled: boolean, npcAgenda?: string | null): boolean {
  return enabled && Boolean(String(npcAgenda || '').trim());
}

/** Variabili minime da un `PromptVariables` per costruire il pulse. */
export function worldPulseInputFromVars(vars: PromptVariables): WorldPulseInput {
  return {
    originDate: vars.ORIGIN_ROUND_DATE,
    targetDate: vars.TARGET_ROUND_DATE,
    playerPolity: vars.PLAYER_POLITY,
    npcAgenda: vars.NPC_STRATEGIC_PROFILES,
    relationships: vars.ACTIVE_COMMITMENTS,
    strategicState: vars.STRATEGIC_STATE,
    recentChronicle: vars.ALL_EVENTS_WITH_CONSOLIDATION,
    reactionContext: vars.REACTION_CONTEXT,
  };
}
