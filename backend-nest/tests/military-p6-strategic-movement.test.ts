/** MILITARY P6 — trasferimento strategico persistente e tempo di viaggio. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { movementDaysPerHop } from '../src/core/simulation/MilitaryMovement';

const TEST_DB = path.join(os.tmpdir(), `world-story-p6-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD = 'p6_world';
const PID = 'ITA';
const AUT = 'AUT';
const R = {
  a: `${WORLD}_A`, b: `${WORLD}_B`, c: `${WORLD}_C`, d: `${WORLD}_D`, enemy: `${WORLD}_AUT`,
};

let db: any;
let registry: any;
let gamesRouter: any;
let createGame: () => { gameId: string; session: any };

const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) { onToken(1); return { content: '{}' }; },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repositories = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(provider);
  registry = registryModule.getSessionRegistry();
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  repositories.worldRepository.createWithRegions(
    { id: WORLD, name: 'P6 World', description: '', startDate: '1940-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: R.a, name: 'Roma', color: '#cc0000', owner: PID, population: 10_000_000, gdp: 500,
        militaryPower: 100, flag: PID, borders: [R.b],
        objects: [{ id: 'army-p6', type: 'army', name: 'Armata P6', level: 1 }],
      },
      { id: R.b, name: 'Firenze', color: '#dd2222', owner: PID, population: 5_000_000, gdp: 200, militaryPower: 50, flag: PID, borders: [R.a, R.c], objects: [] },
      { id: R.c, name: 'Bologna', color: '#ee4444', owner: PID, population: 4_000_000, gdp: 180, militaryPower: 40, flag: PID, borders: [R.b, R.d], objects: [] },
      { id: R.d, name: 'Verona', color: '#ff6666', owner: PID, population: 3_000_000, gdp: 140, militaryPower: 30, flag: PID, borders: [R.c, R.enemy], objects: [] },
      {
        id: R.enemy, name: 'Tirolo', color: '#00aa00', owner: AUT, population: 4_000_000, gdp: 160,
        militaryPower: 200, flag: AUT, borders: [R.d],
        objects: [{ id: 'army-aut', type: 'army', name: 'Bundesheer', level: 1 }],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD, 'Player', R.a, '#cc0000');
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(TEST_DB + suffix)) fs.rmSync(TEST_DB + suffix);
  } catch { /* tmp */ }
});

const store = (session: any) => session.operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const unit = (session: any) => units(session).find(item => String(item.polityId) === PID && item.status !== 'destroyed');
const stock = (session: any) => session.resourceStock(PID);
const setStock = (session: any, patch: Record<string, unknown>) => session.saveResourceStock(PID, { ...stock(session), ...patch });
const setTech = (session: any, technologies: string[]) => setStock(session, { technologies });
const transfer = (session: any, target: string, dryRun = false) => session.unitAction({
  action: 'transfer', unitId: unit(session).id, regionId: target, dryRun,
});
const advance = (session: any, days: number, date: string) => (session as any).warFronts.advanceUnitMovements(days, date);
const setStatus = (session: any, status: string) => {
  const chosen = unit(session);
  store(session).saveUnits(units(session).map(item => item.id === chosen.id ? { ...item, status } : item));
  return chosen.id;
};
const checkpoint = (session: any, name = 'p6-cp') => {
  const saveId = session.save(name).saveId;
  const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
  return { saveId, data: JSON.parse(row.data), hash: row.content_hash as string };
};
const movementSnapshot = (session: any) => {
  const current = unit(session);
  return {
    id: current.id, polityId: current.polityId, armyId: current.armyId,
    regionId: current.regionId, regionName: current.regionName, frontId: current.frontId,
    personnel: current.personnel, equipment: current.equipment, movement: current.movement,
  };
};
const routeAction = (session: any, unitId: string, regionId: string) => {
  const layer = gamesRouter.stack.find((item: any) => item.route?.path === '/:id/military/units/:unitId/:action(reinforce|reequip|transfer|reassign|reconstitute)' && item.route.methods.post);
  let response: any;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { response = { status: this.statusCode, body }; return this; },
  };
  layer.route.stack[0].handle({ method: 'POST', params: { id: session.id, unitId, action: 'transfer' }, body: { regionId } }, res);
  return response;
};

