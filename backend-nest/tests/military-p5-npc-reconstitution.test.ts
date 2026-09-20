/**
 * MILITARY P5 — riserve NPC persistenti e manutenzione simmetrica.
 *
 * La manutenzione è server-internal: uomini e fucili vengono trasferiti dagli
 * stock persistenti, senza nuovi reparti e senza riaprire le API player.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { militaryManpower } from '../src/core/simulation/MilitaryDoctrine';
import { equipmentQuantity, rifleEquipmentId, rifleRequirement, seedPersonnel } from '../src/core/simulation/OperationalState';

const TEST_DB = path.join(os.tmpdir(), `world-story-p5-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'p5_world';
const PID = 'ITA';
const AUT = 'AUT';
const HUN = 'HUN';
const R = {
  ita1: `${WORLD_ID}_ITA1`, ita2: `${WORLD_ID}_ITA2`,
  aut1: `${WORLD_ID}_AUT1`, aut2: `${WORLD_ID}_AUT2`, hun1: `${WORLD_ID}_HUN1`,
};

let db: any;
let registry: any;
let repositories: any;
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
  repositories = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  repositories.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'P5 World', description: '', startDate: '1940-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: R.ita1, name: 'Pianura', color: '#FF0000', owner: PID,
        population: 30_000_000, gdp: 1200, militaryPower: 300, flag: PID, borders: [R.ita2, R.aut1],
        objects: [{ id: 'p5-a1', type: 'army', name: '1ª Armata', level: 4 }],
      },
      { id: R.ita2, name: 'Costa', color: '#FF8888', owner: PID, population: 20_000_000, gdp: 800, militaryPower: 100, flag: PID, borders: [R.ita1], objects: [] },
      {
        id: R.aut1, name: 'Tirolo', color: '#00FF00', owner: AUT,
        population: 8_000_000, gdp: 300, militaryPower: 400, flag: AUT, borders: [R.ita1, R.aut2],
        objects: [{ id: 'p5-a2', type: 'army', name: 'Bundesheer', level: 3 }],
      },
      { id: R.aut2, name: 'Vienna', color: '#88FF88', owner: AUT, population: 5_000_000, gdp: 220, militaryPower: 200, flag: AUT, borders: [R.aut1, R.hun1], objects: [] },
      { id: R.hun1, name: 'Ungheria', color: '#0000FF', owner: HUN, population: 6_000_000, gdp: 180, militaryPower: 200, flag: HUN, borders: [R.aut2], objects: [] },
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

const store = (session: any) => session.operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const unitsOf = (session: any, polityId: string): any[] => store(session).unitsForPolity(polityId);
const personnelOf = (session: any, polityId: string): any | null => {
  const row = repositories.operationalObjectRepository.get(session.id, 'personnel', polityId);
  return row?.data ?? null;
};
const putPersonnel = (session: any, polityId: string, state: any) => {
  repositories.operationalObjectRepository.upsert(session.id, 'personnel', polityId, state);
};
const depotOf = (session: any, polityId: string): Record<string, number> =>
  repositories.arsenalRepository.get(session.id, polityId)?.units ?? {};
const putDepot = (session: any, polityId: string, depot: Record<string, number>) => {
  repositories.arsenalRepository.upsert(session.id, polityId, depot, session.currentTurn, session.currentDate);
};
const setRelationship = (session: any, a: string, b: string, rel: 'ally' | 'neutral' | 'hostile') => {
  session.diplomacy.matrix().set(a, b, rel);
  session.diplomacy.matrix().set(b, a, rel);
};
const warGame = () => {
  const { session } = createGame();
  setRelationship(session, PID, AUT, 'hostile');
  session.publicFronts();
  (session as any).warFronts.ensureNpcUnits(30);
  return session;
};
const doctrineOf = (session: any, polityId: string) => {
  const account = session.sessionAccounts()[polityId];
  return militaryManpower({
    population: account.population,
    formations: account.forces,
    mobilizedFormations: account.mobilized,
    epoch: (session as any).military.epoch(),
  });
};
const saveGlobalUnits = (session: any, mapper: (unit: any) => any) => {
  store(session).saveUnits(units(session).map(mapper));
};
const callMilitaryRoute = (routePath: string, params: Record<string, string>, body: Record<string, unknown>) => {
  const layer = gamesRouter.stack.find((item: any) => item.route?.path === routePath && item.route.methods.post);
  if (!layer) throw new Error(`route missing: ${routePath}`);
  let response: any;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { response = { status: this.statusCode, body: payload }; return this; },
  };
  layer.route.stack[0].handle({ method: 'POST', params, body }, res);
  return response;
};

/** Prepara il primo reparto della polity e rende inerti gli altri, senza rimuoverli. */
function prepareOne(session: any, polityId: string, patch: Record<string, unknown>): any {
  const list = unitsOf(session, polityId).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (list.length === 0) throw new Error(`no units for ${polityId}`);
  const chosen = list[0];
  saveGlobalUnits(session, unit => {
    if (unit.polityId !== polityId) return unit;
    if (unit.id === chosen.id) return { ...unit, ...patch };
    return { ...unit, status: 'destroyed', personnel: 0, equipment: {}, readiness: 0 };
  });
  return unitsOf(session, polityId).find(unit => unit.id === chosen.id);
}
const activePersonnelInUnits = (session: any, polityId: string) => unitsOf(session, polityId)
  .filter(unit => unit.status !== 'destroyed')
  .reduce((total, unit) => total + Math.round(Number(unit.personnel) || 0), 0);
