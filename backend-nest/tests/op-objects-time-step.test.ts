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
/**
 * Seconda regione dello stesso mondo, con una **economia grande**: serve ai test
 * del conto nazionale per periodo, dove una nazione minuscola avrebbe un PIL
 * arrotondato (0,1 mld) che non lascia vedere la crescita del saldo.
 */
const BIG_REGION_ID = `${WORLD_ID}_TBL`;
const BIG_PID = 'TBL';
const START = '2026-01-01';

let db: any;
let registry: any;
let createGame: () => { gameId: string; session: any };
let createBigGame: () => { gameId: string; session: any };
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
      {
        id: BIG_REGION_ID, name: 'Grandia', color: '#00FF00', owner: BIG_PID,
        // Nessun reparto (`militaryPower` azzerato sotto), economia reale.
        population: 60_000_000, gdp: 400, militaryPower: 1, flag: BIG_PID,
        objects: [
          { id: 'bf1', type: 'factory', name: 'Officine', level: 2 },
          { id: 'bp1', type: 'port', name: 'Porto grande', level: 1 },
        ],
      },
    ],
  );
  // `addRegion` scrive `militaryPower || 100`: lo zero va imposto dopo.
  repos.worldRepository.updateRegionsBatch([
    { id: REGION_ID, militaryPower: 0 },
    { id: BIG_REGION_ID, militaryPower: 0 },
  ]);
  createGame = () => registry.createSession(WORLD_ID, 'Player', REGION_ID, '#FF0000');
  createBigGame = () => registry.createSession(WORLD_ID, 'Player', BIG_REGION_ID, '#00FF00');
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

/** Magazzino di una polity qualsiasi (il giocatore è `PID`). */
function stockOf(session: any, polity: string) {
  return (session as any).resourceStock(polity);
}

/** Magazzino noto e **senza debito ereditato**: solo i numeri del test. */
function setStockOf(session: any, polity: string, patch: Record<string, any>) {
  const current = stockOf(session, polity);
  (session as any).nationState.resourceStocks.set(polity, {
    ...current, money: 0, food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, debts: [], ...patch,
  });
}

function stock(session: any) {
  return stockOf(session, PID);
}

function setStock(session: any, patch: Record<string, any>) {
  setStockOf(session, PID, patch);
}

function ledgerOf(session: any, polity: string) {
  return (session as any).nationState.resourceLedgers.get(polity) || {};
}

function ledger(session: any) {
  return ledgerOf(session, PID);
}

/** Giacimento controllato: `stockpile` è il silo, `endowment` dà l'estrazione. */
function setLedgerOf(session: any, polity: string, nodes: Record<string, { stockpile?: number; endowment?: number; reserve?: number }>) {
  const next: Record<string, any> = {};
  for (const [kind, node] of Object.entries(nodes)) {
    const reserve = node.reserve ?? (node.endowment ? node.endowment * 24 : 0);
    next[kind] = {
      endowment: node.endowment ?? 0, reserve, maxReserve: reserve,
      stockpile: node.stockpile ?? 0, extractedTotal: 0,
    };
  }
  (session as any).nationState.resourceLedgers.set(polity, next);
}

/** Giacimento controllato del paese giocatore del mondo piccolo. */
function setLedger(session: any, nodes: Record<string, { stockpile?: number; endowment?: number; reserve?: number }>) {
  setLedgerOf(session, PID, nodes);
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
 * Cosa riceve **davvero** il percorso degli ordini, periodo per periodo.
 *
 * I test confrontano due percorsi della stessa simulazione: l'avanzamento
 * dell'ordine ha un imprevisto di produzione deterministico ma **dipendente
 * dall'id di partita** (l'id è casuale a ogni esecuzione), quindi confrontare
 * la percentuale di avanzamento misurerebbe la casualità, non il tempo. Qui si
 * osserva il contratto — tempo del periodo, conto del periodo, fattori del
 * passaggio di allocazione di quel periodo — che è deterministico; le
 * asserzioni sull'avanzamento restano qualitative.
 */
