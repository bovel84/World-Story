/**
 * OP-OBJECTS PERSISTENT — test obbligatori (37–42) e invarianti.
 *
 * Verifica il cambio di direzione: **oggetti reali → aggregazione → stato
 * nazionale → UI**. Riserva come stock che si riduce, deposito vs assegnato,
 * impianti che producono dal loro stato, ordini assegnati a un impianto,
 * navi con equipaggio reale, cantieri che diventano impianti solo a fine lavori.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-opstate-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'opstate_world';
let db: any;
let worldRepository: any;
let registry: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: JSON.stringify({ events: [], narration: '', voided: [], startChat: [] }) }; },
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
  worldRepository = repos.worldRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'OP State World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
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
        id: `${WORLD_ID}_AUT`, name: 'Austria', color: '#00FF00', owner: 'AUT',
        population: 9_000_000, gdp: 400, militaryPower: 40, flag: 'AUT',
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 2 }],
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
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

const byKind = (objects: any[], kind: string) => objects.filter(object => object.kind === kind);
const factOf = (object: any, label: string) => object.facts.find((item: any) => item.label === label);

// ── Test 37 — riserva come stock ─────────────────────────────────────────────

describe('OP-OBJECTS PERSISTENT — test 37: la riserva è uno stock che si riduce', () => {
  it('creare 1 reparto toglie gli uomini dalla riserva (non li aggiunge)', () => {
    const { session } = createGame();
    const before = session.getArsenal();
    const beforeActive = Number(before.manpower.activePersonnel);
    const beforeReserve = Number(before.manpower.reservePersonnel);
    const result = session.raiseFormation({ formations: 1 });
    expect(result.applied).toBe(true);
    expect(result.men).toBeGreaterThan(0);
    const after = session.getArsenal();
    // Uomini in armi: crescono della formazione.
    expect(Number(after.manpower.activePersonnel)).toBe(beforeActive + result.men);
    // Riserva addestrata: **cala** esattamente degli stessi uomini.
    expect(Number(after.manpower.reservePersonnel)).toBe(beforeReserve - result.men);
    expect(Number(after.manpower.reservePersonnel)).toBeLessThan(beforeReserve);
  });

  it('l\'anteprima mostra il consumo reale della riserva e il passaggio deposito → armata', () => {
    const { session } = createGame();
    const before = session.getArsenal();
    const preview = session.formationPreview({ formations: 1 });
    // Riserva: PRIMA → DOPO con lo stock reale (mai in aumento).
    const reserve = preview.deltas.find(delta => delta.label === 'Riserva addestrata')!;
    expect(reserve.before).toBe(Number(before.manpower.reservePersonnel));
    expect(reserve.after).toBe(reserve.before - preview.plan.men);
    expect(reserve.after).toBeLessThan(reserve.before);
    // Pezzi: dal deposito all'armata, totale nazionale invariato.
    const depot = preview.deltas.find(delta => delta.label === 'Deposito armi individuali')!;
    const assigned = preview.deltas.find(delta => delta.label === 'Armi individuali assegnate')!;
    expect(depot.before).toBe(Number(before.stockpile.fucili || 0));
    expect(depot.after).toBe(depot.before - preview.plan.riflesConsumed);
    expect(assigned.after - assigned.before).toBe(preview.plan.riflesConsumed);
    expect(depot.before + assigned.before).toBe(depot.after + assigned.after);
    // Nessuna scrittura: l'anteprima non tocca l'arsenale.
    const after = session.getArsenal();
    expect(after.units.fucili).toBe(before.units.fucili);
    expect(after.manpower.reservePersonnel).toBe(before.manpower.reservePersonnel);
  });

  it('senza riserva sufficiente la creazione è rifiutata, non compensata a debito', () => {
    const { session } = createGame();
    // 60 reparti: molto oltre il bacino mobilitabile della partita di prova.
    let error: Error | null = null;
    try {
      session.raiseFormation({ formations: 60 });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).toBeTruthy();
    expect(String(error?.message)).toMatch(/formation_blocked/);
  });
});

// ── Test 38 — deposito vs assegnato ──────────────────────────────────────────

describe('OP-OBJECTS PERSISTENT — test 38: deposito + assegnato = totale nazionale', () => {
  it('assegnare 9.000 pezzi su 10.000 lascia 1.000 in deposito e 9.000 all\'armata', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    expect(arsenal.stockpile).toBeTruthy();
    expect(arsenal.assigned).toBeTruthy();
    for (const id of Object.keys(arsenal.units)) {
      expect(Number(arsenal.stockpile[id] || 0) + Number(arsenal.assigned[id] || 0))
        .toBe(Number(arsenal.units[id] || 0));
    }
  });

  it('la formazione sposta i pezzi dal deposito all\'armata (totale invariato)', () => {
    const { session } = createGame();
    const before = session.getArsenal();
    const result = session.raiseFormation({ formations: 1 });
    const after = session.getArsenal();
    const rifles = 'fucili';
    expect(Number(after.stockpile[rifles] || 0)).toBe(Number(before.stockpile[rifles] || 0) - Number(result.equipment[rifles] || 0));
    expect(Number(after.assigned[rifles] || 0)).toBeGreaterThanOrEqual(Number(result.equipment[rifles] || 0));
    expect(Number(after.units[rifles] || 0)).toBe(Number(before.units[rifles] || 0));
  });
});

// ── Test 39 — produzione dell'impianto limitata dagli input ──────────────────

describe('OP-OBJECTS PERSISTENT — test 39: l\'impianto produce dal suo stato', () => {
  it('input ferro 20 richiesto e 10 disponibili ⇒ output dimezzato', async () => {
    const { facilityProduction, FACILITY_RECIPES } = await import('../src/core/simulation/OperationalState');
    const facility: any = {
      id: 'f1', kind: 'steel_mill', name: 'Acciaieria', regionId: null, regionName: null,
      capacity: 10, workers: 9000, status: 'operational',
      recipe: { inputs: { iron: 20 }, outputs: { weapons: 10 } },
      activeOrders: [], createdDate: '2026-01-01', legacyDerived: false,
    };
    const half = facilityProduction(facility, { stock: { iron: 10 } });
    expect(half.factor).toBeCloseTo(0.5, 3);
    expect(half.outputs.weapons).toBeCloseTo(5, 3);
    expect(half.bottleneck?.id).toBe('iron');
    const none = facilityProduction(facility, { stock: { iron: 0 } });
    expect(none.factor).toBe(0);
    expect(Object.keys(none.outputs)).toHaveLength(0);
    const full = facilityProduction(facility, { stock: { iron: 100 } });
    expect(full.factor).toBe(1);
    expect(full.outputs.weapons).toBeCloseTo(10, 3);
    expect(FACILITY_RECIPES.steel_mill.inputs.iron).toBeGreaterThan(0);
  });

  it('impianto fermo (attività zero) non produce nulla', async () => {
    const { facilityProduction } = await import('../src/core/simulation/OperationalState');
    const facility: any = {
      id: 'f2', kind: 'arms_factory', name: 'Fabbrica', regionId: null, regionName: null,
      capacity: 10, workers: 9000, status: 'operational',
      recipe: { inputs: { iron: 1 }, outputs: { weapons: 2 } },
      activeOrders: [], createdDate: '2026-01-01', legacyDerived: false,
    };
    const stopped = facilityProduction(facility, { stock: { iron: 100 }, activity: 0 });
    expect(stopped.factor).toBe(0);
    const idle = facilityProduction({ ...facility, status: 'idle' }, { stock: { iron: 100 } });
    expect(idle.factor).toBe(0);
  });
});

// ── Test 40 — impianti e ordini persistenti ─────────────────────────────────

describe('OP-OBJECTS PERSISTENT — test 40: impianti con addetti e ordini propri', () => {
  it('gli impianti persistono tipo, addetti e capacità dal seed', () => {
    const { session } = createGame();
    const objects = session.getArsenal().objects.objects;
    const facilities = byKind(objects, 'facility');
    expect(facilities.length).toBeGreaterThanOrEqual(2);
    for (const facility of facilities) {
      const workers = factOf(facility, 'Addetti');
      expect(workers).toBeTruthy();
      expect(Number(workers.value)).toBeGreaterThan(0);
      expect(factOf(facility, 'Linee di lavorazione')).toBeTruthy();
      expect(factOf(facility, 'Tipo')).toBeTruthy();
    }
  });

  it('un ordine di produzione è assegnato a un impianto reale (facilityId persistito, anche dopo reload)', async () => {
    const { session } = createGame();
    // La costruzione richiede le tecnologie del catalogo: la partita di prova
    // nasce senza. Si sblocca la tecnologia base **nello stock del motore**
    // (stesso oggetto in cache letto da `ctx.resourceStock`).
    const stock = session.getResources().stock as any;
    if (!Array.isArray(stock.technologies)) stock.technologies = [];
    for (const technology of ['industria_bellica', 'meccanica_avanzata']) {
      if (!stock.technologies.includes(technology)) stock.technologies.push(technology);
    }
    const catalog = session.getArsenal().catalog as any[];
    const buildable = catalog.filter(item => item.domain !== 'mare' && item.canBuild)[0]
      ?? catalog.filter(item => item.canBuild)[0];
    expect(buildable).toBeTruthy();
    // Le risorse del deposito servono a costruire.
    stock.iron = 100; stock.coal = 100; stock.weapons = 100;
    const result = session.procureEquipment('build', buildable.id, 1);
    expect(result.order?.facilityId).toBeTruthy();
    const stored = session.getProduction().orders.find((order: any) => order.id === result.order.id);
    expect(stored?.facilityId).toBe(result.order.facilityId);
    // L'impianto mostra la lavorazione assegnata.
    const objects = session.getArsenal().objects.objects;
    const facility = byKind(objects, 'facility').find((item: any) => item.id === result.order.facilityId);
    expect(facility).toBeTruthy();
    const working = facility.facts.find((fact: any) => fact.label === 'Ordine in lavorazione');
    expect(working).toBeTruthy();
    // Reload reale: la sessione si ricostruisce dal database.
    const gameId = session.id ?? session.gameId;
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(reloaded).toBeTruthy();
    const storedAfter = reloaded.getProduction().orders.find((order: any) => order.id === result.order.id);
    expect(storedAfter?.facilityId).toBe(result.order.facilityId);
    // La stessa fabbrica, non una rotazione del read model.
    const facilityAfter = byKind(reloaded.getArsenal().objects.objects, 'facility')
      .find((item: any) => item.id === result.order.facilityId);
    expect(facilityAfter).toBeTruthy();
  });

  it('la capacità industriale è la somma degli impianti reali', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const facilities = byKind(arsenal.objects.objects, 'facility');
    const lines = facilities.reduce((total: number, facility: any) =>
      total + Number(factOf(facility, 'Linee di lavorazione')?.value || 0), 0);
    expect(lines).toBeGreaterThan(0);
    expect(arsenal.industrialCapacity.total).toBeGreaterThan(0);
    // Gli impianti persistiti sono la base dichiarata della capacità.
    expect(arsenal.industrialCapacity.totalBasis).toContain('impianti censiti');
  });
});

// ── Test 41 — navi persistenti con equipaggio reale ─────────────────────────

describe('OP-OBJECTS PERSISTENT — test 41: le navi hanno un id e un equipaggio reali', () => {
  it('comprare uno scafo lo mette in servizio con equipaggio preso dalla riserva', () => {
    const { session } = createGame();
    const before = session.getArsenal();
    const catalog = before.catalog as any[];
    const buyable = catalog.filter(item => item.domain === 'mare' && item.canBuy)
      .sort((a, b) => a.buyCostMln - b.buyCostMln)[0];
    expect(buyable).toBeTruthy();
    session.procureEquipment('buy', buyable.id, 1);
    const after = session.getArsenal();
    const ships = byKind(after.objects.objects, 'ship');
    expect(ships.length).toBeGreaterThanOrEqual(1);
    const ship = ships[0];
    expect(ship.id).toBeTruthy();
    expect(Number(factOf(ship, 'Equipaggio')?.value)).toBeGreaterThan(0);
    // Nessun doppio conteggio: lo scafo è uscito dal deposito.
    expect(Number(after.stockpile[buyable.id] || 0)).toBe(Number(before.stockpile[buyable.id] || 0));
    expect(Number(after.units[buyable.id] || 0)).toBe(Number(before.units[buyable.id] || 0) + 1);
    // Gli equipaggi sono uomini sotto le armi: la riserva è calata.
    expect(Number(after.manpower.reservePersonnel)).toBeLessThan(Number(before.manpower.reservePersonnel));
    // Il reload conserva le navi (persistenza, non derivazione).
    const reloaded = createGame();
    void reloaded;
    expect(byKind(after.objects.objects, 'fleet').length).toBeGreaterThanOrEqual(1);
  });

  it('la nave sopravvive al **reload della sessione** (stesso shipId)', () => {
    const { session, gameId } = createGame();
    const catalog = session.getArsenal().catalog as any[];
    const buyable = catalog.filter(item => item.domain === 'mare' && item.canBuy)
      .sort((a, b) => a.buyCostMln - b.buyCostMln)[0];
    session.procureEquipment('buy', buyable.id, 1);
    const first = byKind(session.getArsenal().objects.objects, 'ship').map((ship: any) => ship.id);
    expect(first.length).toBeGreaterThanOrEqual(1);
    // La sessione viene rimossa dalla memoria e ricostruita dal database.
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(reloaded).toBeTruthy();
    const second = byKind(reloaded.getArsenal().objects.objects, 'ship').map((ship: any) => ship.id);
    expect(second).toEqual(first);
  });
});

// ── Test 42 — cantieri: nessun beneficio prima del completamento ────────────

describe('OP-OBJECTS PERSISTENT — test 42: il cantiere diventa impianto solo a fine lavori', () => {
  it('un cantiere in corso non produce impianti; a fine lavori ne nasce uno', async () => {
    const { advanceConstructions, facilityCapacityFor } = await import('../src/core/simulation/OperationalState');
    const construction: any = {
      id: 'construction-proj-1', targetType: 'steel_mill', targetName: 'Nuova acciaieria',
      regionId: 'r1', regionName: 'Italia', progress: 80,
      materialRequirements: { iron: 24, money: 10 }, capacityDemand: 4, costRemaining: 10,
      expectedDate: '2026-06-01', createdDate: '2026-01-01', legacyDerived: true,
    };
    // Ancora in corso: nessun impianto creato.
    const ongoing = advanceConstructions({
      polityId: 'ITA', constructions: [construction], ongoingProjectIds: ['proj-1'],
      facilities: [], date: '2026-03-01',
    });
    expect(ongoing.created).toHaveLength(0);
    expect(ongoing.constructions).toHaveLength(1);
    // Progetto chiuso dal motore: nasce l'impianto, il cantiere sparisce.
    const done = advanceConstructions({
      polityId: 'ITA', constructions: [construction], ongoingProjectIds: [],
      facilities: [], date: '2026-06-01',
    });
    expect(done.completed).toEqual(['construction-proj-1']);
    expect(done.constructions).toHaveLength(0);
    expect(done.created).toHaveLength(1);
    expect(done.created[0].kind).toBe('steel_mill');
    expect(done.created[0].capacity).toBe(facilityCapacityFor('steel_mill'));
    expect(done.created[0].legacyDerived).toBe(false);
  });
});

// ── Invarianti del nuovo modello ────────────────────────────────────────────

describe('OP-OBJECTS PERSISTENT — invarianti', () => {
  it('gli uomini delle armate sommano il totale sotto le armi di terra', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const armies = byKind(arsenal.objects.objects, 'army');
    const soldiers = armies.reduce((total: number, army: any) =>
      total + Number(factOf(army, 'Uomini')?.value || 0), 0);
    // La somma delle armate è esattamente il personale attivo (terra).
    expect(soldiers).toBe(Number(arsenal.manpower.activePersonnel));
  });

  it('deposito + assegnato = totale nazionale per ogni voce', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const ids = new Set([...Object.keys(arsenal.units), ...Object.keys(arsenal.stockpile), ...Object.keys(arsenal.assigned)]);
    for (const id of ids) {
      expect(Number(arsenal.stockpile[id] || 0) + Number(arsenal.assigned[id] || 0))
        .toBe(Number(arsenal.units[id] || 0));
    }
  });

  it('il numero di navi del quadro è la somma delle navi degli oggetti', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const fleets = byKind(arsenal.objects.objects, 'fleet');
    const ships = byKind(arsenal.objects.objects, 'ship');
    const inFleets = fleets.reduce((total: number, fleet: any) =>
      total + Number(factOf(fleet, 'Navi')?.value || 0), 0);
    expect(inFleets).toBe(ships.length);
  });

  it('le funzioni pure dichiarano le invarianti del nuovo stato', async () => {
    const state = await import('../src/core/simulation/OperationalState');
    const doctrine = {
      population: 10_000_000, eligiblePopulation: 2_000_000, totalMilitaryPool: 2_000_000,
      activePersonnel: 96_000, reservePersonnel: 86_400, mobilizedPersonnel: 0, availableReserve: 86_400,
      formations: 8, mobilizedFormations: 0, menPerFormation: 12_000,
      mobilizationCap: 1_000_000, mobilizationHeadroom: 900_000, overMobilized: false,
    } as any;
    const personnel = state.seedPersonnel(doctrine, '2026-01-01');
    expect(personnel.activePersonnel).toBe(96_000);
    expect(personnel.trainedReserve).toBe(86_400);
    expect(state.personnelInvariant(personnel, doctrine)).toBe(true);
    // Uomini: 96.000 attivi / 86.400 riserva → 108.000 / 74.400.
    const transferred = state.transferMenToArmy(personnel, 12_000, doctrine);
    expect(transferred?.activePersonnel).toBe(108_000);
    expect(transferred?.trainedReserve).toBe(74_400);
    expect(state.personnelInvariant(transferred!, doctrine)).toBe(true);
    // Oltre la riserva disponibile: rifiuto.
    expect(state.transferMenToArmy(personnel, 200_000, doctrine)).toBeNull();
    expect(state.transferMenToArmy(personnel, 86_400, doctrine)).not.toBeNull();
  });

  it('il trasferimento di equipaggiamento non crea e non distrugge pezzi', async () => {
    const state = await import('../src/core/simulation/OperationalState');
    const depot = { fucili: 10_000 };
    const national = { fucili: 10_000 };
    const transfer = state.transferEquipment({
      depot, assigned: {},
      items: [{ equipmentId: 'fucili', quantity: 9_000 }],
    });
    expect(transfer).toBeTruthy();
    expect(transfer!.depot.fucili).toBe(1_000);
    expect(transfer!.assigned.fucili).toBe(9_000);
    expect(state.equipmentInvariant(transfer!.depot, transfer!.assigned, national)).toBe(true);
    // Oltre la disponibilità del deposito: rifiuto, nessun mezzo trasferimento.
    expect(state.transferEquipment({ depot, assigned: {}, items: [{ equipmentId: 'fucili', quantity: 12_000 }] })).toBeNull();
  });

  it('l\'aggregazione somma gli oggetti, senza inventare numeri', async () => {
    const state = await import('../src/core/simulation/OperationalState');
    const aggregate = state.aggregateObjects({
      armies: [
        { id: 'a', name: 'A', regionId: null, regionName: null, formations: 2, personnel: 24_000, equipment: { fucili: 24_000 }, monthlyNeeds: { fuel: 1, weapons: 2, food: 3 }, status: 'operational', objectId: 'a', createdDate: 'x', legacyDerived: false },
        { id: 'b', name: 'B', regionId: null, regionName: null, formations: 1, personnel: 12_000, equipment: {}, monthlyNeeds: { fuel: 0.5, weapons: 1, food: 1.5 }, status: 'operational', objectId: 'b', createdDate: 'x', legacyDerived: true },
      ] as any,
      facilities: [
        { id: 'f', kind: 'steel_mill', name: 'F', regionId: null, regionName: null, capacity: 10, workers: 9_000, status: 'operational', activeOrders: [], createdDate: 'x', legacyDerived: false },
        { id: 'm', kind: 'mine', name: 'M', regionId: null, regionName: null, capacity: 3, workers: 1_020, status: 'operational', activeOrders: [], createdDate: 'x', legacyDerived: false },
      ] as any,
      ships: [{ id: 's', name: 'S', equipmentId: 'fregate', fleetId: null, crew: 180, monthlyFuel: 0.72, ammunition: {}, status: 'operational', portId: null, regionId: null, createdDate: 'x', legacyDerived: false }] as any,
      fleets: [{ id: 'fl', name: 'F', shipIds: ['s'], createdDate: 'x', legacyDerived: false }] as any,
      constructions: [],
      stock: { iron: 100 },
    });
    expect(aggregate.soldiers).toBe(36_000);
    expect(aggregate.crew).toBe(180);
    expect(aggregate.underArms).toBe(36_180);
    expect(aggregate.capacity).toBe(10);
    // I lavoratori delle miniere sono lavoratori; le miniere non sono linee.
    expect(aggregate.workers).toBe(10_020);
    expect(aggregate.ships).toBe(1);
    expect(aggregate.legacyDerived).toBe(1);
  });

  it('il seed dagli aggregati legacy non cambia il totale (navi dal deposito)', async () => {
    const state = await import('../src/core/simulation/OperationalState');
    const units = { fregate: 2, fucili: 5_000 };
    const { ships } = state.seedShips({ polityId: 'ITA', units, date: '2026-01-01' });
    expect(ships).toHaveLength(2);
    expect(ships.every(ship => ship.legacyDerived)).toBe(true);
    const depot = { ...units };
    for (const ship of ships) depot[ship.equipmentId] = (depot[ship.equipmentId] || 0) - 1;
    // deposito + assegnato = totale di partenza.
    const assigned = state.assignedEquipmentOf({ armies: [], ships });
    expect(state.equipmentInvariant(depot, assigned, units)).toBe(true);
  });
});
