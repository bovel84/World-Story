/**
 * Integrazione arsenale: il catalogo militare e le risorse naturali della
 * nazione sono esposti e persistenti; costruire/importare aggiorna scorte e
 * arsenale in modo atomico.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-arsenal-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'arsenal_world';
let db: any;
let worldRepository: any;
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
  const registry = registryModule.getSessionRegistry();

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Arsenal World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_DEU`, name: 'Germania', color: '#FF0000', owner: 'DEU',
        population: 80_000_000, gdp: 4000, militaryPower: 500, flag: 'DEU',
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'p1', type: 'port', name: 'Porto', level: 3 },
          { id: 'u1', type: 'university', name: 'Politecnico', level: 4 },
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
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('arsenale e procurement', () => {
  it('espone risorse naturali reali, arsenale di partenza e catalogo', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    expect(arsenal.naturalResources.iron).toBe(1);
    expect(arsenal.naturalResources.coal).toBe(4);
    expect(arsenal.naturalResourcesText).toMatch(/Carbone/);
    // L'esercito di partenza (level 4) riceve armi individuali e trasporti.
    expect(arsenal.units.fucili).toBeGreaterThan(0);
    expect(arsenal.lines.some((line: any) => line.domain === 'terra')).toBe(true);
    const ids = arsenal.catalog.map((item: any) => item.id);
    expect(ids).toContain('carri_4');
    expect(ids).toContain('caccia_5');
    expect(ids).toContain('portaerei');
    expect(ids).toContain('ipersonici');
    expect(ids).toContain('sciame');
  });

  it('importa equipaggiamento pagando il sovrapprezzo e lo persiste', async () => {
    const { session, gameId } = createGame();
    const before = session.getResources().stock;
    const result = session.procureEquipment('buy', 'droni_attacco', 2);
    expect(result.mode).toBe('buy');
    expect(result.quantity).toBe(2);
    expect(result.units.droni_attacco).toBe(2);
    const after = session.getResources().stock;
    expect(after.money).toBeLessThan(before.money);
    const { arsenalRepository } = await import('../src/repositories');
    expect(arsenalRepository.get(gameId, 'DEU')?.units.droni_attacco).toBe(2);
  });

  it('costruisce solo con tecnologia e industria, consumando scorte', () => {
    const { session } = createGame();
    // Senza la tecnologia bellica la costruzione è rifiutata…
    expect(() => session.procureEquipment('build', 'fucili', 1)).toThrow(/build_unavailable/);
    // …ma con la tecnologia (e fabbriche/risorse presenti) riesce.
    const stock = session.getResources().stock;
    (session as any).resourceStocks.set('DEU', {
      ...stock, technologies: ['industria_bellica'], money: 100, weapons: 500,
    });
    const built = session.procureEquipment('build', 'fucili', 3);
    expect(built.mode).toBe('build');
    expect(built.units.fucili).toBeGreaterThanOrEqual(3);
    expect(session.getResources().stock.weapons).toBe(500 - 4 * 3);
  });

  it('rifiuta un equipaggiamento inesistente e quantità non valide', () => {
    const { session } = createGame();
    expect(() => session.procureEquipment('buy', 'astronave', 1)).toThrow(/equipment_unknown/);
    expect(() => session.procureEquipment('buy', 'fucili', 100000)).toThrow(/quantity_invalid/);
  });

  it('la potenza militare effettiva include il fattore dell’arsenale', () => {
    const { session } = createGame();
    (session as any).arsenals.set('DEU', {});
    const empty = session.effectiveMilitaryPower();
    (session as any).arsenals.set('DEU', { fucili: 160, apc: 6 });
    const armed = session.effectiveMilitaryPower();
    expect(empty).toBeLessThan(armed);
    const arsenal = session.getArsenal();
    expect(arsenal.effectiveMilitaryPower).toBeCloseTo(armed, 1);
    expect(arsenal.combatFactor).toBeGreaterThan(1);
    expect(arsenal.qualityIndex).toBeGreaterThan(0);
  });

  it('una conquista tra nazioni ostili consuma l’arsenale del vincitore', () => {
    const { session, gameId } = createGame();
    (session as any).relationships.set('DEU', 'SAU', 'hostile');
    const before = session.getArsenal().units;
    expect(before.fucili).toBeGreaterThan(0);
    const sauRegion = session.getRegion(`${WORLD_ID}_SAU`);
    session.applyMapChanges([{ type: 'transfer', regionId: sauRegion.id, newOwner: 'DEU' }]);
    expect(session.getRegion(`${WORLD_ID}_SAU`).owner).toBe('DEU');
    const after = session.getArsenal().units;
    const lost = (before.fucili || 0) - (after.fucili || 0) + (before.apc || 0) - (after.apc || 0);
    expect(lost).toBeGreaterThan(0);
    void gameId;
  });

  it('un passaggio non ostile non consuma l’arsenale', () => {
    const { session } = createGame();
    const before = session.getArsenal().units;
    const sauRegion = session.getRegion(`${WORLD_ID}_SAU`);
    session.applyMapChanges([{ type: 'transfer', regionId: sauRegion.id, newOwner: 'DEU' }]);
    expect(session.getArsenal().units).toEqual(before);
  });
});
