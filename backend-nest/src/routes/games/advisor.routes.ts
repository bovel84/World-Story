/**
 * World Story — Games: advisor routes (Fase 5)
 * =========================================
 * Azione, eventi, consulente (anche in streaming), suggerimenti, relazioni e timeline.
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
import { LLMError, LLMContractError } from '../../llm';
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
import { actionTextSchema, advisorSchema } from './schemas';

export function registerAdvisorRoutes(router: Router): void {
router.post('/:id/action', async (req, res) => {
  if (!validateBody(res, actionTextSchema, req.body)) return;
  console.log('[API] POST /api/games/:id/action called');
  const text = req.body.text;
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Il testo dell’ordine è obbligatorio' });
      return;
    }
    // Registrare un ordine non autorizza il passaggio del tempo. Tutti i
    // comandi, inclusi quelli arrivati in rapida successione, restano nella
    // coda finché il giocatore non sceglie esplicitamente un time-skip.
    const action = session.queueAction(text.trim());
    res.status(201).json({ action });
  } catch (e: any) {
    console.error('[POST /api/games/:id/action] Error:', e);
    respondRouteError(res, e, 'Failed to process turn');
  }
});

// G24 — «Migliora formulazione»: anteprima riformulata di un ordine libero.
// Non accoda, non simula e non fa passare tempo: l'accettazione resta un
// click esplicito del giocatore sul testo proposto.
router.post('/:id/actions/enhance', async (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, actionTextSchema, req.body)) return;
  const text = req.body?.text;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Il testo dell’ordine è obbligatorio' });
      return;
    }
    const result = await session.enhanceAction(text);
    res.json(result);
  } catch (e: any) {
    console.error('[ENHANCE] Error:', e);
    respondRouteError(res, e, 'Failed to enhance action');
  }
});

// SSE endpoint for real-time game updates
router.get('/:id/events', (req, res) => {
  const gameId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`event: connected\ndata: {"gameId":"${gameId}"}\n\n`);

  const clientId = shortId();
  addSSEClient(gameId, { id: clientId, response: res });

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    session.setSSEBroadcaster((type, data) => {
      if (!hasClients(gameId)) return false;
      broadcastToGame(gameId, type, data);
      return true;
    });
    // F02 passo 3: un client che si (ri)connette riceve subito gli eventi
    // committati mentre era assente: il pubblicatore è ripetibile e gli ID
    // stabili permettono la deduplica lato client.
    session.publishPendingOutbox();
    // L'SSE trasporta aggiornamenti, ma non avvia alcun avanzamento del tempo.
    // Il calendario si muove solo con un comando esplicito del giocatore.
  } catch (e) {
    console.warn('[SSE] Game session not found:', gameId);
  }

  const pingInterval = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(pingInterval);
    removeSSEClient(gameId, clientId);
    // Non c'è nessun tick automatico da lasciare in esecuzione.
  });
});

// Il calendario è esclusivamente manuale. Conserviamo la route soltanto per
// rendere esplicita l'incompatibilità ai client vecchi, senza riattivare timer.
router.post('/:id/live-sim', (_req, res) => {
  res.status(410).json({
    error: 'La simulazione live è stata rimossa: usa il salto temporale manuale.',
    code: 'manual_time_only',
  });
});

router.get('/:id/advisor', async (req, res) => {
  const { playerId, message } = req.query;
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const advice = await session.getAdvisor(message as string || '', []);
    res.json({ tips: [advice] });
  } catch (e: any) {
    console.error('[Advisor] Error:', e);
    // F04 passo 3: durante un run l'advisor risponde 409 (politica esplicita);
    // LLMError → 424, gioco sconosciuto → 404, resto → 500.
    respondRouteError(res, e, 'Failed to get advisor reply');
  }
});

// Этап 3: живой Советник — многоходовой диалог (message + history в теле)
router.post('/:id/advisor', async (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, advisorSchema, req.body)) return;
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const history = normalizeAdvisorHistory(req.body?.history);

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const reply = await session.getAdvisor(message, history);
    res.json({ reply });
  } catch (e: any) {
    console.error('[Advisor POST] Error:', e);
    respondRouteError(res, e, 'Failed to get advisor reply');
  }
});

// Этап 3: стриминг ответа Советника (text/plain; токены пишем по мере поступления)
router.post('/:id/advisor/stream', async (req, res) => {
  const gameId = req.params.id;
  if (!validateBody(res, advisorSchema, req.body)) return;
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const history = normalizeAdvisorHistory(req.body?.history);

  // Заголовки стрима: setHeader сам по себе ответ НЕ коммитит —
  // до первого res.write ещё можно ответить обычной JSON-ошибкой (404/502).
  // Content-Length не ставим — Node сам включит Transfer-Encoding: chunked.
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // Не буферизовать ответ на прокси (nginx и подобных)
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);

    let gotTextChunks = false;
    const onToken = (chunk: unknown) => {
      // Строковый токен — пишем сразу. Число (charsSoFar — конвенция
      // LLMRouter.stream) несёт только прогресс без текста: полный текст
      // тогда дописываем в конце одним куском.
      if (typeof chunk === 'string' && chunk.length > 0) {
        gotTextChunks = true;
        res.write(chunk);
      }
    };

    // GameSession.getAdvisorStream (Этап 3); защитный fallback на
    // нестриминговый ответ — для старых сессий в памяти после хот-релоада.
    const streamFn = (session as any).getAdvisorStream;
    const reply: string = typeof streamFn === 'function'
      ? await streamFn.call(session, message, history, onToken)
      : await session.getAdvisor(message, history);

    if (!gotTextChunks && reply) {
      res.write(reply);
    }
    res.end();
  } catch (e: any) {
    console.error('[Advisor STREAM] Error:', e);
    if (res.headersSent) {
      // Поток уже начат — статус не поменять, просто обрываем ответ
      res.end();
    } else {
      respondRouteError(res, e, 'Failed to stream advisor reply');
    }
  }
});

router.get('/:id/suggestions', async (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const suggestions = await session.getSuggestions();
    res.json({ suggestions });
  } catch (e: any) {
    console.error('[Suggestions] Error:', e);
    if (e instanceof LLMError) {
      res.status(424).json({ error: `LLM (${e.provider}): ${e.message}` });
    } else if (e instanceof LLMContractError) {
      res.status(424).json({ error: e.message, code: 'llm_contract_error', mechanic: e.mechanic });
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  }
});

router.get('/:id/relationships', (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    // Le relazioni sono per codice polity: il client riceve anche i **nomi**
    // pubblici, così non deve indovinarli dal nome della provincia capitale
    // (era il difetto: «ITA» mostrato come «Aosta»).
    res.json({ relationships: session.getRelationships(), names: session.getRelationshipNames() });
  } catch (e) {
    console.error('[Relationships] Error:', e);
    res.status(404).json({ error: 'Game not found' });
  }
});

// Timeline del mondo: cronaca turno per turno (eventi + data di gioco).
// §10.1: `GET /timeline?after=<turno>&limit=<N>` pagina il registro persistente,
// così la cronaca non è limitata agli ultimi N elementi né ai turni in RAM.
router.get('/:id/timeline', (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const rawAfter = req.query.after;
    const rawLimit = req.query.limit;
    const after = typeof rawAfter === 'string' && rawAfter !== '' ? parseInt(rawAfter, 10) : 0;
    const limit = typeof rawLimit === 'string' && rawLimit !== '' ? parseInt(rawLimit, 10) : 50;
    const page = session.getTimelinePage(Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 50);
    res.json({
      timeline: page.timeline,
      currentDate: session.getCurrentDate(),
      hasMore: page.hasMore,
      nextAfter: page.nextAfter,
    });
  } catch (e) {
    console.error('[Timeline] Error:', e);
    res.status(404).json({ error: 'Game not found' });
  }
});
}
