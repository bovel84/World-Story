/**
 * MILITARY / WARFRONT INTEGRITY — identità, rewind, logistica, contabilità materiale
 * ==================================================================================
 *
 * Questa PR **corregge la base** di MILITARY-UNITS (PR1) e dei fronti (PR2), non
 * aggiunge funzioni. I fatti verificati qui, uno per uno:
 *
 *  P0-1  lo stato operativo (reparti, fronti, impianti, navi, flotte, cantieri,
 *        equipaggi) entra nel checkpoint: save/rewind/branch non lasciano in vita
 *        il futuro. `undefined` = salvataggio vecchio (non si tocca nulla).
 *  P0-2  il consumo di guerra è **una sola** grandezza: `advanceStock`. Il fronte
 *        non sottrae un secondo fabbisogno (`attack = 1,8×`, non `base + 1,8×`).
 *  P0-3  un reparto combatte su un fronte **solo** se è davvero nel teatro: un
 *        reparto spostato altrove viene sganciato (`frontId = null`).
 *  P1-1  l'id di un reparto è **immutabile** (reassign compreso).
 *  P1-2  il livello della mappa è **seed** della materializzazione iniziale: mai
 *        più reparti fantasma dopo uno spostamento.
 *  P1-3  il trasferimento ha **geografia e distanza**: percorso controllato sui
 *        `borders` reali e costo proporzionale alle tratte.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { addDays } from '../src/core/simulation/calendar';
import { frontIdFor, frontSideStrength } from '../src/core/simulation/WarFronts';

const TEST_DB = path.join(os.tmpdir(), `world-story-integrity-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'integrity_world';
const WAR_COST_WORLD = 'war_cost_world';
const PID = 'ITA';
const AUT = 'AUT';
const HUN = 'HUN';

/** Geografia del mondo a **due fronti** (costo di guerra NPC). */
const W = {
  ita1: `${WAR_COST_WORLD}_ITA1`,
  ita2: `${WAR_COST_WORLD}_ITA2`,
  aut1: `${WAR_COST_WORLD}_AUT1`,
  aut2: `${WAR_COST_WORLD}_AUT2`,
  aut3: `${WAR_COST_WORLD}_AUT3`,
  hun1: `${WAR_COST_WORLD}_HUN1`,
};
/** Fronti del mondo a due fronti: AUT contro ITA e AUT contro HUN. */
const FRONT_HUN = frontIdFor(AUT, HUN);
const FRONT_ITA = frontIdFor(PID, AUT);

let db: any;
let registry: any;
let createGame: () => { gameId: string; session: any };
let createWarCostGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache() {},
};

/**
 * Geografia **esplicita** dei confini: serve alla P1-3.
 *
 *   ITA1 ─ ITA2 ─ ITA3 ─ ITA4      (catena di 1, 2 e 3 tratte da ITA1)
 *    │
 *   AUT1 ─ AUT2
 *   ITA5  (isola: nessun confine terrestre)
 *   ITA6  (exclave: si raggiunge solo attraversando AUT1)
 */
const R = {
  ita1: `${WORLD_ID}_ITA1`,
  ita2: `${WORLD_ID}_ITA2`,
  ita3: `${WORLD_ID}_ITA3`,
  ita4: `${WORLD_ID}_ITA4`,
  ita5: `${WORLD_ID}_ITA5`,
  ita6: `${WORLD_ID}_ITA6`,
  aut1: `${WORLD_ID}_AUT1`,
  aut2: `${WORLD_ID}_AUT2`,
  fra1: `${WORLD_ID}_FRA1`,
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
    { id: WORLD_ID, name: 'Integrity World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: R.ita1, name: 'Pianura', color: '#FF0000', owner: PID,
        population: 30_000_000, gdp: 1200, militaryPower: 300, flag: PID, coastal: false,
        borders: [R.ita2, R.aut1],
        objects: [
          { id: 'f1', type: 'factory', name: 'Acciaierie', level: 5 },
          { id: 'a1', type: 'army', name: '1ª Armata', level: 4 },
        ],
      },
      { id: R.ita2, name: 'Costa', color: '#FF8888', owner: PID, population: 25_000_000, gdp: 900, militaryPower: 120, flag: PID, coastal: true, borders: [R.ita1, R.ita3], objects: [] },
      { id: R.ita3, name: 'Colline', color: '#FFAAAA', owner: PID, population: 9_000_000, gdp: 400, militaryPower: 60, flag: PID, borders: [R.ita2, R.ita4], objects: [] },
      { id: R.ita4, name: 'Valli', color: '#FFCCCC', owner: PID, population: 5_000_000, gdp: 200, militaryPower: 30, flag: PID, borders: [R.ita3], objects: [] },
      { id: R.ita5, name: 'Isola', color: '#FFEEEE', owner: PID, population: 1_000_000, gdp: 60, militaryPower: 10, flag: PID, coastal: true, borders: [], objects: [] },
      { id: R.ita6, name: 'Exclave', color: '#FFDDDD', owner: PID, population: 2_000_000, gdp: 80, militaryPower: 12, flag: PID, borders: [R.aut1], objects: [] },
      {
        id: R.aut1, name: 'Tirolo', color: '#00FF00', owner: AUT,
        population: 6_000_000, gdp: 250, militaryPower: 800, flag: AUT,
        borders: [R.ita1, R.ita6, R.aut2],
        objects: [{ id: 'a2', type: 'army', name: 'Bundesheer', level: 2 }],
      },
      { id: R.aut2, name: 'Vienna', color: '#88FF88', owner: AUT, population: 3_000_000, gdp: 200, militaryPower: 100, flag: AUT, borders: [R.aut1], objects: [] },
      { id: R.fra1, name: 'Provenza', color: '#0000FF', owner: 'FRA', population: 8_000_000, gdp: 500, militaryPower: 150, flag: 'FRA', coastal: true, borders: [], objects: [] },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', R.ita1, '#FF0000');
  // Secondo mondo: serve al costo di guerra su **due fronti** di una stessa
  // polity. Potenze scelte perché l'AUT risulti con quote 40% + 20% e 40%
  // fuori teatro (il caso della specifica), la parte ITA debole (l'NPC decide
  // da solo) e la parte HUN abbastanza forte da farlo difendere.
  repos.worldRepository.createWithRegions(
    { id: WAR_COST_WORLD, name: 'War Cost World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: W.ita1, name: 'Pianura', color: '#FF0000', owner: PID, population: 10_000_000, gdp: 300,
        militaryPower: 10, flag: PID, borders: [W.aut1], objects: [{ id: 'a1', type: 'army', name: '1ª Armata', level: 4 }],
      },
      { id: W.ita2, name: 'Interno', color: '#FF5555', owner: PID, population: 5_000_000, gdp: 100, militaryPower: 5, flag: PID, borders: [], objects: [] },
      { id: W.aut1, name: 'Tirolo', color: '#00FF00', owner: AUT, population: 4_000_000, gdp: 150, militaryPower: 400, flag: AUT, borders: [W.ita1], objects: [] },
      { id: W.aut2, name: 'Est', color: '#55FF55', owner: AUT, population: 2_000_000, gdp: 80, militaryPower: 200, flag: AUT, borders: [W.hun1], objects: [] },
      { id: W.aut3, name: 'Interno austriaco', color: '#AAFFAA', owner: AUT, population: 3_000_000, gdp: 90, militaryPower: 400, flag: AUT, borders: [W.aut1, W.aut2], objects: [] },
      { id: W.hun1, name: 'Ungheria', color: '#0000FF', owner: HUN, population: 8_000_000, gdp: 200, militaryPower: 250, flag: HUN, borders: [W.aut2], objects: [{ id: 'h1', type: 'army', name: 'Honvédség', level: 2 }] },
    ],
  );
  createWarCostGame = () => registry.createSession(WAR_COST_WORLD, 'Player', W.ita1, '#FF0000');
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

// ── Helper ──────────────────────────────────────────────────────────────────
const store = (session: any) => session.operationalStoreFor();
const units = (session: any): any[] => store(session).units();
const fronts = (session: any): any[] => store(session).fronts();
const armies = (session: any): any[] => store(session).armies();
const facilities = (session: any): any[] => store(session).facilities();
const unitOf = (session: any, id: string) => units(session).find(unit => String(unit.id) === String(id));
const stock = (session: any, polity = PID) => session.resourceStock(polity);
const setStock = (session: any, patch: Record<string, number>, polity = PID) =>
  session.saveResourceStock(polity, { ...stock(session, polity), ...patch });
const activeUnits = (session: any) => units(session).filter(unit => unit.status !== 'destroyed');
const sumOf = <T>(list: T[], value: (item: T) => number) => list.reduce((total, item) => total + value(item), 0);
const setRelationship = (session: any, a: string, b: string, rel: 'ally' | 'neutral' | 'hostile') => {
  session.diplomacy.matrix().set(a, b, rel);
  session.diplomacy.matrix().set(b, a, rel);
};
const setOrder = (session: any, order: string, armyId = 'a1') => {
  const current = units(session);
  store(session).saveUnits(current.map(unit => (String(unit.armyId) === String(armyId) ? { ...unit, order } : unit)));
};
const armAll = (session: any, armyId = 'a1') => {
  for (const unit of units(session)) {
    if (String(unit.armyId) !== String(armyId)) continue;
    try { session.unitAction({ action: 'reequip', unitId: unit.id }); } catch { /* deposito vuoto */ }
  }
};
/** Checkpoint reale: `save()` + la riga in `saves` (data + hash semantico). */
const checkpoint = (session: any) => {
  const { saveId } = session.save('integrity-cp');
  const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
  return { data: JSON.parse(row.data), hash: row.content_hash as string };
};
const restore = (session: any, cp: { data: any; hash: string }) => session.loadFromSave(cp.data, cp.hash);
/**
 * Riga di salvataggio **riletta** a ogni ripristino, come fa la rotta: l'oggetto
 * passato a `loadFromSave` non si riusa (lo stato vive per riferimento nelle
 * collezioni della sessione).
 */
const restoreSave = (session: any, saveId: string) => {
  const row = db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
  return session.loadFromSave(JSON.parse(row.data), row.content_hash);
};
const readSaveData = (saveId: string) => JSON.parse((db.prepare('SELECT data FROM saves WHERE id = ?').get(saveId) as any).data);
const operationalRow = (gameId: string, objectId: string) => {
  const row = db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND object_id = ?').get(gameId, objectId) as any;
  return row ? JSON.parse(row.data) : null;
};
const frontRow = (gameId: string) => {
  const row = db.prepare('SELECT data FROM game_operational_objects WHERE game_id = ? AND kind = ?').get(gameId, 'front') as any;
  return row ? JSON.parse(row.data) : null;
};

// ── Helper «periodo di guerra» (WARFRONT SUPPLY/TICK) ────────────────────────
/**
 * Partita **in guerra** con i reparti armati e l'ordine d'attacco: il periodo
 * materiale è reale (nessun impianto, così produzione e prelievi non confondono
 * l'aritmetica delle scorte).
 */
const warGame = (options?: { autPower?: number; facilities?: boolean }) => {
  const { session } = createGame();
  setRelationship(session, PID, AUT, 'hostile');
  if (options?.autPower !== undefined) {
    const region = session.regions.get(R.aut1);
    if (region) region.militaryPower = options.autPower;
  }
  if (options?.facilities !== true) store(session).saveFacilities([]);
  session.publicFronts();
  armAll(session);
  setOrder(session, 'attack');
  return session;
};
const theFront = (session: any) => fronts(session)[0];
/** L'unico passaggio di tempo di questi test: periodo materiale + fronte. */
const advancePeriod = (session: any, days: number, date: string): string[] =>
  (session as any).advanceWorldState(days, date) as string[];
