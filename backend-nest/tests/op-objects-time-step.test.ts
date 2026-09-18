/**
 * OP-OBJECTS TIME-STEP — la stessa simulazione, qualunque sia la lunghezza del salto.
 *
 * Il difetto che questa suite difende: disponibilità, allocazione degli impianti
 * e fabbisogni venivano calcolati **una volta** sullo stato iniziale e poi
 * moltiplicati per l'intero periodo. Un salto di sei mesi lavorava come se il
 * ferro del primo giorno fosse disponibile fino all'ultimo.
 *
 * Il mondo di prova non ha reparti propri (`militaryPower: 0`): gli unici
 * consumi militari sono quelli che il test dichiara, quindi i numeri attesi
 * sono esatti e non dipendono da una guarnigione seminata dal motore.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { addDays } from '../src/core/simulation/calendar';

const TEST_DB = path.join(os.tmpdir(), `world-story-optime-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

// Il paese di prova non ha giacimenti propri: l'estrazione la decide il test.
vi.mock('../src/core/simulation/MilitaryIndustry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/simulation/MilitaryIndustry')>();
  return { ...actual, naturalResourcesFor: () => ({}) };
});

const WORLD_ID = 'optime_world';
const REGION_ID = `${WORLD_ID}_TSX`;
const PID = 'TSX';
const START = '2026-01-01';

let db: any;
let registry: any;
let createGame: () => { gameId: string; session: any };
let engineFacilityRecipe: (kind: any, technologies?: readonly string[]) => any;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) { onToken(1); return { content: '{}' }; },
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
  ({ engineFacilityRecipe } = await import('../src/core/simulation/OperationalState'));
  repos.worldRepository.createWithRegions(
    {
      id: WORLD_ID, name: 'OP Time-Step World', description: '', startDate: START,
      basePrompt: 'Test', historicalAccuracy: 0.8,
    },
    [
      {
        id: REGION_ID, name: 'Tessia', color: '#FF0000', owner: PID,
        // `population`/`gdp` minuscoli: la capacità di base non aggiunge reparti.
        population: 200_000, gdp: 1, militaryPower: 1, flag: PID,
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 2 },
          { id: 'p1', type: 'port', name: 'Porto', level: 1 },
        ],
      },
    ],
  );
  // `addRegion` scrive `militaryPower || 100`: lo zero va imposto dopo.
  repos.worldRepository.updateRegionsBatch([{ id: REGION_ID, militaryPower: 0 }]);
  createGame = () => registry.createSession(WORLD_ID, 'Player', REGION_ID, '#FF0000');
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

// ── Utilidades di prova ─────────────────────────────────────────────────────

/** Conto nazionale senza industria, senza reparti e senza vita propria. */
function bareAccount(session: any) {
  const account = (session as any).sessionAccounts()[PID];
  return {
    ...account,
    population: 0, factories: 0, ports: 0, universities: 0,
    forces: 0, mobilized: 0, monthlyBalance: 0,
    gdpPerCapitaUsd: 40_000,
  };
}

function store(session: any) {
  return (session as any).operationalStoreFor();
}

function stock(session: any) {
  return (session as any).resourceStock(PID);
}

/** Magazzino noto e **senza debito ereditato**: solo i numeri del test. */
function setStock(session: any, patch: Record<string, any>) {
  const current = stock(session);
  (session as any).nationState.resourceStocks.set(PID, {
    ...current, money: 0, food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, debts: [], ...patch,
  });
}

function ledger(session: any) {
  return (session as any).nationState.resourceLedgers.get(PID) || {};
}

/** Giacimento controllato: `stockpile` è il silo, `endowment` dà l'estrazione. */
function setLedger(session: any, nodes: Record<string, { stockpile?: number; endowment?: number; reserve?: number }>) {
  const next: Record<string, any> = {};
  for (const [kind, node] of Object.entries(nodes)) {
    const reserve = node.reserve ?? (node.endowment ? node.endowment * 24 : 0);
    next[kind] = {
      endowment: node.endowment ?? 0, reserve, maxReserve: reserve,
      stockpile: node.stockpile ?? 0, extractedTotal: 0,
    };
  }
  (session as any).nationState.resourceLedgers.set(PID, next);
}