const fightOnePeriod = (session: any, date = '1940-01-31') => {
  const plan = (session as any).warFronts.planPeriod(30);
  return (session as any).warFronts.advanceFronts(30, date, {
    legacyOrdersByFront: plan.legacyOrdersByFront,
    supply: {
      [PID]: { food: 1, clothing: 1, weapons: 1, fuel: 1 },
      [AUT]: { food: 1, clothing: 1, weapons: 1, fuel: 1 },
      [HUN]: { food: 1, clothing: 1, weapons: 1, fuel: 1 },
    },
  });
};

describe('MILITARY P5 — personale NPC persistente', () => {
  it('isola personnel player/AUT/HUN e una riga NPC non soddisfa il seed sentinel player', () => {
    const { session } = createGame();
    const npcAut = { activePersonnel: 10, trainedReserve: 111, mobilizedPersonnel: 0, shipCrew: 0, updatedDate: '1940-01-01' };
    const npcHun = { activePersonnel: 20, trainedReserve: 222, mobilizedPersonnel: 0, shipCrew: 0, updatedDate: '1940-01-01' };
    // `createSession` può aver già materializzato il player per altri read model:
    // si ricrea esplicitamente lo stato legacy «solo personnel NPC».
    repositories.operationalObjectRepository.remove(session.id, PID);
    putPersonnel(session, AUT, npcAut);
    putPersonnel(session, HUN, npcHun);
    store(session).invalidate();
    expect(store(session).seeded()).toBe(false);

    const player = store(session).snapshot().personnel;
    expect(store(session).seeded()).toBe(true);
    expect(player).not.toEqual(npcAut);
    expect(player).not.toEqual(npcHun);
    expect(personnelOf(session, PID)).toEqual(player);
    expect(store(session).personnelForPolity(AUT)).toEqual(npcAut);
    expect(store(session).personnelForPolity(HUN)).toEqual(npcHun);
    store(session).invalidate();
    expect(store(session).snapshot().personnel).toEqual(player);
  });

  it('semina lazy la riserva NPC una volta sola e non la rigenera', () => {
    const session = warGame();
    expect(personnelOf(session, AUT)).toBeNull();
    (session as any).warFronts.maintainNpcUnits();
    const seeded = personnelOf(session, AUT);
    expect(seeded).toEqual(seedPersonnel(doctrineOf(session, AUT), session.currentDate));
    const consumed = { ...seeded, trainedReserve: Math.max(0, seeded.trainedReserve - 123) };
    putPersonnel(session, AUT, consumed);
    (session as any).warFronts.maintainNpcUnits();
    expect(personnelOf(session, AUT).trainedReserve).toBe(consumed.trainedReserve);
  });

  it('rinforza parzialmente 6.000→9.000 usando esattamente 3.000 uomini finiti', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    expect(doctrine.menPerFormation).toBe(10_000);
    const unit = prepareOne(session, AUT, { personnel: 6_000, equipment: { [rifleEquipmentId()]: rifleRequirement('seconda_guerra', 1) }, status: 'degraded' });
    putPersonnel(session, AUT, {
      ...seedPersonnel(doctrine, session.currentDate),
      activePersonnel: 6_000,
      trainedReserve: 3_000,
      mobilizedPersonnel: 0,
    });
    putDepot(session, AUT, {});

    const result = (session as any).warFronts.maintainNpcUnits();
    const after = unitsOf(session, AUT).find(item => item.id === unit.id);
    expect(after.personnel).toBe(9_000);
    expect(personnelOf(session, AUT).trainedReserve).toBe(0);
    expect(after.personnel - unit.personnel).toBe(3_000);
    expect(result.maintained).toContain(unit.id);
  });

  it('assegna solo 2.000 dei 5.000 fucili mancanti e conserva il deposito', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    const required = rifleRequirement('seconda_guerra', 1);
    const unit = prepareOne(session, AUT, {
      personnel: doctrine.menPerFormation,
      equipment: { [rifleEquipmentId()]: required - 5_000 },
      status: 'degraded',
    });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 0, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 2_000 });

    (session as any).warFronts.maintainNpcUnits();
    const after = unitsOf(session, AUT).find(item => item.id === unit.id);
    expect(equipmentQuantity(after.equipment, rifleEquipmentId()) - equipmentQuantity(unit.equipment, rifleEquipmentId())).toBe(2_000);
    expect(equipmentQuantity(depotOf(session, AUT), rifleEquipmentId())).toBe(0);
    expect(required - equipmentQuantity(after.equipment, rifleEquipmentId())).toBe(3_000);
  });

  it('non resuscita destroyed e non cura retreating prima del rally', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    const required = rifleRequirement('seconda_guerra', 1);
    const retreating = prepareOne(session, AUT, {
      personnel: 6_000, equipment: { [rifleEquipmentId()]: required - 2_000 },
      status: 'retreating', frontId: null, regionId: R.aut2, regionName: 'Vienna', updatedDate: '1939-01-01',
    });
    const destroyedIds = unitsOf(session, AUT).filter(unit => unit.id !== retreating.id).map(unit => unit.id);
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 4_000, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 2_000 });

    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(unit => unit.id === retreating.id)).toMatchObject({ status: 'retreating', personnel: 6_000 });
    expect(personnelOf(session, AUT).trainedReserve).toBe(4_000);

    const rallied = (session as any).warFronts.rallyRetreatingUnits(units(session), session.currentDate);
    store(session).saveUnits(rallied.units);
    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(unit => unit.id === retreating.id).personnel).toBe(10_000);
    const destroyed = unitsOf(session, AUT).filter(unit => destroyedIds.includes(unit.id));
    expect(destroyed).toHaveLength(destroyedIds.length);
    expect(destroyed.every(unit => unit.status === 'destroyed' && unit.personnel === 0 && Object.keys(unit.equipment).length === 0)).toBe(true);
  });

  it('sul fronte applica reinforce+reequip senza cambiare ordine; reserve riceve entrambi', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    const required = rifleRequirement('seconda_guerra', 1);
    const unit = prepareOne(session, AUT, {
      personnel: 8_000,
      equipment: { [rifleEquipmentId()]: required - 1_000 },
      status: 'degraded',
      order: 'attack',
    });
    expect(unit.frontId).toBeTruthy();
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 2_000, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 1_000 });
    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(item => item.id === unit.id)).toMatchObject({ personnel: 10_000, order: 'attack' });

    // Stessa aritmetica completa quando il reparto è esplicitamente in riserva.
    saveGlobalUnits(session, item => item.id === unit.id
      ? { ...item, personnel: 9_000, equipment: { [rifleEquipmentId()]: required - 500 }, order: 'reserve' }
      : item);
    putPersonnel(session, AUT, { ...personnelOf(session, AUT), trainedReserve: 1_000 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 500 });
    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(item => item.id === unit.id)).toMatchObject({ personnel: 10_000, order: 'reserve' });
    expect(equipmentQuantity(unitsOf(session, AUT).find(item => item.id === unit.id).equipment, rifleEquipmentId())).toBe(required);
  });

  it('senza risorse è idempotente e due stati uguali seguono la stessa priorità per unit.id', () => {
    const run = () => {
      const session = warGame();
      const doctrine = doctrineOf(session, AUT);
      const list = unitsOf(session, AUT).sort((a, b) => a.id.localeCompare(b.id));
      expect(list.length).toBeGreaterThan(1);
      saveGlobalUnits(session, unit => unit.polityId === AUT
        ? { ...unit, personnel: 6_000, equipment: {}, status: 'degraded' }
        : unit);
      putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), activePersonnel: 12_000, trainedReserve: 4_000, mobilizedPersonnel: 0 });
      putDepot(session, AUT, {});
      (session as any).warFronts.maintainNpcUnits();
      const after = unitsOf(session, AUT).sort((a, b) => a.id.localeCompare(b.id));
      expect(after[0].personnel).toBe(10_000);
      expect(after.slice(1).every(unit => unit.personnel === 6_000)).toBe(true);
      const stable = structuredClone(after);
      (session as any).warFronts.maintainNpcUnits();
      expect(unitsOf(session, AUT).sort((a, b) => a.id.localeCompare(b.id))).toEqual(stable);
      return stable.map(unit => ({ id: unit.id, personnel: unit.personnel, equipment: unit.equipment, status: unit.status }));
    };
    expect(run()).toEqual(run());
  });

  it('AUT e HUN usano stock separati e il replace globale conserva player, foreign e destroyed', () => {
    const { session } = createGame();
    setRelationship(session, AUT, HUN, 'hostile');
    store(session).saveFronts([{
      id: 'p5-front-aut-hun', name: 'Fronte AUT–HUN', attackerPolityId: AUT, defenderPolityId: HUN,
      regionIds: [R.aut2, R.hun1], status: 'active', objectiveRegionId: R.hun1,
      attackerPressure: 0, defenderPressure: 0, createdDate: '1940-01-01', updatedDate: '1940-01-01',
    }]);
    (session as any).warFronts.ensureNpcUnits(30);
    const playerBefore = structuredClone(unitsOf(session, PID));
    const aut = prepareOne(session, AUT, { personnel: 9_000, equipment: {}, status: 'degraded' });
    const hun = prepareOne(session, HUN, { personnel: 8_000, equipment: {}, status: 'degraded' });
    const autDoctrine = doctrineOf(session, AUT);
    const hunDoctrine = doctrineOf(session, HUN);
    putPersonnel(session, AUT, { ...seedPersonnel(autDoctrine, session.currentDate), trainedReserve: 1_000, mobilizedPersonnel: 0 });
    putPersonnel(session, HUN, { ...seedPersonnel(hunDoctrine, session.currentDate), trainedReserve: 2_000, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 300 });
    putDepot(session, HUN, { [rifleEquipmentId()]: 700 });

    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(unit => unit.id === aut.id).personnel).toBe(10_000);
    expect(unitsOf(session, HUN).find(unit => unit.id === hun.id).personnel).toBe(10_000);
    expect(personnelOf(session, AUT).trainedReserve).toBe(0);
    expect(personnelOf(session, HUN).trainedReserve).toBe(0);
    expect(depotOf(session, AUT)).toEqual({});
    expect(depotOf(session, HUN)).toEqual({});
    expect(unitsOf(session, PID)).toEqual(playerBefore);
    expect(units(session).some(unit => unit.status === 'destroyed')).toBe(true);
  });

  it('un errore di commit fa rollback di personale, unità e arsenale', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    prepareOne(session, AUT, { personnel: 9_000, equipment: {}, status: 'degraded' });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 1_000, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 100 });
    const before = {
      personnel: structuredClone(personnelOf(session, AUT)),
      units: structuredClone(units(session)),
      depot: structuredClone(depotOf(session, AUT)),
    };
    db.exec(`CREATE TRIGGER p5_fail_arsenal BEFORE UPDATE ON game_arsenals
      WHEN NEW.game_id = '${session.id}' AND NEW.polity_id = '${AUT}'
      BEGIN SELECT RAISE(ABORT, 'p5 forced failure'); END;`);
    try {
      expect(() => (session as any).warFronts.maintainNpcUnits()).toThrow(/p5 forced failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS p5_fail_arsenal');
    }
    store(session).invalidate();
    expect(personnelOf(session, AUT)).toEqual(before.personnel);
    expect(units(session)).toEqual(before.units);
    expect(depotOf(session, AUT)).toEqual(before.depot);
  });

  it('save/restore ripristina insieme personnel NPC, unità, equipaggiamento e arsenale', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    const required = rifleRequirement('seconda_guerra', 1);
    const unit = prepareOne(session, AUT, { personnel: 8_000, equipment: { [rifleEquipmentId()]: required - 1_000 }, status: 'degraded' });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 2_000, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 1_000 });
    (session as any).military.invalidateArsenalCache();
    const expected = {
      personnel: structuredClone(personnelOf(session, AUT)),
      unit: structuredClone(unitsOf(session, AUT).find(item => item.id === unit.id)),
      depot: structuredClone(depotOf(session, AUT)),
    };
    // Popola anche la cache: il restore deve invalidarla e rileggere il DB.
    expect((session as any).military.arsenalUnits(AUT)).toEqual(expected.depot);
    const saveId = session.save('p5-before-maintenance').saveId;
    const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).find(item => item.id === unit.id).personnel).toBe(10_000);

    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    expect(personnelOf(session, AUT)).toEqual(expected.personnel);
    expect(unitsOf(session, AUT).find(item => item.id === unit.id)).toEqual(expected.unit);
    expect(depotOf(session, AUT)).toEqual(expected.depot);
    expect((session as any).military.arsenalUnits(AUT)).toEqual(expected.depot);
  });

  it('dopo commit, un refresh derivato fallito invalida store e cache arsenale', () => {
    const session = warGame();
    const doctrine = doctrineOf(session, AUT);
    const required = rifleRequirement('seconda_guerra', 1);
    const unit = prepareOne(session, AUT, {
      personnel: doctrine.menPerFormation,
      equipment: { [rifleEquipmentId()]: required - 100 },
      status: 'degraded',
    });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrine, session.currentDate), trainedReserve: 0, mobilizedPersonnel: 0 });
    putDepot(session, AUT, { [rifleEquipmentId()]: 100 });
    (session as any).military.invalidateArsenalCache();
    expect((session as any).military.arsenalUnits(AUT)).toEqual({ [rifleEquipmentId()]: 100 });
    const spy = vi.spyOn(store(session), 'adoptPersisted').mockImplementation(() => {
      throw new Error('derived refresh failure');
    });
    try {
      expect(() => (session as any).warFronts.maintainNpcUnits()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(equipmentQuantity(unitsOf(session, AUT).find(item => item.id === unit.id).equipment, rifleEquipmentId())).toBe(required);
    expect((session as any).military.arsenalUnits(AUT)).toEqual({});
  });

  it('90 giorni = 3×30 anche per riserve e arsenali NPC', () => {
    const snapshot = (session: any) => ({
      personnel: personnelOf(session, AUT),
      units: unitsOf(session, AUT).map(unit => ({
        id: unit.id, personnel: unit.personnel, equipment: unit.equipment,
        status: unit.status, order: unit.order, frontId: unit.frontId,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      arsenal: depotOf(session, AUT),
      fronts: store(session).fronts().map((front: any) => ({ id: front.id, status: front.status, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure })),
    });
    const prepare = () => {
      const session = warGame();
      // La prima manutenzione crea la riserva persistente prima della guerra.
      (session as any).warFronts.maintainNpcUnits();
      session.saveResourceStock(AUT, { ...session.resourceStock(AUT), food: 1_000, weapons: 1_000, fuel: 1_000, clothing: 1_000 });
      return session;
    };
    const long = prepare();
    const longMaintenance = vi.spyOn((long as any).warFronts, 'maintainNpcUnits');
    long.advanceWorldState(90, '1940-03-31');
    expect(longMaintenance).toHaveBeenCalledTimes(3);
    const split = prepare();
    const splitMaintenance = vi.spyOn((split as any).warFronts, 'maintainNpcUnits');
    for (const date of ['1940-01-31', '1940-03-01', '1940-03-31']) split.advanceWorldState(30, date);
    expect(splitMaintenance).toHaveBeenCalledTimes(3);
    expect(snapshot(split)).toEqual(snapshot(long));
  });

  it('P5.1: le perdite riallineano activePersonnel; il rinforzo successivo conserva i delta', () => {
    const session = warGame();
    const required = rifleRequirement('seconda_guerra', 1);
    const aut = prepareOne(session, AUT, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required },
      readiness: 1, status: 'operational', order: 'defend',
    });
    prepareOne(session, PID, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required },
      readiness: 1, status: 'operational', order: 'defend',
    });
    const doctrine = doctrineOf(session, AUT);
    putPersonnel(session, AUT, {
      ...seedPersonnel(doctrine, session.currentDate),
      activePersonnel: 10_000, trainedReserve: 3_000, mobilizedPersonnel: 0, shipCrew: 17,
    });
    putDepot(session, AUT, {});
    const reserveBefore = personnelOf(session, AUT).trainedReserve;

    fightOnePeriod(session);
    const afterBattle = unitsOf(session, AUT).find(unit => unit.id === aut.id);
    const personnelAfterBattle = personnelOf(session, AUT);
    expect(afterBattle.personnel).toBeLessThan(10_000);
    expect(personnelAfterBattle.activePersonnel).toBe(activePersonnelInUnits(session, AUT));
    expect(personnelAfterBattle.trainedReserve).toBe(reserveBefore);
    expect(personnelAfterBattle.mobilizedPersonnel).toBe(0);
    expect(personnelAfterBattle.shipCrew).toBe(17);

    const unitBeforeMaintenance = afterBattle.personnel;
    const activeBeforeMaintenance = personnelAfterBattle.activePersonnel;
    (session as any).warFronts.maintainNpcUnits();
    const unitAfterMaintenance = unitsOf(session, AUT).find(unit => unit.id === aut.id).personnel;
    const personnelAfterMaintenance = personnelOf(session, AUT);
    const unitDelta = unitAfterMaintenance - unitBeforeMaintenance;
    expect(unitDelta).toBeGreaterThan(0);
    expect(personnelAfterMaintenance.activePersonnel - activeBeforeMaintenance).toBe(unitDelta);
    expect(reserveBefore - personnelAfterMaintenance.trainedReserve).toBe(unitDelta);
  });

  it('P5.1: un reparto distrutto dal combattimento non resta in activePersonnel né rinasce', () => {
    const session = warGame();
    const required = rifleRequirement('seconda_guerra', 1);
    const aut = prepareOne(session, AUT, {
      personnel: 100, equipment: { [rifleEquipmentId()]: required },
      readiness: 0.1, status: 'degraded', order: 'withdraw',
    });
    prepareOne(session, PID, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required },
      readiness: 1, status: 'operational', order: 'attack',
    });
    const doctrine = doctrineOf(session, AUT);
    putPersonnel(session, AUT, {
      ...seedPersonnel(doctrine, session.currentDate),
      activePersonnel: 100, trainedReserve: 3_000, mobilizedPersonnel: 0,
    });
    putDepot(session, AUT, {});
    const idsBefore = unitsOf(session, AUT).map(unit => unit.id).sort();

    fightOnePeriod(session);
    const destroyed = unitsOf(session, AUT).find(unit => unit.id === aut.id);
    expect(destroyed.status).toBe('destroyed');
    expect(personnelOf(session, AUT).activePersonnel).toBe(0);
    expect(personnelOf(session, AUT).trainedReserve).toBe(3_000);
    (session as any).warFronts.maintainNpcUnits();
    expect(unitsOf(session, AUT).map(unit => unit.id).sort()).toEqual(idsBefore);
    expect(unitsOf(session, AUT).find(unit => unit.id === aut.id)).toEqual(destroyed);
    expect(personnelOf(session, AUT).trainedReserve).toBe(3_000);
  });

  it('P5.1: in un fronte NPC–NPC AUT e HUN riconciliano perdite e riserve separatamente', () => {
    const { session } = createGame();
    setRelationship(session, AUT, HUN, 'hostile');
    store(session).saveFronts([{
      id: 'p51-front-aut-hun', name: 'Fronte P5.1 AUT–HUN', attackerPolityId: AUT, defenderPolityId: HUN,
      regionIds: [R.aut2, R.hun1], status: 'active', objectiveRegionId: R.hun1,
      attackerPressure: 0, defenderPressure: 0, createdDate: '1940-01-01', updatedDate: '1940-01-01',
    }]);
    (session as any).warFronts.ensureNpcUnits(30);
    const required = rifleRequirement('seconda_guerra', 1);
    prepareOne(session, AUT, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    prepareOne(session, HUN, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrineOf(session, AUT), session.currentDate), activePersonnel: 10_000, trainedReserve: 1_111, mobilizedPersonnel: 0 });
    putPersonnel(session, HUN, { ...seedPersonnel(doctrineOf(session, HUN), session.currentDate), activePersonnel: 10_000, trainedReserve: 2_222, mobilizedPersonnel: 0 });

    fightOnePeriod(session);
    expect(personnelOf(session, AUT).activePersonnel).toBe(activePersonnelInUnits(session, AUT));
    expect(personnelOf(session, HUN).activePersonnel).toBe(activePersonnelInUnits(session, HUN));
    expect(personnelOf(session, AUT).trainedReserve).toBe(1_111);
    expect(personnelOf(session, HUN).trainedReserve).toBe(2_222);
    expect(activePersonnelInUnits(session, AUT)).toBeLessThan(10_000);
    expect(activePersonnelInUnits(session, HUN)).toBeLessThan(10_000);
  });

  it('P5.1: un errore di commit non separa fronti, reparti e activePersonnel', () => {
    const session = warGame();
    const required = rifleRequirement('seconda_guerra', 1);
    const aut = prepareOne(session, AUT, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    prepareOne(session, PID, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrineOf(session, AUT), session.currentDate), activePersonnel: 10_000, trainedReserve: 3_000, mobilizedPersonnel: 0 });
    const before = {
      unit: structuredClone(unitsOf(session, AUT).find(unit => unit.id === aut.id)),
      personnel: structuredClone(personnelOf(session, AUT)),
      fronts: structuredClone(store(session).persistedFronts()),
      regions: [...(session as any).regions.values()].map((region: any) => ({
        id: region.id, owner: region.owner, color: region.color, militaryPower: region.militaryPower,
      })),
    };
    db.exec(`CREATE TRIGGER p51_fail_units BEFORE UPDATE ON game_operational_objects
      WHEN NEW.game_id = '${session.id}' AND NEW.kind = 'unit'
      BEGIN SELECT RAISE(ABORT, 'p5.1 forced failure'); END;`);
    try {
      expect(() => fightOnePeriod(session)).toThrow(/p5\.1 forced failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS p51_fail_units');
    }
    store(session).invalidate();
    expect(unitsOf(session, AUT).find(unit => unit.id === aut.id)).toEqual(before.unit);
    expect(personnelOf(session, AUT)).toEqual(before.personnel);
    expect(store(session).persistedFronts()).toEqual(before.fronts);
    expect([...(session as any).regions.values()].map((region: any) => ({
      id: region.id, owner: region.owner, color: region.color, militaryPower: region.militaryPower,
    }))).toEqual(before.regions);
  });

  it('P5.1: save/restore ripristina unità e personale NPC post-battaglia', () => {
    const session = warGame();
    const required = rifleRequirement('seconda_guerra', 1);
    const aut = prepareOne(session, AUT, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    prepareOne(session, PID, {
      personnel: 10_000, equipment: { [rifleEquipmentId()]: required }, readiness: 1, status: 'operational', order: 'defend',
    });
    putPersonnel(session, AUT, { ...seedPersonnel(doctrineOf(session, AUT), session.currentDate), activePersonnel: 10_000, trainedReserve: 3_000, mobilizedPersonnel: 0 });
    fightOnePeriod(session);
    const expectedUnit = structuredClone(unitsOf(session, AUT).find(unit => unit.id === aut.id));
    const expectedPersonnel = structuredClone(personnelOf(session, AUT));
    const saveId = session.save('p5.1-post-battle').saveId;
    const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;

    saveGlobalUnits(session, unit => unit.id === aut.id ? { ...unit, personnel: 1, status: 'destroyed' } : unit);
    putPersonnel(session, AUT, { ...expectedPersonnel, activePersonnel: 999_999, trainedReserve: 0 });
    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    expect(unitsOf(session, AUT).find(unit => unit.id === aut.id)).toEqual(expectedUnit);
    expect(personnelOf(session, AUT)).toEqual(expectedPersonnel);
  });

  it('gli ownership guard REST P4.1/P4.1.1 restano 403 per action e order NPC', () => {
    const session = warGame();
    const npc = unitsOf(session, AUT)[0];
    const before = structuredClone(npc);
    const action = callMilitaryRoute(
      '/:id/military/units/:unitId/:action(reinforce|reequip|transfer|reassign|reconstitute)',
      { id: session.id, unitId: npc.id, action: 'reinforce' },
      { men: 1 },
    );
    const order = callMilitaryRoute(
      '/:id/military/units/:unitId/order',
      { id: session.id, unitId: npc.id },
      { order: 'attack' },
    );
    expect(action).toMatchObject({ status: 403, body: { code: 'unit_forbidden' } });
    expect(order).toMatchObject({ status: 403, body: { code: 'unit_forbidden' } });
    expect(unitsOf(session, AUT).find(unit => unit.id === npc.id)).toEqual(before);
  });
});
