/**
 * OP-OBJECTS SEED-DETERMINISM — il tiro dipende dal periodo simulato, non dal bottone.
 *
 * Il difetto che questa suite difende: il seme del tiro di produzione era
 * `${gameId}:${orderId}:${turno}`. Dentro un salto lungo il turno **non cambia**,
 * quindi `advanceWorldState(180)` chiamava il tick materiale sei volte e ogni
 * periodo tirava lo **stesso** dado: sei volte lo stesso imprevisto (o sei volte
 * nessuno), e un `180` che poteva divergere da `6 × 30` a parità di materiali,
 * conto e capacità.
 *
 * Il seme ora è la **data canonica del periodo**: `advance 180 ≡ 6 × advance 30`
 * anche sulla storia produttiva (avanzamento, difetti, stato, consegne).
 *
 * Il mondo di prova non ha reparti propri (`militaryPower: 0`) e i giacimenti
 * sono dichiarati dal test: i numeri attesi sono esatti, non dipendono da una
 * guarnigione seminata dal motore.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { addDays } from '../src/core/simulation/calendar';
import {
  productionRollSeed, setbackChance, stableRoll,
  type ProductionContext,
} from '../src/core/simulation/MilitaryProduction';

const TEST_DB = path.join(os.tmpdir(), `world-story-opseed-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

// Nessun giacimento dal motore: l'estrazione la decide il test.
vi.mock('../src/core/simulation/MilitaryIndustry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/simulation/MilitaryIndustry')>();
  return { ...actual, naturalResourcesFor: () => ({}) };
});

/**
 * Registro dei tiri: la produzione passa da qui, quindi il test vede i **semi**
 * e i **contesti** che la simulazione usa davvero — non quelli che il test
 * spera. `rolls` è `null` fuori dalle misure, così le altre suite non pagano
 * nulla.
 */
let rolls: Array<{ seed: string; progressIn: number; context: ProductionContext }> | null = null;
vi.mock('../src/core/simulation/MilitaryProduction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/simulation/MilitaryProduction')>();
  return {
    ...actual,
    advanceOrder: (order: any, context: ProductionContext, months: number, seed: string) => {
      rolls?.push({
        seed, progressIn: Number(order.progress) || 0, context: { ...context },
      });
      return actual.advanceOrder(order, context, months, seed);
    },
  };
});

const WORLD_ID = 'opseed_world';
const REGION_ID = `${WORLD_ID}_SEX`;
const PID = 'SEX';
const START = '2026-01-01';
/** L'ordine ha **id fisso**: due partite non condividono il `gameId`, e il seme
 * non lo contiene. Senza id fisso il test confronterbbe due flussi diversi. */
const ORDER_ID = 'ord-seed-fixed';
const PLANT_ID = 'plant-order';
/** `missili` ha un ciclo lungo (13%/mese): l'ordine resta aperto sei periodi. */
const SLOW = 'missili_corto';
/** `fucili` (terra, 36%/mese): l'ordine si **conclude**, con le sue consegne. */
const FAST = 'fucili';