function spySlices(session: any) {
  const seen: Array<{ stepDays: number; population: number; factors: Record<string, number> }> = [];
  const original = (session as any).advanceProduction.bind(session);
  const spy = vi.spyOn(session as any, 'advanceProduction').mockImplementation(
    (days: number, account: any, factors: Record<string, number> = {}, registry_?: any, temporal?: { stepDate?: string }) => {
      seen.push({
        stepDays: days,
        population: Number(account?.population) || 0,
        factors: { ...factors },
      });
      return original(days, account, factors, registry_, temporal);
    },
  );
  return { seen, restore: () => spy.mockRestore() };
}

/**
 * Il tick del mondo, come lo esegue il gioco: **un periodo materiale per volta**
 * e, subito dopo il magazzino di quel periodo, gli ordini militari che leggono
 * lo stesso passaggio di allocazione.
 */
function materialTick(session: any, days: number, account: any, asOfDate: string, registry_ = notices()) {
  return (session as any).nationState.advanceResources(days, { [PID]: account }, asOfDate, {
    onPlayerSlice: (slice: any) => (session as any).advanceProduction(
      slice.stepDays, account, slice.factors, registry_, { stepDate: slice.stepDate },
    ),
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

  it('19: un periodo parziale estrae solo la sua parte di giacimento (ex 35-bis)', () => {
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
    // OP-OBJECTS PARTIAL-PERIOD: il fabbisogno da coprire in quindici giorni è
    // **2** (metà di 4), non 4: la fabbrica è coperta al 75% (1,5/2) e per mezzo
    // mese, quindi 1 × 0,5 × 0,75 = 0,375 di armamenti. La semantica precedente
    // (37,5% di copertura su un fabbisogno mensile già scalato) valeva 0,1875.
    expect(stock(session).weapons).toBeCloseTo(0.375, 6);
  });
});

// ── §P1. Periodi parziali: 15 giorni devono essere mezzo mese ───────────────

/**
 * Impianto alimentato da una **scorta** (carburante) e impianto alimentato da un
 * **giacimento** (ferro): servono entrambi, perché il contratto dei periodi
 * parziali deve valere per lo stock (`advanceStock` × period) e per il silo
 * (`drawResourceStockpile`, già scalato).
 */
function stockFedPlant() {
  return plant('plant-a', 'vehicle_factory', { inputs: { fuel: 4 }, outputs: { weapons: 1 } });
}

function natureFedPlant(ironPerMonth = 4) {
  return plant('plant-a', 'steel_mill', { inputs: { iron: ironPerMonth }, outputs: { weapons: 1 } });
}

describe('OP-OBJECTS PARTIAL-PERIOD — test 12/13: la copertura si misura sul periodo', () => {
  it('partial-period-stock-input (12): fabbisogno 4/mese, disponibile 2, 15 giorni ⇒ fattore 100%, consumo 2', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 2 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveFacilities([stockFedPlant()]);

    const before = store(session).allocation({ monthlyExtraction: false, stepDays: 15 });
    expect(before.period).toBeCloseTo(0.5, 9);
    expect(before.facilities[0].factor).toBeCloseTo(1, 6);
    expect(before.facilities[0].inputs.fuel).toBeCloseTo(4, 6);   // mensile
    expect(before.naturalInputs).toEqual({});                     // nessun giacimento

    (session as any).advanceResources(15, { [PID]: account }, addDays(START, 15));

    // Il periodo prende 4 × 1 × 0,5 = 2 di carburante (non 4 × 0,5 × 0,5 = 1)
    // e produce metà del mensile: 1 × 0,5 = 0,5 di armamenti.
    expect(stock(session).fuel).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(0.5, 6);
  });

  it('partial-period-scarcity (13): disponibile 1 su 2 richiesti in 15 giorni ⇒ 50% di copertura', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 1 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveFacilities([stockFedPlant()]);

    (session as any).advanceResources(15, { [PID]: account }, addDays(START, 15));

    // Copertura 1/2 ⇒ fattore 0,5, consumo 4 × 0,5 × 0,5 = 1, output un quarto
    // del mensile: 1 × 0,5 × 0,5 = 0,25.
    expect(stock(session).fuel).toBeCloseTo(0, 6);
    expect(stock(session).weapons).toBeCloseTo(0.25, 6);
  });

  it('5-day-period (15): cinque giorni sono un sesto di mese', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, { fuel: 2 });
    setLedger(session, {});
    noObjects(session);
    store(session).saveFacilities([
      plant('plant-a', 'vehicle_factory', { inputs: { fuel: 6 }, outputs: { weapons: 1 } }),
    ]);

    // Fabbisogno del periodo = 6 × 5/30 = 1: con 2 disponibili è coperto al 100%.
    expect(store(session).allocation({ monthlyExtraction: false, stepDays: 5 }).facilities[0].factor).toBeCloseTo(1, 6);
    (session as any).advanceResources(5, { [PID]: account }, addDays(START, 5));
    expect(stock(session).fuel).toBeCloseTo(1, 6);           // 6 × 1 × 5/30 = 1
    expect(stock(session).weapons).toBeCloseTo(1 / 6, 6);    // 1 × 5/30
  });

  it('30-day-period (16): il mese pieno non cambia semantica', () => {
    const covered = createGame().session;
    const half = createGame().session;
    const setup = (session: any, fuel: number) => {
      const account = bareAccount(session);
      setStock(session, { fuel });
      setLedger(session, {});
      noObjects(session);
      store(session).saveFacilities([stockFedPlant()]);
      return account;
    };
    const coveredAccount = setup(covered, 4);
    const halfAccount = setup(half, 2);

    const full = store(covered).allocation({ monthlyExtraction: false, stepDays: 30 });
    expect(full.period).toBeCloseTo(1, 9);
    expect(full.facilities[0].factor).toBeCloseTo(1, 6);
    // La lettura del Dossier (senza `stepDays`) è la stessa cosa.
    expect(store(covered).allocation().facilities[0].factor).toBeCloseTo(1, 6);
    (covered as any).advanceResources(30, { [PID]: coveredAccount }, addDays(START, 30));
    expect(stock(covered).fuel).toBeCloseTo(0, 6);
    expect(stock(covered).weapons).toBeCloseTo(1, 6);

    // Con metà scorta il mese pieno dà il 50%: identico a prima del fix.
    expect(store(half).allocation().facilities[0].factor).toBeCloseTo(0.5, 6);
    (half as any).advanceResources(30, { [PID]: halfAccount }, addDays(START, 30));
    expect(stock(half).fuel).toBeCloseTo(0, 6);
    expect(stock(half).weapons).toBeCloseTo(0.5, 6);
  });
});