/** Nessun oggetto: si parte sempre da uno stato pulito e noto. */
function noObjects(session: any) {
  store(session).saveFacilities([]);
  store(session).saveShips([]);
  store(session).saveArmies([]);
}

/** Armata dichiarata dal test: i fabbisogni non-zero vengono conservati. */
function army(monthlyNeeds: { fuel?: number; weapons?: number; food?: number }) {
  return {
    id: 'army-test', name: 'Armata di prova', regionId: null, regionName: null,
    formations: 0, personnel: 0, equipment: {},
    monthlyNeeds: { fuel: monthlyNeeds.fuel ?? 0, weapons: monthlyNeeds.weapons ?? 0, food: monthlyNeeds.food ?? 0 },
    status: 'operational', objectId: null, createdDate: START, legacyDerived: false,
  };
}

function ship(monthlyFuel: number, status = 'operational') {
  return {
    id: 'ship-test', name: 'Nave di prova', equipmentId: 'cacciatorpediniere', fleetId: null,
    regionId: null, regionName: null, crew: 100, status,
    monthlyFuel, ammunition: {}, createdDate: START, legacyDerived: false,
  };
}

/**
 * Impianto con la **forma** della ricetta del motore (stesse chiavi: nessun
 * riallineamento) e i numeri decisi dal test. Con `technologies` allineate allo
 * stock la ricetta non viene rifatta.
 */
function plant(
  id: string, kind: string,
  values: { inputs?: Record<string, number>; outputs?: Record<string, number>; status?: string },
  technologies: string[] = [],
) {
  const engine = engineFacilityRecipe(kind, technologies);
  const inputs = Object.fromEntries(Object.keys(engine.inputs).map(key => [key, values.inputs?.[key] ?? 0]));
  const outputs = Object.fromEntries(Object.keys(engine.outputs).map(key => [key, values.outputs?.[key] ?? 0]));
  return {
    id, kind, name: id, regionId: null, regionName: null,
    capacity: 10, workers: 9000, status: values.status ?? 'operational',
    recipe: { inputs, outputs, technologies: [...technologies] },
    activeOrders: [], createdDate: START, legacyDerived: false,
  };
}

/** Registro dei bollettini di un salto: stessa forma di `ProductionNotices`. */
function notices() {
  return { seen: new Set<string>(), state: new Map<string, string>() };
}

/**
 * Il tick del mondo, come lo esegue il gioco: **un periodo materiale per volta**
 * e, subito dopo il magazzino di quel periodo, gli ordini militari che leggono
 * lo stesso passaggio di allocazione.
 */
function materialTick(session: any, days: number, account: any, asOfDate: string, registry_ = notices()) {
  return (session as any).nationState.advanceResources(days, { [PID]: account }, asOfDate, {
    onPlayerSlice: (slice: any) => (session as any).advanceProduction(slice.stepDays, account, slice.factors, registry_),
  });
}

// ── §8. La funzione pura dei periodi ────────────────────────────────────────

describe('OP-OBJECTS TIME-STEP — splitMaterialPeriod', () => {
  it('suddividi in periodi materiali di al massimo 30 giorni, in modo deterministico', async () => {
    const { splitMaterialPeriod } = await import('../src/game/NationStateService');
    expect(splitMaterialPeriod(0)).toEqual([]);
    expect(splitMaterialPeriod(10)).toEqual([10]);
    expect(splitMaterialPeriod(30)).toEqual([30]);
    expect(splitMaterialPeriod(31)).toEqual([30, 1]);
    expect(splitMaterialPeriod(45)).toEqual([30, 15]);
    expect(splitMaterialPeriod(90)).toEqual([30, 30, 30]);
    expect(splitMaterialPeriod(95)).toEqual([30, 30, 30, 5]);
    expect(splitMaterialPeriod(365)).toHaveLength(13);
    expect(splitMaterialPeriod(365).reduce((total, value) => total + value, 0)).toBe(365);
    const decade = splitMaterialPeriod(3650);
    expect(decade).toHaveLength(122);
    expect(decade.reduce((total, value) => total + value, 0)).toBe(3650);
    expect(splitMaterialPeriod(15, 30)).toEqual([15]);
  });
});

