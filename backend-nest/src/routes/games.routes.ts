/**
 * World Story — Games Routes
 * ======================
 */

import { Router } from 'express';
import { shortId } from '../utils/short-id';
import { gameRepository } from '../repositories';
import { countryRepository } from '../repositories/country.repository';
import { getSessionRegistry } from '../session-registry';
import { SimulationInProgressError, SimulationPausedError, SimulationStaleCheckpointError, GameOverError, type TurnResultRecord, type PausedBatchResult } from '../game-session';
import { IdempotencyConflictError, simulationJobService } from '../jobs/SimulationJobService';
import { addDays, jumpHorizon } from '../core/simulation/calendar';
import { addSSEClient, removeSSEClient, broadcastToGame, hasClients } from '../sse';
import { LLMError } from '../llm';
import path from 'path';
import { loadSimulationCatalog } from '../scenario/loader';
import type { SimulationCatalog } from '../scenario/types';
import { normalizeOrderIntent } from '../core/feasibility/intent';
import { FeasibilityService } from '../core/feasibility/FeasibilityService';
import { AssessmentStore } from '../core/feasibility/AssessmentStore';
import { createCashflow, FinanceError } from '../services/FinanceService';
import { createReservation, InsufficientAvailabilityError, ReservationError } from '../services/ReservationService';
import { ledgerUnitId, bootstrapCatalogEconomy } from '../services/StrictEffectProducerService';
import { executeMandateEconomy } from '../services/MandateEconomyService';
import { createMandateRecord, getMandateRemaining, MandateConflictError } from '../services/MandateService';
import { MandateError } from '../core/mandates/MandateEngine';
import { MandateDecisionError, acknowledgeMandateDecision, cancelMandateAndResolveDecisions, listOpenMandateDecisions } from '../services/MandateDecisionService';
import { parseInteger } from '../domain/quantities';

export const gamesRouter = Router();
const assessmentStore = new AssessmentStore<unknown>();

/**
 * Единый обработчик ошибок игровых эндпоинтов:
 * LLMError → 424 с понятным сообщением (провайдер/причина),
 * "not found" → 404, всё остальное → 500.
 */
/** Errori di dominio deterministici: 400 con codice leggibile per la UI. */
const TRADE_ERROR_CODES = [
  'unknown_resource', 'resource_not_held', 'insufficient_stockpile',
  'insufficient_money', 'quantity_invalid', 'trade_mode_invalid', 'trade_unavailable',
];
const PROCURE_ERROR_CODES = [
  'equipment_unknown', 'equipment_quantity_invalid', 'build_unavailable', 'buy_unavailable', 'procurement_mode_invalid', 'credit_exhausted',
];
const DEBT_ERROR_CODES = ['amount_invalid', 'credit_exhausted'];
function respondDomainError(res: any, e: any, codes: string[], fallback: string): void {
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = codes.find(candidate => message.includes(candidate));
  if (code) {
    res.status(400).json({ error: message || code, code });
    return;
  }
  respondRouteError(res, e, fallback);
}

function respondRouteError(res: any, e: any, fallback: string): void {
  if (e instanceof LLMError) {
    // I Quick Tunnel sostituiscono i 502 JSON con una pagina HTML generica.
    // 424 conserva il dettaglio del provider per la UI.
    res.status(424).json({ error: `LLM (${e.provider}): ${e.message}` });
  } else if (e instanceof SimulationInProgressError) {
    res.status(409).json({ error: e.message, code: 'simulation_in_progress' });
  } else if (typeof e?.message === 'string' && e.message.includes('snapshot_hash_mismatch')) {
    // F04 §9.4.1: snapshot manomesso o incompatibile — il restore è rifiutato
    // esplicitamente (errore tecnico, mai applicato parzialmente).
    res.status(422).json({ error: e.message, code: 'snapshot_hash_mismatch' });
  } else if (e instanceof SimulationPausedError) {
    // §9.3: un playback in pausa attende una decisione; un nuovo salto è un
    // conflitto esplicito, non un fallimento silenzioso.
    res.status(409).json({ error: e.message, code: 'simulation_paused', simulationId: e.runId });
  } else if (e instanceof SimulationStaleCheckpointError) {
    // G22: il lettore ha cambiato pagina/checkpoint: il vecchio controllo
    // non può interrompere il run successivo.
    res.status(409).json({ error: e.message, code: 'stale_checkpoint', simulationId: e.runId });
  } else if (e instanceof GameOverError) {
    // La nazione è caduta: nessuna azione è più possibile, solo l'epilogo.
    res.status(409).json({ error: e.message, code: 'game_over', ending: e.ending });
  } else if (typeof e?.message === 'string' && e.message.includes('not found')) {
    res.status(404).json({ error: e.message });
  } else {
    res.status(500).json({ error: fallback });
  }
}

