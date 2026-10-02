/**
 * World Story — Games: actions routes (Fase 5)
 * =========================================
 * Valutazione azioni, fattibilità e coda ordini.
 */
import { Router } from 'express';
import { shortId } from '../../utils/short-id';
import { gameRepository } from '../../repositories';
import { ActionSignatureConflictError } from '../../repositories/game.repository';
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
import { measureDeficits } from '../../core/feasibility/Availability';
import { resolveWorkHolders } from '../../game/WorkHolders';
import { strictReadingsFor } from '../../game/PreflightReadings';
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
import { evaluateActionSchema, queueActionSchema, actionTextSchema, processActionSchema } from './schemas';

export function registerActionsRoutes(router: Router): void {
router.post('/:id/actions/evaluate', (req, res) => {
  if (!validateBody(res, evaluateActionSchema, req.body)) return;
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
    // MG01 µ3 / MG02 µ1: le letture e i deficit si calcolano in un punto solo
    // (`strictReadingsFor`), così le due rotte di preflight giudicano allo
    // stesso modo invece di doverlo mantenere a mano in due posti. Là dentro
    // c'è anche la ragione per cui un ramo non inizializzato non si legge.
    const measured = strictReadingsFor({
      economyMode: gameRepository.getEconomyMode(req.params.id),
      branchId: fence.branchId,
      actorId: actor.actorId,
      catalog: loaded.catalog,
      intent: normalized.intent,
    });
    const assessment = new FeasibilityService(loaded.catalog).evaluate(normalized.intent, {
      // MG02 µ1: il consenso dell'AUTORE dell'ordine è dichiarato dal server,
      // non presunto. `'user'` significa «questo ordine è una decisione del
      // giocatore», non «l'utente ha cliccato un pulsante»: la richiesta di
      // valutazione È quella decisione. Gli altri due consensi restano vuoti:
      // appartengono a un'autorità istituzionale e a una controparte che il
      // server non ha ancora interpellato, e nessuno dei due si presume.
      actorId: actor.actorId, verifiedPolityId: polity, approvals: ['user'], rights: [], knowledgeIds: [], capabilityIds: [],
      ...(measured ? { deficits: measured.deficits, unknownRequirements: measured.unknown, ...(measured.availableMoney ? { availableMoney: measured.availableMoney } : {}) } : {}),
    });
    const assessmentId = shortId();
    assessmentStore.put(assessmentId, anchor, assessment);
    // MG02 µ6 — Per una costruzione il client deve poter dichiarare l'opera, e
    // i detentori sono un fatto dello stato economico: li risolve il SERVER e
    // li restituisce insieme alla valutazione. Il client li rimanda indietro
    // tali e quali; se li alterasse, il commit li rifiuterebbe.
    const workDeclaration = (() => {
      if (normalized.intent.actionKind !== 'construct') return undefined;
      const work = loaded.catalog!.works?.find(item => item.id === normalized.intent.catalogRef);
      if (!work) return undefined;
      const holders = resolveWorkHolders(loaded.catalog!, fence.branchId, polity, work);
      return {
        workId: work.id,
        payerActorId: holders.payerActorId,
        materialActorId: holders.materialActorId,
        // L'opera è finanziabile quando c'è un detentore per i materiali e la
        // valutazione non ha prodotto deficit: due condizioni, entrambe vere.
        funded: holders.materialActorId !== null && !(measured?.deficits.length),
        missingMaterials: holders.missingMaterials,
        ...(holders.note ? { note: holders.note } : {}),
      };
    })();
    res.json({ assessmentId, anchor, orders: [assessment], workDeclaration, canonicalMutation: false });
  } catch (e) { respondRouteError(res, e, 'Failed to evaluate actions'); }
});

/** G4-B — verifica fattibilità da testo libero: sola lettura, non accoda.
 * La conversione intent e la valutazione avvengono interamente in sessione. */