describe('OP-OBJECTS TIME-STEP — mondo di prova', () => {
  it('non ha reparti propri: i consumi militari sono solo quelli dichiarati', () => {
    const session = createGame().session;
    expect((session as any).sessionAccounts()[PID].forces).toBe(0);
    expect(store(session).armies()).toHaveLength(0);
    expect(store(session).militaryNeeds()).toEqual({ food: 0, clothing: 0, weapons: 0, fuel: 0 });
  });
});

// ── 32. Equivalenza 180 giorni ≈ 6 × 30 giorni ──────────────────────────────

describe('OP-OBJECTS TIME-STEP — test 32: equivalenza', () => {
  it('un salto di 180 giorni è la stessa simulazione di sei turni da 30', async () => {
    const long = createGame().session;
    const short = createGame().session;
    const setup = (session: any) => {
      const account = bareAccount(session);
      setStock(session, { fuel: 9 });
      // `endowment` alto con riserva esaurita: il silo può tenere più di 10 di
      // minerale senza che il periodo ne estragga altro (il tetto del silo
      // cresce con il giacimento, l'estrazione no: la decide la riserva).
      setLedger(session, { iron: { stockpile: 12, endowment: 6, reserve: 0 }, coal: { stockpile: 4, endowment: 4, reserve: 0 } });
      noObjects(session);
      store(session).saveShips([ship(0.4)]);
      store(session).saveArmies([army({ fuel: 1.5, weapons: 0.3, food: 0.2 })]);
      store(session).saveFacilities([
        plant('plant-steel', 'steel_mill', { inputs: { iron: 3, coal: 1 }, outputs: { weapons: 2 } }),
        plant('plant-research', 'research_center', { outputs: { research: 1.5 } }),
      ]);
      return account;
    };
    const accountLong = setup(long);
    const accountShort = setup(short);

    (long as any).advanceResources(180, { [PID]: accountLong }, addDays(START, 180));
    for (let month = 1; month <= 6; month++) {
      (short as any).advanceResources(30, { [PID]: accountShort }, addDays(START, month * 30));
    }

    const a = stock(long);
    const b = stock(short);
    // La prova ha mordente: qualcosa si è davvero mosso.
    expect(b.weapons).toBeGreaterThan(0);
    expect(ledger(short).iron.stockpile).toBeLessThan(12);
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(a[kind], `scorta ${kind}`).toBeCloseTo(b[kind], 6);
    }
    expect(ledger(long).iron.stockpile).toBeCloseTo(ledger(short).iron.stockpile, 6);
    expect(ledger(long).coal.stockpile).toBeCloseTo(ledger(short).coal.stockpile, 6);
    expect(ledger(long).iron.extractedTotal).toBeCloseTo(ledger(short).iron.extractedTotal, 6);
  });
});

// ── 33–35. Scorte che finiscono, estrazione reale ───────────────────────────

