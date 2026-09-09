/**
 * World Story — Simulation Store (F06 µ1)
 * ====================================
 * Reducer PURO di snapshot/delta/outbox: nessuna dipendenza da React o dal
 * network. Le viste (App, SSE, HTTP, polling) applicano gli stessi envelope a
 * quest'unica funzione: lo stato finale è identico per ogni permutazione
 * HTTP/SSE/polling.
 *
 * Regole (piano F06 passo 1):
 *  - scope, worldRevision, queueVersion, jobVersion e sequence ordinano le
 *    applicazioni; a world revision identica una coda/job più vecchi non
 *    sovrascrivono i nuovi;
 *  - il cambio branch avviene soltanto dalla risposta valida del comando
 *    esplicito corrente (applyBranchReplace con anchor del restore);
 *  - le proposte del playback privato non entrano mai in newsQueue/timeline
 *    (§9.2: il playback privato è escluso da tutti i DTO pubblici);
 *  - gli stati terminali e pausati sono espliciti;
 *  - replaceCanonicalSnapshot resetta mappa (inclusi objects), coda, history,
 *    news, chat, advisor e reader; l'archivio è scoped al ramo.
 */

export interface TimelineEntry {
  id: string;
  date: string;
  headline: string;
  detail?: string;
  source: string;
  revision?: number;
  sequence?: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  date?: string;
}

export interface PausedRunInfo {
  simulationId?: string;
  checkpointId?: string;
  remaining: number;
  destination?: string;
  revision?: number;
}

export interface JobStatusView {
  status: string;
  runId?: string | null;
  version: number;
}

export interface MapRegionView {
  owner?: string;
  color?: string;
  /** F06 passo 4: il reset canonico copre anche gli oggetti mappa. */
  objects?: any[];
}

export interface SimulationUiState {
  gameId: string;
  branchId: string;
  worldRevision: number;
  queueVersion: number;
  jobVersion: number;
  lastSequence: number;
  timeline: TimelineEntry[];
  newsQueue: NewsItem[];
  pendingActions: Array<{ id: string; text: string }>;
  jobStatuses: Record<string, JobStatusView>;
  mapRegions: Record<string, MapRegionView>;
  pausedRun: PausedRunInfo | null;
  history: any[];
  chats: any[];
  advisor: any;
  reader: any;
  archiveKey: string;
}

export type SimulationScope = 'timeline' | 'queue' | 'job' | 'map' | 'snapshot' | 'branch';

export interface SimulationEnvelope {
  scope: SimulationScope;
  branchId?: string | null;
  worldRevision?: number;
  queueVersion?: number;
  jobVersion?: number;
  sequence?: number;
  eventId?: string;
  payload: any;
}

export interface CanonicalSnapshot {
  date?: string;
  mapRegions?: Record<string, MapRegionView>;
  pendingActions?: Array<{ id: string; text: string }>;
  history?: any[];
  news?: NewsItem[];
  chats?: any[];
  advisor?: any;
  reader?: any;
}

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'interrupted', 'intervened', 'no_event']);

export function initialSimulationState(gameId: string, branchId: string, worldRevision: number): SimulationUiState {
  return {
    gameId,
    branchId,
    worldRevision,
    queueVersion: 0,
    jobVersion: 0,
    lastSequence: 0,
    timeline: [],
    newsQueue: [],
    pendingActions: [],
    jobStatuses: {},
    mapRegions: {},
    pausedRun: null,
    history: [],
    chats: [],
    advisor: null,
    reader: null,
    archiveKey: `${gameId}:${branchId}`,
  };
}

/** Il ramo dell'envelope, se dichiarato, deve essere quello corrente. */
function branchMatches(state: SimulationUiState, envelope: SimulationEnvelope): boolean {
  return envelope.branchId == null || envelope.branchId === state.branchId;
}

/** Whitelist pubblica: le proposte del playback privato restano fuori. */
function toPublicEntry(payload: any, revision: number, sequence: number): TimelineEntry | null {
  const event = payload?.event;
  if (!event?.id || !event?.headline) return null;
  return {
    id: String(event.id),
    date: String(event.date ?? ''),
    headline: String(event.headline),
    detail: event.detail == null ? undefined : String(event.detail),
    source: String(event.source ?? 'world'),
    revision,
    sequence,
  };
}

function applyMapChanges(state: SimulationUiState, payload: any): Record<string, MapRegionView> {
  const changes = payload?.changedRegions;
  if (!Array.isArray(changes) || changes.length === 0) return state.mapRegions;
  const next = { ...state.mapRegions };
  for (const change of changes) {
    if (!change?.regionId) continue;
    next[change.regionId] = {
      owner: change.owner ?? next[change.regionId]?.owner,
      color: change.color ?? next[change.regionId]?.color,
    };
  }
  return next;
}

/**
 * Applica un envelope canonico. Se l'envelope è scartato (vecchio, duplicato,
 * di un altro ramo) restituisce LO STESSO riferimento: nessuna mutazione.
 */