let db: any;
let registry: any;
let createGame: () => { gameId: string; session: any };
let equipmentById: (id: string) => any;
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
  ({ equipmentById } = await import('../src/core/simulation/MilitaryIndustry'));
  ({ engineFacilityRecipe } = await import('../src/core/simulation/OperationalState'));
  repos.worldRepository.createWithRegions(
    {
      id: WORLD_ID, name: 'OP Seed World', description: '', startDate: START,
      basePrompt: 'Test', historicalAccuracy: 0.8,
    },
    [
      {
        id: REGION_ID, name: 'Sesamia', color: '#FF0000', owner: PID,
        // Popolazione minuscola: la capacità di base non aggiunge reparti.
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

function store(session: any) {
  return (session as any).operationalStoreFor();
}

function stockOf(session: any, polity: string = PID) {
  return (session as any).resourceStock(polity);
}

/** Magazzino noto e **senza debito ereditato**: solo i numeri del test. */
function setStock(session: any, patch: Record<string, any>) {
  const current = stockOf(session);
  (session as any).nationState.resourceStocks.set(PID, {
    ...current, money: 0, food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, debts: [], ...patch,
  });
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

/**
 * Impianto con la **forma** della ricetta del motore (stesse chiavi: nessun
 * riallineamento) e i numeri decisi dal test. Due di ferro al mese su un silo
 * di trenta: l'impianto lavora a pieno regime per tutti i periodi di prova.
 */
function plant(id: string, kind: string, inputs: Record<string, number>) {
  const engine = engineFacilityRecipe(kind, ['industria_bellica']);
  const recipe = Object.fromEntries(Object.keys(engine.inputs).map(key => [key, inputs[key] ?? 0]));
  return {
    id, kind, name: id, regionId: null, regionName: null,
    capacity: 10, workers: 9000, status: 'operational',
    recipe: { inputs: recipe, outputs: Object.fromEntries(Object.keys(engine.outputs).map(key => [key, 0])), technologies: ['industria_bellica'] },
    activeOrders: [], createdDate: START, legacyDerived: false,
  };
}

/** Registro dei bollettini di un salto: stessa forma di `ProductionNotices`. */
function notices() {
  return { seen: new Set<string>(), state: new Map<string, string>() };
}

/**
 * Ordine con **id fisso** innestato nella cache del servizio militare: è
 * l'unica identità che due partite diverse possono condividere, ed è tutto
 * quello che serve perché i tiri siano confrontabili.
 */
function forceOrder(session: any, equipmentId: string, quantity = 2000) {
  const equipment = equipmentById(equipmentId);
  const military = (session as any).military;
  military.productionLoaded = true;
  military.productionOrders.clear();
  const order: any = {
    id: ORDER_ID, equipmentId, name: equipment.name, domain: equipment.domain,
    quantity, progress: 0, spentMln: 0, startedTurn: 1, startedDate: START,
    status: 'in_progress', note: '', qualityLoss: 0, updatedDate: START, facilityId: PLANT_ID,
  };
  military.productionOrders.set(order.id, order);
  return order;
}

/** Sessione pronta: scorte, giacimenti, un impianto reale e l'ordine a id fisso. */
function seedSession(equipmentId = SLOW, quantity = 2000) {
  const session = createGame().session;
  setStock(session, { money: 500, weapons: 4, technologies: ['industria_bellica', 'missilistica'] });
  setLedger(session, { iron: { stockpile: 30, endowment: 12, reserve: 0 } });
  noObjects(session);
  store(session).saveFacilities([plant(PLANT_ID, 'arms_factory', { iron: 2 })]);
  forceOrder(session, equipmentId, quantity);
  return session;
}

/** Stato produttivo osservabile: l'ordine (se ancora aperto) e le consegne. */
function orderState(session: any) {
  const order = (session as any).military.productionOrders.get(ORDER_ID);
  return {
    order: order ? {
      progress: order.progress, qualityLoss: order.qualityLoss, status: order.status, note: order.note,
    } : null,
    units: { ...((session as any).military.peekArsenal(PID) || {}) },
  };
}

/** Il salto del mondo, come lo esegue il gioco: data finale dichiarata. */
function worldJump(session: any, days: number, from: string) {
  return session.advanceWorldState(days, addDays(from, days));
}

/** Corse con il registro dei tiri acceso: si confrontano i **semi** usati. */
function record(run: () => void) {
  rolls = [];
  run();
  const captured = rolls as unknown as Array<{ seed: string; progressIn: number; context: ProductionContext }>;
  rolls = null;
  return captured;
}

/** Prima data (dal giorno 1) il cui tiro soddisfa la condizione. */
function firstDate(predicate: (date: string) => boolean, limit = 5000): string {
  for (let day = 1; day <= limit; day++) {
    const date = addDays(START, day);
    if (predicate(date)) return date;
  }
  throw new Error('nessuna data trovata: il test non avrebbe mordente');
}

// ── §24. La funzione pura del seme ──────────────────────────────────────────

describe('OP-OBJECTS SEED-DETERMINISM — §24: il seme è (ordine, data)', () => {
  it('stessa data ⇒ stesso seme; date diverse ⇒ semi diversi; la fase è secondaria', () => {
    const january = productionRollSeed({ orderId: ORDER_ID, date: '2026-01-31' });
    expect(january).toBe(productionRollSeed({ orderId: ORDER_ID, date: '2026-01-31' }));
    // La data **è** la coordinata: il 31 gennaio non può tirare come il 15 febbraio.
    expect(productionRollSeed({ orderId: ORDER_ID, date: '2026-02-15' })).not.toBe(january);
    // Ordini diversi tirano dadi diversi anche nello stesso giorno.
    expect(productionRollSeed({ orderId: 'ord-altro', date: '2026-01-31' })).not.toBe(january);
    // `phase` è un secondo tiro sulla stessa data, non una data.
    expect(productionRollSeed({ orderId: ORDER_ID, date: '2026-01-31', phase: '2' })).not.toBe(january);
    expect(productionRollSeed({ orderId: ORDER_ID, date: '2026-01-31' })).not.toContain('phase');
  });
});

// ── §11 §18 §22. Un salto lungo è la storia dei suoi periodi ────────────────

describe('OP-OBJECTS SEED-DETERMINISM — §18/§22/§11: sei mesi, sei dadi', () => {
  it('§22/§18: 180 giorni tirano gli stessi semi e lo stesso avanzamento di 6 × 30', () => {
    const long = seedSession();
    const short = seedSession();

    const longRolls = record(() => worldJump(long, 180, START));
    const shortRolls = record(() => {
      for (let month = 1; month <= 6; month++) worldJump(short, 30, addDays(START, (month - 1) * 30));
    });

    // Sei periodi per entrambi: un ordine aperto che sopravvive a tutti.
    expect(longRolls).toHaveLength(6);
    expect(shortRolls).toHaveLength(6);
    // Il seme è la data canonica del periodo, non il turno né la chiamata.
    expect(longRolls.map(entry => entry.seed)).toEqual([
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 30) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 60) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 90) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 120) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 150) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 180) }),
    ]);
    // Sei periodi, sei tiri **diversi**: il dado non si ripete.
    expect(new Set(longRolls.map(entry => entry.seed)).size).toBe(6);
    // Un salto unico ≡ sei turni: stessa storia produttiva, non solo stesso stock.
    expect(longRolls.map(entry => entry.seed)).toEqual(shortRolls.map(entry => entry.seed));
    expect(longRolls.map(entry => entry.progressIn)).toEqual(shortRolls.map(entry => entry.progressIn));
    expect(longRolls.map(entry => entry.context)).toEqual(shortRolls.map(entry => entry.context));
    expect(orderState(long)).toEqual(orderState(short));
    // E l'ordine si è davvero mosso: il confronto non è fra due zeri.
    expect(longRolls[5].progressIn).toBeGreaterThan(longRolls[0].progressIn);
  });

  it('§23: 45 giorni tirano gli stessi semi e lo stesso avanzamento di 30 + 15', () => {
    const long = seedSession();
    const short = seedSession();

    const longRolls = record(() => worldJump(long, 45, START));
    const shortRolls = record(() => {
      worldJump(short, 30, START);
      worldJump(short, 15, addDays(START, 30));
    });

    // Un blocco di 45 giorni è [30, 15]: due periodi, due date, due semi.
    expect(longRolls.map(entry => entry.seed)).toEqual([
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 30) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 45) }),
    ]);
    expect(shortRolls.map(entry => entry.seed)).toEqual(longRolls.map(entry => entry.seed));
    expect(shortRolls.map(entry => entry.progressIn)).toEqual(longRolls.map(entry => entry.progressIn));
    expect(orderState(long)).toEqual(orderState(short));
  });

  it('§11: due periodi consecutivi non condividono il tiro', () => {
    const session = seedSession();
    const first = record(() => worldJump(session, 30, START));
    const second = record(() => worldJump(session, 15, addDays(START, 30)));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].seed).not.toBe(second[0].seed);
  });

  it('§19: la consegna è la stessa — i difetti dipendono dai tiri, non dal bottone', () => {
    // Equipaggiamento rapido: l'ordine si **conclude** e consegna unità reali.
    const long = seedSession(FAST);
    const short = seedSession(FAST);

    const longRolls = record(() => worldJump(long, 180, START));
    const shortRolls = record(() => {
      for (let month = 1; month <= 6; month++) worldJump(short, 30, addDays(START, (month - 1) * 30));
    });

    expect(longRolls.map(entry => entry.seed)).toEqual(shortRolls.map(entry => entry.seed));
    const longState = orderState(long);
    const shortState = orderState(short);
    expect(longState).toEqual(shortState);
    // La prova che la storia produttiva è chiusa: unità consegnate identiche.
    expect(Object.keys(longState.units).length).toBeGreaterThan(0);
    expect(Number(longState.units[FAST]) || 0).toBeGreaterThan(0);
  });
});

