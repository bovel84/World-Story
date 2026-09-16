/**
 * World Story — Games: actions routes (Fase 5)
 * =========================================
 * Valutazione azioni, fattibilità e coda ordini.
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

export function registerActionsRoutes(router: Router): void {
router.post('/:id/actions/evaluate', (req, res) => {
  try {
    const game = gameRepository.findById(req.params.id);
    if (!game || !game.world) { res.status(404).json({ error: 'Game not found' }); return; }
    const templateId = (game.world as { template_id?: unknown }).template_id;
    if (typeof templateId !== 'string' || !templateId) { res.status(409).json({ error: 'Preflight non disponibile: mondo legacy senza catalog binding', code: 'catalog_binding_missing' }); return; }
    const normalized = normalizeOrderIntent(req.body?.intent);
    if (!normalized.ok) { res.status(422).json({ status: normalized.status, clarifications: normalized.clarifications, canonicalMutation: false }); return; }
    const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
    if (!loaded.catalog) { res.status(422).json({ error: 'Catalogo server non valido', report: loaded.report, canonicalMutation: false }); return; }
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const player = session.getPlayer();
    const polity = player?.polityId;
    const actor = loaded.catalog.actors.find(item => item.polityId === polity && item.type === 'treasury');
    if (!polity || !actor) { res.status(409).json({ error: 'Identità economica server non disponibile', code: 'actor_binding_missing' }); return; }
    const fence = session.fenceContext();
    const anchor = { gameId: req.params.id, branchId: fence.branchId, revision: fence.revision, queueVersion: session.getQueueVersion() };
    const assessment = new FeasibilityService(loaded.catalog).evaluate(normalized.intent, { actorId: actor.actorId, verifiedPolityId: polity, approvals: [], rights: [], knowledgeIds: [], capabilityIds: [] });
    const assessmentId = shortId();
    assessmentStore.put(assessmentId, anchor, assessment);
    res.json({ assessmentId, anchor, orders: [assessment], canonicalMutation: false });
  } catch (e) { respondRouteError(res, e, 'Failed to evaluate actions'); }
});


/**
 * Le partite create prima del catalogo autoritativo devono poter continuare a
 * registrare ordini. Il costo non è inventato dal modello né nascosto al
 * giocatore: lo stima il motore dal conto nazionale (OrderCost) e lo stesso
 * importo viene addebitato alla tesoreria quando l'ordine è eseguito.
 */
function respondLegacyFeasibility(res: any, session: any, text: string): void {
  let costs: any = { timeDays: 0, inputs: [], upkeep: [], basis: 'none' };
  let warnings = ['Partita legacy: la stima viene dal conto nazionale e sarà addebitata all\'esecuzione.'];
  try {
    const estimate = session.estimateOrderCost(text);
    costs = {
      timeDays: estimate.timeDays,
      inputs: [{
        resourceId: 'money',
        name: 'Tesoreria',
        quantity: estimate.amountMld.toFixed(2).replace('.', ','),
        unit: 'mld',
      }],
      upkeep: [],
      basis: 'request',
      note: estimate.basis,
      category: estimate.label,
    };
  } catch (error) {
    warnings = ['Partita legacy: stima del costo non disponibile, l\'ordine resta registrabile.'];
  }
  res.json({
    feasible: true,
    costs,
    prerequisites: [],
    risks: [],
    warnings,
    summary: 'Ordine registrabile (modalità legacy)',
  });
}

/** G4-B — verifica fattibilità da testo libero: sola lettura, non accoda.
 * La conversione intent e la valutazione avvengono interamente in sessione. */
router.post('/:id/actions/check-feasibility', async (req, res) => {
  try {
    const game = gameRepository.findById(req.params.id);
    if (!game || !game.world) { res.status(404).json({ error: 'Game not found' }); return; }
    const text = req.body?.text?.trim();
    if (!text) { res.status(400).json({ error: 'Testo ordine obbligatorio' }); return; }

    const templateId = (game.world as { template_id?: unknown }).template_id;
    if (typeof templateId !== 'string' || !templateId) {
      if (gameRepository.getEconomyMode(req.params.id) === 'legacy') {
        respondLegacyFeasibility(res, getSessionRegistry().getSessionOrThrow(req.params.id), text);
        return;
      }
      res.status(409).json({ error: 'Verifica non disponibile: catalog binding mancante', code: 'catalog_binding_missing' });
      return;
    }

    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
    if (!loaded.catalog) {
      if (gameRepository.getEconomyMode(req.params.id) === 'legacy') {
        respondLegacyFeasibility(res, getSessionRegistry().getSessionOrThrow(req.params.id), text);
        return;
      }
      res.status(422).json({ error: 'Catalogo server non valido', report: loaded.report });
      return;
    }
    // G4-B/G4-D: un solo percorso LLM → assessment + stima costi da catalogo.
    const { assessment, costs } = await session.checkFeasibilityWithCosts(text);

    // Proiezione per la UI: blocker → prerequisiti/rischi, warning invariati.
    const feasible = assessment.status === 'feasible' || assessment.status === 'feasible_with_conditions';
    const prerequisites: string[] = [];
    const risks: string[] = [];
    const warnings: string[] = [...assessment.warnings];
    for (const b of assessment.blockers) {
      if (b.code === 'KNOWLEDGE_MISSING') prerequisites.push(...(b.missing ?? [b.detail]));
      else if (b.code === 'INDUSTRIAL_CAPABILITY_MISSING' || b.code === 'UNAUTHORIZED_ACTOR') risks.push(b.detail);
      else warnings.push(b.detail);
    }
    for (const a of assessment.alternatives) {
      if (a.kind === 'research') prerequisites.push(...a.missing);
    }

    res.json({
      feasible,
      costs,
      prerequisites: [...new Set(prerequisites)],
      risks: [...new Set(risks)],
      warnings: [...new Set(warnings)],
      summary: feasible
        ? 'Ordine fattibile'
        : (assessment.status === 'needs_data' ? 'Servono dati mancanti' : 'Ordine bloccato'),
      rawAssessment: assessment,
    });
  } catch (e) { respondRouteError(res, e, 'Failed to check feasibility'); }
});