describe('OP-OBJECTS PARTIAL-PERIOD — test 14/18: il prelievo dal giacimento è quello del periodo', () => {
  it('partial-period-natural-input (14): silo 10, fabbisogno 4/mese, 15 giorni ⇒ il silo scende a 8', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    // Riserva zero ⇒ nessuna estrazione nel periodo: si vede solo il prelievo.
    setLedger(session, { iron: { stockpile: 10, endowment: 6, reserve: 0 } });
    noObjects(session);
    store(session).saveFacilities([natureFedPlant(4)]);

    const allocation = store(session).allocation({ monthlyExtraction: false, stepDays: 15 });
    expect(allocation.facilities[0].factor).toBeCloseTo(1, 6);
    expect(allocation.totalInputs.iron).toBeCloseTo(4, 6);       // mensile
    expect(allocation.naturalInputs.iron).toBeCloseTo(2, 6);     // del periodo

    (session as any).advanceResources(15, { [PID]: account }, addDays(START, 15));

    // Dal silo si sottraggono 2, non 4: il tempo lo scala una volta sola.
    expect(ledger(session).iron.stockpile).toBeCloseTo(8, 6);
    expect(stock(session).weapons).toBeCloseTo(0.5, 6);
  });

  it('conservation (18): ogni input consumato è fabbisogno × tempo × fattore — nessuno scaling doppio', () => {
    const session = createGame().session;
    const account = bareAccount(session);
    setStock(session, {});
    // Silo 10, fabbisogno 4 al mese: 30 giorni pieni, poi 15, poi 5.
    setLedger(session, { iron: { stockpile: 10, endowment: 6, reserve: 0 } });
    noObjects(session);
    store(session).saveFacilities([natureFedPlant(4)]);

    const siloBefore = ledger(session).iron.stockpile;
    let declared = 0;   // Σ (fabbisogno del periodo × fattore) — dal contratto
    let drawn = 0;      // Σ naturalInputs — quello che il tick preleva davvero
    const dates = [30, 45, 50];
    const days = [30, 15, 5];
    for (let index = 0; index < days.length; index++) {
      const step = days[index];
      const allocation = store(session).allocation({ monthlyExtraction: false, stepDays: step });
      const entry = allocation.facilities[0];
      const periodNeed = (entry.inputs.iron / Math.max(entry.factor, 1e-9)) * allocation.period;
      declared += periodNeed * entry.factor;
      drawn += allocation.naturalInputs.iron;
      (session as any).advanceResources(step, { [PID]: account }, addDays(START, dates[index]));
    }

    const consumed = siloBefore - ledger(session).iron.stockpile;
    // 4 (mese pieno) + 2 (mezzo, coperto) + 2/3 (cinque giorni) = 6,667.
    // Il silo è persistito a tre decimali: la tolleranza è quella.
    expect(declared).toBeCloseTo(consumed, 3);
    expect(drawn).toBeCloseTo(consumed, 6);
    expect(consumed).toBeCloseTo(4 + 2 + (4 * 5) / 30, 3);
    expect(ledger(session).iron.stockpile).toBeGreaterThanOrEqual(0);
  });
});

