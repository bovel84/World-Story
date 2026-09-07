/**
 * Open-Pax — Games Routes
 * ======================
 */

import { Router } from 'express';
import { shortId } from '../utils/short-id';
import { gameRepository } from '../repositories';
import { countryRepository } from '../repositories/country.repository';
import { getSessionRegistry } from '../session-registry';
import { SimulationInProgressError } from '../game-session';
import { addDays, jumpHorizon } from '../core/simulation/calendar';
import { addSSEClient, removeSSEClient, broadcastToGame, hasClients } from '../sse';
import { LLMError } from '../llm';

export const gamesRouter = Router();

/**
 * Единый обработчик ошибок игровых эндпоинтов:
 * LLMError → 502 с понятным сообщением (провайдер/причина),
 * "not found" → 404, всё остальное → 500.
 */
function respondRouteError(res: any, e: any, fallback: string): void {
  if (e instanceof LLMError) {
    res.status(502).json({ error: `LLM (${e.provider}): ${e.message}` });
  } else if (e instanceof SimulationInProgressError) {
    res.status(409).json({ error: e.message, code: 'simulation_in_progress' });
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
      playerName || 'Player',
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

  res.json({
    id: game.id,
    currentTurn: game.current_turn,
    currentDate: game.current_date,
    maxTurns: game.max_turns,
    status: game.status,
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
    res.json({ processes: gameRepository.getOngoingProcesses(session.id) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get ongoing processes');
  }
});

gamesRouter.get('/:id/national-state', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ accounts: session.getNationalAccounts() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get national state');
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
      broadcastToGame(gameId, type, data);
    });
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
    if (e instanceof LLMError) {
      res.status(502).json({ error: `LLM (${e.provider}): ${e.message}` });
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
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
      res.status(502).json({ error: `LLM (${e.provider}): ${e.message}` });
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
      createdAt: action.createdAt,
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

    res.json({ pendingActions });
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
    res.json({ removed: true });
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
    res.json({ action: updated });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to update pending action');
  }
});

gamesRouter.post('/:id/actions/process', async (req, res) => {
  const gameId = req.params.id;
  const { jump_days = 30 } = req.body;

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
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

  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const processed = await session.processAllPendingActions(jump_days);

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
    const checkpoint = run.checkpoint_id
      ? gameRepository.getSimulationCheckpoint(req.params.id, run.checkpoint_id)
      : null;
    res.json({
      run,
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
    session.loadFromSave(JSON.parse(checkpoint.data));
    await session.persistLoadedState();
    res.json({
      type: 'checkpoint_restored',
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

  try {
    if (idempotencyKey) {
      const existing = gameRepository.getSimulationRunByIdempotencyKey(gameId, idempotencyKey);
      if (existing) {
        if (existing.status === 'running') {
          res.status(409).json({ error: 'Richiesta già in elaborazione', code: 'simulation_in_progress', simulationId: existing.id });
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
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const pendingActions = session.getPendingActions();

    if (pendingActions.length > 0) {
      // Il primo evento importante arresta il TEMPO, non la raccolta degli
      // ordini: tutti quelli in coda partecipano allo stesso lotto causale.
      const processed = await session.processAllPendingActions(jump_days, idempotencyKey);
      if (jump_days <= 0 && processed.length === 0) {
        res.json({
          type: 'no_event_found',
          simulationId: gameRepository.getLatestSimulationRun(gameId)?.id,
          startDate: session.getCurrentDate(),
          searchedUntil: addDays(session.getCurrentDate(), jumpHorizon(jump_days)),
        });
        return;
      }
      res.json({
        type: 'actions_processed',
        simulationId: processed.at(-1)?.result?.simulationId,
        processedCount: processed.length,
        actions: processed,
      });
    } else {
      // Anche senza nuovi ordini il mondo avanza attraverso il simulatore
      // causale. Non creare un finto ordine di "osservazione" e non bypassare
      // la cronaca con il vecchio advanceDate deterministico.
      const periodStart = session.getCurrentDate();
      const result = await session.processWorldAdvance(jump_days, idempotencyKey);
      if (!result) {
        res.json({
          type: 'no_event_found',
          simulationId: gameRepository.getLatestSimulationRun(gameId)?.id,
          startDate: periodStart,
          searchedUntil: addDays(periodStart, jumpHorizon(jump_days)),
        });
        return;
      }
      res.json({
        type: 'world_advanced',
        simulationId: result.simulationId,
        result: {
          simulationId: result.simulationId,
          turn: result.turn,
          narration: result.narration,
          events: result.events,
          eventDetails: result.timelineEvents || [],
          periodStart,
          periodEnd: session.getCurrentDate(),
        },
        newDate: session.getCurrentDate(),
        newTurn: session.getCurrentTurn(),
      });
    }
  } catch (e: any) {
    console.error('[TIME-SKIP] Error:', e);
    respondRouteError(res, e, 'Failed to time-skip');
  }
});

// Этап 2: Rewind — откат на ход назад
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

// Этап 2: Intervene — прервать применение оставшихся событий пачки
gamesRouter.post('/:id/intervene', (req, res) => {
  const gameId = req.params.id;
  try {
    const session = getSessionRegistry().getSessionOrThrow(gameId);
    const simulationId = req.body?.simulationId || req.body?.simulation_id;
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
