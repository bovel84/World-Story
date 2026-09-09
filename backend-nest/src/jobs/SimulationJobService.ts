/**
 * World Story — SimulationJobService (F05)
 * =====================================
 * Ciclo di vita dei job di salto separato dalla richiesta HTTP: la rete o il
 * proxy non decide quanto dura un run. La POST di accettazione crea il job e
 * risponde 202 senza attendere il provider; un worker in-process reclama i
 * job con claim/lease durevoli, una partita alla volta; un lease scaduto
 * (crash) porta il run in `paused_recovery` all'ultimo checkpoint senza
 * fare una seconda chiamata pagata automaticamente.
 */

import { shortId } from '../utils/short-id';
import { semanticStateHash } from '../domain/semantic-hash';
import { gameRepository } from '../repositories/game.repository';
import { getSessionRegistry } from '../session-registry';

/** C09: stessa idempotency key con payload diverso — conflitto esplicito. */
export class IdempotencyConflictError extends Error {
  constructor(public jobId: string) {
    super(`idempotency_conflict: stessa chiave con payload diverso (job esistente ${jobId})`);
    this.name = 'IdempotencyConflictError';
  }
}

const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;

export interface JobSubmission {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  replayed: boolean;
  runId?: string | null;
}

class SimulationJobService {
  private owner = `worker-${shortId()}`;
  private processing = false;
  private shuttingDown = false;
  private currentJob: { id: string; game_id: string } | null = null;
  private waiters = new Map<string, (job: any) => void>();

  /** Hash canonico del payload per l’idempotenza (C09). */
  hashPayload(input: Record<string, unknown>): string {
    return semanticStateHash(input);
  }

