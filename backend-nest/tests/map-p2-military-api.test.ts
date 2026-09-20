/**
 * MAP P2 — contratto delle route militari persistenti.
 * ====================================================
 * La mappa P2 legge `GET /games/:id/military/units` e
 * `GET /games/:id/military/fronts`. Qui si prova che il motore pubblica già,
 * senza filtri player-centred, i campi che il read model della mappa usa:
 * `polityId` (nazionalità), `regionId` (posizione), `order`, `frontId`,
 * `movement` P6 e l'intero fronte con obiettivo, pressioni e iniziativa.
 *
 * Nessun DTO parallelo: la mappa legge la stessa fonte di verità.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapp2-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'mapp2_world';
const PID = 'ITA';
const AUT = 'AUT';
const HUN = 'HUN';
const R = {
  ita1: `${WORLD_ID}_ITA1`, ita2: `${WORLD_ID}_ITA2`,
  aut1: `${WORLD_ID}_AUT1`, aut2: `${WORLD_ID}_AUT2`,
  hun1: `${WORLD_ID}_HUN1`,
};

let db: any;
let registry: any;
let gamesRouter: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'MAP P2 World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: R.ita1, name: 'Pianura', color: '#FF0000', owner: PID,
        population: 30_000_000, gdp: 1200, militaryPower: 300, flag: PID, borders: [R.ita2, R.aut1],
        objects: [{ id: 'a1', type: 'army', name: '1ª Armata', level: 4 }],
      },
      { id: R.ita2, name: 'Costa', color: '#FF8888', owner: PID, population: 20_000_000, gdp: 800, militaryPower: 100, flag: PID, borders: [R.ita1], objects: [] },
      {
        id: R.aut1, name: 'Tirolo', color: '#00FF00', owner: AUT,
        population: 6_000_000, gdp: 250, militaryPower: 400, flag: AUT, borders: [R.ita1, R.aut2],
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 3 }],
      },
      { id: R.aut2, name: 'Vienna', color: '#88FF88', owner: AUT, population: 3_000_000, gdp: 200, militaryPower: 200, flag: AUT, borders: [R.aut1, R.hun1], objects: [] },
      { id: R.hun1, name: 'Ungheria', color: '#0000FF', owner: HUN, population: 4_000_000, gdp: 150, militaryPower: 150, flag: HUN, borders: [R.aut2], objects: [] },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', R.ita1, '#FF0000');
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* tmp */ }
});

const setRelationship = (session: any, a: string, b: string, rel: 'ally' | 'neutral' | 'hostile') => {
  session.diplomacy.matrix().set(a, b, rel);
  session.diplomacy.matrix().set(b, a, rel);
};

/** Invoca una GET sul router Express reale e cattura status/body. */
const callGetRoute = (routePath: string, params: Record<string, string>) => {
  const layer = gamesRouter.stack.find((item: any) => item.route?.path === routePath && item.route.methods.get);
  if (!layer) throw new Error(`route missing: ${routePath}`);
  let response: { status: number; body: any } | null = null;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { response = { status: this.statusCode, body: payload }; return this; },
  };
  layer.route.stack[0].handle({ method: 'GET', params }, res);
  if (!response) throw new Error(`route did not respond: ${routePath}`);
  return response;
};

/**
 * Partita ITA–AUT con fronte già sincronizzato (NPC materializzati) e un
 * trasferimento strategico P6 persistito: la mappa deve leggere il reparto in
 * marcia così com'è nello stato, senza ricalcolare nulla.
 */
const panzerMove = () => {
  const { gameId, session } = createGame();
  setRelationship(session, PID, AUT, 'hostile');
  session.publicFronts();
  session.advanceWorldState(30, '2026-01-31');
  const store = session.operationalStoreFor();
  const all = store.units();
  const italian = all.find((unit: any) => unit.polityId === PID && unit.regionId);
  expect(italian).toBeTruthy();
  // Movimento persistente reale (stessa forma scritta dal motore P6).
  store.saveUnits(all.map((unit: any) => String(unit.id) === String(italian.id)
    ? {
      ...unit, regionId: R.ita1, regionName: 'Pianura', frontId: null, status: 'operational',
      movement: {
        path: [R.ita1, R.aut1, R.aut2], targetRegionId: R.aut2, targetRegionName: 'Vienna',
        startedDate: '2026-01-31', pathIndex: 0, daysPerHop: 15, remainingDaysToNextHop: 15,
        totalHops: 2, estimatedArrivalDate: '2026-03-02', motorized: true,
      },
    }
    : unit));
  return { gameId, session, unitId: italian.id };
};