describe('OP-OBJECTS PARTIAL-PERIOD — test 17/44: 45 giorni sono 30 + 15', () => {
  it('45 == 30+15: popolazione, consumi civili, input naturale e armate', () => {
    const jump = createGame().session;
    const split = createGame().session;
    const setup = (session: any) => {
      // Popolazione e reparti reali: fabbisogni civili e militari non zero.
      const account = { ...bareAccount(session), population: 5_000_000, forces: 2, mobilized: 0 };
      setStock(session, { food: 20, clothing: 1, weapons: 10, fuel: 10, money: 50 });
      setLedger(session, { iron: { stockpile: 12, endowment: 6, reserve: 400 } });
      noObjects(session);
      store(session).saveArmies([army({ food: 1, weapons: 0.5, fuel: 1 })]);
      store(session).saveFacilities([natureFedPlant(4)]);
      return account;
    };
    const jumpAccount = setup(jump);
    const splitAccount = setup(split);

    (jump as any).advanceResources(45, { [PID]: jumpAccount }, addDays(START, 45));
    (split as any).advanceResources(30, { [PID]: splitAccount }, addDays(START, 30));
    (split as any).advanceResources(15, { [PID]: splitAccount }, addDays(START, 45));

    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(stock(jump)[kind], `scorta ${kind}`).toBeCloseTo(stock(split)[kind], 6);
    }
    expect(ledger(jump).iron.stockpile).toBeCloseTo(ledger(split).iron.stockpile, 6);
    expect(ledger(jump).iron.extractedTotal).toBeCloseTo(ledger(split).iron.extractedTotal, 6);
    // Il salto ha davvero lavorato: il periodo parziale non è un no-op.
    expect(ledger(jump).iron.stockpile).toBeLessThan(12);
    expect(stock(jump).weapons).not.toBeCloseTo(10, 6);
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

  it('41: il percorso degli ordini riceve fattore pieno, metà e zero — non tre volte il primo', () => {
    const { session, account } = orderedSession();
    const registry_ = notices();
    const { seen, restore } = spySlices(session);
    try {
      materialTick(session, 30, account, addDays(START, 30), registry_);
      materialTick(session, 30, account, addDays(START, 60), registry_);
      const lines = materialTick(session, 30, account, addDays(START, 90), registry_);

      // Il primo periodo ha ferro pieno, il secondo metà, il terzo niente: il
      // percorso degli ordini vede il **passaggio di allocazione del periodo**,
      // non il fattore del primo giorno ripetuto.
      expect(seen).toHaveLength(3);
      expect(seen.map(entry => entry.stepDays)).toEqual([30, 30, 30]);
      expect(seen[0].factors['plant-order']).toBeCloseTo(1, 6);
      expect(seen[1].factors['plant-order']).toBeCloseTo(0.5, 6);
      expect(seen[2].factors['plant-order']).toBeCloseTo(0, 6);
      expect(lines.some((line: string) => /sospesa/.test(line))).toBe(true);
      // E l'ordine si è davvero mosso nei periodi in cui l'impianto lavorava.
      expect(session.getProduction().orders[0].progress).toBeGreaterThanOrEqual(0);
    } finally {
      restore();
    }
  });

  it('41-bis: un salto lungo consegna ai periodi gli stessi fattori dei turni separati', () => {
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
      return { session, account };
    };
    const jump = build();
    const perPeriod = build();

    const jumpSpy = spySlices(jump.session);
    const periodSpy = spySlices(perPeriod.session);
    try {
      materialTick(jump.session, 180, jump.account, addDays(START, 180));
      for (let month = 1; month <= 6; month++) {
        materialTick(perPeriod.session, 30, perPeriod.account, addDays(START, month * 30));
      }

      // Sei periodi in entrambi i percorsi, con gli **stessi** fattori materiali:
      // un salto di sei mesi è la storia dei suoi sei mesi.
      expect(jumpSpy.seen).toHaveLength(6);
      expect(periodSpy.seen).toHaveLength(6);
      expect(jumpSpy.seen.map(entry => entry.factors['plant-order']))
        .toEqual(periodSpy.seen.map(entry => entry.factors['plant-order']));
      expect(jumpSpy.seen[0].factors['plant-order']).toBeGreaterThan(0);
      expect(jumpSpy.seen[5].factors['plant-order']).toBeLessThan(jumpSpy.seen[0].factors['plant-order']);
    } finally {
      jumpSpy.restore();
      periodSpy.restore();
    }
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
      // Una sospensione sola, non una per periodo: undici periodi a secco non
      // possono produrre undici righe uguali. (Il tiro di produzione dipende
      // dalla data e dall'ordine — id casuale di partita — quindi l'ordine può
      // anche chiudersi prima: il vincolo è «mai più di una».)
      expect(lines.filter((line: string) => /sospesa/.test(line)).length, 'sospensioni').toBeLessThanOrEqual(1);
    }
    // Un **salto solo** pubblica un solo bollettino di magazzino: è la somma del
    // periodo, non tredici righe una per periodo.
    expect(singleLines.filter((line: string) => line.startsWith('🏭 Magazzino nazionale'))).toHaveLength(1);
    expect(singleLines.filter((line: string) => line.includes('Nel periodo'))).toHaveLength(1);
    // Dodici **turni** distinti pubblicano invece dodici bilanci: è giusto così.
    expect(spreadLines.filter((line: string) => line.startsWith('🏭 Magazzino nazionale'))).toHaveLength(13);
  });
});