/**
 * Нормализация истории диалога с Советником из тела запроса:
 * принимаем только сообщения вида { role: 'user'|'assistant', content: string }.
 */
function normalizeAdvisorHistory(raw: any): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
}

gamesRouter.post('/', (req, res) => {
  const worldId = req.body.worldId || req.body.world_id;
  const playerName = req.body.playerName || req.body.player_name;
  const playerRegionId = req.body.playerRegionId || req.body.player_region_id;

  try {
    const { session, playerId, gameId } = getSessionRegistry().createSession(
      worldId,
      playerName || '',
      playerRegionId,
      req.body.playerColor || req.body.player_color || '#FF0000',
      req.body.difficulty
    );

    const player = session.getPlayer();
    const region = session.getRegion(playerRegionId);

    res.json({
      game_id: gameId,
      player_id: playerId,
      player_polity_id: player?.polityId,
      region: { id: region?.id, name: region?.name },
    });
  } catch (e: any) {
    if (e.message === 'World not found') {
      res.status(404).json({ error: 'World not found' });
    } else if (e.message === 'Region not found') {
      res.status(404).json({ error: 'Region not found' });
    } else {
      console.error('[POST /api/games] Error:', e);
      res.status(500).json({ error: 'Failed to create game' });
    }
  }
});

gamesRouter.get('/:id', (req, res) => {
  // Leggere o riaprire una partita non deve mai far scorrere il calendario.
  const game = gameRepository.findById(req.params.id);
  if (!game) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }

  const dynamicRegions = new Map(gameRepository.getGameRegions(game.id).map(region => [region.id, region]));
  const gameRegions = game.world.regions.map((region: any) => ({
    ...region,
    ...(dynamicRegions.get(region.id) || {}),
  }));
  const ownerRegionCounts = new Map<string, number>();
  for (const region of gameRegions) {
    ownerRegionCounts.set(region.owner, (ownerRegionCounts.get(region.owner) || 0) + 1);
  }

  // §9.3: il client riconcilia anche il playback scaglionato dopo refresh o
  // riconnessione — non soltanto via SSE.
  let pausedSimulation: any = null;
  try {
    const session = getSessionRegistry().getSession(game.id);
    pausedSimulation = session?.getPausedRunInfo?.() || null;
  } catch { /* sessione non in memoria: nessun playback attivo */ }

  res.json({
    id: game.id,
    currentTurn: game.current_turn,
    currentDate: game.current_date,
    maxTurns: game.max_turns,
    status: game.status,
    queueVersion: Number(game.queue_version || 0),
    // F06 µ2: ramo e revisione canonica per la riconciliazione del client.
    headBranchId: (game as any).head_branch_id ?? null,
    worldRevision: Number((game as any).world_revision || 0),
    pausedSimulation,
    world: {
      id: game.world.id,
      name: game.world.name,
      regions: gameRegions.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        owner: r.owner,
        population: r.population,
        gdp: r.gdp,
        militaryPower: r.militaryPower,
        geojson: r.geojson,
        flag: r.flag,
        // Nei mondi provinciali r.name è la provincia: usa il nome nazionale.
        // Nei mondi normali conserva il nome curato dallo scenario.
        polityName: (ownerRegionCounts.get(r.owner) || 0) > 1
          ? (countryRepository.findByCode(r.owner)?.name || r.owner)
          : r.name,
        // Маркеры карты (столица/города/постройки): без них после перезагрузки
        // или возобновления сохранения города на карте не отрисовываются
        objects: r.objects ?? [],
        borders: r.borders ?? [],
        status: r.status ?? 'active',
        metadata: r.metadata ?? {},
      })),
    },
    players: game.players.map((p: any) => ({
      id: p.id,
      regionId: p.regionId,
      polityId: p.polityId,
    })),
  });
});

