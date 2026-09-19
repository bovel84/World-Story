/**
 * MILITARY-UNITS PR2 — fronti di guerra reali (P6–P9).
 * ===================================================
 *
 * Principi verificati:
 *  1. un fronte **nasce** solo da due polity ostili, con **confine reale** e
 *     **unità coinvolte** (mai da una relazione `hostile` senza contatto);
 *  2. l'assegnazione delle unità è **`MilitaryUnit.frontId`**: il fronte le
 *     deriva, non tiene un secondo elenco;
 *  3. gli ordini (`attack`/`defend`/`reserve`/`withdraw`) sono **persistenti** e
 *     cambiano pressione, perdite e consumi con fattori centralizzati;
 *  4. le perdite sono **reali**: uomini e pezzi si tolgono ai reparti (mai solo
 *     `region.militaryPower -= X`), e la contabilità resta conservata;
 *  5. i consumi di guerra escono dalle **scorte reali** del material flow;
 *  6. la ritirata sposta il reparto in una **provincia amica adiacente** fuori
 *     dal teatro;
 *  7. la conquista passa **solo** da `transferRegion`, con sfondamento +
 *     difensore che non tiene + obiettivo raggiungibile per adiacenza reale:
 *     una provincia non confinante non si conquista;
 *  8. il motore è **lo stesso** per il giocatore e per gli NPC: cambia solo chi
 *     sceglie l'ordine (pannello o policy deterministica);
 *  9. tutto è **deterministico**: stesso fronte e stessa data ⇒ stesso esito.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { addDays } from '../src/core/simulation/calendar';

const TEST_DB = path.join(os.tmpdir(), `world-story-fronts-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'fronts_world';
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
    { id: WORLD_ID, name: 'Fronts World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA1`, name: 'Pianura', color: '#FF0000', owner: 'ITA',
        population: 30_000_000, gdp: 1200, militaryPower: 300, flag: 'ITA', coastal: false,
        borders: [`${WORLD_ID}_AUT1`, `${WORLD_ID}_ITA2`],
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'a1', type: 'army', name: '1ª Armata', level: 4 },
        ],
      },
      {
        id: `${WORLD_ID}_ITA2`, name: 'Costa', color: '#FF8888', owner: 'ITA',
        population: 25_000_000, gdp: 900, militaryPower: 120, flag: 'ITA', coastal: true,
        borders: [`${WORLD_ID}_ITA1`],
        objects: [],
      },
      {
        id: `${WORLD_ID}_AUT1`, name: 'Tirolo', color: '#00FF00', owner: 'AUT',
        population: 6_000_000, gdp: 250, militaryPower: 40, flag: 'AUT',
        borders: [`${WORLD_ID}_ITA1`, `${WORLD_ID}_AUT2`],
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 2 }],
      },
      {
        id: `${WORLD_ID}_AUT2`, name: 'Vienna', color: '#88FF88', owner: 'AUT',
        population: 3_000_000, gdp: 200, militaryPower: 90, flag: 'AUT',
        borders: [`${WORLD_ID}_AUT1`],
        objects: [],
      },
      {
        id: `${WORLD_ID}_FRA1`, name: 'Provenza', color: '#0000FF', owner: 'FRA',
        population: 8_000_000, gdp: 500, militaryPower: 150, flag: 'FRA', coastal: true,
        borders: [],
        objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA1`, '#FF0000');
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
const AUT = 'AUT';
const R = {
  ita1: `${WORLD_ID}_ITA1`,
  ita2: `${WORLD_ID}_ITA2`,
  aut1: `${WORLD_ID}_AUT1`,
  aut2: `${WORLD_ID}_AUT2`,
  fra1: `${WORLD_ID}_FRA1`,
};

const store = (session: any) => session.operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const fronts = (session: any): any[] => store(session).fronts();
const unitOf = (session: any, id: string) => units(session).find(unit => String(unit.id) === String(id));
const stock = (session: any, polity = PID) => session.resourceStock(polity);
const setStock = (session: any, patch: Record<string, number>, polity = PID) => {
  const current = stock(session, polity);
  session.saveResourceStock(polity, { ...current, ...patch });
};
const setRelationship = (session: any, a: string, b: string, rel: 'ally' | 'neutral' | 'hostile') => {
  session.diplomacy.matrix().set(a, b, rel);
  session.diplomacy.matrix().set(b, a, rel);
};
/** Reparti di una armata in un ordine preciso (deterministico). */
const setOrder = (session: any, order: string, armyId = 'a1') => {
  const list = units(session).filter(unit => String(unit.armyId) === String(armyId));
  store(session).saveUnits(units(session).map(unit => (String(unit.armyId) === String(armyId)
    ? { ...unit, order } : unit)));
  return list;
};
/**
 * Equipaggia i reparti (pezzi dal deposito) e dà al difensore una potenza
 * dichiarata **resistente**: serve a misurare perdite reali, perché una difesa
 * che si ritira subito non fa vittime.
 */
