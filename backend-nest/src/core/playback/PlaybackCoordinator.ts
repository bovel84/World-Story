import { dateInPeriod } from '../simulation/calendar';
import type { StrictEffect } from '../simulation/EffectValidator';
import type { SimulationEvent } from '../../prompts/types';

export interface PlaybackChangedRegion {
  id: string;
  owner: string;
  color: string;
  name: string;
  population: number;
  gdp: number;
  militaryPower: number;
  objects: any[];
}

/** Stato durevole del playback «un evento alla volta» (§9.3). */
export interface PausedRunState {
  runId: string;
  periodStart: string;
  destination: string;
  jumpTurn: number;
  /** Compatibilità con pending_state antecedenti a F02. */
  revisionBase: number;
  remainingEvents: SimulationEvent[];
  batchActionIds: string[];
  headlineToActionIds: Record<string, string[]>;
  incomplete: boolean;
  changedRegions: PlaybackChangedRegion[];
  completion: {
    narration: string;
    convertedActions: any[];
    actionOutcomes: any[];
    voided: any[];
    worldChanges: any;
    relationshipChanges: any[];
    startChat: any[];
    effects: StrictEffect[];
  };
  appliedCount: number;
  currentEventId?: string;
  checkpointId?: string;
  revision?: number;
}

export interface PausedBatchResult {
  paused: true;
  type: 'awaiting_next';
  simulationId: string;
  event: {
    id: string;
    date: string;
    headline: string;
    detail: string;
    source: string;
    sourceActionIds?: string[];
  };
  remaining: number;
  destination: string;
  checkpointId: string;
  revision: number;
  newDate: string;
  newTurn: number;
  changedRegions: Array<Record<string, any>>;
}

export interface CompletedBatchResult<TAction = unknown> {
  paused?: false;
  type: 'run_completed' | 'paused_budget' | 'intervened';
  simulationId: string;
  actions: TAction[];
  result: {
    turn: number;
    narration: string;
    events: string[];
    eventDetails: any[];
    periodStart: string;
    periodEnd: string;
  };
  newDate: string;
  newTurn: number;
  destination?: string;
}

export interface PausedRunInfo {
  simulationId: string;
  remaining: number;
  destination: string;
  date: string;
  turn: number;
  incomplete: boolean;
  eventId?: string;
  checkpointId?: string;
  revision?: number;
}

export class SimulationStaleCheckpointError extends Error {
  constructor(public runId: string, public eventId?: string, public revision?: number) {
    super('Il checkpoint indicato non è più quello attivo: rileggi il lettore di sessione');
    this.name = 'SimulationStaleCheckpointError';
  }
}

export function createPausedRunState(input: {
  runId: string;
  periodStart: string;
  destination: string;
  currentTurn: number;
  proposedEvents: SimulationEvent[];
  batchActionIds: string[];
  headlineToActionIds: Record<string, string[]>;
  promptResult: any;
}): PausedRunState {
  return {
    runId: input.runId,
    periodStart: input.periodStart,
    destination: input.destination,
    jumpTurn: input.currentTurn,
    revisionBase: input.currentTurn + 1,
    remainingEvents: [...input.proposedEvents],
    batchActionIds: [...input.batchActionIds],
    headlineToActionIds: { ...input.headlineToActionIds },
    incomplete: input.promptResult?.incomplete === true,
    changedRegions: [],
    completion: {
      narration: typeof input.promptResult?.narration === 'string' ? input.promptResult.narration : '',
      convertedActions: Array.isArray(input.promptResult?.convertedActions) ? input.promptResult.convertedActions : [],
      actionOutcomes: Array.isArray(input.promptResult?.actionOutcomes) ? input.promptResult.actionOutcomes : [],
      voided: Array.isArray(input.promptResult?.voided) ? input.promptResult.voided : [],
      worldChanges: input.promptResult?.worldChanges,
      relationshipChanges: Array.isArray(input.promptResult?.relationshipChanges) ? input.promptResult.relationshipChanges : [],
      startChat: Array.isArray(input.promptResult?.startChat) ? input.promptResult.startChat : [],
      effects: Array.isArray(input.promptResult?.effects) ? input.promptResult.effects : [],
    },
    appliedCount: 0,
  };
}

/** Determina la sola transizione di stato; nessun I/O o mutazione esterna. */
export function resolvePlaybackCloseReason(
  state: Pick<PausedRunState, 'incomplete' | 'destination'>,
  eventDate: string,
  remainingEvents: number,
): 'paused_budget' | 'completed' | null {
  if (remainingEvents !== 0) return null;
  if (state.incomplete) return 'paused_budget';
  return eventDate >= state.destination ? 'completed' : null;
}