// Dati nazionali aggregati: la UI e i prompt leggono la stessa fonte
// provinciale, invece di stimare PIL/bilancio nel browser.
gamesRouter.get('/:id/ongoing-processes', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    // L'avanzamento arriva sempre valorizzato: la sessione lo ricalcola dalle
    // date per i progetti creati prima che il motore lo persistesse.
    res.json({ processes: session.getOngoingProcesses(), completed: session.getCompletedProcesses() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get ongoing processes');
  }
});

gamesRouter.get('/:id/national-state', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({
      accounts: session.getNationalAccounts(),
      history: session.getNationalHistory(),
      resources: session.getResources(),
      // Anime del governo + dettaglio del bilancio: il Dossier Nazione legge
      // voci e pressioni calcolate dal motore, mai stimate nel browser.
      government: session.getGovernment(),
      // Politica fiscale scelta dal giocatore (aliquota, limiti, effetti).
      fiscalPolicy: session.getFiscalPolicy(),
      // Crisi nazionale: rischi di collasso ed eventuale epilogo.
      crisis: session.getCrisis(),
    });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get national state');
  }
});

// Anime del governo: voci generate dall'LLM sulle fazioni calcolate dal motore.
// On-demand (come il consigliere) e valide per il turno corrente.
gamesRouter.get('/:id/government/voices', async (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const voices = await session.getGovernmentVoices();
    res.json(voices);
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get government voices');
  }
});

// Magazzino materiale: cibo, vestiario, armamenti, carburante, denaro,
// ricerca e tecnologie sbloccate del paese giocatore.
gamesRouter.get('/:id/resources', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getResources());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get resources');
  }
});

// Arsenale militare, risorse naturali reali e catalogo con fattibilità.
gamesRouter.get('/:id/arsenal', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getArsenal());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get arsenal');
  }
});

// Ordini di produzione militare con percentuale di completamento.
gamesRouter.get('/:id/production', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getProduction());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get production orders');
  }
});

// Costruzione o acquisto di equipaggiamento (usa e getta: nessuna coda).
gamesRouter.post('/:id/arsenal/:mode(build|buy)', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const equipmentId = String(req.body?.equipmentId || '');
    const quantity = Number(req.body?.quantity ?? 1);
    if (!equipmentId) {
      res.status(400).json({ error: 'equipmentId è obbligatorio' });
      return;
    }
    res.json(session.procureEquipment(req.params.mode as 'build' | 'buy', equipmentId, quantity));
  } catch (e: any) {
    respondDomainError(res, e, PROCURE_ERROR_CODES, 'Failed to procure equipment');
  }
});

// Compravendita di risorse naturali sul mercato mondiale (denaro ↔ magazzino).
gamesRouter.post('/:id/resources/trade', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const mode = String(req.body?.mode || '');
    const resourceId = String(req.body?.resourceId || '');
    const quantity = Number(req.body?.quantity ?? 0);
    if (mode !== 'sell' && mode !== 'buy') {
      res.status(400).json({ error: 'mode deve essere "sell" o "buy"' });
      return;
    }
    if (!resourceId) {
      res.status(400).json({ error: 'resourceId è obbligatorio' });
      return;
    }
    res.json(session.tradeResource(mode, resourceId, quantity));
  } catch (e: any) {
    respondDomainError(res, e, TRADE_ERROR_CODES, 'Failed to trade resource');
  }
});

// La nazione fa debito: emette titoli per incassare cassa oggi, con interessi
// e scadenza. Il tetto di credito e il tasso di mercato li fissa il motore.
gamesRouter.post('/:id/finance/borrow', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const amountMld = Number(req.body?.amountMld ?? 0);
    const termYears = Number(req.body?.termYears ?? 10);
    if (!Number.isFinite(amountMld) || amountMld <= 0) {
      res.status(400).json({ error: 'amountMld deve essere un numero positivo' });
      return;
    }
    res.json(session.borrowSovereignDebt(amountMld, termYears));
  } catch (e: any) {
    respondDomainError(res, e, DEBT_ERROR_CODES, 'Failed to issue sovereign debt');
  }
});