describe('OP-OBJECTS TIME-STEP — test 33/34/35: la risorsa che finisce ferma la fabbrica', () => {
  it('33: ferro 2 con bisogno 1 al mese per 90 giorni consuma 2, non 3', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    setLedger(session, { iron: { stockpile: 2 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 1 }, outputs: { weapons: 0.1 } })]);

    (session as any).advanceResources(90, { [PID]: account }, addDays(START, 90));

    // Un solo passaggio sullo stock iniziale avrebbe preso 3 di ferro.
    expect(ledger(session).iron.stockpile).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(0.2, 6);
  });

  it('34: ferro 10 con bisogno 4 al mese non consuma più di 10', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    setLedger(session, { iron: { stockpile: 10 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 4 }, outputs: { weapons: 1 } })]);

    (session as any).advanceResources(90, { [PID]: account }, addDays(START, 90));

    expect(ledger(session).iron.stockpile).toBeCloseTo(0, 6);
    // 100% + 100% + 50%: 4 + 4 + 2 di ferro, 1 + 1 + 0,5 di armamenti.
    expect(stock(session).weapons).toBeCloseTo(2.5, 6);
  });

  it('35: senza silo la filiera usa solo l\'estrazione che il periodo produce davvero', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    // endowment 6 → 3 di estrazione al mese; riserva ampia, nessun silo iniziale.
    setLedger(session, { iron: { stockpile: 0, endowment: 6, reserve: 100 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 4 }, outputs: { weapons: 1 } })]);

    (session as any).advanceResources(90, { [PID]: account }, addDays(START, 90));

    const node = ledger(session).iron;
    // Tre mesi × 3 estratti, tutti presi: il giacimento statico non è disponibilità.
    expect(node.extractedTotal).toBeCloseTo(9, 6);
    expect(node.stockpile).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(2.25, 6);
  });

  it('35-bis: un periodo parziale estrae solo la sua parte di giacimento', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    // 3 al mese ⇒ 1,5 in quindici giorni: la disponibilità cresce col tempo,
    // non col calendario del mese.
    setLedger(session, { iron: { stockpile: 0, endowment: 6, reserve: 100 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 4 }, outputs: { weapons: 1 } })]);

    (session as any).advanceResources(15, { [PID]: account }, addDays(START, 15));

    expect(ledger(session).iron.extractedTotal).toBeCloseTo(1.5, 6);
    // 1,5 di ferro su 4 richiesti in un mese: la fabbrica lavora al 37,5% per
    // **mezzo** mese, quindi 0,1875 di armamenti — la parte che le tocca.
    expect(stock(session).weapons).toBeCloseTo(0.1875, 6);
  });
});

// ── 36. L'output diventa input dal periodo successivo ───────────────────────

describe('OP-OBJECTS TIME-STEP — test 36: output e input non si inseguono nello stesso periodo', () => {
  it('chi consuma armamenti non può usarli nel periodo in cui nascono', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    setLedger(session, {});
    noObjects(session);
    store(session).saveFacilities([
      plant('plant-maker', 'arms_factory', { inputs: { iron: 0, coal: 0 }, outputs: { weapons: 2 } }),
      plant('plant-user', 'vehicle_factory', { inputs: { weapons: 2, fuel: 0 }, outputs: { weapons: 0, clothing: 0, fuel: 0 } }),
    ]);

    const beforeFirst = store(session).allocation({ monthlyExtraction: false });
    const user = beforeFirst.facilities.find((entry: any) => entry.facilityId === 'plant-user');
    expect(user.factor).toBe(0);

    materialTick(session, 30, account, addDays(START, 30));
    expect(stock(session).weapons).toBeCloseTo(2, 6);

    const beforeSecond = store(session).allocation({ monthlyExtraction: false });
    expect(beforeSecond.facilities.find((entry: any) => entry.facilityId === 'plant-user').factor).toBe(1);

    materialTick(session, 30, account, addDays(START, 60));
    // Prodotto 2, consumato 2: il saldo del periodo è zero.
    expect(stock(session).weapons).toBeCloseTo(2, 6);
  });
});

// ── 37–39. Armate, navi e mesi parziali ─────────────────────────────────────