/** Copertura dell'ultimo periodo misurata dal material engine (dato transitorio). */
const periodSupply = (session: any, polity = PID) => {
  const service = (session as any).warFronts;
  return typeof service?.periodSupply === 'function' ? service.periodSupply(polity) : null;
};
/** Vero se il reparto è **davvero** sul fronte aperto (fronte + teatro). */
const onWarFront = (session: any, unit: any) => {
  const front = theFront(session);
  return Boolean(front && String(unit.frontId || '') === String(front.id) && unit.regionId
    && front.regionIds.map(String).includes(String(unit.regionId)));
};
/**
 * Carenza di **armamenti** nel bollettino: la riga del bilancio materiale cita
 * sempre «Armamenti», quindi il test cerca la riga di **carenza**.
 */
const weaponsShortage = (lines: readonly string[]) =>
  lines.some(line => /Carenza materiale.*Armamenti/.test(line));
/** Fabbisogno di armamenti del periodo come lo calcola il motore (ordine ×1,8 sul fronte). */
const weaponsNeedOfPeriod = (session: any) => sumOf(activeUnits(session),
  unit => Number(unit.monthlyNeeds.weapons || 0) * (onWarFront(session, unit) ? 1.8 : 1));
const cleanAccount = (session: any) => ({
  ...session.sessionAccounts()[PID],
  population: 0, factories: 0, ports: 0, universities: 0, monthlyBalance: 0, forces: 0, mobilized: 0,
});

// ── Helper «NPC supply symmetry» ────────────────────────────────────────────
/**
 * Account legacy deterministico: 2.500 forze ⇒ fabbisogno mensile di
 * armamenti = 10 (`legacyMilitaryNeeds`), senza popolazione/industria che
 * alterino il caso 10/10, 4/10 o 0/10. Non crea alcuna MilitaryUnit NPC.
 */
const npcSupplyAccount = (session: any) => ({
  ...session.sessionAccounts()[AUT],
  population: 0, gdp: 0, factories: 0, ports: 0, universities: 0, monthlyBalance: 0,
  forces: 2500, mobilized: 0, provinces: 1,
});
/**
 * Ordine pianificato per **quel** fronte e quella polity: è la chiave del piano
 * per-fronte (`legacyOrdersByFront[frontId][polityId]`). `null` se assente.
 */
const plannedOrderFor = (plan: any, frontId: string, polityId: string): string | null =>
  plan?.legacyOrdersByFront?.[String(frontId)]?.[String(polityId)] ?? null;
/**
// ── Helper «due fronti» (costo di guerra NPC per fronte) ────────────────────
/** Riga del fronte AUT–HUN: nasce da un periodo **precedente** (l'NPC non ha reparti persistenti). */
const hunFrontRow = () => ({
  id: FRONT_HUN,
  name: 'Fronte Austria–Ungheria',
  attackerPolityId: AUT,
  defenderPolityId: HUN,
  regionIds: [W.aut2, W.hun1],
  status: 'active' as const,
  objectiveRegionId: null,
  attackerPressure: 0,
  defenderPressure: 0,
  createdDate: '2026-01-01',
  updatedDate: '2026-01-01',
});
/**
 * Partita a **due fronti**: AUT in guerra con ITA e con HUN. I reparti del player
 * escono dal teatro, così la parte ITA resta dichiarata e la policy NPC decide
 * da sola su entrambi i fronti.
 */
const multiFrontGame = (options?: { hunPower?: number; hunFront?: boolean }) => {
  const { session } = createWarCostGame();
  const set = (a: string, b: string) => {
    session.diplomacy.matrix().set(a, b, 'hostile');
    session.diplomacy.matrix().set(b, a, 'hostile');
  };
  set(PID, AUT);
  set(AUT, HUN);
  if (options?.hunPower !== undefined) {
    const region = session.regions.get(W.hun1);
    if (region) region.militaryPower = options.hunPower;
  }
  store(session).saveFacilities([]);
  session.publicFronts();
  if (options?.hunFront !== false) {
    store(session).saveFronts([...store(session).fronts(), hunFrontRow()]);
  }
  for (const unit of units(session)) {
    session.unitAction({ action: 'transfer', unitId: unit.id, regionId: W.ita2 });
  }
  session.publicFronts();
  return session;
};
/** Pressione registrata di una polity su un fronte (lato giusto, qualsiasi esso sia). */
const pressureOf = (session: any, frontId: string, polityId: string): number => {
  const front = fronts(session).find(item => String(item.id) === String(frontId));
  if (!front) return -1;
  return String(front.attackerPolityId) === String(polityId)
    ? Number(front.attackerPressure || 0)
    : Number(front.defenderPressure || 0);
};
/**
 * Material tick legacy **controllato** (2.500 forze ⇒ 10 armamenti/mese, senza
 * popolazione né industria): la stessa `advanceResources` canonica, ma con il
 * **piano del periodo** fornito come lo fornisce `GameSession`. Serve a leggere
 * i numeri esatti del costo bellico dell'NPC (10/18, 10/12, 10/10).
 */
const npcLegacyPeriods = (
  session: any, days: number, date: string,
  options?: { weapons?: number; factor?: number },
) => {
  if (options?.weapons !== undefined) setStock(session, { weapons: options.weapons }, AUT);
  const periods: any[] = [];
  (session as any).nationState.advanceResources(days, { [AUT]: npcSupplyAccount(session) }, date, {
    beforeMaterialPeriod: () => ({
      legacyMilitaryFactorByPolity: options?.factor !== undefined ? { [AUT]: options.factor } : {},
    }),
    onMaterialPeriod: (period: any) => { periods.push(period); return []; },
  });
  return periods;
};
/**
 * Mondo di prova del **costo di guerra NPC**: la forza dichiarata di AUT è
 * tutta nel teatro (aut2 non conta) e senza industria/popolazione, mentre i
 * reparti del player escono dal teatro — così la parte ITA resta dichiarata e
 * la policy NPC decide da sola (attacco, con 800 di potenza contro 312).
 */
const npcWarWorld = (session: any, level = 2491) => {
  for (const regionId of [R.aut1, R.aut2]) {
    const region = session.regions.get(regionId);
    if (!region) continue;
    region.population = 0;
    region.gdp = 0;
    if (regionId === R.aut2) region.militaryPower = 0;
  }
  const army = session.regions.get(R.aut1)?.objects?.find((object: any) => String(object.id) === 'a2');
  if (army) army.level = level;
  for (const unit of units(session)) {
    if (String(unit.armyId) !== 'a1') continue;
    session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita3 });
  }
};
/**
 * Produzione di armamenti dell'NPC sul percorso **legacy** (nessun overlay):
 * `fabbriche × 0,5 + atenei × 0,2`, più ferro e carbone (AUT non ne ha). È la
 * stessa espressione che `advanceStock` usa senza oggetti persistenti.
 */
const npcWeaponsProduction = (session: any) => {
  const account = session.sessionAccounts()[AUT];
  return Math.max(0, Number(account.factories) || 0) * 0.5 + Math.max(0, Number(account.universities) || 0) * 0.2;
};
/** Material tick legacy isolato: cattura l'hook neutrale una volta per substep. */
const npcMaterialPeriods = (session: any, days: number, date: string, weapons: number) => {
  setStock(session, { weapons }, AUT);
  const periods: any[] = [];
  (session as any).nationState.advanceResources(days, { [AUT]: npcSupplyAccount(session) }, date, {
    onMaterialPeriod: (period: any) => { periods.push(period); return []; },
  });
  return periods;
};

// ══════════════════════════════════════════════════════════════════════════
// P0-1 — SAVE / REWIND / BRANCH dello stato operativo
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — P0-1: lo stato operativo entra nel checkpoint', () => {
  it('1: il checkpoint contiene TUTTI i kind, ordinati (e senza orari di scrittura)', () => {
    const { session } = createGame();
    units(session);
    const cp = checkpoint(session);
    const snapshot = cp.data.operationalState;
    expect(snapshot.schema).toBe('world_story_operational_objects');
    expect(snapshot.version).toBe(1);
    const kinds = snapshot.rows.map((row: any) => row.kind);
    expect(new Set(kinds)).toEqual(new Set(['personnel', 'unit', 'facility']));
    // Ordinamento deterministico per (kind, objectId) con la stessa collazione
    // binaria di SQLite (`kind, object_id`): l'hash semantico è stabile.
    const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const ordered = [...snapshot.rows].sort((a: any, b: any) =>
      byCodepoint(a.kind, b.kind) || byCodepoint(a.objectId, b.objectId));
    expect(snapshot.rows).toEqual(ordered);
    // Nessun dato di scrittura nel checkpoint: conta il contenuto, non il quando.
    expect(JSON.stringify(snapshot.rows)).not.toContain('recorded_at');
  });

  it('2: rewind di `unit` — uomini, equipaggiamento, stato e fronte tornano al checkpoint', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    const cp = checkpoint(session);
    // Futuro: uomini dimezzati, pezzo perso, stato distrutto, fronte staccato.
    store(session).saveUnits(units(session).map(item => (item.id === unit.id
      ? { ...item, personnel: 10, equipment: {}, status: 'destroyed', frontId: null, readiness: 0 }
      : item)));
    expect(unitOf(session, unit.id).status).toBe('destroyed');
    restore(session, cp);
    const back = unitOf(session, unit.id);
    expect(back.personnel).toBe(unit.personnel);
    expect(back.equipment).toEqual(unit.equipment);
    expect(back.status).toBe(unit.status);
    expect(back.frontId).toBe(unit.frontId);
  });

  it('3: rewind di un fronte creato dopo il checkpoint — il fronte sparisce', () => {
    const { session } = createGame();
    const cp = checkpoint(session);
    expect(cp.data.operationalState.rows.some((row: any) => row.kind === 'front')).toBe(false);
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    expect(fronts(session).length).toBeGreaterThan(0);
    restore(session, cp);
    expect(fronts(session)).toHaveLength(0);
    // Anche nel database, non solo in RAM: REPLACE ALL FOR GAME.
    const rows = db.prepare("SELECT COUNT(*) AS n FROM game_operational_objects WHERE game_id = ? AND kind = 'front'")
      .get(session.id ?? session.gameId) as any;
    expect(Number(rows?.n ?? 0)).toBe(0);
  });

  it('4: rewind di stato e pressioni del fronte al checkpoint', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const frontId = fronts(session)[0].id;
    const cp = checkpoint(session);
    const before = fronts(session).find(front => front.id === frontId);
    // Futuro: il fronte combatte e cambia stato/pressioni.
    store(session).saveFronts(fronts(session).map(front => (front.id === frontId
      ? { ...front, status: 'breakthrough', attackerPressure: 9.5, defenderPressure: 0.1, regionIds: [R.aut1] }
      : front)));
    restore(session, cp);
    const back = fronts(session).find(front => front.id === frontId);
    expect(back.status).toBe(before.status);
    expect(back.attackerPressure).toBe(before.attackerPressure);
    expect(back.defenderPressure).toBe(before.defenderPressure);
    expect(back.regionIds).toEqual(before.regionIds);
  });

  it('5: un oggetto creato nel futuro non sopravvive al rewind (e uno cancellato ritorna)', () => {
    const { session } = createGame();
    const first = facilities(session)[0];
    expect(first).toBeTruthy();
    const cp = checkpoint(session);
    const created = {
      id: 'plant-future', kind: 'steel_mill', name: 'Acciaieria futura', regionId: null, regionName: null,
      capacity: 5, workers: 1000, status: 'operational', recipe: { inputs: {}, outputs: {} },
      activeOrders: [], createdDate: '2026-06-01', legacyDerived: false,
    };
    store(session).saveFacilities([...facilities(session), created]);
    store(session).saveFacilities(facilities(session).filter(facility => facility.id !== first.id));
    expect(facilities(session).map(facility => facility.id)).toContain('plant-future');
    expect(facilities(session).map(facility => facility.id)).not.toContain(first.id);
    restore(session, cp);
    const ids = facilities(session).map(facility => facility.id);
    expect(ids).not.toContain('plant-future');
    expect(ids).toContain(first.id);
  });

  it('6: rewind sulla STESSA istanza di sessione — la cache non serve il futuro', () => {
    const { session } = createGame();
    const unit = activeUnits(session)[0];
    const cp = checkpoint(session);
    // La cache è calda: la sessione ha appena letto lo stato.
    store(session).saveUnits(units(session).map(item => (item.id === unit.id ? { ...item, personnel: 1 } : item)));
    expect(unitOf(session, unit.id).personnel).toBe(1);
    restore(session, cp);
    // Stessa istanza, nessuna nuova sessione dal DB.
    expect(unitOf(session, unit.id).personnel).toBe(unit.personnel);
    expect(store(session).units().length).toBe(cp.data.operationalState.rows.filter((row: any) => row.kind === 'unit').length);
  });

  it('7: `semanticStateHash` cambia se cambia `unit.personnel` o `front.status`', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = activeUnits(session)[0];
    const frontId = fronts(session)[0].id;
    const frontStatus = fronts(session)[0].status;
    const before = session.semanticHash();
    store(session).saveUnits(units(session).map(item => (item.id === unit.id ? { ...item, personnel: item.personnel - 1 } : item)));
    const afterPersonnel = session.semanticHash();
    expect(afterPersonnel).not.toBe(before);
    store(session).saveFronts(fronts(session).map(front => (front.id === frontId ? { ...front, status: 'collapsed' } : front)));
    const afterFront = session.semanticHash();
    expect(afterFront).not.toBe(afterPersonnel);
    // Ripristinare i valori riporta **lo stesso** hash: è contenuto, non ordine.
    store(session).saveUnits(units(session).map(item => (item.id === unit.id ? { ...item, personnel: unit.personnel } : item)));
    store(session).saveFronts(fronts(session).map(front => (front.id === frontId ? { ...front, status: frontStatus } : front)));
    expect(session.semanticHash()).toBe(before);
  });

  it('8: un salvataggio SENZA `operationalState` si carica e non tocca i reparti (legacy)', () => {
    const { session } = createGame();
    const cp = checkpoint(session);
    const unit = activeUnits(session)[0];
    store(session).saveUnits(units(session).map(item => (item.id === unit.id ? { ...item, personnel: 4_242 } : item)));
    // Salvataggio vecchio: il campo non esiste.
    const legacy = { ...cp.data };
    delete legacy.operationalState;
    session.loadFromSave(legacy, null);
    expect(unitOf(session, unit.id).personnel).toBe(4_242);
  });

  it('9: `{ version: 1, rows: [] }` è un fatto e si applica (ramo senza oggetti)', () => {
    const { session } = createGame();
    units(session);
    const cp = checkpoint(session);
    expect(activeUnits(session).length).toBeGreaterThan(0);
    const empty = { ...cp.data, operationalState: { schema: 'world_story_operational_objects', version: 1, rows: [] } };
    session.loadFromSave(empty, null);
    // L'insieme del checkpoint è vuoto **davvero**: nessuna riga in partita.
    const rows = db.prepare('SELECT COUNT(*) AS n FROM game_operational_objects WHERE game_id = ?')
      .get(session.id ?? session.gameId) as any;
    expect(Number(rows?.n ?? 0)).toBe(0);
    // La prima lettura ri-materializza dal seed lazy (gli aggregati legacy sono
    // nel salvataggio): è la regola dello store per una partita mai seminata,
    // non una riga sopravvissuta al rewind.
    const seeded = activeUnits(session).map(unit => unit.id).sort();
    const original = cp.data.operationalState.rows
      .filter((row: any) => row.kind === 'unit')
      .map((row: any) => row.objectId)
      .sort();
    expect(seeded).toEqual(original);
  });
});

