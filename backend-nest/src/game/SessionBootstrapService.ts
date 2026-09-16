/**
 * World Story — SessionBootstrapService
 * =====================================
 * Ciclo di vita iniziale di una sessione (Fase 1: estratto da
 * `game-session.ts`):
 *  - `initialize`: nuova partita da un mondo;
 *  - `reconstructFromDB`: ricostruzione da DB (riavvio/load).
 *
 * Lo **stato vivo** è posseduto da `SessionStateStore` (iniettato): il
 * servizio popola/riassegna `state.regions`, `state.players`, i metadati del
 * mondo e la coda ordini tramite `OrderExecutionService`.
 */

import { gameRepository, relationshipRepository, worldRepository } from '../repositories';
import { normalizeDifficulty } from '../prompts/difficulty';
import { shortId } from '../utils/short-id';
import type { PendingAction } from './OrderExecutionService';
import type { OrderExecutionService } from './OrderExecutionService';
import type { DiplomacyService } from './DiplomacyService';
import type { SessionStateStore } from './SessionStateStore';
import type { PlayerInfo, RegionState } from '../game-session';

export interface SessionBootstrapContext {
  gameId: string;
  worldId: string;
  state: SessionStateStore;
  diplomacy: DiplomacyService;
  orders: OrderExecutionService;
  gameController: any;
  buildGameData(...args: any[]): any;
  ensurePeacetimePressures(): void;
  restoreEnding(): void;
  seedInitialResources(): void;
  syncRegionsToDB(): Promise<void> | void;
  revivePausedRunFromRow(row: any): any;
}

export class SessionBootstrapService {
  constructor(private readonly ctx: SessionBootstrapContext) {}

  private get state(): SessionStateStore { return this.ctx.state; }

  async initialize(playerRegionId: string, playerName: string, playerColor: string = '#FF0000', difficulty?: string): Promise<string> {
    // Load world from DB
    const world = worldRepository.findById(this.ctx.worldId);
    if (!world) throw new Error('World not found');

    // Cache world metadata for prompts (bug fix: lore never reached the LLM)
    this.state.worldName = world.name || '';
    this.state.worldBasePrompt = world.base_prompt || '';
    this.state.worldStartDate = world.start_date || '1951-01-01';
    this.state.worldSimulationRules = world.simulation_rules || undefined;
    this.state.difficulty = normalizeDifficulty(difficulty);
    this.state.taxRatePct = gameRepository.getTaxRatePct(this.ctx.gameId);
    this.ctx.restoreEnding();

    // Load all regions into session state
    for (const region of world.regions) {
      this.state.regions.set(region.id, {
        id: region.id,
        name: region.name,
        color: region.color,
        owner: region.owner,
        population: region.population,
        gdp: region.gdp,
        militaryPower: region.militaryPower,
        objects: region.objects || [],
        svgPath: region.svgPath,
        borders: region.borders,
        status: (region.status || 'active') as 'active' | 'occupied' | 'destroyed' | 'independent',
        coastal: region.coastal,
      });
    }

    // Create player. Player's polity = owner of the chosen region
    // (unified polity-id convention: country code for templates).
    const playerPolityId = this.state.regions.get(playerRegionId)?.owner || 'player';
    this.state.playerPolityId = playerPolityId;
    const playerId = shortId();
    this.state.players = [{
      id: playerId,
      name: playerName,
      regionId: playerRegionId,
      color: playerColor,
      polityId: playerPolityId,
    }];

    // Initialize session-specific game controller
    this.ctx.gameController.initPromptEngine(this.ctx.buildGameData());
    this.ctx.gameController.setupWorld(world.base_prompt);
    // Il magazzino di ogni nazione nasce qui, dai suoi dati di partenza reali.
    this.ctx.seedInitialResources();

    // Setup NPC agents: NPC = una POLITIA (paese), non ogni regione.
    // Nei mondi provinciali un paese possiede più province — un agente per
    // provincia moltiplicherebbe le chiamate LLM (700+ a turno). Raggruppiamo
    // per owner: l'agente della politia parte dalla sua regione più popolosa.
    const regionsByOwner = new Map<string, RegionState>();
    for (const r of this.state.regions.values()) {
      if (r.owner === 'neutral' || r.owner === this.state.playerPolityId) continue;
      const current = regionsByOwner.get(r.owner);
      if (!current || r.population > current.population) {
        regionsByOwner.set(r.owner, r);
      }
    }
    const regionConfigs = Array.from(regionsByOwner.values())
      .map(r => ({ id: r.id, name: r.name, owner: r.owner }));
    this.ctx.gameController.setupNPCCountries(regionConfigs);

    // Ogni partita riceve una copia iniziale del baseline diplomatico, poi
    // muta solo game_relationships e mai il preset/world condiviso.
    let rels = relationshipRepository.getForGame(this.ctx.gameId);
    if (!rels.length) {
      rels = relationshipRepository.getForWorld(this.ctx.worldId);
      relationshipRepository.replaceForGame(this.ctx.gameId, rels);
    }
    for (const rel of rels) {
      this.ctx.diplomacy.matrix().set(rel.from, rel.to, rel.type);
    }

    this.state.currentDate = world.start_date || '1951-01-01';

    // Il primo turno di una nuova partita deve già avere le sue sfide. Va fatto
    // prima degli `await`: `initialize` non è atteso dal registry e un lettore
    // immediato non deve trovare il dossier vuoto.
    this.ctx.ensurePeacetimePressures();

    // Sync all regions to DB on init (ensure baseline is persisted)
    await this.ctx.syncRegionsToDB();

    // Persistenza immediata della data di inizio (schema legacy: la riga
    // games nasce con current_date = oggi/1951 — senza update l'API
    // mostrerebbe la data sbagliata fino alla prima mossa)
    gameRepository.updateTurnAndDate(this.ctx.gameId, this.state.currentTurn, this.state.currentDate);

    return playerId;
  }