describe('OP-OBJECTS TIME-STEP — test 37/38/39: consumi proporzionali al tempo', () => {
  it('37: armata con 2 di carburante al mese su 90 giorni consuma 6', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 10 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveArmies([army({ fuel: 2 })]);

    (session as any).advanceResources(90, { [PID]: account }, addDays(START, 90));

    expect(store(session).militaryNeeds().fuel).toBeCloseTo(2, 6);
    expect(stock(session).fuel).toBeCloseTo(4, 6);
  });

  it('38: nave con 0,5 di carburante al mese consuma mezzo punto al mese', () => {
    const month = createGame().session;
    const halfYear = createGame().session;
    const setup = (session: any) => {
      const account = bareAccount(session);
      setStock(session, { fuel: 3 });
      setLedger(session, {});
      noObjects(session);
      store(session).saveShips([ship(0.5)]);
      return account;
    };
    const monthAccount = setup(month);
    const halfYearAccount = setup(halfYear);

    (month as any).advanceResources(30, { [PID]: monthAccount }, addDays(START, 30));
    (halfYear as any).advanceResources(180, { [PID]: halfYearAccount }, addDays(START, 180));

    expect(store(halfYear).navyFuel()).toBeCloseTo(0.5, 6);
    expect(stock(month).fuel).toBeCloseTo(2.5, 6);
    // Sei mesi al ritmo di mezzo punto al mese: il magazzino si svuota davvero.
    expect(stock(halfYear).fuel).toBeCloseTo(0, 6);
  });

  it('39: un mese parziale consuma la sua frazione di tempo', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 10 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveArmies([army({ fuel: 3 })]);

    (session as any).advanceResources(15, { [PID]: account }, addDays(START, 15));

    expect(stock(session).fuel).toBeCloseTo(8.5, 6);
  });

  it('39-bis: la carenza comparsa a metà salto viene registrata una volta sola', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 3 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveArmies([army({ fuel: 2 })]);

    const lines = (session as any).advanceResources(90, { [PID]: account }, addDays(START, 90));

    // Il secondo e il terzo periodo scoprono il deficit: una sola riga, col
    // deficit peggiore, e nessuna scorta negativa.
    const shortages = lines.filter((line: string) => line.includes('Carenza materiale'));
    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toMatch(/Carburante/);
    expect(stock(session).fuel).toBeCloseTo(0, 6);
  });
});

// ── 40. Il fattore dell'impianto cambia con la scorta ───────────────────────

describe('OP-OBJECTS TIME-STEP — test 40: fattore dell\'impianto per periodo', () => {
  it('ferro 15 con bisogno 10 al mese dà 100%, 50%, 0% — non 100% per tre mesi', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    setLedger(session, { iron: { stockpile: 15, endowment: 6, reserve: 0 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 10 }, outputs: { weapons: 1 } })]);

    const factors: number[] = [];
    for (let month = 1; month <= 3; month++) {
      factors.push(store(session).allocation({ monthlyExtraction: false }).facilities[0].factor);
      materialTick(session, 30, account, addDays(START, month * 30));
    }

    expect(factors[0]).toBeCloseTo(1, 6);
    expect(factors[1]).toBeCloseTo(0.5, 6);
    expect(factors[2]).toBeCloseTo(0, 6);
    // Ferro preso: 10 + 5 + 0 = 15; armamenti: 1 + 0,5 + 0.
    expect(ledger(session).iron.stockpile).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(1.5, 6);
  });

  it('un salto unico di 90 giorni dà gli stessi numeri dei tre periodi', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    setLedger(session, { iron: { stockpile: 15, endowment: 6, reserve: 0 } });
    noObjects(session);
    store(session).saveFacilities([plant('plant-a', 'steel_mill', { inputs: { iron: 10 }, outputs: { weapons: 1 } })]);

    materialTick(session, 90, account, addDays(START, 90));

    expect(ledger(session).iron.stockpile).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(1.5, 6);
  });
});

// ── 41–43. Ordini militari, ETA, bollettini ─────────────────────────────────

