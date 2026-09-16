/**
 * World Story — Games: save routes (Fase 5)
 * =========================================
 * Salvataggio partita.
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
import { saveSchema } from './schemas';

export function registerSaveRoutes(router: Router): void {
router.post('/:id/save', (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, saveSchema, req.body)) return;
  const { name } = req.body;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    if (session.isSimulationInProgress()) {
      res.status(409).json({ error: 'Simulazione in corso: salva dopo il checkpoint', code: 'simulation_in_progress' });
      return;
    }
    const { saveId, currentTurn, currentDate } = session.save(name);

    console.log('[SAVE] Game saved:', saveId, 'turn:', currentTurn);
    res.json({ save_id: saveId, currentTurn, currentDate });
  } catch (e) {
    console.error('[SAVE] Error:', e);
    res.status(404).json({ error: 'Game not found' });
  }
});
}
