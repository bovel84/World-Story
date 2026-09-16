/**
 * World Story — SimulationCoordinator
 * ===================================
 * Coordinamento del run di simulazione di una sessione, estratto da
 * `game-session.ts` (Fase 1, punto 5).
 *
 * Possiede il **lock per-sessione** e l'identità del run mutante attivo:
 *  - `withLock` serializza le sequenze read-modify-write su una sessione;
 *  - `activeRunId` / `activeAbort` identificano e arrestano il run in corso.
 *
 * Non conosce il dominio: `GameSession` resta l'orchestratore del turno e
 * consulta il coordinatore per la mutua esclusione e per l'interruzione.
 * Lo stato `pausedRun` (playback a checkpoint) resta invece nella sessione.
 */

export class SimulationCoordinator {
  private processing = false;
  private activeRunId: string | null = null;
  private activeAbort: AbortController | null = null;

  /** True mentre un run mutante possiede il checkpoint della sessione. */
  get isProcessing(): boolean {
    return this.processing;
  }

  /** ID del run mutante attualmente proprietario del checkpoint. */
  get activeSimulationRunId(): string | null {
    return this.activeRunId;
  }

  /** Controller che annulla il fetch LLM del run attivo. */
  get activeSimulationAbort(): AbortController | null {
    return this.activeAbort;
  }

  isSimulationInProgress(): boolean {
    return this.processing;
  }

  setActiveRunId(id: string | null): void {
    this.activeRunId = id;
  }

  /** Apre un nuovo controller di abort per il run attivo. */
  beginAbort(): AbortController {
    this.activeAbort = new AbortController();
    return this.activeAbort;
  }

  /** Azzera identità e controller del run attivo. */
  clearActiveRun(): void {
    this.activeRunId = null;
    this.activeAbort = null;
  }

  /** F05 µ2: arresto controllato fino agli adattatori (stream e convertitore). */
  abortActive(): void {
    this.activeAbort?.abort();
  }

  /**
   * Esegue `fn` sotto il lock per-sessione. Se un altro chiamante lo detiene
   * già, restituisce `null` subito (nessuna attesa: la coda può durare minuti
   * e non si vuole bloccare una seconda richiesta HTTP). In caso di successo o
   * errore il lock è sempre rilasciato prima che la promise si risolva.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.processing) {
      console.warn('[GameSession] Concurrent turn attempt rejected (lock held)');
      return null;
    }
    this.processing = true;
    try {
      return await fn();
    } finally {
      this.processing = false;
    }
  }
}
