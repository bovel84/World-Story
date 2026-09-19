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

const TEST_DB = path.join(os.tmpdir(), `world-story-integrity-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'integrity_world';
const PID = 'ITA';
const AUT = 'AUT';

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
const cleanAccount = (session: any) => ({
  ...session.sessionAccounts()[PID],
  population: 0, factories: 0, ports: 0, universities: 0, monthlyBalance: 0, forces: 0, mobilized: 0,
});

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