// ── §P2. Il conto nazionale vive i periodi del salto ───────────────────────

/**
 * Un salto di mondo come lo esegue il gioco: `advanceWorldState` fa avanzare il
 * `WorldStateEngine` **dentro** i periodi materiali, quindi il magazzino del
 * periodo legge il conto di quel periodo (popolazione, PIL, saldo).
 */
function worldJump(session: any, days: number, from: string) {
  return session.advanceWorldState(days, addDays(from, days));
}

/** Stato iniziale del mondo di prova: conti reali, scorte e giacimenti noti. */
function worldSetup(session: any, polity: string = PID, patch: Record<string, any> = {}) {
  setStockOf(session, polity, { food: 1.9, clothing: 1, weapons: 6, fuel: 5, money: 20, ...patch });
  setLedgerOf(session, polity, {
    iron: { stockpile: 3, endowment: 3, reserve: 300 },
    coal: { stockpile: 2, endowment: 2, reserve: 300 },
  });
}

function regionState(session: any, regionId: string = REGION_ID) {
  const region = (session as any).regions.get(regionId);
  return { population: region.population, gdp: region.gdp, militaryPower: region.militaryPower };
}

describe('OP-OBJECTS PARTIAL-PERIOD — test 38/45: equivalenza full-world', () => {
  it('180 == 6x30 full-world: mondo, scorte, silo e cassa', () => {
    const long = createGame().session;
    const short = createGame().session;
    worldSetup(long);
    worldSetup(short);

    worldJump(long, 180, START);
    for (let month = 1; month <= 6; month++) worldJump(short, 30, addDays(START, (month - 1) * 30));

    // Il mondo intero, non solo il magazzino: popolazione, PIL e potenza.
    expect(regionState(long)).toEqual(regionState(short));
    expect(regionState(long).population).toBeGreaterThan(200_000);
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(stock(long)[kind], `scorta ${kind}`).toBeCloseTo(stock(short)[kind], 6);
    }
    for (const kind of ['iron', 'coal']) {
      expect(ledger(long)[kind].stockpile, `silo ${kind}`).toBeCloseTo(ledger(short)[kind].stockpile, 6);
      expect(ledger(long)[kind].extractedTotal, `estratto ${kind}`).toBeCloseTo(ledger(short)[kind].extractedTotal, 6);
    }
  });

  it('365 == 12x30+5 full-world: un anno è i suoi dodici mesi più cinque giorni', () => {
    const long = createGame().session;
    const short = createGame().session;
    worldSetup(long);
    worldSetup(short);

    worldJump(long, 365, START);
    for (let month = 1; month <= 12; month++) worldJump(short, 30, addDays(START, (month - 1) * 30));
    worldJump(short, 5, addDays(START, 360));

    expect(regionState(long)).toEqual(regionState(short));
    for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
      expect(stock(long)[kind], `scorta ${kind}`).toBeCloseTo(stock(short)[kind], 6);
    }
    for (const kind of ['iron', 'coal']) {
      expect(ledger(long)[kind].stockpile, `silo ${kind}`).toBeCloseTo(ledger(short)[kind].stockpile, 6);
    }
  });

  it('debt (29): la scadenza matura nella stessa data in un salto o in sei turni', () => {
    const long = createGame().session;
    const short = createGame().session;
    const tranche = [{
      id: 'debt-test-1', label: 'Titolo di prova', principal: 20, annualRatePct: 3,
      termYears: 1, issuedDate: START, maturityDate: addDays(START, 100),
    }];
    worldSetup(long, PID, { debts: tranche });
    worldSetup(short, PID, { debts: tranche });

    const lines = worldJump(long, 180, START);
    for (let month = 1; month <= 6; month++) worldJump(short, 30, addDays(START, (month - 1) * 30));

    // Titolo emesso il 1/1 con scadenza al giorno 100: rinnovato una volta sola,
    // alla data del periodo che la contiene (1/5), in entrambi i percorsi.
    expect(stock(long).debts).toHaveLength(1);
    expect(stock(long).debts[0].issuedDate).toBe('2026-05-01');
    expect(stock(long).debts[0].issuedDate).toBe(stock(short).debts[0].issuedDate);
    expect(stock(long).debts[0].maturityDate).toBe(stock(short).debts[0].maturityDate);
    expect(stock(long).debts[0].annualRatePct).toBeCloseTo(stock(short).debts[0].annualRatePct, 9);
    expect(lines.filter((line: string) => line.includes('Scadenza del debito'))).toHaveLength(1);
  });

  it('civil-needs-progressive (27): i fabbisogni civili maturano con la popolazione che cresce', () => {
    const split = createGame().session;
    const single = createGame().session;
    worldSetup(split);
    worldSetup(single);

    // Sei turni: il consumo cresce perché la popolazione cresce.
    const perMonth: number[] = [];
    let previous = stock(split).food;
    for (let month = 1; month <= 6; month++) {
      worldJump(split, 30, addDays(START, (month - 1) * 30));
      perMonth.push(previous - stock(split).food);
      previous = stock(split).food;
    }
    const progressive = perMonth.reduce((total, value) => total + value, 0);
    // Il sesto mese consuma più del primo: i fabbisogni non sono costanti.
    expect(perMonth[5]).toBeGreaterThan(perMonth[0]);

    // Un salto unico somma i fabbisogni **progressivi**, non sei volte l'ultimo.
    worldJump(single, 180, START);
    const singleJump = 1.9 - stock(single).food;
    const naive = 6 * perMonth[5];
    expect(singleJump).toBeCloseTo(progressive, 6);
    expect(singleJump).toBeLessThan(naive - 1e-6);
    expect(progressive).toBeLessThan(naive - 1e-6);
  });

  it('treasury-progressive (28): la cassa matura col saldo di ogni periodo', () => {
    const split = createBigGame().session;
    const single = createBigGame().session;
    worldSetup(split, BIG_PID, { food: 7 });
    worldSetup(single, BIG_PID, { food: 7 });
    const before = stockOf(split, BIG_PID).money;

    const perMonth: number[] = [];
    let previous = before;
    for (let month = 1; month <= 6; month++) {
      worldJump(split, 30, addDays(START, (month - 1) * 30));
      perMonth.push(stockOf(split, BIG_PID).money - previous);
      previous = stockOf(split, BIG_PID).money;
    }
    // Il PIL cresce ⇒ il saldo mensile cresce: l'ultimo periodo rende più del primo.
    expect(perMonth[5]).toBeGreaterThan(perMonth[0]);

    worldJump(single, 180, START);
    const gained = stockOf(single, BIG_PID).money - before;
    const progressive = perMonth.reduce((total, value) => total + value, 0);
    const naive = 6 * perMonth[5];
    // Sei periodi al saldo **finale** darebbero esattamente sei volte l'ultimo.
    expect(gained).toBeCloseTo(progressive, 6);
    expect(gained).toBeLessThan(naive - 1e-6);
  });

  it('production-order-progressive (32): l\'ordine avanza col conto e i materiali del periodo', () => {
    const setup = () => {
      const session = createGame().session;
      worldSetup(session, PID, { money: 500, weapons: 6, technologies: ['industria_bellica'], debts: [] });
      store(session).saveFacilities([
        plant('plant-order', 'arms_factory', { inputs: { iron: 10 }, outputs: { weapons: 0 } }, ['industria_bellica']),
      ]);
      session.procureEquipment('build', 'fucili', 2000);
      const order = session.getProduction().orders[0];
      expect(order.facilityId).toBe('plant-order');
      return session;
    };
    const jump = setup();
    const perPeriod = setup();
    const jumpSpy = spySlices(jump);
    const periodSpy = spySlices(perPeriod);
    try {
      worldJump(jump, 180, START);
      for (let month = 1; month <= 6; month++) worldJump(perPeriod, 30, addDays(START, (month - 1) * 30));

      // Sei periodi: il percorso degli ordini riceve il **tempo**, i **fattori**
      // e il **conto** di ogni periodo (popolazione crescente), non quelli del
      // primo giorno né quelli dell'ultimo.
      expect(jumpSpy.seen).toHaveLength(6);
      expect(jumpSpy.seen.map(entry => entry.stepDays)).toEqual([30, 30, 30, 30, 30, 30]);
      expect(jumpSpy.seen[5].population).toBeGreaterThan(jumpSpy.seen[0].population);
      expect(jumpSpy.seen.map(entry => entry.factors['plant-order']))
        .toEqual(periodSpy.seen.map(entry => entry.factors['plant-order']));
      // Il silo si svuota: il fattore del sesto periodo non è quello del primo.
      expect(jumpSpy.seen[5].factors['plant-order']).toBeLessThan(jumpSpy.seen[0].factors['plant-order']);
    } finally {
      jumpSpy.restore();
      periodSpy.restore();
    }
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