  /**
   * Accetta un job di salto: valida l’idempotenza (stessa chiave + stesso
   * payload → stesso job; stessa chiave + payload diverso → 409), lo mette in
   * coda e risveglia il worker. Nessuna chiamata al provider in questo percorso.
   * `hashInput` restringe l’impronto ai soli campi che contano (es. mode/jump_days),
   * mentre `payload` conserva anche dettagli di contesto (es. periodStart).
   */
  submit(
    gameId: string,
    type: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
    hashInput?: Record<string, unknown>,
  ): JobSubmission {
    const payloadJson = JSON.stringify(payload);
    const payloadHash = this.hashPayload(hashInput ?? payload);

    if (idempotencyKey) {
      const existing = gameRepository.findJobByIdempotencyKey(gameId, idempotencyKey);
      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(existing.id);
        }
        return { id: existing.id, status: existing.status, replayed: true, runId: existing.run_id };
      }
    }

    const job = { id: shortId(), gameId, type, payloadJson, payloadHash, idempotencyKey };
    gameRepository.createJob(job);
    this.kick();
    return { id: job.id, status: 'queued', replayed: false, runId: null };
  }

  /** Risveglia il worker senza bloccare il chiamante (single-flight). */
  kick(): void {
    if (this.processing || this.shuttingDown) return;
    this.processing = true;
    setImmediate(() => {
      this.drain()
        .catch(e => console.error('[Jobs] Worker loop error:', e))
        .finally(() => {
          this.processing = false;
          // F05 µ3: il flag si aggiorna in una microtask successiva alla catena
          // dei chiamanti — un kick arrivato nel frattempo verrebbe perso.
          // Il pump si riavvia se nel frattempo sono arrivati nuovi job.
          if (!this.shuttingDown && gameRepository.nextQueuedJob()) this.kick();
        });
    });
  }

  /**
   * F05 µ3: attende il completamento (o fallimento) di un job — usato dai
   * percorsi legacy che delegano al worker restando compatibili con la
   * risposta sincrona. Il timeout protegge da waiters orfani.
   */
  waitForJob(jobId: string, timeoutMs = 300_000): Promise<any> {
    const existing = gameRepository.getJob(jobId);
    if (existing && (existing.status === 'completed' || existing.status === 'failed')) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(jobId);
        reject(new Error('job_wait_timeout'));
      }, timeoutMs);
      this.waiters.set(jobId, (job) => { clearTimeout(timer); resolve(job); });
    });
  }

  private settleWaiters(jobId: string): void {
    const waiter = this.waiters.get(jobId);
    if (waiter) {
      this.waiters.delete(jobId);
      waiter(gameRepository.getJob(jobId));
    }
  }

  /**
   * F05 µ2: arresto controllato — non accetta nuovo lavoro e aborta il run
   * in volo (il signal arriva fino agli adattatori, convertitore compreso).
   * Il job in volo viene marcato failed dall’execute, mai dimenticato.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.currentJob) {
      try {
        getSessionRegistry().getSessionOrThrow(this.currentJob.game_id).abortActiveSimulation();
      } catch { /* sessione già assente: il job verrà recuperato dal lease */ }
    }
    while (this.processing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /** F05 µ2: ripartenza controllata (es. dopo riavvio del processo): recupera
   * i lease scaduti e riapre il worker. Nessuna generazione automatica: i job
   * in coda sopravvissuti al crash vengono solo reclamati. */
  startup(): void {
    this.shuttingDown = false;
    this.recoverExpiredLeases();
    this.kick();
  }

  private async drain(): Promise<void> {
    for (;;) {
      const job = this.claimNext();
      if (!job) return;
      await this.execute(job);
    }
  }

  /** Claim durevole: UPDATE condizionato da 'queued' — un solo vincitore. */
  private claimNext(): any | null {
    const job = gameRepository.nextQueuedJob();
    if (!job) return null;
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
    if (!gameRepository.claimJob(job.id, this.owner, leaseExpiresAt)) return null;
    return gameRepository.getJob(job.id);
  }

  /** Esegue un job già reclamato; il provider non è mai richiamato due volte. */
  private async execute(job: any): Promise<void> {
    // F05 µ2: heartbeat tecnico — rinnova SOLO il lease del job, il gioco non
    // avanza mai per heartbeat. Fencing: solo il proprietario rinnova.
    const heartbeat = setInterval(() => {
      const renewed = gameRepository.renewJobLease(job.id, this.owner, new Date(Date.now() + LEASE_MS).toISOString());
      if (!renewed) console.warn('[Jobs] Lease renewal rejected (fencing) for', job.id);
    }, HEARTBEAT_MS);
    this.currentJob = job;
    try {
      const session = getSessionRegistry().getSessionOrThrow(job.game_id);
      const payload = JSON.parse(job.payload_json) as { jump_days?: number };
      const jumpDays = Number.isFinite(payload?.jump_days) ? Number(payload.jump_days) : 30;

      let result: any;
      if (session.getPendingActions().length > 0) {
        result = await session.processAllPendingActions(jumpDays, job.idempotency_key || undefined);
      } else {
        result = await session.processWorldAdvance(jumpDays, job.idempotency_key || undefined);
      }

      // L'ID del run è l'ancora pubblica per la riconciliazione (lettore).
      let runId: string | null = null;
      if (result && !Array.isArray(result)) {
        runId = result.simulationId ?? result?.result?.simulationId ?? null;
      } else if (Array.isArray(result) && result.length > 0) {
        runId = result[result.length - 1]?.result?.simulationId ?? null;
      }
      // F05 µ3: l’esito pubblico del job serve ai percorsi legacy che
      // delegano e ricostruiscono la stessa risposta di prima.
      gameRepository.updateJobStatus(job.id, 'completed', { runId, resultJson: JSON.stringify(result ?? null) });
    } catch (e: any) {
      gameRepository.updateJobStatus(job.id, 'failed', { error: e?.message || 'job_failed', errorName: e?.name || null });
      // Il job fallito non muta il mondo: la sessione gestisce il proprio
      // rollback (F02) — qui si registra solo l'esito del job.
    } finally {
      clearInterval(heartbeat);
      this.currentJob = null;
      this.settleWaiters(job.id);
    }
  }

  /**
   * F05 passo 4: lease scadute dopo un crash → job `failed` (lease_expired) e
   * run `paused_recovery` all'ultimo checkpoint. NESSUNA seconda chiamata
   * pagata automaticamente: la ripresa è esplicita (µ2 espone ripresa/chiusura).
   */
  recoverExpiredLeases(now: Date = new Date()): number {
    const expired = gameRepository.expiredRunningJobs(now.toISOString());
    for (const job of expired) {
      gameRepository.updateJobStatus(job.id, 'failed', { error: 'lease_expired: il worker ha perso il lease' });
      // Il run aperto dall'esecuzione interrotta (se esiste e ancora 'running')
      // diventa riprendibile senza rigenerazione.
      const run = gameRepository.latestRunningRun(job.game_id);
      if (run) gameRepository.markRunPausedRecovery(run.id, 'lease_expired: recupero all\'ultimo checkpoint');
    }
    if (expired.length > 0) {
      console.log(`[Jobs] Recovered ${expired.length} expired lease(s)`);
    }
    return expired.length;
  }

  /** Vista pubblica del job: allowlist, nessun dettaglio interno. */
  publicJob(job: any) {
    return {
      id: job.id,
      gameId: job.game_id,
      type: job.type,
      status: job.status,
      runId: job.run_id,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    };
  }

  /**
   * F05 µ2 — ripresa AUTORIZZATA: il job fallito per lease scaduta viene
   * riaccodato (esplicito del giocatore, mai automatico); il run interrotto
   * è sostituito dal nuovo che l’esecuzione creerà.
   */
  resumeRun(gameId: string, runId: string): { jobId: string } | null {
    const run = gameRepository.getSimulationRun(gameId, runId);
    if (!run || run.status !== 'paused_recovery') return null;
    const job = gameRepository.getJobByRunId(runId);
    if (!job || job.game_id !== gameId || job.status !== 'failed') return null;
    gameRepository.finishSimulationRun(runId, 'interrupted', { error: 'superseded_by_resume' });
    gameRepository.updateJobStatus(job.id, 'queued', { error: null });
    this.kick();
    return { jobId: job.id };
  }

  /** F05 µ2 — chiusura autorizzata del run in paused_recovery. */
  closeRecoveryRun(gameId: string, runId: string): boolean {
    const run = gameRepository.getSimulationRun(gameId, runId);
    if (!run || run.status !== 'paused_recovery') return false;
    gameRepository.finishSimulationRun(runId, 'interrupted', { error: 'closed_by_operator' });
    return true;
  }
}

export const simulationJobService = new SimulationJobService();