// ── §20 §21. Il tiro ha mordente: imprevisto e catastrofe reali ─────────────

describe('OP-OBJECTS SEED-DETERMINISM — §20/§21: è la data a decidere il tiro', () => {
  it('§20: una data sfortunata produce un imprevisto vero, una fortunata no', () => {
    // La stessa partita, lo stesso mese, gli stessi materiali: cambia la data.
    const unlucky = seedSession();
    const lucky = seedSession();
    const equipment = equipmentById(SLOW);
    const account = (unlucky as any).sessionAccounts()[PID];
    const context: ProductionContext = {
      factories: Math.max(0, account?.factories || 0),
      ports: Math.max(0, account?.ports || 0),
      universities: Math.max(0, account?.universities || 0),
      stability: Number(account?.stability ?? 50),
      socialTension: Number(account?.socialTension ?? 0),
      technologies: stockOf(unlucky).technologies,
    };
    const chance = setbackChance(context, equipment);
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThanOrEqual(0.9);

    // Le date si cercano sul motore vero: il test non pesca un tiro buono.
    // La seconda data **non** deve cadere nel ramo catastrofico (che è un test a
    // parte): qui si vuole un imprevisto che la linea assorbe.
    const bad = firstDate(date => {
      const seed = productionRollSeed({ orderId: ORDER_ID, date });
      const roll = stableRoll(seed);
      if (roll >= chance * 0.4) return false;
      const catastrophic = roll < chance * 0.25 && stableRoll(`${seed}:fail`) < 0.5;
      return !catastrophic;
    });
    const good = firstDate(date => stableRoll(productionRollSeed({ orderId: ORDER_ID, date })) > Math.max(0.6, chance * 3));

    const badLines = worldJump(unlucky, 30, addDays(bad, -30));
    worldJump(lucky, 30, addDays(good, -30));

    const hurt = (unlucky as any).military.productionOrders.get(ORDER_ID);
    const safe = (lucky as any).military.productionOrders.get(ORDER_ID);
    // Imprevisto reale: nota, difetti e avanzamento arretrato.
    expect(hurt.note).toMatch(/imprevisto/);
    expect(hurt.qualityLoss).toBeGreaterThan(0);
    expect(badLines.some((line: string) => /imprevisto in produzione/.test(line))).toBe(true);
    // La data accanto, con lo stesso mese di lavoro, non tira l'imprevisto.
    expect(safe.note).toBe('');
    expect(safe.qualityLoss).toBe(0);
    expect(hurt.progress).toBeLessThan(safe.progress);
  });

  it('§21: una data sfortunata può fermare la linea (produzione fallita)', () => {
    const session = seedSession();
    const fail = firstDate(date => {
      const seed = productionRollSeed({ orderId: ORDER_ID, date });
      return stableRoll(seed) < 0.015 && stableRoll(`${seed}:fail`) < 0.5;
    });
    const lines = worldJump(session, 30, addDays(fail, -30));

    expect((session as any).military.productionOrders.get(ORDER_ID)).toBeUndefined();
    expect(lines.some((line: string) => /Produzione fallita/.test(line))).toBe(true);
  });
});

