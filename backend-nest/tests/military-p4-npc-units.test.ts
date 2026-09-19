/**
 * MILITARY P4 — unità NPC persistenti e simmetria player/NPC.
 * ==========================================================
 *
 * Verifica che l'NPC combatta con `MilitaryUnitState[]` **persistenti**, lo
 * stesso `WarFront` e le stesse regole del giocatore — senza un secondo motore:
 * `polityId` come authority della nazionalità, materializzazione lazy dalla
 * forza dichiarata, consumi dagli **ordini delle unità**, perdite reali sui
 * reparti, isolamento del giocatore.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { addDays } from '../src/core/simulation/calendar';
import { militaryManpower } from '../src/core/simulation/MilitaryDoctrine';

const TEST_DB = path.join(os.tmpdir(), `world-story-p4-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'p4_world';
const PID = 'ITA';
const AUT = 'AUT';
const HUN = 'HUN';
const R = {
  ita1: `${WORLD_ID}_ITA1`, ita2: `${WORLD_ID}_ITA2`,
  aut1: `${WORLD_ID}_AUT1`, aut2: `${WORLD_ID}_AUT2`,
  hun1: `${WORLD_ID}_HUN1`,
};

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
    { id: WORLD_ID, name: 'P4 World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: R.ita1, name: 'Pianura', color: '#FF0000', owner: PID,
        population: 30_000_000, gdp: 1200, militaryPower: 300, flag: PID, borders: [R.ita2, R.aut1],
        objects: [{ id: 'a1', type: 'army', name: '1ª Armata', level: 4 }],
      },
      { id: R.ita2, name: 'Costa', color: '#FF8888', owner: PID, population: 20_000_000, gdp: 800, militaryPower: 100, flag: PID, borders: [R.ita1], objects: [] },
      {
        id: R.aut1, name: 'Tirolo', color: '#00FF00', owner: AUT,
        population: 6_000_000, gdp: 250, militaryPower: 400, flag: AUT, borders: [R.ita1, R.aut2],
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 3 }],
      },
      { id: R.aut2, name: 'Vienna', color: '#88FF88', owner: AUT, population: 3_000_000, gdp: 200, militaryPower: 200, flag: AUT, borders: [R.aut1, R.hun1], objects: [] },
      { id: R.hun1, name: 'Ungheria', color: '#0000FF', owner: HUN, population: 4_000_000, gdp: 150, militaryPower: 150, flag: HUN, borders: [R.aut2], objects: [] },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', R.ita1, '#FF0000');
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

const store = (session: any) => session.operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const fronts = (session: any): any[] => store(session).fronts();
const unitOf = (session: any, id: string) => units(session).find(unit => String(unit.id) === String(id));
const npcUnits = (session: any, polityId = AUT) => store(session).unitsForPolity(polityId);
const stockOf = (session: any, polity = PID) => session.resourceStock(polity);
const setStock = (session: any, patch: Record<string, number>, polity = PID) => {
  session.saveResourceStock(polity, { ...stockOf(session, polity), ...patch });
};
const setRelationship = (session: any, a: string, b: string, rel: 'ally' | 'neutral' | 'hostile') => {
  session.diplomacy.matrix().set(a, b, rel);
  session.diplomacy.matrix().set(b, a, rel);
};
/** Partita in guerra ITA–AUT con il fronte già sincronizzato. */
const warGame = (options?: { hun?: boolean }) => {
  const { session } = createGame();
  setRelationship(session, PID, AUT, 'hostile');
  if (options?.hun) setRelationship(session, AUT, HUN, 'hostile');
  session.publicFronts();
  return session;
};
const advance = (session: any, days: number, date: string) => session.advanceWorldState(days, date);
/** Meno un periodo, per far materializzare e combattere i reparti NPC. */
const oneTick = (session: any, date = '2026-01-31') => advance(session, 30, date);
const sumPersonnel = (list: readonly any[]) => list
  .filter(unit => unit.status !== 'destroyed')
  .reduce((total, unit) => total + Number(unit.personnel || 0), 0);
/** Fattore d'ordine **come lo applica il motore**: solo per chi è sul fronte. */
const ORDER_FACTORS: Record<string, number> = { attack: 1.8, defend: 1.2, reserve: 0.8, withdraw: 1 };
const consumptionFactor = (unit: any): number => (unit.frontId ? ORDER_FACTORS[String(unit.order)] ?? 1 : 1);

