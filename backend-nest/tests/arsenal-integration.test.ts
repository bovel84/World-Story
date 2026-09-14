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
    // Ogni riga dice *che cos'è* il mezzo, non solo quanti ce ne sono.
    const first = arsenal.lines[0] as any;
    expect(first.role).toBeTruthy();
    expect(first.description.length).toBeGreaterThan(60);
    expect(first.specs.length).toBeGreaterThanOrEqual(3);
    expect(first.specs[0].label).toBeTruthy();
    expect(first.domainLabel).toBeTruthy();
    expect(first.strength).toBeGreaterThan(0);
    // Le quote sommano a circa 100% e spiegano il «×N».
    const share = arsenal.lines.reduce((total: number, line: any) => total + line.sharePct, 0);
    expect(Math.round(share)).toBeGreaterThan(95);
    expect(Math.round(share)).toBeLessThan(105);
    // La legenda dei domini accompagna la forza dell'arsenale.
    expect(arsenal.domains.map((domain: any) => domain.domain)).toEqual(['terra', 'aria', 'mare', 'missili', 'droni']);
    expect(arsenal.domains.find((domain: any) => domain.domain === 'missili').weight).toBeGreaterThan(
      arsenal.domains.find((domain: any) => domain.domain === 'terra').weight,
    );
    // Anche il catalogo porta la scheda descrittiva.
    const caccia = arsenal.catalog.find((item: any) => item.id === 'caccia_5') as any;
    expect(caccia.role).toBeTruthy();
    expect(caccia.description.length).toBeGreaterThan(60);
    expect(caccia.specs.length).toBeGreaterThanOrEqual(3);
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

  it('costruisce con tecnologia e industria: la consegna arriva solo a lavori finiti', () => {
    const { session } = createGame();
    // Senza la tecnologia bellica la costruzione è rifiutata…
    expect(() => session.procureEquipment('build', 'fucili', 1)).toThrow(/build_unavailable/);
    // …ma con la tecnologia (e fabbriche/risorse presenti) parte l'ordine.
    const stock = session.getResources().stock;
    (session as any).resourceStocks.set('DEU', {
      ...stock, technologies: ['industria_bellica'], money: 100, weapons: 500,
    });
    const beforeArms = session.getArsenal().units.fucili ?? 0;
    const started = session.procureEquipment('build', 'fucili', 3);
    expect(started.mode).toBe('build');
    expect(started.complete).toBe(false);
    expect(started.order.progress).toBe(0);
    expect(started.order.quantity).toBe(3);
    // La consegna NON è immediata: l'arsenale resta quello di partenza.
    expect(session.getArsenal().units.fucili ?? 0).toBe(beforeArms);
    expect(session.getResources().stock.weapons).toBe(500 - 4 * 3);
    expect(session.getProduction().inProgress).toBe(1);
    // Dopo alcuni mesi la linea si risolve: consegna o (raro) fallimento.
    const engine = session as any;
    const bulletins: string[] = [];
    for (let month = 0; month < 12 && session.getProduction().inProgress > 0; month += 1) {
      engine.currentTurn = engine.currentTurn + 1;
      bulletins.push(...engine.advanceProduction(30, undefined));
    }
    expect(session.getProduction().inProgress).toBe(0);
    const completed = bulletins.some(bulletin => bulletin.includes('Produzione completata'));
    const failed = bulletins.some(bulletin => bulletin.includes('Produzione fallita'));
    expect(completed || failed).toBe(true);
    if (completed) {
      expect(session.getArsenal().units.fucili ?? 0).toBeGreaterThan(beforeArms);
    } else {
      expect(failed).toBe(true);
    }
  });

  it('la costruzione può andare a debito e rispettare il tetto di credito', () => {
    const { session } = createGame();
    const stock = session.getResources().stock;
    (session as any).resourceStocks.set('DEU', {
      ...stock, technologies: ['industria_bellica', 'meccanica_avanzata'], money: 0, weapons: 500_000, research: 0,
    });
    const started = session.procureEquipment('build', 'fucili', 200);
    expect(started.financedMln).toBeGreaterThan(0);
    expect(started.debtMld).toBeGreaterThan(0);
    expect(session.getResources().stock.money).toBeLessThan(0);
    expect(session.getResources().debt).toBeGreaterThan(0);
    expect(session.getResources().creditHeadroom).toBeLessThan(session.getResources().creditLimit);
    // Con il debito già al tetto la spesa è rifiutata.
    const limit = session.getResources().creditLimit;
    (session as any).resourceStocks.set('DEU', {
      ...session.getResources().stock, money: -limit, weapons: 500_000,
    });
    expect(() => session.procureEquipment('build', 'fucili', 1)).toThrow(/credit_exhausted/);
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

  it('una conquista consuma l’arsenale del vincitore anche senza ostilità registrata', () => {
    const { session } = createGame();
    const before = session.getArsenal().units;
    const sauRegion = session.getRegion(`${WORLD_ID}_SAU`);
    session.applyMapChanges([{ type: 'transfer', regionId: sauRegion.id, newOwner: 'DEU' }]);
    expect(session.getRegion(`${WORLD_ID}_SAU`).owner).toBe('DEU');
    const after = session.getArsenal().units;
    const lost = (before.fucili || 0) - (after.fucili || 0) + (before.apc || 0) - (after.apc || 0);
    expect(lost).toBeGreaterThan(0);
  });

  it('una conquista tra nazioni ostili consuma l’arsenale del vincitore', () => {
    const { session } = createGame();
    (session as any).relationships.set('DEU', 'SAU', 'hostile');
    const before = session.getArsenal().units;
    expect(before.fucili).toBeGreaterThan(0);
    const sauRegion = session.getRegion(`${WORLD_ID}_SAU`);
    session.applyMapChanges([{ type: 'transfer', regionId: sauRegion.id, newOwner: 'DEU' }]);
    expect(session.getRegion(`${WORLD_ID}_SAU`).owner).toBe('DEU');
    const after = session.getArsenal().units;
    const lost = (before.fucili || 0) - (after.fucili || 0) + (before.apc || 0) - (after.apc || 0);
    expect(lost).toBeGreaterThan(0);
  });

  it('il passaggio di una provincia neutrale non consuma l’arsenale', () => {
    const { session } = createGame();
    const before = session.getArsenal().units;
    const sauRegion = session.getRegion(`${WORLD_ID}_SAU`);
    (session as any).regions.get(sauRegion.id).owner = 'neutral';
    session.applyMapChanges([{ type: 'transfer', regionId: sauRegion.id, newOwner: 'DEU' }]);
    expect(session.getArsenal().units).toEqual(before);
  });

  it('il modello agisce sulla nazione: scorte, arsenale e modificatori', () => {
    const { session } = createGame();
    const beforeResources = session.getResources();
    const beforeArms = session.getArsenal().units.fucili ?? 0;
    const beforeStability = session.getNationalAccounts().DEU.stability;
    (session as any).applyWorldChanges({
      nationalEffects: [
        { kind: 'stock', resource: 'food', delta: 10, reason: 'raccolto record' },
        { kind: 'stock', resource: 'money', delta: -5, reason: 'spesa straordinaria' },
        { kind: 'arsenal', equipmentId: 'fucili', delta: 5, reason: 'mobilitazione generale' },
        { kind: 'modifier', field: 'stability', delta: -12, reason: 'sconfitta al fronte' },
        { kind: 'economy', revenueMultiplierDelta: 0.1, reason: 'boom delle esportazioni' },
      ],
    });
    const afterResources = session.getResources();
    expect(afterResources.stock.food).toBeGreaterThan(beforeResources.stock.food);
    expect(afterResources.stock.money).toBeLessThan(beforeResources.stock.money);
    expect(session.getArsenal().units.fucili ?? 0).toBeGreaterThan(beforeArms);
    expect(afterResources.modifiers.stability).toBe(-12);
    expect(afterResources.modifiers.revenueMultiplier).toBeCloseTo(1.1, 5);
    // L'overlay dei modificatori entra davvero nei conti letti dal motore.
    const afterStability = session.getNationalAccounts().DEU.stability;
    expect(afterStability).toBeCloseTo(Math.max(0, beforeStability - 12), 1);
    // Le note sono pronte per la cronaca del tick successivo.
    expect((session as any).pendingNationalNotes.length).toBeGreaterThan(0);
  });

  it('un effetto senza motivo viene ignorato dal motore', () => {
    const { session } = createGame();
    const before = session.getResources().stock.food;
    (session as any).applyWorldChanges({
      nationalEffects: [{ kind: 'stock', resource: 'food', delta: 100 }],
    });
    expect(session.getResources().stock.food).toBe(before);
    expect((session as any).pendingNationalNotes).toEqual([]);
  });

  it('i modificatori nazionali decadono nel tempo se non rinnovati', async () => {
    const { session } = createGame();
    (session as any).applyWorldChanges({
      nationalEffects: [{ kind: 'modifier', field: 'socialTension', delta: 20, reason: 'disordini diffusi' }],
    });
    expect(session.getResources().modifiers.socialTension).toBe(20);
    await session.advanceDate(30);
    expect(Math.abs(session.getResources().modifiers.socialTension)).toBeLessThan(20);
  });
});