  /**
   * Reconstruct session from DB state (used when loading from DB)
   * Fully restores session including game controller for AI to work
   */
  reconstructFromDB(data: {
    currentTurn: number;
    currentDate: string;
    players: PlayerInfo[];
    regionStates?: [string, RegionState][];
    basePrompt?: string;
    difficulty?: string;
    consolidatedHistory?: string;
    consolidatedUpTo?: number;
  }): void {
    this.state.currentTurn = data.currentTurn;
    this.state.currentDate = data.currentDate;
    this.state.players = data.players || [];
    this.state.difficulty = normalizeDifficulty(data.difficulty);
    this.state.taxRatePct = gameRepository.getTaxRatePct(this.ctx.gameId);
    this.ctx.restoreEnding();
    this.state.consolidatedHistory = data.consolidatedHistory || '';
    this.state.consolidatedUpTo = data.consolidatedUpTo || 0;

    // Cache world metadata for prompts BEFORE buildGameData runs below
    // (bug fix: lore never reached the LLM because buildGameData sent basePrompt: '').
    const world = worldRepository.findById(this.ctx.worldId);
    this.state.worldName = world?.name || '';
    this.state.worldBasePrompt = data.basePrompt || world?.base_prompt || '';
    this.state.worldStartDate = world?.start_date || '';
    this.state.worldSimulationRules = world?.simulation_rules || undefined;

    // Restore player's polity (persisted in players.polity_id; fallback —
    // owner of the home region for legacy rows).
    const primaryPlayer = this.state.players[0];
    this.state.playerPolityId =
      primaryPlayer?.polityId ||
      (primaryPlayer ? this.state.regions.get(primaryPlayer.regionId)?.owner : undefined) ||
      'player';

    // If region states provided (from save), use them
    if (data.regionStates) {
      this.state.regions = new Map(data.regionStates);
    } else {
      // Geometria/metadati dal world, stato dinamico dalla copia isolata del
      // game. Le partite legacy senza copia ricevono il baseline al primo sync.
      const gameRegions = new Map(gameRepository.getGameRegions(this.ctx.gameId).map(region => [region.id, region]));
      const dbRegions = worldRepository.getRegions(this.ctx.worldId);
      for (const region of dbRegions) {
        const state = gameRegions.get(region.id);
        this.state.regions.set(region.id, {
          id: region.id,
          name: region.name,
          color: state?.color || region.color,
          owner: state?.owner || region.owner,
          population: state?.population ?? region.population,
          gdp: state?.gdp ?? region.gdp,
          militaryPower: state?.militaryPower ?? region.militaryPower,
          objects: state?.objects || region.objects || [],
          svgPath: region.svgPath,
          borders: region.borders,
          status: (region.status || 'active') as 'active' | 'occupied' | 'destroyed' | 'independent',
          coastal: region.coastal,
        });
      }
      if (!gameRegions.size) this.ctx.syncRegionsToDB();
    }

    // Re-initialize game controller with current state
    this.ctx.gameController.initPromptEngine(this.ctx.buildGameData());

    this.ctx.gameController.setupWorld(this.state.worldBasePrompt);
    // Ricostruzione: crea i magazzini mancanti dai dati iniziali del mondo.
    this.ctx.seedInitialResources();

    // Sessioni legacy ricevono il baseline solo se non possiedono ancora
    // relazioni isolate; in seguito il DB della partita è la fonte di verità.
    let rels = relationshipRepository.getForGame(this.ctx.gameId);
    if (!rels.length) {
      rels = relationshipRepository.getForWorld(this.ctx.worldId);
      relationshipRepository.replaceForGame(this.ctx.gameId, rels);
    }
    for (const rel of rels) {
      this.ctx.diplomacy.matrix().set(rel.from, rel.to, rel.type);
    }

    // Cronaca dei turni (Timeline) e ordini futuri: ricaricati dal DB alla
    // ricostruzione, così un riavvio non elimina la coda del giocatore.
    this.state.results = gameRepository.getResultsByGame(this.ctx.gameId);
    this.ctx.orders.replaceQueue(gameRepository.getPendingActions(this.ctx.gameId) as PendingAction[]);
    // §9.3: il playback in pausa attraversa il riavvio. Gli ordini presi in
    // carico dal run sospeso restano «processing» e non sono reinviati.
    const paused = gameRepository.getPausedSimulationRun(this.ctx.gameId);
    this.state.pausedRun = paused ? this.ctx.revivePausedRunFromRow(paused) : null;
    const pausedActionIds = new Set(this.state.pausedRun?.batchActionIds || []);
    // Un processo LLM non può attraversare un restart: gli eventuali record
    // rimasti "processing" sono ritentabili nel nuovo processo — salvo quelli
    // di un run scaglionato che attende ancora la conferma del giocatore.
    gameRepository.updatePendingActionStatus(
      this.ctx.gameId,
      this.ctx.orders.queue().map(action => action.id).filter(id => !pausedActionIds.has(id)),
      'pending',
    );
    // Dopo crash un run non in pausa non conserva una claim tecnica: torna
    // queued/not_started sia in DB sia nella proiezione RAM. Il playback
    // durevole, invece, mantiene issued/in_progress e non viene reinviato.
    this.ctx.orders.queue().forEach(action => {
      if (pausedActionIds.has(action.id)) {
        action.status = 'processing';
        action.deliveryStatus = 'issued';
        action.executionStatus = 'in_progress';
      } else {
        action.status = 'pending';
        action.deliveryStatus = 'queued';
        action.executionStatus = 'not_started';
      }
    });

    // Re-setup NPC countries: любая полития, кроме игрока и 'neutral'
    const regionConfigs = Array.from(this.state.regions.values())
      .filter(r => r.owner !== 'neutral' && r.owner !== this.state.playerPolityId)
      .map(r => ({ id: r.id, name: r.name, owner: r.owner }));
    this.ctx.gameController.setupNPCCountries(regionConfigs);

    // Un riavvio non azzera le sfide del turno in corso.
    this.ctx.ensurePeacetimePressures();

    console.log('[GameSession] Reconstructed session from DB, turn:', this.state.currentTurn);
  }

  /**
   * Get region by ID
   */
}