router.post('/:id/actions/check-feasibility', async (req, res) => {
  if (!validateBody(res, actionTextSchema, req.body)) return;
  try {
    const game = gameRepository.findById(req.params.id);
    if (!game || !game.world) { res.status(404).json({ error: 'Game not found' }); return; }
    const text = req.body?.text?.trim();
    if (!text) { res.status(400).json({ error: 'Testo ordine obbligatorio' }); return; }

    const session = getSessionRegistry().getSessionOrThrow(req.params.id);

    // G4-B — L'economy_mode è la fonte della distinzione, non la presenza di
    // `simulation/`: preset legacy come millennium_dawn espongono comunque un
    // catalogo parziale, e instradarli nello strict faceva fallire la verifica
    // (polity fuori catalogo) invece di usarne la stima dal conto nazionale.
    if (gameRepository.getEconomyMode(req.params.id) === 'legacy') {
      respondLegacyFeasibility(res, session, text);
      return;
    }

    const templateId = (game.world as { template_id?: unknown }).template_id;
    if (typeof templateId !== 'string' || !templateId) {
      res.status(409).json({ error: 'Verifica non disponibile: catalog binding mancante', code: 'catalog_binding_missing' });
      return;
    }

    const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
    if (!loaded.catalog) {
      res.status(422).json({ error: 'Catalogo server non valido', report: loaded.report });
      return;
    }
    // G4-B/G4-D: assessment + stima costi da catalogo, in sola lettura
    // (WS-PREFLIGHT-01: nessun LLM nel preflight).
    const { assessment, costs, workDeclaration } = await session.checkFeasibilityWithCosts(text);

    // Proiezione per la UI: blocker → prerequisiti/rischi, warning invariati.
    // MG01 µ3: i deficit (cassa, materiali, manodopera) sono RISCHI, non
    // warning: sono la ragione per cui l'ordine non parte, e la UI deve
    // mostrarli con lo stesso peso dei vincoli di capacità. I prerequisiti
    // restano le conoscenze mancanti, che si procurano con la ricerca.
    const feasible = assessment.status === 'feasible' || assessment.status === 'feasible_with_conditions';
    const prerequisites: string[] = [];
    const risks: string[] = [];
    const warnings: string[] = [...assessment.warnings];
    for (const b of assessment.blockers) {
      if (b.code === 'KNOWLEDGE_MISSING') prerequisites.push(...(b.missing ?? [b.detail]));
      else if (
        b.code === 'INDUSTRIAL_CAPABILITY_MISSING' || b.code === 'UNAUTHORIZED_ACTOR'
        || b.code === 'INSUFFICIENT_CASH' || b.code === 'MATERIAL_SHORTAGE' || b.code === 'WORKFORCE_SHORTAGE'
      ) risks.push(b.detail);
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
      // WS-GOV-COUNCIL-HARDENING — I deficit misurati (cassa/materiali/
      // manodopera) con i tre numeri autorevoli: required/available/missing,
      // il detentore e la fase. Il client li mostra nella Tavola del Tesoro
      // senza ricalcolare nulla; `funded` e questa lista vengono dallo stesso
      // `measureDeficits`, quindi non possono contraddirsi.
      deficits: assessment.deficits ?? [],
      // WS-GOV-COUNCIL-HARDENING — la disponibilità monetaria netta misurata
      // (anche quando copre): la Tavola del Tesoro mostra questa, non il conto
      // nazionale. Stessa fonte di `deficits` e `funded`.
      availability: { money: assessment.availableMoney ?? [] },
      // MG02 µ6 — La dichiarazione d'opera con i detentori risolti dal server:
      // il client la rimanda nella coda. È questo che rende ordinabile una
      // costruzione dal gioco, invece che solo dalle rotte.
      ...(workDeclaration ? { workDeclaration } : {}),
    });
  } catch (e) { respondRouteError(res, e, 'Failed to check feasibility'); }
});

router.post('/:id/actions/queue', (req, res) => {
  const gameId = req.params.id;
  const parsed = validateBody(res, queueActionSchema, req.body);
  if (!parsed) return;
  const rawKey = req.headers?.['idempotency-key'];
  const requestKey = typeof rawKey === 'string' ? rawKey.trim() : undefined;
  if (rawKey !== undefined && (!requestKey || requestKey.length > 128)) {
    res.status(400).json({ error: 'Chiave di firma non valida', code: 'invalid_idempotency_key' });
    return;
  }
  // Solo le firme normalizzate: i client legacy mantengono il contratto.
  const { text, work } = requestKey ? parsed : req.body;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    // L'opera dichiarata viaggia con l'ordine: il testo resta la descrizione
    // per il giocatore, la distinta arriva dal catalogo al momento del commit.
    const accept = () => {
      const action = session.queueAction(text, work);
      return {
        id: action.id, text: action.text, status: action.status,
        deliveryStatus: action.deliveryStatus, executionStatus: action.executionStatus,
        createdAt: action.createdAt, queueVersion: session.getQueueVersion(),
      };
    };
    if (!requestKey) { res.json(accept()); return; }
    // enqueue modifica la coda RAM prima del DB: snapshot/ripristino anche se
    // fallisce il COMMIT esterno. Nessuna modifica al GameSession congelato P5.
    const queue = session.getPendingActions();
    const previous = queue.slice();
    let receipt;
    try {
      receipt = gameRepository.acceptActionSignature(gameId, requestKey, { text, ...(work ? { work } : {}) }, accept);
    } catch (error) {
      queue.splice(0, queue.length, ...previous);
      throw error;
    }
    res.json(receipt);
  } catch (e: any) {
    if (e instanceof ActionSignatureConflictError) {
      res.status(409).json({ error: e.message, code: 'idempotency_conflict' });
      return;
    }
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
  if (!validateBody(res, processActionSchema, req.body)) return;
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
  if (!validateBody(res, processActionSchema, req.body)) return;
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
