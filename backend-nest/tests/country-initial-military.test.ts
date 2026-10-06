import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { militaryManpower } from '../src/core/simulation/MilitaryDoctrine';
import { EQUIPMENT_CATALOG } from '../src/core/simulation/MilitaryIndustry';

const profiles = vi.hoisted(() => new Map<string, any>());
vi.mock('../src/repositories/country-initial-profile.repository', () => ({
  countryInitialProfiles: { get: (gameId: string, polityId: string) => profiles.get(`${gameId}:${polityId}`) ?? null },
}));
const TEST_DB = path.join(os.tmpdir(), `country-initial-military-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;
let db: any;
let MilitaryService: any;
let OperationalStateStore: any;
let repos: any;
let sequence = 0;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  repos = await import('../src/repositories');
  ({ MilitaryService } = await import('../src/game/MilitaryService'));
  ({ OperationalStateStore } = await import('../src/game/OperationalStateStore'));
});
afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

function fixture(polityId = 'AAA', militaryOverrides = {}, withProfile = true) {
  const gameId = `initial-military-${++sequence}`;
  const profile = {
    startDate: '2026-01-01',
    military: {
      activePersonnel: 37_003, reservePersonnel: 91_000, formations: 7, averageFormationSize: 5_286,
      readinessPct: 73, trainingPct: 81, qualityPct: 69, logisticsPct: 62,
      equipmentProfile: { fucili: 31_000, apc: 19 }, ...militaryOverrides,
    },
  };
  if (withProfile) profiles.set(`${gameId}:${polityId}`, profile);
  let date = profile.startDate;
  let armySeeds = [
    { id: 'army-1', objectId: 'army-1', name: 'Prima armata', formations: 2, regionId: 'r1', regionName: 'Nord' },
    { id: 'army-2', objectId: 'army-2', name: 'Seconda armata', formations: 1, regionId: 'r2', regionName: 'Sud' },
  ];
  const account = { population: 12_000_000, forces: 3, mobilized: 0, factories: 1, ports: 0, universities: 0 };
  const stock = { money: 100, food: 100, clothing: 100, weapons: 100, fuel: 100, research: 0, technologies: [] };
  let store: any;
  const context = {
    gameId, currentTurn: () => 0, currentDate: () => date, worldStartDate: () => profile.startDate,
    playerPolityId: () => polityId, isStrictGame: () => false,
    accounts: () => ({ [polityId]: account }), initialAccounts: () => ({ [polityId]: account }),
    resourceStock: () => stock, saveResourceStock: () => {}, adoptResourceStock: () => {}, invalidateResourceStock: () => {},
    operationalObjects: () => store,
  };
  const service = new MilitaryService(context);
  const inputs = {
    gameId, playerPolityId: context.playerPolityId, currentDate: context.currentDate, epoch: () => 'moderno',
    depotUnits: () => service.depotUnits(polityId), saveDepotUnits: (units: any) => service.saveArsenal(polityId, units),
    factories: () => 1, ports: () => 0, universities: () => 0,
    regions: () => [{ id: 'r1', name: 'Nord' }, { id: 'r2', name: 'Sud' }],
    armyObjects: () => armySeeds, totalFormations: () => account.forces,
    manpower: () => militaryManpower({ population: account.population, formations: account.forces, mobilizedFormations: 0, epoch: 'moderno' }),
    endowment: () => ({}), projects: () => [], stock: () => stock,
    saveArmies: (armies: any[]) => {
      armySeeds = armySeeds.map(seed => ({ ...seed, persistedFormations: armies.find(army => army.id === seed.id)?.formations }));
    },
  };
  store = new OperationalStateStore(inputs);
  return { gameId, polityId, profile, service, store, account, stock, setDate: (value: string) => { date = value; },
    reload: () => { store = new OperationalStateStore(inputs); return new MilitaryService(context); } };
}

const sumMen = (units: any[]) => units.reduce((sum, unit) => sum + unit.personnel, 0);
const pictureReadiness = (service: any) => service.getOperatingPicture().objects.find((object: any) => object.id === 'force').facts.find((fact: any) => fact.label === 'Prontezza').value;

describe('CountryInitialProfile military bootstrap', () => {
  it('keeps small brigades fully staffed and equipped after bootstrap readiness expires', () => {
    const f = fixture('SMALL', { activePersonnel: 6_000, formations: 2, averageFormationSize: 3_000, equipmentProfile: { fucili: 4_500 } });
    const initial = f.store.snapshot();
    expect(initial.units.every((unit: any) => unit.establishmentPersonnel === 3_000)).toBe(true);
    for (const unit of initial.units) f.service.unitAction({ action: 'reequip', unitId: unit.id });
    f.setDate('2026-02-01');
    const loaded = f.reload();
    const unit = loaded.militaryUnits()[0];
    expect(unit.personnel).toBe(3_000);
    expect(unit.equipment.fucili).toBe(2_250);
    expect(unit.readiness).toBe(1);
    const object = loaded.getOperatingPicture().objects.find((item: any) => item.id === unit.id);
    expect(object.facts.find((fact: any) => fact.label === 'Organico').value).toBe(100);
    expect(object.facts.find((fact: any) => fact.label === 'Copertura armi individuali').value).toBe(100);
    expect(loaded.unitAction({ action: 'reinforce', unitId: unit.id, dryRun: true }).blocked).toBe(true);
    expect(loaded.getArsenal().manpower.menPerFormation).toBe(3_000);
    expect(loaded.getArsenal().coverage.find((row: any) => row.category === 'individualWeapons').required).toBe(4_500);
  });

  it('casualties preserve authorized staffing through reload and reinforcement restores only that establishment', () => {
    const f = fixture('SMALL-LOSS', { activePersonnel: 6_000, formations: 2, averageFormationSize: 3_000 });
    const snapshot = f.store.snapshot();
    const damaged = snapshot.units[0];
    f.store.saveUnits(snapshot.units.map((unit: any) => unit.id === damaged.id ? { ...unit, personnel: 2_400 } : unit));
    f.store.savePersonnel({ ...snapshot.personnel, activePersonnel: 5_400 });
    const loaded = f.reload();
    const before = loaded.militaryUnits().find((unit: any) => unit.id === damaged.id);
    expect(before.establishmentPersonnel).toBe(3_000);
    expect(before.personnel).toBe(2_400);
    const object = loaded.getOperatingPicture().objects.find((item: any) => item.id === before.id);
    expect(object.facts.find((fact: any) => fact.label === 'Organico').value).toBe(80);
    expect(loaded.unitAction({ action: 'reinforce', unitId: before.id, men: 601, dryRun: true }).blocked).toBe(true);
    const reinforced = loaded.unitAction({ action: 'reinforce', unitId: before.id });
    expect(reinforced.unit.personnel).toBe(3_000);
    expect(reinforced.unit.establishmentPersonnel).toBe(3_000);
    expect(loaded.getArsenal().manpower.activePersonnel).toBe(6_000);
    expect(loaded.getArsenal().manpower.menPerFormation).toBe(3_000);
  });
  it('persists country personnel and coherent formations rather than epoch-sized soldiers', () => {
    const f = fixture();
    const snapshot = f.store.snapshot();
    expect(snapshot.personnel.activePersonnel).toBe(37_003);
    expect(snapshot.personnel.trainedReserve).toBe(91_000);
    expect(snapshot.units).toHaveLength(7);
    expect(sumMen(snapshot.units)).toBe(37_003);
    expect(snapshot.armies.reduce((sum: number, army: any) => sum + army.personnel, 0)).toBe(37_003);
    expect(repos.operationalObjectRepository.get(f.gameId, 'personnel', f.polityId).data.activePersonnel).toBe(37_003);
    expect(f.service.getArsenal().manpower.menPerFormation).toBe(5_286);
  });

  it('preserves authored army counts and puts only the national remainder in garrison', () => {
    const f = fixture('AUTHORED');
    const snapshot = f.store.snapshot();
    expect(snapshot.armies.find((army: any) => army.id === 'army-1').formations).toBe(2);
    expect(snapshot.armies.find((army: any) => army.id === 'army-2').formations).toBe(1);
    expect(snapshot.armies.find((army: any) => !army.objectId).formations).toBe(4);
    expect(sumMen(snapshot.units)).toBe(37_003);
  });

  it('personnel-only bootstrap uses live account formations, not stale profile counts', () => {
    const f = fixture('LIVE-ACCOUNT');
    f.account.forces = 5;
    repos.operationalObjectRepository.upsert(f.gameId, 'personnel', f.polityId, {
      activePersonnel: 555, trainedReserve: 456, mobilizedPersonnel: 0, shipCrew: 0, updatedDate: '2026-01-01',
    });
    const snapshot = f.store.snapshot();
    expect(snapshot.units).toHaveLength(5);
    expect(snapshot.armies.find((army: any) => army.id === 'army-1').formations).toBe(2);
    expect(sumMen(snapshot.units)).toBe(555);
    expect(f.service.getArsenal().manpower.formations).toBe(5);
  });

  it('reconciliation and reload never regenerate a profile garrison after losses or reassignment', () => {
    const f = fixture('GARRISON');
    const initial = f.store.snapshot();
    const garrison = initial.armies.find((army: any) => !army.objectId);
    expect(garrison).toBeTruthy();
    const units = initial.units.map((unit: any) => unit.armyId === garrison.id
      ? { ...unit, status: 'destroyed', personnel: 0, equipment: {} }
      : { ...unit, equipment: { fucili: 13 } });
    f.store.saveUnits(units);
    f.store.savePersonnel({ ...initial.personnel, activePersonnel: sumMen(units), trainedReserve: 456 });
    f.account.forces = 2;
    const before = f.store.units();
    const loaded = f.reload();
    expect(f.store.units()).toEqual(before);
    expect(f.store.armies().reduce((sum: number, army: any) => sum + army.personnel, 0)).toBe(sumMen(units));
    expect(loaded.getArsenal().manpower.formations).toBe(3);
    expect(f.store.units().filter((unit: any) => unit.armyId === garrison.id).every((unit: any) => unit.status === 'destroyed')).toBe(true);
  });

  it('an emptied garrison cannot be recreated from a stale account after reload', () => {
    const f = fixture('EMPTY-GARRISON');
    const snapshot = f.store.snapshot();
    const remaining = snapshot.units.filter((unit: any) => unit.armyId !== 'EMPTY-GARRISON-garrison');
    f.store.saveUnits(remaining);
    f.store.savePersonnel({ ...snapshot.personnel, activePersonnel: sumMen(remaining) });
    f.account.forces = 20;
    const loaded = f.reload();
    expect(f.store.units()).toHaveLength(3);
    expect(sumMen(f.store.units())).toBe(sumMen(remaining));
    expect(loaded.getArsenal().manpower.formations).toBe(3);
  });

  it('zero-unit map markers prevent complete demobilization from rematerializing soldiers on reload', () => {
    const f = fixture('DEMOBILIZED');
    const snapshot = f.store.snapshot();
    f.store.saveUnits([]);
    f.store.savePersonnel({ ...snapshot.personnel, activePersonnel: 0 });
    f.account.forces = 20;
    const loaded = f.reload();
    expect(f.store.units()).toEqual([]);
    expect(f.store.armies().reduce((sum: number, army: any) => sum + army.personnel, 0)).toBe(0);
    expect(loaded.getArsenal().manpower.formations).toBe(0);
  });

  it('a profile with fewer formations than the authored map still conserves national totals', () => {
    const f = fixture('OVER-BUDGET', { formations: 1, activePersonnel: 555, averageFormationSize: 555 });
    const snapshot = f.store.snapshot();
    expect(snapshot.units).toHaveLength(1);
    expect(snapshot.armies.reduce((sum: number, army: any) => sum + army.formations, 0)).toBe(1);
    expect(sumMen(snapshot.units)).toBe(555);
    expect(sumMen(f.reload().militaryUnits())).toBe(555);
  });

  it('same-date stock mutations change the measured readiness in both read models, including reload', () => {
    const f = fixture('READINESS-STOCK', { readinessPct: 84 });
    // Con reparti vivi il profilo non è la misura: vince lo stato operativo.
    const start = f.service.getArsenal().readiness.readinessPct;
    expect(start).not.toBe(84);
    expect(pictureReadiness(f.service)).toBe(start);
    f.stock.fuel = 0;
    f.stock.weapons = 0;
    const live = f.service.getArsenal().readiness.readinessPct;
    expect(live).not.toBe(start);
    expect(pictureReadiness(f.service)).toBe(live);
    expect(f.reload().getArsenal().readiness.readinessPct).toBe(live);
  });

  it('same-date unit and depot mutations invalidate initial readiness before the first read', () => {
    const f = fixture('READINESS-UNITS', { readinessPct: 84 });
    const snapshot = f.store.snapshot();
    f.store.saveUnits(snapshot.units.map((unit: any) => ({ ...unit, personnel: 0, equipment: {}, status: 'destroyed' })));
    f.service.saveArsenal(f.polityId, {});
    expect(f.service.getArsenal().manpower.formations).toBe(0);
    expect(f.service.getArsenal().readiness.readinessPct).not.toBe(84);
    expect(pictureReadiness(f.reload())).not.toBe(84);
  });

  it('seeds only catalog equipment declared by the profile, and hands the rifles to the initial units', () => {
    const f = fixture('BBB', { equipmentProfile: { fucili: 1_001, apc: 5, imaginary_tank: 99 } });
    // Before the units materialize the whole profile sits in the depot.
    expect(f.service.arsenalUnits('BBB')).toEqual({ fucili: 1_001, apc: 5 });
    const arsenal = f.service.getArsenal();
    // The national total never changes: the profile's rifles are distributed to
    // the initial units, the depot keeps only what was not required. Nothing is
    // fabricated beyond the declared catalog entries.
    expect(arsenal.units).toEqual({ fucili: 1_001, apc: 5 });
    expect(arsenal.stockpile).toEqual({ apc: 5 });
    expect(arsenal.assigned.fucili).toBe(1_001);
  });

  it('a deliberately empty profile arsenal stays empty; an absent profile retains doctrine fallback', () => {
    expect(fixture('CCC', { equipmentProfile: {} }).service.arsenalUnits('CCC')).toEqual({});
    expect(fixture('DDD', {}, false).service.arsenalUnits('DDD')).toEqual({ fucili: 27_000, apc: 5 });
  });

  it('both read models expose the operational measure, with the profile only as historical baseline', () => {
    const f = fixture('EEE', { readinessPct: 84 });
    const measured = f.service.getArsenal().readiness.readinessPct;
    // La stima del profilo non copre la misura reale appena i reparti esistono.
    expect(measured).not.toBe(84);
    expect(pictureReadiness(f.service)).toBe(measured);
    expect(f.reload().getArsenal().readiness.readinessPct).toBe(measured);
    // Avanzando il tempo resta la stessa misura operativa: nessun salto artificiale.
    f.setDate('2026-01-02');
    expect(f.service.getArsenal().readiness.readinessPct).toBe(measured);
    expect(f.service.getArsenal().readiness.readinessPct).toBe(pictureReadiness(f.service));
  });

  it('the initial profile estimate is the fallback only while no operational unit exists', () => {
    // Nessun reparto materializzato (paese smilitarizzato): la stima del
    // profilo è l'unica misura disponibile e resta leggibile.
    expect(pictureReadiness(fixture('FFF', { readinessPct: 41, formations: 0, activePersonnel: 0, averageFormationSize: 0 }).service)).toBe(41);
    expect(pictureReadiness(fixture('GGG', { readinessPct: 91, formations: 0, activePersonnel: 0, averageFormationSize: 0 }).service)).toBe(91);
    // Profile 60 senza unità reali: resta il fallback, nessuna crisi inventata.
    expect(pictureReadiness(fixture('H60', { readinessPct: 60, formations: 0, activePersonnel: 0, averageFormationSize: 0 }).service)).toBe(60);
  });

  it('CASO 2 — nuova partita con fucili sufficienti: nessun falso 25%', () => {
    const f = fixture('FRESH');
    const units = f.store.snapshot().units;
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((unit: any) => unit.status === 'operational')).toBe(true);
    expect(units.every((unit: any) => unit.readiness > 0.25)).toBe(true);
    // Il bootstrap assegna i fucili senza cambiare il totale nazionale.
    const assigned = units.reduce((sum: number, unit: any) => sum + (unit.equipment?.fucili ?? 0), 0);
    const depot = f.service.arsenalUnits('FRESH').fucili ?? 0;
    expect(depot + assigned).toBe(f.service.getArsenal().units.fucili);
  });

  it('repairs only the recognisable pre-#224 bootstrap: men without rifles, stock still in the depot', () => {
    const f = fixture('LEGACY');
    const snapshot = f.store.snapshot();
    // Impronta del vecchio bootstrap: reparti in formazione senza fucili,
    // tutto il deposito come seminato dal profilo, nessuna firma iniziale.
    const depot = f.service.arsenalUnits('LEGACY');
    const assignedRifles = snapshot.units.reduce((sum: number, unit: any) => sum + (unit.equipment?.fucili ?? 0), 0);
    const nationalRifles = (depot.fucili ?? 0) + assignedRifles;
    f.store.saveUnits(snapshot.units.map((unit: any) => ({
      ...unit, equipment: {}, status: 'forming', readiness: 0.25, legacyDerived: true, order: 'defend', frontId: null,
    })));
    f.store.savePersonnel({ ...snapshot.personnel, initialReadinessSignature: undefined });
    f.service.saveArsenal('LEGACY', { ...depot, fucili: nationalRifles });
    const loaded = f.reload();
    const repaired = loaded.militaryUnits();
    expect(repaired.every((unit: any) => (unit.equipment?.fucili ?? 0) > 0)).toBe(true);
    expect(repaired.every((unit: any) => unit.status === 'operational')).toBe(true);
    expect(repaired.every((unit: any) => unit.readiness > 0.25)).toBe(true);
    // Deposito + assegnato resta il totale nazionale: nessun fucile inventato.
    const assigned = repaired.reduce((sum: number, unit: any) => sum + (unit.equipment?.fucili ?? 0), 0);
    expect((loaded.arsenalUnits('LEGACY').fucili ?? 0) + assigned).toBe(nationalRifles);
    expect(loaded.getArsenal().units.fucili).toBe(nationalRifles);
    expect(sumMen(repaired)).toBe(snapshot.personnel.activePersonnel);
  });

  it('does not repair a genuinely damaged unit at 25% or a real rifle shortage', () => {
    // Reparto danneggiato per perdite: uomini sotto l'organico, non l'impronta del bug.
    const damaged = fixture('LEGACY-DAMAGED');
    const damagedSnapshot = damaged.store.snapshot();
    damaged.store.saveUnits(damagedSnapshot.units.map((unit: any, index: number) => index === 0
      ? { ...unit, equipment: {}, status: 'forming', readiness: 0.25, personnel: Math.round(unit.personnel * 0.5) }
      : { ...unit, equipment: {}, status: 'forming', readiness: 0.25 }));
    damaged.store.savePersonnel({ ...damagedSnapshot.personnel, initialReadinessSignature: undefined });
    const damagedReload = damaged.reload();
    expect(damagedReload.militaryUnits().some((unit: any) => (unit.equipment?.fucili ?? 0) === 0)).toBe(true);

    // Carenza reale: il deposito non contiene i fucili necessari.
    const short = fixture('LEGACY-SHORT', { equipmentProfile: { fucili: 0 } });
    const shortSnapshot = short.store.snapshot();
    short.store.saveUnits(shortSnapshot.units.map((unit: any) => ({
      ...unit, equipment: {}, status: 'forming', readiness: 0.25, legacyDerived: true,
    })));
    short.store.savePersonnel({ ...shortSnapshot.personnel, initialReadinessSignature: undefined });
    short.service.saveArsenal('LEGACY-SHORT', {});
    const shortReload = short.reload();
    expect(shortReload.militaryUnits().every((unit: any) => (unit.equipment?.fucili ?? 0) === 0)).toBe(true);
  });

  it('reload and reconciliation preserve casualties, existing equipment, and live reserves', () => {
    const f = fixture('HHH');
    const snapshot = f.store.snapshot();
    f.store.saveUnits(snapshot.units.map((unit: any, index: number) => index ? unit : { ...unit, personnel: 123, equipment: { fucili: 77 }, order: 'reserve' }));
    f.store.savePersonnel({ ...snapshot.personnel, activePersonnel: 1_234, trainedReserve: 456 });
    f.service.saveArsenal('HHH', { fucili: 12 });
    const before = f.store.units();
    const loaded = f.reload();
    expect(f.store.units()).toEqual(before);
    expect(f.store.personnel().activePersonnel).toBe(1_234);
    expect(f.store.personnel().trainedReserve).toBe(456);
    expect(loaded.arsenalUnits('HHH')).toEqual({ fucili: 12 });
    // Reload preserves the units' equipment and the depot: the national total is
    // exactly their sum, and no profile refill happens.
    const assigned = before.reduce((sum: number, unit: any) => sum + (unit.equipment?.fucili ?? 0), 0);
    expect(loaded.getArsenal().assigned.fucili).toBe(assigned);
    expect(loaded.getArsenal().units.fucili).toBe(12 + assigned);
  });

  it('partial persistent military state is authoritative even without a personnel seed sentinel', () => {
    const f = fixture('III');
    repos.operationalObjectRepository.upsert(f.gameId, 'unit', 'live-unit', {
      id: 'live-unit', polityId: 'III', armyId: 'army-1', name: 'Live', personnel: 555,
      equipment: { fucili: 99 }, monthlyNeeds: { food: 1, fuel: 0, weapons: 1 },
      readiness: 0, status: 'degraded', regionId: 'r1', regionName: 'Nord',
      updatedDate: '2026-01-01', legacyDerived: false, order: 'defend', frontId: null,
    });
    f.store.invalidate();
    const snapshot = f.store.snapshot();
    expect(snapshot.units).toHaveLength(1);
    expect(snapshot.units[0].personnel).toBe(555);
    expect(snapshot.units[0].equipment).toEqual({ fucili: 99 });
    expect(snapshot.personnel.activePersonnel).toBe(555);
    expect(f.service.arsenalUnits('III')).toEqual({});
  });

  it('a personnel-only legacy stock governs first unit materialization instead of the profile', () => {
    const f = fixture('STOCK');
    repos.operationalObjectRepository.upsert(f.gameId, 'personnel', 'STOCK', {
      activePersonnel: 555, trainedReserve: 456, mobilizedPersonnel: 0, shipCrew: 0, updatedDate: '2026-01-01',
    });
    f.service.saveArsenal('STOCK', { fucili: 12 });
    f.store.invalidate();
    const snapshot = f.store.snapshot();
    expect(sumMen(snapshot.units)).toBe(555);
    expect(snapshot.personnel.activePersonnel).toBe(555);
    expect(snapshot.personnel.trainedReserve).toBe(456);
    expect(f.reload().getArsenal().units).toEqual({ fucili: 12 });
    expect(sumMen(f.store.units())).toBe(555);
  });

  it('a demilitarized profile creates no soldiers or units from map levels', () => {
    const f = fixture('ZERO', { activePersonnel: 0, reservePersonnel: 0, formations: 0, averageFormationSize: 0, equipmentProfile: {} });
    expect(f.store.units()).toEqual([]);
    expect(f.store.personnel().activePersonnel).toBe(0);
    expect(f.store.personnel().trainedReserve).toBe(0);
    expect(f.reload().getArsenal().units).toEqual({});
    expect(f.store.units()).toEqual([]);
  });

  it('live unit counts, not initial formations, govern manpower after casualties', () => {
    const f = fixture('LOSS');
    const units = f.store.units();
    f.store.saveUnits(units.map((unit: any, index: number) => index ? unit : { ...unit, status: 'destroyed', personnel: 0, equipment: {} }));
    f.setDate('2026-02-01');
    expect(f.service.getArsenal().manpower.formations).toBe(6);
    expect(f.store.units()[0].status).toBe('destroyed');
  });

  it('profile naval stock is materialized once with no national equipment double count', () => {
    const hull = EQUIPMENT_CATALOG.find(item => item.domain === 'mare')!;
    const f = fixture('JJJ', { equipmentProfile: { fucili: 100, [hull.id]: 2 } });
    const loaded = f.service;
    expect(loaded.getArsenal().units).toEqual({ fucili: 100, [hull.id]: 2 });
    // The profile's rifles reached the initial units; the national total is not doubled.
    expect(loaded.getArsenal().assigned.fucili).toBe(100);
    const snapshot = f.store.snapshot();
    const crews = snapshot.ships.reduce((sum: number, ship: any) => sum + ship.crew, 0);
    expect(snapshot.personnel.shipCrew).toBe(crews);
    expect(snapshot.personnel.activePersonnel + crews).toBe(f.profile.military.activePersonnel);
    expect(sumMen(snapshot.units) + crews).toBe(f.profile.military.activePersonnel);
    expect(f.reload().getArsenal().units).toEqual({ fucili: 100, [hull.id]: 2 });
  });
});
