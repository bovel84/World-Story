/**
 * OP-OBJECTS — integrazione sessione: la sala di governo e la creazione reale di
 * un reparto. Verifica che l'oggetto `/arsenal.objects` arrivi dal motore e che
 * formare un reparto cambi davvero il mondo (oggetto `army` persistito, forze,
 * arsenale, cassa), senza un secondo stato delle forze.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-opobjects-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'opobjects_world';
let db: any;
let worldRepository: any;
let gameRepository: any;
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
  gameRepository = repos.gameRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'OP Objects World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 59_000_000, gdp: 2100, militaryPower: 320, flag: 'ITA', coastal: true,
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'p1', type: 'port', name: 'Porto', level: 3 },
          { id: 'u1', type: 'university', name: 'Politecnico', level: 4 },
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

describe('OP-OBJECTS — sala di governo dal motore', () => {
  it('l\'arsenale pubblica oggetti concreti e catene (non solo aggregati)', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const objects = arsenal.objects.objects;
    expect(objects.length).toBeGreaterThan(5);
    expect(byKind(objects, 'force')).toHaveLength(1);
    expect(byKind(objects, 'facility').length).toBeGreaterThanOrEqual(3);
    expect(arsenal.objects.chains.length).toBeGreaterThanOrEqual(1);
    expect(arsenal.objects.conventions.length).toBeGreaterThanOrEqual(3);
  });

  it('le armate sommano i reparti del conto nazionale e portano nome e provincia del mondo', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    const account = session.getNationalAccounts().ITA;
    const armies = byKind(arsenal.objects.objects, 'army');
    const total = armies.reduce((value: number, army: any) => value + Number(factOf(army, 'Reparti').value), 0);
    expect(total).toBe(Math.round(account.forces));
    const named = armies.find((army: any) => army.label === '1ª Armata');
    expect(named).toBeTruthy();
    expect(named.regionName).toBe('Italia');
    expect(named.facts.length).toBeGreaterThan(5);
  });

  it('senza missili in arsenale la marina non nasce: le navi sono equipaggiamento reale', () => {
    const { session } = createGame();
    const arsenal = session.getArsenal();
    expect(byKind(arsenal.objects.objects, 'navy')).toHaveLength(0);
  });

  it('con una fregata in arsenale nasce marina → flotta → nave', () => {
    const { session } = createGame();
    // Si compra la nave più leggera disponibile: la classe è la stessa.
    const catalog = session.getArsenal().catalog as any[];
    const buyable = catalog.filter(item => item.domain === 'mare' && item.canBuy)
      .sort((a, b) => a.buyCostMln - b.buyCostMln)[0];
    expect(buyable).toBeTruthy();
    const ships = Math.max(1, Math.min(2, Math.floor(session.getResources().stock.money * 1000 / buyable.buyCostMln)));
    session.procureEquipment('buy', buyable.id, ships);
    const arsenal = session.getArsenal();
    const navy = byKind(arsenal.objects.objects, 'navy')[0];
    expect(navy).toBeTruthy();
    expect(Number(factOf(navy, 'Navi in servizio').value)).toBe(ships);
    const fleets = byKind(arsenal.objects.objects, 'fleet');
    expect(fleets.length).toBeGreaterThanOrEqual(1);
    const shipObjects = byKind(arsenal.objects.objects, 'ship');
    expect(shipObjects.length).toBeGreaterThanOrEqual(1);
    expect(shipObjects[0].parentId).toBe(fleets[0].id);
    expect(Number(factOf(shipObjects[0], 'Equipaggio').value)).toBeGreaterThan(0);
  });
});

describe('OP-OBJECTS — creazione di un reparto (azione reale)', () => {
  it('l\'anteprima è PRIMA → DOPO con i numeri del motore e non scrive nulla', () => {
    const { session } = createGame();
    const before = session.getArsenal();
    const preview = session.formationPreview({ formations: 1 });
    expect(preview.plan.blocked).toBe(false);
    expect(preview.plan.riflesRequired).toBeGreaterThan(0);
    expect(preview.before.formations).toBe(preview.after.formations - 1);
    expect(preview.after.activePersonnel).toBeGreaterThan(preview.before.activePersonnel);
    expect(preview.after.fuelNeed).toBeGreaterThan(preview.before.fuelNeed);
    expect(preview.deltas.length).toBeGreaterThan(8);
    // Nessuna scrittura: l'arsenale e i reparti non sono cambiati.
    const after = session.getArsenal();
    expect(after.units.fucili).toBe(before.units.fucili);
    expect(session.getNationalAccounts().ITA.forces).toBe(preview.before.formations);
  });

  it('la creazione aggiunge un\'armata al mondo, consuma arsenale e cassa e alza la spesa', () => {
    const { session, gameId } = createGame();
    const before = session.getArsenal();
    const beforeAccount = session.getNationalAccounts().ITA;
    const beforeMoney = session.getResources().stock.money;
    const result = session.raiseFormation({ formations: 1 });
    expect(result.applied).toBe(true);
    expect(result.spentMln).toBeGreaterThan(0);
    const after = session.getArsenal();
    const afterAccount = session.getNationalAccounts().ITA;
    // Il fatto è nel mondo: forze +1 (derivate dall'oggetto `army`).
    expect(afterAccount.forces).toBe(beforeAccount.forces + 1);
    expect(afterAccount.monthlyExpenses).toBeGreaterThan(beforeAccount.monthlyExpenses);
    // Il materiale è uscito dal deposito e la cassa è calata.
    expect(after.units.fucili).toBeLessThan(before.units.fucili);
    expect(session.getResources().stock.money).toBeLessThan(beforeMoney);
    // La nuova armata è un oggetto del mondo, persistito come gli altri.
    const armies = byKind(after.objects.objects, 'army');
    expect(armies.length).toBe(byKind(before.objects.objects, 'army').length + 1);
    // La persistenza delle regioni di partita è quella canonica (`syncRegionsToDB`).
    const stored = gameRepository.getGameRegions(gameId).find((region: any) => region.id === `${WORLD_ID}_ITA`);
    const storedArmy = (stored.objects || []).find((object: any) => object.type === 'army' && object.name === result.name);
    expect(storedArmy).toBeTruthy();
    expect(Number(storedArmy.level)).toBe(1);
    expect(worldRepository.getRegions(WORLD_ID).length).toBeGreaterThan(0);
  });

  it('rinforzare un\'armata esistente ne aumenta i reparti senza crearne una nuova', () => {
    const { session } = createGame();
    const before = byKind(session.getArsenal().objects.objects, 'army');
    const target = before.find((army: any) => army.label === '1ª Armata');
    const result = session.raiseFormation({ formations: 1, armyId: target.id });
    expect(result.name).toBe('1ª Armata');
    const after = byKind(session.getArsenal().objects.objects, 'army');
    const reinforced = after.find((army: any) => army.label === '1ª Armata');
    expect(Number(factOf(reinforced, 'Reparti').value)).toBe(Number(factOf(target, 'Reparti').value) + 1);
    expect(after.length).toBe(before.length);
  });

  it('senza fucili in deposito la formazione è rifiutata dal motore', () => {
    const { session } = createGame();
    // Si svuota il deposito di armi individuali comprando tutto il resto non serve:
    // il motore rifiuta con un codice, non con un messaggio della UI.
    const units = session.getArsenal().units;
    expect(units.fucili).toBeGreaterThan(0);
    const preview = session.formationPreview({ formations: 1 });
    const rifles = preview.plan.items.find((item: any) => item.equipmentId === 'fucili')!;
    expect(rifles.consumed).toBe(rifles.required);
    // Con un numero di reparti che supera il deposito, il piano è bloccato.
    const big = session.formationPreview({ formations: 100_000 });
    expect(big.plan.blocked).toBe(true);
    expect(big.plan.blockedReason).toContain('armi individuali');
    expect(() => session.raiseFormation({ formations: 100_000 })).toThrow(/formation_blocked/);
  });
});