// Politica fiscale: il giocatore sceglie l'aliquota (% del PIL). Il motore
// ricalcola entrate, saldo, stabilità, tensione e crescita di conseguenza.
gamesRouter.get('/:id/fiscal-policy', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ policy: session.getFiscalPolicy() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read fiscal policy');
  }
});

gamesRouter.put('/:id/fiscal-policy', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const taxRatePct = Number(req.body?.taxRatePct);
    if (!Number.isFinite(taxRatePct)) {
      res.status(400).json({ error: 'taxRatePct deve essere un numero' });
      return;
    }
    const result = session.setFiscalPolicy(taxRatePct);
    res.json({
      policy: result.policy,
      note: result.note,
      account: session.getNationalAccounts()[session.getPlayerPolityId()],
    });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to set fiscal policy');
  }
});

// Sfide di pace: interne ed esterne, generate dal motore dagli indicatori.
gamesRouter.get('/:id/pressures', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getPeacetimePressures());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read peacetime pressures');
  }
});

// Il giocatore risponde a una sfida: modificatori, cassa e relazioni. La
// scelta è idempotente (una sfida chiusa non produce un secondo effetto).
gamesRouter.post('/:id/pressures/:pressureId/resolve', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const optionId = String(req.body?.optionId || '');
    if (!optionId) {
      res.status(400).json({ error: 'optionId è obbligatorio' });
      return;
    }
    res.json(session.resolvePeacetimePressure(req.params.pressureId, optionId));
  } catch (e: any) {
    const message = String(e?.message || '');
    if (message.includes('insufficient_funds')) {
      res.status(400).json({ error: 'Cassa insufficiente per questa scelta.' });
      return;
    }
    if (message.includes('pressure_')) {
      res.status(409).json({ error: 'Questa sfida non è più aperta.' });
      return;
    }
    respondRouteError(res, e, 'Failed to resolve peacetime pressure');
  }
});

// Crisi nazionale: rischi di rivolta, default e invasione, con l'epilogo se
// la partita è già finita. Sola lettura.
gamesRouter.get('/:id/crisis', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getCrisis());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read national crisis');
  }
});

