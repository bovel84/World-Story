/**
 * World Story — Games: playback routes (Fase 5)
 * =========================================
 * Time-skip, passo per-evento, rewind e Intervieni.
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
import { validateBody } from '../validation';
import { timeSkipSchema, interveneSchema } from './schemas';

export function registerPlaybackRoutes(router: Router): void {
router.post('/:id/time-skip', async (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, timeSkipSchema, req.body)) return;
  // Contratto canonico: mode=next_event. Il valore 0 resta soltanto una
  // compatibilità per client vecchi, mai un dettaglio esposto dalla UI.
  const mode = req.body?.mode === 'next_event' ? 'next_event' : 'fixed';
  const jump_days = mode === 'next_event' ? 0 : (req.body?.jump_days ?? 30);
  const rawIdempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey;
  const idempotencyKey = typeof rawIdempotencyKey === 'string' && rawIdempotencyKey.length <= 128
    ? rawIdempotencyKey
    : undefined;
  // F05 µ3: la risposta resta compatibile, ma l'esecuzione passa SEMPRE dal
  // percorso job (stesso lotto, stesse validazioni, stesso worker).
  res.set('Deprecation', 'true');

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    // Un salto in pausa o attivo è un conflitto esplicito, non un lavoro nuovo.
    const pausedInfo = session.getPausedRunInfo();
    if (pausedInfo) {
      res.status(409).json({ error: 'Un salto in pausa attende una decisione: Continua o Intervieni prima di avanzare di nuovo', code: 'simulation_paused', simulationId: pausedInfo.simulationId });
      return;
    }
    if (session.isSimulationInProgress()) {
      res.status(409).json({ error: 'A simulation is already in progress for this game', code: 'simulation_in_progress' });
      return;
    }

    if (idempotencyKey) {
      // F05 µ3/C09: l'idempotenza con hash del payload viene PRIMA del replay
      // per run: stessa chiave + payload diverso è un conflitto, non un riuso.
      const jobExisting = gameRepository.findJobByIdempotencyKey(gameId, idempotencyKey);
      if (jobExisting) {
        if (jobExisting.payload_hash !== simulationJobService.hashPayload({ mode, jump_days })) {
          res.status(409).json({ error: `idempotency_conflict: stessa chiave con payload diverso (job esistente ${jobExisting.id})`, code: 'idempotency_conflict', jobId: jobExisting.id });
          return;
        }
        if (jobExisting.status === 'completed' && jobExisting.result_json) {
          const payload = JSON.parse(jobExisting.payload_json) as { periodStart?: string };
          respondTimeSkipResult(res, session, JSON.parse(jobExisting.result_json), payload.periodStart || session.getCurrentDate(), jump_days);
          return;
        }
        if (jobExisting.status === 'failed') { respondJobFailure(res, jobExisting); return; }
        res.json({ type: 'simulation_replayed', simulationId: jobExisting.run_id, status: jobExisting.status });
        return;
      }
      // Compatibilità con run pre-job: stessa chiave su un run vecchio riesegue
      // la stessa risposta senza nuove esecuzioni.
      const existing = gameRepository.getSimulationRunByIdempotencyKey(gameId, idempotencyKey);
      if (existing) {
        if (existing.status === 'running') {
          res.status(409).json({ error: 'Richiesta già in elaborazione', code: 'simulation_in_progress', simulationId: existing.id });
          return;
        }
        if (existing.status === 'awaiting_next') {
          res.json({ type: 'awaiting_next', simulationId: existing.id, replayed: true });
          return;
        }
        res.json({
          type: 'simulation_replayed',
          simulationId: existing.id,
          status: existing.status,
          newDate: existing.checkpoint_date || existing.start_date,
          newTurn: existing.turn != null ? Number(existing.turn) + 1 : undefined,
        });
        return;
      }
    }

    const periodStart = session.getCurrentDate();
    const submitted = simulationJobService.submit(
      gameId, 'jump', { mode, jump_days, periodStart }, idempotencyKey, { mode, jump_days },
    );
    const job = await simulationJobService.waitForJob(submitted.id);
    if (job.status !== 'completed') { respondJobFailure(res, job); return; }
    respondTimeSkipResult(res, session, JSON.parse(job.result_json || 'null'), periodStart, jump_days);
  } catch (e: any) {
    console.error('[TIME-SKIP] Error:', e);
    respondRouteError(res, e, 'Failed to time-skip');
  }
});

// Этап 2: Rewind — откат на ход назад
/** §9.3 — «Continua»: autorizza il checkpoint per-evento successivo del
 * salto fisso sospeso. L'ultimo «Continua» porta il mondo a destinazione. */
