from pathlib import Path
import re

path = Path('backend-nest/src/game-session.ts')
text = path.read_text(encoding='utf-8')

if "from './core/playback/PlaybackCoordinator';" in text:
    print('Playback coordinator già collegato: codemod no-op')
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: atteso 1 match, trovati {count}')
    text = text.replace(old, new, 1)


replace_once(
    "import type { SSEEventType } from './sse';\n",
    "import type { SSEEventType } from './sse';\nimport {\n  buildPausedBatchResult,\n  createPausedRunState,\n  pausedRunInfo,\n  playbackAnchorIsStale,\n  resolvePlaybackCloseReason,\n  revivePausedRunState,\n  takeNextValidPlaybackEvent,\n} from './core/playback/PlaybackCoordinator';\n",
    'import',
)

old_state = '''    const state: PausedRunState = {
      runId: opts.simulationRunId,
      periodStart: opts.periodStart,
      destination: opts.horizonDate,
      jumpTurn: this.currentTurn,
      revisionBase: this.currentTurn + 1,
      remainingEvents: [...opts.proposedEvents],
      batchActionIds: opts.actions.map(action => action.id),
      headlineToActionIds,
      incomplete: opts.promptResult.incomplete === true,
      changedRegions: [],
      completion: {
        narration: opts.promptResult.narration,
        convertedActions: opts.promptResult.convertedActions || [],
        actionOutcomes: opts.promptResult.actionOutcomes || [],
        voided: opts.promptResult.voided || [],
        worldChanges: opts.promptResult.worldChanges,
        relationshipChanges: opts.promptResult.relationshipChanges || [],
        startChat: opts.promptResult.startChat || [],
        effects: Array.isArray(opts.promptResult.effects) ? opts.promptResult.effects : [],
      },
      appliedCount: 0,
    };'''
new_state = '''    const state: PausedRunState = createPausedRunState({
      runId: opts.simulationRunId,
      periodStart: opts.periodStart,
      destination: opts.horizonDate,
      currentTurn: this.currentTurn,
      proposedEvents: opts.proposedEvents,
      batchActionIds: opts.actions.map(action => action.id),
      headlineToActionIds,
      promptResult: opts.promptResult,
    });'''
replace_once(old_state, new_state, 'create paused state')

replace_once(
    '''      if (remainingEvents === 0) {
        if (state.incomplete) closeReason = 'paused_budget';
        else if (eventDate >= state.destination) closeReason = 'completed';
      }''',
    '''      closeReason = resolvePlaybackCloseReason(state, eventDate, remainingEvents);''',
    'close reason',
)

old_result = '''    return {
      paused: true,
      type: 'awaiting_next',
      simulationId: runId,
      event: {
        id: `${stepId}-0`,
        date: eventDate,
        headline: event.headline,
        detail: event.description,
        source: 'world',
        sourceActionIds,
      },
      remaining,
      destination: state.destination,
      checkpointId,
      revision,
      newDate: eventDate,
      newTurn: this.currentTurn,
      changedRegions,
    };'''
new_result = '''    return buildPausedBatchResult({
      state,
      event,
      eventId: `${stepId}-0`,
      sourceActionIds,
      remaining,
      checkpointId,
      revision,
      newTurn: this.currentTurn,
      changedRegions,
    });'''
replace_once(old_result, new_result, 'paused DTO')

replace_once(
    '''      // Una proposta stantia (per esempio dopo un restore) non retrodata il mondo.
      let event = state.remainingEvents.shift();
      while (event && !dateInPeriod(event.date, this.currentDate, state.destination)) {
        console.warn('[GameSession] §9.3: proposta fuori periodo scartata:', event.date);
        event = state.remainingEvents.shift();
      }''',
    '''      // La macchina a stati scarta proposte stantie senza retrodatare il mondo.
      const beforeRemaining = state.remainingEvents.length;
      const event = takeNextValidPlaybackEvent(state, this.currentDate);
      const discarded = beforeRemaining - state.remainingEvents.length - (event ? 1 : 0);
      if (discarded > 0) {
        console.warn(`[GameSession] §9.3: ${discarded} proposte fuori periodo scartate`);
      }''',
    'next event',
)

replace_once(
    '''    if ((eventId && eventId !== state.currentEventId)
      || (revision != null && revision !== state.revision)) {
      throw new SimulationStaleCheckpointError(state.runId, eventId, revision);
    }''',
    '''    if (playbackAnchorIsStale(state, eventId, revision)) {
      throw new SimulationStaleCheckpointError(state.runId, eventId, revision);
    }''',
    'anchor',
)

old_info = '''    if (!this.pausedRun) return null;
    return {
      simulationId: this.pausedRun.runId,
      remaining: this.pausedRun.remainingEvents.length,
      destination: this.pausedRun.destination,
      date: this.currentDate,
      turn: this.currentTurn,
      incomplete: this.pausedRun.incomplete,
      eventId: this.pausedRun.currentEventId,
      checkpointId: this.pausedRun.checkpointId,
      revision: this.pausedRun.revision,
    };'''
replace_once(
    old_info,
    '''    return pausedRunInfo(this.pausedRun, this.currentDate, this.currentTurn);''',
    'paused info',
)

pattern = re.compile(
    r"  private _revivePausedRunState\(raw: any\): PausedRunState \| null \{.*?\n  \}\n\n  /\*\*\n   \* Консолидация истории",
    re.S,
)
replacement = '''  private _revivePausedRunState(raw: any): PausedRunState | null {
    return revivePausedRunState(raw, this.currentTurn);
  }

  /**
   * Консолидация истории'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'revive state: atteso 1 match, trovati {count}')

path.write_text(text, encoding='utf-8')
print('Playback coordinator collegato a GameSession')