describe('MAP P2 — contratto route militari', () => {
  it('1: GET units restituisce lo stato persistente con polityId/regionId/order/frontId', () => {
    const { gameId } = panzerMove();
    const response = callGetRoute('/:id/military/units', { id: gameId });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.units)).toBe(true);
    expect(response.body.units.length).toBeGreaterThan(0);
    for (const unit of response.body.units) {
      // `polityId` è l'authority nazionale e c'è sempre; nello stato serializzato
      // `order`/`frontId` sono sempre presenti (eventualmente `null`).
      expect(typeof unit.polityId).toBe('string');
      expect(unit.polityId.length).toBeGreaterThan(0);
      expect('regionId' in unit).toBe(true);
      expect('order' in unit).toBe(true);
      expect('frontId' in unit).toBe(true);
      expect(['forming', 'operational', 'degraded', 'retreating', 'destroyed']).toContain(unit.status);
    }
  });

  it('2: GET units espone anche reparti NPC e il movimento P6 senza filtri player', () => {
    const { gameId } = panzerMove();
    const { body } = callGetRoute('/:id/military/units', { id: gameId });
    const polities = new Set(body.units.map((unit: any) => unit.polityId));
    expect(polities.has(PID)).toBe(true);
    expect(polities.has(AUT)).toBe(true);

    const moving = body.units.find((unit: any) => unit.movement);
    expect(moving).toBeTruthy();
    expect(Array.isArray(moving.movement.path)).toBe(true);
    expect(moving.movement.path.length).toBeGreaterThan(1);
    expect(typeof moving.movement.pathIndex).toBe('number');
    expect(typeof moving.movement.remainingDaysToNextHop).toBe('number');
    expect(typeof moving.movement.estimatedArrivalDate).toBe('string');
    expect(typeof moving.movement.motorized).toBe('boolean');
    // La posizione canonica resta l'ultima regione raggiunta.
    expect(moving.regionId).toBe(R.ita1);
    expect(moving.movement.targetRegionId).toBe(R.aut2);
  });

  it('3: GET fronts restituisce le parti, l’obiettivo, le pressioni e l’iniziativa reali', () => {
    const { gameId } = panzerMove();
    const response = callGetRoute('/:id/military/fronts', { id: gameId });
    expect(response.status).toBe(200);
    expect(response.body.fronts.length).toBeGreaterThan(0);
    const front = response.body.fronts[0];
    expect([PID, AUT]).toContain(front.attackerPolityId);
    expect([PID, AUT]).toContain(front.defenderPolityId);
    expect(Array.isArray(front.regionIds)).toBe(true);
    expect(front.regionIds.length).toBeGreaterThan(0);
    expect('objectiveRegionId' in front).toBe(true);
    expect('attackerPressure' in front).toBe(true);
    expect('defenderPressure' in front).toBe(true);
    expect('momentumPolityId' in front).toBe(true);
    expect(['forming', 'active', 'stalemate', 'breakthrough', 'collapsed', 'closed']).toContain(front.status);
  });

  it('4: la nazionalità del reparto non cambia quando la provincia è conquistata', () => {
    const { gameId, session } = panzerMove();
    const before = callGetRoute('/:id/military/units', { id: gameId }).body.units
      .find((unit: any) => unit.polityId === AUT);
    expect(before).toBeTruthy();
    // Un reparto AUT in Tirolo (AUT). La provincia cade in mano italiana.
    session.regions.get(R.aut1).owner = PID;
    session.publicFronts();
    const after = callGetRoute('/:id/military/units', { id: gameId }).body.units
      .find((unit: any) => String(unit.id) === String(before.id));
    expect(after).toBeTruthy();
    expect(after.polityId).toBe(AUT);
    // La conquista cambia il territorio, non l'identità del reparto.
    expect(session.regions.get(R.aut1).owner).toBe(PID);
  });
});