/**
 * Consuma le proposte fino alla prima ancora temporalmente valida. Le proposte
 * stantie restano non canoniche e vengono eliminate senza toccare il mondo.
 */
export function takeNextValidPlaybackEvent(
  state: Pick<PausedRunState, 'remainingEvents' | 'destination'>,
  currentDate: string,
): SimulationEvent | undefined {
  let event = state.remainingEvents.shift();
  while (event && !dateInPeriod(event.date, currentDate, state.destination)) {
    event = state.remainingEvents.shift();
  }
  return event;
}

export function assertPlaybackAnchor(
  state: Pick<PausedRunState, 'runId' | 'currentEventId' | 'revision'>,
  eventId?: string,
  revision?: number,
): void {
  if ((eventId && eventId !== state.currentEventId)
    || (revision != null && revision !== state.revision)) {
    throw new SimulationStaleCheckpointError(state.runId, eventId, revision);
  }
}

export function buildPausedBatchResult(input: {
  state: PausedRunState;
  event: SimulationEvent;
  eventId: string;
  sourceActionIds: string[];
  remaining: number;
  checkpointId: string;
  revision: number;
  newTurn: number;
  changedRegions: PlaybackChangedRegion[];
}): PausedBatchResult {
  return {
    paused: true,
    type: 'awaiting_next',
    simulationId: input.state.runId,
    event: {
      id: input.eventId,
      date: input.event.date,
      headline: input.event.headline,
      detail: input.event.description,
      source: 'world',
      sourceActionIds: input.sourceActionIds,
    },
    remaining: input.remaining,
    destination: input.state.destination,
    checkpointId: input.checkpointId,
    revision: input.revision,
    newDate: input.event.date,
    newTurn: input.newTurn,
    changedRegions: input.changedRegions,
  };
}

export function pausedRunInfo(
  state: PausedRunState | null,
  currentDate: string,
  currentTurn: number,
): PausedRunInfo | null {
  if (!state) return null;
  return {
    simulationId: state.runId,
    remaining: state.remainingEvents.length,
    destination: state.destination,
    date: currentDate,
    turn: currentTurn,
    incomplete: state.incomplete,
    eventId: state.currentEventId,
    checkpointId: state.checkpointId,
    revision: state.revision,
  };
}

/** Parsing fail-closed del pending_state persistito. */
export function revivePausedRunState(raw: any, currentTurn: number): PausedRunState | null {
  try {
    if (!raw || typeof raw.runId !== 'string' || !Array.isArray(raw.remainingEvents)) return null;
    if (typeof raw.periodStart !== 'string' || typeof raw.destination !== 'string') return null;
    const remainingEvents = raw.remainingEvents.filter((event: any) =>
      event && typeof event.headline === 'string' && typeof event.date === 'string'
      && Array.isArray(event.mapChanges)
    );
    return {
      runId: raw.runId,
      periodStart: raw.periodStart,
      destination: raw.destination,
      jumpTurn: Number.isInteger(raw.jumpTurn) ? raw.jumpTurn : currentTurn,
      revisionBase: Number.isInteger(raw.revisionBase) ? raw.revisionBase : currentTurn + 1,
      remainingEvents,
      batchActionIds: Array.isArray(raw.batchActionIds) ? raw.batchActionIds : [],
      headlineToActionIds: raw.headlineToActionIds && typeof raw.headlineToActionIds === 'object'
        ? raw.headlineToActionIds : {},
      incomplete: raw.incomplete === true,
      changedRegions: Array.isArray(raw.changedRegions) ? raw.changedRegions : [],
      completion: {
        narration: typeof raw.completion?.narration === 'string' ? raw.completion.narration : '',
        convertedActions: Array.isArray(raw.completion?.convertedActions) ? raw.completion.convertedActions : [],
        actionOutcomes: Array.isArray(raw.completion?.actionOutcomes) ? raw.completion.actionOutcomes : [],
        voided: Array.isArray(raw.completion?.voided) ? raw.completion.voided : [],
        worldChanges: raw.completion?.worldChanges,
        relationshipChanges: Array.isArray(raw.completion?.relationshipChanges) ? raw.completion.relationshipChanges : [],
        startChat: Array.isArray(raw.completion?.startChat) ? raw.completion.startChat : [],
        effects: Array.isArray(raw.completion?.effects) ? raw.completion.effects : [],
      },
      appliedCount: Number.isInteger(raw.appliedCount) ? raw.appliedCount : 0,
      currentEventId: typeof raw.currentEventId === 'string' ? raw.currentEventId : undefined,
      checkpointId: typeof raw.checkpointId === 'string' ? raw.checkpointId : undefined,
      revision: Number.isInteger(raw.revision) ? raw.revision : undefined,
    };
  } catch {
    return null;
  }
}
