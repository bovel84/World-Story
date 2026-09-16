/**
 * World Story — SessionStateStore
 * ===============================
 * Proprietà dello **stato vivo di sessione**, spostata fuori da `GameSession`
 * (Fase 1, passo finale). `GameSession` espone gli stessi nomi come accessor
 * (`private get regions() { return this.state.regions; }`), quindi tutti i
 * call-site e i contesti dei servizi restano invariati.
 *
 * Il bridge di persistenza (`captureCore`/`applyCore`) è l'unico punto che
 * serializza e ripristina lo stato di base: `captureApplyState` /
 * `applyPersistenceState` di `GameSession` vi aggiungono solo le parti che
 * vivono in altri servizi (relazioni diplomatiche e coda ordini).
 */

import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import type { CrisisEnding } from '../core/simulation/NationCrisis';
import type { Difficulty } from '../prompts/difficulty';
import type { GovernmentVoices } from '../prompts/government';
import type { ActionRecord, PlayerInfo, PausedRunState, RegionState, TurnResultRecord } from '../game-session';

/** Sottoinsieme dello stato di sessione catturato/ripristinato dal bridge. */
export interface SessionCoreState {
  currentTurn: number;
  currentDate: string;
  players: PlayerInfo[];
  regions?: Map<string, RegionState>;
  actions: ActionRecord[];
  results: TurnResultRecord[];
  consolidatedHistory: string;
  consolidatedUpTo: number;
  difficulty: Difficulty;
  interveneRequested: boolean;
  pausedRun: PausedRunState | null;
}

export class SessionStateStore {
  // ── Mondo (regioni mutate in place; la Map può essere riassegnata) ───────
  regions: Map<string, RegionState> = new Map();
  players: PlayerInfo[] = [];

  // ── Tempo e turno ────────────────────────────────────────────────────────
  currentTurn = 1;
  currentDate = '1951-01-01';
  maxTurns = 100;
  /**
   * F03/A10: risultato del batch appena committato, associato all'ID alla
   * creazione. Mai letto per posizione: un salto senza eventi lo lascia null.
   */
  lastCommittedResult: TurnResultRecord | null = null;

  // ── Metadati del mondo (cache da init/reconstruct) ───────────────────────
  worldName = '';
  worldBasePrompt = '';
  worldStartDate = '';
  /** Этап 5: кастомные правила симуляции мира (rules.md пресет-пакета) */
  worldSimulationRules: string | undefined = undefined;

  // ── Giocatore, politica, difficoltà ──────────────────────────────────────
  playerPolityId = 'player';
  difficulty: Difficulty = 'normal';
  taxRatePct: number | null = null;
  ending: CrisisEnding | null = null;
  pendingFundingNotes: string | null = null;

  // ── Cronaca e turni ──────────────────────────────────────────────────────
  consolidatedHistory = '';
  consolidatedUpTo = 0;
  interveneRequested = false;
  actions: ActionRecord[] = [];
  results: TurnResultRecord[] = [];
  status: 'waiting' | 'playing' | 'finished' = 'playing';
  pausedRun: PausedRunState | null = null;

  // ── Note nazionali, voci del governo, cache conti ────────────────────────
  pendingNationalNotes: string[] = [];
  governmentVoices: { key: string; data: GovernmentVoices } | null = null;
  initialAccountsCache?: Record<string, NationalAccount>;

  // ── Simulazione live ─────────────────────────────────────────────────────
  liveSimEnabled = false;
  worldTickTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Cattura il sottoinsieme di stato ripristinabile. Le regioni sono copiate
   * in profondità: il restore/rollback lavora su uno snapshot isolato.
   */
  captureCore(): SessionCoreState {
    return {
      currentTurn: this.currentTurn,
      currentDate: this.currentDate,
      players: this.players,
      regions: new Map<string, RegionState>(
        [...this.regions.entries()].map(([id, region]) => [id, JSON.parse(JSON.stringify(region))]),
      ),
      actions: [...this.actions],
      results: [...this.results],
      consolidatedHistory: this.consolidatedHistory,
      consolidatedUpTo: this.consolidatedUpTo,
      difficulty: this.difficulty,
      interveneRequested: this.interveneRequested,
      pausedRun: this.pausedRun,
    };
  }

  /** Scrive in RAM lo stato di base calcolato dal restore (forward o rollback). */
  applyCore(core: SessionCoreState): void {
    this.currentTurn = core.currentTurn;
    this.currentDate = core.currentDate;
    this.players = core.players;
    if (core.regions) this.regions = core.regions;
    this.actions = core.actions;
    this.results = core.results;
    this.consolidatedHistory = core.consolidatedHistory;
    this.consolidatedUpTo = core.consolidatedUpTo;
    this.difficulty = core.difficulty;
    this.interveneRequested = core.interveneRequested;
    this.pausedRun = core.pausedRun;
  }
}