export function applyEnvelope(state: SimulationUiState, envelope: SimulationEnvelope): SimulationUiState {
  if (!branchMatches(state, envelope)) return state;

  switch (envelope.scope) {
    case 'timeline': {
      const revision = envelope.worldRevision ?? state.worldRevision;
      const sequence = envelope.sequence ?? state.lastSequence;
      // A revisione identica vince il sequence più alto; un sequence vecchio
      // non sovrascrive. Una revisione precedente all'accettata è vecchia.
      // Sequenza UGUALE con eventId diverso è accettata (più eventi dello
      // stesso checkpoint / stesso periodo commettono insieme).
      if (revision < state.worldRevision) return state;
      if (sequence < state.lastSequence && revision <= state.worldRevision) return state;
      if (envelope.eventId && state.timeline.some(entry => entry.id === envelope.eventId)) return state;

      const entry = toPublicEntry(envelope.payload, revision, sequence);
      if (!entry) return state;

      let pausedRun = state.pausedRun;
      const awaiting = envelope.payload?.awaitingNext;
      if (awaiting) {
        pausedRun = {
          checkpointId: envelope.payload?.checkpointId ?? pausedRun?.checkpointId,
          remaining: Number(awaiting.remaining ?? 0),
          destination: awaiting.destination,
          revision,
          simulationId: pausedRun?.simulationId,
        };
      } else if (!awaiting && pausedRun && envelope.payload?.runCompleted === true) {
        pausedRun = null;
      }
      return {
        ...state,
        timeline: [...state.timeline, entry],
        newsQueue: [...state.newsQueue, { id: entry.id, headline: entry.headline, date: entry.date }],
        mapRegions: applyMapChanges(state, envelope.payload),
        worldRevision: revision,
        lastSequence: Math.max(state.lastSequence, sequence),
        pausedRun,
      };
    }

    case 'queue': {
      const version = envelope.queueVersion ?? state.queueVersion;
      // A world revision identica una coda più vecchia non sovrascrive i nuovi.
      if (version <= state.queueVersion) return state;
      const actions = Array.isArray(envelope.payload?.actions) ? envelope.payload.actions : [];
      return { ...state, queueVersion: version, pendingActions: actions.map((a: any) => ({ id: String(a.id), text: String(a.text ?? '') })) };
    }

    case 'job': {
      const version = envelope.jobVersion ?? state.jobVersion;
      if (version <= state.jobVersion) return state;
      const jobId = envelope.payload?.jobId;
      if (!jobId) return state;
      const status = String(envelope.payload?.status ?? 'queued');
      const jobStatuses = {
        ...state.jobStatuses,
        [jobId]: { status, runId: envelope.payload?.runId ?? null, version },
      };
      let pausedRun = state.pausedRun;
      if (status === 'running' && pausedRun && envelope.payload?.runId) {
        pausedRun = { ...pausedRun, simulationId: String(envelope.payload.runId) };
      } else if (TERMINAL_JOB_STATUSES.has(status)) {
        pausedRun = null;
      }
      return { ...state, jobVersion: version, jobStatuses, pausedRun };
    }

    case 'map': {
      const revision = envelope.worldRevision ?? state.worldRevision;
      if (revision < state.worldRevision) return state;
      return { ...state, mapRegions: applyMapChanges(state, envelope.payload), worldRevision: revision };
    }

    case 'branch':
    case 'snapshot':
    default:
      // Il cambio branch e lo snapshot canonico passano SOLO dalle funzioni
      // dedicate (risposte valide di comandi espliciti), mai da eventi in flusso.
      return state;
  }
}

/**
 * F06 passo 4: sostituzione dello snapshot canonico — resetta mappa inclusi
 * objects, coda, progetti/history, news, chat, advisor e reader. L'archivio
 * resta scoped al ramo (archiveKey) e non è sovrascritto dal polling.
 */
export function replaceCanonicalSnapshot(
  state: SimulationUiState,
  replacement: { branchId?: string; worldRevision: number; queueVersion?: number; snapshot: CanonicalSnapshot },
): SimulationUiState {
  const branchId = replacement.branchId ?? state.branchId;
  const snapshot = replacement.snapshot ?? {};
  return {
    ...state,
    branchId,
    worldRevision: replacement.worldRevision,
    queueVersion: replacement.queueVersion ?? state.queueVersion,
    lastSequence: replacement.worldRevision,
    // Reset della mappa INCLUSI gli objects: nessun override del ramo vecchio.
    mapRegions: { ...(snapshot.mapRegions ?? {}) },
    pendingActions: (snapshot.pendingActions ?? []).map(action => ({ id: String(action.id), text: String(action.text ?? '') })),
    history: [...(snapshot.history ?? [])],
    newsQueue: [...(snapshot.news ?? [])],
    chats: [...(snapshot.chats ?? [])],
    advisor: snapshot.advisor ?? null,
    reader: snapshot.reader ?? null,
    timeline: [],
    archiveKey: `${state.gameId}:${branchId}`,
  };
}

/**
 * F06 passo 1: cambio branch SOLO dalla risposta valida del comando esplicito
 * corrente (restore): nuovo ramo, anchor del checkpoint, reset completo.
 */
export function applyBranchReplace(
  state: SimulationUiState,
  replacement: {
    gameId: string;
    branchId: string;
    anchor: { checkpointId?: string; revision: number };
    snapshot: CanonicalSnapshot;
  },
): SimulationUiState {
  const next = replaceCanonicalSnapshot(
    { ...state, gameId: replacement.gameId },
    { branchId: replacement.branchId, worldRevision: replacement.anchor.revision, snapshot: replacement.snapshot },
  );
  return {
    ...next,
    pausedRun: null,
    reader: { checkpointId: replacement.anchor.checkpointId ?? null },
  };
}