// Un solo motore comune: questi test chiamano sia l'azione pubblica sia lo
// stesso avanzamento usato dai substep materiali/live.
describe('MILITARY P6 — persistent strategic movement', () => {
  it('1: transfer crea la marcia senza teletrasporto e sgancia il fronte', () => {
    const { session } = createGame();
    const before = unit(session);
    const result = transfer(session, R.c);
    expect(result.blocked).toBe(false);
    expect(result.unit.regionId).toBe(R.a);
    expect(result.unit.frontId).toBeNull();
    expect(result.unit.movement).toMatchObject({ path: [R.a, R.b, R.c], targetRegionId: R.c, pathIndex: 0, totalHops: 2 });
  });

  it('2: appiedato — a 29 giorni resta in A, al giorno 30 arriva in B', () => {
    const { session } = createGame();
    setTech(session, []);
    transfer(session, R.b);
    advance(session, 29, '1940-01-30');
    expect(unit(session)).toMatchObject({ regionId: R.a, movement: { remainingDaysToNextHop: 1 } });
    advance(session, 1, '1940-01-31');
    expect(unit(session).regionId).toBe(R.b);
    expect(unit(session).movement).toBeUndefined();
  });

  it('3: motorizzazione dimezza una tratta a 15 giorni', () => {
    const { session } = createGame();
    setTech(session, ['motorizzazione']);
    expect(transfer(session, R.b).unit.movement.daysPerHop).toBe(15);
    advance(session, 14, '1940-01-15');
    expect(unit(session).regionId).toBe(R.a);
    advance(session, 1, '1940-01-16');
    expect(unit(session).regionId).toBe(R.b);
  });

  it('4: motorizzazione + logistica avanzata richiedono 12 giorni per tratta', () => {
    expect(movementDaysPerHop({ motorized: true, advancedLogistics: true })).toBe(12);
    const { session } = createGame();
    setTech(session, ['motorizzazione', 'logistica_avanzata']);
    expect(transfer(session, R.b).unit.movement.daysPerHop).toBe(12);
  });

  it('5: percorso multi-hop avanza A → B → C → D senza comparire subito in D', () => {
    const { session } = createGame();
    setTech(session, []);
    transfer(session, R.d);
    expect(unit(session).regionId).toBe(R.a);
    advance(session, 30, '1940-01-31');
    expect(unit(session)).toMatchObject({ regionId: R.b, movement: { pathIndex: 1 } });
    advance(session, 30, '1940-03-01');
    expect(unit(session)).toMatchObject({ regionId: R.c, movement: { pathIndex: 2 } });
    advance(session, 30, '1940-03-31');
    expect(unit(session).regionId).toBe(R.d);
    expect(unit(session).movement).toBeUndefined();
  });

  it('6: un substep completa tutte le tratte coperte dal tempo disponibile', () => {
    const { session } = createGame();
    setTech(session, ['motorizzazione']);
    transfer(session, R.c);
    advance(session, 30, '1940-01-31');
    expect(unit(session).regionId).toBe(R.c);
    expect(unit(session).movement).toBeUndefined();
  });

  it('7: il costo viene pagato una sola volta, mai durante hop o arrivo', () => {
    const { session } = createGame();
    setTech(session, []);
    const before = structuredClone(stock(session));
    transfer(session, R.b);
    const paid = structuredClone(stock(session));
    expect(paid.food).toBeLessThan(before.food);
    advance(session, 10, '1940-01-11');
    expect(stock(session)).toEqual(paid);
    advance(session, 20, '1940-01-31');
    expect(stock(session)).toEqual(paid);
  });

  it('7-bis: durante la marcia restano i fabbisogni strutturali, senza moltiplicatore di fronte', () => {
    const { session } = createGame();
    const before = store(session).militaryNeeds();
    expect(before.weapons).toBeGreaterThan(0);
    transfer(session, R.c);
    const during = store(session).militaryNeeds();
    expect(during).toEqual(before);
  });

  it('7-ter: fallimento del pagamento non crea la marcia', () => {
    const { session } = createGame();
    const beforeStock = structuredClone(stock(session));
    const beforeUnit = structuredClone(unit(session));
    db.exec(`CREATE TRIGGER p6_fail_resource BEFORE UPDATE ON game_resource_stocks
      WHEN NEW.game_id = '${session.id}' AND NEW.polity_id = '${PID}'
      BEGIN SELECT RAISE(ABORT, 'p6 resource failure'); END;`);
    try {
      expect(() => transfer(session, R.b)).toThrow(/p6 resource failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS p6_fail_resource');
    }
    expect(stock(session)).toEqual(beforeStock);
    expect(unit(session)).toEqual(beforeUnit);
  });

  it('7-quater: fallimento della scrittura reparto annulla anche il pagamento', () => {
    const { session } = createGame();
    const beforeStock = structuredClone(stock(session));
    const beforeUnit = structuredClone(unit(session));
    db.exec(`CREATE TRIGGER p6_fail_order BEFORE UPDATE ON game_operational_objects
      WHEN NEW.game_id = '${session.id}' AND NEW.kind = 'unit'
      BEGIN SELECT RAISE(ABORT, 'p6 unit failure'); END;`);
    try {
      expect(() => transfer(session, R.b)).toThrow(/p6 unit failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS p6_fail_order');
    }
    expect(stock(session)).toEqual(beforeStock);
    expect(unit(session)).toEqual(beforeUnit);
  });

  it('7-quinquies: un hop non persistito non viene annunciato né adottato in cache', () => {
    const { session } = createGame();
    transfer(session, R.b);
    const before = structuredClone(unit(session));
    db.exec(`CREATE TRIGGER p6_fail_hop BEFORE UPDATE ON game_operational_objects
      WHEN NEW.game_id = '${session.id}' AND NEW.kind = 'unit'
      BEGIN SELECT RAISE(ABORT, 'p6 hop failure'); END;`);
    try {
      expect(() => advance(session, 30, '1940-01-31')).toThrow(/p6 hop failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS p6_fail_hop');
    }
    expect(unit(session)).toEqual(before);
  });

  it('8: dryRun espone percorso, tempi, arrivo e costi senza mutare stato', () => {
    const { session } = createGame();
    setTech(session, []);
    const unitsBefore = structuredClone(units(session));
    const stockBefore = structuredClone(stock(session));
    const preview = transfer(session, R.c, true);
    expect(preview.applied).toBe(false);
    expect(preview.movement).toMatchObject({
      path: [R.a, R.b, R.c], pathNames: ['Roma', 'Firenze', 'Bologna'], hops: 2, daysPerHop: 30, totalDays: 60,
    });
    expect(preview.movement.estimatedArrivalDate).toBe('1940-03-01');
    expect(preview.rows.map((row: any) => row.label)).toEqual(expect.arrayContaining(['Cibo (scorte)', 'Carburante (scorte)', 'Cassa']));
    expect(units(session)).toEqual(unitsBefore);
    expect(stock(session)).toEqual(stockBefore);
  });

  it('9: un reparto in movimento non combatte né subisce perdite', () => {
    const { session } = createGame();
    session.diplomacy.matrix().set(PID, AUT, 'hostile');
    session.diplomacy.matrix().set(AUT, PID, 'hostile');
    // Porta fisicamente il reparto nel teatro, sincronizza, poi ordina di uscirne.
    store(session).saveUnits(units(session).map(item => String(item.polityId) === PID ? { ...item, regionId: R.d, regionName: 'Verona' } : item));
    session.publicFronts();
    const chosen = unit(session);
    expect(chosen.frontId).toBeTruthy();
    session.unitAction({ action: 'transfer', unitId: chosen.id, regionId: R.c });
    const personnel = unit(session).personnel;
    expect(unit(session).frontId).toBeNull();
    (session as any).warFronts.advanceFronts(15, '1940-01-16', { legacyOrdersByFront: {}, supply: {} });
    expect(unit(session).personnel).toBe(personnel);
    expect(unit(session).movement).toBeTruthy();
  });

  it('10: all’arrivo solo syncFronts assegna normalmente il nuovo fronte', () => {
    const { session } = createGame();
    session.diplomacy.matrix().set(PID, AUT, 'hostile');
    session.diplomacy.matrix().set(AUT, PID, 'hostile');
    session.publicFronts();
    transfer(session, R.d);
    advance(session, 90, '1940-03-31');
    expect(unit(session).frontId).toBeNull();
    (session as any).warFronts.syncFronts();
    expect(unit(session).frontId).toBeTruthy();
  });

  it('11: se la prossima regione diventa ostile, la marcia si interrompe nell’ultima raggiunta', () => {
    const { session } = createGame();
    setTech(session, []);
    transfer(session, R.c);
    advance(session, 30, '1940-01-31');
    expect(unit(session).regionId).toBe(R.b);
    (session as any).regions.get(R.c).owner = AUT;
    const report = advance(session, 7, '1940-02-07');
    expect(unit(session).regionId).toBe(R.b);
    expect(unit(session).movement).toBeUndefined();
    expect(report.events.some((line: string) => line.includes('Trasferimento interrotto'))).toBe(true);
  });

  it('12: destroyed non può iniziare transfer', () => {
    const { session } = createGame();
    const id = setStatus(session, 'destroyed');
    const result = session.unitAction({ action: 'transfer', unitId: id, regionId: R.b });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toMatch(/distrutto/i);
  });

  it('13: retreating non può iniziare transfer', () => {
    const { session } = createGame();
    const id = setStatus(session, 'retreating');
    const result = session.unitAction({ action: 'transfer', unitId: id, regionId: R.b });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toMatch(/ritirata/i);
  });

  it('14: un secondo transfer è bloccato e non altera la marcia originale', () => {
    const { session } = createGame();
    transfer(session, R.c);
    const original = structuredClone(unit(session).movement);
    const second = transfer(session, R.d);
    expect(second.blocked).toBe(true);
    expect(unit(session).movement).toEqual(original);
  });

  it('15: reinforce, reequip, reconstitute e reassign sono bloccati durante la marcia', () => {
    const { session } = createGame();
    const moving = transfer(session, R.b).unit;
    for (const request of [
      { action: 'reinforce', unitId: moving.id, men: 1 },
      { action: 'reequip', unitId: moving.id },
      { action: 'reconstitute', unitId: moving.id },
      { action: 'reassign', unitId: moving.id, armyId: 'other-army' },
    ]) {
      const result = session.unitAction(request);
      expect(result.blocked).toBe(true);
      expect(result.blockedReason).toMatch(/trasferimento/i);
    }
  });

  it('16: arrivo conserva id, polity, army, uomini ed equipaggiamento', () => {
    const { session } = createGame();
    const before = movementSnapshot(session);
    transfer(session, R.d);
    advance(session, 90, '1940-03-31');
    const after = movementSnapshot(session);
    expect(after).toMatchObject({
      id: before.id, polityId: before.polityId, armyId: before.armyId,
      personnel: before.personnel, equipment: before.equipment, regionId: R.d,
    });
  });

  it('17: save/rewind a metà marcia ripristina posizione, progressione e costo già pagato', () => {
    const { session } = createGame();
    transfer(session, R.c);
    advance(session, 30, '1940-01-31');
    const expected = movementSnapshot(session);
    const expectedStock = structuredClone(stock(session));
    const cp = checkpoint(session);
    advance(session, 30, '1940-03-01');
    expect(unit(session).regionId).toBe(R.c);
    session.loadFromSave(cp.data, cp.hash);
    expect(movementSnapshot(session)).toEqual(expected);
    expect(stock(session)).toEqual(expectedStock);
    advance(session, 30, '1940-03-01');
    expect(stock(session)).toEqual(expectedStock);
  });

  it('18: due rami dal checkpoint mantengono progressioni isolate', () => {
    const { session } = createGame();
    transfer(session, R.c);
    advance(session, 30, '1940-01-31');
    const cp = checkpoint(session, 'p6-branch-point');
    const branchA = session.loadFromSave(structuredClone(cp.data), cp.hash, { newBranch: { name: 'p6-A' } }).branchId;
    advance(session, 30, '1940-03-01');
    expect(unit(session).regionId).toBe(R.c);
    const branchB = session.loadFromSave(structuredClone(cp.data), cp.hash, { newBranch: { name: 'p6-B' } }).branchId;
    expect(branchA).not.toBe(branchB);
    expect(unit(session)).toMatchObject({ regionId: R.b, movement: { pathIndex: 1, remainingDaysToNextHop: 30 } });
  });

  it('19: 90 giorni equivalgono a 3 × 30', () => {
    const prepare = () => {
      const session = createGame().session;
      setTech(session, []);
      transfer(session, R.d);
      return session;
    };
    const long = prepare();
    (long as any).advanceWorldState(90, '1940-03-31');
    const split = prepare();
    for (const date of ['1940-01-31', '1940-03-01', '1940-03-31']) (split as any).advanceWorldState(30, date);
    expect(movementSnapshot(split)).toEqual(movementSnapshot(long));
    expect(stock(split)).toEqual(stock(long));
  });

  it('20: tick live da 7 giorni equivalgono allo stesso tempo totale', () => {
    const prepare = () => {
      const session = createGame().session;
      setTech(session, []);
      transfer(session, R.c);
      return session;
    };
    const weekly = prepare();
    for (const [index, date] of ['1940-01-08', '1940-01-15', '1940-01-22', '1940-01-29', '1940-02-05'].entries()) {
      advance(weekly, 7, date);
      expect(index).toBeGreaterThanOrEqual(0);
    }
    const single = prepare();
    advance(single, 35, '1940-02-05');
    expect(movementSnapshot(weekly)).toEqual(movementSnapshot(single));
  });

  it('21: ownership REST continua a rifiutare il transfer di un reparto NPC con HTTP 403', () => {
    const { session } = createGame();
    session.diplomacy.matrix().set(PID, AUT, 'hostile');
    session.diplomacy.matrix().set(AUT, PID, 'hostile');
    const player = unit(session);
    store(session).saveUnits(units(session).map(item => item.id === player.id
      ? { ...item, regionId: R.d, regionName: 'Verona' }
      : item));
    session.publicFronts();
    (session as any).warFronts.ensureNpcUnits(30);
    const npc = units(session).find(item => String(item.polityId) === AUT);
    const response = routeAction(session, npc.id, R.d);
    expect(response).toMatchObject({ status: 403, body: { code: 'unit_forbidden' } });
  });

  it('read model mostra stato, percorso, avanzamento e arrivo della marcia', () => {
    const { session } = createGame();
    transfer(session, R.c);
    advance(session, 30, '1940-01-31');
    const picture = (session as any).military.getOperatingPicture();
    const object = picture.objects.find((item: any) => item.id === unit(session).id);
    expect(object.statusLabel).toBe('In trasferimento');
    const descriptions = object.facts.map((fact: any) => `${fact.label}: ${fact.detail || fact.text || ''}`).join('\n');
    expect(descriptions).toContain('Destinazione');
    expect(descriptions).toContain('Roma → Firenze → Bologna');
    expect(descriptions).toContain('1 / 2 tratte');
    expect(descriptions).toContain('1940-03-01');
    expect(object.actions.every((action: any) => action.enabled === false)).toBe(true);
  });
});
