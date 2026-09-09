/**
 * World Story — API Service
 * =====================
 */

import type {
  CreateWorldRequest,
  CreateWorldResponse,
  CreateGameRequest,
  CreateGameResponse,
  SubmitActionRequest,
  SubmitActionResponse,
  AdvisorResponse,
  Game,
  World,
  Country,
  WorldTemplate
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';


class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[API Error]', response.status, endpoint, errorText);
    throw new ApiError(response.status, `API Error: ${response.statusText} - ${errorText}`);
  }
  
  return response.json();
}


// ============================================================================
// World API
// ============================================================================

export const worldApi = {
  /**
* Crea un nuovo mondo
   */
  create: (data: CreateWorldRequest): Promise<CreateWorldResponse> => {
    return fetchApi('/worlds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Crea un mondo da una mappa
   */
  createFromMap: (data: {
    mapId: string;
    name: string;
    description?: string;
    startDate?: string;
    basePrompt?: string;
    historicalAccuracy?: number;
    initialOwners?: { id: string; owner: string }[];
  }): Promise<{
    world_id: string;
    name: string;
    regions_count: number;
    regions: { id: string; name: string; color: string; owner: string }[];
  }> => {
    return fetchApi('/worlds/from-map', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Ottieni il mondo per ID
   */
  get: (worldId: string): Promise<World> => {
    return fetchApi(`/worlds/${worldId}`);
  },

  /**
* Aggiungi una regione alla mappa del mondo
   */
  addRegion: (worldId: string, region: {
    id: string;
    name: string;
    svg_path: string;
    color: string;
  }): Promise<{ id: string; name: string }> => {
    return fetchApi(`/worlds/${worldId}/regions`, {
      method: 'POST',
      body: JSON.stringify(region),
    });
  },

  /**
* Aggiorna il prompt del mondo
   */
  updatePrompt: (worldId: string, basePrompt: string): Promise<{ success: boolean; basePrompt: string }> => {
    return fetchApi(`/worlds/${worldId}/prompt`, {
      method: 'PATCH',
      body: JSON.stringify({ basePrompt }),
    });
  },

  /**
   * Genera un mondo da un template (tramite Balance Agent).
   *
   * Flusso ASINCRONO: il POST risponde subito con { jobId } e il client
   * interroga GET /worlds/jobs/:jobId finché il job non è completato.
   * Necessario perché la generazione può durare minuti e dietro Cloudflare
   * Tunnel le richieste oltre ~100s vengono interrotte con un errore 524.
   *
   * onProgress (opzionale) riceve { done, total, stage } dal backend per
   * mostrare l'avanzamento reale nel loader.
   */
  generateFromTemplate: async (
    templateId: string,
    playerCountryCode: string,
    onProgress?: (p: { done: number; total: number; stage: string }) => void
  ): Promise<{
    templateId: string;
    worldId: string;
    date: string;
    countries: Record<string, any>;
    regions: Record<string, any>;
    regionIds?: Record<string, string>;
    playerCountryCode: string;
  }> => {
    const start = await fetchApi<{ jobId: string; status: string }>('/worlds/generate', {
      method: 'POST',
      body: JSON.stringify({ templateId, playerCountryCode }),
    });

    let pollMs = 250;
    const MAX_WAIT_MS = 20 * 60 * 1000; // tetto di sicurezza: 20 minuti
    const deadline = Date.now() + MAX_WAIT_MS;
    // Reti flottanti (backend in riavvio, tunnel che salta): 4 tentativi
    // consecutivi falliti = errore reale. Un singolo buco NON uccide la generazione.
    const MAX_TRANSIENT_FAILURES = 6;
    let transientFailures = 0;

    for (;;) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      let job: {
        status: 'queued' | 'running' | 'completed' | 'failed';
        progress?: { done: number; total: number; stage: string };
        result?: any;
        error?: string;
      };
      try {
        job = await fetchApi<{
          status: 'queued' | 'running' | 'completed' | 'failed';
          progress?: { done: number; total: number; stage: string };
          result?: any;
          error?: string;
        }>(`/worlds/jobs/${start.jobId}`);
        transientFailures = 0;
      } catch (e) {
        // Errore di rete/momentaneo: riprova con pazienza (il backend può
        // riavviarsi durante la generazione, es. redeploy)
        transientFailures++;
        if (transientFailures > MAX_TRANSIENT_FAILURES) {
          throw new Error('Generazione mondo: backend non raggiungibile. Riprova tra poco.');
        }
        onProgress?.({ done: 0, total: 0, stage: `Connessione instabile, riprovo… (${transientFailures}/${MAX_TRANSIENT_FAILURES})` });
        continue;
      }

      if (job.progress) onProgress?.(job.progress);
      if (job.status === 'completed') return job.result;
      // Poll rapido per i mondi in cache, poi più rilassato durante l'LLM.
      pollMs = Math.min(1200, pollMs + 150);
      if (job.status === 'failed') {
        throw new Error(job.error || 'World generation failed');
      }
      if (Date.now() > deadline) {
        throw new Error('World generation timed out');
      }
    }
  },
};


// ============================================================================
// Game API
// ============================================================================

export const gameApi = {
  /**
* Inizia una nuova partita
   */
  create: (data: CreateGameRequest): Promise<CreateGameResponse> => {
    return fetchApi('/games', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  /**
* Ottieni lo stato della partita
   */
  get: (gameId: string): Promise<Game> => {
    return fetchApi(`/games/${gameId}`);
  },
  
  /**
   * Invia l'azione del giocatore
   */
  submitAction: (data: SubmitActionRequest): Promise<SubmitActionResponse> => {
    return fetchApi(`/games/${data.game_id}/action`, {
      method: 'POST',
      body: JSON.stringify({
        game_id: data.game_id,
        player_id: data.player_id,
        text: data.text,
      }),
    });
  },
  
  /**
* Ottieni consigli dal consulente
   */
  getAdvisor: (gameId: string, playerId: string): Promise<AdvisorResponse> => {
    return fetchApi(`/games/${gameId}/advisor?player_id=${playerId}`);
  },

  /**
* Ottieni i suggerimenti (actions.md)
   */
  getSuggestions: (gameId: string): Promise<{ suggestions: any[] }> => {
    return fetchApi(`/games/${gameId}/suggestions`);
  },

  /**
   * Salva partita
   */
  saveGame: (gameId: string, name?: string): Promise<any> => {
    return fetchApi(`/games/${gameId}/save`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  /**
* Carica una partita salvata
   */
  loadSave: (saveId: string): Promise<any> => {
    return fetchApi(`/saves/${saveId}/load`, {
      method: 'POST',
    });
  },

  /**
 * Toggle della simulazione live (battito del mondo)
   */
  setLiveSim: (gameId: string, enabled: boolean): Promise<{ enabled: boolean }> => {
    return fetchApi(`/games/${gameId}/live-sim`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  nationalState: (gameId: string): Promise<{ accounts: Record<string, any> }> =>
    fetchApi(`/games/${gameId}/national-state`),

  // =========================================================================
  // Pending Actions Queue (Phase 2)
  // =========================================================================

  /**
   * Add action to queue (without processing)
   */
  queueAction: (gameId: string, text: string): Promise<{
    id: string;
    text: string;
    status: string;
    createdAt: string;
  }> => {
    return fetchApi(`/games/${gameId}/actions/queue`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  /**
   * Get pending actions
   */
  getPendingActions: (gameId: string): Promise<{ pendingActions: any[] }> => {
    return fetchApi(`/games/${gameId}/actions/queue`);
  },

  /** Remove an action that has not started processing yet. */
  removePendingAction: (gameId: string, actionId: string): Promise<{ removed: boolean }> => {
    return fetchApi(`/games/${gameId}/actions/queue/${encodeURIComponent(actionId)}`, {
      method: 'DELETE',
    });
  },

  /** Modify the text of a queued order before it is taken in charge (G04). */
  updatePendingAction: (gameId: string, actionId: string, text: string): Promise<{ action: any }> => {
    return fetchApi(`/games/${gameId}/actions/queue/${encodeURIComponent(actionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    });
  },

  /** G24 — anteprima riformulata di un ordine libero (non accoda, non simula). */
  enhanceAction: (gameId: string, text: string): Promise<{ original: string; enhanced: string }> => {
    return fetchApi(`/games/${gameId}/actions/enhance`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  ongoingProcesses: (gameId: string): Promise<{ processes: Array<{
    id: string;
    source_action_id: string;
    source_run_id: string;
    title: string;
    summary: string;
    status: 'ongoing';
    started_date: string;
    expected_date?: string | null;
    updated_at: string;
  }> }> => {
    return fetchApi(`/games/${gameId}/ongoing-processes`);
  },

  /**
   * Process one action from queue
   */
  processNextAction: (gameId: string, jumpDays?: number): Promise<{
    id: string;
    text: string;
    status: string;
    result?: {
      narration: string;
      countryResponse: string;
      events: string[];
      eventDetails?: Array<{ id: string; date: string; headline: string; detail: string; source: 'world' | 'diplomacy' }>;
      outcome?: { status: 'accepted' | 'partial' | 'rejected'; summary: string };
      objects: any[];
      turn: number;
      periodStart: string;
      periodEnd: string;
    };
  }> => {
    return fetchApi(`/games/${gameId}/actions/process`, {
      method: 'POST',
      // `0` is the legacy auto-jump value; do not silently turn it into 30.
      body: JSON.stringify({ jump_days: jumpDays ?? 30 }),
    });
  },

  /**
   * Process all pending actions
   */
  processAllActions: (gameId: string, jumpDays?: number): Promise<{
    simulationId?: string;
    processedCount: number;
    actions: any[];
  }> => {
    return fetchApi(`/games/${gameId}/actions/process-all`, {
      method: 'POST',
      body: JSON.stringify({ jump_days: jumpDays ?? 30 }),
    });
  },

  /**
   * Time-skip: process pending actions OR just advance date
   */
  timeSkip: (gameId: string, jumpDays?: number, idempotencyKey?: string): Promise<{
    type: 'actions_processed' | 'date_advanced' | 'world_advanced' | 'no_event_found' | 'simulation_replayed' | 'awaiting_next';
    paused?: boolean;
    event?: { id: string; date: string; headline: string; detail: string; source: string; sourceActionIds?: string[] };
    remaining?: number;
    destination?: string;
    /** G22: ancora del checkpoint mostrato dal lettore. */
    checkpointId?: string;
    revision?: number;
    changedRegions?: any[];
    status?: 'completed' | 'no_event' | 'failed';
    simulationId?: string;
    processedCount?: number;
    actions?: any[];
    result?: {
      simulationId?: string;
      turn: number;
      narration: string;
      events: string[];
      eventDetails?: Array<{ id: string; date: string; headline: string; detail: string; source: 'world' | 'diplomacy' }>;
      periodStart: string;
      periodEnd: string;
    };
    newDate?: string;
    newTurn?: number;
    jumpDays?: number;
    startDate?: string;
    searchedUntil?: string;
  }> => {
    return fetchApi(`/games/${gameId}/time-skip`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      // Il nuovo contratto rende esplicito l'auto-jump, senza il sentinella 0.
      body: JSON.stringify(jumpDays === 0
        ? { mode: 'next_event' }
        : { jump_days: jumpDays ?? 30 }),
    });
  },

  /**
* Fase 2: ritorno al turno precedente
   */
  rewind: (gameId: string): Promise<{ type: string; newTurn: number; newDate: string }> => {
    return fetchApi(`/games/${gameId}/rewind`, { method: 'POST' });
  },

  /**
* Fase 2: Intervene — interrompere l'applicazione degli eventi rimanenti del blocco
   */
  intervene: (gameId: string, simulationId?: string, anchor?: { eventId: string; revision: number }): Promise<{
    ok: boolean;
    simulationId?: string;
    /** §9.3: esito della chiusura affidabile di un run in pausa. */
    intervened?: boolean;
    type?: 'intervened';
    newDate?: string;
    newTurn?: number;
    actions?: any[];
    result?: { turn: number; narration: string; events: string[]; eventDetails: any[]; periodStart: string; periodEnd: string };
  }> => {
    return fetchApi(`/games/${gameId}/intervene`, {
      method: 'POST',
      body: JSON.stringify(simulationId ? { simulationId, ...anchor } : {}),
    });
  },

  /** §9.3 — «Continua»: autorizza il checkpoint per-evento successivo del
   * salto fisso sospeso; l'ultimo Continua porta il mondo a destinazione. */
  continueSimulation: (gameId: string, runId: string): Promise<{
    paused?: boolean;
    type: 'awaiting_next' | 'run_completed' | 'paused_budget' | 'intervened';
    simulationId: string;
    event?: { id: string; date: string; headline: string; detail: string; source: string; sourceActionIds?: string[] };
    remaining?: number;
    destination?: string;
    checkpointId?: string;
    revision?: number;
    changedRegions?: any[];
    actions?: any[];
    result?: { turn: number; narration: string; events: string[]; eventDetails: any[]; periodStart: string; periodEnd: string };
    newDate: string;
    newTurn: number;
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${runId}/next`, {
      method: 'POST',
    });
  },

  /** §9.3: stato del run sospeso, per ricostruire il lettore dopo refresh. */
  getSimulationRun: (gameId: string, runId: string): Promise<{
    run: { id: string; status: string; checkpoint_date?: string; target_date?: string };
    awaitingNext?: { simulationId: string; remaining: number; destination: string; date: string; turn: number; eventId?: string; checkpointId?: string; revision?: number } | null;
    events: Array<{ id: string; checkpointId: string; date: string; headline: string; detail: string; source: string }>;
    actionOutcomes: any[];
    ongoingProcesses: any[];
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${runId}`);
  },

  restoreSimulationCheckpoint: (gameId: string, simulationId: string): Promise<{
    type: 'checkpoint_restored';
    simulationId: string;
    checkpointId: string;
    revision: number;
    newTurn: number;
    newDate: string;
    /** F06 µ2: ramo nuovo + anchor per il reset del client. */
    branchId?: string | null;
    anchor?: { checkpointId: string; revision: number };
  }> => {
    return fetchApi(`/games/${gameId}/simulations/${encodeURIComponent(simulationId)}/restore`, {
      method: 'POST',
    });
  },

  /**
   * Get diplomatic relationships for a game
   */
  getRelationships: (gameId: string): Promise<Record<string, Record<string, string>>> => {
    return fetchApi(`/games/${gameId}/relationships`);
  },

  /**
   * Timeline del mondo: cronaca turno per turno (eventi + data di gioco)
   */
  timeline: (gameId: string, opts?: { after?: number; limit?: number }): Promise<{
    timeline: TimelineEntry[];
    currentDate: string;
    hasMore?: boolean;
    nextAfter?: number;
  }> => {
    const qs = new URLSearchParams();
    if (opts?.after != null) qs.set('after', String(opts.after));
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return fetchApi(`/games/${gameId}/timeline${suffix}`);
  },
};

// ============================================================================
// Chats API (Fase 3: chat diplomatiche)
// ============================================================================

/** Riepilogo della chat con la politia (riga dell'elenco chat) */
export interface ChatSummaryData {
  id: string;
  polityId: string;
  polityName: string;
  polityColor: string;
  /** Partecipanti della chat (chat di gruppo: più nazioni) */
  participants?: { id: string; name: string; color: string; role?: 'player' | 'polity' }[];
  lastMessage?: string;
  lastMessageAt?: string;
  unread: number;
}

/** Messaggio in una chat diplomatica */
export interface ChatMessageData {
  id: string;
  role: 'player' | 'polity' | 'system';
  content: string;
  turn?: number;
  /** Chi ha parlato: nome del giocatore o della nazione */
  senderName?: string;
  /** Data del mondo in cui il messaggio è stato inviato. */
  gameDate?: string;
  createdAt?: string;
}

export interface TimelineEvent {
  id: string;
  date: string;
  headline: string;
  detail: string;
  source: 'world' | 'diplomacy';
  simulationId?: string;
  sourceActionIds?: string[];
  chatId?: string;
  speakerName?: string;
}

/** Voce della Timeline del mondo (cronaca turno per turno). */
export interface TimelineEntry {
  turn: number;
  date: string;
  events: TimelineEvent[];
  narration: string;
}

export const chatsApi = {
  /**
* Elenco delle chat diplomatiche della partita
   */
  list: (gameId: string): Promise<{ chats: ChatSummaryData[] }> => {
    return fetchApi(`/games/${gameId}/chats`);
  },

  /**
   * Crea (o ottiene l'esistente) chat con UNA o più politie — idempotente.
   * Con più nomi crea una chat di gruppo (stile Pax Historia).
   */
  create: (gameId: string, polityNames: string[]): Promise<{ chat: ChatSummaryData }> => {
    return fetchApi(`/games/${gameId}/chats`, {
      method: 'POST',
      body: JSON.stringify({ polityNames }),
    });
  },

  /**
   * «Lascia che parlino»: le nazioni della chat proseguono la trattativa
   * tra loro per N repliche senza intervento del giocatore.
   */
  auto: (gameId: string, chatId: string, exchanges: number = 2): Promise<{ replies: ChatMessageData[] }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/auto`, {
      method: 'POST',
      body: JSON.stringify({ exchanges }),
    });
  },

  /**
* Messaggi della chat (sul backend segna la chat come letta)
   */
  messages: (gameId: string, chatId: string): Promise<{ messages: ChatMessageData[] }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/messages`);
  },

  /** Segna i messaggi ricevuti come letti, anche dopo un evento SSE. */
  markRead: (gameId: string, chatId: string): Promise<{ ok: boolean }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/read`, { method: 'POST' });
  },

  /**
   * Invia un messaggio alla politia; reply = risposta della politia dall'LLM
   */
  send: (gameId: string, chatId: string, content: string): Promise<{
    message: ChatMessageData;
    reply: ChatMessageData;
  }> => {
    return fetchApi(`/games/${gameId}/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },
};

// ============================================================================
// Advisor API (Fase 3: Consulente live)
// ============================================================================

/** Messaggio della cronaca del dialogo con il consulente */
export interface AdvisorHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export const advisorApi = {
  /**
* Chiedi al consulente (dialogo multi-turno — history inviata a ogni richiesta)
   */
  ask: (gameId: string, message: string, history: AdvisorHistoryItem[]): Promise<{ reply: string }> => {
    return fetchApi(`/games/${gameId}/advisor`, {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    });
  },

  /**
* Streaming della risposta del consulente (text/plain chunked).
* onToken viene chiamato per ogni frammento di testo; restituisce la risposta completa.
* In caso di errore di rete dello stream — fallback sul normale POST /advisor.
   */
  askStream: async (
    gameId: string,
    message: string,
    history: AdvisorHistoryItem[],
    onToken: (token: string) => void
  ): Promise<string> => {
    const url = `${API_BASE}/games/${gameId}/advisor/stream`;
    const body = JSON.stringify({ message, history });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      // La rete non ha permesso di aprire lo stream — torniamo alla richiesta normale
      console.warn('[Advisor] Stream non disponibile, fallback su POST /advisor:', e);
      const data = await advisorApi.ask(gameId, message, history);
      onToken(data.reply);
      return data.reply;
    }

    if (!response.ok || !response.body) {
      console.warn('[Advisor] Stream ha restituito', response.status, '— fallback su POST /advisor');
      const data = await advisorApi.ask(gameId, message, history);
      onToken(data.reply);
      return data.reply;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          full += chunk;
          onToken(chunk);
        }
      }
    } catch (e) {
      // Interruzione a metà stream: se non abbiamo ricevuto nulla — fallback, altrimenti restituiamo ciò che abbiamo
      if (!full) {
        console.warn('[Advisor] Stream interrotto, fallback su POST /advisor:', e);
        const data = await advisorApi.ask(gameId, message, history);
        onToken(data.reply);
        return data.reply;
      }
      console.warn('[Advisor] Stream interrotto a metà, uso la risposta parziale:', e);
    }
    return full;
  },
};

// ============================================================================
// Saves API
// ============================================================================

export const savesApi = {
  /**
* Ottieni l'elenco dei salvataggi
   */
  list: (): Promise<{ saves: any[] }> => {
    return fetchApi('/saves');
  },
};


// ============================================================================
// Health Check
// ============================================================================

export const healthApi = {
  check: (): Promise<{ status: string; timestamp: string }> => {
    return fetchApi('/health');
  },
};


// ============================================================================
// Countries API
// ============================================================================

export const countriesApi = {
  /**
   * Ottieni tutti i paesi
   */
  getAll: (): Promise<{ countries: Country[] }> => {
    return fetchApi('/countries');
  },

  /**
   * Ottieni il paese per codice
   */
  getByCode: (code: string): Promise<Country> => {
    return fetchApi(`/countries/${code}`);
  },
};


// ============================================================================
// Templates API
// ============================================================================

/** Info sul template nell'elenco (Fase 5: preset come pacchetti) */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  start_date: string;
  country_count: number;
/** preset = pacchetto da data/presets, legacy = vecchio template da data/templates */
  source: 'preset' | 'legacy';
/** Regole di simulazione personalizzate presenti */
  has_rules: boolean;
/** Mappa propria presente (map.geojson) */
  has_map: boolean;
/** Numero di bandiere nel pacchetto */
  flags_count: number;
}

/** M01 µ4: issue del validatore di catalogo con percorso JSON preciso. */
export interface ScenarioIssueView {
  path: string;
  code: string;
  message: string;
  severity: 'blocking' | 'warning';
}

/** Anteprima di copertura delle filiere (§4.4). */
export interface ScenarioCoverageView {
  justified: string[];
  missing: string[];
  unknownDeposits: number;
}

export interface ScenarioReportView {
  presetId: string;
  ok: boolean;
  errors: ScenarioIssueView[];
  warnings: ScenarioIssueView[];
  catalogHashes: Record<string, string>;
  coverage: ScenarioCoverageView;
}

export interface PresetEditorData {
  id: string;
  name: string;
  description: string;
  start_date: string;
  country_codes: string[];
  base_prompt: string;
  historical_accuracy?: number;
  lore?: string;
  simulation_rules?: string;
  /** Override avanzati dei prompt IA; il contratto di simulazione resta invariabile. */
  prompts?: Record<string, string>;
  author?: string;
  version?: string;
  map_geojson?: any;
}

export const templatesApi = {
  /**
* Ottieni tutti i template
   */
  list: (): Promise<{ templates: TemplateInfo[] }> => {
    return fetchApi('/templates');
  },

  /**
* Ottieni il template per ID
   */
  get: (templateId: string): Promise<WorldTemplate> => {
    return fetchApi(`/templates/${templateId}`);
  },

  getEditable: (templateId: string): Promise<PresetEditorData> => {
    return fetchApi(`/templates/${templateId}/edit`);
  },

  /**
   * M01 µ4: rapporto del catalogo simulation/ per l'editor del preset
   * (checklist, errori per campo con percorsi JSON, copertura delle filiere).
   */
  getScenarioReport: (templateId: string): Promise<{
    presetId: string;
    hasCatalog: boolean;
    report: ScenarioReportView | null;
  }> => {
    return fetchApi(`/templates/${templateId}/scenario`);
  },

  createPreset: (preset: PresetEditorData): Promise<{ template: PresetEditorData }> => {
    return fetchApi('/templates', { method: 'POST', body: JSON.stringify(preset) });
  },

  updatePreset: (templateId: string, preset: PresetEditorData): Promise<{ template: PresetEditorData }> => {
    return fetchApi(`/templates/${templateId}`, { method: 'PUT', body: JSON.stringify(preset) });
  },

  /**
* Esporta il preset come archivio zip: otteniamo il blob e avviamo il download
   */
  exportPreset: async (templateId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/templates/${templateId}/export`);
    if (!response.ok) {
      const text = await response.text();
      console.error('[API Error]', response.status, `/templates/${templateId}/export`, text);
      throw new Error(text || `Errore esportazione (${response.status})`);
    }
    const blob = await response.blob();
    // Nome file — da Content-Disposition, altrimenti <id>.zip
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `${templateId}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Importa uno scenario da archivio zip (body = byte del file).
* Su 409 (già esistente) lancia un errore con code === 'EXISTS' —
* il chiamante mostra un confirm e ripete con overwrite = true.
   */
  importPreset: async (file: File, overwrite = false): Promise<{ template: TemplateInfo }> => {
    const response = await fetch(
      `${API_BASE}/templates/import${overwrite ? '?overwrite=1' : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
      }
    );
    if (response.status === 409) {
      const error = new Error('Esiste già uno scenario con questo ID') as Error & { code?: string };
      error.code = 'EXISTS';
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      console.error('[API Error]', response.status, '/templates/import', text);
      throw new Error(text || `Errore importazione (${response.status})`);
    }
    return response.json();
  },
};


// ============================================================================
// Geo API (Fase 4: geometria reale Natural Earth)
// ============================================================================

/** Proprietà del paese nel GeoJSON da /api/geo/countries */
export interface GeoCountryProperties {
  code: string;
  name: string;
  nameEn?: string;
}

/** GeoJSON Feature di un paese (Polygon o MultiPolygon) */
export interface GeoCountryFeature {
  type: 'Feature';
  properties: GeoCountryProperties;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

/** GeoJSON FeatureCollection con i paesi del mondo */
export interface GeoCountriesCollection {
  type: 'FeatureCollection';
  features: GeoCountryFeature[];
}

/** Capitale del paese da /api/geo/capitals */
export interface GeoCapital {
  capital: string;
  lat: number;
  lng: number;
}

export const geoApi = {
  /**
   * Confini reali dei paesi (Natural Earth) — GeoJSON FeatureCollection.
* Il backend può restituire la collezione direttamente o avvolta in { countries }.
   * Memoizzata: mappa di selezione e altri componenti condividono la stessa
   * promessa invece di riscaricare il GeoJSON a ogni montaggio.
   */
  getCountries: (() => {
    let pending: Promise<GeoCountriesCollection> | null = null;
    return (): Promise<GeoCountriesCollection> => {
      if (pending) return pending;
      pending = fetchApi<GeoCountriesCollection | { countries: GeoCountriesCollection }>('/geo/countries')
        .then((data) => {
          // Normalizza: accetta sia la FeatureCollection nuda sia l'involucro
          if ((data as GeoCountriesCollection).type === 'FeatureCollection') {
            return data as GeoCountriesCollection;
          }
          return (data as { countries: GeoCountriesCollection }).countries;
        })
        .catch(e => { pending = null; throw e; }); // fallita → riprova al prossimo mount
      return pending;
    };
  })(),

  /**
   * Capitali dei paesi: { code: { capital, lat, lng } }
   */
  getCapitals: (): Promise<Record<string, GeoCapital>> => {
    return fetchApi('/geo/capitals');
  },
};

// ============================================================================
// Map API
// ============================================================================

export interface MapRegionData {
  id: string;
  name: string;
  color: string;
  path: string;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  regions: MapRegionData[];
}

export interface MapListItem {
  id: string;
  name: string;
  regions_count: number;
  created_at: string;
}

export const mapApi = {
  /**
* Crea una nuova mappa
   */
  create: (data: {
    name: string;
    width: number;
    height: number;
    regions: MapRegionData[];
  }): Promise<{ id: string; name: string }> => {
    return fetchApi('/maps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
* Elenco di tutte le mappe
   */
  list: (): Promise<MapListItem[]> => {
    return fetchApi('/maps');
  },

  /**
* Ottieni la mappa per ID
   */
  get: (mapId: string): Promise<MapData> => {
    return fetchApi(`/maps/${mapId}`);
  },

  /**
* Elimina la mappa
   */
  delete: (mapId: string): Promise<{ status: string; id: string }> => {
    return fetchApi(`/maps/${mapId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// LLM API (scelta del modello IA a runtime)
// ============================================================================

/** Preset di un provider supportato (Ollama, OpenRouter, NVIDIA…) */
export interface LLMProviderPreset {
  id: string;
  label: string;
  provider: 'openai-compatible' | 'anthropic' | 'minimax';
  baseUrl: string;
  needsKey: boolean;
  docsUrl?: string;
  description?: string;
  defaultModel?: string;
}

export interface LLMStatusMechanicInfo {
  provider: string;
  model: string;
  baseUrl: string;
}

export interface LLMConfigView {
  configPath: string;
  configFileExists: boolean;
  default: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKeySet: boolean;
    apiKeySource: 'file' | 'env' | 'browser' | null;
  };
  mechanics: Record<string, {
    provider: string;
    baseUrl: string;
    model: string;
    overridden: boolean;
    hasKeyOverride: boolean;
  }>;
}

export interface LLMModelItem {
  id: string;
  name?: string;
}

export interface LLMTestResult {
  ok: boolean;
  reply: string;
  latencyMs: number;
}

export interface LLMSavePayload {
  default: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  mechanics?: Record<string, { model?: string; apiKey?: string; baseUrl?: string; provider?: string }>;
  /** false → la chiave resta solo in memoria server (mai su disco); vive nel browser */
  persistApiKey?: boolean;
}

export const llmApi = {
  status: (): Promise<{ mechanics: Record<string, LLMStatusMechanicInfo> }> => {
    return fetchApi('/llm/status');
  },

  providers: (): Promise<{ providers: LLMProviderPreset[] }> => {
    return fetchApi('/llm/providers');
  },

  config: (): Promise<LLMConfigView> => {
    return fetchApi('/llm/config');
  },

  save: (payload: LLMSavePayload): Promise<{ ok: boolean } & LLMConfigView & { status: { mechanics: Record<string, LLMStatusMechanicInfo> } }> => {
    return fetchApi('/llm/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  models: (params: { provider: string; baseUrl?: string; apiKey?: string }): Promise<{ models: LLMModelItem[]; warning?: string }> => {
    return fetchApi('/llm/models', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  test: (params: { provider: string; baseUrl: string; apiKey?: string; model: string }): Promise<LLMTestResult> => {
    return fetchApi('/llm/test', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};