describe('OP-OBJECTS TIME-STEP — test 41/42/43: gli ordini seguono il periodo che vivono', () => {
  function orderedSession() {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { money: 500, weapons: 4, technologies: ['industria_bellica'] });
    setLedger(session, { iron: { stockpile: 15, endowment: 6, reserve: 0 } });
    noObjects(session);
    store(session).saveFacilities([
      plant('plant-order', 'arms_factory', { inputs: { iron: 10 }, outputs: { weapons: 0 } }, ['industria_bellica']),
    ]);
    // Duemila fucili: l'ordine non può chiudersi in pochi mesi di prova.
    session.procureEquipment('build', 'fucili', 2000);
    const order = session.getProduction().orders[0];
    expect(order.facilityId).toBe('plant-order');
    return { session, account, orderId: order.id };
  }

  it('41: un mese pieno, mezzo mese, zero — non tre volte il fattore iniziale', () => {
    const { session, account } = orderedSession();
    const registry_ = notices();
    const progress = () => session.getProduction().orders[0].progress;

    const start = progress();
    materialTick(session, 30, account, addDays(START, 30), registry_);
    const afterFull = progress() - start;

    materialTick(session, 30, account, addDays(START, 60), registry_);
    const afterHalf = progress() - start - afterFull;

    const lines = materialTick(session, 30, account, addDays(START, 90), registry_);
    const afterZero = progress() - start - afterFull - afterHalf;

    expect(afterFull).toBeGreaterThan(0);
    // Il secondo periodo rende metà del primo (ferro al 50%), il terzo nulla.
    expect(afterHalf).toBeCloseTo(afterFull * 0.5, 4);
    expect(afterZero).toBeCloseTo(0, 6);
    expect(lines.some((line: string) => /sospesa/.test(line))).toBe(true);
  });

  it('41-bis: un salto lungo avanza come i suoi periodi, non come il salto', () => {
    // Impianto affamato (20 di ferro al mese) con estrazione parziale (2,5):
    // l'ordine avanza ma non si chiude, così i periodi restano confrontabili.
    const build = () => {
      const session = createGame().session;
      const account = bareAccount(session);
      setStock(session, { money: 500, weapons: 4, technologies: ['industria_bellica'] });
      setLedger(session, { iron: { stockpile: 15, endowment: 5, reserve: 400 } });
      noObjects(session);
      store(session).saveFacilities([
        plant('plant-order', 'arms_factory', { inputs: { iron: 20 }, outputs: { weapons: 0 } }, ['industria_bellica']),
      ]);
      session.procureEquipment('build', 'fucili', 2000);
      return { session, account, start: session.getProduction().orders[0].progress };
    };
    const jump = build();
    const perPeriod = build();
    const progressOf = (entry: any) => (entry.session.getProduction().orders[0]?.progress ?? 100) - entry.start;

    materialTick(jump.session, 180, jump.account, addDays(START, 180));
    for (let month = 1; month <= 6; month++) {
      materialTick(perPeriod.session, 30, perPeriod.account, addDays(START, month * 30));
    }

    expect(progressOf(jump)).toBeGreaterThan(10);
    expect(progressOf(jump)).toBeLessThan(100);
    expect(progressOf(jump)).toBeCloseTo(progressOf(perPeriod), 4);
  });

  it('42: la consegna prevista si sospende a impianto fermo e torna quando riparte', () => {
    const { session, account } = orderedSession();
    materialTick(session, 90, account, addDays(START, 90));

    expect(store(session).facilityFactor('plant-order')).toBe(0);
    expect(session.getProduction().orders[0].expectedDate).toBeNull();

    // Nuovo ferro: l'impianto riparte e la data torna a esistere.
    setLedger(session, { iron: { stockpile: 15, endowment: 6, reserve: 0 } });
    expect(store(session).facilityFactor('plant-order')).toBeGreaterThan(0);
    expect(session.getProduction().orders[0].expectedDate).not.toBeNull();
  });

  it('43: un anno intero non produce dodici messaggi identici', () => {
    const single = orderedSession();
    const singleLines = materialTick(single.session, 365, single.account, addDays(START, 365));

    const spread = orderedSession();
    const registry_ = notices();
    const spreadLines: string[] = [];
    for (let month = 1; month <= 12; month++) {
      spreadLines.push(...materialTick(spread.session, 30, spread.account, addDays(START, month * 30), registry_));
    }
    spreadLines.push(...materialTick(spread.session, 5, spread.account, addDays(START, 365), registry_));

    for (const lines of [singleLines, spreadLines]) {
      expect(lines.filter((line: string) => /sospesa/.test(line)), 'sospensioni').toHaveLength(1);
    }
    // Un **salto solo** pubblica un solo bollettino di magazzino: è la somma del
    // periodo, non tredici righe una per periodo.
    expect(singleLines.filter((line: string) => line.startsWith('🏭 Magazzino nazionale'))).toHaveLength(1);
    expect(singleLines.filter((line: string) => line.includes('Nel periodo'))).toHaveLength(1);
    // Dodici **turni** distinti pubblicano invece dodici bilanci: è giusto così.
    expect(spreadLines.filter((line: string) => line.startsWith('🏭 Magazzino nazionale'))).toHaveLength(13);
  });
});

