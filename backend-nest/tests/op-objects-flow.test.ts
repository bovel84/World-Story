/**
 * OP-OBJECTS FLOW — gli oggetti persistenti entrano nel **tick materiale**.
 *
 * Verifica il principio: `scorte → produzione → consumi degli oggetti → nuove
 * scorte`, con una sola contabilità. Una armata che dichiara 2 di carburante al
 * mese deve farlo sparire davvero dal magazzino; un impianto al 50% di input
 * deve consegnare al paese il 50% della sua produzione; due impianti non possono
 * usare due volte lo stesso materiale.
 *
 * Test 38–47 del documento di consegna.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-opflow-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'opflow_world';
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
    {
      id: WORLD_ID, name: 'OP Flow World', description: '', startDate: '2026-01-01',
      basePrompt: 'Test', historicalAccuracy: 0.8,
    },
    [
      {
        id: `${WORLD_ID}_DEU`, name: 'Germania', color: '#FF0000', owner: 'DEU',
        population: 80_000_000, gdp: 4000, militaryPower: 500, flag: 'DEU',
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 },
          { id: 'p1', type: 'port', name: 'Porto', level: 2 },
          { id: 'u1', type: 'university', name: 'Politecnico', level: 3 },
          { id: 'a1', type: 'army', name: 'I Corpo', level: 4 },
        ],
      },
      {
        id: `${WORLD_ID}_SAU`, name: 'Arabia Saudita', color: '#00FF00', owner: 'SAU',
        population: 35_000_000, gdp: 1000, militaryPower: 400, flag: 'SAU',
        objects: [{ id: 'o1', type: 'army', name: 'Guardia', level: 3 }],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_DEU`, '#FF0000');
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

/** Conto nazionale senza industria e senza reparti: contano solo gli oggetti. */
function cleanAccount(session: any) {
  const account = (session as any).sessionAccounts().DEU;
  return {
    ...account,
    factories: 0, ports: 0, universities: 0,
    forces: 0, mobilized: 0,
    monthlyBalance: 0,
  };
}

function setStock(session: any, patch: Record<string, number>) {
  const current = (session as any).resourceStock('DEU');
  (session as any).nationState.resourceStocks.set('DEU', { ...current, ...patch });
}

function stock(session: any) {
  return (session as any).resourceStock('DEU');
}

function store(session: any) {
  return (session as any).operationalStoreFor();
}

/** Nessun consumo militare: le armate seed restano senza uomini né reparti. */
function silenceArmies(session: any) {
  const current = store(session).armies();
  store(session).saveArmies(current.map((army: any) => ({
    ...army, formations: 0, personnel: 0, monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
  })));
}

function facility(overrides: Record<string, any>) {
  return {
    id: 'plant-test', kind: 'steel_mill', name: 'Acciaieria di prova', regionId: null, regionName: null,
    capacity: 10, workers: 9000, status: 'operational',
    recipe: { inputs: { iron: 20 }, outputs: { weapons: 10 } },
    activeOrders: [], createdDate: '2026-01-01', legacyDerived: false,
    ...overrides,
  };
}

// ── 38–39. Allocazione: una sola scorta, nessun doppio uso ──────────────────

describe('OP-OBJECTS FLOW — test 38/39: due impianti, una sola scorta', () => {
  it('38: con 20 di ferro e due impianti da 20 il totale allocato non supera 20', async () => {
    const { allocateFacilityProduction } = await import('../src/core/simulation/OperationalState');
    const allocation = allocateFacilityProduction({
      facilities: [
        facility({ id: 'A' }),
        facility({ id: 'B', kind: 'arms_factory' }),
      ],
      availability: { iron: 20 },
      activity: 1,
    });
    const total = allocation.totalInputs.iron || 0;
    expect(total).toBeLessThanOrEqual(20 + 1e-9);
    expect(total).not.toBeCloseTo(40, 3);
    // 39: policy proporzionale — entrambi al 50%, nessuno avvantaggiato.
    expect(allocation.facilities[0].factor).toBeCloseTo(0.5, 3);
    expect(allocation.facilities[1].factor).toBeCloseTo(0.5, 3);
    expect(allocation.totalOutputs.weapons).toBeCloseTo(5 + 5, 3);
    expect(allocation.facilities[0].bottleneck?.id).toBe('iron');
    expect(allocation.facilities[0].bottleneck?.assigned).toBeCloseTo(10, 3);
  });

  it('39: due impianti con ferro abbondante lavorano entrambi a pieno regime', async () => {
    const { allocateFacilityProduction } = await import('../src/core/simulation/OperationalState');
    const allocation = allocateFacilityProduction({
      facilities: [facility({ id: 'A' }), facility({ id: 'B' })],
      availability: { iron: 100 },
      activity: 1,
    });
    expect(allocation.facilities.map(entry => entry.factor)).toEqual([1, 1]);
    expect(allocation.totalInputs.iron).toBeCloseTo(40, 3);
    expect(allocation.remaining.iron).toBeCloseTo(60, 3);
    expect(allocation.facilities.every(entry => entry.bottleneck === null)).toBe(true);
  });

  it('un materiale che il chiamante non dichiara non è un collo di bottiglia (importato)', async () => {
    const { allocateFacilityProduction } = await import('../src/core/simulation/OperationalState');
    const allocation = allocateFacilityProduction({
      facilities: [facility({ id: 'A' })],
      availability: {}, // nessuna filiera estrattiva dichiarata
      activity: 1,
    });
    expect(allocation.facilities[0].factor).toBe(1);
    expect(allocation.totalOutputs.weapons).toBeCloseTo(10, 3);
  });
});

