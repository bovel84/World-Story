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
      'Pressione attaccante', 'Pressione difensore', 'Reparti impegnati', 'Teatro', 'Obiettivo dichiarato', 'Consumi di guerra',
      // PR3 — l'iniziativa reale è un dato a sé: i ruoli storici non dicono chi avanza.
      'Iniziativa',
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

  it('16: il fronte NON sottrae scorte: i consumi li applica una sola volta il tick materiale', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    // Nessun impianto: il tick non ha produzione propria e si misura il consumo.
    store(session).saveFacilities([]);
    session.publicFronts();
    setOrder(session, 'attack');
    const stockBefore = stock(session);
    // MILITARY/WARFRONT INTEGRITY P0-2: il combattimento non tocca il magazzino.
    // Sottrarre qui `warConsumption` era il **doppio consumo** (attacco =
    // base + 1,8× = 2,8× invece di 1,8×): l'unico punto che sottrae è
    // `advanceStock`, che riceve i fabbisogni già moltiplicati per l'ordine.
    session.advanceFronts(30, '2026-01-31');
    expect(stock(session).food).toBe(stockBefore.food);
    expect(stock(session).weapons).toBe(stockBefore.weapons);
    expect(stock(session).fuel).toBe(stockBefore.fuel);
    // Il fabbisogno è quello dei reparti reali, per il coefficiente del loro
    // ordine: **1,8** per chi è sul fronte in attacco, **1** per chi non lo è.
    // Una sola grandezza, nessun addendo.
    const onFront = units(session).filter(item => item.frontId && item.status !== 'destroyed');
    expect(onFront.length).toBeGreaterThan(0);
    const expected = units(session).filter(item => item.status !== 'destroyed')
      .reduce((total: number, item: any) => total + Number(item.monthlyNeeds.fuel || 0) * (item.frontId ? 1.8 : 1), 0);
    const expectedFood = units(session).filter(item => item.status !== 'destroyed')
      .reduce((total: number, item: any) => total + Number(item.monthlyNeeds.food || 0) * (item.frontId ? 1.8 : 1), 0);
    expect(expected).toBeGreaterThan(0);
    expect(store(session).militaryNeeds().fuel).toBeCloseTo(expected, 3);
    // Il tick materiale, sul motore puro: un periodo da 30 giorni consuma il
    // fabbisogno dei reparti **una volta**, con il coefficiente dell'ordine.
    // (Con l'overlay reale il conto è esatto: nessun impianto, nessun
    // giacimento, solo il fabbisogno militare del periodo.)
    const { advanceStock, storageCapacity, effectiveMaterialNeeds } = await import('../src/core/simulation/MaterialEconomy');
    const account = {
      ...(session as any).sessionAccounts()[PID],
      population: 0, factories: 0, ports: 0, universities: 0, monthlyBalance: 0, forces: 0, mobilized: 0,
    };
    const overlay = store(session).materialFlow({ monthlyExtraction: false, stepDays: 30 });
    // Si parte dal tetto del magazzino: così la misura non è un taglio di
    // capacità. Il tetto è quello **strutturale** (base di pace dei reparti),
    // perché la guerra alza il consumo del periodo, non la dimensione delle
    // riserve: è esattamente il tetto che `advanceStock` applica.
    const cap = storageCapacity(account, effectiveMaterialNeeds(account, overlay, overlay?.structuralMilitaryNeeds));
    const tick = advanceStock({ ...stock(session), fuel: cap.fuel, food: cap.food, weapons: cap.weapons }, account, 30, {}, '2026-01-31', overlay);
    expect(tick.flow.fuel).toBeCloseTo(-expected, 3);
    expect(tick.flow.food).toBeCloseTo(-expectedFood, 3);
    expect(cap.food - tick.stock.food).toBeCloseTo(expectedFood, 3);
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
      // Riarmo mensile: senza, il logoramento dei pezzi fa **collassare** il
      // giocatore e l'NPC difensore contrattacca (PR3) — non sarebbe più uno
      // stallo fra pari, che è la condizione che questo test vuole misurare.
      armAll(session);
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


// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — motore bidirezionale (puro)
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — avanzata bidirezionale e contrattacco (motore puro)', () => {
  /** Reparto completo e deterministico (stesso modello dei test 7/8). */
  const unit = (id: string, order: string, regionId: string) => ({
    id, armyId: 'a1', name: id, personnel: 12_000, equipment: { fucili: 9_000 },
    monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 }, readiness: 0.7,
    status: 'operational' as const, order: order as any, frontId: 'front-AUT-ITA',
    regionId, regionName: regionId, updatedDate: '2026-01-01', legacyDerived: true,
  });
  /**
   * Una piccola **armata** (4 reparti): un solo reparto vale ~0,23 di pressione,
   * sotto la soglia di sfondamento — con quattro il rapporto supera `1,5` e la
   * dinamica (sfondamento o collasso) è osservabile.
   */
  const army = (prefix: string, order: string, regionId: string, count = 4) =>
    Array.from({ length: count }, (_, index) => unit(`${prefix}-${index + 1}`, order, regionId));
  const supply = { food: 1, fuel: 1, weapons: 1 };
  const front = {
    id: 'front-AUT-ITA', name: 'Fronte Italia–Austria', attackerPolityId: PID, defenderPolityId: AUT,
    regionIds: [`${WORLD_ID}_ITA1`, `${WORLD_ID}_AUT1`], status: 'active' as const,
    objectiveRegionId: `${WORLD_ID}_AUT1`, attackerPressure: 0, defenderPressure: 0,
    createdDate: '2026-01-01', updatedDate: '2026-01-01',
  };
  const theatreFor = (attackerRegion: string, defenderRegion: string) => [
    { id: attackerRegion, name: attackerRegion, owner: PID, borders: [defenderRegion], militaryPower: 0 },
    { id: defenderRegion, name: defenderRegion, owner: AUT, borders: [attackerRegion], militaryPower: 0 },
  ];
  /** Attaccante storico **in rotta** (nessuna pressione) contro difensore che preme. */
  const counterattackInput = (defenderOrder: string, options?: { theatre?: any[]; date?: string; units?: any[] }) => ({
    front,
    epoch: 'moderno' as const,
    date: options?.date ?? '2026-01-31',
    stepDays: 30,
    theatre: options?.theatre ?? theatreFor(`${WORLD_ID}_ITA1`, `${WORLD_ID}_AUT1`),
    attacker: { units: [], legacyPower: 0, supply, motorized: false, legacyOrder: 'defend' as const },
    defender: {
      units: options?.units ?? army('u-def', defenderOrder, `${WORLD_ID}_AUT1`),
      legacyPower: 0, supply, motorized: false, legacyOrder: 'defend' as const,
    },
  });
  /** Data deterministica in cui il tiro del **contrattacco** passa. */
  const counterDate = async () => {
    const { frontRollSeed } = await import('../src/core/simulation/WarFronts');
    const { stableRoll } = await import('../src/core/simulation/MilitaryProduction');
    const dates = Array.from({ length: 40 }, (_, index) => addDays('2026-01-01', (index + 1) * 30));
    const found = dates.find(date => stableRoll(frontRollSeed({ frontId: front.id, date, phase: 'breakthrough-defender' })) < 0.55);
    expect(found).toBeTruthy();
    return found!;
  };

  it('23: `defender` con ordine `attack` **contrattacca** e avanza (TerritorialAdvance neutrale)', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const resolution = resolveFront(counterattackInput('attack', { date: await counterDate() }));
    expect(resolution.breakthroughs.defender.offensiveIntent).toBe(true);
    expect(resolution.breakthroughs.defender.pressureRatio).toBeGreaterThanOrEqual(1.5);
    expect(resolution.breakthrough).toBe(true);
    expect(resolution.status).toBe('breakthrough');
    // L'avanzata è quella del **difensore**: il ruolo storico non decide l'iniziativa.
    expect(resolution.advance).not.toBeNull();
    expect(resolution.advance!.side).toBe('defender');
    expect(resolution.advance!.advancingPolityId).toBe(AUT);
    expect(resolution.advance!.retreatingPolityId).toBe(PID);
    expect(resolution.advance!.objectiveRegionId).toBe(`${WORLD_ID}_ITA1`);
  });

  it('24: `defender` con ordine `defend` **non** conquista, nemmeno con pressione enorme', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const resolution = resolveFront(counterattackInput('defend', { date: await counterDate() }));
    expect(resolution.breakthroughs.defender.offensiveIntent).toBe(false);
    expect(resolution.breakthroughs.defender.passed).toBe(false);
    expect(resolution.breakthrough).toBe(false);
    expect(resolution.advance).toBeNull();
    // Chi tiene il campo mentre l'avversario non tiene più: collasso dell'attaccante.
    expect(resolution.collapsedSide).toBe('attacker');
    expect(resolution.status).toBe('collapsed');
  });

  it('25: `withdraw` non è mai intento offensivo (nessuna conquista)', async () => {
    const { resolveFront, sideHasOffensiveIntent } = await import('../src/core/simulation/WarFronts');
    expect(sideHasOffensiveIntent({ units: [unit('u', 'withdraw', 'X')] })).toBe(false);
    expect(sideHasOffensiveIntent({ units: [unit('u', 'reserve', 'X')] })).toBe(false);
    expect(sideHasOffensiveIntent({ units: [unit('u', 'defend', 'X')] })).toBe(false);
    expect(sideHasOffensiveIntent({ units: [unit('u', 'attack', 'X')] })).toBe(true);
    // Senza reparti decide la quota dichiarata.
    expect(sideHasOffensiveIntent({ units: [], legacyOrder: 'attack' })).toBe(true);
    expect(sideHasOffensiveIntent({ units: [], legacyOrder: 'withdraw' })).toBe(false);
    // Con reparti schierati l'ordine è quello delle unità, non della quota legacy.
    expect(sideHasOffensiveIntent({ units: [unit('u', 'defend', 'X')], legacyOrder: 'attack' })).toBe(false);
    const resolution = resolveFront(counterattackInput('withdraw', { date: await counterDate() }));
    expect(resolution.advance).toBeNull();
    // Ritirata da entrambe le parti: nessuno tiene il campo, nessun collasso.
    expect(resolution.collapsedSide).toBeNull();
  });

  it('26: l\'obiettivo deve essere territorio **nemico adiacente** (niente teletrasporto)', async () => {
    const { resolveFront } = await import('../src/core/simulation/WarFronts');
    const date = await counterDate();
    // La provincia dell'attaccante non confina con quella del difensore: resta
    // fuori portata anche con lo sfondamento.
    const farAway = [
      { id: `${WORLD_ID}_ITA1`, name: 'Pianura', owner: PID, borders: [], militaryPower: 0 },
      { id: `${WORLD_ID}_ITA2`, name: 'Costa', owner: PID, borders: [], militaryPower: 0 },
      { id: `${WORLD_ID}_AUT1`, name: 'Tirolo', owner: AUT, borders: [`${WORLD_ID}_ITA2`], militaryPower: 0 },
    ];
    const blocked = resolveFront(counterattackInput('attack', { date, theatre: farAway }));
    expect(blocked.breakthrough).toBe(true);
    expect(blocked.advance).toBeNull();
    // Una provincia di **terza** polity non è mai un obiettivo.
    const thirdParty = [
      { id: `${WORLD_ID}_ITA1`, name: 'Pianura', owner: PID, borders: [`${WORLD_ID}_FRA1`], militaryPower: 0 },
      { id: `${WORLD_ID}_FRA1`, name: 'Provenza', owner: 'FRA', borders: [`${WORLD_ID}_ITA1`], militaryPower: 0 },
      { id: `${WORLD_ID}_AUT1`, name: 'Tirolo', owner: AUT, borders: [`${WORLD_ID}_FRA1`], militaryPower: 0 },
    ];
    const neutral = resolveFront(counterattackInput('attack', { date, theatre: thirdParty }));
    expect(neutral.advance).toBeNull();
  });

  it('27: l\'obiettivo dichiarato vale solo se è **ancora** valido (nessuno stale)', async () => {
    const { resolveFront, frontObjectiveForSide } = await import('../src/core/simulation/WarFronts');
    const date = await counterDate();
    const resolution = resolveFront(counterattackInput('attack', {
      date,
      theatre: theatreFor(`${WORLD_ID}_ITA1`, `${WORLD_ID}_AUT1`),
    }));
    expect(resolution.advance!.objectiveRegionId).toBe(`${WORLD_ID}_ITA1`);
    // Un obiettivo ormai **proprio** non vale più: se ne calcola uno valido sul
    // confine attuale (qui non c'è, quindi nessuna avanzata).
    const stale = frontObjectiveForSide({
      theatre: [
        { id: `${WORLD_ID}_ITA1`, name: 'Pianura', owner: AUT, borders: [], militaryPower: 0 },
        { id: `${WORLD_ID}_AUT1`, name: 'Tirolo', owner: AUT, borders: [], militaryPower: 0 },
      ],
      advancingPolityId: AUT,
      opposingPolityId: PID,
      preferredRegionId: `${WORLD_ID}_ITA1`,
    });
    expect(stale).toBeNull();
    // Il ruolo storico sopravvive: `frontIdFor` resta non direzionale.
    const { frontIdFor } = await import('../src/core/simulation/WarFronts');
    expect(frontIdFor(PID, AUT)).toBe(frontIdFor(AUT, PID));
  });

  it('28: lo sfondamento dell\'attaccante continua a funzionare (regressione simmetrica)', async () => {
    const { resolveFront, frontRollSeed } = await import('../src/core/simulation/WarFronts');
    const { stableRoll } = await import('../src/core/simulation/MilitaryProduction');
    const dates = Array.from({ length: 40 }, (_, index) => addDays('2026-01-01', (index + 1) * 30));
    // Il seme dell'attaccante è rimasto `breakthrough`: nessun cambio di flusso.
    const date = dates.find(item => stableRoll(frontRollSeed({ frontId: front.id, date: item, phase: 'breakthrough' })) < 0.55)!;
    const resolution = resolveFront({
      ...counterattackInput('defend', { date }),
      attacker: { units: army('u-att', 'attack', `${WORLD_ID}_ITA1`), legacyPower: 0, supply, motorized: false, legacyOrder: 'defend' as const },
      defender: { units: [], legacyPower: 0, supply, motorized: false, legacyOrder: 'defend' as const },
    });
    expect(resolution.breakthroughs.attacker.passed).toBe(true);
    expect(resolution.advance!.side).toBe('attacker');
    expect(resolution.advance!.advancingPolityId).toBe(PID);
    expect(resolution.advance!.retreatingPolityId).toBe(AUT);
    expect(resolution.advance!.objectiveRegionId).toBe(`${WORLD_ID}_AUT1`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — integrazione servizio: contrattacco, catena, rally
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — contrattacco, catena di proprietà e recupero reparti', () => {
  /** Avanzamento **canonico**: periodo materiale + fronte + data di sessione. */
  const advance = (session: any, days: number, date: string) => session.advanceWorldState(days, date);
  /** Il fronte ITA–AUT con i ruoli **invertiti**: l'NPC è l'attaccante storico. */
  const reversedFront = (session: any) => {
    const current = frontOf(session, PID, AUT);
    if (!current) return null;
    store(session).saveFronts([
      ...fronts(session).filter(front => String(front.id) !== String(current.id)),
      { ...current, attackerPolityId: AUT, defenderPolityId: PID, objectiveRegionId: R.ita1 },
    ]);
    return current.id;
  };
  /** Avanza finché compare una conquista (o si esauriscono i periodi). */
  const advanceUntilConquest = (session: any, months = 18, from = 1) => {
    const conquests: string[] = [];
    for (let month = from; month <= months; month += 1) {
      armAll(session);
      conquests.push(...session.warFronts.advanceFronts(30, addDays('2026-01-01', month * 30)).conquests);
      if (conquests.length > 0) break;
    }
    return conquests;
  };

  it('29: il contrattacco conquista via `transferRegion` (difensore storico NPC)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    // Il giocatore **non tiene** il campo (ritirata) e la sua provincia non ha
    // potenza dichiarata: l'NPC difensore ha l'iniziativa e contrattacca.
    declaredPower(session, R.ita1, 0);
    declaredPower(session, R.aut1, 600);
    setOrder(session, 'withdraw');
    const conquests = advanceUntilConquest(session);
    expect(conquests.length).toBeGreaterThan(0);
    // La conquista è del **difensore storico**, e passa dall'unica authority.
    expect(conquests[0]).toContain('contrattacca');
    expect(session.regions.get(R.ita1).owner).toBe(AUT);
  });

  it('30: il **giocatore** può contrattaccare da difensore storico', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    // Ruoli invertiti: l'NPC è l'attaccante storico, il giocatore il difensore.
    expect(reversedFront(session)).not.toBeNull();
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    declaredPower(session, R.aut1, 0);
    const conquests = advanceUntilConquest(session);
    expect(conquests.length).toBeGreaterThan(0);
    expect(conquests[0]).toContain('conquista');
    expect(session.regions.get(R.aut1).owner).toBe(PID);
  });

  it('31: catena di proprietà A→B→A con **lo stesso** fronte e obiettivo aggiornato', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    const frontId = frontOf(session)!.id;
    // 1) l'attaccante storico (giocatore) conquista AUT1.
    declaredPower(session, R.aut1, 40);
    const first = advanceUntilConquest(session);
    expect(first.length).toBeGreaterThan(0);
    expect(session.regions.get(R.aut1).owner).toBe(PID);
    // 2) il teatro e l'obiettivo si ricostruiscono dal **nuovo** confine: niente
    // obiettivo ormai proprio.
    session.publicFronts();
    expect(frontOf(session)!.id).toBe(frontId);
    expect(frontOf(session)!.objectiveRegionId).not.toBe(R.aut1);
    // 3) il difensore storico riconquista la provincia perduta, stesso fronte.
    // La potenza va alzata dove l'AUT **ha ancora** territorio (AUT2): AUT1 è ora
    // del giocatore, e il teatro si è ricostruito sul nuovo confine.
    declaredPower(session, R.aut2, 600);
    // Nessuna potenza dichiarata ITA **nel teatro**: ITA1 (propria) e AUT1
    // (conquistata) a zero, così l'attaccante storico non tiene più il campo.
    declaredPower(session, R.ita1, 0);
    declaredPower(session, R.aut1, 0);
    setOrder(session, 'withdraw');
    const second = advanceUntilConquest(session, 24);
    expect(second.length).toBeGreaterThan(0);
    expect(second[0]).toContain('contrattacca');
    expect(session.regions.get(R.aut1).owner).toBe(AUT);
    // Un solo fronte per la coppia di polity: chi avanza non cambia l'identità.
    expect(fronts(session).map(front => String(front.id))).toEqual([frontId]);
  });

  it('32: contrattacco fallito (difesa che tiene) — nessuna conquista e ordini misti intatti', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    // Ordini misti del giocatore: il fronte non li riscrive.
    const list = units(session).filter(unit => String(unit.armyId) === 'a1');
    const mixed = list.map((unit, index) => ({ ...unit, order: index === 0 ? 'defend' : index === 1 ? 'reserve' : 'attack' }));
    store(session).saveUnits(units(session).map(unit => mixed.find(item => item.id === unit.id) ?? unit));
    const before = units(session).filter(unit => String(unit.armyId) === 'a1').map(unit => unit.order);
    declaredPower(session, R.aut1, 4000);
    for (let month = 1; month <= 6; month += 1) {
      session.warFronts.advanceFronts(30, addDays('2026-01-01', month * 30));
    }
    // Gli ordini del giocatore sono **suoi**: nessuno li sovrascrive.
    expect(units(session).filter(unit => String(unit.armyId) === 'a1').map(unit => unit.order)).toEqual(before);
    // E la provincia non è passata all'NPC (l'attaccante storico può ritirarsi,
    // ma il difensore non conquista senza intento offensivo: qui non c'è).
    expect(session.regions.get(R.ita1).owner).toBe(PID);
  });

  it('33: novanta giorni e tre turni da trenta sono la stessa guerra (owners, fronti, reparti)', () => {
    const setup = () => {
      const { session } = createGame();
      setRelationship(session, PID, AUT, 'hostile');
      armAll(session);
      session.publicFronts();
      setOrder(session, 'attack');
      declaredPower(session, R.aut1, 350);
      return session;
    };
    const stockOf = (session: any) => {
      const { weapons, food, fuel } = stock(session);
      return { weapons, food, fuel };
    };
    const snapshot = (session: any) => ({
      owners: [...session.regions.values()].map((region: any) => ({ id: region.id, owner: region.owner })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
      fronts: fronts(session).map(front => ({ id: front.id, status: front.status, regions: front.regionIds, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure })),
      units: units(session).map(unit => ({
        id: unit.id, personnel: unit.personnel, equipment: unit.equipment,
        status: unit.status, order: unit.order, frontId: unit.frontId, regionId: unit.regionId, readiness: unit.readiness,
      })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      stock: stockOf(session),
    });
    const long = setup();
    const split = setup();
    for (const date of ['2026-01-31', '2026-03-02', '2026-04-01']) {
      (split as any).advanceWorldState(30, date);
    }
    (long as any).advanceWorldState(90, '2026-04-01');
    expect(snapshot(split)).toEqual(snapshot(long));
  });

  it('34: un reparto in ritirata **non** rientra prima di 30 giorni, poi rientra (rally)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'withdraw');
    const unit = units(session).find(item => item.frontId);
    // `advanceWorldState` avanza anche la **data di sessione**: la
    // sincronizzazione dei fronti (e quindi il rally) legge quella, non la data
    // passata al singolo tick.
    advance(session, 30, '2026-01-31');
    const retreated = unitOf(session, unit.id);
    expect(retreated.status).toBe('retreating');
    expect(retreated.regionId).toBe(R.ita2);
    // Lo sgancio dal fronte avviene alla sincronizzazione del periodo successivo.
    const personnelBefore = retreated.personnel;
    const equipmentBefore = equipmentOf(retreated.equipment);
    // 15 giorni: ancora fuori linea (il rally non è una cura immediata).
    advance(session, 15, '2026-02-15');
    expect(unitOf(session, unit.id).status).toBe('retreating');
    expect(unitOf(session, unit.id).frontId).toBeNull();
    // 30 giorni fuori dal fronte: rientra, senza recuperare uomini né pezzi.
    advance(session, 15, '2026-03-02');
    const rallied = unitOf(session, unit.id);
    expect(rallied.status).not.toBe('retreating');
    expect(['degraded', 'operational']).toContain(rallied.status);
    expect(rallied.personnel).toBe(personnelBefore);
    expect(equipmentOf(rallied.equipment)).toBe(equipmentBefore);
    expect(rallied.readiness).toBeGreaterThan(0);
  });

  it('35: un reparto **distrutto** non rientra mai, nemmeno dopo un anno', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, status: 'destroyed', personnel: 0, equipment: {}, readiness: 0, frontId: null, regionId: R.ita2 }
      : item)));
    advance(session, 365, '2027-01-31');
    const after = unitOf(session, unit.id);
    expect(after.status).toBe('destroyed');
    expect(after.personnel).toBe(0);
    expect(equipmentOf(after.equipment)).toBe(0);
  });

  it('36: rewind e rami riportano i reparti allo stato **pre-rally**', async () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'withdraw');
    const unit = units(session).find(item => item.frontId);
    // T0: reparto ancora in linea; T1: ripiegato (checkpoint del pre-rally).
    advance(session, 30, '2026-01-31');
    const checkpoint = session.save('pre-rally').saveId;
    expect(unitOf(session, unit.id).status).toBe('retreating');
    // T2: rally avvenuto.
    advance(session, 30, '2026-03-02');
    expect(unitOf(session, unit.id).status).not.toBe('retreating');
    // Rewind: torna `retreating` come nel checkpoint.
    const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(checkpoint) as any;
    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    expect(unitOf(session, unit.id).status).toBe('retreating');
    // Ramo isolato: da lì in avanti il rally può rifarsi, senza contaminazioni.
    session.loadFromSave(JSON.parse(row.data), row.content_hash, { newBranch: { originCheckpointId: checkpoint, name: 'rally' } });
    advance(session, 30, '2026-03-02');
    expect(unitOf(session, unit.id).status).not.toBe('retreating');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — ricostituzione (riusa le primitive esistenti)
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — ricostituzione di un reparto', () => {
  const depot = (session: any) => (session as any).military.depotUnits(PID);
  const reserve = (session: any) => store(session).personnel().trainedReserve;
  const equipmentSum = (bag: Record<string, number> | undefined, id = 'fucili') => Math.round(Number(bag?.[id] || 0));
  /** Reparto fuori dal fronte, sotto organico e senza fucili: il caso da ricostituire. */
  const wornUnit = (session: any) => {
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, personnel: 4_000, equipment: {}, readiness: 0.2, frontId: null, regionId: R.ita2, status: 'degraded' as const }
      : item)));
    return unitOf(session, unit.id);
  };

  it('37: la ricostituzione **conserva** gli uomini (riserva ↓ = reparto ↑)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    const reserveBefore = reserve(session);
    const personnelBefore = unit.personnel;
    const impact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(impact.blocked).toBe(false);
    expect(impact.applied).toBe(true);
    const after = unitOf(session, unit.id);
    const moved = after.personnel - personnelBefore;
    expect(moved).toBeGreaterThan(0);
    // Nessun uomo creato: quello che entra nel reparto esce dalla riserva.
    expect(reserve(session)).toBe(reserveBefore - moved);
  });

  it('38: la ricostituzione **conserva** il deposito (deposito ↓ = assegnato ↑)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    const depotBefore = equipmentSum(depot(session));
    // Deposito rifornito per l'occasione (i pezzi esistono o non esistono: qui li mettiamo).
    (session as any).military.saveArsenal(PID, { ...depot(session), fucili: 5_000 });
    const depotArmed = equipmentSum(depot(session));
    const assignedBefore = equipmentSum(unit.equipment);
    const impact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(impact.blocked).toBe(false);
    const assignedAfter = equipmentSum(unitOf(session, unit.id).equipment);
    const moved = assignedAfter - assignedBefore;
    expect(moved).toBeGreaterThan(0);
    expect(equipmentSum(depot(session))).toBe(depotArmed - moved);
    expect(depotBefore).toBeGreaterThanOrEqual(0);
  });

  it('39: senza riserva e senza deposito non nasce nulla (e non resta un aggiornamento a metà)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    // Nessuna riserva, nessun pezzo: la ricostituzione è **bloccata**.
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 0 });
    (session as any).military.saveArsenal(PID, { ...depot(session), fucili: 0 });
    const before = { personnel: unitOf(session, unit.id).personnel, equipment: equipmentSum(unitOf(session, unit.id).equipment) };
    const impact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(impact.blocked).toBe(true);
    expect(impact.blockedReason).toBeTruthy();
    // Nessun numero creato dal nulla.
    expect(unitOf(session, unit.id).personnel).toBe(before.personnel);
    expect(equipmentSum(unitOf(session, unit.id).equipment)).toBe(before.equipment);
    expect(reserve(session)).toBe(0);
    expect(equipmentSum(depot(session))).toBe(0);
  });

  it('40: un reparto **schierato** non si ricostituisce (ma resta eleggibile in riserva)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    const unit = units(session).find(item => item.frontId)!;
    const personnelBefore = unitOf(session, unit.id).personnel;
    const blockedImpact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(blockedImpact.blocked).toBe(true);
    expect(String(blockedImpact.blockedReason)).toMatch(/fronte|riserva/i);
    expect(unitOf(session, unit.id).personnel).toBe(personnelBefore);
    // In riserva la regola cambia: la ricostituzione è ammessa (fuori dal fronte).
    session.unitOrder({ unitId: unit.id, order: 'reserve' });
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, personnel: 4_000, equipment: {} } : item)));
    const impact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(impact.blocked).toBe(false);
    expect(unitOf(session, unit.id).personnel).toBeGreaterThan(4_000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — atomicità della ricostituzione (persistenza)
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — atomicità della ricostituzione', () => {
  const depotOf = (session: any) => (session as any).military.depotUnits(PID);
  const reserveOf = (session: any) => store(session).personnel().trainedReserve;
  const equipmentSum = (bag: Record<string, number> | undefined, id = 'fucili') => Math.round(Number(bag?.[id] || 0));
  /** Reparto fuori dal fronte, sotto organico e senza fucili. */
  const wornUnit = (session: any) => {
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, personnel: 4_000, equipment: {}, readiness: 0.2, frontId: null, regionId: R.ita2, status: 'degraded' as const }
      : item)));
    return unitOf(session, unit.id);
  };
  /** Fotografia delle tre authority **canoniche** lette dal DB (non dalla cache). */
  const dbState = (session: any, unitId: string) => ({
    personnel: db.prepare("SELECT data FROM game_operational_objects WHERE game_id = ? AND kind = 'personnel'").get(session.id),
    unit: db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND object_id = ?').get(session.id, unitId),
    arsenal: db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, PID),
  });
  /** Failure injection **reale**: la terza scrittura della transazione fallisce. */
  const withFailingArsenalWrite = (run: () => void) => {
    db.exec("CREATE TRIGGER pr3_fail_arsenal_insert BEFORE INSERT ON game_arsenals BEGIN SELECT RAISE(ABORT, 'injected'); END");
    db.exec("CREATE TRIGGER pr3_fail_arsenal_update BEFORE UPDATE ON game_arsenals BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try {
      run();
    } finally {
      db.exec('DROP TRIGGER pr3_fail_arsenal_insert');
      db.exec('DROP TRIGGER pr3_fail_arsenal_update');
    }
  };

  it('41: fallimento della persistenza → **rollback**: RAM e DB esattamente come prima', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    const dbBefore = dbState(session, unit.id);
    // L'azione è **valida**: la transazione parte davvero (riserva e reparti
    // scritti), poi la terza scrittura fallisce. Senza transazione resterebbe
    // uno stato a metà; con la transazione si torna indietro.
    withFailingArsenalWrite(() => {
      expect(() => session.unitAction({ action: 'reconstitute', unitId: unit.id })).toThrow();
    });
    // RAM: identica (nessuna cache aggiornata dopo un commit fallito).
    expect(reserveOf(session)).toBe(before.reserve);
    expect(unitOf(session, unit.id).personnel).toBe(before.personnel);
    expect(equipmentSum(unitOf(session, unit.id).equipment)).toBe(before.assigned);
    expect(equipmentSum(depotOf(session))).toBe(before.depot);
    // DB: identico (la verità canonica non si è mossa).
    expect(dbState(session, unit.id)).toEqual(dbBefore);
    // Conservazione intatta anche dopo il fallimento.
    expect(reserveOf(session) + unitOf(session, unit.id).personnel).toBe(before.reserve + before.personnel);
    expect(equipmentSum(depotOf(session)) + equipmentSum(unitOf(session, unit.id).equipment)).toBe(before.depot + before.assigned);
  });

  it('42: dopo il rollback una **nuova lettura** dal DB vede lo stato di prima', () => {
    const { session, gameId } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    withFailingArsenalWrite(() => {
      expect(() => session.unitAction({ action: 'reconstitute', unitId: unit.id })).toThrow();
    });
    // Nuova sessione: la cache è nuova, lo stato viene riletto dal database.
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(reserveOf(reloaded)).toBe(before.reserve);
    expect(unitOf(reloaded, unit.id).personnel).toBe(before.personnel);
    expect(equipmentSum(unitOf(reloaded, unit.id).equipment)).toBe(before.assigned);
    expect(equipmentSum(depotOf(reloaded))).toBe(before.depot);
  });

  it('43: `dryRun` non scrive **nulla** (né RAM né DB)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const dbBefore = dbState(session, unit.id);
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    const preview = session.unitAction({ action: 'reconstitute', unitId: unit.id, dryRun: true });
    expect(preview.applied).toBe(false);
    expect(preview.blocked).toBe(false);
    expect(preview.rows.length).toBeGreaterThan(0);
    // Anteprima: mostra il DOPO senza applicarlo.
    expect(unitOf(session, unit.id).personnel).toBe(before.personnel);
    expect(reserveOf(session)).toBe(before.reserve);
    expect(equipmentSum(depotOf(session))).toBe(before.depot);
    expect(dbState(session, unit.id)).toEqual(dbBefore);
  });

  it('44: l\'azione riuscita persiste le **tre** authority in una volta (conservazione)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    const impact = session.unitAction({ action: 'reconstitute', unitId: unit.id });
    expect(impact.applied).toBe(true);
    // Le due invarianti di conservazione, sulle tre authority canoniche.
    expect(reserveOf(session) + unitOf(session, unit.id).personnel).toBe(before.reserve + before.personnel);
    expect(equipmentSum(depotOf(session)) + equipmentSum(unitOf(session, unit.id).equipment)).toBe(before.depot + before.assigned);
    // E la **verità canonica** è nel DB: riserva, reparto e arsenale aggiornati
    // nella stessa transazione (nessuna riga rimasta indietro).
    const personnelRow = db.prepare("SELECT data FROM game_operational_objects WHERE game_id = ? AND kind = 'personnel'").get(session.id) as any;
    const unitRow = db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND object_id = ?').get(session.id, unit.id) as any;
    const arsenalRow = db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, PID) as any;
    expect(JSON.parse(personnelRow.data).trainedReserve).toBe(reserveOf(session));
    expect(JSON.parse(unitRow.data).personnel).toBe(unitOf(session, unit.id).personnel);
    expect(equipmentSum(JSON.parse(arsenalRow.units))).toBe(equipmentSum(depotOf(session)));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — read model: iniziativa reale ≠ ruoli storici
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — read model bidirezionale', () => {
  const frontCard = (session: any, frontId: string) => session.getArsenal().objects.objects
    .find((object: any) => String(object.id) === String(frontId));
  const factOf = (card: any, label: string) => (card.facts || []).find((item: any) => item.label === label);

  it('45: il fronte mostra ruolo storico **e** iniziativa reale (testi neutri al collasso)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const front = frontOf(session)!;
    // Iniziativa all'attaccante storico: si legge, non si interpreta.
    store(session).saveFronts([{ ...front, attackerPressure: 9, defenderPressure: 2, momentumPolityId: front.attackerPolityId }]);
    const card = frontCard(session, front.id);
    expect(card).toBeTruthy();
    expect(String(factOf(card, 'Attaccante').text)).toContain(front.attackerPolityId);
    expect(String(factOf(card, 'Difensore').text)).toContain(front.defenderPolityId);
    // I ruoli storici **non** si presentano come «chi avanza».
    expect(String(factOf(card, 'Attaccante').text)).toMatch(/ruolo storico/i);
    expect(String(factOf(card, 'Attaccante').text)).toMatch(/non è «chi avanza»/i);
    expect(String(factOf(card, 'Iniziativa').text)).toContain(front.attackerPolityId);
    expect(String(factOf(card, 'Iniziativa').text)).toMatch(/sola lettura/i);
    // Obiettivo dichiarato = dell'attaccante storico; la controffensiva calcola il suo.
    expect(String(factOf(card, 'Obiettivo dichiarato').text)).toMatch(/controffensiva/i);
    // Iniziativa all'**altro** lato: cambia solo il dato letto.
    store(session).saveFronts([{ ...front, attackerPressure: 2, defenderPressure: 9, momentumPolityId: front.defenderPolityId }]);
    expect(String(factOf(frontCard(session, front.id), 'Iniziativa').text)).toContain(front.defenderPolityId);
    // Pressioni pari: nessuna iniziativa dichiarata (non si inventa una parte).
    store(session).saveFronts([{ ...front, attackerPressure: 5, defenderPressure: 5, momentumPolityId: null }]);
    expect(String(factOf(frontCard(session, front.id), 'Iniziativa').text)).toMatch(/Nessuna iniziativa netta/i);
    // Collasso: testo **neutro**, senza attribuire la sconfitta a una parte.
    store(session).saveFronts([{ ...front, status: 'collapsed' }]);
    const collapsed = frontCard(session, front.id);
    const detail = String(collapsed.problems.find((problem: any) => /collassato/i.test(problem.label))?.detail || '');
    expect(detail).toMatch(/una delle parti non tiene/i);
    expect(detail).not.toMatch(/La difesa ha respinto|pressione nemica domina/i);
    expect(String(collapsed.why)).toMatch(/contrattacca|difensore/i);
  });

  it('46: l\'iniziativa segue le pressioni del periodo e **sopravvive** a salvataggio e ricarica', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    declaredPower(session, R.aut1, 40);
    session.warFronts.advanceFronts(30, '2026-01-31');
    const after = frontOf(session)!;
    const expected = after.attackerPressure === after.defenderPressure
      ? null
      : after.attackerPressure > after.defenderPressure
        ? after.attackerPolityId
        : after.defenderPolityId;
    expect(after.momentumPolityId ?? null).toBe(expected);
    // È dentro `WarFrontState` (⇒ checkpoint), non un campo nuovo di `SaveData`.
    const saveId = session.save('momentum').saveId;
    const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
    const saved = JSON.parse(row.data);
    const savedFront = saved.operationalState.rows.find((item: any) => item.kind === 'front');
    expect(savedFront.data.momentumPolityId ?? null).toBe(expected);
    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    expect(frontOf(session)!.momentumPolityId ?? null).toBe(expected);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — commit canonico vs refresh derivato (best-effort)
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — un commit riuscito non diventa errore API', () => {
  const depotOf = (session: any) => (session as any).military.depotUnits(PID);
  const reserveOf = (session: any) => store(session).personnel().trainedReserve;
  const equipmentSum = (bag: Record<string, number> | undefined, id = 'fucili') => Math.round(Number(bag?.[id] || 0));
  const wornUnit = (session: any) => {
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, personnel: 4_000, equipment: {}, readiness: 0.2, frontId: null, regionId: R.ita2, status: 'degraded' as const }
      : item)));
    return unitOf(session, unit.id);
  };

  it('47: se il refresh **derivato** fallisce, il commit resta e la risposta è `applied: true`', () => {
    const { session, gameId } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    // Failure injection **dopo** il commit: lo store non riesce ad adottare lo
    // stato (aggregato armate / oggetti regione). Il fatto canonico è già nel DB.
    const spy = vi.spyOn(store(session), 'adoptPersisted').mockImplementation(() => {
      throw new Error('refresh derivato non disponibile');
    });
    let impact: any = null;
    try {
      expect(() => { impact = session.unitAction({ action: 'reconstitute', unitId: unit.id }); }).not.toThrow();
      // L'iniezione è **reale**: il refresh derivato è stato invocato e ha fallito.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // La risposta resta un **successo**: l'azione è persistita.
    expect(impact).not.toBeNull();
    expect(impact.applied).toBe(true);
    expect(impact.blocked).toBe(false);
    // Il DB contiene il nuovo stato (le tre authority canoniche, committate).
    const personnelRow = db.prepare("SELECT data FROM game_operational_objects WHERE game_id = ? AND kind = 'personnel'").get(session.id) as any;
    const unitRow = db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND object_id = ?').get(session.id, unit.id) as any;
    const arsenalRow = db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, PID) as any;
    const persisted = JSON.parse(unitRow.data);
    const movedMen = persisted.personnel - before.personnel;
    const movedPieces = equipmentSum(JSON.parse(arsenalRow.units));
    expect(movedMen).toBeGreaterThan(0);
    expect(JSON.parse(personnelRow.data).trainedReserve).toBe(before.reserve - movedMen);
    // I pezzi sono passati dal deposito al reparto: anche il deposito è nel DB.
    expect(equipmentSum(JSON.parse(arsenalRow.units))).toBeLessThan(before.depot);
    // Conservazione: il totale nazionale non cambia (riserva+reparto, deposito+assegnato).
    expect(JSON.parse(personnelRow.data).trainedReserve + persisted.personnel).toBe(before.reserve + before.personnel);
    // **Nessuna invalidazione manuale** qui: è il codice di produzione ad averla
    // fatta nel `catch` del refresh derivato, quindi la lettura nella **stessa**
    // sessione è già allineata al database.
    expect(reserveOf(session)).toBe(JSON.parse(personnelRow.data).trainedReserve);
    expect(unitOf(session, unit.id).personnel).toBe(persisted.personnel);
    // Una **lettura successiva** (sessione nuova) vede lo stesso stato.
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(reserveOf(reloaded)).toBe(JSON.parse(personnelRow.data).trainedReserve);
    expect(unitOf(reloaded, unit.id).personnel).toBe(persisted.personnel);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MILITARY PR3 — POST-MERGE CACHE RECOVERY
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY PR3 — cache recovery dopo un refresh derivato fallito', () => {
  const depotOf = (session: any) => (session as any).military.depotUnits(PID);
  const arsenalOf = (session: any) => (session as any).military.arsenalUnits(PID);
  const reserveOf = (session: any) => store(session).personnel().trainedReserve;
  const equipmentSum = (bag: Record<string, number> | undefined, id = 'fucili') => Math.round(Number(bag?.[id] || 0));
  const wornUnit = (session: any) => {
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, personnel: 4_000, equipment: {}, readiness: 0.2, frontId: null, regionId: R.ita2, status: 'degraded' as const }
      : item)));
    return unitOf(session, unit.id);
  };
  const dbRows = (session: any, unitId: string) => ({
    personnel: JSON.parse((db.prepare("SELECT data FROM game_operational_objects WHERE game_id = ? AND kind = 'personnel'").get(session.id) as any).data),
    unit: JSON.parse((db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND object_id = ?').get(session.id, unitId) as any).data),
    arsenal: JSON.parse((db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, PID) as any).units),
  });
  /**
   * Esegue una `reconstitute` **valida** facendo fallire il **refresh derivato**
   * chiamato da `saveArmies()` → `saveArmiesForSession()` → `syncRegionsToDB()`.
   *
   * L'iniezione avviene **dopo** che `adoptPersisted` ha già mutato
   * `snapshot.personnel`/`snapshot.units` in RAM: è il caso reale delle cache
   * miste (RAM nuova, armate parziali, arsenale vecchio). Nessuna invalidazione
   * manuale: se lo stato torna coerente, è merito del codice di produzione.
   */
  const reconstituteWithDerivedFailure = (session: any) => {
    const unit = wornUnit(session);
    (session as any).military.saveArsenal(PID, { fucili: 5_000 });
    store(session).savePersonnel({ ...store(session).personnel(), trainedReserve: 9_000 });
    const before = {
      reserve: reserveOf(session),
      personnel: unitOf(session, unit.id).personnel,
      assigned: equipmentSum(unitOf(session, unit.id).equipment),
      depot: equipmentSum(depotOf(session)),
    };
    const spy = vi.spyOn(session, 'saveArmiesForSession').mockImplementation(() => {
      throw new Error('derived persistence non disponibile');
    });
    let impact: any = null;
    try {
      expect(() => { impact = session.unitAction({ action: 'reconstitute', unitId: unit.id }); }).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    return { unit, before, impact, after: dbRows(session, unit.id) };
  };

  it('48: il fallimento del refresh derivato invalida la **cache operativa** (la stessa sessione si riallinea)', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const { unit, before, impact, after } = reconstituteWithDerivedFailure(session);
    // L'azione è applicata: il commit canonico è avvenuto.
    expect(impact.applied).toBe(true);
    expect(impact.blocked).toBe(false);
    // Il DB ha i valori nuovi (riserva e reparto).
    expect(after.personnel.trainedReserve).toBe(before.reserve - (after.unit.personnel - before.personnel));
    expect(after.unit.personnel).toBeGreaterThan(before.personnel);
    // **Senza** invalidazione manuale nel test, la stessa sessione legge dal DB:
    // nessuna cache mista.
    expect(reserveOf(session)).toBe(after.personnel.trainedReserve);
    expect(unitOf(session, unit.id).personnel).toBe(after.unit.personnel);
    expect(equipmentSum(unitOf(session, unit.id).equipment)).toBe(equipmentSum(after.unit.equipment));
    // Conservazione degli uomini: riserva ↓ = reparto ↑, totale invariato.
    expect(reserveOf(session) + unitOf(session, unit.id).personnel).toBe(before.reserve + before.personnel);
  });

  it("48-bis: l'aggregato **derivato** resta riparabile dal DB (nessuna cache come unica fonte)", () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const { unit, impact } = reconstituteWithDerivedFailure(session);
    expect(impact.applied).toBe(true);
    // Il refresh derivato non è avvenuto: l'oggetto-armata della mappa (derivato)
    // può essere rimasto al valore precedente. È **riparabile** perché i reparti
    // canonici sono nel DB: alla prima scrittura derivata si riallinea.
    const dbArmyOf = () => {
      for (const row of db.prepare('SELECT objects FROM game_regions WHERE game_id = ?').all(session.id) as Array<{ objects: string }>) {
        const found = (JSON.parse(row.objects || '[]') as Array<{ id: string }>).find(object => String(object.id) === 'a1');
        if (found) return found as { id: string; personnel?: number; formations?: number };
      }
      return null;
    };
    const unitsPersonnel = store(session).units()
      .filter((item: any) => String(item.armyId) === 'a1' && item.status !== 'destroyed')
      .reduce((total: number, item: any) => total + Number(item.personnel || 0), 0);
    // Riparazione deterministica: la scrittura derivata riparte dai reparti.
    store(session).saveUnits(store(session).units());
    const repaired = dbArmyOf();
    expect(repaired).toBeTruthy();
    expect(Number(repaired!.personnel)).toBe(unitsPersonnel);
    expect(unitOf(session, unit.id).personnel).toBe(store(session).units().find((item: any) => String(item.id) === String(unit.id))!.personnel);
  });

  it('49: il fallimento del refresh derivato invalida la **cache dell\'arsenale**', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const { unit, before, impact, after } = reconstituteWithDerivedFailure(session);
    expect(impact.applied).toBe(true);
    // Il deposito è cambiato: nel DB c'è il valore nuovo, quindi la cache vecchia
    // (se sopravvivesse) servirebbe un numero sbagliato.
    expect(equipmentSum(after.arsenal)).toBeLessThan(before.depot);
    expect(equipmentSum(after.arsenal)).not.toBe(before.depot);
    // La lettura dell'arsenale passa dalla cache **invalidata** → rilegge dal DB.
    expect(equipmentSum(arsenalOf(session))).toBe(equipmentSum(after.arsenal));
    expect(equipmentSum(depotOf(session))).toBe(equipmentSum(after.arsenal));
    // Conservazione dei pezzi: deposito ↓ = assegnato ↑, totale invariato.
    expect(equipmentSum(arsenalOf(session)) + equipmentSum(unitOf(session, unit.id).equipment))
      .toBe(before.depot + before.assigned);
  });
});