// ── 44. Il flusso pubblicato resta mensile ──────────────────────────────────

describe('OP-OBJECTS TIME-STEP — test 44: il flusso resta quello corrente', () => {
  it('dopo un anno il flusso pubblicato è mensile, non il totale del salto', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 12 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveArmies([army({ fuel: 2 })]);

    materialTick(session, 365, account, addDays(START, 365));

    const resources = session.getResources();
    const fuel = resources.flow.find((row: any) => row.kind === 'fuel');
    expect(fuel.army).toBeCloseTo(-2, 6);
    // Il fabbisogno pubblicato è quello **del paese**: l'armata (2) più il
    // consumo civile delle due fabbriche di mappa (2 × 0,05). Resta mensile.
    expect(fuel.civilian).toBeCloseTo(-0.1, 6);
    expect(fuel.total).toBeCloseTo(-2.1, 6);
    expect(resources.needs.fuel).toBeCloseTo(2.1, 6);
    const balance = resources.balance.find((row: any) => row.kind === 'fuel');
    expect(balance.balancePerMonth).toBeCloseTo(fuel.total, 6);
  });
});

// ── 45–47. Legacy, strict, invarianti, giochi lunghi ────────────────────────

describe('OP-OBJECTS TIME-STEP — legacy e strict', () => {
  it('45: senza oggetti persistenti il percorso legacy è lo stesso, anche sui salti lunghi', () => {
    const long = createGame().session;
    const short = createGame().session;
    const setup = (session: any) => {
      const account = {
        ...bareAccount(session),
        population: 5_000_000, factories: 4, ports: 1, universities: 2,
        forces: 3, mobilized: 0,
      };
      setStock(session, { food: 5, clothing: 5, weapons: 5, fuel: 5, money: 10 });
      setLedger(session, {});
      noObjects(session);
      return account;
    };
    const accountLong = setup(long);
    const accountShort = setup(short);

    (long as any).advanceResources(90, { [PID]: accountLong }, addDays(START, 90));
    for (let month = 1; month <= 3; month++) {
      (short as any).advanceResources(30, { [PID]: accountShort }, addDays(START, month * 30));
    }

    // Percorso legacy: nessun overlay, nessuna sostituzione della formula.
    expect(store(long).materialFlow()).toBeNull();
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(stock(long)[kind], `scorta legacy ${kind}`).toBeCloseTo(stock(short)[kind], 6);
    }
  });

  it('46: in un gioco strict il magazzino non avanza di un giorno', () => {
    const session = createGame().session;
    const spy = vi.spyOn(session, 'isStrictGame').mockReturnValue(true);
    const before = { ...stock(session) };
    const lines = (session as any).advanceResources(180, undefined, addDays(START, 180));
    expect(lines).toEqual([]);
    expect(stock(session).fuel).toBeCloseTo(before.fuel, 9);
    spy.mockRestore();
  });
});