gamesRouter.post('/:id/action', async (req, res) => {
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
gamesRouter.post('/:id/actions/enhance', async (req, res) => {
  const gameId = req.params.id;
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
gamesRouter.get('/:id/events', (req, res) => {
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
gamesRouter.post('/:id/live-sim', (_req, res) => {
  res.status(410).json({
    error: 'La simulazione live è stata rimossa: usa il salto temporale manuale.',
    code: 'manual_time_only',
  });
});

gamesRouter.get('/:id/advisor', async (req, res) => {
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
gamesRouter.post('/:id/advisor', async (req, res) => {
  const gameId = req.params.id;
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
gamesRouter.post('/:id/advisor/stream', async (req, res) => {
  const gameId = req.params.id;
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

gamesRouter.get('/:id/suggestions', async (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const suggestions = await session.getSuggestions();
    res.json({ suggestions });
  } catch (e: any) {
    console.error('[Suggestions] Error:', e);
    if (e instanceof LLMError) {
      res.status(424).json({ error: `LLM (${e.provider}): ${e.message}` });
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  }
});

gamesRouter.get('/:id/relationships', (req, res) => {
  const gameId = req.params.id;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    res.json(session.getRelationships());
  } catch (e) {
    console.error('[Relationships] Error:', e);
    res.status(404).json({ error: 'Game not found' });
  }
});

// Timeline del mondo: cronaca turno per turno (eventi + data di gioco).
// §10.1: `GET /timeline?after=<turno>&limit=<N>` pagina il registro persistente,
// così la cronaca non è limitata agli ultimi N elementi né ai turni in RAM.
gamesRouter.get('/:id/timeline', (req, res) => {
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

gamesRouter.post('/:id/save', (req, res) => {
  const gameId = req.params.id;
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

/** M06 µ6a (B1): producer gameplay — binding server di attore/valuta/ramo.
 *  Il client fornisce solo l'obbligo (creditore, importo, data): il debitore è
 *  SEMPRE il tesoro bound alla polity del giocatore, mai un campo client. */
type EconomyBinding = { session: { getPlayer: () => { polityId?: string } | undefined }; branchId: string; actorId: string; currencyId: string; catalog: SimulationCatalog };
function bindStrictEconomy(gameId: string, bootstrap = true): EconomyBinding | { error: { status: number; payload: Record<string, unknown> } } {
  if (gameRepository.getEconomyMode(gameId) !== 'strict') {
    return { error: { status: 409, payload: { error: 'Percorso economico disponibile solo in strict', code: 'economy_mode_legacy' } } };
  }
  const game = gameRepository.findById(gameId);
  const templateId = (game?.world as { template_id?: unknown } | undefined)?.template_id;
  if (typeof templateId !== 'string' || !templateId) {
    return { error: { status: 409, payload: { error: 'Binding catalogo mancante', code: 'catalog_binding_missing' } } };
  }
  const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
  if (!loaded.catalog) {
    return { error: { status: 422, payload: { error: 'Catalogo server non valido', code: 'catalog_invalid' } } };
  }
  const session = getSessionRegistry().getSessionOrThrow(gameId);
  const player = session.getPlayer();
  const actor = loaded.catalog.actors.find(item => item.polityId === player?.polityId && item.type === 'treasury');
  if (!actor) {
    return { error: { status: 409, payload: { error: 'Identità economica server non disponibile', code: 'actor_binding_missing' } } };
  }
  const treasury = loaded.catalog.initialState.treasuries.find(item => item.actorId === actor.actorId);
  if (!treasury) {
    return { error: { status: 409, payload: { error: 'Conto tesoreria assente dal catalogo', code: 'treasury_binding_missing' } } };
  }
  const branchId = gameRepository.getHeadBranch(gameId);
  if (!branchId) {
    return { error: { status: 409, payload: { error: 'Ramo canonico mancante', code: 'branch_missing' } } };
  }
  // Bootstrap idempotente: le disponibilità esistono già alla prima command.
  // I GET restano read-only (`bootstrap=false`), senza mutazioni nascoste.
  if (bootstrap) bootstrapCatalogEconomy(gameId, branchId, loaded.catalog);
  return { session, branchId, actorId: actor.actorId, currencyId: ledgerUnitId(treasury.currencyId), catalog: loaded.catalog };
}

function respondEconomyError(res: any, e: unknown): void {
  if (e instanceof FinanceError || e instanceof ReservationError || e instanceof InsufficientAvailabilityError) {
    res.status(422).json({ error: e.message, code: (e as { code?: string }).code ?? 'economy_rejected', canonical: false });
    return;
  }
  respondRouteError(res, e, 'Failed to commit economy command');
}

/** M06 µ6a (B1): obblighi datati del governo → FinanceService; il tick strict
 *  li liquida con priorità legale dentro la transazione del checkpoint. */
gamesRouter.post('/:id/economy/cashflows', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { cashflowId, creditorRef, amount, dueDate, legalPriority, partialAllowed, shortagePolicy } = req.body ?? {};
    if (typeof cashflowId !== 'string' || !cashflowId.trim() || typeof creditorRef !== 'string' || !creditorRef.trim()
      || typeof amount !== 'string' || typeof dueDate !== 'string') {
      res.status(422).json({ error: 'Campi obbligatori mancanti o invalidi', code: 'invalid_economy_command', canonical: false });
      return;
    }
    if (cashflowId.startsWith('mandate_')) {
      // M07 µ2-bis (M-2): il prefisso dei mandati è riservato, il client non
      // può pre-seminare (o dirottare la policy di) obblighi generati da µ2.
      res.status(422).json({ error: 'prefisso mandate_ riservato agli obblighi dei mandati', code: 'reserved_cashflow_id', canonical: false });
      return;
    }
    if (parseInteger(amount, 'amount') <= 0n) {
      res.status(422).json({ error: 'Importo deve essere positivo', code: 'invalid_economy_command', canonical: false });
      return;
    }
    const created = createCashflow(req.params.id, bound.branchId, {
      cashflowId,
      debtor: { ref: bound.actorId, currencyId: bound.currencyId },
      creditor: { ref: creditorRef, currencyId: bound.currencyId },
      amount,
      dueDate,
      legalPriority: typeof legalPriority === 'number' && Number.isInteger(legalPriority) && legalPriority >= 0 ? legalPriority : 0,
      partialAllowed: partialAllowed === true,
      shortagePolicy: shortagePolicy === 'default' ? 'default' : 'arrears',
    });
    res.status(created ? 201 : 200).json({ cashflowId, debtor: bound.actorId, currencyId: bound.currencyId, canonical: true });
  } catch (e) { respondEconomyError(res, e); }
});

/** M06 µ6a (B1): prenotazione monetaria del tesoro bound; shortfall esplicito,
 *  mai clampato (MAT05), e blocco spending se arretrato/default (M02 µ4). */
gamesRouter.post('/:id/economy/reservations', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { reservationId, amount } = req.body ?? {};
    if (typeof reservationId !== 'string' || !reservationId.trim() || typeof amount !== 'string') {
      res.status(422).json({ error: 'Campi obbligatori mancanti o invalidi', code: 'invalid_economy_command', canonical: false });
      return;
    }
    if (parseInteger(amount, 'amount') <= 0n) {
      res.status(422).json({ error: 'Importo deve essere positivo', code: 'invalid_economy_command', canonical: false });
      return;
    }
    const outcome = createReservation(req.params.id, bound.branchId, {
      reservationId,
      target: { kind: 'money', unitId: bound.currencyId, holderRef: bound.actorId },
      amount,
    });
    res.status(outcome.created ? 201 : 200).json({
      reservationId,
      holder: bound.actorId,
      currencyId: bound.currencyId,
      availability: outcome.availability,
      canonical: true,
    });
  } catch (e) { respondEconomyError(res, e); }
});

/** M07 µ2: mandati di delega (MAT31) collegati alla finanza canonica.
 *  Il client propone tetto/periodo/whitelist/fornitori: valuta, tesoro e ramo
 *  sono server-bound; ogni esecuzione cita mandateId e produce un obbligo
 *  datato reale, liquitato dal tick strict. */
gamesRouter.post('/:id/mandates', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { mandateId, title, ceiling, startDate, endDate, whitelist, suppliers, priceLimit, resourceId, minStock, noNewDebt } = req.body ?? {};
    if (typeof mandateId !== 'string' || !mandateId.trim() || typeof title !== 'string' || !title.trim()
      || typeof ceiling !== 'string' || typeof startDate !== 'string' || typeof endDate !== 'string'
      || !Array.isArray(whitelist) || !whitelist.every(item => typeof item === 'string')
      || !Array.isArray(suppliers) || !suppliers.every(item => typeof item === 'string')
      || typeof noNewDebt !== 'boolean') {
      res.status(422).json({ error: 'Campi mandato mancanti o invalidi', code: 'invalid_mandate', canonical: false });
      return;
    }
    if (priceLimit !== undefined && (typeof priceLimit !== 'string' || priceLimit === '')) {
      res.status(422).json({ error: 'priceLimit atteso stringa non vuota', code: 'invalid_mandate', canonical: false });
      return;
    }
    if ((resourceId === undefined) !== (minStock === undefined)
      || (resourceId !== undefined && (typeof resourceId !== 'string' || !resourceId))
      || (minStock !== undefined && (typeof minStock !== 'string' || !minStock))) {
      res.status(422).json({ error: 'resourceId e minStock devono essere dichiarati insieme', code: 'incomplete_stock_guard', canonical: false });
      return;
    }
    if (typeof resourceId === 'string' && !bound.catalog.resources.some(resource => resource.id === resourceId)) {
      res.status(422).json({ error: `Risorsa catalogo sconosciuta: ${resourceId}`, code: 'unknown_resource', canonical: false });
      return;
    }
    const outcome = createMandateRecord(req.params.id, bound.branchId, {
      id: mandateId,
      title,
      currencyId: bound.currencyId,
      ceiling,
      startDate,
      endDate,
      whitelist: whitelist as string[],
      suppliers: suppliers as string[],
      ...(priceLimit !== undefined ? { priceLimit: priceLimit as string } : {}),
      ...(resourceId !== undefined ? { resourceId: resourceId as string, minStock: minStock as string } : {}),
      noNewDebt,
    });
    res.status(outcome.created ? 201 : 200).json({
      mandateId,
      currencyId: bound.currencyId,
      treasury: bound.actorId,
      spent: outcome.mandate.spent,
      canonical: true,
    });
  } catch (e) { respondMandateError(res, e); }
});

gamesRouter.post('/:id/mandates/:mandateId/executions', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { executionId, actionType, supplier, amount, price, quantity, atDate } = req.body ?? {};
    if (typeof executionId !== 'string' || !executionId.trim() || typeof actionType !== 'string' || !actionType.trim()
      || typeof supplier !== 'string' || !supplier.trim() || typeof amount !== 'string' || typeof atDate !== 'string') {
      res.status(422).json({ error: 'Campi esecuzione mancanti o invalidi', code: 'invalid_mandate_execution', canonical: false });
      return;
    }
    const outcome = executeMandateEconomy(req.params.id, bound.branchId, req.params.mandateId, {
      executionId,
      mandateId: req.params.mandateId,
      actionType,
      supplier,
      amount,
      ...(price !== undefined ? { price: price as string } : {}),
      ...(quantity !== undefined ? { quantity: quantity as string } : {}),
      atDate,
    }, { actorId: bound.actorId, currencyId: bound.currencyId });
    res.status(outcome.applied ? 201 : 200).json({
      executionId,
      mandateId: req.params.mandateId,
      applied: outcome.applied,
      cashflowId: outcome.cashflowId,
      spent: outcome.mandate.spent,
      remaining: getMandateRemaining(bound.branchId, req.params.mandateId),
      canonical: true,
    });
  } catch (e) { respondMandateError(res, e); }
});

gamesRouter.post('/:id/mandates/:mandateId/cancel', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const state = cancelMandateAndResolveDecisions(req.params.id, bound.branchId, req.params.mandateId);
    res.status(200).json({ mandateId: req.params.mandateId, status: state.status, spent: state.spent, canonical: true });
  } catch (e) { respondMandateError(res, e); }
});

/** M07 µ4: dashboard read-only delle eccezioni aperte/acknowledged. GET non
 *  esegue bootstrap né refresh: le decisioni nascono SOLO al tick strict. */
gamesRouter.get('/:id/mandates/decisions', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id, false);
    // Read model: nei giochi legacy non esistono mandati strict, quindi la
    // dashboard è legittimamente vuota (non è un errore operativo del client).
    if ('error' in bound) {
      if (bound.error.payload.code === 'economy_mode_legacy') {
        res.status(200).json({ decisions: [], decisionRequired: false, canonical: true });
        return;
      }
      res.status(bound.error.status).json(bound.error.payload);
      return;
    }
    const decisions = listOpenMandateDecisions(req.params.id, bound.branchId);
    res.status(200).json({ decisions, decisionRequired: decisions.length > 0, canonical: true });
  } catch (e) { respondMandateError(res, e); }
});

/** L'acknowledgement sopprime solo la ripetizione: non autorizza né acquista. */
gamesRouter.post('/:id/mandates/:mandateId/decisions/:kind/acknowledge', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const decision = acknowledgeMandateDecision(req.params.id, bound.branchId, req.params.mandateId, req.params.kind);
    res.status(200).json({ decision, decisionRequired: true, canonical: true });
  } catch (e) { respondMandateError(res, e); }
});