// ── §25. Il contesto è quello del periodo ───────────────────────────────────

describe('OP-OBJECTS SEED-DETERMINISM — §25: il conto del periodo, non l’ultimo mese', () => {
  it('il contesto del tiro è il conto passato al periodo, non lo snapshot della sessione', () => {
    const session = seedSession();
    const military = (session as any).military;
    const snapshot = (session as any).sessionAccounts()[PID];
    // Conto del periodo **dichiarato dal test**: stabilità bassa e tensione alta
    // non sono quelle della partita. Se il contesto leggesse lo snapshot, il
    // tiro userebbe il rischio della sessione e questo test fallirebbe.
    const forged = {
      ...snapshot,
      factories: 9, ports: 9, universities: 9, stability: 5, socialTension: 90,
    };
    const date = addDays(START, 30);

    const captured = record(() => {
      military.advanceProduction(30, forged, {}, notices(), { stepDate: date });
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].context).toEqual({
      factories: 9, ports: 9, universities: 9,
      stability: 5, socialTension: 90,
      technologies: stockOf(session).technologies,
    });
    // E il rischio usato è quello del conto del periodo.
    expect(setbackChance(captured[0].context, equipmentById(SLOW)))
      .toBeGreaterThan(setbackChance({ ...captured[0].context, stability: 50, socialTension: 0 }, equipmentById(SLOW)));
  });

  it('§25: nel salto reale il contesto è il conto del periodo, non quello gravato dal debito', () => {
    const session = seedSession();
    const military = (session as any).military;
    // Debito reale (150% del PIL): il conto **mostrato** dalla sessione porta
    // anche il peso sociale del debito, il conto del tick no. Sono due numeri
    // diversi, e il tiro deve usare quello del periodo.
    setStock(session, {
      money: 500, weapons: 4, technologies: ['industria_bellica', 'missilistica'],
      debts: [{
        id: 'debt-seed-1', label: 'Titolo di prova', principal: 1.5, annualRatePct: 3,
        termYears: 5, issuedDate: START, maturityDate: addDays(START, 2000),
      }],
    });
    const accounts: any[] = [];
    const original = military.productionContext.bind(military);
    const spy = vi.spyOn(military, 'productionContext').mockImplementation((account?: any) => {
      accounts.push(account);
      return original(account);
    });
    let jump: Array<{ seed: string; progressIn: number; context: ProductionContext }> = [];
    try {
      jump = record(() => worldJump(session, 180, START));
    } finally {
      spy.mockRestore();
    }
    const shown = (session as any).sessionAccounts()[PID];

    expect(jump).toHaveLength(6);
    expect(accounts).toHaveLength(6);
    // Il contesto di ogni periodo è costruito dal conto **passato a quel
    // periodo** (la popolazione cresce mentre il salto vive).
    expect(accounts[5].population).toBeGreaterThan(accounts[0].population);
    expect(jump.map(entry => entry.context.stability))
      .toEqual(accounts.map(account => Number(account?.stability ?? 50)));
    expect(jump.map(entry => entry.context.socialTension))
      .toEqual(accounts.map(account => Number(account?.socialTension ?? 0)));
    expect(jump.map(entry => entry.context.factories))
      .toEqual(accounts.map(account => Math.max(0, account?.factories || 0)));
    // La prova che le due fonti sono davvero diverse: il peso del debito.
    expect(shown.socialTension).toBeGreaterThan(accounts[0].socialTension);
    expect(shown.stability).toBeLessThan(accounts[0].stability);
  });
});

