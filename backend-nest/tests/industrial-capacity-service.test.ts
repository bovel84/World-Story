/**
 * Capacità industriale e dottrina militare, end-to-end sul motore.
 *
 * Verifica che `/arsenal` pubblichi il **quadro strutturale** della nazione —
 * epoca, uomini, copertura, prontezza, capacità industriale — calcolato dal
 * motore e non dalla UI, e che l'industria satura rallenti le consegne.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { MANPOWER_PROFILES } from '../src/core/simulation/MilitaryDoctrine';

const TEST_DB = path.join(os.tmpdir(), `world-story-capacity-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

// Spia deterministica sui mesi effettivamente passati alla lavorazione: è la
// prova che il fattore di saturazione entra nel calcolo, non solo nel testo.
const spy = vi.hoisted(() => ({ months: [] as number[] }));
vi.mock('../src/core/simulation/MilitaryProduction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/simulation/MilitaryProduction')>();
  return {
    ...actual,
    advanceOrder: (order: never, context: never, months: number, seed: string) => {
      spy.months.push(months);
      return actual.advanceOrder(order, context, months, seed);
    },
  };
});

const WORLD_ID = 'cap_world';
let db: any;
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
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();

  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Capacità World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_AAA`, name: 'Italia', color: '#009246', owner: 'AAA',
        population: 59_000_000, gdp: 2000, militaryPower: 300, flag: 'ITA',
        objects: [
          // Industria minima: una fabbrica, un porto, un ateneo.
          { id: 'f1', type: 'factory', name: 'Officine', level: 1 },
          { id: 'p1', type: 'port', name: 'Porto', level: 1 },
          { id: 'u1', type: 'university', name: 'Ateneo', level: 1 },
          { id: 'a1', type: 'army', name: 'I Corpo', level: 2 },
        ],
      },
    ],
  );

  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_AAA`, '#009246');
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

/** Sblocca la produzione bellica come nei test di arsenale. */
function armIndustry(session: any) {
  const stock = session.getResources().stock;
  (session as any).nationState.resourceStocks.set('AAA', {
    ...stock,
    technologies: ['industria_bellica', 'meccanica_avanzata'],
    money: 500,
    weapons: 5000,
  });
}

describe('quadro militare pubblicato dal motore', () => {
  it('pubblica epoca, establishment, uomini, copertura e prontezza', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    expect(arsenal.epoch).toBe('moderno');
    expect(arsenal.epochLabel).toBe('Era moderna');
    // Otto categorie moderne quando il paese ha un porto.
    expect(arsenal.establishment).toHaveLength(8);
    expect(arsenal.coverage).toHaveLength(8);
    expect(arsenal.establishment[0].source).toBe('engine_seed');
    expect(arsenal.coverage.map((row: any) => row.category)).toContain('navalSupport');
  });

  it('gli uomini derivano dai reparti reali, la riserva dalla popolazione', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const account = session.getResources().account;
    expect(arsenal.manpower.formations).toBe(account.forces);
    expect(arsenal.manpower.activePersonnel).toBe(account.forces * arsenal.manpower.menPerFormation);
    expect(arsenal.manpower.menPerFormation).toBe(12000);
    expect(arsenal.manpower.availableReserve + arsenal.manpower.mobilizedPersonnel)
      .toBe(arsenal.manpower.reservePersonnel);
    expect(arsenal.manpower.reservePersonnel).toBeGreaterThan(0);
  });

  it('il seed dell’arsenale copre esattamente le armi individuali richieste', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const account = session.getResources().account;
    const individual = arsenal.coverage.find((row: any) => row.category === 'individualWeapons');
    // Con la dottrina d'epoca: uomini in armi × quota d'epoca (moderno 75%).
    const share = MANPOWER_PROFILES[arsenal.epoch].individualWeaponShare;
    expect(individual.required).toBe(
      Math.round((account.forces + account.mobilized) * arsenal.manpower.menPerFormation * share),
    );
    // Molto più di «40 per reparto»: le armi individuali sono quelle dei soldati.
    expect(individual.required).toBeGreaterThan(account.forces * 40);
    expect(individual.coveragePct).toBe(100);
  });

  it('la dotazione di riferimento dichiara la quota di personale, non un finto per-reparto', () => {
    const { session } = createGame();
    const establishment = session.getArsenal().establishment;
    const individual = establishment.find((entry: any) => entry.category === 'individualWeapons');
    expect(individual.demand).toBe('personnel_share');
    expect(individual.perFormation).toBeNull();
    expect(individual.personnelSharePct).toBe(75);
    // Le altre categorie restano per reparto, con un numero vero.
    for (const entry of establishment.filter((item: any) => item.category !== 'individualWeapons')) {
      expect(entry.demand ?? 'per_formation').toBe('per_formation');
      expect(entry.perFormation).toBeGreaterThan(0);
    }
  });

  it('la prontezza è un numero del motore, con i suoi driver', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    expect(arsenal.readiness.readinessPct).toBeGreaterThanOrEqual(0);
    expect(arsenal.readiness.readinessPct).toBeLessThanOrEqual(100);
    expect(['healthy', 'stable', 'pressure', 'fragile', 'critical']).toContain(arsenal.readiness.status);
    expect(Array.isArray(arsenal.readiness.drivers)).toBe(true);
  });

  it('la capacità industriale deriva dagli impianti del motore', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const capacity = arsenal.industrialCapacity;
    expect(capacity.total).toBe(
      arsenal.capacity.factories * 10 + arsenal.capacity.ports * 4 + arsenal.capacity.universities * 2,
    );
    expect(capacity.total).toBeGreaterThan(0);
    expect(capacity.totalBasis).toContain('fabbriche');
    expect(capacity.allocations).toEqual([]);
    expect(capacity.utilizationPct).toBe(0);
  });
});

