/**
 * Open-Pax — Session Registry
 * ============================
 * Manages all active GameSession instances.
 * Provides session lookup, creation, loading from DB.
 */

import { shortId } from './utils/short-id';
import { enrichGeographicObjects } from './utils/cities';
import { LLMRouter } from './llm';
import { GameSession, SaveData } from './game-session';
import { gameRepository, worldRepository } from './repositories';
import db from './database';

class SessionRegistry {
  private sessions: Map<string, GameSession> = new Map();
  private provider: LLMRouter;

  constructor(provider: LLMRouter) {
    this.provider = provider;
  }

  /**
   * Create a new game session
   */
  createSession(worldId: string, playerName: string, playerRegionId: string, playerColor: string = '#FF0000', difficulty?: string): { session: GameSession; playerId: string; gameId: string } {
    const gameId = shortId();

    // Verify world exists
    const world = worldRepository.findById(worldId);
    if (!world) {
      throw new Error('World not found');
    }

    // Verify region exists
    const region = world.regions.find((r: any) => r.id === playerRegionId);
    if (!region) {
      throw new Error('Region not found');
    }

    // Create game in database
    gameRepository.create({
      id: gameId,
      worldId,
      currentTurn: 1,
      maxTurns: 100,
      status: 'playing',
      difficulty,
    });

    // Add player to database. polityId = owner of the chosen region
    // (unified polity-id convention: 'USA' for templates, 'player' for custom maps).
    const playerId = shortId();
    gameRepository.addPlayer({
      id: playerId,
      gameId,
      name: playerName || 'Player',
      regionId: playerRegionId,
      color: playerColor,
      polityId: region.owner,
    });

    // Create session
    const session = new GameSession(gameId, worldId, this.provider);

    // Initialize session (sets up agents, loads regions)
    session.initialize(playerRegionId, playerName, playerColor, difficulty);

    // Cache session
    this.sessions.set(gameId, session);

    console.log('[SessionRegistry] Created session:', gameId);
    return { session, playerId, gameId };
  }

