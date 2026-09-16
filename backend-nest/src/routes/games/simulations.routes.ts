/**
 * World Story — Games: simulations routes (Fase 5)
 * =========================================
 * Esecuzione simulazioni, job e recovery.
 */
import { Router } from 'express';
import { shortId } from '../../utils/short-id';
import { gameRepository } from '../../repositories';
import { countryRepository } from '../../repositories/country.repository';
import { getSessionRegistry } from '../../session-registry';
import { SimulationInProgressError, SimulationPausedError, SimulationStaleCheckpointError, GameOverError, type TurnResultRecord, type PausedBatchResult } from '../../game-session';
import { IdempotencyConflictError, simulationJobService } from '../../jobs/SimulationJobService';
import { addDays, jumpHorizon } from '../../core/simulation/calendar';
import { addSSEClient, removeSSEClient, broadcastToGame, hasClients } from '../../sse';
import { LLMError } from '../../llm';
import path from 'path';
import { loadSimulationCatalog } from '../../scenario/loader';
import type { SimulationCatalog } from '../../scenario/types';
import { normalizeOrderIntent } from '../../core/feasibility/intent';
import { FeasibilityService } from '../../core/feasibility/FeasibilityService';
import { AssessmentStore } from '../../core/feasibility/AssessmentStore';
import { createCashflow, FinanceError } from '../../services/FinanceService';
import { createReservation, InsufficientAvailabilityError, ReservationError } from '../../services/ReservationService';
import { ledgerUnitId, bootstrapCatalogEconomy } from '../../services/StrictEffectProducerService';
import { executeMandateEconomy } from '../../services/MandateEconomyService';
import { createMandateRecord, getMandateRemaining, MandateConflictError } from '../../services/MandateService';
import { MandateError } from '../../core/mandates/MandateEngine';
import { MandateDecisionError, acknowledgeMandateDecision, cancelMandateAndResolveDecisions, listOpenMandateDecisions } from '../../services/MandateDecisionService';
import { parseInteger } from '../../domain/quantities';
import {
  TRADE_ERROR_CODES, PROCURE_ERROR_CODES, DEBT_ERROR_CODES,
  respondDomainError, respondRouteError, normalizeAdvisorHistory,
  bindStrictEconomy, respondEconomyError, respondMandateError,
  respondLegacyFeasibility, respondTimeSkipResult, respondJobFailure,
  assessmentStore,
} from './helpers';

export function registerSimulationRoutes(router: Router): void {
router.get('/:id/simulations/:runId', (req, res) => {
  try {
    const run = gameRepository.getSimulationRun(req.params.id, req.params.runId);
    if (!run) {
      res.status(404).json({ error: 'Simulation run not found' });
      return;
    }
    // A03: allowlist dei campi pubblici del run. Fuori dal contratto HTTP:
    // pending_state (le proposte future non applicate sono stato interno e
    // spoiler del futuro) e le chiavi di idempotenza.
    const publicRun = {
      id: run.id,
      game_id: run.game_id,
      mode: run.mode,
      status: run.status,
      start_date: run.start_date,
      target_date: run.target_date,
      checkpoint_date: run.checkpoint_date,
      checkpoint_id: run.checkpoint_id,
      turn: run.turn,
      error: run.error,
      created_at: run.created_at,
      completed_at: run.completed_at,
    };
    const checkpoint = run.checkpoint_id
      ? gameRepository.getSimulationCheckpoint(req.params.id, run.checkpoint_id)
      : null;
    // §9.3: il lettore sa sempre se il run attende la conferma del giocatore.
    let awaitingNext: any = null;
    try {
      const pausedInfo = getSessionRegistry().getSession(req.params.id)?.getPausedRunInfo?.() || null;
      awaitingNext = pausedInfo && pausedInfo.simulationId === run.id ? pausedInfo : null;
    } catch { /* sessione non in memoria */ }
    res.json({
      run: publicRun,
      awaitingNext,
      checkpoint: checkpoint ? {
        id: checkpoint.id,
        revision: checkpoint.revision,
        turn: checkpoint.turn,
        date: checkpoint.game_date,
      } : null,
      events: gameRepository.getSimulationEvents(req.params.id, run.id),
      actionOutcomes: gameRepository.getSimulationActionOutcomes(req.params.id, run.id),
      ongoingProcesses: gameRepository.getOngoingProcesses(req.params.id),
    });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get simulation run');
  }
});

/** Ripristina l'ultimo checkpoint durevole di un run completato. */
router.post('/:id/simulations/:runId/restore', async (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    if (session.isSimulationInProgress()) {
      res.status(409).json({ error: 'Simulazione in corso: ripristino non disponibile', code: 'simulation_in_progress' });
      return;
    }
    const run = gameRepository.getSimulationRun(req.params.id, req.params.runId);
    if (!run?.checkpoint_id) {
      res.status(404).json({ error: 'Checkpoint del run non disponibile' });
      return;
    }
    const checkpoint = gameRepository.getSimulationCheckpoint(req.params.id, run.checkpoint_id);
    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint non trovato' });
      return;
    }
    // F04 §9.4.1: validazione dell’hash semantico PRIMA della mutazione —
    // catalogo assente o snapshot incompatibile rifiuta il restore.
    // F04 passo 2: il restore apre un ramo nuovo con origin nel checkpoint.
    const loaded = session.loadFromSave(
      JSON.parse(checkpoint.data),
      checkpoint.content_hash ?? undefined,
      { newBranch: { originCheckpointId: checkpoint.id, name: `restore-rev${checkpoint.revision}` } },
    );
    await session.persistLoadedState();
    res.json({
      type: 'checkpoint_restored',
      gameId: req.params.id,
      branchId: loaded.branchId,
      anchor: { checkpointId: checkpoint.id, revision: checkpoint.revision },
      simulationId: run.id,
      checkpointId: checkpoint.id,
      revision: checkpoint.revision,
      newTurn: session.getCurrentTurn(),
      newDate: session.getCurrentDate(),
    });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to restore simulation checkpoint');
  }
});