describe('industria satura', () => {
  it('la domanda degli ordini aperti entra nella capacità occupata', () => {
    const { session } = createGame();
    armIndustry(session);
    session.procureEquipment('build', 'fucili', 1);
    const capacity = session.getArsenal().industrialCapacity;
    expect(capacity.allocations.map((allocation: any) => allocation.kind)).toEqual(['military_production']);
    expect(capacity.byKind.military_production).toBe(4);
    expect(capacity.used).toBe(4);
    expect(capacity.defenceSharePct).toBe(100);
    expect(capacity.saturated).toBe(false);
    expect(capacity.overflowFactor).toBe(1);
    // Il primo ordine non satura un'industria che ha linee libere.
    expect(capacity.total).toBeGreaterThan(capacity.demand);
  });

  it('oltre la capacità l’industria è satura e la consegna slitta', () => {
    const { session } = createGame();
    armIndustry(session);
    session.procureEquipment('build', 'fucili', 1);
    const firstEta = session.getArsenal().production.orders[0].expectedDate;
    // Tanti ordini quanti ne servono per superare le linee disponibili.
    const total = session.getArsenal().industrialCapacity.total;
    const count = Math.floor(total / 4) + 1;
    for (let index = 1; index < count; index += 1) session.procureEquipment('build', 'fucili', 1);
    const arsenal = session.getArsenal();
    const capacity = arsenal.industrialCapacity;
    expect(capacity.allocations).toHaveLength(count);
    expect(capacity.demand).toBe(count * 4);
    expect(capacity.demand).toBeGreaterThan(capacity.total);
    expect(capacity.saturated).toBe(true);
    expect(capacity.used).toBe(capacity.total);
    expect(capacity.free).toBe(0);
    expect(capacity.satisfactionPct).toBeLessThan(100);
    expect(capacity.overflowFactor).toBeLessThan(1);
    // Il ritmo reale cala: la stessa consegna è prevista più tardi.
    const laterEta = arsenal.production.orders[0].expectedDate;
    expect(laterEta > firstEta).toBe(true);
  });

  it('l’avanzamento lo dichiara e resta entro il ritmo ridotto', () => {
    const { session } = createGame();
    armIndustry(session);
    const total = session.getArsenal().industrialCapacity.total;
    const count = Math.floor(total / 4) + 1;
    for (let index = 0; index < count; index += 1) session.procureEquipment('build', 'fucili', 1);
    const capacity = session.getArsenal().industrialCapacity;
    expect(capacity.saturated).toBe(true);
    const engine = session as any;
    engine.currentTurn = engine.currentTurn + 1;
    spy.months.length = 0;
    const bulletins: string[] = engine.advanceProduction(30, undefined);
    expect(bulletins.some((line: string) => line.includes('Industria satura'))).toBe(true);
    // Un mese di calendario vale meno di un mese di lavorazione: il fattore del
    // motore è applicato al tempo, non solo dichiarato nel bollettino.
    expect(spy.months.length).toBeGreaterThan(0);
    for (const months of spy.months) expect(months).toBeCloseTo(1 * capacity.overflowFactor, 3);
    expect(session.getProduction().orders[0].progress).toBeGreaterThan(0);
  });

  it('senza saturazione l’industria non frena la produzione', () => {
    const { session } = createGame();
    armIndustry(session);
    session.procureEquipment('build', 'fucili', 1);
    const capacity = session.getArsenal().industrialCapacity;
    const engine = session as any;
    engine.currentTurn = engine.currentTurn + 1;
    const bulletins: string[] = engine.advanceProduction(30, undefined);
    expect(bulletins.some((line: string) => line.includes('Industria satura'))).toBe(false);
    expect(capacity.overflowFactor).toBe(1);
    expect(session.getProduction().orders[0].progress).toBeGreaterThan(0);
  });
});