router.post('/:id/simulations/:runId/next', async (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const paused = session.getPausedRunInfo();
    if (!paused || paused.simulationId !== req.params.runId) {
      res.status(409).json({ error: 'Il run indicato non è in pausa', code: 'simulation_not_paused' });
      return;
    }
    const result = await session.continueSimulation(req.params.runId);
    res.json(result);
  } catch (e: any) {
    console.error('[NEXT] Error:', e);
    respondRouteError(res, e, 'Failed to continue simulation');
  }
});

router.post('/:id/rewind', (req, res) => {
  const gameId = req.params.id;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    if (session.isSimulationInProgress()) {
      res.status(409).json({ error: 'Simulazione in corso: rewind non disponibile', code: 'simulation_in_progress' });
      return;
    }
    const result = session.rewind();
    if (!result) {
      res.status(404).json({ error: 'Nessuno snapshot a cui tornare (gioca almeno un turno)' });
      return;
    }
    res.json({ type: 'rewound', newTurn: result.turn, newDate: result.date });
  } catch (e: any) {
    console.error('[REWIND] Error:', e);
    respondRouteError(res, e, 'Failed to rewind');
  }
});

// Этап 2: можно ли откатиться (для UI)
router.get('/:id/rewind', (req, res) => {
  const gameId = req.params.id;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    res.json({ canRewind: session.canRewind() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to check rewind');
  }
});

// Fase 2: Intervene — прервать применение оставшихся событий пачки
router.post('/:id/intervene', async (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, interveneSchema, req.body)) return;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const simulationId = req.body?.simulationId || req.body?.simulation_id;
    const eventId = req.body?.eventId || req.body?.event_id;
    const rawRevision = req.body?.revision;
    const revision = Number.isInteger(rawRevision) ? rawRevision : undefined;
    // §9.3/G22 «Intervieni qui»: chiusura affidabile del run fermo sul
    // preciso evento/revisione mostrato dal lettore, senza race di streaming.
    const pausedInfo = session.getPausedRunInfo();
    if (pausedInfo?.simulationId === simulationId && (!eventId || revision == null)) {
      res.status(409).json({
        error: 'Indica evento e revisione del checkpoint in lettura',
        code: 'checkpoint_anchor_required',
        simulationId,
      });
      return;
    }
    const pausedOutcome = await session.tryIntervenePausedRun(simulationId, eventId, revision);
    if (pausedOutcome) {
      res.json({
        ok: true,
        intervened: true,
        simulationId: pausedOutcome.simulationId,
        type: pausedOutcome.type,
        newDate: pausedOutcome.newDate,
        newTurn: pausedOutcome.newTurn,
        actions: pausedOutcome.actions,
        result: pausedOutcome.result,
      });
      return;
    }
    const result = session.requestIntervene(simulationId);
    if (!result.accepted) {
      res.status(409).json({ error: 'Nessuna simulazione compatibile in corso', code: 'simulation_not_running' });
      return;
    }
    res.json({ ok: true, simulationId: result.simulationId });
  } catch (e: any) {
    console.error('[INTERVENE] Error:', e);
    respondRouteError(res, e, 'Failed to intervene');
  }
});
}