  /**
   * Get existing session from memory or load from DB
   */
  getSession(gameId: string): GameSession | null {
    // Check memory first
    if (this.sessions.has(gameId)) {
      return this.sessions.get(gameId)!;
    }

    // Try to load from database
    const game = gameRepository.findById(gameId);
    if (!game) {
      return null;
    }

    // Reconstruct session from DB state
    const session = new GameSession(gameId, game.world_id, this.provider);

    // Get player info from DB
    const players = gameRepository.getPlayers(gameId);

    // Geometria dal world, stato dinamico dalla copia isolata della partita.
    const dynamicRegions = new Map(gameRepository.getGameRegions(gameId).map(region => [region.id, region]));
    const dbRegions = worldRepository.getRegions(game.world_id);
    const regionStates: [string, any][] = dbRegions.map(r => {
      const state = dynamicRegions.get(r.id);
      return [r.id, {
        id: r.id,
        name: r.name,
        color: state?.color || r.color,
        owner: state?.owner || r.owner,
        population: state?.population ?? r.population,
        gdp: state?.gdp ?? r.gdp,
        militaryPower: state?.militaryPower ?? r.militaryPower,
        objects: state?.objects || r.objects || [],
        svgPath: r.svgPath,
      }];
    });

    session.reconstructFromDB({
      currentTurn: game.current_turn,
      currentDate: game.current_date || game.world?.start_date || '1951-01-01',
      difficulty: game.difficulty,
      consolidatedHistory: game.consolidated_history,
      consolidatedUpTo: game.consolidated_up_to,
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        regionId: p.regionId,
        color: p.color,
        polityId: p.polityId,
      })),
      regionStates,
    });

    // Cache session
    this.sessions.set(gameId, session);

    console.log('[SessionRegistry] Loaded session from DB:', gameId);
    return session;
  }

  /**
   * Load a saved game
   */
  loadSavedGame(saveId: string): GameSession | null {
    // Get save record
    const stmt = db.prepare('SELECT * FROM saves WHERE id = ?');
    const save = stmt.get(saveId) as any;

    if (!save) {
      console.log('[SessionRegistry] Save not found:', saveId);
      return null;
    }

    // Get or create session for this game
    let session = this.getSession(save.game_id);
    if (!session) {
      console.log('[SessionRegistry] Game not found for save:', save.game_id);
      return null;
    }

    // Parse save data
    let saveData: SaveData;
    try {
      saveData = JSON.parse(save.data);
    } catch (e) {
      console.error('[SessionRegistry] Failed to parse save data:', e);
      return null;
    }

    // I salvataggi contengono uno snapshot delle regioni. Senza questa
    // normalizzazione uno snapshot vecchio riscriverebbe città legacy (x/y)
    // o doppioni capitale/città dopo che il registro geografico è stato sanato.
    const world = gameRepository.findById(save.game_id)?.world;
    const geography = new Map<string, any>((world?.regions || []).map((region: any) => [region.id, region]));
    let saveChanged = false;
    if (Array.isArray(saveData.regions)) {
      saveData.regions = saveData.regions.map(([regionId, region]: [string, any]) => {
        const source = geography.get(regionId);
        if (!source?.geojson) return [regionId, region];
        try {
          const parsed = JSON.parse(source.geojson);
          const objects = enrichGeographicObjects(
            region.objects || [],
            parsed?.geometry ?? parsed,
            String(source.flag || source.owner || '').toUpperCase(),
            Boolean(source.metadata?.pax_region_id),
          );
          if (JSON.stringify(objects) !== JSON.stringify(region.objects || [])) saveChanged = true;
          return [regionId, { ...region, objects }];
        } catch {
          return [regionId, region];
        }
      });
    }
    if (saveChanged) {
      db.prepare('UPDATE saves SET data = ? WHERE id = ?').run(JSON.stringify(saveData), saveId);
    }

    // Load session from save data
    session.loadFromSave(saveData);

    console.log('[SessionRegistry] Loaded saved game:', saveId, 'turn:', saveData.currentTurn);
    return session;
  }

  /**
   * Get session or throw error
   */
  getSessionOrThrow(gameId: string): GameSession {
    const session = this.getSession(gameId);
    if (!session) {
      throw new Error('Game not found: ' + gameId);
    }
    return session;
  }

  /**
   * Reload active sessions from DB on server restart
   */
  reloadActiveSessions(): void {
    const stmt = db.prepare("SELECT * FROM games WHERE status = 'playing'");
    const activeGames = stmt.all() as any[];

    for (const game of activeGames) {
      try {
        const session = new GameSession(game.id, game.world_id, this.provider);

        // Get player info from DB
        const players = gameRepository.getPlayers(game.id);

        // Geometria dal world, stato dinamico dalla copia isolata della partita.
        const dynamicRegions = new Map(gameRepository.getGameRegions(game.id).map(region => [region.id, region]));
        const dbRegions = worldRepository.getRegions(game.world_id);
        const regionStates: [string, any][] = dbRegions.map(r => {
          const state = dynamicRegions.get(r.id);
          return [r.id, {
            id: r.id,
            name: r.name,
            color: state?.color || r.color,
            owner: state?.owner || r.owner,
            population: state?.population ?? r.population,
            gdp: state?.gdp ?? r.gdp,
            militaryPower: state?.militaryPower ?? r.militaryPower,
            objects: state?.objects || r.objects || [],
            svgPath: r.svgPath,
          }];
        });

        session.reconstructFromDB({
          currentTurn: game.current_turn,
          // Bug fix: restore the persisted in-game date; game is a raw row
          // here (no world join), so game.world was always undefined and the
          // date snapped back to 1951-01-01 on every server restart.
          currentDate: game.current_date || '1951-01-01',
          difficulty: game.difficulty,
          consolidatedHistory: game.consolidated_history,
          consolidatedUpTo: game.consolidated_up_to,
          players: players.map((p: any) => ({
            id: p.id,
            name: p.name,
            regionId: p.regionId,
            color: p.color,
            polityId: p.polityId,
          })),
          regionStates,
        });

        this.sessions.set(game.id, session);
        console.log('[SessionRegistry] Restored session:', game.id);
      } catch (e) {
        console.error('[SessionRegistry] Failed to restore session:', game.id, e);
      }
    }

    console.log(`[SessionRegistry] Reloaded ${this.sessions.size} active sessions`);
  }

  /**
   * Remove session from registry
   */
  removeSession(gameId: string): void {
    this.sessions.delete(gameId);
    console.log('[SessionRegistry] Removed session:', gameId);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Flush all in-memory session state to the database.
   *
   * Called on SIGTERM / SIGINT (and any other clean shutdown) so that
   * NPC mutations, queued actions, and any pending region deltas that
   * haven't yet been persisted are written before the process exits.
   * Without this, pm2 restart / docker stop / kill <pid> loses every
   * state change since the last syncRegionsToDB call inside applyTurn.
   *
   * Safe to call concurrently with normal traffic: each session's
   * syncRegionsToDB runs in its own DB transaction.
   */
  async flushAll(): Promise<void> {
    const ids = this.getActiveSessionIds();
    if (ids.length === 0) return;
    console.log(`[SessionRegistry] Flushing ${ids.length} session(s) to DB...`);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const session = this.sessions.get(id);
        if (!session) return;
        try {
          await session.syncRegionsToDB();
        } catch (e) {
          console.error(`[SessionRegistry] Failed to flush session ${id}:`, e);
          throw e;
        }
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    console.log(`[SessionRegistry] Flush complete: ${ok} ok, ${failed} failed`);
  }
}

// Singleton instance - will be initialized in index.ts with provider
let registry: SessionRegistry | null = null;

export function initSessionRegistry(provider: LLMRouter): SessionRegistry {
  registry = new SessionRegistry(provider);
  return registry;
}

export function getSessionRegistry(): SessionRegistry {
  if (!registry) {
    throw new Error('SessionRegistry not initialized');
  }
  return registry;
}

export { SessionRegistry };
