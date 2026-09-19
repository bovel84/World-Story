/**
 * MILITARY-UNITS PR1 — i **reparti** (unità) sotto l'armata.
 * =========================================================
 *
 * Principi verificati:
 *  1. `MilitaryUnitState` è **persistito** (`game_operational_objects`, kind
 *     `unit`) e sopravvive al ricaricamento della sessione;
 *  2. la materializzazione dei reparti di un'armata legacy è **lazy** e
 *     **idempotente**: una volta sola, e la somma non cambia;
 *  3. l'armata è **la somma dei suoi reparti** (uomini, pezzi, fabbisogni,
 *     numero di reparti): una sola fonte di verità;
 *  4. `raiseFormation` crea un reparto **reale** con uomini e pezzi trasferiti,
 *     senza creare uomini dal nulla e senza cambiare il totale nazionale;
 *  5. le azioni del reparto (Rinforza · Riequipaggia · Trasferisci · Cambia
 *     armata) usano le regole del motore (riserva, deposito, costo di movimento)
 *     e restituiscono il PRIMA → DOPO, con l'anteprima `dryRun` che non scrive;
 *  6. il read model `/arsenal` mostra i reparti **reali** sotto la loro armata.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { movementCost } from '../src/core/simulation/MaterialEconomy';

const TEST_DB = path.join(os.tmpdir(), `world-story-units-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'units_world';
let db: any;
let registry: any;
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
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Units World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 59_000_000, gdp: 2100, militaryPower: 320, flag: 'ITA', coastal: true,
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'p1', type: 'port', name: 'Porto', level: 3 },
          { id: 'a1', type: 'army', name: '1ª Armata', level: 4 },
        ],
      },
      {
        id: `${WORLD_ID}_ITA2`, name: 'Italia centrale', color: '#FF8888', owner: 'ITA',
        population: 20_000_000, gdp: 700, militaryPower: 90, flag: 'ITA',
        objects: [],
      },
      {
        id: `${WORLD_ID}_AUT`, name: 'Austria', color: '#00FF00', owner: 'AUT',
        population: 9_000_000, gdp: 400, militaryPower: 40, flag: 'AUT',
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 2 }],
      },
      {
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 40_000_000, gdp: 1500, militaryPower: 200, flag: 'FRA', coastal: true,
        objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
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

const PID = 'ITA';

const store = (session: any) => (session as any).operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const armies = (session: any): any[] => store(session).armies();
const unitOf = (session: any, id: string) => units(session).find(unit => String(unit.id) === String(id));
const armyOf = (session: any, id: string) => armies(session).find(army => String(army.id) === String(id));
const stock = (session: any) => (session as any).resourceStock(PID);
const personnel = (session: any) => store(session).personnel();
const setArsenal = (session: any, unit: number) => {
  const current = (session as any).military.arsenalUnits(PID);
  (session as any).military.saveArsenal(PID, { ...current, fucili: unit });
};
const sumOf = (rows: any[], pick: (row: any) => number) => rows.reduce((total, row) => total + pick(row), 0);
const equipmentSum = (bag: Record<string, number> | undefined, id: string) =>
  Math.round(Object.entries(bag || {}).reduce((total, [key, value]) => (key === id ? total + Number(value || 0) : total), 0));

describe('MILITARY-UNITS — grammatica del reparto (puro)', () => {
  it('1: il nome del reparto segue l\'epoca, l\'id è del figlio dell\'armata', async () => {
    const engine = await import('../src/core/simulation/OperationalState');
    expect(engine.unitNameFor('pre_industriale', 1)).toBe('1° Reggimento');
    expect(engine.unitNameFor('grande_guerra', 2)).toBe('2ª Divisione');
    expect(engine.unitNameFor('seconda_guerra', 3)).toBe('3ª Divisione');
    expect(engine.unitNameFor('moderno', 4)).toBe('4ª Brigata');
    expect(engine.unitIdFor('a1', 7)).toBe('a1-unit-007');
    expect(engine.unitNumberOf({ id: 'a1-unit-012' })).toBe(12);
    expect(engine.unitNumberOf({ id: 'a1' })).toBe(0);
  });

  it('2: la prontezza è derivata da organico, dotazione e stato dichiarato', async () => {
    const engine = await import('../src/core/simulation/OperationalState');
    const full = { personnel: 12_000, equipment: { fucili: 6_000 }, status: 'operational' as const };
    const bare = { personnel: 12_000, equipment: {}, status: 'operational' as const };
    const dead = { personnel: 12_000, equipment: { fucili: 6_000 }, status: 'destroyed' as const };
    const weak = { personnel: 3_000, equipment: { fucili: 1_500 }, status: 'operational' as const };
    expect(engine.unitReadiness({ unit: full, epoch: 'moderno' })).toBeGreaterThan(engine.unitReadiness({ unit: bare, epoch: 'moderno' }));
    expect(engine.unitReadiness({ unit: dead, epoch: 'moderno' })).toBe(0);
    expect(engine.unitReadiness({ unit: weak, epoch: 'moderno' })).toBeLessThan(engine.unitReadiness({ unit: full, epoch: 'moderno' }));
    expect(engine.unitReadiness({ unit: full, epoch: 'moderno' })).toBeLessThanOrEqual(1);
  });

  it('3: la divisione di un totale in N parti non ne cambia la somma', async () => {
    const engine = await import('../src/core/simulation/OperationalState');
    expect(engine.splitExact(10, 3)).toEqual([3, 3, 4]);
    expect(sumOf(engine.splitExact(10, 3), value => value)).toBe(10);
    expect(sumOf(engine.splitExact(0.5, 3, 3), value => value)).toBeCloseTo(0.5, 3);
    expect(sumOf(engine.splitExact(7, 7), value => value)).toBe(7);
  });

  it('4: un reparto distrutto non conta nell\'armata (la somma è dei reparti attivi)', async () => {
    const engine = await import('../src/core/simulation/OperationalState');
    const army = {
      id: 'a1', name: 'Armata', regionId: null, regionName: null, formations: 2, personnel: 20_000,
      equipment: { fucili: 200 }, monthlyNeeds: { fuel: 0.06, weapons: 0.4, food: 0.12 },
      status: 'operational' as const, objectId: 'a1', createdDate: '2026-01-01', legacyDerived: false,
    };
    const alive = engine.emptyUnit({ id: 'a1-unit-001', armyId: 'a1', epoch: 'moderno', date: '2026-01-01', index: 1 });
    const gone = { ...engine.emptyUnit({ id: 'a1-unit-002', armyId: 'a1', epoch: 'moderno', date: '2026-01-01', index: 2 }), personnel: 9_000, status: 'destroyed' as const };
    const withGone = engine.aggregateArmyFromUnits(army, [{ ...alive, personnel: 10_000 }, gone]);
    expect(withGone.formations).toBe(1);
    expect(withGone.personnel).toBe(10_000);
  });

  it('5: un mondo che dichiara più reparti ne crea di **vuoti** (nessun uomo dal nulla)', async () => {
    const engine = await import('../src/core/simulation/OperationalState');
    const army = {
      id: 'a1', name: 'Armata', regionId: 'r1', regionName: 'Roma', formations: 1, personnel: 10_000,
      equipment: { fucili: 100 }, monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 },
      status: 'operational' as const, objectId: 'a1', createdDate: '2026-01-01', legacyDerived: false,
    };
    const existing = engine.materializeUnitsForArmy({ army, epoch: 'moderno', date: '2026-01-01', formations: 1, existing: [] });
    expect(existing).toHaveLength(1);
    expect(existing[0].personnel).toBe(10_000);
    const topped = engine.materializeUnitsForArmy({ army, epoch: 'moderno', date: '2026-01-02', formations: 3, existing });
    expect(topped).toHaveLength(3);
    expect(topped[2].status).toBe('forming');
    expect(topped[2].personnel).toBe(0);
    expect(sumOf(topped, unit => unit.personnel)).toBe(10_000);
    // Idempotente: richiamata con lo stesso mondo non cambia nulla.
    const again = engine.materializeUnitsForArmy({ army, epoch: 'moderno', date: '2026-01-02', formations: 3, existing: topped });
    expect(JSON.stringify(again)).toBe(JSON.stringify(topped));
  });
});

describe('MILITARY-UNITS — materializzazione lazy e idempotente (P2)', () => {
  it('6: un\'armata legacy di 4 reparti diventa 4 reparti reali, senza cambiare la somma', () => {
    const { session } = createGame();
    const army = armyOf(session, 'a1');
    const list = units(session).filter(unit => String(unit.armyId) === 'a1');
    expect(army.formations).toBe(4);
    expect(list).toHaveLength(4);
    expect(list.map(unit => unit.id)).toEqual(['a1-unit-001', 'a1-unit-002', 'a1-unit-003', 'a1-unit-004']);
    expect(list[0].name).toBe('1ª Brigata');
    expect(list[3].name).toBe('4ª Brigata');
    // La somma: l'aggregato dell'armata **è** quella dei reparti.
    expect(sumOf(list, unit => unit.personnel)).toBe(army.personnel);
    expect(sumOf(list, unit => equipmentSum(unit.equipment, 'fucili'))).toBe(equipmentSum(army.equipment, 'fucili'));
    expect(sumOf(list, unit => unit.monthlyNeeds.fuel)).toBeCloseTo(army.monthlyNeeds.fuel, 3);
    expect(sumOf(list, unit => unit.monthlyNeeds.weapons)).toBeCloseTo(army.monthlyNeeds.weapons, 3);
    expect(list.every(unit => unit.legacyDerived)).toBe(true);
  });

  it('7: la seconda lettura non duplica nulla (idempotenza)', () => {
    const { session } = createGame();
    const before = JSON.stringify(units(session));
    store(session).snapshot();
    store(session).snapshot();
    expect(JSON.stringify(units(session))).toBe(before);
    expect(units(session).filter(unit => String(unit.armyId) === 'a1')).toHaveLength(4);
  });

  it('8: il livello della mappa è **seed**, non una seconda fonte: i reparti non si reinventano', () => {
    const { session } = createGame();
    const before = units(session).filter(unit => String(unit.armyId) === 'a1');
    expect(before).toHaveLength(4);
    // MILITARY/WARFRONT INTEGRITY P1-2: dopo la materializzazione iniziale la
    // fonte autorevole è `MilitaryUnit[]`. Azzerare l'aggregato **non** cancella
    // i reparti persistiti e il numero dichiarato dall'oggetto della mappa
    // **non** ne ricrea (era la «phantom unit» del reassign).
    store(session).saveArmies(armies(session).map(army => ({
      ...army, formations: 0, personnel: 0, monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
    })));
    const list = units(session).filter(unit => String(unit.armyId) === 'a1');
    expect(list).toHaveLength(4);
    expect(sumOf(list, unit => unit.personnel)).toBe(armyOf(session, 'a1').personnel);
    // E cancellare davvero i reparti non li fa rinascere dal livello della mappa.
    store(session).saveUnits([]);
    expect(units(session).filter(unit => String(unit.armyId) === 'a1')).toHaveLength(0);
  });

  it('9: i reparti sono persistiti come oggetti propri (kind `unit`)', async () => {
    const { session } = createGame();
    const { operationalObjectRepository } = await import('../src/repositories');
    const ids = operationalObjectRepository.idsOfKind((session as any).id, 'unit');
    expect(ids).toContain('a1-unit-001');
    expect(ids.length).toBe(units(session).length);
    const row = operationalObjectRepository.list((session as any).id, 'unit')
      .find(item => item.id === 'a1-unit-001');
    expect((row?.data as any).armyId).toBe('a1');
    expect(typeof (row?.data as any).readiness).toBe('number');
  });

  it('10: dopo il ricaricamento della sessione i reparti sono gli stessi', async () => {
    const { session, gameId } = createGame();
    const before = JSON.parse(JSON.stringify(units(session)));
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(JSON.parse(JSON.stringify(units(reloaded)))).toEqual(before);
  });
});

describe('MILITARY-UNITS — raiseFormation crea un reparto reale (P3)', () => {
  it('11: il reparto nasce con gli uomini e i pezzi trasferiti, l\'armata cresce di uno', () => {
    const { session } = createGame();
    const before = armyOf(session, 'a1');
    const result = session.raiseFormation({ formations: 1, armyId: 'a1' });
    const after = armyOf(session, 'a1');
    const created = unitOf(session, result.unit.id);
    expect(result.unit.id).toBe('a1-unit-005');
    expect(created).toBeTruthy();
    expect(created.legacyDerived).toBe(false);
    expect(created.personnel).toBe(result.men);
    expect(created.armyId).toBe('a1');
    expect(after.formations).toBe(before.formations + 1);
    expect(after.personnel).toBe(before.personnel + result.men);
    expect(sumOf(units(session).filter(unit => unit.armyId === 'a1'), unit => unit.personnel)).toBe(after.personnel);
  });

  it('12: gli uomini vengono dalla riserva, non dal nulla', () => {
    const { session } = createGame();
    const before = personnel(session);
    const result = session.raiseFormation({ formations: 1, armyId: 'a1' });
    const after = personnel(session);
    expect(after.trainedReserve).toBe(before.trainedReserve - result.men);
    expect(after.activePersonnel).toBe(before.activePersonnel + result.men);
    const total = (state: any) => state.activePersonnel + state.trainedReserve + state.mobilizedPersonnel + state.shipCrew;
    expect(total(after)).toBe(total(before));
  });

  it('13: deposito + assegnato resta il totale nazionale dell\'equipaggiamento', () => {
    const { session } = createGame();
    const before = (session as any).military.nationalUnits(PID);
    session.raiseFormation({ formations: 1, armyId: 'a1' });
    const after = (session as any).military.nationalUnits(PID);
    for (const id of ['fucili', 'artiglieria']) {
      expect(after[id] ?? 0).toBe(before[id] ?? 0);
    }
  });
});

describe('MILITARY-UNITS — azioni del reparto (P5)', () => {
  it('14: Rinforza prende gli uomini dalla riserva e aggiorna il PRIMA → DOPO', () => {
    const { session } = createGame();
    // Un reparto sotto organico (3.000 su 12.000): è il caso in cui si rinforza.
    const weakened = unitOf(session, 'a1-unit-001');
    store(session).saveUnits(units(session).map(item => (item.id === weakened.id
      ? { ...item, personnel: 3_000 }
      : item)));
    const unit = unitOf(session, weakened.id);
    const before = personnel(session);
    const result = session.unitAction({ action: 'reinforce', unitId: unit.id, men: 500 });
    expect(result.blocked).toBe(false);
    expect(result.applied).toBe(true);
    const after = unitOf(session, unit.id);
    expect(after.personnel).toBe(unit.personnel + 500);
    expect(personnel(session).trainedReserve).toBe(before.trainedReserve - 500);
    const row = result.rows.find((item: any) => item.label === 'Uomini del reparto');
    expect(row.before).toBeCloseTo(unit.personnel, 3);
    expect(row.after).toBeCloseTo(after.personnel, 3);
  });

  it('15: Rinforza è bloccato quando la riserva non basta — e non scrive', () => {
    const { session } = createGame();
    const weakened = unitOf(session, 'a1-unit-001');
    store(session).saveUnits(units(session).map(item => (item.id === weakened.id
      ? { ...item, personnel: 3_000 }
      : item)));
    const unit = unitOf(session, weakened.id);
    const before = JSON.stringify(units(session));
    const result = session.unitAction({ action: 'reinforce', unitId: unit.id, men: 9_000_000 });
    expect(result.blocked).toBe(true);
    expect(result.applied).toBe(false);
    expect(String(result.blockedReason)).toContain('Riserva insufficiente');
    expect(JSON.stringify(units(session))).toBe(before);
  });

  it('16: Riequipaggia assegna le armi mancanti dal deposito (parziale se serve)', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    const depotBefore = (session as any).military.depotUnits(PID);
    const result = session.unitAction({ action: 'reequip', unitId: unit.id });
    expect(result.blocked).toBe(false);
    const after = unitOf(session, unit.id);
    expect(equipmentSum(after.equipment, 'fucili')).toBeGreaterThanOrEqual(equipmentSum(unit.equipment, 'fucili'));
    const depotAfter = (session as any).military.depotUnits(PID);
    const moved = equipmentSum(after.equipment, 'fucili') - equipmentSum(unit.equipment, 'fucili');
    expect(equipmentSum(depotAfter, 'fucili')).toBe(equipmentSum(depotBefore, 'fucili') - moved);
    expect(after.readiness).toBeGreaterThanOrEqual(unit.readiness);
    expect(result.rows.some((item: any) => item.label === 'Copertura armi individuali')).toBe(true);
  });

  it('17: Riequipaggia è bloccato senza pezzi in deposito', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    setArsenal(session, 0);
    const result = session.unitAction({ action: 'reequip', unitId: unit.id });
    expect(result.blocked).toBe(true);
    expect(String(result.blockedReason)).toContain('Deposito');
  });

  it('18: Trasferisci paga il costo di movimento del motore', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    const before = { ...stock(session) };
    const cost = movementCost(before);
    const result = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: `${WORLD_ID}_ITA2` });
    expect(result.blocked).toBe(false);
    expect(result.unit.regionId).toBe(`${WORLD_ID}_ITA2`);
    expect(stock(session).food).toBeCloseTo(before.food - cost.food, 3);
    expect(stock(session).money).toBeCloseTo(before.money - cost.money, 3);
    expect(stock(session).fuel).toBeCloseTo(before.fuel - cost.fuel, 3);
  });

  it('18-bis: Trasferisci fuori dal paese è rifiutato', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    expect(() => session.unitAction({ action: 'transfer', unitId: unit.id, regionId: `${WORLD_ID}_AUT` }))
      .toThrowError(/region_unknown/);
  });

  it('19: Trasferisci nella stessa regione è bloccato', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    const army = armyOf(session, 'a1');
    const result = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: army.regionId });
    expect(result.blocked).toBe(true);
    expect(String(result.blockedReason)).toContain('già in');
  });

  it('20: Cambia armata sposta il reparto, l\'id resta e nessun reparto viene inventato', () => {
    const { session } = createGame();
    const created = session.raiseFormation({ formations: 1 });
    const targetId = created.unit.armyId;
    const unit = unitOf(session, 'a1-unit-001');
    const before = armies(session);
    const result = session.unitAction({ action: 'reassign', unitId: unit.id, armyId: targetId });
    expect(result.blocked).toBe(false);
    expect(result.unit.armyId).toBe(targetId);
    // MILITARY/WARFRONT INTEGRITY P1-1: l'id è **immutabile** anche cambiando
    // catena di comando; P1-2: l'armata di partenza non riceve un reparto
    // «in formazione» dal livello della mappa.
    expect(result.unit.id).toBe(unit.id);
    expect(String(result.unit.id)).toBe('a1-unit-001');
    expect(result.note).not.toContain('in formazione');
    const after = armies(session);
    for (const army of after) {
      const list = units(session).filter(item => String(item.armyId) === String(army.id) && item.status !== 'destroyed');
      expect(army.formations).toBe(list.length);
      expect(army.personnel).toBe(sumOf(list, item => item.personnel));
    }
    expect(after.length).toBe(before.length);
  });

  it('21: l\'anteprima `dryRun` non scrive nulla', () => {
    const { session } = createGame();
    const weakened = unitOf(session, 'a1-unit-001');
    store(session).saveUnits(units(session).map(item => (item.id === weakened.id
      ? { ...item, personnel: 3_000 }
      : item)));
    const unit = unitOf(session, weakened.id);
    const before = JSON.stringify(units(session));
    const reserve = personnel(session).trainedReserve;
    const result = session.unitAction({ action: 'reinforce', unitId: unit.id, men: 250, dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.blocked).toBe(false);
    expect(JSON.stringify(units(session))).toBe(before);
    expect(personnel(session).trainedReserve).toBe(reserve);
  });

  it('22: un reparto inesistente è un errore dichiarato, non un silenzio', () => {
    const { session } = createGame();
    expect(() => session.unitAction({ action: 'reinforce', unitId: 'nope-unit-001', men: 10 }))
      .toThrowError(/unit_unknown/);
  });
});

describe('MILITARY-UNITS — read model /arsenal (P4)', () => {
  it('23: i reparti compaiono sotto la loro armata, con fatti e problemi reali', () => {
    const { session } = createGame();
    const picture = session.getArsenal().objects;
    const objects = picture.objects;
    const list = objects.filter((object: any) => object.kind === 'unit');
    expect(list.length).toBeGreaterThan(0);
    const army = objects.find((object: any) => object.kind === 'army');
    const child = list.find((object: any) => String(object.parentId) === String(army.id));
    expect(child).toBeTruthy();
    const labels = child.facts.map((fact: any) => fact.label);
    expect(labels).toContain('Uomini');
    expect(labels).toContain('Copertura armi individuali');
    expect(labels).toContain('Prontezza');
    expect(picture.counts.unit).toBe(list.length);
    // Nessuna azione inventata: le quattro del reparto (PR1), la ricostituzione
    // (PR3: riserva + deposito in una sola azione) **piu'** le quattro mosse del
    // fronte (MILITARY-UNITS PR2, stessa fonte `unitActions`).
    expect(child.actions.map((action: any) => action.id).sort())
      .toEqual(['order_attack', 'order_defend', 'order_reserve', 'order_withdraw',
        'reassign_unit', 'reconstitute_unit', 'reequip_unit', 'reinforce_unit', 'transfer_unit']);
    // Senza fronte le mosse sono dichiarate **bloccate**, non nascoste.
    const orders = child.actions.filter((action: any) => String(action.id).startsWith('order_'));
    expect(orders.every((action: any) => action.enabled === false)).toBe(true);
    expect(orders.every((action: any) => /non e' assegnato a un fronte|non è assegnato a un fronte/.test(String(action.blockedReason)))).toBe(true);
  });

  it('24: il reparto senza uomini è un problema dichiarato', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    store(session).saveUnits(units(session).map(item => (item.id === unit.id
      ? { ...item, personnel: 0 }
      : item)));
    const child = session.getArsenal().objects.objects
      .find((object: any) => String(object.id) === String(unit.id));
    expect(child.problems.some((problem: any) => problem.label === 'Reparto senza uomini')).toBe(true);
  });
});