// ── 40–41. Armate e navi consumano davvero ─────────────────────────────────

describe('OP-OBJECTS FLOW — test 40/41: i consumi degli oggetti entrano nello stock', () => {
  it('40: una armata con 2 di carburante al mese lo toglie davvero dal magazzino', () => {
    const { session } = createGame();
    const armies = store(session).armies();
    store(session).saveArmies(armies.map((army: any, index: number) => ({
      ...army, monthlyNeeds: { fuel: index === 0 ? 2 : 0, weapons: 0, food: 0 },
    })));
    store(session).saveFacilities([]);
    store(session).saveShips([]);
    setStock(session, { fuel: 10 });
    // Il tick deve applicare **esattamente** il fabbisogno che la scheda dichiara.
    const need = store(session).militaryNeeds().fuel;
    expect(need).toBeGreaterThan(2);
    (session as any).advanceResources(30, { DEU: cleanAccount(session) }, '2026-02-01');
    expect(stock(session).fuel).toBeCloseTo(10 - need, 3);
  });

  it('41: due navi con 0,4 + 0,6 di carburante al mese consumano 1,0 — e il tick lo usa', () => {
    const { session } = createGame();
    silenceArmies(session);
    store(session).saveFacilities([]);
    store(session).saveShips([
      {
        id: 'ship-a', name: 'Nave A', equipmentId: 'cacciatorpediniere', fleetId: 'fleet-1',
        regionId: null, regionName: null, crew: 100, status: 'operational',
        monthlyFuel: 0.4, ammunition: {}, createdDate: '2026-01-01', legacyDerived: false,
      },
      {
        id: 'ship-b', name: 'Nave B', equipmentId: 'cacciatorpediniere', fleetId: 'fleet-1',
        regionId: null, regionName: null, crew: 100, status: 'operational',
        monthlyFuel: 0.6, ammunition: {}, createdDate: '2026-01-01', legacyDerived: false,
      },
    ]);
    expect(store(session).navyFuel()).toBeCloseTo(1, 3);
    // Il fabbisogno militare complessivo include la quota navale: il tick ne
    // toglie una sola volta il totale, non anche il dettaglio.
    const need = store(session).militaryNeeds().fuel;
    expect(need).toBeGreaterThanOrEqual(1);
    setStock(session, { fuel: 5 });
    (session as any).advanceResources(30, { DEU: cleanAccount(session) }, '2026-02-01');
    expect(stock(session).fuel).toBeCloseTo(5 - need, 3);
  });

  it('25: una nave in manutenzione consuma metà, una in costruzione nulla', async () => {
    const { shipConsumptionFactor } = await import('../src/core/simulation/OperationalState');
    expect(shipConsumptionFactor('operational')).toBe(1);
    expect(shipConsumptionFactor('maintenance')).toBe(0.5);
    expect(shipConsumptionFactor('damaged')).toBe(0.5);
    expect(shipConsumptionFactor('under_construction')).toBe(0);
  });
});

// ── 42–43. La produzione degli impianti entra (una volta sola) ──────────────