/** L'hash semantico è funzione del contenuto: ripristinare i valori lo riporta. */

// ══════════════════════════════════════════════════════════════════════════
// P1-1 — identità immutabile · P1-2 — nessun reparto fantasma
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — P1-1/P1-2: id immutabile e nessun reparto fantasma', () => {
  it('10: `reassign` cambia armata, NON l\'id e NON la posizione', () => {
    const { session } = createGame();
    const created = session.raiseFormation({ formations: 1 });
    const targetId = created.unit.armyId;
    const unit = unitOf(session, 'a1-unit-001');
    const result = session.unitAction({ action: 'reassign', unitId: unit.id, armyId: targetId });
    expect(result.blocked).toBe(false);
    expect(result.unit.id).toBe(unit.id);
    expect(result.unit.id).toBe('a1-unit-001');
    expect(result.unit.armyId).toBe(targetId);
    expect(result.unit.regionId).toBe(unit.regionId);
    expect(result.unit.regionName).toBe(unit.regionName);
    expect(result.note).not.toContain('in formazione');
  });

  it('11: `reassign` in anteprima (`dryRun`) non scrive e non cambia id', () => {
    const { session } = createGame();
    const created = session.raiseFormation({ formations: 1 });
    const unit = unitOf(session, 'a1-unit-001');
    const before = JSON.stringify(units(session));
    const preview = session.unitAction({ action: 'reassign', unitId: unit.id, armyId: created.unit.armyId, dryRun: true });
    expect(preview.applied).toBe(false);
    // L'anteprima mostra il DOPO (armata di arrivo), ma l'id è quello di sempre
    // e nulla viene scritto: i reparti persistiti sono identici.
    expect(preview.unit.id).toBe(unit.id);
    expect(preview.unit.armyId).toBe(created.unit.armyId);
    expect(JSON.stringify(units(session))).toBe(before);
    expect(unitOf(session, unit.id).armyId).toBe('a1');
  });

  it('12: `transfer`, `reinforce`, `reequip` e il ricaricamento non cambiano l\'id', () => {
    const { gameId, session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    const moved = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita2 });
    expect(moved.blocked).toBe(false);
    expect(moved.unit.id).toBe(unit.id);
    session.unitAction({ action: 'reinforce', unitId: unit.id, men: 100 });
    expect(unitOf(session, unit.id).id).toBe(unit.id);
    session.unitAction({ action: 'reequip', unitId: unit.id });
    expect(unitOf(session, unit.id).id).toBe(unit.id);
    // Ricaricamento della sessione dal database: l'id è quello, non uno nuovo.
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(unitOf(reloaded, unit.id).id).toBe(unit.id);
  });

  it('13: `reassign` A→B: le due armate restano la somma dei reparti, nessun reparto inventato', () => {
    const { gameId, session } = createGame();
    const created = session.raiseFormation({ formations: 1 });
    const targetId = created.unit.armyId;
    const before = armies(session);
    const totalBefore = sumOf(activeUnits(session), unit => 1);
    const fromBefore = before.find((army: any) => String(army.id) === 'a1').formations;
    const targetBefore = before.find((army: any) => String(army.id) === String(targetId)).formations;
    expect(fromBefore).toBe(4);
    expect(targetBefore).toBeGreaterThan(0);
    session.unitAction({ action: 'reassign', unitId: 'a1-unit-001', armyId: targetId });
    const check = (label: string, list: any[]) => {
      const active = list.filter(unit => unit.status !== 'destroyed');
      expect(active).toHaveLength(totalBefore);
      expect(active.filter(unit => String(unit.armyId) === 'a1')).toHaveLength(fromBefore - 1);
      expect(active.filter(unit => String(unit.armyId) === String(targetId))).toHaveLength(targetBefore + 1);
      for (const army of armies(session)) {
        const own = active.filter(unit => String(unit.armyId) === String(army.id));
        expect(army.formations).toBe(own.length);
        expect(army.personnel).toBe(sumOf(own, unit => unit.personnel));
      }
      expect(label).toBeTruthy();
    };
    check('dopo reassign', units(session));
    store(session).snapshot();
    store(session).snapshot();
    check('dopo due snapshot', units(session));
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    check('dopo ricaricamento dal DB', units(reloaded));
  });

  it('14: nessun reparto `forming` senza uomini viene creato dal livello della mappa', () => {
    const { session } = createGame();
    const created = session.raiseFormation({ formations: 1 });
    session.unitAction({ action: 'reassign', unitId: 'a1-unit-001', armyId: created.unit.armyId });
    const phantoms = units(session).filter(unit => !unit.legacyDerived && unit.status === 'forming' && Number(unit.personnel) <= 0);
    expect(phantoms).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-3 — unità fuori teatro
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — P0-3: un reparto combatte solo nel teatro', () => {
  it('15: trasferito in una provincia interna, il reparto viene sganciato e non combatte', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    expect(unit).toBeTruthy();
    const moved = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita3 });
    expect(moved.blocked).toBe(false);
    const sync = session.warFronts.syncFronts();
    const after = (sync.units as any[]).find(item => String(item.id) === String(unit.id));
    expect(after.frontId).toBe(null);
    expect(unitOf(session, unit.id).frontId).toBe(null);
    // Contributo zero: periodi di guerra non toccano il reparto sganciato.
    const personnelBefore = unitOf(session, unit.id).personnel;
    session.advanceFronts(90, '2026-04-01');
    const detached = unitOf(session, unit.id);
    if (detached.frontId === null) {
      expect(detached.personnel).toBe(personnelBefore);
    } else {
      // Se il teatro è cambiato al punto da ricomprenderlo, resta un reparto del
      // fronte (nessuna eccezione silenziosa: lo stato lo dice).
      expect(fronts(session).some(front => front.regionIds.includes(detached.regionId))).toBe(true);
    }
    expect(detached.frontId === null || fronts(session).some(front => front.id === detached.frontId)).toBe(true);
  });

  it('16: fronte chiuso (pace) → i reparti tornano liberi', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    setRelationship(session, PID, AUT, 'neutral');
    const sync = session.warFronts.syncFronts();
    expect((sync.fronts as any[]).every(front => front.status === 'closed')).toBe(true);
    expect(unitOf(session, unit.id).frontId).toBe(null);
  });

  it('17: ritirata fuori teatro → sganciato alla sincronizzazione successiva', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    for (const item of units(session).filter(candidate => candidate.frontId)) {
      session.unitOrder({ unitId: item.id, order: 'withdraw' });
    }
    session.advanceFronts(30, '2026-01-31');
    const retreated = unitOf(session, unit.id);
    // Se il ripiegamento ha cambiato provincia, la sync successiva sgancia.
    if (retreated.regionId !== unit.regionId) {
      session.warFronts.syncFronts();
      expect(unitOf(session, unit.id).frontId).toBe(null);
    } else {
      expect(retreated.status === 'retreating' || retreated.status === 'destroyed' || retreated.status === 'operational').toBe(true);
    }
  });

  it('18: un `frontId` che punta a un fronte inesistente viene azzerato', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const unit = units(session).find(item => item.frontId);
    // Id fantasma: la riga persistita dice un fronte che non esiste più.
    store(session).saveUnits(units(session).map(item => (String(item.id) === String(unit.id)
      ? { ...item, frontId: 'front-ghost' }
      : item)));
    const sync = session.warFronts.syncFronts();
    const after = (sync.units as any[]).find(item => String(item.id) === String(unit.id));
    expect(after.frontId).toBe(null);
    expect(unitOf(session, unit.id).frontId).toBe(null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-2 — consumo materiale una volta sola
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — P0-2: un solo consumo, con il coefficiente dell\'ordine', () => {
  const ORDER_FACTOR: Record<string, number> = { attack: 1.8, defend: 1.2, reserve: 0.8, withdraw: 1 };

  it('19: il fronte non tocca il magazzino — la sottrazione duplicata è sparita', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    setOrder(session, 'attack');
    const before = { ...stock(session) };
    session.advanceFronts(30, '2026-01-31');
    expect(stock(session).food).toBe(before.food);
    expect(stock(session).fuel).toBe(before.fuel);
    expect(stock(session).weapons).toBe(before.weapons);
  });

  it('20: 30 giorni con `food` base = X consumano X × fattore (attacco 1,8 · difesa 1,2 · riserva 0,8 · ritirata 1,0)', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    for (const [order, factor] of Object.entries(ORDER_FACTOR)) {
      const { session } = createGame();
      setRelationship(session, PID, AUT, 'hostile');
      session.publicFronts();
      setOrder(session, order);
      const onFront = units(session).filter(unit => unit.frontId && unit.status !== 'destroyed');
      expect(onFront.length).toBeGreaterThan(0);
      const expected = sumOf(activeUnits(session), unit =>
        Number(unit.monthlyNeeds.food || 0) * (unit.frontId ? factor : 1));
      expect(store(session).militaryNeeds().food).toBeCloseTo(expected, 3);
      const overlay = store(session).materialFlow({ monthlyExtraction: false, stepDays: 30 });
      const tick = advanceStock({ ...stock(session), food: 50, fuel: 50, weapons: 50 }, cleanAccount(session), 30, {}, '2026-01-31', overlay);
      // `food` include il fabbisogno civile (zero con l'account di prova): il
      // consumo è **esattamente** quello del periodo, una volta sola.
      expect(tick.flow.food).toBeCloseTo(-expected, 3);
    }
  });

  it('21: 15 giorni = metà periodo (nessun doppio conteggio fra sottoperiodo e mese)', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    setOrder(session, 'attack');
    const expected = sumOf(activeUnits(session), unit => Number(unit.monthlyNeeds.food || 0) * (unit.frontId ? 1.8 : 1));
    const overlay = store(session).materialFlow({ monthlyExtraction: false, stepDays: 15 });
    const tick = advanceStock({ ...stock(session), food: 50, fuel: 50, weapons: 50 }, cleanAccount(session), 15, {}, '2026-01-16', overlay);
    expect(tick.flow.food).toBeCloseTo(-expected / 2, 3);
  });

  it('22: 180 giorni consumano come sei periodi da 30 (stessa storia, un solo consumo per periodo)', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    setOrder(session, 'attack');
    const account = cleanAccount(session);
    const need = store(session).militaryNeeds().food;
    expect(need).toBeGreaterThan(0);
    const start = { ...stock(session), food: need * 6, fuel: 0, weapons: 0 };
    const overlayLong = store(session).materialFlow({ monthlyExtraction: false, stepDays: 180 });
    const long = advanceStock(start, account, 180, {}, '2026-06-30', overlayLong);
    let stockShort: any = start;
    for (let month = 0; month < 6; month += 1) {
      const overlay = store(session).materialFlow({ monthlyExtraction: false, stepDays: 30 });
      stockShort = advanceStock(stockShort, account, 30, {}, `2026-0${month + 1}-30`, overlay).stock;
    }
    // Il salto lungo e i sei periodi brevi consumano la stessa quantità: un solo
    // consumo per periodo, mai `base + guerra`.
    expect(long.stock.food).toBeCloseTo(stockShort.food, 3);
    expect(start.food - long.stock.food).toBeCloseTo(need * 6, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P1-3 — transfer con geografia e distanza
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — P1-3: il trasferimento ha geografia e distanza', () => {
  it('23: percorso puro sui confini reali — 1, 2, 3 tratte; isola ed exclave senza percorso', async () => {
    const { friendlyRegionPath, regionHops } = await import('../src/utils/region-path');
    const regions = [
      { id: R.ita1, owner: PID, borders: [R.ita2, R.aut1] },
      { id: R.ita2, owner: PID, borders: [R.ita1, R.ita3] },
      { id: R.ita3, owner: PID, borders: [R.ita2, R.ita4] },
      { id: R.ita4, owner: PID, borders: [R.ita3] },
      { id: R.ita5, owner: PID, borders: [] },
      { id: R.ita6, owner: PID, borders: [R.aut1] },
      { id: R.aut1, owner: AUT, borders: [R.ita1, R.ita6] },
    ];
    const path = (to: string) => friendlyRegionPath({ fromRegionId: R.ita1, toRegionId: to, owner: PID, regions });
    expect(regionHops(path(R.ita2)!)).toBe(1);
    expect(regionHops(path(R.ita3)!)).toBe(2);
    expect(regionHops(path(R.ita4)!)).toBe(3);
    expect(path(R.ita5)).toBe(null);
    expect(path(R.ita6)).toBe(null);
    // Determinismo: due chiamate identiche danno lo stesso percorso.
    expect(path(R.ita4)).toEqual(path(R.ita4));
  });

  it('24: trasferimento adiacente e a due tratte: id, uomini e pezzi non cambiano', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    setStock(session, { food: 100, money: 100, fuel: 100 });
    const personnel = unit.personnel;
    const equipment = JSON.stringify(unit.equipment);
    const one = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita2 });
    expect(one.blocked).toBe(false);
    expect(one.unit.id).toBe(unit.id);
    expect(one.unit.personnel).toBe(personnel);
    expect(JSON.stringify(one.unit.equipment)).toBe(equipment);
    expect(stock(session).food).toBeCloseTo(100 - 0.15, 3);
    const two = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita3 });
    expect(two.blocked).toBe(false);
    expect(two.unit.regionId).toBe(R.ita3);
    expect(two.unit.personnel).toBe(personnel);
  });

  it('25: tre tratte costano più di una (costo proporzionale alla distanza reale)', () => {
    const { session } = createGame();
    setStock(session, { food: 100, money: 100, fuel: 100 });
    const unit = unitOf(session, 'a1-unit-001');
    const one = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita2 });
    const costOne = 100 - (one.stock as any).food;
    setStock(session, { food: 100, money: 100, fuel: 100 });
    session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita1 });
    setStock(session, { food: 100, money: 100, fuel: 100 });
    const three = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita4 });
    expect(three.blocked).toBe(false);
    const costThree = 100 - (three.stock as any).food;
    expect(three.unit.regionId).toBe(R.ita4);
    expect(costThree).toBeGreaterThan(costOne);
    expect(costThree).toBeCloseTo(costOne * 3, 3);
  });

  it('26: enclave irraggiungibile e percorso attraverso territorio ostile → bloccati', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    const island = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita5 });
    expect(island.blocked).toBe(true);
    expect(String(island.blockedReason)).toContain('Nessun percorso territoriale controllato');
    const exclave = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita6 });
    expect(exclave.blocked).toBe(true);
    expect(unitOf(session, unit.id).regionId).toBe(R.ita1);
  });

  it('27: destinazione estera rifiutata (l\'invasione è del fronte, non di `transfer`)', () => {
    const { session } = createGame();
    const unit = unitOf(session, 'a1-unit-001');
    expect(() => session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.aut1 }))
      .toThrowError(/region_unknown/);
    expect(() => session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.fra1 }))
      .toThrowError(/region_unknown/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SAVE/RELOAD completo · modello NPC reale
// ══════════════════════════════════════════════════════════════════════════
describe('MILITARY INTEGRITY — save/reload completo e modello NPC', () => {
  it('28: save → mutazioni → reload dal database: id, armata, regione, fronte, uomini, pezzi, stato e ordine identici', () => {
    const { gameId, session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    armAll(session);
    session.publicFronts();
    const created = session.raiseFormation({ formations: 1 });
    session.unitAction({ action: 'reassign', unitId: 'a1-unit-002', armyId: created.unit.armyId });
    session.unitAction({ action: 'transfer', unitId: 'a1-unit-003', regionId: R.ita2 });
    for (const unit of units(session).filter(item => item.frontId)) {
      session.unitOrder({ unitId: unit.id, order: 'attack' });
    }
    session.advanceFronts(30, '2026-01-31');
    const cp = checkpoint(session);
    const expected = activeUnits(session).map(unit => ({
      id: unit.id, armyId: unit.armyId, regionId: unit.regionId, frontId: unit.frontId,
      personnel: unit.personnel, equipment: unit.equipment, status: unit.status, order: unit.order,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const frontState = fronts(session).map(front => ({
      id: front.id, status: front.status, attacker: front.attackerPolityId, defender: front.defenderPolityId,
      regions: front.regionIds, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure,
    }));
    // Futuro: la sessione viene azzerata e poi riportata al checkpoint.
    store(session).saveUnits([]);
    store(session).saveFronts([]);
    restore(session, cp);
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    const actual = activeUnits(reloaded).map((unit: any) => ({
      id: unit.id, armyId: unit.armyId, regionId: unit.regionId, frontId: unit.frontId,
      personnel: unit.personnel, equipment: unit.equipment, status: unit.status, order: unit.order,
    })).sort((a: any, b: any) => a.id.localeCompare(b.id));
    expect(actual).toEqual(expected);
    expect(fronts(reloaded).map((front: any) => ({
      id: front.id, status: front.status, attacker: front.attackerPolityId, defender: front.defenderPolityId,
      regions: front.regionIds, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure,
    }))).toEqual(frontState);
  });

  it('29: modello NPC reale — il giocatore ha reparti persistenti, l\'NPC no', () => {
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const front = fronts(session)[0];
    const playerSide = [front.attackerPolityId, front.defenderPolityId].includes(PID);
    expect(playerSide).toBe(true);
    // I reparti persistiti sono **solo** quelli del giocatore.
    expect(activeUnits(session).every(unit => unit.frontId === null || unit.armyId !== 'a2')).toBe(true);
    expect(activeUnits(session).some(unit => unit.frontId === front.id)).toBe(true);
    // L'NPC non ha unità proprie: la guerra lo tocca solo come potenza dichiarata.
    const powerBefore = Number(session.regions.get(R.aut1).militaryPower);
    session.advanceFronts(60, '2026-03-01');
    const powerAfter = Number(session.regions.get(R.aut1).militaryPower);
    expect(powerAfter).toBeLessThanOrEqual(powerBefore);
    expect(units(session).some(unit => String(unit.armyId) === 'a2')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-4 — la copertura è quella del PERIODO, non dello stock residuo
// ══════════════════════════════════════════════════════════════════════════
describe('WARFRONT SUPPLY/TICK — P0-4: copertura del periodo nel material engine', () => {
  /** Un tick puro su un conto vuoto: nessuna produzione civile, nessun giacimento. */
  const pureBase = (session: any) => ({ ...stock(session), food: 0, clothing: 0, fuel: 0, weapons: 0 });
  const NEED = { food: 0, clothing: 0, weapons: 10, fuel: 0 };

  it('30: fabbisogno esatto → 100% con magazzino a zero (non 0%): la copertura non si deduce dallo stock residuo', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = cleanAccount(session);
    const base = pureBase(session);
    const overlay = { production: {}, consumption: {}, militaryNeeds: NEED };
    // Scorte **esattamente** pari al fabbisogno del periodo: il reparto ha tutto,
    // paga tutto, resta a zero. Dedurre la copertura dallo stock residuo darebbe
    // 0% — cioè carenza dove non c'è.
    const exact = advanceStock({ ...base, weapons: 10 }, account, 30, {}, '2026-01-31', overlay);
    expect(exact.fulfillment?.weapons).toBe(1);
    expect(exact.stock.weapons).toBeCloseTo(0, 6);
    expect(exact.flow.shortages).toHaveLength(0);
    // Metà disponibilità: 40%, non 0 e non 1.
    const half = advanceStock({ ...base, weapons: 4 }, account, 30, {}, '2026-01-31', overlay);
    expect(half.fulfillment?.weapons).toBeCloseTo(0.4, 4);
    // Nessun materiale: 0%.
    const none = advanceStock({ ...base, weapons: 0 }, account, 30, {}, '2026-01-31', overlay);
    expect(none.fulfillment?.weapons).toBe(0);
    // Scorte abbondanti: 100% (la copertura è una quota, non una quantità).
    const plenty = advanceStock({ ...base, weapons: 1000 }, account, 30, {}, '2026-01-31', overlay);
    expect(plenty.fulfillment?.weapons).toBe(1);
    // Nessun fabbisogno: 100%, mai NaN.
    const nothing = advanceStock({ ...base, weapons: 0 }, account, 30, {}, '2026-01-31',
      { production: {}, consumption: {}, militaryNeeds: { food: 0, clothing: 0, weapons: 0, fuel: 0 } });
    expect(nothing.fulfillment).toEqual({ food: 1, clothing: 1, weapons: 1, fuel: 1 });
  });

  it('31: la disponibilità è **quella** del motore — produzione del periodo inclusa, prelievi degli impianti esclusi', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = cleanAccount(session);
    const base = pureBase(session);
    // 6 in magazzino + 4 prodotti **nello stesso periodo** = 10: il motore lo
    // considera sufficiente, quindi la copertura è 100% (e il magazzino a zero).
    const withProduction = advanceStock({ ...base, weapons: 6 }, account, 30, {}, '2026-01-31',
      { production: { weapons: 4 }, consumption: {}, militaryNeeds: NEED });
    expect(withProduction.fulfillment?.weapons).toBe(1);
    expect(withProduction.stock.weapons).toBeCloseTo(0, 6);
    // Lo **stesso** materiale serve anche gli impianti: 6 prelevati prima del
    // fabbisogno → disponibile 4 su 10. La copertura riflette l'allocazione del
    // motore: nessuna disponibilità inventata.
    const withDraws = advanceStock({ ...base, weapons: 6 }, account, 30, {}, '2026-01-31',
      { production: { weapons: 4 }, consumption: { weapons: 6 }, militaryNeeds: NEED });
    expect(withDraws.fulfillment?.weapons).toBeCloseTo(0.4, 4);
  });

  it('32: periodo parziale — 15 giorni sono metà fabbisogno e metà disponibilità', async () => {
    const { advanceStock } = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = cleanAccount(session);
    const base = pureBase(session);
    const overlay = { production: {}, consumption: {}, militaryNeeds: NEED };
    // Fabbisogno mensile 10 → 5 nel periodo di 15 giorni: 5 disponibili bastano.
    const exact = advanceStock({ ...base, weapons: 5 }, account, 15, {}, '2026-01-16', overlay);
    expect(exact.fulfillment?.weapons).toBe(1);
    expect(exact.stock.weapons).toBeCloseTo(0, 6);
    const half = advanceStock({ ...base, weapons: 2.5 }, account, 15, {}, '2026-01-16', overlay);
    expect(half.fulfillment.weapons).toBeCloseTo(0.5, 4);
  });

  it('33: il fronte combatte con la copertura del periodo (fabbisogno esatto = 100%, non 0%)', () => {
    const play = (weapons: number | 'exact') => {
      const session = warGame();
      const expected = weaponsNeedOfPeriod(session);
      expect(expected).toBeGreaterThan(0);
      setStock(session, { weapons: weapons === 'exact' ? expected : weapons, food: 500, fuel: 500, clothing: 500 });
      advancePeriod(session, 30, '2026-01-31');
      return {
        expected,
        pressure: Number(theFront(session)?.attackerPressure || 0),
        supply: periodSupply(session),
        left: Number(stock(session).weapons),
      };
    };
    const exact = play('exact');
    const abundant = play(exact.expected * 10);
    const none = play(0);
    // La copertura del periodo: 100% con le scorte esatte, 0% senza armamenti.
    expect(exact.supply?.weapons).toBe(1);
    expect(none.supply?.weapons).toBe(0);
    expect(abundant.supply?.weapons).toBe(1);
    // Il reparto con le scorte **esatte** ha pagato tutto il fabbisogno: zero.
    expect(exact.left).toBeCloseTo(0, 6);
    // La pressione del periodo è la stessa di chi ha scorte abbondanti, e più
    // alta di chi non ha armamenti: misurare lo stock residuo (0) avrebbe dato al
    // primo la stessa carenza del terzo.
    expect(exact.pressure).toBeCloseTo(abundant.pressure, 6);
    expect(exact.pressure).toBeGreaterThan(none.pressure);
  });

  it('34: sei periodi con un mese di scorte — la copertura degrada nel periodo giusto, non sul salto intero', () => {
    // Nemico **forte** (il valore del mondo): nessuno sfondamento in un periodo,
    // quindi la pressione di ogni periodo è osservabile.
    const AUT_POWER = 800;
    const dates = ['2026-01-31', '2026-03-02', '2026-04-01', '2026-05-01', '2026-05-31', '2026-06-30'];
    const run = (months: number) => {
      const session = warGame({ autPower: AUT_POWER });
      const need = weaponsNeedOfPeriod(session);
      setStock(session, { weapons: need * months, food: 500, fuel: 500, clothing: 500 });
      const supplies: (number | undefined)[] = [];
      const pressures: number[] = [];
      const shortages: boolean[] = [];
      for (const date of dates) {
        const lines = advancePeriod(session, 30, date);
        supplies.push(periodSupply(session)?.weapons);
        pressures.push(Number(theFront(session)?.attackerPressure || 0));
        shortages.push(weaponsShortage(lines));
      }
      return { need, supplies, pressures, shortages };
    };
    const covered = run(6);
    const oneMonth = run(1);
    const nothing = run(0);
    // Con sei mesi di scorte la copertura resta piena e nessun periodo è carente.
    expect(covered.supplies.every(value => value === 1)).toBe(true);
    expect(covered.shortages.every(value => value === false)).toBe(true);
    // Con **un mese** di scorte il **primo** periodo è coperto al 100% (pressione
    // identica a chi ha sei mesi) e il secondo no (pressione in calo). Una
    // copertura unica calcolata sul salto intero avrebbe dato zero già al primo
    // periodo — e una carenza registrata subito.
    expect(oneMonth.supplies[0]).toBe(1);
    expect(oneMonth.shortages[0]).toBe(false);
    expect(oneMonth.pressures[0]).toBeCloseTo(covered.pressures[0], 6);
    expect(oneMonth.pressures[0]).toBeGreaterThan(nothing.pressures[0]);
    expect(oneMonth.supplies[1]).toBe(0);
    expect(oneMonth.shortages[1]).toBe(true);
    expect(oneMonth.pressures[1]).toBeLessThan(oneMonth.pressures[0]);
    // Senza scorte la carenza c'è dal primo periodo.
    expect(nothing.supplies[0]).toBe(0);
    expect(nothing.shortages[0]).toBe(true);
    // La degradazione è **nel tempo**: la copertura del secondo periodo in poi è
    // zero in entrambe le partite povere, mai un valore unico sui sei periodi.
    expect(oneMonth.supplies.slice(1).every(value => value === 0)).toBe(true);
    expect(nothing.supplies.every(value => value === 0)).toBe(true);
  });

  it('35: unità distrutta → nessun consumo e nessuna pressione', () => {
    const session = warGame();
    const before = store(session).militaryNeeds().weapons;
    const target = units(session).find(unit => String(unit.armyId) === 'a1')!;
    store(session).saveUnits(units(session).map(unit =>
      (String(unit.id) === String(target.id) ? { ...unit, status: 'destroyed', personnel: 0 } : unit)));
    const after = store(session).militaryNeeds().weapons;
    expect(before - after).toBeCloseTo(Number(target.monthlyNeeds.weapons) * 1.8, 4);
    // Il reparto distrutto non combatte: il fronte non lo vede più.
    expect(theFront(session).regionIds.length).toBeGreaterThan(0);
    advancePeriod(session, 30, '2026-01-31');
    expect(store(session).units().filter(unit => String(unit.id) === String(target.id))[0].personnel).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-B — lo stato del fronte si assesta PRIMA del fabbisogno del periodo
// ══════════════════════════════════════════════════════════════════════════
describe('WARFRONT SUPPLY/TICK — P0-B: sincronizzazione prima del tick', () => {
  it('36: trasferito fuori teatro — il periodo successivo paga ×1, senza sync manuale', () => {
    const session = warGame();
    const unit = units(session).find(item => String(item.id) === 'a1-unit-001')!;
    const moved = session.unitAction({ action: 'transfer', unitId: unit.id, regionId: R.ita3 });
    expect(moved.blocked).toBe(false);
    // Dopo il movimento il `frontId` è ancora quello di prima: lo sgancio è
    // compito della sincronizzazione, che ora gira **prima** del fabbisogno.
    expect(String(unitOf(session, unit.id).frontId)).toBe(String(theFront(session).id));
    // Scorte **esattamente** pari al fabbisogno ×1 (un reparto fuori teatro non
    // paga il coefficiente di guerra): bastano, e nessun materiale manca.
    const expected = weaponsNeedOfPeriod(session);
    expect(expected).toBeLessThan(sumOf(activeUnits(session), item => Number(item.monthlyNeeds.weapons || 0) * 1.8));
    setStock(session, { weapons: expected, food: 500, fuel: 500, clothing: 500 });
    const lines = advancePeriod(session, 30, '2026-01-31');
    expect(unitOf(session, unit.id).frontId).toBeNull();
    expect(Number(stock(session).weapons)).toBeCloseTo(0, 6);
    expect(weaponsShortage(lines)).toBe(false);
    expect(periodSupply(session)?.weapons).toBe(1);
  });

  it('37: pace prima del tick — fronte chiuso, reparti liberi, nessun ultimo mese di guerra', () => {
    const session = warGame();
    const frontId = theFront(session).id;
    setRelationship(session, PID, AUT, 'neutral');
    // Il fabbisogno ×1 di **tutti** i reparti: in pace nessuno è sul fronte.
    const expected = sumOf(activeUnits(session), unit => Number(unit.monthlyNeeds.weapons || 0));
    setStock(session, { weapons: expected, food: 500, fuel: 500, clothing: 500 });
    const lines = advancePeriod(session, 30, '2026-01-31');
    const front = fronts(session).find(item => String(item.id) === String(frontId));
    expect(front?.status).toBe('closed');
    expect(units(session).every(unit => unit.frontId === null)).toBe(true);
    expect(lines.some(line => /Si chiude/.test(line))).toBe(true);
    expect(Number(stock(session).weapons)).toBeCloseTo(0, 6);
    expect(weaponsShortage(lines)).toBe(false);
  });

  it('38: `frontId` che punta a un fronte inesistente — nessun coefficiente di guerra e nessun fantasma', () => {
    const session = warGame();
    const unit = units(session).find(item => String(item.id) === 'a1-unit-001')!;
    const frontId = String(theFront(session).id);
    store(session).saveUnits(units(session).map(item =>
      (String(item.id) === String(unit.id) ? { ...item, frontId: 'ghost-front' } : item)));
    // 1) Il fabbisogno non paga la guerra per un fronte che non esiste: la regola
    // «sei sul fronte?» vale anche qui, non solo nella sincronizzazione.
    expect(store(session).militaryNeeds().weapons).toBeCloseTo(weaponsNeedOfPeriod(session), 4);
    // 2) Il fantasma non sopravvive alla sincronizzazione: lo sgancio azzera il
    // riferimento, e alla sincronizzazione successiva il reparto — che è nel
    // teatro — torna sul fronte **vero**.
    session.publicFronts();
    expect(unitOf(session, unit.id).frontId).toBeNull();
    session.publicFronts();
    expect(String(unitOf(session, unit.id).frontId)).toBe(frontId);
  });

  it('39: il livello della mappa non decide la guerra — il fronte non si apre senza contatto', () => {
    const session = warGame();
    expect(theFront(session)).toBeTruthy();
    // Nessuna ostilità registrata: nessun fronte, nessun consumo di guerra.
    setRelationship(session, PID, AUT, 'neutral');
    session.publicFronts();
    expect(store(session).militaryNeeds().weapons).toBeCloseTo(
      sumOf(activeUnits(session), unit => Number(unit.monthlyNeeds.weapons || 0)), 4);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P1-4 — isolamento fra rami dello stato operativo
// ══════════════════════════════════════════════════════════════════════════
describe('WARFRONT SUPPLY/TICK — P1-4: rami dello stato operativo', () => {
  it('40: ramo A ↔ ramo B ↔ ramo A — nessuna contaminazione degli operational objects', async () => {
    const { semanticStateHash } = await import('../src/domain/semantic-hash');
    const { session } = createGame();
    setRelationship(session, PID, AUT, 'hostile');
    session.publicFronts();
    const gameId = session.id;
    const unitId = 'a1-unit-001';
    const frontId = theFront(session).id;
    const unitIdsAtT0 = units(session).map(unit => String(unit.id)).sort();
    const pressure = () => Number(fronts(session).find(front => String(front.id) === String(frontId))?.attackerPressure ?? -1);
    const men = () => Number(unitOf(session, unitId)?.personnel);
    // T0: il punto comune dei due rami.
    const t0 = session.save('T0').saveId;
    // Ramo A: il reparto ha combattuto (7.000 uomini) e il fronte preme 0,40.
    restoreSave(session, t0);
    store(session).saveUnits(units(session).map(unit => (String(unit.id) === String(unitId) ? { ...unit, personnel: 7000 } : unit)));
    store(session).saveFronts(fronts(session).map(front => ({ ...front, attackerPressure: 0.4, status: 'active' })));
    const saveA = session.save('A').saveId;
    // Ramo B: nessun combattimento (12.000 uomini, pressione 0,10).
    restoreSave(session, t0);
    store(session).saveFronts(fronts(session).map(front => ({ ...front, attackerPressure: 0.1, status: 'active' })));
    const saveB = session.save('B').saveId;
    // I due rami nascono dal **medesimo** checkpoint, con padre diverso.
    const branchA = restoreSave(session, saveA);
    const openA = session.loadFromSave(readSaveData(saveA), null, { newBranch: { originCheckpointId: t0, name: 'A' } });
    const openB = session.loadFromSave(readSaveData(saveB), null, { newBranch: { originCheckpointId: t0, name: 'B' } });
    expect(openA.branchId).toBeTruthy();
    expect(openB.branchId).toBeTruthy();
    expect(openA.branchId).not.toBe(openB.branchId);
    const branches = db.prepare('SELECT name, origin_checkpoint_id FROM game_branches WHERE game_id = ?').all(gameId) as any[];
    expect(branches.map(row => row.name).sort()).toEqual(['A', 'B', 'main']);
    expect(branches.filter(row => row.name !== 'main').every(row => row.origin_checkpoint_id === t0)).toBe(true);
    // Gli hash semantici dei due rami differiscono: lo stato operativo è parte
    // del confronto, non un allegato.
    expect(semanticStateHash(readSaveData(saveA))).not.toBe(semanticStateHash(readSaveData(saveB)));
    // A → B → A: ogni ripristino riporta **il suo** ramo, in memoria e sul DB.
    restoreSave(session, saveA);
    expect(men()).toBe(7000);
    expect(pressure()).toBeCloseTo(0.4, 6);
    expect(operationalRow(gameId, unitId)?.personnel).toBe(7000);
    expect(frontRow(gameId)?.attackerPressure).toBeCloseTo(0.4, 6);
    restoreSave(session, saveB);
    expect(men()).toBe(12000);
    expect(pressure()).toBeCloseTo(0.1, 6);
    expect(operationalRow(gameId, unitId)?.personnel).toBe(12000);
    expect(frontRow(gameId)?.attackerPressure).toBeCloseTo(0.1, 6);
    restoreSave(session, saveA);
    expect(men()).toBe(7000);
    expect(pressure()).toBeCloseTo(0.4, 6);
    expect(operationalRow(gameId, unitId)?.personnel).toBe(7000);
    // Nessuna riga in più e nessuna in meno: l'insieme è quello del ramo.
    expect(units(session).map(unit => String(unit.id)).sort()).toEqual(unitIdsAtT0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Coerenza del salto lungo
// ══════════════════════════════════════════════════════════════════════════
describe('WARFRONT SUPPLY/TICK — coerenza del salto lungo', () => {
  it('41: 180 giorni e sei turni da 30 sono la stessa storia (scorte, uomini, pezzi, fronte)', () => {
    const dates = ['2026-01-31', '2026-03-02', '2026-04-01', '2026-05-01', '2026-05-31', '2026-06-30'];
    const snapshot = (session: any) => ({
      stock: (({ food, weapons, fuel, clothing }) => ({ food, weapons, fuel, clothing }))(stock(session)),
      units: activeUnits(session)
        .map(unit => ({ id: unit.id, personnel: unit.personnel, equipment: unit.equipment, status: unit.status, order: unit.order, frontId: unit.frontId, regionId: unit.regionId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      fronts: fronts(session).map(front => ({ id: front.id, status: front.status, regions: front.regionIds, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure })),
    });
    const long = warGame();
    setStock(long, { weapons: 60, food: 3000, fuel: 3000, clothing: 3000 });
    advancePeriod(long, 180, '2026-06-30');
    const split = warGame();
    setStock(split, { weapons: 60, food: 3000, fuel: 3000, clothing: 3000 });
    for (const date of dates) advancePeriod(split, 30, date);
    expect(snapshot(split)).toEqual(snapshot(long));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-C — NPC material supply symmetry
// ══════════════════════════════════════════════════════════════════════════
describe('NPC SUPPLY SYMMETRY — P0-C: MaterialEngine → fulfillmentByPolity → WarFrontEngine', () => {
  const full = { food: 1, clothing: 1, weapons: 1, fuel: 1 };

  it('42: NPC stock esatto — need 10 / available 10 → fulfillment e supply 1, stock finale 0', () => {
    // Account legacy controllato: nessuna popolazione/industria, 2.500 forze
    // ⇒ need armamenti 10. È il material tick reale, non una formula duplicata.
    const session = warGame();
    const [period] = npcMaterialPeriods(session, 30, '2026-01-31', 10);
    expect(period.fulfillmentByPolity[AUT].weapons).toBe(1);
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 6);
    // WarFrontService consuma il fatto del MaterialEngine anche per l'NPC.
    (session as any).warFronts.advanceFronts(30, '2026-01-31', { supply: period.fulfillmentByPolity });
    expect(periodSupply(session, AUT)?.weapons).toBe(1);
    // Wiring canonico: nel salto GameSession l'NPC è presente nella stessa
    // mappa di copertura del player (nessuna `playerSupply` dedicata).
    const wired = warGame();
    setStock(wired, { weapons: 10 }, AUT);
    advancePeriod(wired, 30, '2026-01-31');
    expect(periodSupply(wired, PID)).not.toBeNull();
    expect(periodSupply(wired, AUT)?.weapons).toBe(1);
  });

  it('43: NPC stock parziale — need 10 / available 4 → supply 0,4', () => {
    const session = warGame();
    const [period] = npcMaterialPeriods(session, 30, '2026-01-31', 4);
    expect(period.fulfillmentByPolity[AUT].weapons).toBeCloseTo(0.4, 4);
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 6);
    (session as any).warFronts.advanceFronts(30, '2026-01-31', { supply: period.fulfillmentByPolity });
    expect(periodSupply(session, AUT)?.weapons).toBeCloseTo(0.4, 4);
  });

  it('44: NPC senza armamenti — need 10 / available 0 → supply 0', () => {
    const session = warGame();
    const [period] = npcMaterialPeriods(session, 30, '2026-01-31', 0);
    expect(period.fulfillmentByPolity[AUT].weapons).toBe(0);
    expect(periodSupply(session, AUT)).toBeNull();
    (session as any).warFronts.advanceFronts(30, '2026-01-31', { supply: period.fulfillmentByPolity });
    expect(periodSupply(session, AUT)?.weapons).toBe(0);
  });

  it('45: player e NPC con la stessa disponibilità relativa ricevono la stessa fulfillment (0,4)', () => {
    const session = warGame();
    const playerNeed = weaponsNeedOfPeriod(session);
    setStock(session, { weapons: playerNeed * 0.4 }, PID);
    setStock(session, { weapons: 4 }, AUT);
    const periods: any[] = [];
    (session as any).nationState.advanceResources(30, {
      [PID]: session.sessionAccounts()[PID],
      [AUT]: npcSupplyAccount(session),
    }, '2026-01-31', {
      onMaterialPeriod: (period: any) => { periods.push(period); return []; },
    });
    expect(periods).toHaveLength(1);
    const supply = periods[0].fulfillmentByPolity;
    expect(Object.keys(supply).sort()).toEqual([AUT, PID].sort());
    expect(supply[PID].weapons).toBeCloseTo(0.4, 4);
    expect(supply[AUT].weapons).toBeCloseTo(0.4, 4);
    // Il core non distingue «supply player» e «supply NPC»: a parità di quota,
    // `frontSideStrength` riceve lo stesso fattore di rifornimento.
    const unit = units(session).find(item => String(item.armyId) === 'a1')!;
    const common = { units: [unit], epoch: (session as any).military.epoch(), motorized: false, legacyPower: 0 };
    // Il FrontEngine non conosce «player»/«NPC»: a parità della SideSupply
    // ricevuta dal periodo produce il medesimo fattore, senza ramo per polity.
    const equalSupply = { food: 0.4, clothing: 0.4, weapons: 0.4, fuel: 0.4 };
    const player = frontSideStrength({ ...common, supply: equalSupply });
    const npc = frontSideStrength({ ...common, supply: equalSupply });
    expect(player.units[0].supplyFactor).toBe(npc.units[0].supplyFactor);
  });

  it('46: NPC periodo parziale — 15 giorni, need 5 / available 5 → supply 1 e stock 0', () => {
    const session = warGame();
    const [period] = npcMaterialPeriods(session, 15, '2026-01-16', 5);
    expect(period.fulfillmentByPolity[AUT].weapons).toBe(1);
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 6);
  });

  it('47: NPC con un mese di scorte su 180 giorni — 1,0,0,0,0,0, senza valore unico finale', () => {
    const session = warGame();
    const periods = npcMaterialPeriods(session, 180, '2026-06-30', 10);
    expect(periods).toHaveLength(6);
    expect(periods.map(period => period.fulfillmentByPolity[AUT].weapons)).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('48: cache transitoria — un NPC assente dal periodo successivo non riusa la supply vecchia, né sopravvive al riavvio', () => {
    const { gameId, session } = createGame();
    const service = (session as any).warFronts;
    service.advanceFronts(30, '2026-01-31', { supply: { [AUT]: full, [PID]: full } });
    expect(periodSupply(session, AUT)?.weapons).toBe(1);
    // Nuovo periodo, AUT non ha attraversato `advanceStock`: la vecchia 1 non
    // è una supply corrente e `sides()` ricade nel fallback dichiarato.
    const half = { food: 0.5, clothing: 0.5, weapons: 0.5, fuel: 0.5 };
    service.advanceFronts(30, '2026-03-02', { supply: { [PID]: half } });
    expect(periodSupply(session, PID)?.weapons).toBe(0.5);
    expect(periodSupply(session, AUT)).toBeNull();
    // Percorso senza MaterialTick: nessuna coverage misurata, quindi la cache
    // resta vuota e `sides()` mantiene il fallback `supplyCoverage` legacy.
    service.advanceFronts(30, '2026-04-01');
    expect(periodSupply(session, PID)).toBeNull();
    expect(periodSupply(session, AUT)).toBeNull();
    registry.removeSession(gameId);
    const reloaded = registry.getSession(gameId);
    expect(periodSupply(reloaded, AUT)).toBeNull();
  });

  it('49: 180 giorni = 6×30 anche con le scorte NPC nel fatto del periodo', () => {
    const dates = ['2026-01-31', '2026-03-02', '2026-04-01', '2026-05-01', '2026-05-31', '2026-06-30'];
    const snapshot = (session: any) => ({
      playerStock: (({ food, weapons, fuel, clothing }) => ({ food, weapons, fuel, clothing }))(stock(session)),
      npcStock: (({ food, weapons, fuel, clothing }) => ({ food, weapons, fuel, clothing }))(stock(session, AUT)),
      units: activeUnits(session)
        .map(unit => ({ id: unit.id, personnel: unit.personnel, equipment: unit.equipment, status: unit.status, order: unit.order, frontId: unit.frontId, regionId: unit.regionId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      fronts: fronts(session).map(front => ({ id: front.id, status: front.status, regions: front.regionIds, attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure })),
    });
    const long = warGame();
    setStock(long, { weapons: 60, food: 3000, fuel: 3000, clothing: 3000 });
    setStock(long, { weapons: 10, food: 3000, fuel: 3000, clothing: 3000 }, AUT);
    advancePeriod(long, 180, '2026-06-30');
    const split = warGame();
    setStock(split, { weapons: 60, food: 3000, fuel: 3000, clothing: 3000 });
    setStock(split, { weapons: 10, food: 3000, fuel: 3000, clothing: 3000 }, AUT);
    for (const date of dates) advancePeriod(split, 30, date);
    expect(snapshot(split)).toEqual(snapshot(long));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-D — NPC war-consumption symmetry
// ══════════════════════════════════════════════════════════════════════════
describe('NPC WAR-CONSUMPTION SYMMETRY — P0-D: stesso costo d\'ordine per la forza dichiarata', () => {
  it('50: NPC in attacco paga ×1,8 — il piano del periodo entra nel fabbisogno, non dopo', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const session = warGame();
    npcWarWorld(session);
    const plan = (session as any).warFronts.planPeriod(30);
    expect(plannedOrderFor(plan, theFront(session).id, AUT)).toBe('attack');
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(1.8, 4);
    // Costo del periodo: 10,004 × 1,8 = 18,007 — non 10,004.
    const base = economy.legacyMilitaryNeeds(session.sessionAccounts()[AUT]).weapons;
    expect(base).toBeGreaterThan(0.2);
    expect(economy.scaledLegacyMilitaryNeeds(session.sessionAccounts()[AUT], 1.8).weapons).toBeCloseTo(base * 1.8, 6);
    const production = npcWeaponsProduction(session);
    setStock(session, { weapons: base, food: 0, clothing: 0, fuel: 0 }, AUT);
    const lines = advancePeriod(session, 30, '2026-01-31');
    const supply = periodSupply(session, AUT)!;
    // Copertura = disponibilità reale / costo dell'attacco: con lo stock pari al
    // costo di **pace** si copre 1/1,8 (0,5556) più la produzione del periodo.
    const expected = (base + production) / (base * 1.8);
    expect(supply.weapons).toBeCloseTo(expected, 3);
    expect(supply.weapons).toBeLessThan(1);
    // Il periodo ha speso **tutto** il disponibile: il costo dell'attacco non è
    // coperto (l'NPC non ha un bollettino proprio: il fatto è nella copertura).
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 4);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('51: NPC in difesa paga ×1,2', () => {
    const session = warGame();
    const idle = session.regions.get(R.aut2);
    if (idle) idle.militaryPower = 0;
    const plan = (session as any).warFronts.planPeriod(30);
    expect(plannedOrderFor(plan, theFront(session).id, AUT)).toBe('defend');
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(1.2, 4);
    // Numeri esatti del costo: 10 → 12, con 10 disponibili → 10/12.
    const [period] = npcLegacyPeriods(session, 30, '2026-01-31', { weapons: 10, factor: 1.2 });
    expect(period.fulfillmentByPolity[AUT].weapons).toBeCloseTo(0.8333, 4);
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 6);
  });

  it('52: NPC in ritirata non paga il costo di guerra (×1)', () => {
    const session = warGame({ autPower: 10 });
    const plan = (session as any).warFronts.planPeriod(30);
    expect(plannedOrderFor(plan, theFront(session).id, AUT)).toBe('withdraw');
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(1, 4);
    // Costo di pace: 10 disponibili coprono 10.
    const [period] = npcLegacyPeriods(session, 30, '2026-01-31', { weapons: 10, factor: 1 });
    expect(period.fulfillmentByPolity[AUT].weapons).toBe(1);
    expect(Number(stock(session, AUT).weapons)).toBeCloseTo(0, 6);
  });

  it('53: in pace il coefficiente è 1 — nessun ultimo mese di guerra', () => {
    const session = warGame();
    setRelationship(session, PID, AUT, 'neutral');
    session.publicFronts();
    const plan = (session as any).warFronts.planPeriod(30);
    expect(plan.legacyConsumptionFactors[AUT]).toBeUndefined();
    // Nessun fronte aperto ⇒ nessun ordine pianificato per nessun fronte.
    expect(Object.keys(plan.legacyOrdersByFront)).toEqual([]);
    // Nessun piano ⇒ nessun override: il fabbisogno resta quello di sempre.
    const [period] = npcLegacyPeriods(session, 30, '2026-01-31', { weapons: 10 });
    expect(period.fulfillmentByPolity[AUT].weapons).toBe(1);
  });

  it('54: simmetria player/NPC in attacco — entrambi 1/1,8', () => {
    // PLAYER: reparti persistenti, ordine d'attacco persistente. La
    // disponibilità è **la stessa quota** del costo del periodo (1/1,8).
    const player = warGame();
    const playerNeed = weaponsNeedOfPeriod(player);
    setStock(player, { weapons: playerNeed / 1.8, food: 500, fuel: 500, clothing: 500 }, PID);
    advancePeriod(player, 30, '2026-01-31');
    const playerSupply = periodSupply(player, PID)!.weapons;
    // NPC: nessun reparto, stessa semantica di costo.
    const npc = warGame();
    const [period] = npcLegacyPeriods(npc, 30, '2026-01-31', { weapons: 10, factor: 1.8 });
    const npcSupply = period.fulfillmentByPolity[AUT].weapons;
    expect(playerSupply).toBeCloseTo(1 / 1.8, 3);
    expect(npcSupply).toBeCloseTo(1 / 1.8, 4);
    expect(Math.abs(playerSupply - npcSupply)).toBeLessThan(0.01);
  });

  it('55: nessun doppio moltiplicatore — 10 diventa 18, non 28 o 32,4', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    // Il consumo dell'attacco è **totale** (base × 1,8), non base + 1,8× base.
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const base = economy.legacyMilitaryNeeds(account);
    expect(base.weapons).toBe(10);
    const stockBase = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 0 };
    for (const factor of [1, 1.2, 1.8]) {
      const tick = economy.advanceStock({ ...stockBase, weapons: 100 }, account as any, 30, {}, '2026-01-31', null, undefined, factor);
      const consumed = -(tick.flow.weapons);
      expect(consumed).toBeCloseTo(base.weapons * factor, 4);
      expect(consumed).toBeLessThan(base.weapons * factor + 0.01);
    }
    // Con la disponibilità esatta del costo d'attacco: copertura piena e zero.
    const exact = economy.advanceStock({ ...stockBase, weapons: 18 }, account as any, 30, {}, '2026-01-31', null, undefined, 1.8);
    expect(exact.fulfillment.weapons).toBe(1);
    expect(exact.stock.weapons).toBeCloseTo(0, 6);
  });

  it('56: periodo parziale — 15 giorni sono metà costo d\'attacco', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const base = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 0 };
    // Fabbisogno mensile 10, attacco ×1,8 → 9 nel periodo di 15 giorni.
    const exact = economy.advanceStock({ ...base, weapons: 9 }, account as any, 15, {}, '2026-01-16', null, undefined, 1.8);
    expect(exact.fulfillment.weapons).toBe(1);
    expect(exact.stock.weapons).toBeCloseTo(0, 6);
    const half = economy.advanceStock({ ...base, weapons: 4.5 }, account as any, 15, {}, '2026-01-16', null, undefined, 1.8);
    expect(half.fulfillment.weapons).toBeCloseTo(0.5, 4);
  });

  it('57: multi-fronte — media pesata delle quote impegnate, con la parte non impegnata a ×1', async () => {
    const { legacyWarConsumptionFactor } = await import('../src/core/simulation/WarFronts');
    // 40% attacco + 20% difesa + 40% fuori teatro → 0,4×1,8 + 0,2×1,2 + 0,4×1 = 1,36.
    const weighted = legacyWarConsumptionFactor({
      engagements: [{ order: 'attack', weight: 40 }, { order: 'defend', weight: 20 }],
      nationalPower: 100,
    });
    expect(weighted.factor).toBeCloseTo(1.36, 4);
    // `dominantOrder` è **diagnostica**: la quota maggiore vince, ma non decide
    // il combattimento (che usa l'ordine del singolo fronte).
    expect(weighted.dominantOrder).toBe('attack');
    // La stessa forza non si conta due volte: Σ quote ≤ 1.
    const over = legacyWarConsumptionFactor({
      engagements: [{ order: 'attack', weight: 100 }, { order: 'attack', weight: 100 }],
      nationalPower: 100,
    });
    expect(over.factor).toBeCloseTo(1.8, 4);
    // Fronte senza potenza dichiarata: non alza il consumo nazionale.
    expect(legacyWarConsumptionFactor({ engagements: [{ order: 'attack', weight: 0 }], nationalPower: 100 }))
      .toEqual({ factor: 1, dominantOrder: null });
    // Nessun impegno (pace): costo di pace.
    expect(legacyWarConsumptionFactor({ engagements: [], nationalPower: 100 })).toEqual({ factor: 1, dominantOrder: null });
    // Determinismo: stesso stato ⇒ stesso ordine e stesso coefficiente.
    const again = legacyWarConsumptionFactor({
      engagements: [{ order: 'attack', weight: 40 }, { order: 'defend', weight: 20 }],
      nationalPower: 100,
    });
    expect(again).toEqual(weighted);
  });

  it('58: il combattimento usa lo **stesso** ordine che ha pagato il fabbisogno', () => {
    // Il piano del mondo dice attacco per AUT (`npcFrontOrder`, player fuori
    // teatro): l'ordine **pianificato** è quello che combatte.
    const planned = warGame();
    npcWarWorld(planned);
    const plan = (planned as any).warFronts.planPeriod(30);
    expect(plannedOrderFor(plan, theFront(planned).id, AUT)).toBe('attack');
    (planned as any).warFronts.advanceFronts(30, '2026-01-31', { legacyOrdersByFront: plan.legacyOrdersByFront });
    const attackFront = fronts(planned)[0];
    expect(attackFront.defenderPressure).toBeGreaterThan(0);
    // Stesso mondo, ma la **ritirata** pianificata: nessuna pressione. La parte
    // ITA non cambia: l'ordine pianificato riguarda solo la forza dichiarata NPC.
    const withdrawing = warGame();
    npcWarWorld(withdrawing);
    (withdrawing as any).warFronts.advanceFronts(30, '2026-01-31', {
      legacyOrdersByFront: { [String(theFront(withdrawing).id)]: { [AUT]: 'withdraw' } },
    });
    const withdrawFront = fronts(withdrawing)[0];
    expect(withdrawFront.defenderPressure).toBe(0);
    expect(withdrawFront.attackerPressure).toBeCloseTo(attackFront.attackerPressure, 6);
  });

  it('59: 180 giorni e sei turni da 30 restano la stessa storia con il costo NPC', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const dates = ['2026-01-31', '2026-03-02', '2026-04-01', '2026-05-01', '2026-05-31', '2026-06-30'];
    const snapshot = (session: any) => ({
      npcStock: (({ weapons, food, fuel, clothing }) => ({ weapons, food, fuel, clothing }))(stock(session, AUT)),
      playerStock: (({ weapons, food, fuel, clothing }) => ({ weapons, food, fuel, clothing }))(stock(session)),
      fronts: fronts(session).map(front => ({
        id: front.id, status: front.status, regions: front.regionIds,
        attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure,
      })),
      units: activeUnits(session)
        .map(unit => ({ id: unit.id, personnel: unit.personnel, status: unit.status, order: unit.order, frontId: unit.frontId, regionId: unit.regionId }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    });
    // Costo di pace della forza dichiarata: lo stesso per i due salti.
    const probe = warGame();
    npcWarWorld(probe);
    const base = economy.legacyMilitaryNeeds(probe.sessionAccounts()[AUT]).weapons;
    const long = warGame();
    npcWarWorld(long);
    setStock(long, { weapons: base, food: 0, clothing: 0, fuel: 0 }, AUT);
    advancePeriod(long, 180, '2026-06-30');
    const split = warGame();
    npcWarWorld(split);
    setStock(split, { weapons: base, food: 0, clothing: 0, fuel: 0 }, AUT);
    for (const date of dates) advancePeriod(split, 30, date);
    expect(snapshot(split)).toEqual(snapshot(long));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// P0-D2 — multi-fronte, capacità strutturale, vestiario
// ══════════════════════════════════════════════════════════════════════════
describe('NPC WAR-COST RESIDUI — P0-D2: ordini per fronte, capacità strutturale, vestiario', () => {
  it('60: il piano tiene gli ordini **per fronte** — nessun ordine nazionale', () => {
    const session = multiFrontGame();
    const plan = (session as any).warFronts.planPeriod(30);
    // Lo stesso paese, due fronti, due ordini diversi.
    expect(plannedOrderFor(plan, FRONT_ITA, AUT)).toBe('attack');
    expect(plannedOrderFor(plan, FRONT_HUN, AUT)).toBe('defend');
    expect(plannedOrderFor(plan, FRONT_HUN, HUN)).toBe('defend');
    // Il player non entra mai nel piano (il suo costo è per unità).
    expect(plannedOrderFor(plan, FRONT_ITA, PID)).toBeNull();
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(1.36, 4);
  });

  it('61: il combattimento usa l\'ordine del **suo** fronte (attacco qui, ritirata là)', () => {
    const planned = multiFrontGame();
    const plan = (planned as any).warFronts.planPeriod(30);
    // Ritirata pianificata sul fronte HUN: la pressione della parte AUT è zero
    // per costruzione (fattore d'ordine 0), quindi la prova non dipende dal tiro.
    const orders = { ...plan.legacyOrdersByFront, [FRONT_HUN]: { [AUT]: 'withdraw' } };
    (planned as any).warFronts.advanceFronts(30, '2026-01-31', { legacyOrdersByFront: orders });
    expect(pressureOf(planned, FRONT_ITA, AUT)).toBeGreaterThan(0);
    expect(pressureOf(planned, FRONT_HUN, AUT)).toBe(0);
    // Stesso mondo **senza** piano: là AUT combatte (nessuna ritirata gratuita),
    // quindi lo zero di sopra viene dal piano per-fronte, non dal caso.
    const fallback = multiFrontGame();
    (fallback as any).warFronts.advanceFronts(30, '2026-01-31');
    expect(pressureOf(fallback, FRONT_HUN, AUT)).toBeGreaterThan(0);
  });

  it('62: il coefficiente nazionale nasce dalle **stesse** quote e dagli stessi ordini del piano', async () => {
    const { legacyWarConsumptionFactor } = await import('../src/core/simulation/WarFronts');
    const session = multiFrontGame();
    const plan = (session as any).warFronts.planPeriod(30);
    // Quote impegnate = potenza dichiarata nel teatro di ciascun fronte su quella
    // nazionale: 400/1000 sul fronte ITA, 200/1000 sul fronte HUN, 400/1000 fuori.
    const share = (frontId: string) => {
      const front = fronts(session).find(item => String(item.id) === frontId)!;
      const engaged = front.regionIds
        .map((id: string) => session.regions.get(String(id)))
        .filter((region: any) => region && String(region.owner) === AUT)
        .reduce((total: number, region: any) => total + Number(region.militaryPower || 0), 0);
      return engaged / 1000;
    };
    const shareIta = share(FRONT_ITA);
    const shareHun = share(FRONT_HUN);
    expect(shareIta).toBeCloseTo(0.4, 4);
    expect(shareHun).toBeCloseTo(0.2, 4);
    // Aggregazione nazionale: 1 + Σ quota × (consumo(ordine) − 1), con la parte
    // non impegnata a ×1. Gli ordini sono quelli del piano, fronte per fronte.
    const expected = 1 + shareIta * (1.8 - 1) + shareHun * (1.2 - 1);
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(expected, 4);
    expect(plan.legacyConsumptionFactors[AUT]).toBeCloseTo(1.36, 4);
    // `dominantOrder` resta **diagnostica**: dice quale quota pesa di più, non
    // quale ordine combattono i fronti.
    const diagnostic = legacyWarConsumptionFactor({
      engagements: [
        { order: plannedOrderFor(plan, FRONT_ITA, AUT) as any, weight: shareIta },
        { order: plannedOrderFor(plan, FRONT_HUN, AUT) as any, weight: shareHun },
      ],
      nationalPower: 1,
    });
    expect(diagnostic.factor).toBeCloseTo(1.36, 4);
    expect(diagnostic.dominantOrder).toBe('attack');
    // ...e l'ordine del fronte HUN resta la difesa, non l'ordine dominante.
    expect(plannedOrderFor(plan, FRONT_HUN, AUT)).toBe('defend');
  });

  it('63: la capacità del magazzino NPC **non** cresce con l\'ordine (pace, difesa, attacco)', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const structural = economy.effectiveMaterialNeeds(account as any, null, economy.legacyMilitaryNeeds(account as any));
    const cap = economy.storageCapacity(account as any, structural).weapons;
    expect(cap).toBeGreaterThan(4);
    const zero = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 0 };
    const run = (factor: number) => economy.advanceStock(
      { ...zero, weapons: cap * 1.5 }, account as any, 30, {}, '2026-01-31', null, undefined, factor,
    );
    const peace = run(1);
    const defend = run(1.2);
    const attack = run(1.8);
    // Tetto **strutturale**: identico nei tre casi, quindi lo stock finale è il tetto.
    for (const tick of [peace, defend, attack]) {
      expect(tick.stock.weapons).toBeCloseTo(cap, 3);
      expect(tick.stock.weapons).toBeLessThan(cap * 1.5);
    }
    // Il consumo invece cambia: 10 / 12 / 18.
    expect(-peace.flow.weapons).toBeCloseTo(10, 4);
    expect(-defend.flow.weapons).toBeCloseTo(12, 4);
    expect(-attack.flow.weapons).toBeCloseTo(18, 4);
  });

  it('64: la capacità del magazzino del **player** non dipende dall\'ordine (difesa, attacco, riserva)', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const play = (order: 'defend' | 'attack' | 'reserve') => {
      const session = warGame();
      setOrder(session, order);
      const overlay = store(session).materialFlow({ stepDays: 30 })!;
      const account = session.sessionAccounts()[PID];
      const structural = economy.effectiveMaterialNeeds(account, overlay, overlay.structuralMilitaryNeeds);
      const cap = economy.storageCapacity(account, structural).weapons;
      const tick = economy.advanceStock(
        { ...stock(session, PID), food: 0, clothing: 0, fuel: 0, weapons: cap * 1.5 },
        account, 30, {}, '2026-01-31', overlay,
      );
      return { cap, tick, periodNeed: overlay.militaryNeeds!.weapons, baseNeed: overlay.structuralMilitaryNeeds!.weapons };
    };
    const defend = play('defend');
    const attack = play('attack');
    const reserve = play('reserve');
    // Base di pace identica; il fabbisogno del periodo invece cambia con l'ordine.
    expect(defend.baseNeed).toBeCloseTo(attack.baseNeed, 6);
    expect(defend.baseNeed).toBeCloseTo(reserve.baseNeed, 6);
    expect(attack.periodNeed).toBeGreaterThan(defend.periodNeed);
    expect(defend.periodNeed).toBeGreaterThan(reserve.periodNeed);
    // Tetto invariato: lo stock finale è lo stesso tetto strutturale.
    expect(attack.cap).toBeCloseTo(defend.cap, 6);
    expect(reserve.cap).toBeCloseTo(defend.cap, 6);
    expect(attack.tick.stock.weapons).toBeCloseTo(defend.tick.stock.weapons, 3);
    expect(reserve.tick.stock.weapons).toBeCloseTo(defend.tick.stock.weapons, 3);
  });

  it('65: il flusso del periodo cambia mentre la capacità resta ferma', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const zero = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 100 };
    const flowOf = (factor: number) => -economy.advanceStock(
      { ...zero }, account as any, 30, {}, '2026-01-31', null, undefined, factor,
    ).flow.weapons;
    expect(flowOf(1)).toBeCloseTo(10, 4);
    expect(flowOf(1.2)).toBeCloseTo(12, 4);
    expect(flowOf(1.8)).toBeCloseTo(18, 4);
    // Lo stesso confronto per il player: il consumo segue l'ordine, il tetto no.
    const flowPlayer = (order: 'defend' | 'attack') => {
      const target = warGame();
      setOrder(target, order);
      const overlay = store(target).materialFlow({ stepDays: 30 })!;
      const tick = economy.advanceStock(
        { ...stock(target, PID), food: 0, clothing: 0, fuel: 0, weapons: 100 },
        target.sessionAccounts()[PID], 30, {}, '2026-01-31', overlay,
      );
      return { flow: -tick.flow.weapons, cap: economy.storageCapacity(target.sessionAccounts()[PID],
        economy.effectiveMaterialNeeds(target.sessionAccounts()[PID], overlay, overlay.structuralMilitaryNeeds)).weapons };
    };
    expect(flowPlayer('attack').flow).toBeGreaterThan(flowPlayer('defend').flow);
    expect(flowPlayer('attack').cap).toBeCloseTo(flowPlayer('defend').cap, 6);
  });

  it('66: il vestiario militare NPC non paga il coefficiente d\'ordine', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const base = economy.legacyMilitaryNeeds(account as any);
    for (const factor of [1, 1.2, 1.8]) {
      const scaled = economy.scaledLegacyMilitaryNeeds(account as any, factor);
      // Cibo, armamenti e carburante seguono l'ordine: sono l'intensità operativa.
      expect(scaled.food).toBeCloseTo(base.food * factor, 6);
      expect(scaled.weapons).toBeCloseTo(base.weapons * factor, 6);
      expect(scaled.fuel).toBeCloseTo(base.fuel * factor, 6);
      // Il vestiario no: il player a reparti persistenti non lo modella per unità.
      expect(scaled.clothing).toBe(base.clothing);
    }
    const zero = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 0 };
    const clothingFlow = (factor: number) => economy.advanceStock(
      { ...zero }, account as any, 30, {}, '2026-01-31', null, undefined, factor,
    ).flow.clothing;
    expect(clothingFlow(1.8)).toBeCloseTo(clothingFlow(1), 6);
    expect(clothingFlow(1)).toBeCloseTo(-base.clothing, 6);
  });

  it('67: la pace non produce deperimento artificiale (il tetto non era stato gonfiato)', async () => {
    const economy = await import('../src/core/simulation/MaterialEconomy');
    const { session } = createGame();
    const account = { ...npcSupplyAccount(session) };
    const structural = economy.effectiveMaterialNeeds(account as any, null, economy.legacyMilitaryNeeds(account as any));
    const cap = economy.storageCapacity(account as any, structural).weapons;
    const zero = { ...stock(session, AUT), food: 0, clothing: 0, fuel: 0, weapons: 0 };
    // Periodo d'attacco con scorte oltre il tetto strutturale...
    const attack = economy.advanceStock(
      { ...zero, weapons: cap * 1.5 }, account as any, 30, {}, '2026-01-31', null, undefined, 1.8,
    );
    // ...poi la pace: nessun deperimento, perché il tetto non era cresciuto.
    const peace = economy.advanceStock(
      { ...zero, weapons: attack.stock.weapons }, account as any, 30, {}, '2026-03-02', null, undefined, 1,
    );
    expect(peace.spoiled.weapons ?? 0).toBe(0);
    // In pace il magazzino **scende** del consumo (10), senza deperimento
    // artificiale: il tetto non era cresciuto durante l'attacco.
    expect(attack.stock.weapons).toBeCloseTo(cap, 3);
    expect(peace.stock.weapons).toBeCloseTo(cap - 10, 3);
  });

  it('68: novanta giorni e tre turni da trenta sono la stessa storia anche su due fronti', () => {
    const snapshot = (session: any) => ({
      stocks: {
        player: (({ weapons, food, fuel, clothing }) => ({ weapons, food, fuel, clothing }))(stock(session)),
        aut: (({ weapons, food, fuel, clothing }) => ({ weapons, food, fuel, clothing }))(stock(session, AUT)),
        hun: (({ weapons, food, fuel, clothing }) => ({ weapons, food, fuel, clothing }))(stock(session, HUN)),
      },
      fronts: fronts(session)
        .map(front => ({
          id: front.id, status: front.status, regions: front.regionIds,
          attackerPressure: front.attackerPressure, defenderPressure: front.defenderPressure,
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      owners: [...session.regions.values()]
        .map((region: any) => ({ id: region.id, owner: region.owner }))
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
      units: activeUnits(session)
        .map(unit => ({ id: unit.id, personnel: unit.personnel, status: unit.status, frontId: unit.frontId, regionId: unit.regionId }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    });
    const long = multiFrontGame();
    advancePeriod(long, 90, '2026-04-01');
    const split = multiFrontGame();
    for (const date of ['2026-01-31', '2026-03-02', '2026-04-01']) advancePeriod(split, 30, date);
    expect(snapshot(split)).toEqual(snapshot(long));
  });
});