function respondMandateError(res: any, e: unknown): void {
  if (e instanceof MandateError || e instanceof MandateConflictError || e instanceof FinanceError || e instanceof MandateDecisionError) {
    res.status(422).json({ error: e.message, code: (e as { code?: string }).code ?? 'mandate_rejected', canonical: false });
    return;
  }
  respondRouteError(res, e, 'Failed to commit mandate command');
}

/** M03 µ4-bis: preview puro. Il body contiene SOLO l'intento; catalogo e
 * identità sono risolti dal server. Nessuna mutazione/riserve/coda. */
gamesRouter.post('/:id/actions/evaluate', (req, res) => {
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
gamesRouter.post('/:id/actions/check-feasibility', async (req, res) => {
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

gamesRouter.post('/:id/actions/queue', (req, res) => {
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

gamesRouter.get('/:id/actions/queue', (req, res) => {
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
gamesRouter.delete('/:id/actions/queue/:actionId', (req, res) => {
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
gamesRouter.patch('/:id/actions/queue/:actionId', (req, res) => {
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

gamesRouter.post('/:id/actions/process', async (req, res) => {
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

gamesRouter.post('/:id/actions/process-all', async (req, res) => {
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

/** Stato persistito di un salto: utile per riconciliare HTTP/SSE dopo retry. */
gamesRouter.get('/:id/simulations/:runId', (req, res) => {
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
gamesRouter.post('/:id/simulations/:runId/restore', async (req, res) => {
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
gamesRouter.post('/:id/simulation-jobs', (req, res) => {
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

gamesRouter.get('/:id/simulation-jobs/:jobId', (req, res) => {
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
 * Cloudflare non può troncare una generazione LLM ancora in corso. */
gamesRouter.get('/:id/simulation-jobs/:jobId/result', (req, res) => {
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
gamesRouter.post('/:id/simulations/:runId/resume-recovery', (req, res) => {
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

gamesRouter.post('/:id/simulations/:runId/close-recovery', (req, res) => {
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

gamesRouter.post('/:id/time-skip', async (req, res) => {
  const gameId = req.params.id;
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

/** Ricostruisce la risposta time-skip dall’esito del job (µ3: una sola forma). */
function respondTimeSkipResult(res: any, session: any, result: any, periodStart: string, jumpDays: number): void {
  if (Array.isArray(result)) {
    res.json({
      type: 'actions_processed',
      simulationId: result.at(-1)?.result?.simulationId,
      processedCount: result.length,
      actions: result,
      // F06 µ2: la revisione canonica permette al client di ordinare il delta.
      revision: gameRepository.getWorldRevision(session.id),
    });
    return;
  }
  const pausedResult = result as PausedBatchResult | null;
  if (pausedResult?.paused === true) {
    res.json(pausedResult);
    return;
  }
  const worldResult = result as TurnResultRecord | null;
  if (!worldResult) {
    res.json({
      type: 'no_event_found',
      simulationId: gameRepository.getLatestSimulationRun(session.id)?.id,
      startDate: periodStart,
      searchedUntil: addDays(periodStart, jumpHorizon(jumpDays)),
    });
    return;
  }
  res.json({
    type: 'world_advanced',
    simulationId: worldResult.simulationId,
    // F06 µ2: la revisione canonica permette al client di ordinare il delta.
    revision: gameRepository.getWorldRevision(session.id),
    result: {
      simulationId: worldResult.simulationId,
      turn: worldResult.turn,
      narration: worldResult.narration,
      events: worldResult.events,
      eventDetails: worldResult.timelineEvents || [],
      periodStart,
      periodEnd: session.getCurrentDate(),
    },
    newDate: session.getCurrentDate(),
    newTurn: session.getCurrentTurn(),
  });
}

/** Mappa il fallimento di un job sugli stessi codici HTTP del percorso inline. */
function respondJobFailure(res: any, job: any): void {
  if (job.error_name === 'LLMError') {
    // I Quick Tunnel sostituiscono i 502 JSON con una pagina HTML generica.
    // 424 conserva il dettaglio del provider per la UI.
    res.status(424).json({ error: job.error });
  } else if (job.error_name === 'SimulationInProgressError') {
    res.status(409).json({ error: job.error, code: 'simulation_in_progress' });
  } else if (job.error_name === 'SimulationPausedError') {
    res.status(409).json({ error: job.error, code: 'simulation_paused' });
  } else if (job.error_name === 'GameOverError') {
    // La nazione è caduta: nessun turno può più avanzare.
    res.status(409).json({ error: job.error, code: 'game_over' });
  } else {
    res.status(500).json({ error: job.error || 'job_failed' });
  }
}

// Этап 2: Rewind — откат на ход назад
/** §9.3 — «Continua»: autorizza il checkpoint per-evento successivo del
 * salto fisso sospeso. L'ultimo «Continua» porta il mondo a destinazione. */
gamesRouter.post('/:id/simulations/:runId/next', async (req, res) => {
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

gamesRouter.post('/:id/rewind', (req, res) => {
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
gamesRouter.get('/:id/rewind', (req, res) => {
  const gameId = req.params.id;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    res.json({ canRewind: session.canRewind() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to check rewind');
  }
});

// Fase 2: Intervene — прервать применение оставшихся событий пачки
gamesRouter.post('/:id/intervene', async (req, res) => {
  const gameId = req.params.id;
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