describe('OP-OBJECTS FLOW — test 42/43: la produzione degli impianti entra nello stock', () => {
  it('42: input completo ⇒ output intero; input al 50% ⇒ metà; input zero ⇒ zero', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { allocateFacilityProduction } = await import('../src/core/simulation/OperationalState');
    const account: any = {
      population: 0, forces: 0, mobilized: 0, provinces: 1,
      factories: 0, ports: 0, universities: 0, monthlyBalance: 0, nominalGdpUsdBillions: 0,
    };
    const base: any = { money: 0, debts: [], food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [] };
    const run = (iron: number) => {
      const allocation = allocateFacilityProduction({
        facilities: [facility({ id: 'A', recipe: { inputs: { iron: 6 }, outputs: { weapons: 3 } } })],
        availability: { iron },
        activity: 1,
      });
      const overlay = {
        production: allocation.totalOutputs,
        consumption: allocation.totalInputs,
        militaryNeeds: { food: 0, clothing: 0, weapons: 0, fuel: 0 },
        naturalInputs: allocation.naturalInputs,
      };
      return { tick: advanceStock(base, account, 30, {}, undefined, overlay), allocation };
    };
    const full = run(6);
    const half = run(3);
    const none = run(0);
    expect(full.allocation.facilities[0].factor).toBe(1);
    expect(half.allocation.facilities[0].factor).toBeCloseTo(0.5, 3);
    expect(none.allocation.facilities[0].factor).toBe(0);
    // Il flusso nazionale segue davvero la scheda: niente «scheda rallentata,
    // tick pieno».
    expect(full.tick.flow.weapons).toBeCloseTo(3, 3);
    expect(half.tick.flow.weapons).toBeCloseTo(1.5, 3);
    expect(none.tick.flow.weapons).toBeCloseTo(0, 6);
    // E entra davvero nel magazzino.
    expect(full.tick.stock.weapons).toBeCloseTo(3, 3);
    expect(half.tick.stock.weapons).toBeCloseTo(1.5, 3);
    expect(none.tick.stock.weapons).toBeCloseTo(0, 6);
  });

  it('43: con gli impianti la vecchia formula delle fabbriche non si somma di nuovo', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { allocateFacilityProduction, engineFacilityRecipe } = await import('../src/core/simulation/OperationalState');
    const account: any = {
      population: 0, forces: 0, mobilized: 0, provinces: 1,
      factories: 2, ports: 0, universities: 0, monthlyBalance: 0, nominalGdpUsdBillions: 0,
    };
    const base: any = { money: 0, debts: [], food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [] };
    const legacy = advanceStock(base, account, 30, {});
    // Due impianti reali con la stessa produzione che il motore attribuiva a due
    // fabbriche: il risultato deve essere identico, non il doppio.
    const recipe = engineFacilityRecipe('steel_mill', []);
    const facilities = [1, 2].map((index) => facility({
      id: `plant-${index}`, recipe: { inputs: {}, outputs: recipe.outputs },
    }));
    const allocation = allocateFacilityProduction({ facilities, availability: {}, activity: 1 });
    // Nessun `militaryNeeds` imposto: il confronto usa lo stesso fabbisogno
    // militare del percorso legacy, così conta solo la produzione industriale.
    const overlay = { production: allocation.totalOutputs, consumption: allocation.totalInputs };
    const withObjects = advanceStock(base, account, 30, {}, undefined, overlay);
    expect(withObjects.flow.weapons).toBeCloseTo(legacy.flow.weapons, 3);
    expect(withObjects.flow.clothing).toBeCloseTo(legacy.flow.clothing, 3);
    expect(withObjects.flow.fuel).toBeCloseTo(legacy.flow.fuel, 3);
  });
});

// ── 44. Ordine su impianto fermo ───────────────────────────────────────────

describe('OP-OBJECTS FLOW — test 44: un ordine su un impianto fermo non avanza', () => {
  it('impianto inattivo ⇒ progresso invariato e consegna sospesa', () => {
    const { session } = createGame();
    const current = stock(session);
    (session as any).nationState.resourceStocks.set('DEU', { ...current, technologies: ['industria_bellica'], money: 100, weapons: 500 });
    session.procureEquipment('build', 'fucili', 1);
    const order = session.getProduction().orders[0];
    expect(order.facilityId).toBeTruthy();
    const plant = store(session).facilities().find((item: any) => item.id === order.facilityId);
    // Impianto fermo: nessuna linea attiva.
    store(session).saveFacilities(store(session).facilities().map((item: any) =>
      item.id === order.facilityId ? { ...item, status: 'idle' } : item));
    expect(plant).toBeTruthy();
    const engine = session as any;
    engine.currentTurn = engine.currentTurn + 1;
    const bulletins: string[] = engine.advanceProduction(30, undefined);
    const after = session.getProduction().orders[0];
    expect(after.progress).toBe(order.progress);
    expect(after.expectedDate).toBeNull();
    expect(bulletins.some((line: string) => /sospesa/.test(line))).toBe(true);
    // Ripristino: l'impianto torna operativo.
    store(session).saveFacilities(store(session).facilities().map((item: any) =>
      item.id === order.facilityId ? { ...item, status: 'operational' } : item));
  });
});

