/**
 * World Story — Games: state routes (Fase 5)
 * =========================================
 * Stato nazionale, risorse, arsenale, fisco, pressioni e crisi.
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
import { loadWorldMapAssets } from '../../game/WorldMapAssets';
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
  TRADE_ERROR_CODES, PROCURE_ERROR_CODES, DEBT_ERROR_CODES, FORMATION_ERROR_CODES, UNIT_ERROR_CODES,
  respondDomainError, respondRouteError, normalizeAdvisorHistory,
  bindStrictEconomy, respondEconomyError, respondMandateError,
  respondLegacyFeasibility, respondTimeSkipResult, respondJobFailure,
  assessmentStore,
} from './helpers';
import { validateBody } from '../validation';
import { createGameSchema } from './schemas';

export function registerStateRoutes(router: Router): void {
router.post('/', (req, res) => {
  if (!validateBody(res, createGameSchema, req.body)) return;
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

router.get('/:id', (req, res) => {
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
router.get('/:id/ongoing-processes', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    // L'avanzamento arriva sempre valorizzato: la sessione lo ricalcola dalle
    // date per i progetti creati prima che il motore lo persistesse.
    res.json({ processes: session.getOngoingProcesses(), completed: session.getCompletedProcesses() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get ongoing processes');
  }
});

router.get('/:id/national-state', (req, res) => {
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
      // GAMEPLAY-LONG: obiettivi persistenti delle potenze del teatro.
      strategicAgenda: session.getStrategicAgenda(),
      // Registro strutturato degli impegni: ciò che la partita ha firmato.
      commitments: session.getCommitments(),
    });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get national state');
  }
});

// Anime del governo: voci generate dall'LLM sulle fazioni calcolate dal motore.
// On-demand (come il consigliere) e valide per il turno corrente.
router.get('/:id/government/voices', async (req, res) => {
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
router.get('/:id/resources', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getResources());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get resources');
  }
});

// Arsenale militare, risorse naturali reali e catalogo con fattibilità.
router.get('/:id/arsenal', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getArsenal());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get arsenal');
  }
});

// Ordini di produzione militare con percentuale di completamento.
router.get('/:id/production', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getProduction());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get production orders');
  }
});

// Costruzione o acquisto di equipaggiamento (usa e getta: nessuna coda).
router.post('/:id/arsenal/:mode(build|buy)', (req, res) => {
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

// OP-OBJECTS — formazione di reparti: anteprima PRIMA→DOPO e creazione reale.
// L'anteprima non scrive nulla; la creazione paga il materiale, lo toglie dal
// deposito e aggiunge l'armata al mondo (il motore ricalcola forze e spesa).
router.get('/:id/military/formation', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const formations = Number(req.query.formations ?? 1);
    const armyId = req.query.armyId ? String(req.query.armyId) : null;
    const name = req.query.name ? String(req.query.name) : undefined;
    res.json(session.formationPreview({ formations, armyId, name }));
  } catch (e: any) {
    respondDomainError(res, e, FORMATION_ERROR_CODES, 'Failed to preview formation');
  }
});

router.post('/:id/military/formation', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const formations = Number(req.body?.formations ?? 1);
    const armyId = req.body?.armyId ? String(req.body.armyId) : null;
    const name = req.body?.name ? String(req.body.name) : undefined;
    res.json(session.raiseFormation({ formations, armyId, name }));
  } catch (e: any) {
    respondDomainError(res, e, FORMATION_ERROR_CODES, 'Failed to raise formation');
  }
});

// MILITARY-UNITS — i reparti sotto le armate. L'elenco è lo stato persistente
// (una sola fonte di verità); le azioni sono del motore: riserva addestrata,
// deposito, costo di movimento del material flow. `dryRun` è l'anteprima.
router.get('/:id/military/units', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ units: session.militaryUnits() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to list units');
  }
});

router.post('/:id/military/units/:unitId/:action(reinforce|reequip|transfer|reassign|reconstitute)', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const action = String(req.params.action) as 'reinforce' | 'reequip' | 'transfer' | 'reassign' | 'reconstitute';
    res.json(session.unitAction({
      action,
      unitId: String(req.params.unitId),
      men: req.body?.men === undefined ? undefined : Number(req.body.men),
      equipmentId: req.body?.equipmentId ? String(req.body.equipmentId) : undefined,
      quantity: req.body?.quantity === undefined ? undefined : Number(req.body.quantity),
      regionId: req.body?.regionId ? String(req.body.regionId) : undefined,
      armyId: req.body?.armyId ? String(req.body.armyId) : undefined,
      dryRun: req.body?.dryRun === true,
    }));
  } catch (e: any) {
    respondDomainError(res, e, UNIT_ERROR_CODES, 'Failed to act on unit');
  }
});

/**
 * MAP P6 — geografia economica canonica mondiale (read-only).
 *
 * Una sola fotografia per snapshot: giacimenti e impianti di **tutte** le
 * potenze che il catalogo di scenario possiede già, con la sola `regionId`
 * pubblicata dal motore. Nessuna lettura per region (nessun N+1, nessun fetch
 * al click), nessuna scrittura, nessun seed NPC: la GET non materializza stato.
 *
 * Mondi legacy (o catalogo non disponibile) → `{ resources: [], facilities: [],
 * canonical: false }`: meglio nessun dato che geografia inventata.
 */
router.get('/:id/map-assets', (req, res) => {
  try {
    // Binding puro: nessuna idratazione di regioni o sessioni da una GET.
    if (!gameRepository.getWorldBinding(req.params.id)) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(loadWorldMapAssets(req.params.id));
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read world map assets');
  }
});

// MILITARY-UNITS PR2 — fronti di guerra (strategici). Il fronte deriva le sue
// unità dal `frontId` dei reparti: l'elenco non è una seconda verità.
router.get('/:id/military/fronts', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ fronts: session.publicFronts() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to list fronts');
  }
});

// Ordine di un reparto sul fronte: `dryRun` è l'anteprima PRIMA → DOPO
// (pressione, perdite attese, consumi di guerra) senza scrivere nulla.
router.post('/:id/military/units/:unitId/order', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.unitOrder({
      unitId: String(req.params.unitId),
      order: String(req.body?.order || '') as 'attack' | 'defend' | 'reserve' | 'withdraw',
      dryRun: req.body?.dryRun === true,
    }));
  } catch (e: any) {
    respondDomainError(res, e, UNIT_ERROR_CODES, 'Failed to set unit order');
  }
});

// Compravendita di risorse naturali sul mercato mondiale (denaro ↔ magazzino).
router.post('/:id/resources/trade', (req, res) => {
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
router.post('/:id/finance/borrow', (req, res) => {
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
router.get('/:id/fiscal-policy', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ policy: session.getFiscalPolicy() });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read fiscal policy');
  }
});

router.put('/:id/fiscal-policy', (req, res) => {
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
router.get('/:id/pressures', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getPeacetimePressures());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read peacetime pressures');
  }
});

// Il giocatore risponde a una sfida: modificatori, cassa e relazioni. La
// scelta è idempotente (una sfida chiusa non produce un secondo effetto).
router.post('/:id/pressures/:pressureId/resolve', (req, res) => {
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
router.get('/:id/crisis', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json(session.getCrisis());
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to read national crisis');
  }
});

}