// ── Compatibilità: il percorso senza data dichiarata ────────────────────────

describe('OP-OBJECTS SEED-DETERMINISM — percorso legacy', () => {
  it('senza data dichiarata il tiro ripiega sulla data della sessione', () => {
    const session = seedSession();
    const military = (session as any).military;
    const captured = record(() => {
      military.advanceProduction(30, (session as any).sessionAccounts()[PID], {}, notices());
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].seed).toBe(productionRollSeed({ orderId: ORDER_ID, date: START }));
    // L'ordine conserva la data del periodo vissuto.
    expect((session as any).military.productionOrders.get(ORDER_ID).updatedDate).toBe(START);
  });

  it('un blocco di più periodi dichiara date distinte anche in una sola chiamata', () => {
    const session = seedSession();
    const military = (session as any).military;
    const captured = record(() => {
      military.advanceProduction(90, (session as any).sessionAccounts()[PID], {}, notices(), { stepDate: addDays(START, 90) });
    });

    // 90 giorni = [30, 30, 30]: le date sono quelle dei tre periodi, non tre
    // volte la data finale (né tre volte la data iniziale).
    expect(captured.map(entry => entry.seed)).toEqual([
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 30) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 60) }),
      productionRollSeed({ orderId: ORDER_ID, date: addDays(START, 90) }),
    ]);
    expect((session as any).military.productionOrders.get(ORDER_ID).updatedDate).toBe(addDays(START, 90));
  });
});