// ── 45–47. Legacy, scenari storici, conservazione ──────────────────────────

describe('OP-OBJECTS FLOW — test 45/46/47: legacy, storici, conservazione', () => {
  it('45: senza oggetti il tick è identico a prima (nessuna regressione)', async () => {
    const { advanceStock, civilMaterialNeeds, legacyMilitaryNeeds, materialNeeds } = await import('../src/core/simulation/MaterialEconomy');
    const account: any = {
      population: 40_000_000, forces: 6, mobilized: 2, provinces: 2,
      factories: 3, ports: 1, universities: 2, monthlyBalance: 1.5, nominalGdpUsdBillions: 200,
    };
    const base: any = { money: 5, debts: [], food: 20, clothing: 10, weapons: 10, fuel: 10, research: 5, technologies: [] };
    const withoutOverlay = advanceStock(base, account, 30, { iron: 2, oil: 1 });
    const withNull = advanceStock(base, account, 30, { iron: 2, oil: 1 }, undefined, null);
    expect(withNull.flow).toEqual(withoutOverlay.flow);
    expect(withNull.stock).toEqual(withoutOverlay.stock);
    // La somma civile + militare è esattamente il fabbisogno di sempre.
    const needs = materialNeeds(account);
    const civil = civilMaterialNeeds(account);
    const military = legacyMilitaryNeeds(account);
    expect(civil.food + military.food).toBeCloseTo(needs.food, 9);
    expect(civil.clothing + military.clothing).toBeCloseTo(needs.clothing, 9);
    expect(civil.weapons + military.weapons).toBeCloseTo(needs.weapons, 9);
    expect(civil.fuel + military.fuel).toBeCloseTo(needs.fuel, 9);
  });

  it('46: in un mondo senza navi non si inventa carburante navale né munizionamento moderno', () => {
    const { session } = createGame();
    const armies = store(session).armies();
    store(session).saveShips([]);
    const planned = armies.map((army: any, index: number) => ({
      ...army, monthlyNeeds: { fuel: index === 0 ? 1.5 : 0, weapons: index === 0 ? 0.5 : 0, food: index === 0 ? 0.25 : 0 },
    }));
    store(session).saveArmies(planned);
    const expected = store(session).armies().reduce((total: number, army: any) => total + army.monthlyNeeds.fuel, 0);
    const flow = store(session).materialFlow();
    expect(store(session).navyFuel()).toBe(0);
    expect(flow?.militaryNeeds?.fuel).toBeCloseTo(expected, 3);
    expect(flow?.militaryNeeds?.weapons).toBeCloseTo(store(session).armies()
      .reduce((total: number, army: any) => total + army.monthlyNeeds.weapons, 0), 3);
    // La marina non consuma armamenti se le munizioni mensili non sono modellate.
    expect(flow?.militaryNeeds).not.toHaveProperty('ammunition');
    const kinds = Object.keys(flow?.production || {});
    for (const kind of kinds) expect(['food', 'clothing', 'weapons', 'fuel', 'research', 'money']).toContain(kind);
  });

  it('47: conservazione — lo stock finale è iniziale + produzione − consumi', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const account: any = {
      population: 10_000_000, forces: 0, mobilized: 0, provinces: 1,
      factories: 0, ports: 0, universities: 0, monthlyBalance: 0, nominalGdpUsdBillions: 50,
    };
    const base: any = { money: 1, debts: [], food: 50, clothing: 20, weapons: 20, fuel: 20, research: 0, technologies: [] };
    const overlay = {
      production: { weapons: 4, fuel: 2, clothing: 3, research: 1 },
      consumption: { weapons: 1, fuel: 0.5 },
      militaryNeeds: { food: 0.5, clothing: 0.2, weapons: 0.4, fuel: 1 },
      navyFuel: 0.5,
    };
    const tick = advanceStock(base, account, 30, {}, undefined, overlay);
    const { storageCapacity, effectiveMaterialNeeds } = await import('../src/core/simulation/MaterialEconomy');
    const capacity = storageCapacity(account, effectiveMaterialNeeds(account, overlay));
    for (const kind of ['food', 'clothing', 'weapons', 'fuel'] as const) {
      const expected = Math.min(capacity[kind], Math.max(0, base[kind] + tick.flow[kind]));
      expect(tick.stock[kind]).toBeCloseTo(expected, 3);
    }
    // I punti ricerca non hanno un tetto di magazzino: si accumulano e basta.
    expect(tick.stock.research).toBeCloseTo(Math.max(0, base.research + tick.flow.research), 3);
    // Il saldo del motore contiene davvero oggetti e consumi. La quota navale
    // (`navyFuel`) è solo il dettaglio del flusso: il consumo vero è dentro
    // `militaryNeeds`, e non va sottratto due volte.
    expect(tick.flow.weapons).toBeCloseTo(4 - 1 - 0.4, 3);
    expect(tick.flow.fuel).toBeCloseTo(2 - 0.5 - 1, 3);
  });
});