describe('MILITARY P4 — unità NPC persistenti', () => {
  it('1: `polityId` è l\'authority: una conquista NON cambia la nazionalità dei reparti', () => {
    const session = warGame();
    oneTick(session);
    const before = npcUnits(session);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(unit => unit.polityId === AUT)).toBe(true);
    // La provincia cade in mano italiana: i reparti AUT restano **AUT** e restano
    // sul fronte (nel 30b12be la nazionalità veniva dedotta dall'owner corrente:
    // il reparto sarebbe diventato «italiano», o sganciato).
    session.regions.get(R.aut1).owner = PID;
    session.publicFronts();
    const after = npcUnits(session);
    expect(after.length).toBe(before.length);
    expect(after.every(unit => unit.polityId === AUT)).toBe(true);
    expect(after.every(unit => String(unit.regionId) !== String(R.aut1) || unit.polityId === AUT)).toBe(true);
  });

  it('2: materializzazione **lazy**: in pace nessun reparto, col fronte sì, e idempotente', () => {
    const { session: peace } = createGame();
    peace.publicFronts();
    expect(npcUnits(peace).length).toBe(0);
    const session = warGame();
    oneTick(session);
    const first = npcUnits(session).map(unit => unit.id).sort();
    expect(first.length).toBeGreaterThan(0);
    // Seconda sincronizzazione: **stessi** id, nessun duplicato.
    oneTick(session, '2026-03-02');
    expect(npcUnits(session).map(unit => unit.id).sort()).toEqual(first);
  });

  it('3: nessuna resurrezione: reparti distrutti non vengono ricreati da `account.forces`', () => {
    const session = warGame();
    oneTick(session);
    const ids = npcUnits(session).map(unit => unit.id).sort();
    store(session).saveUnits(units(session).map(unit => (String(unit.polityId) === AUT
      ? { ...unit, status: 'destroyed' as const, personnel: 0, equipment: {} }
      : unit)));
    oneTick(session, '2026-03-02');
    oneTick(session, '2026-04-01');
    const after = npcUnits(session);
    expect(after.map(unit => unit.id).sort()).toEqual(ids);
    expect(after.every(unit => unit.status === 'destroyed')).toBe(true);
    expect(after.every(unit => unit.personnel === 0)).toBe(true);
  });

  it('4: conservazione — uomini = `menPerFormation × formations`, pezzi solo dal deposito', () => {
    const session = warGame();
    // Si misura il **seed** (la conversione della forza dichiarata), senza il
    // combattimento che poi toglie uomini: `ensureNpcUnits` è quel passo.
    const arsenalBefore = (() => {
      const row = db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, AUT) as any;
      return row ? Number(JSON.parse(row.units).fucili || 0) : 0;
    })();
    (session as any).warFronts.ensureNpcUnits(30);
    const formations = Math.max(0, Math.round(Number(session.sessionAccounts()[AUT].forces) || 0));
    const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch: 'moderno' }).menPerFormation;
    const list = npcUnits(session);
    expect(list.length).toBe(formations);
    expect(sumPersonnel(list)).toBe(formations * menPerFormation);
    // Pezzi: solo dal **deposito** della polity (letto dal database, senza
    // seed), con conservazione `deposito + assegnato` invariata. Se il deposito
    // è vuoto non si inventa nulla e i reparti restano non operativi.
    const row = db.prepare('SELECT units FROM game_arsenals WHERE game_id = ? AND polity_id = ?').get(session.id, AUT) as any;
    const depotAfter = row ? JSON.parse(row.units) : {};
    const assigned = list.reduce((total, unit) => total + Number((unit.equipment || {}).fucili || 0), 0);
    // **Conservazione**: `deposito + assegnato` non cambia. I pezzi escono dal
    // deposito della polity e nessuno viene creato dal nulla.
    expect(Number((depotAfter as any).fucili || 0) + assigned).toBe(arsenalBefore);
    // Con i pezzi assegnati i reparti sono operativi; senza deposito restano
    // non operativi (nessun pezzo inventato).
    if (arsenalBefore === 0) {
      expect(assigned).toBe(0);
      expect(list.some(unit => unit.status !== 'operational')).toBe(true);
    } else {
      expect(assigned).toBe(Math.min(arsenalBefore, list.length * assigned / Math.max(1, list.length)));
      expect(list.every(unit => unit.status !== 'destroyed')).toBe(true);
    }
  });

  it('5: isolamento del giocatore — fabbisogni, aggregato e arsenale non vedono le unità NPC', () => {
    const session = warGame();
    oneTick(session);
    expect(npcUnits(session).length).toBeGreaterThan(0);
    const withNpc = store(session).militaryNeeds().weapons;
    // (misurate **prima** di rimuovere le unità NPC, per il confronto sotto)
    expect(store(session).militaryNeedsForPolity(AUT).weapons).toBeGreaterThan(0);
    // L'invariante: il fabbisogno del giocatore **non cambia** se le unità NPC
    // esistono o no (una polity = una sola authority per il fabbisogno).
    store(session).saveUnits(units(session).filter(unit => String(unit.polityId) === PID));
    expect(store(session).militaryNeeds().weapons).toBeCloseTo(withNpc, 6);
    // L'aggregato delle armate è del giocatore: i reparti NPC non lo toccano.
    const armies = store(session).armies();
    expect(armies.every((army: any) => !String(army.id).startsWith('npc-'))).toBe(true);
  });

  it('6: un\'azione del giocatore NON cancella le unità NPC (set globale su `replaceKind`)', () => {
    const session = warGame();
    oneTick(session);
    const before = npcUnits(session).map(unit => unit.id).sort();
    expect(before.length).toBeGreaterThan(0);
    // Azione reale del giocatore che riscrive i reparti (transfer): il set che
    // arriva a `saveUnits` deve essere **globale**.
    const own = units(session).find(unit => unit.polityId === PID && unit.frontId);
    session.unitAction({ action: 'transfer', unitId: own.id, regionId: R.ita2 });
    expect(npcUnits(session).map(unit => unit.id).sort()).toEqual(before);
    expect(units(session).some(unit => String(unit.polityId) === AUT)).toBe(true);
  });

  it('7: consumi dagli **ordini delle unità** — attack ×1,8 sul fabbisogno del periodo', () => {
    const session = warGame();
    oneTick(session);
    const list = npcUnits(session).filter(unit => unit.status !== 'destroyed');
    const period = list.reduce((total, unit) => total + Number(unit.monthlyNeeds.weapons || 0) * consumptionFactor(unit), 0);
    const structural = list.reduce((total, unit) => total + Number(unit.monthlyNeeds.weapons || 0), 0);
    expect(store(session).militaryNeedsForPolity(AUT).weapons).toBeCloseTo(period, 3);
    expect(store(session).baseMilitaryNeedsForPolity(AUT).weapons).toBeCloseTo(structural, 3);
    // La capacità strutturale usa la **base**: l'ordine non gonfia il magazzino.
    expect(structural).toBeLessThanOrEqual(period);
  });

  it('8: combattimento via `resolveFront` — perdite reali sui reparti NPC', () => {
    const session = warGame();
    // Scorte abbondanti per entrambe le parti: la battaglia non è decisa dalla fame.
    setStock(session, { food: 500, weapons: 500, fuel: 500, clothing: 500 }, PID);
    setStock(session, { food: 500, weapons: 500, fuel: 500, clothing: 500 }, AUT);
    oneTick(session);
    const atStart = npcUnits(session).map(unit => ({ id: unit.id, personnel: unit.personnel }));
    expect(atStart.length).toBeGreaterThan(0);
    for (const date of ['2026-03-02', '2026-04-01', '2026-05-01']) oneTick(session, date);
    const after = npcUnits(session);
    const lost = atStart.reduce((total, before) => {
      const unit = after.find(item => item.id === before.id);
      return total + Math.max(0, before.personnel - Number(unit?.personnel || 0));
    }, 0);
    // I reparti NPC perdono uomini **reali** (non solo `region.militaryPower`).
    expect(lost).toBeGreaterThan(0);
    expect(fronts(session)[0].defenderPressure + fronts(session)[0].attackerPressure).toBeGreaterThan(0);
  });

  it('9: persistenza — identità e stato sopravvivono a salvataggio/ricarica e al rewind', () => {
    const session = warGame();
    oneTick(session);
    const before = npcUnits(session).map(unit => ({ id: unit.id, personnel: unit.personnel, status: unit.status, polityId: unit.polityId })).sort((a, b) => a.id.localeCompare(b.id));
    expect(before.length).toBeGreaterThan(0);
    const saveId = session.save('p4').saveId;
    const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
    const savedRows = JSON.parse(row.data).operationalState.rows
      .filter((item: any) => item.kind === 'unit' && String(item.data.polityId) === AUT);
    expect(savedRows.length).toBe(before.length);
    expect(savedRows.every((item: any) => item.data.polityId === AUT || item.data.polityId === PID)).toBe(true);
    // Rewind: lo stato torna quello del checkpoint.
    advance(session, 90, '2026-07-30');
    session.loadFromSave(JSON.parse(row.data), row.content_hash);
    const restored = npcUnits(session).map(unit => ({ id: unit.id, personnel: unit.personnel, status: unit.status, polityId: unit.polityId })).sort((a, b) => a.id.localeCompare(b.id));
    expect(restored).toEqual(before);
  });

  it('10: 90 giorni = 3 × 30 anche per i reparti NPC (identità, uomini, stato, proprietari)', () => {
    const snapshot = (session: any) => ({
      owners: [...session.regions.values()].map((region: any) => ({ id: region.id, owner: region.owner })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
      npc: npcUnits(session).map(unit => ({ id: unit.id, personnel: unit.personnel, status: unit.status, regionId: unit.regionId, order: unit.order })).sort((a, b) => a.id.localeCompare(b.id)),
      fronts: fronts(session).map(front => ({ id: front.id, status: front.status, regions: front.regionIds })),
      playerStock: (({ weapons, food }: any) => ({ weapons, food }))(stockOf(session)),
    });
    const long = warGame();
    setStock(long, { food: 500, weapons: 500 }, PID);
    setStock(long, { food: 500, weapons: 500 }, AUT);
    advance(long, 90, '2026-04-01');
    const split = warGame();
    setStock(split, { food: 500, weapons: 500 }, PID);
    setStock(split, { food: 500, weapons: 500 }, AUT);
    for (const date of ['2026-01-31', '2026-03-02', '2026-04-01']) advance(split, 30, date);
    expect(snapshot(split)).toEqual(snapshot(long));
  });

  it('11: fronte NPC–NPC — la materializzazione non richiede il giocatore in guerra', () => {
    const { session } = createGame();
    // Solo AUT–HUN ostili: fronte NPC–NPC, il giocatore resta neutrale.
    setRelationship(session, AUT, HUN, 'hostile');
    session.publicFronts();
    // Il fronte nasce solo con reparti coinvolti: lo si semina come farebbe un
    // periodo precedente, poi il tick materializza **entrambe** le polity NPC.
    store(session).saveFronts([
      ...fronts(session),
      {
        id: 'front-AUT-HUN', name: 'Fronte Austria–Ungheria', attackerPolityId: AUT, defenderPolityId: HUN,
        regionIds: [R.aut2, R.hun1], status: 'active' as const, objectiveRegionId: R.hun1,
        attackerPressure: 0, defenderPressure: 0, createdDate: '2026-01-01', updatedDate: '2026-01-01',
      },
    ]);
    (session as any).warFronts.ensureNpcUnits(30);
    expect(npcUnits(session, AUT).length).toBeGreaterThan(0);
    expect(npcUnits(session, HUN).length).toBeGreaterThan(0);
    expect(npcUnits(session, PID).length).toBeGreaterThanOrEqual(0);
  });

  it('12: determinismo — due sync sullo stesso stato danno gli stessi reparti e gli stessi ordini', () => {
    const planned = warGame();
    (planned as any).warFronts.ensureNpcUnits(30);
    const first = npcUnits(planned).map(unit => ({ id: unit.id, order: unit.order, regionId: unit.regionId, frontId: unit.frontId }));
    (planned as any).warFronts.ensureNpcUnits(30);
    const second = npcUnits(planned).map(unit => ({ id: unit.id, order: unit.order, regionId: unit.regionId, frontId: unit.frontId }));
    expect(second).toEqual(first);
  });
});