const armAll = (session: any, armyId = 'a1') => {
  for (const unit of units(session)) {
    if (unit.armyId !== armyId) continue;
    try {
      session.unitAction({ action: 'reequip', unitId: unit.id });
    } catch { /* deposito vuoto: nessun pezzo da assegnare */ }
  }
};
const declaredPower = (session: any, regionId: string, value: number) => {
  session.regions.get(regionId).militaryPower = value;
};
const frontOf = (session: any, polityA = PID, polityB = AUT) => fronts(session)
  .find(front => [front.attackerPolityId, front.defenderPolityId].sort().join('|') === [polityA, polityB].sort().join('|'));
const equipmentOf = (bag: Record<string, number> | undefined, id = 'fucili') => Math.round(Number(bag?.[id] || 0));

describe('WAR-FRONTS — motore puro (P8)', () => {
  it('1: la forza del reparto è organico × equipaggiamento × prontezza × ordine × rifornimenti', async () => {
    const { unitStrength } = await import('../src/core/simulation/WarFronts');
    const supply = { food: 1, fuel: 1, weapons: 1 };
    const base = {
      id: 'u1', personnel: 12_000, equipment: { fucili: 9_000 }, readiness: 0.8,
      status: 'operational' as const, order: 'defend' as const,
    };
    const full = unitStrength({ unit: base, epoch: 'moderno', supply, motorized: false });
    expect(full.personnelFactor).toBeCloseTo(1, 4);
    expect(full.orderFactor).toBe(1);
    // Attacco più pressione, riserva meno: stessi uomini, stesso ordine diverso.
    const attack = unitStrength({ unit: { ...base, order: 'attack' }, epoch: 'moderno', supply, motorized: false });
    const reserve = unitStrength({ unit: { ...base, order: 'reserve' }, epoch: 'moderno', supply, motorized: false });
    const withdraw = unitStrength({ unit: { ...base, order: 'withdraw' }, epoch: 'moderno', supply, motorized: false });
    expect(attack.strength).toBeGreaterThan(full.strength);
    expect(reserve.strength).toBeLessThan(full.strength);
    expect(withdraw.strength).toBe(0);
    // Un reparto distrutto non ha forza.
    expect(unitStrength({ unit: { ...base, status: 'destroyed' }, epoch: 'moderno', supply, motorized: false }).strength).toBe(0);
  });

  it('2: senza rifornimenti la forza cala — carburante per i motorizzati, munizioni per l\'attacco, cibo per tutti', async () => {
    const { supplyFactors, unitStrength } = await import('../src/core/simulation/WarFronts');
    const rich = supplyFactors({ supply: { food: 1, fuel: 1, weapons: 1 }, motorized: true });
    const poor = supplyFactors({ supply: { food: 0, fuel: 0, weapons: 0 }, motorized: true });
    const wheeled = supplyFactors({ supply: { food: 1, fuel: 0, weapons: 1 }, motorized: false });
    expect(poor.total).toBeLessThan(rich.total);
    expect(poor.fuelFactor).toBeLessThan(1);
    // Non motorizzato: il carburante non tocca la forza.
    expect(wheeled.fuelFactor).toBe(1);
    expect(wheeled.total).toBeCloseTo(rich.foodFactor * rich.weaponsFactor, 4);
    const supply = { food: 0.2, fuel: 0, weapons: 0.2 };
    const starved = unitStrength({
      unit: { id: 'u1', personnel: 12_000, equipment: { fucili: 9_000 }, readiness: 1, status: 'operational', order: 'attack' },
      epoch: 'moderno', supply, motorized: true,
    });
    const fed = unitStrength({
      unit: { id: 'u1', personnel: 12_000, equipment: { fucili: 9_000 }, readiness: 1, status: 'operational', order: 'attack' },
      epoch: 'moderno', supply: { food: 1, fuel: 1, weapons: 1 }, motorized: true,
    });
    expect(starved.strength).toBeLessThan(fed.strength);
  });

  it('3: i consumi di guerra seguono l\'ordine (difesa ×1,2 · attacco ×1,8 · riserva ×0,8 · ritirata ×1,0)', async () => {
    const { warConsumption } = await import('../src/core/simulation/WarFronts');
    const unit = { id: 'u1', status: 'operational' as const, order: 'defend' as const, monthlyNeeds: { fuel: 1, weapons: 1, food: 1 } };
    const defend = warConsumption({ units: [unit], stepDays: 30 });
    const attack = warConsumption({ units: [{ ...unit, order: 'attack' }], stepDays: 30 });
    const reserve = warConsumption({ units: [{ ...unit, order: 'reserve' }], stepDays: 30 });
    const withdraw = warConsumption({ units: [{ ...unit, order: 'withdraw' }], stepDays: 30 });
    expect(defend.food).toBeCloseTo(1.2, 3);
    expect(attack.food).toBeCloseTo(1.8, 3);
    expect(reserve.food).toBeCloseTo(0.8, 3);
    expect(withdraw.food).toBeCloseTo(1, 3);
    // Quindici giorni = mezzo mese: la guerra non consuma come un mese intero.
    const half = warConsumption({ units: [{ ...unit, order: 'attack' }], stepDays: 15 });
    expect(half.food).toBeCloseTo(0.9, 3);
  });

  it('4: la policy NPC è deterministica (vantaggio → attacca, equilibrio → difende, molto inferiore → si ritira)', async () => {
    const { npcFrontOrder } = await import('../src/core/simulation/WarFronts');
    expect(npcFrontOrder({ ownPressure: 3, enemyPressure: 1 })).toBe('attack');
    expect(npcFrontOrder({ ownPressure: 1, enemyPressure: 1 })).toBe('defend');
    expect(npcFrontOrder({ ownPressure: 0.4, enemyPressure: 2 })).toBe('withdraw');
  });

  it('5: la ritirata sceglie la prima provincia amica adiacente fuori dal teatro', async () => {
    const { retreatRegionFor } = await import('../src/core/simulation/WarFronts');
    const regions = [
      { id: 'A', owner: 'ITA', borders: ['B', 'C', 'D'] },
      { id: 'B', owner: 'AUT', borders: [] },
      { id: 'C', owner: 'ITA', borders: [] },
      { id: 'D', owner: 'ITA', borders: [] },
    ];
    // Con l'obiettivo e il teatro esclusi: si ripiega su C (amica, non contesa).
    expect(retreatRegionFor({ unit: { regionId: 'A' }, side: 'ITA', regions, avoid: ['D'] })?.id).toBe('C');
    // Nessuna provincia amica valida: la resa (il servizio applica perdite maggiori).
    expect(retreatRegionFor({ unit: { regionId: 'A' }, side: 'FRA', regions })).toBeNull();
  });

  it('6: l\'obiettivo è la provincia del difensore meno difesa adiacente all\'attaccante', async () => {
    const { frontObjectiveFor } = await import('../src/core/simulation/WarFronts');
    const theatre = [
      { id: 'ITA1', owner: 'ITA', borders: ['AUT1', 'AUT2'] },
      { id: 'AUT1', owner: 'AUT', borders: ['ITA1'], militaryPower: 40 },
      { id: 'AUT2', owner: 'AUT', borders: ['ITA1'], militaryPower: 90 },
      { id: 'AUT3', owner: 'AUT', borders: [], militaryPower: 5 },
    ];
    expect(frontObjectiveFor({ theatre, attackerPolityId: 'ITA', defenderPolityId: 'AUT' })?.id).toBe('AUT1');
    // Nessuna provincia del difensore confina con l'attaccante: nessun obiettivo.
    expect(frontObjectiveFor({
      theatre: [{ id: 'ITA1', owner: 'ITA', borders: [] }, { id: 'AUT2', owner: 'AUT', borders: ['AUT3'] }],
      attackerPolityId: 'ITA', defenderPolityId: 'AUT',
    })).toBeNull();
    // L'id del fronte è lo stesso nelle due direzioni: un conflitto, un fronte.
    const { frontIdFor, frontNameFor } = await import('../src/core/simulation/WarFronts');
    expect(frontIdFor('ITA', 'AUT')).toBe(frontIdFor('AUT', 'ITA'));
    expect(frontNameFor('Italia', 'Austria')).toBe('Fronte Italia–Austria');
  });

  it('7: stesso fronte e stessa data ⇒ stesso esito (determinismo, mai Math.random)', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const { frontRollSeed } = await import('../src/core/simulation/WarFronts');
    expect(frontRollSeed({ frontId: 'f', date: '2026-03-01', phase: 'combat-attacker' }))
      .toBe('f:2026-03-01:combat-attacker');
    const front = {
      id: 'front-x', name: 'Fronte X', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
      regionIds: ['ITA1', 'AUT1'], status: 'active' as const, objectiveRegionId: 'AUT1',
      attackerPressure: 0, defenderPressure: 0, createdDate: '2026-01-01', updatedDate: '2026-01-01',
    };
    const unit = {
      id: 'u1', armyId: 'a1', name: '1ª Brigata', personnel: 12_000, equipment: { fucili: 9_000 },
      monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7, status: 'operational' as const,
      order: 'attack' as const, frontId: 'front-x', regionId: 'ITA1', regionName: 'Pianura',
      updatedDate: '2026-01-01', legacyDerived: true,
    };
    const side = { units: [unit], legacyPower: 200, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false };
    const enemy = { units: [], legacyPower: 40, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' as const };
    const input = { front, epoch: 'moderno' as const, date: '2026-03-01', stepDays: 30, theatre: [], attacker: side, defender: enemy };
    const first = resolveFront({ ...input });
    const second = resolveFront({ ...input });
    expect(second).toEqual(first);
    expect(first.rolls.attacker).toBe(second.rolls.attacker);
    // Data diversa ⇒ tiro diverso (la coordinata temporale è la data, non il turno).
    const third = resolveFront({ ...input, date: '2026-03-02' });
    expect(third.rolls.attacker).not.toBe(first.rolls.attacker);
  });

  it('8: giocatore e NPC passano dallo stesso motore (identità delle parti irrilevante)', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const mk = (a: string, b: string) => ({
      front: {
        id: 'front-same', name: 'Fronte', attackerPolityId: a, defenderPolityId: b,
        regionIds: ['X', 'Y'], status: 'active' as const, objectiveRegionId: 'Y',
        attackerPressure: 0, defenderPressure: 0, createdDate: 'd', updatedDate: 'd',
      },
      epoch: 'moderno' as const, date: '2026-04-01', stepDays: 30, theatre: [],
      attacker: {
        units: [{
          id: 'u1', armyId: 'a1', name: 'R1', personnel: 12_000, equipment: { fucili: 9_000 },
          monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7, status: 'operational' as const,
          order: 'attack' as const, frontId: 'front-same', regionId: 'X', regionName: 'X',
          updatedDate: 'd', legacyDerived: true,
        }],
        legacyPower: 100, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false,
      },
      defender: {
        units: [{
          id: 'u2', armyId: 'a2', name: 'R2', personnel: 12_000, equipment: { fucili: 9_000 },
          monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7, status: 'operational' as const,
          order: 'defend' as const, frontId: 'front-same', regionId: 'Y', regionName: 'Y',
          updatedDate: 'd', legacyDerived: true,
        }],
        legacyPower: 100, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false,
      },
    });
    // Il motore non sa chi è il giocatore: cambiano solo le etichette delle polity.
    expect(resolveFront(mk('NPC1', 'NPC2'))).toEqual(resolveFront(mk('ITA', 'AUT')));
  });
});