// ── F05 µ1: job asincroni del salto ────────────────────────────────────
// La POST di accettazione NON attende il provider: crea il job e risponde
// 202. Il client riconcilia con GET del job e con il lettore di run.
router.post('/:id/simulation-jobs', (req, res) => {
  const gameId = req.params.id;
  const mode = req.body?.mode === 'next_event' ? 'next_event' : 'fixed';
  const rawJumpDays = mode === 'next_event' ? 0 : (req.body?.jump_days ?? 30);
  const jump_days = Number.isFinite(Number(rawJumpDays)) ? Number(rawJumpDays) : 30;
  const rawIdempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey;
  const idempotencyKey = typeof rawIdempotencyKey === 'string' && rawIdempotencyKey.length <= 128
    ? rawIdempotencyKey
    : undefined;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    if (session.hasActiveRun()) {
      res.status(409).json({ error: 'Simulazione già attiva per questa partita', code: 'simulation_in_progress' });
      return;
    }
    const periodStart = session.getCurrentDate();
    const submitted = simulationJobService.submit(
      gameId, 'jump', { mode, jump_days, periodStart }, idempotencyKey, { mode, jump_days },
    );
    if (submitted.replayed) {
      // Stessa chiave e stesso payload: il job esistente è la risposta, non si
      // genera nulla di nuovo.
      res.json({ type: 'job_replayed', jobId: submitted.id, status: submitted.status, runId: submitted.runId ?? null, replayed: true });
      return;
    }
    res.status(202).json({ type: 'job_accepted', jobId: submitted.id, status: submitted.status });
  } catch (e: any) {
    if (e instanceof IdempotencyConflictError) {
      res.status(409).json({ error: e.message, code: 'idempotency_conflict', jobId: e.jobId });
      return;
    }
    respondRouteError(res, e, 'Failed to submit simulation job');
  }
});

router.get('/:id/simulation-jobs/:jobId', (req, res) => {
  try {
    getSessionRegistry().getSessionOrThrow(req.params.id);
    const job = gameRepository.getJob(req.params.jobId);
    if (!job || job.game_id !== req.params.id) {
      res.status(404).json({ error: 'Job non trovato' });
      return;
    }
    res.json(simulationJobService.publicJob(job));
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get simulation job');
  }
});

/** Risultato compatibile del job asincrono: ogni richiesta resta breve, quindi
 * un proxy lento non può troncare una generazione LLM ancora in corso. */
router.get('/:id/simulation-jobs/:jobId/result', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const job = gameRepository.getJob(req.params.jobId);
    if (!job || job.game_id !== req.params.id) {
      res.status(404).json({ error: 'Job non trovato' });
      return;
    }
    if (job.status === 'failed') {
      respondJobFailure(res, job);
      return;
    }
    if (job.status !== 'completed') {
      res.status(202).json({ type: 'job_pending', jobId: job.id, status: job.status, runId: job.run_id ?? null });
      return;
    }
    const payload = JSON.parse(job.payload_json || '{}') as { periodStart?: string; jump_days?: number };
    respondTimeSkipResult(
      res,
      session,
      JSON.parse(job.result_json || 'null'),
      payload.periodStart || session.getCurrentDate(),
      Number.isFinite(payload.jump_days) ? Number(payload.jump_days) : 30,
    );
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get simulation job result');
  }
});

// F05 µ2 — ripresa/chiusura autorizzabile del run in paused_recovery:
// nessuna delle due è mai automatica dopo un lease scaduto.
router.post('/:id/simulations/:runId/resume-recovery', (req, res) => {
  try {
    getSessionRegistry().getSessionOrThrow(req.params.id);
    const resumed = simulationJobService.resumeRun(req.params.id, req.params.runId);
    if (!resumed) {
      res.status(409).json({ error: 'Il run indicato non è in paused_recovery con un job recuperabile', code: 'resume_not_available' });
      return;
    }
    res.status(202).json({ type: 'job_requeued', jobId: resumed.jobId });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to resume run');
  }
});

router.post('/:id/simulations/:runId/close-recovery', (req, res) => {
  try {
    getSessionRegistry().getSessionOrThrow(req.params.id);
    const closed = simulationJobService.closeRecoveryRun(req.params.id, req.params.runId);
    if (!closed) {
      res.status(409).json({ error: 'Il run indicato non è in paused_recovery', code: 'close_not_available' });
      return;
    }
    res.json({ type: 'recovery_closed', runId: req.params.runId, status: 'interrupted' });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to close run');
  }
});
}