describe('OP-OBJECTS TIME-STEP — invarianti e giochi lunghi', () => {
  it('47: nessuna scorta negativa e nessun materiale creato dal nulla', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 3, weapons: 1 });
    setLedger(session, { iron: { stockpile: 5 }, coal: { stockpile: 1 } });
    noObjects(session);
    store(session).saveArmies([army({ fuel: 2, weapons: 0.5, food: 0.4 })]);
    store(session).saveShips([ship(0.6)]);
    store(session).saveFacilities([plant('plant-steel', 'steel_mill', { inputs: { iron: 4, coal: 1 }, outputs: { weapons: 1 } })]);

    materialTick(session, 365, account, addDays(START, 365));

    const after = stock(session);
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(Number.isFinite(after[kind]), `${kind} finito`).toBe(true);
      expect(after[kind], `${kind} non negativo`).toBeGreaterThanOrEqual(0);
    }
    // Il silo non va sotto zero e non viene gonfiato dall'allocazione.
    for (const node of Object.values(ledger(session)) as any[]) {
      expect(node.stockpile).toBeGreaterThanOrEqual(0);
      expect(node.stockpile).toBeLessThanOrEqual(node.extractedTotal + 6 + 1e-6);
    }
  });

  it('48: dieci anni di salto non producono NaN e restano un costo ragionevole', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 50, weapons: 10, money: 100, food: 20, clothing: 10 });
    setLedger(session, { iron: { stockpile: 40, endowment: 14, reserve: 400 } });
    noObjects(session);
    store(session).saveArmies([army({ fuel: 1, weapons: 0.2, food: 0.1 })]);
    store(session).saveFacilities([plant('plant-steel', 'steel_mill', { inputs: { iron: 5 }, outputs: { weapons: 1 } })]);

    const started = Date.now();
    materialTick(session, 3650, account, addDays(START, 3650));
    const elapsed = Date.now() - started;

    const after = stock(session);
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(Number.isFinite(after[kind]), `${kind} finito`).toBe(true);
      expect(after[kind], `${kind} non negativo`).toBeGreaterThanOrEqual(0);
    }
    // Una armata da 1 al mese più il consumo civile del paese (0,1): il numero
    // pubblicato è mensile, non il totale dei dieci anni.
    expect(session.getResources().needs.fuel).toBeCloseTo(1.1, 6);
    // 122 periodi materiali: nessun ciclo enorme, costo contenuto.
    expect(elapsed).toBeLessThan(20_000);
    console.log(`[op-objects-time-step] 3650 giorni (122 periodi) in ${elapsed}ms`);
  });

  it('49: cento anni di salto restano finiti e a costo contenuto', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 20, weapons: 5, money: 50, food: 10, clothing: 10 });
    setLedger(session, { iron: { stockpile: 20, endowment: 8, reserve: 2_000 } });
    noObjects(session);
    store(session).saveArmies([army({ fuel: 1, weapons: 0.1, food: 0.1 })]);
    store(session).saveFacilities([plant('plant-steel', 'steel_mill', { inputs: { iron: 0.5 }, outputs: { weapons: 0.2 } })]);

    const started = Date.now();
    (session as any).advanceResources(36_500, { [PID]: account }, addDays(START, 36_500));
    const elapsed = Date.now() - started;

    const after = stock(session);
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(Number.isFinite(after[kind]), `${kind} finito`).toBe(true);
      expect(after[kind], `${kind} non negativo`).toBeGreaterThanOrEqual(0);
    }
    // 1.217 periodi materiali: nessun ciclo enorme.
    expect(elapsed).toBeLessThan(60_000);
    console.log(`[op-objects-time-step] 36500 giorni (1217 periodi) in ${elapsed}ms`);
    // Dieci decenni di periodi materiali: il costo è alto ma lineare, e la
    // misura resta sotto il minuto su una macchina da sviluppo.
  }, 30_000);
});