describe('WAR-FRONTS — nascita, assegnazione e ordini (P6/P7)', () => {
  it('9: il fronte nasce solo con ostilità + confine reale + reparti coinvolti', async () => {
    const { session } = createGame();
    // Neutrali: nessun fronte, anche se i reparti sono al confine.
    session.publicFronts();
    expect(fronts(session)).toHaveLength(0);
    // Ostilità con la Francia, che **non** confina: nessun fronte.
    setRelationship(session, PID, 'FRA', 'hostile');
    session.publicFronts();
    expect(fronts(session).filter(front => [front.attackerPolityId, front.defenderPolityId].includes('FRA'))).toHaveLength(0);
    // Ostilità con l'Austria, che confina, e reparti nel teatro: il fronte nasce.
    setRelationship(session, PID, AUT, 'hostile');
    const created = session.publicFronts();
    expect(created).toHaveLength(1);
    const front = frontOf(session)!;
    expect(front.attackerPolityId).toBe(PID);
    expect(front.defenderPolityId).toBe(AUT);
    expect(front.regionIds.sort()).toEqual([R.ita1, R.aut1].sort());
    expect(front.objectiveRegionId).toBe(R.aut1);
    expect(front.status).toBe('forming');
    expect(session.getArsenal().objects.counts.front).toBe(1);
  });

  it('10: l\'assegnazione è `unit.frontId` — il fronte deriva le unità, non le possiede', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const front = frontOf(session)!;
    const assigned = units(session).filter(unit => String(unit.frontId) === String(front.id));
    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.every(unit => unit.regionId === R.ita1)).toBe(true);
    // Persistente: sopravvive al ricaricamento della sessione.
    const gameId = session.id;
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(units(reloaded).filter(unit => String(unit.frontId) === String(front.id)).length).toBe(assigned.length);
  });

  it('11: gli ordini sono persistenti e passano dal motore (con anteprima `dryRun`)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    const preview = session.unitOrder({ unitId: unit.id, order: 'attack', dryRun: true });
    expect(preview.applied).toBe(false);
    expect(unitOf(session, unit.id).order).toBe('defend'); // l'anteprima non scrive
    expect(preview.rows.map((row: any) => row.label)).toEqual(['Pressione della parte', 'Pressione nemica', 'Perdite attese', 'Consumi di guerra']);
    const applied = session.unitOrder({ unitId: unit.id, order: 'attack' });
    expect(applied.applied).toBe(true);
    expect(unitOf(session, unit.id).order).toBe('attack');
    // Ordine non valido: errore dichiarato, non silenzio.
    expect(() => session.unitOrder({ unitId: unit.id, order: 'tenaglia' })).toThrow(/order_unknown/);
    expect(() => session.unitOrder({ unitId: 'nope', order: 'attack' })).toThrow(/unit_unknown/);
  });

  it('12: il read model mostra il fronte e, sul reparto, ordine e fronte con le quattro mosse', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const picture = session.getArsenal().objects;
    const frontObject = picture.objects.find((object: any) => object.kind === 'front');
    expect(frontObject).toBeTruthy();
    expect(frontObject.parentId).toBe('force');
    expect(frontObject.facts.map((fact: any) => fact.label)).toEqual(expect.arrayContaining([
      'Pressione attaccante', 'Pressione difensore', 'Reparti impegnati', 'Teatro', 'Obiettivo', 'Consumi di guerra',
    ]));
    const unitObject = picture.objects.find((object: any) => object.kind === 'unit' && object.facts.some((fact: any) => fact.label === 'Fronte'));
    expect(unitObject).toBeTruthy();
    const orderAction = unitObject.actions.map((action: any) => action.id);
    expect(orderAction).toEqual(expect.arrayContaining(['order_attack', 'order_defend', 'order_reserve', 'order_withdraw']));
  });
});