// ── Invarianti di sistema ──────────────────────────────────────────────────

describe('OP-OBJECTS FLOW — invarianti', () => {
  it('l\'allocazione non prende più materiale di quanto ne dichiari disponibile', () => {
    const { session } = createGame();
    const allocation = store(session).allocation();
    const availability = store(session).availability();
    for (const [kind, taken] of Object.entries(allocation.totalInputs)) {
      const available = (availability as any)[kind];
      if (typeof available === 'number') expect(taken).toBeLessThanOrEqual(available + 1e-6);
    }
  });

  it('un\'armata con reparti e fabbisogni azzerati li riprende dal motore', () => {
    const { session } = createGame();
    const current = store(session).armies();
    store(session).saveArmies(current.map((army: any) => ({
      ...army, monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
    })));
    const after = store(session).armies();
    const withMen = after.filter((army: any) => army.formations > 0 || army.personnel > 0);
    expect(withMen.length).toBeGreaterThan(0);
    // Nessun numero inventato: è `materialNeeds` del motore per un reparto.
    for (const army of withMen) {
      expect(army.monthlyNeeds.weapons).toBeGreaterThan(0);
    }
    expect(store(session).militaryNeeds().weapons).toBeGreaterThan(0);
  });

  it('una ricetta salvata con la cassa fra gli input si riallinea a quella del motore', async () => {
    const { engineFacilityRecipe, facilityRecipeDrifted } = await import('../src/core/simulation/OperationalState');
    const current = engineFacilityRecipe('research_center', []);
    expect(facilityRecipeDrifted({ inputs: { money: 0.02 }, outputs: { research: 0.35 } }, current)).toBe(true);
    expect(facilityRecipeDrifted(current, current)).toBe(false);
    const { session } = createGame();
    const plant = store(session).facilities()[0];
    store(session).saveFacilities([{ ...plant, recipe: { inputs: { money: 0.05 }, outputs: plant.recipe!.outputs } }]);
    const refreshed = store(session).facilities()[0];
    expect(Object.keys(refreshed.recipe!.inputs)).not.toContain('money');
  });

  it('la scheda dell\'impianto usa lo stesso fattore del tick', async () => {
    const { persistentObjects } = await import('../src/core/simulation/OperationalState');
    const { session } = createGame();
    const current = store(session).facilities()[0];
    expect(current).toBeTruthy();
    store(session).saveFacilities([facility({ id: current.id, name: current.name })]);
    const allocation = store(session).allocation();
    const entry = allocation.facilities.find(item => item.facilityId === current.id)!;
    const snapshot = store(session).snapshot();
    const objects = persistentObjects({
      polityId: 'DEU', date: '2026-01-01', epoch: store(session).inputs?.epoch?.() || 'modern',
      armies: snapshot.armies, facilities: snapshot.facilities, ships: snapshot.ships,
      fleets: snapshot.fleets, constructions: snapshot.constructions, personnel: snapshot.personnel,
      allocation,
    } as any);
    const plant = objects.find(object => object.id === current.id)!;
    const rhythm = plant.facts.find(fact => fact.label === 'Ritmo di lavoro')!;
    expect(Number(rhythm.value)).toBeCloseTo(entry.factor * 100, 1);
  });

  it('il flusso oggetti espone produzione, consumi e fabbisogno militare coerenti', () => {
    const { session } = createGame();
    const flow = store(session).materialFlow();
    expect(flow).toBeTruthy();
    const allocation = store(session).allocation();
    expect(flow!.production).toEqual(allocation.totalOutputs);
    const military = store(session).militaryNeeds();
    expect(flow!.militaryNeeds).toEqual(military);
  });
});