router.post('/:id/actions/queue', (req, res) => {
  const gameId = req.params.id;
  const { text } = req.body;

  if (!text) {
    res.status(400).json({ error: 'Action text is required' });
    return;
  }

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const action = session.queueAction(text);

    console.log('[QUEUE] Action added:', action.id);
    res.json({
      id: action.id,
      text: action.text,
      status: action.status,
      deliveryStatus: action.deliveryStatus,
      executionStatus: action.executionStatus,
      createdAt: action.createdAt,
      queueVersion: session.getQueueVersion(),
    });
  } catch (e: any) {
    console.error('[QUEUE] Error:', e);
    if (e.message.includes('not found')) {
      res.status(404).json({ error: e.message });
    } else {
      res.status(500).json({ error: 'Failed to queue action' });
    }
  }
});

router.get('/:id/actions/queue', (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const pendingActions = session.getPendingActions();

    res.json({ pendingActions, queueVersion: session.getQueueVersion() });
  } catch (e: any) {
    console.error('[QUEUE GET] Error:', e);
    if (e.message.includes('not found')) {
      res.status(404).json({ error: e.message });
    } else {
      res.status(500).json({ error: 'Failed to get pending actions' });
    }
  }
});

// La rimozione deve avvenire anche sul server: altrimenti l'ordine sparisce
// dal pannello ma viene comunque eseguito al salto temporale successivo.
router.delete('/:id/actions/queue/:actionId', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    if (!session.removePendingAction(req.params.actionId)) {
      res.status(409).json({ error: 'Azione non trovata o già in elaborazione' });
      return;
    }
    res.json({ removed: true, queueVersion: session.getQueueVersion() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to remove pending action');
  }
});

// Modifica di un ordine prima della presa in carico (G04 / §6.1). La modifica
// è persistita e non fa passare tempo; un ordine già emesso non è riscrivibile.
router.patch('/:id/actions/queue/:actionId', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Il nuovo testo dell’ordine è obbligatorio' });
      return;
    }
    const updated = session.updatePendingAction(req.params.actionId, text);
    if (!updated) {
      res.status(409).json({ error: 'Azione non trovata o già in elaborazione' });
      return;
    }
    res.json({ action: updated, queueVersion: session.getQueueVersion() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to update pending action');
  }
});

router.post('/:id/actions/process', async (req, res) => {
  const gameId = req.params.id;
  const { jump_days = 30 } = req.body;
  res.set('Deprecation', 'true');

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    // F05 µ3 (audit): questo percorso NON aggira il lotto/validator —
    // processNextAction passa da _processActionBatchUnlocked, la stessa
    // pipeline causale di process-all (validazione inclusa), con un lotto
    // di un solo ordine. Nessun bypass al di fuori del percorso job.
    const action = await session.processNextAction(jump_days);

    if (!action) {
      res.json({ message: 'No pending actions to process', action: null });
      return;
    }

    console.log('[PROCESS] Action processed:', action.id);
    res.json({
      id: action.id,
      text: action.text,
      status: action.status,
      result: action.result,
    });
  } catch (e: any) {
    console.error('[PROCESS] Error:', e);
    respondRouteError(res, e, 'Failed to process action');
  }
});

router.post('/:id/actions/process-all', async (req, res) => {
  const gameId = req.params.id;
  const { jump_days = 30 } = req.body;
  // F05 µ3: delega al percorso job — lo stesso worker e lo stesso lotto
  // causale; la risposta resta compatibile con la forma sincrona.
  res.set('Deprecation', 'true');

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const pausedInfo = session.getPausedRunInfo();
    if (pausedInfo) {
      res.status(409).json({ error: 'Un salto in pausa attende una decisione: Continua o Intervieni prima di avanzare di nuovo', code: 'simulation_paused', simulationId: pausedInfo.simulationId });
      return;
    }
    if (session.isSimulationInProgress()) {
      res.status(409).json({ error: 'A simulation is already in progress for this game', code: 'simulation_in_progress' });
      return;
    }
    const periodStart = session.getCurrentDate();
    const submitted = simulationJobService.submit(gameId, 'action_batch', { jump_days, periodStart }, undefined, { jump_days });
    const job = await simulationJobService.waitForJob(submitted.id);
    if (job.status !== 'completed') { respondJobFailure(res, job); return; }

    const processed = JSON.parse(job.result_json || '[]');
    // §9.3: il playback scaglionato non è un risultato «vuoto»: il run resta
    // in pausa sul checkpoint per-evento, in attesa di una decisione.
    if (!Array.isArray(processed)) {
      res.json(processed);
      return;
    }

    console.log('[PROCESS ALL] Actions processed:', processed.length);
    res.json({
      simulationId: processed.at(-1)?.result?.simulationId,
      processedCount: processed.length,
      actions: processed,
    });
  } catch (e: any) {
    console.error('[PROCESS ALL] Error:', e);
    respondRouteError(res, e, 'Failed to process actions');
  }
});
}