describe('WAR-FRONTS — combattimento, perdite, ritirata, territorio (P8/P9)', () => {
  it('13: attacco contro difesa — più pressione per chi attacca, meno perdite per chi difende', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const unit = {
      id: 'u1', armyId: 'a1', name: 'R1', personnel: 12_000, equipment: { fucili: 9_000 },
      monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7,
      status: 'operational' as const, order: 'attack' as const, frontId: 'f', regionId: 'X',
      regionName: 'X', updatedDate: 'd', legacyDerived: true,
    };
    const front = {
      id: 'f', name: 'Fronte', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
      regionIds: ['X', 'Y'], status: 'active' as const, objectiveRegionId: 'Y',
      attackerPressure: 0, defenderPressure: 0, createdDate: 'd', updatedDate: 'd',
    };
    const side = (order: 'attack' | 'defend' | 'reserve') => ({
      units: [{ ...unit, order }],
      legacyPower: 0, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false,
    });
    const base = { front, epoch: 'moderno' as const, date: '2026-05-01', stepDays: 30, theatre: [] };
    const attack = resolveFront({ ...base, attacker: side('attack'), defender: { units: [], legacyPower: 200, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' } });
    const reserve = resolveFront({ ...base, attacker: side('reserve'), defender: { units: [], legacyPower: 200, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' } });
    const attackLoss = attack.outcomes.find(item => item.side === 'attacker')!.personnelLost;
    const reserveLoss = reserve.outcomes.find(item => item.side === 'attacker')!.personnelLost;
    expect(attack.attackerPressure).toBeGreaterThan(reserve.attackerPressure);
    expect(attackLoss).toBeGreaterThan(reserveLoss);
    // Chi attacca perde più di chi si difende o resta in riserva, a parità di forze.
    const defenderAttack = resolveFront({ ...base, attacker: side('attack'), defender: side('defend') });
    const defenderReserve = resolveFront({ ...base, attacker: side('attack'), defender: side('reserve') });
    const lossDefend = defenderAttack.outcomes.find(item => item.side === 'defender')!.personnelLost;
    const lossReserve = defenderReserve.outcomes.find(item => item.side === 'defender')!.personnelLost;
    const lossAttacker = attack.outcomes.find(item => item.side === 'attacker')!.personnelLost;
    expect(lossAttacker).toBeGreaterThan(lossDefend);
    expect(lossAttacker).toBeGreaterThan(lossReserve);
    expect(attack.attackerPressure).toBeGreaterThan(defenderAttack.defenderPressure);
    // Integrazione: nel mondo la pressione del fronte riflette l'ordine scritto.
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    declaredPower(session, R.aut1, 1200);
    session.publicFronts();
    setOrder(session, 'attack');
    session.advanceFronts(30, '2026-05-01');
    const attackPressure = frontOf(session)!.attackerPressure;
    setOrder(session, 'reserve');
    session.advanceFronts(30, '2026-05-31');
    expect(attackPressure).toBeGreaterThan(frontOf(session)!.attackerPressure);
  });

  it('14: le perdite riducono gli uomini **reali** del reparto (mai solo `region.militaryPower`)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    // Difesa che tiene (potenza dichiarata paragonabile): senza resistenza non
    // ci sono vittime, e le perdite reali non si potrebbero misurare.
    declaredPower(session, R.aut1, 1200);
    session.publicFronts();
    setOrder(session, 'attack');
    const before = units(session).filter(unit => unit.frontId).map(unit => ({ id: unit.id, personnel: unit.personnel }));
    const regionBefore = session.regions.get(R.ita1).militaryPower;
    session.advanceFronts(30, '2026-01-31');
    let lost = 0;
    for (const snapshot of before) {
      const after = unitOf(session, snapshot.id);
      lost += snapshot.personnel - after.personnel;
      expect(after.personnel).toBeLessThanOrEqual(snapshot.personnel);
    }
    expect(lost).toBeGreaterThan(0);
    // L'armata resta la **somma** dei suoi reparti (invariante del PR1).
    const army = store(session).armies().find((item: any) => item.id === 'a1');
    const sum = units(session).filter(unit => String(unit.armyId) === 'a1' && unit.status !== 'destroyed')
      .reduce((total, unit) => total + unit.personnel, 0);
    expect(army.personnel).toBe(Math.round(sum));
    // La potenza dichiarata della provincia **non** è la contabilità dei reparti:
    // cala per attrito reale del fronte (la stessa quota), non viene riscritta
    // con gli uomini dei reparti.
    const regionAfter = session.regions.get(R.ita1).militaryPower;
    expect(regionAfter).toBeLessThan(regionBefore);
    expect(regionAfter).toBeGreaterThan(0);
    expect(regionAfter).not.toBe(lost);
  });

  it('15: le perdite riducono l\'equipaggiamento **reale** del reparto, senza creare pezzi', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    declaredPower(session, R.aut1, 1200);
    session.publicFronts();
    // Pezzi assegnati ai reparti (dal deposito): la guerra consuma quelli.
    const depot = session.military.depotUnits(PID);
    const unit = units(session).find(item => item.frontId);
    session.unitAction({ action: 'reequip', unitId: unit.id });
    const assignedBefore = equipmentOf(unitOf(session, unit.id).equipment);
    const nationalBefore = session.military.nationalUnits(PID);
    const depotAfterReequip = session.military.depotUnits(PID);
    expect(depotAfterReequip.fucili).toBe(depot.fucili - assignedBefore);
    setOrder(session, 'attack');
    session.advanceFronts(90, '2026-04-01');
    const assignedAfter = equipmentOf(unitOf(session, unit.id).equipment);
    const nationalAfter = session.military.nationalUnits(PID);
    expect(assignedAfter).toBeLessThanOrEqual(assignedBefore);
    // Conservazione della contabilità: il totale nazionale cala **esattamente**
    // dei pezzi distrutti in battaglia (nessun pezzo creato dal nulla).
    const destroyed = Math.max(0, Number(nationalBefore.fucili || 0) - Number(nationalAfter.fucili || 0));
    expect(destroyed).toBe(assignedBefore - assignedAfter);
  });

  it('16: senza rifornimenti la pressione cala e i consumi escono dalle scorte reali', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    const stockBefore = stock(session);
    session.advanceFronts(30, '2026-01-31');
    const stockAfter = stock(session);
    // Consumi reali: cibo, carburante e armamenti scendono nel magazzino.
    expect(stockAfter.food).toBeLessThan(stockBefore.food);
    expect(stockAfter.weapons).toBeLessThanOrEqual(stockBefore.weapons);
    // Scorte a zero: la stessa forza vale meno (fattore rifornimenti).
    const { unitStrength } = await import('../src/core/simulation/WarFronts');
    const unit = unitOf(session, units(session).find(item => item.frontId).id);
    const poor = unitStrength({ unit, epoch: 'moderno', supply: { food: 0, fuel: 0, weapons: 0 }, motorized: true });
    const fed = unitStrength({ unit, epoch: 'moderno', supply: { food: 1, fuel: 1, weapons: 1 }, motorized: true });
    expect(poor.strength).toBeLessThan(fed.strength);
  });

  it('17: la ritirata sposta il reparto in una provincia amica adiacente fuori dal teatro', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    session.unitOrder({ unitId: unit.id, order: 'withdraw' });
    session.advanceFronts(30, '2026-01-31');
    const after = unitOf(session, unit.id);
    expect(after.regionId).toBe(R.ita2);
    expect(after.regionName).toBe('Costa');
    expect(after.status).toBe('retreating');
  });

  it('18: lo sfondamento conquista l\'obiettivo con `transferRegion` (e solo allora)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    // Forza soverchiante e difesa che non tiene: entro un anno il fronte sfonda.
    const conquests: string[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const report = session.warFronts.advanceFronts(30, addDays('2026-01-01', month * 30));
      conquests.push(...report.conquests);
      if (conquests.length > 0) break;
    }
    expect(conquests.length).toBeGreaterThan(0);
    expect(session.regions.get(R.aut1).owner).toBe(PID);
    expect(fronts(session)[0].status).toBe('breakthrough');
    // Il territorio conquistato entra nei dispacci, non in un testo LLM.
    expect(conquests[0]).toContain('conquista');
  });

  it('19: senza sfondamento non si trasferisce nulla (stallo fra pari)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    // Prima misura la pressione reale dell'attacco, poi taratura **a parità**:
    // la difesa dichiarata vale quanto l'attacco (stallo, non rotta).
    session.advanceFronts(30, '2026-01-31');
    const pressure = frontOf(session)!.attackerPressure;
    declaredPower(session, R.aut1, Math.round(pressure * 400));
    const ownerBefore = session.regions.get(R.aut1).owner;
    let conquests = 0;
    const statuses = new Set<string>();
    for (let month = 2; month <= 7; month += 1) {
      conquests += session.warFronts.advanceFronts(30, addDays('2026-01-01', month * 30)).conquests.length;
      statuses.add(frontOf(session)!.status);
    }
    expect(conquests).toBe(0);
    expect(session.regions.get(R.aut1).owner).toBe(ownerBefore);
    expect([...statuses].every(status => status !== 'breakthrough')).toBe(true);
  });

  it('20: una provincia non confinante non si conquista, nemmeno con lo sfondamento', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    // Obiettivo forzato su Vienna (AUT2): confina solo con AUT1 (difensore), mai
    // con una provincia dell'attaccante → irraggiungibile.
    const front = frontOf(session)!;
    store(session).saveFronts(fronts(session).map(item => ({ ...item, objectiveRegionId: R.aut2 })));
    setOrder(session, 'attack');
    for (let month = 1; month <= 12; month += 1) {
      session.advanceFronts(30, addDays('2026-01-01', month * 30));
    }
    expect(session.regions.get(R.aut2).owner).toBe(AUT);
  });

  it('21: la guerra conserva uomini e pezzi (nessun numero creato dal nulla)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    // Difesa che **tiene** (ordinata in difesa dalla policy): una difesa che si
    // ritira subito non fa vittime, e la conservazione non si potrebbe misurare.
    declaredPower(session, R.aut1, 350);
    session.publicFronts();
    setOrder(session, 'attack');
    // Conservazione sulla **guerra**: si misurano i reparti che il fronte tocca.
    const front = frontOf(session)!;
    const before = units(session).filter(unit => String(unit.frontId) === String(front.id))
      .reduce((total, unit) => total + unit.personnel, 0);
    const reserveBefore = store(session).personnel().trainedReserve;
    session.advanceFronts(180, '2026-06-30');
    const after = units(session).filter(unit => String(unit.armyId) === 'a1' && unit.status !== 'destroyed')
      .reduce((total, unit) => total + unit.personnel, 0);
    const reserveAfter = store(session).personnel().trainedReserve;
    // Gli uomini dei reparti possono solo calare: la guerra non è una leva di reclutamento.
    expect(after).toBeLessThanOrEqual(before);
    // La riserva addestrata non viene toccata dalla guerra (nessun uomo creato).
    expect(reserveAfter).toBe(reserveBefore);
    // Contabilità conservata: i reparti del fronte perdono uomini **reali** (e
    // possono essere distrutti), la riserva non cresce di un solo uomo. La
    // conquista di una provincia con un oggetto armata è materia della mappa
    // (PR1): la guerra in sé non crea uomini.
    expect(before - after).toBeGreaterThan(0);
  });

  it('22: un fronte chiuso libera i reparti e non produce più pressione', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    expect(units(session).some(unit => unit.frontId)).toBe(true);
    setRelationship(session, PID, AUT, 'neutral');
    const after = session.publicFronts();
    expect(after[0].status).toBe('closed');
    expect(units(session).some(unit => unit.frontId)).toBe(false);
    // Nessun ordine possibile senza fronte: il motivo è dichiarato.
    const unit = units(session)[0];
    const impact = session.unitOrder({ unitId: unit.id, order: 'attack' });
    expect(impact.blocked).toBe(true);
    expect(impact.blockedReason).toContain('fronte');
  });

  it('23: il tick dei fronti è deterministico sulla stessa data (nessun tiro di turno)', async () => {
    const a = createGame();
    const b = createGame();
    for (const { session } of [a, b]) {
      setRelationship(session, PID, AUT, 'hostile');
      session.publicFronts();
      setOrder(session, 'attack');
    }
    const first = a.session.advanceFronts(30, '2026-03-15');
    const second = b.session.advanceFronts(30, '2026-03-15');
    expect(second.events).toEqual(first.events);
    expect(fronts(b.session)[0].attackerPressure).toBe(fronts(a.session)[0].attackerPressure);
    expect(units(b.session).map((unit: any) => unit.personnel)).toEqual(units(a.session).map((unit: any) => unit.personnel));
  });

  it('24: senza stato militare persistente il tick del mondo resta quello legacy (nessun doppio sistema)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    // Con reparti e fronti il percorso legacy di conquista si ritira.
    expect(session.hasPersistentMilitary()).toBe(true);
    expect(session.npcTurns.processWorldConflictTick(7).some((event: string) => event.includes('conquista'))).toBe(false);
  });

  it('25: il combattimento non tocca crisi, playback né la produzione (separazione dei domini)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    setOrder(session, 'attack');
    const ordersBefore = session.military.playerProductionOrders?.()?.length ?? 0;
    session.advanceFronts(30, '2026-02-15');
    expect(session.military.playerProductionOrders?.()?.length ?? 0).toBe(ordersBefore);
    // Il fronte non crea un magazzino proprio: la scorta è quella nazionale.
    expect(stock(session).fuel).toBeGreaterThanOrEqual(0);
  });

  it('26: la forza dichiarata in teatro si consuma (una provincia senza reparti non è invulnerabile)', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    declaredPower(session, R.aut1, 1200);
    session.publicFronts();
    setOrder(session, 'attack');
    const before = session.regions.get(R.aut1).militaryPower;
    expect(units(session).filter(unit => String(unit.armyId) === 'a2')).toHaveLength(0);
    for (let month = 1; month <= 3; month += 1) {
      session.warFronts.advanceFronts(30, addDays('2026-01-01', month * 30));
    }
    const after = session.regions.get(R.aut1).militaryPower;
    // Nessun reparto persistente sul lato AUT: l'attrito tocca la forza
    // **dichiarata** dalla mappa (la stessa quota dei reparti). Senza questo il
    // fronte sarebbe eterno contro una provincia solo "numerica".
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(units(session).filter(unit => String(unit.armyId) === 'a2')).toHaveLength(0);
  });

  it('27: un reparto in rotta sotto la soglia organica si sbanda (niente reparti fantasma)', async () => {
    const { resolveFront, DEPLETED_ORGANIC_RATIO } = await import('../src/core/simulation/WarFronts');
    const { militaryManpower } = await import('../src/core/simulation/MilitaryDoctrine');
    const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: 'moderno' as const }).menPerFormation;
    const thin = Math.round(menPerFormation * DEPLETED_ORGANIC_RATIO * 0.4);
    const unit = {
      id: 'u1', armyId: 'a1', name: 'R1', personnel: thin, equipment: {},
      monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.5,
      status: 'operational' as const, order: 'withdraw' as const, frontId: 'f', regionId: 'X',
      regionName: 'X', updatedDate: 'd', legacyDerived: true,
    };
    const front = {
      id: 'f', name: 'Fronte', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
      regionIds: ['X', 'Y'], status: 'active' as const, objectiveRegionId: 'Y',
      attackerPressure: 0, defenderPressure: 0, createdDate: 'd', updatedDate: 'd',
    };
    const resolution = resolveFront({
      front, epoch: 'moderno', date: '2026-05-01', stepDays: 30, theatre: [],
      attacker: { units: [unit], legacyPower: 0, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false },
      defender: { units: [unit], legacyPower: 800, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' },
    });
    const outcome = resolution.outcomes.find(item => item.side === 'attacker')!;
    expect(outcome.routed).toBe(true);
    expect(outcome.statusAfter).toBe('destroyed');
    expect(outcome.personnelAfter).toBeLessThan(thin);
  });

  it('28: il seme del tiro dipende solo da fronte, data e fase (determinismo verificabile)', async () => {
    const { frontRollSeed } = await import('../src/core/simulation/WarFronts');
    const { stableRoll } = await import('../src/core/simulation/MilitaryProduction');
    const a = frontRollSeed({ frontId: 'front-ITA-AUT', date: '2026-01-31', phase: 'attacker' });
    const b = frontRollSeed({ frontId: 'front-ITA-AUT', date: '2026-01-31', phase: 'attacker' });
    const other = frontRollSeed({ frontId: 'front-ITA-AUT', date: '2026-02-28', phase: 'attacker' });
    const phase = frontRollSeed({ frontId: 'front-ITA-AUT', date: '2026-01-31', phase: 'breakthrough' });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toBe(phase);
    for (const seed of [a, other, phase]) {
      const roll = stableRoll(seed);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
      expect(stableRoll(seed)).toBe(roll);
    }
    // Stesso ingresso, stesso esito: due risoluzioni identiche sono identiche.
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const unit = {
      id: 'u1', armyId: 'a1', name: 'R1', personnel: 12_000, equipment: { fucili: 9_000 },
      monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7,
      status: 'operational' as const, order: 'attack' as const, frontId: 'f', regionId: 'X',
      regionName: 'X', updatedDate: 'd', legacyDerived: true,
    };
    const front = {
      id: 'f', name: 'Fronte', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
      regionIds: ['X', 'Y'], status: 'active' as const, objectiveRegionId: 'Y',
      attackerPressure: 0, defenderPressure: 0, createdDate: 'd', updatedDate: 'd',
    };
    const input = {
      front, epoch: 'moderno' as const, date: '2026-05-01', stepDays: 30, theatre: [],
      attacker: { units: [unit], legacyPower: 0, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false },
      defender: { units: [], legacyPower: 800, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' as const },
    };
    expect(resolveFront(input)).toEqual(resolveFront(input));
  });

  it('29: un reparto distrutto non combatte piu\' e non torna in vita', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const dead = {
      id: 'u-dead', armyId: 'a1', name: 'Reparto perduto', personnel: 0, equipment: {},
      monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0,
      status: 'destroyed' as const, order: 'attack' as const, frontId: 'f', regionId: 'X',
      regionName: 'X', updatedDate: 'd', legacyDerived: true,
    };
    const alive = {
      ...dead, id: 'u-alive', name: 'Reparto in linea', personnel: 12_000, readiness: 0.7,
      status: 'operational' as const,
    };
    const front = {
      id: 'f', name: 'Fronte', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
      regionIds: ['X', 'Y'], status: 'active' as const, objectiveRegionId: 'Y',
      attackerPressure: 0, defenderPressure: 0, createdDate: 'd', updatedDate: 'd',
    };
    const resolution = resolveFront({
      front, epoch: 'moderno', date: '2026-05-01', stepDays: 30, theatre: [],
      attacker: { units: [dead, alive], legacyPower: 0, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false },
      defender: { units: [], legacyPower: 800, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' },
    });
    // Il reparto distrutto non ha esiti: non si risveglia, non consuma, non preme.
    // Consumo = solo il reparto vivo (0,2 di fabbisogno × 1,8 in attacco).
    expect(resolution.outcomes.some(outcome => outcome.unitId === 'u-dead')).toBe(false);
    expect(resolution.consumption.attacker.weapons).toBeCloseTo(0.36, 6);
    expect(resolution.outcomes.find(outcome => outcome.unitId === 'u-alive')?.personnelAfter)
      .toBeLessThan(12_000);
    // Un fronte senza reparti vivi non preme: la forza dichiarata resta sola.
    const onlyDead = resolveFront({
      front, epoch: 'moderno', date: '2026-05-01', stepDays: 30, theatre: [],
      attacker: { units: [dead], legacyPower: 0, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false },
      defender: { units: [], legacyPower: 800, supply: { food: 1, fuel: 1, weapons: 1 }, motorized: false, legacyOrder: 'defend' },
    });
    expect(onlyDead.attackerPressure).toBe(0);
    expect(onlyDead.outcomes).toHaveLength(0);
  });
});

