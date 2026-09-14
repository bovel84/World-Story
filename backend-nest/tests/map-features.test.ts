/**
 * Интеграционные тесты Этапа 4 — map features (с заглушкой LLM):
 *   (1) objects регионов переживают «перезапуск» сервера
 *       (syncRegionsToDB → новая registry → reloadActiveSessions);
 *   (2) spawn_battalion из ответа симуляции создаёт объект типа 'battalion'
 *       с lat/lng в регионе и персистит его в БД;
 *   (3) move_battalion перемещает батальон в целевой регион —
 *       по имени, а при наличии id — по id (id приоритетнее).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapfeat-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: any;
let getSessionRegistry: any;

const WORLD_ID = 'mapfeat_world';

/** Простая квадратная геометрия [lng, lat] — границы центроида легко проверить. */
function squareGeojson(lng1: number, lat1: number, lng2: number, lat2: number): string {
  return JSON.stringify({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[lng1, lat1], [lng2, lat1], [lng2, lat2], [lng1, lat2], [lng1, lat1]]],
    },
  });
}

/** Ответ заглушки на механику jump: одно событие со spawn_battalion. */
function jumpResponse(): any {
  return {
    events: [
      {
        headline: 'Сформирован новый батальон',
        description: 'Мобилизация завершена.',
        date: '1951-02-01',
        mapChanges: [
          { type: 'spawn_battalion', regionName: 'ФРГ', feature: { type: 'battalion', name: '1-й гвардейский' } },
        ],
      },
    ],
    narration: 'Армия усилена.',
    voided: [],
    startChat: [],
    worldChanges: { regionOwners: {}, regionColors: {} },
  };
}

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string, _system: string, _user: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Действие игрока' }) };
    }
    if (mechanic === 'consolidation') {
      return { content: 'КОНСПЕКТ: сжатая история первых раундов' };
    }
    if (mechanic === 'jump') {
      return { content: JSON.stringify(jumpResponse()) };
    }
    return { content: JSON.stringify({ type: 'develop', description: 'Развитие', priority: 5 }) };
  },
  async stream(mechanic: string, system: string, user: string, onToken: (chars: number) => void, options?: any) {
    const r = await this.generate(mechanic, system, user, options);
    onToken(r.content.length);
    return r;
  },
  clearCache() {},
};

function createGame(): { gameId: string; session: any } {
  return getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}_DEU`, '#FF0000');
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);

  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();

  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  gameRepository = repos.gameRepository;

  const registryModule = await import('../src/session-registry');
  initSessionRegistry = registryModule.initSessionRegistry;
  getSessionRegistry = registryModule.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'MapFeat World', description: '', startDate: '1951-01-01', basePrompt: 'Тестовый лор', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_DEU`, name: 'ФРГ', color: '#FF0000', owner: 'DEU',
        population: 5000000, gdp: 200, militaryPower: 300, flag: 'DEU',
        geojson: squareGeojson(10, 40, 20, 50),
        // Сидированный объект: заодно проверяет, что addRegion персистит objects
        objects: [{ id: 'obj_seed_city', type: 'city', name: 'Кёльн', lat: 50.9, lng: 6.9 }],
      },
      {
        id: `${WORLD_ID}_POL`, name: 'Польша', color: '#00FF00', owner: 'POL',
        population: 3000000, gdp: 100, militaryPower: 100, flag: 'POL',
        geojson: squareGeojson(30, 40, 40, 50),
      },
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#0000FF', owner: 'ITA',
        population: 2000000, gdp: 100, militaryPower: 100, flag: 'ITA',
        geojson: squareGeojson(10, 30, 20, 40),
      },
    ]
  );

  initSessionRegistry(stubProvider);
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

describe('Этап 4: персистентность map features', () => {
  it('creates an explicitly completed facility once and persists its coordinates', async () => {
    const { gameId, session } = createGame();
    const change = { type: 'build_facility', regionName: 'ФРГ', feature: { type: 'factory', name: 'Impianto pilota' } };
    session.applyMapChanges([change, change]);
    const facilities = session.getRegion(`${WORLD_ID}_DEU`).objects.filter((o: any) => o.name === 'Impianto pilota');
    expect(facilities).toHaveLength(1);
    expect(facilities[0]).toMatchObject({ type: 'factory', level: 1 });
    expect(facilities[0].lng).toBeGreaterThanOrEqual(10);
    expect(facilities[0].lng).toBeLessThanOrEqual(20);
    await session.syncRegionsToDB();
    const persisted = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_DEU`);
    expect(persisted.objects).toContainEqual(facilities[0]);
  });

  it('rejects facility events with an unsupported type or a random destination', () => {
    const { session } = createGame();
    const before = JSON.stringify(session.getRegion(`${WORLD_ID}_DEU`).objects);
    session.applyMapChanges([
      { type: 'build_facility', regionName: 'random', feature: { type: 'factory', name: 'Invalid' } },
      { type: 'build_facility', regionName: 'ФРГ', feature: { type: 'city', name: 'Invalid' } },
    ]);
    expect(JSON.stringify(session.getRegion(`${WORLD_ID}_DEU`).objects)).toBe(before);
  });

  it('objects переживают «рестарт»: sync → новая registry → reloadActiveSessions', async () => {
    const { gameId, session } = createGame();

    // Сидированный при создании мира объект доехал до сессии (addRegion → getRegions)
    const seeded = session.getRegion(`${WORLD_ID}_DEU`).objects.find((o: any) => o.id === 'obj_seed_city');
    expect(seeded).toBeDefined();
    expect(seeded.type).toBe('city');

    // Кладём в регион новый маркер (как это делают mapChanges хода)
    const marker = { id: 'obj_capital_deu', type: 'capital', name: 'Бонн', lat: 50.7, lng: 7.1 };
    session.getRegion(`${WORLD_ID}_DEU`).objects.push(marker);
    await session.syncRegionsToDB();

    // Объект записан в БД (раньше updateRegionsBatch игнорировал objects)
    const dbRegion = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_DEU`);
    expect(dbRegion.objects.some((o: any) => o.id === 'obj_capital_deu')).toBe(true);

    // «Перезапуск сервера»: новая registry (пустой кэш сессий) + восстановление из БД
    initSessionRegistry(stubProvider);
    getSessionRegistry().reloadActiveSessions();

    const restored = getSessionRegistry().getSession(gameId);
    expect(restored).not.toBeNull();
    const obj = restored.getRegion(`${WORLD_ID}_DEU`).objects.find((o: any) => o.id === 'obj_capital_deu');
    expect(obj).toBeDefined();
    expect(obj.type).toBe('capital');
    expect(obj.name).toBe('Бонн');
    expect(obj.lat).toBeCloseTo(50.7);
    expect(obj.lng).toBeCloseTo(7.1);
  });

  it('spawn_battalion из ответа симуляции создаёт объект battalion с lat/lng и персистит его', async () => {
    const { gameId, session } = createGame();

    session.queueAction('Сформировать новый батальон');
    const action = await session.processNextAction(31); // Jan 1 → Feb 1, the event date
    expect(action.status).toBe('completed');

    const region = session.getRegion(`${WORLD_ID}_DEU`);
    const battalion = region.objects.find((o: any) => o.type === 'battalion');
    expect(battalion).toBeDefined();
    expect(battalion.name).toBe('1-й гвардейский');
    expect(typeof battalion.lat).toBe('number');
    expect(typeof battalion.lng).toBe('number');
    // Координаты — центроид квадрата ФРГ (lng 10..20, lat 40..50)
    expect(battalion.lng).toBeGreaterThanOrEqual(10);
    expect(battalion.lng).toBeLessThanOrEqual(20);
    expect(battalion.lat).toBeGreaterThanOrEqual(40);
    expect(battalion.lat).toBeLessThanOrEqual(50);

    // Персистенс: батальон доехал до БД
    const dbRegion = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_DEU`);
    expect(dbRegion.objects.some((o: any) => o.type === 'battalion' && o.name === '1-й гвардейский')).toBe(true);
  });

  it('move_battalion перемещает батальон в целевой регион по имени, id приоритетнее имени', async () => {
    const { gameId, session } = createGame();

    (session as any).applyMapChanges([
      { type: 'spawn_battalion', regionName: 'ФРГ', feature: { type: 'battalion', name: '2-й танковый' } },
    ]);
    const deu = session.getRegion(`${WORLD_ID}_DEU`);
    const spawned = deu.objects.find((o: any) => o.name === '2-й танковый');
    expect(spawned).toBeDefined();
    expect(spawned.type).toBe('battalion');

    // Перемещение ПО ИМЕИ батальона (id не передан)
    (session as any).applyMapChanges([
      { type: 'move_battalion', regionName: 'ФРГ', targetRegionName: 'Польша', feature: { type: 'battalion', name: '2-й танковый' } },
    ]);
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects.some((o: any) => o.name === '2-й танковый')).toBe(false);
    const pol = session.getRegion(`${WORLD_ID}_POL`);
    const moved = pol.objects.find((o: any) => o.name === '2-й танковый');
    expect(moved).toBeDefined();
    expect(moved.type).toBe('battalion');
    // Тот же объект, а не пересозданный
    expect(moved.id).toBe(spawned.id);
    // Координаты обновились под центроид Польши (lng 30..40, lat 40..50)
    expect(moved.lng).toBeGreaterThanOrEqual(30);
    expect(moved.lng).toBeLessThanOrEqual(40);
    expect(moved.lat).toBeGreaterThanOrEqual(40);
    expect(moved.lat).toBeLessThanOrEqual(50);

    // Обратно — ПО ID (имя заведомо неверное: id должен победить)
    (session as any).applyMapChanges([
      { type: 'move_battalion', regionName: 'Польша', targetRegionName: 'ФРГ', feature: { type: 'battalion', id: spawned.id, name: 'несуществующее имя' } },
    ]);
    expect(session.getRegion(`${WORLD_ID}_POL`).objects.some((o: any) => o.name === '2-й танковый')).toBe(false);
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects.some((o: any) => o.id === spawned.id)).toBe(true);

    // Персистенс перемещения
    await session.syncRegionsToDB();
    const dbDeu = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_DEU`);
    const dbPol = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_POL`);
    expect(dbDeu.objects.some((o: any) => o.id === spawned.id)).toBe(true);
    expect(dbPol.objects.some((o: any) => o.id === spawned.id)).toBe(false);
  });

  it('le iniziative NPC creano marker attribuiti alla politia che agisce', () => {
    const { session } = createGame();
    session.applyMapChanges([
      { type: 'start_mobilization', regionName: 'Польша', feature: { type: 'fleet', name: 'Flotta baltica' } },
      { type: 'start_construction', regionName: 'Польша', feature: { type: 'naval_base', name: 'Base di Gdynia' } },
    ]);
    const pol = session.getRegion(`${WORLD_ID}_POL`);
    const fleet = pol.objects.find((o: any) => o.name === 'Flotta baltica');
    expect(fleet).toMatchObject({ type: 'mobilization', owner: 'POL', metadata: { plannedType: 'fleet', status: 'forming' } });
    const site = pol.objects.find((o: any) => o.name === 'Base di Gdynia');
    expect(site).toMatchObject({ type: 'construction_site', owner: 'POL', metadata: { plannedType: 'naval_base', status: 'under_construction' } });

    // Il completamento conserva l'attribuzione e non dipende dal giocatore.
    session.applyMapChanges([
      { type: 'complete_mobilization', regionName: 'Польша', feature: { type: 'fleet', name: 'Flotta baltica' } },
      { type: 'complete_construction', regionName: 'Польша', feature: { type: 'naval_base', name: 'Base di Gdynia' } },
    ]);
    expect(pol.objects.find((o: any) => o.type === 'fleet' && o.name === 'Flotta baltica'))
      .toMatchObject({ owner: 'POL', metadata: { status: 'operational' } });
    expect(pol.objects.find((o: any) => o.type === 'naval_base' && o.name === 'Base di Gdynia'))
      .toMatchObject({ owner: 'POL', metadata: { status: 'operational' } });
  });

  it('rappresenta un cantiere e lo trasforma nella stessa fortificazione operativa', async () => {
    const { gameId, session } = createGame();

    session.applyMapChanges([{
      type: 'start_construction',
      regionName: 'ФРГ',
      feature: { type: 'fortification', name: 'Linea del Reno' },
    }]);
    const region = session.getRegion(`${WORLD_ID}_DEU`);
    const site = region.objects.find((object: any) => object.name === 'Linea del Reno');
    expect(site).toMatchObject({
      type: 'construction_site',
      owner: 'DEU',
      metadata: { status: 'under_construction', plannedType: 'fortification' },
    });

    session.applyMapChanges([{
      type: 'update_construction', regionName: 'ФРГ',
      feature: { type: 'fortification', id: site.id, name: 'Nome non autorevole', metadata: {
        phase: 'foundations', status: 'paused', blocker: 'Consegna dei materiali in ritardo',
        nextStep: 'Riprendere le fondazioni alla consegna', expectedDate: '1951-06-01',
        owner: 'POL', plannedType: 'army', progress: 99,
      } },
    }]);
    expect(region.objects.filter((object: any) => object.id === site.id)).toHaveLength(1);
    expect(site).toMatchObject({ type: 'construction_site', owner: 'DEU', metadata: {
      phase: 'foundations', status: 'paused', blocker: 'Consegna dei materiali in ritardo', plannedType: 'fortification',
    } });
    expect(site.metadata.progress).toBeUndefined();
    expect(site.metadata.owner).toBeUndefined();
    const unchanged = JSON.stringify(region.objects);
    session.applyMapChanges([{
      type: 'update_construction', regionName: 'ФРГ',
      feature: { type: 'fortification', id: 'missing-id', name: 'Linea del Reno', metadata: { phase: 'testing' } },
    }]);
    expect(JSON.stringify(region.objects)).toBe(unchanged);
    await session.syncRegionsToDB();
    const savedSite = gameRepository.getGameRegions(gameId).find((r: any) => r.id === region.id).objects.find((o: any) => o.id === site.id);
    expect(savedSite.metadata).toEqual(site.metadata);

    session.applyMapChanges([{
      type: 'complete_construction',
      regionName: 'ФРГ',
      feature: { type: 'fortification', name: 'Linea del Reno' },
    }]);
    const completed = region.objects.filter((object: any) => object.name === 'Linea del Reno');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      id: site.id,
      type: 'fortification',
      owner: 'DEU',
      metadata: { status: 'operational', phase: 'completed', blocker: '', nextStep: '' },
    });

    session.syncRegionsToDB();
    const persisted = gameRepository.getGameRegions(gameId).find((r: any) => r.id === `${WORLD_ID}_DEU`);
    expect(persisted.objects).toContainEqual(completed[0]);
  });

  it('crea, sposta e rimuove un esercito mantenendo la proprietà del contatore', () => {
    const { session } = createGame();

    session.applyMapChanges([{
      type: 'start_mobilization',
      regionName: 'ФРГ',
      feature: { type: 'army', name: 'I Armata' },
    }]);
    const source = session.getRegion(`${WORLD_ID}_DEU`);
    const forming = source.objects.find((object: any) => object.name === 'I Armata');
    expect(forming).toMatchObject({
      type: 'mobilization',
      owner: 'DEU',
      metadata: { status: 'forming', plannedType: 'army' },
    });

    session.applyMapChanges([{
      type: 'complete_mobilization',
      regionName: 'ФРГ',
      feature: { type: 'army', name: 'I Armata' },
    }, {
      // Un provider legacy può ripetere lo spawn nella stessa risposta: non
      // deve creare un secondo contatore sopra il primo.
      type: 'spawn_unit',
      regionName: 'ФРГ',
      feature: { type: 'army', name: 'I Armata' },
    }]);
    const army = source.objects.find((object: any) => object.name === 'I Armata');
    expect(source.objects.filter((object: any) => object.name === 'I Armata')).toHaveLength(1);
    expect(army).toMatchObject({ id: forming.id, type: 'army', owner: 'DEU', metadata: { status: 'operational' } });

    session.applyMapChanges([{
      type: 'move_unit',
      regionName: 'ФРГ',
      targetRegionName: 'Польша',
      feature: { type: 'army', id: army.id, name: 'I Armata' },
    }]);
    const target = session.getRegion(`${WORLD_ID}_POL`);
    expect(source.objects.some((object: any) => object.id === army.id)).toBe(false);
    expect(target.objects.find((object: any) => object.id === army.id)).toMatchObject({
      type: 'army',
      owner: 'DEU',
      metadata: { previousRegionId: `${WORLD_ID}_DEU` },
    });

    session.applyMapChanges([{
      type: 'remove_unit',
      regionName: 'Польша',
      feature: { type: 'army', id: army.id, name: 'I Armata' },
    }]);
    expect(target.objects.some((object: any) => object.id === army.id)).toBe(false);
  });

  it("muove un'unità anche quando il modello confonde la provincia di origine", () => {
    const { session } = createGame();
    session.applyMapChanges([{
      type: 'spawn_unit',
      regionName: 'ФРГ',
      feature: { type: 'battalion', name: '3-й штурмовой' },
    }]);
    const unit = session.getRegion(`${WORLD_ID}_DEU`).objects.find((object: any) => object.name === '3-й штурмовой');
    expect(unit).toBeDefined();

    // Origine dichiarata SBAGLIATA (Польша), destinazione corretta: il motore
    // deve trovare l'unità dov'è davvero e spostarla comunque.
    session.applyMapChanges([{
      type: 'move_unit',
      regionName: 'Польша',
      targetRegionName: 'Польша',
      feature: { type: 'battalion', name: '3-й штурмовой' },
    }]);
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects.some((o: any) => o.name === '3-й штурмовой')).toBe(false);
    expect(session.getRegion(`${WORLD_ID}_POL`).objects.some((o: any) => o.name === '3-й штурмовой')).toBe(true);
  });

  it('una provincia occupata prende SEMPRE il colore della nazione che la controlla', () => {
    const { session } = createGame();
    const pol = session.getRegion(`${WORLD_ID}_POL`);
    const before = pol.color;
    // Il modello propone un colore sbagliato (quello del vecchio sovrano):
    // per una politia già nota vince il colore canonico del nuovo occupante.
    session.applyMapChanges([{ type: 'transfer', regionName: 'Польша', newOwner: 'DEU', newColor: before }]);
    expect(pol.owner).toBe('DEU');
    expect(pol.color).not.toBe(before);
    expect(pol.color).toBe(session.getRegion(`${WORLD_ID}_DEU`).color);
  });

  it('una nuova politia senza colore esplicito riceve comunque un colore stabile', () => {
    const { session } = createGame();
    const pol = session.getRegion(`${WORLD_ID}_POL`);
    const before = pol.color;
    session.applyMapChanges([{ type: 'transfer', regionName: 'Польша', newOwner: 'Repubblica di Varsavia' }]);
    expect(pol.owner).toBe('Repubblica di Varsavia');
    expect(pol.color).not.toBe(before);
    expect(pol.color).toMatch(/^#[0-9A-F]{6}$/);

    // Deterministico: un secondo trasferimento non cambia il colore.
    const first = pol.color;
    session.applyMapChanges([{ type: 'transfer', regionName: 'Польша', newOwner: 'Repubblica di Varsavia' }]);
    expect(pol.color).toBe(first);
  });

  it('completa un movimento accettato che il modello ha dimenticato nelle mapChanges', () => {
    const { session } = createGame();
    session.applyMapChanges([{
      type: 'spawn_unit',
      regionName: 'ФРГ',
      feature: { type: 'army', name: 'II Armata' },
    }]);
    const action = { id: 'ord-move-1', text: 'Ordina alla II Armata di spostarsi in Польша.' } as any;
    const accepted = [{ actionId: 'ord-move-1', action: '', status: 'accepted', summary: 'ok' } as any];
    const changed = (session as any).reconcileAcceptedMoves([action], accepted);
    expect(changed.map((region: any) => region.id).sort()).toEqual([`${WORLD_ID}_DEU`, `${WORLD_ID}_POL`].sort());
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects.some((o: any) => o.name === 'II Armata')).toBe(false);
    expect(session.getRegion(`${WORLD_ID}_POL`).objects.some((o: any) => o.name === 'II Armata')).toBe(true);

    // Un ordine respinto non muove nulla.
    session.applyMapChanges([{
      type: 'spawn_unit',
      regionName: 'ФРГ',
      feature: { type: 'army', name: 'III Armata' },
    }]);
    const rejectedAction = { id: 'ord-move-2', text: 'Ordina alla III Armata di spostarsi in Польша.' } as any;
    const rejected = [{ actionId: 'ord-move-2', action: '', status: 'rejected', summary: 'no' } as any];
    expect((session as any).reconcileAcceptedMoves([rejectedAction], rejected)).toEqual([]);
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects.some((o: any) => o.name === 'III Armata')).toBe(true);
  });
});

describe('movement order regressions', () => {
  function fixture() {
    const { session, gameId } = createGame();
    const source = session.getRegion(`${WORLD_ID}_DEU`);
    const target = session.getRegion(`${WORLD_ID}_POL`);
    const intermediate = session.getRegion(`${WORLD_ID}_ITA`);
    const add = (id: string, name: string, region = source, owner: string | undefined = 'DEU', type = 'army') => {
      const unit = { id, name, type, owner, lat: 42, lng: 12, metadata: { strength: 80 } };
      region.objects ||= [];
      region.objects.push(unit);
      return unit;
    };
    const unit = add('army-a', 'I Armata');
    const move = (extra: any = {}) => ({ type: 'move_unit', regionName: source.name,
      targetRegionName: target.name, feature: { type: 'army', name: unit.name, id: unit.id }, ...extra });
    const reconcile = (text: string, status = 'accepted') => session.reconcileAcceptedMoves(
      [{ id: 'order', text }], [{ actionId: 'order', action: text, status }]);
    return { session, gameId, source, target, intermediate, add, unit, move, reconcile };
  }

  it.each([undefined, 'Regione inesistente', 'Польша'])('locates a unique unit with origin %s and preserves route metadata on repeat', async regionName => {
    const { session, gameId, source, target, unit, move } = fixture();
    const changed = session.applyMapChanges([move({ regionName })], '1951-02-01');
    expect(changed.map((r: any) => r.id)).toEqual([source.id, target.id]);
    expect(target.objects).toContain(unit);
    expect(unit).toMatchObject({ owner: 'DEU', metadata: { strength: 80, previousLng: 12, previousLat: 42,
      previousRegionId: source.id, previousRegionName: source.name, movedDate: '1951-02-01' } });
    const before = JSON.stringify(unit);
    expect(session.applyMapChanges([move()], '1951-03-01')).toEqual([]);
    expect(JSON.stringify(unit)).toBe(before);
    await session.syncRegionsToDB();
    const saved = gameRepository.getGameRegions(gameId).find((r: any) => r.id === target.id);
    expect(saved.objects.find((o: any) => o.id === unit.id)).toEqual(unit);
  });

  it.each(['random', 'coastal', 'Польша sconosciuta'])('never guesses a destination from %s', targetRegionName => {
    const { session, source, unit, move } = fixture();
    expect(session.applyMapChanges([move({ targetRegionName })])).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('risolve un troncamento univoco ma rifiuta un prefisso ambiguo', () => {
    const { session, source, target, intermediate, unit, move, add } = fixture();
    // "Поль" è un troncamento univoco di Польша: si risolve.
    expect(session.applyMapChanges([move({ targetRegionName: 'Поль' })]).map((r: any) => r.id)).toEqual([source.id, target.id]);
    // Con due province che condividono il prefisso non si indovina più.
    intermediate.name = 'Польша Nord';
    const second = add('army-b', 'II Armata', source);
    expect(session.applyMapChanges([move({
      feature: { type: 'army', name: 'II Armata', id: 'army-b' }, targetRegionName: 'Поль',
    })])).toEqual([]);
    expect(source.objects).toContain(second);
    expect(unit).toBeDefined();
  });

  it('rejects ambiguous region names, unit names and duplicate IDs', () => {
    const { session, source, target, intermediate, unit, add, move } = fixture();
    intermediate.name = target.name;
    expect(session.applyMapChanges([move()])).toEqual([]);
    intermediate.name = 'Italia';
    const other = add('army-b', unit.name, intermediate);
    expect(session.applyMapChanges([move({ feature: { type: 'army', name: unit.name } })])).toEqual([]);
    other.id = unit.id;
    expect(session.applyMapChanges([move()])).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('an unknown ID cannot fall back to a name or the legacy first battalion', () => {
    const { session, source, unit, move } = fixture();
    expect(session.applyMapChanges([move({ feature: { type: 'army', id: 'missing', name: unit.name } })])).toEqual([]);
    unit.type = 'battalion';
    expect(session.applyMapChanges([move({ type: 'move_battalion', feature: { type: 'battalion', id: 'missing', name: unit.name } })])).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('only an unambiguous unnamed legacy battalion is allowed', () => {
    const { session, source, target, unit, add, move } = fixture();
    unit.type = 'battalion';
    const other = add('b', 'Other', source, 'DEU', 'battalion');
    expect(session.applyMapChanges([move({ type: 'move_battalion', feature: undefined })])).toEqual([]);
    source.objects = source.objects.filter((o: any) => o !== other);
    session.applyMapChanges([move({ type: 'move_battalion', feature: undefined })]);
    expect(target.objects).toContain(unit);
  });

  it('moves multiple explicitly named units without substring matches', () => {
    const { source, target, unit, add, reconcile } = fixture();
    const second = add('b', 'II Armata');
    const unrelated = add('c', 'III Armata');
    reconcile('Sposta I Armata e II Armata da ФРГ a Польша.');
    expect(target.objects).toEqual(expect.arrayContaining([unit, second]));
    expect(source.objects).toContain(unrelated);
  });

  it('uses object ownership for troops abroad and falls back to region owner only when absent', () => {
    const { source, target, intermediate, unit, add, reconcile } = fixture();
    source.objects = source.objects.filter((o: any) => o !== unit);
    intermediate.objects.push(unit);
    reconcile('Sposta I Armata da Italia a Польша');
    expect(target.objects).toContain(unit);
    const legacy = add('legacy', 'Guardia');
    delete (legacy as any).owner;
    const enemy = add('enemy', 'Nemici', source, 'POL');
    const facility = add('factory', 'Fabbrica', source, 'DEU', 'factory');
    const forming = add('forming', 'Reclute', source, 'DEU', 'mobilization');
    reconcile('Sposta tutte le truppe da ФРГ a Польша');
    expect(target.objects).toContain(legacy);
    expect(legacy.owner).toBe('DEU');
    // Anche una formazione in costituzione è una truppa: si sposta col resto.
    expect(target.objects).toContain(forming);
    expect(source.objects).toEqual(expect.arrayContaining([enemy, facility]));
    expect(reconcile('Sposta Nemici da ФРГ a Польша')).toEqual([]);
  });

  it('esegue l\'ordine reale: nome generico del reparto e regione citata tronca', () => {
    const { session, source, intermediate, add, reconcile } = fixture();
    source.name = 'Francistown';
    intermediate.name = 'Gwanda ZWE';
    const forming = add('mob-3', '3° Battaglione di Fanteria di Francistown', source, 'DEU', 'mobilization');
    forming.metadata = { plannedType: 'battalion', status: 'forming' };
    const action = { id: 'ord', text: 'sposta il battaglione verso il gwanda' };
    const changed = session.reconcileAcceptedMoves([action], [{ actionId: 'ord', status: 'accepted' }]);
    expect(changed.map((r: any) => r.id).sort()).toEqual([source.id, intermediate.id].sort());
    expect(intermediate.objects.some((o: any) => o.id === 'mob-3')).toBe(true);
    expect(source.objects.some((o: any) => o.id === 'mob-3')).toBe(false);
  });

  it('sposta una formazione in costituzione citata con il nome breve', () => {
    const { session, source, target, intermediate, add } = fixture();
    const forming = add('forming-3', '3° Battaglione di Fanteria di Francistown', source, 'DEU', 'mobilization');
    forming.metadata = { ...forming.metadata, plannedType: 'battalion', status: 'forming' };
    // Il modello cita un nome breve e una destinazione valida: il motore deve
    // trovare l'unità e spostarla, non ignorarla.
    session.applyMapChanges([{
      type: 'move_unit', regionName: source.name, targetRegionName: intermediate.name,
      feature: { type: 'battalion', name: '3° Battaglione' },
    }], '1951-02-01');
    expect(source.objects.some((o: any) => o.id === forming.id)).toBe(false);
    expect(intermediate.objects.find((o: any) => o.id === forming.id)).toMatchObject({
      type: 'mobilization', metadata: { plannedType: 'battalion', previousRegionId: source.id, movedDate: '1951-02-01' },
    });
  });

  it('riconcilia un ordine accettato che cita il nome breve del reparto', () => {
    const { session, source, target, add } = fixture();
    const forming = add('forming-3b', '3° Battaglione di Fanteria di Francistown', source, 'DEU', 'mobilization');
    forming.metadata = { ...forming.metadata, plannedType: 'battalion', status: 'forming' };
    const action = { id: 'order-short', text: 'sposta il 3 battaglione verso ' + target.name };
    const changed = session.reconcileAcceptedMoves([action], [{ actionId: action.id, status: 'accepted' }]);
    expect(changed.map((r: any) => r.id).sort()).toEqual([source.id, target.id].sort());
    expect(target.objects.some((o: any) => o.id === forming.id)).toBe(true);
  });

  it.each(['rejected', 'partial', 'pending', 'voided'])('does not execute %s outcomes', status => {
    const { source, unit, reconcile } = fixture();
    expect(reconcile('Sposta I Armata in Польша', status)).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it.each([
    'Non spostare I Armata in Польша',
    'Sposta I Armata in Польша (non ancora)',
    'Sposta I Armata in Польша oppure in Italia',
    'Se possibile sposta I Armata in Польша',
    'Prepara I Armata a spostarsi in Польша',
    'Sposta I Armata verso Польша e Italia',
    'Sposta I Armata da ФРГ',
    'Sposta tutte le truppe in Польша',
    'Sposta I Armata in una provincia sconosciuta',
    'Sposta I Armata in Italia orientale',
    'Sposta I Armata e Armata Fantasma in Польша',
    'Sposta I Armata e lascia II Armata in Польша',
  ])('does not infer ambiguous, conditional, pending or negated intent: %s', text => {
    const { source, unit, reconcile } = fixture();
    expect(reconcile(text)).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it.each(['army', 'fleet', 'missile'])('an accepted attack alone never relocates a %s in the real batch path', async type => {
    const { session, gameId, source, intermediate: target, unit } = fixture();
    unit.type = type;
    unit.name = { army: 'I Armata', fleet: 'I Flotta', missile: 'I Missile' }[type]!;
    const before = JSON.parse(JSON.stringify(unit));
    const action = session.queueAction(`Ordina alla ${unit.name} di attaccare in Italia`);
    vi.spyOn(session.gameController, 'processTurnWithPrompts').mockResolvedValue({
      events: [{ headline: 'Bombardamento', description: 'Attacco a distanza eseguito', date: '1951-01-10', mapChanges: [] }],
      narration: 'Ordine accettato', convertedActions: [],
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Attacco eseguito' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    });
    await session.processNextAction(31);
    expect(session.getRegion(source.id).objects.find((o: any) => o.id === unit.id)).toEqual(before);
    expect(session.getRegion(target.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
    const saved = gameRepository.getGameRegions(gameId);
    expect(saved.find((r: any) => r.id === source.id).objects.find((o: any) => o.id === unit.id)).toEqual(before);
    expect(saved.find((r: any) => r.id === target.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
  });

  it('conservatively skips mixed relocation and attack orders', () => {
    const { source, unit, reconcile } = fixture();
    expect(reconcile('Sposta I Armata in Italia e attacca in Italia')).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('never returns a unit to the origin on a repeated accepted order', () => {
    const { target, unit, reconcile } = fixture();
    const text = 'Sposta I Armata da ФРГ a Польша';
    reconcile(text);
    const metadata = { ...unit.metadata };
    expect(reconcile(text)).toEqual([]);
    expect(target.objects).toContain(unit);
    expect(unit.metadata).toEqual(metadata);
  });

  it('collective units can move from foreign territory but never take the local army along', () => {
    const { source, intermediate, unit, add, reconcile } = fixture();
    source.objects = source.objects.filter((o: any) => o !== unit);
    intermediate.objects.push(unit);
    const enemy = add('foreign', 'Guardia italiana', intermediate, 'ITA');
    reconcile('Sposta tutte le unità da Italia a ФРГ');
    expect(source.objects).toContain(unit);
    expect(intermediate.objects).toContain(enemy);
  });

  it('competing accepted destinations and explicit no-op movements are never overridden', () => {
    const { session, source, unit, move } = fixture();
    const actions = [{ id: 'a', text: 'Sposta I Armata in Польша' }, { id: 'b', text: 'Sposta I Armata in Italia' }];
    const outcomes = actions.map(action => ({ actionId: action.id, status: 'accepted' }));
    const intents = session.captureMovementIntents(actions);
    expect(session.reconcileAcceptedMoves(actions, outcomes, intents)).toEqual([]);
    expect(session.reconcileAcceptedMoves([actions[0]], [outcomes[0]], [intents[0]], [move({ targetRegionName: source.name })])).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('duplicate destination names also block natural-language reconciliation', () => {
    const { source, target, intermediate, unit, reconcile } = fixture();
    intermediate.name = target.name;
    expect(reconcile('Sposta I Armata in Польша')).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('duplicate formation names are ambiguous even when one belongs to the enemy', () => {
    const { source, target, unit, add, reconcile } = fixture();
    add('enemy', unit.name, target, 'POL');
    expect(reconcile('Sposta I Armata da ФРГ a Польша')).toEqual([]);
    expect(source.objects).toContain(unit);
  });

  it('outcome IDs are authoritative, conflicting or missing outcomes never authorize a move', () => {
    const { session, unit, source } = fixture();
    const action = { id: 'a', text: 'Sposta I Armata in Польша' };
    for (const outcomes of [[], [{ actionId: 'wrong', action: action.text, status: 'accepted' }],
      [{ actionId: 'a', status: 'accepted' }, { actionId: 'a', status: 'rejected' }]]) {
      expect(session.reconcileAcceptedMoves([action], outcomes)).toEqual([]);
    }
    expect(source.objects).toContain(unit);
    // Two different queued actions with the same text are not identifiable by text alone.
    expect(session.reconcileAcceptedMoves([action, { ...action, id: 'b' }], [{ action: action.text, status: 'accepted' }])).toEqual([]);
  });

  it('pre-event intents neither override partial advances nor move newly spawned replacements', () => {
    const { session, source, intermediate, unit, add, move } = fixture();
    const action = { id: 'a', text: 'Sposta I Armata in Польша' };
    const intents = session.captureMovementIntents([action]);
    const outcomes = [{ actionId: 'a', status: 'accepted' }];
    session.applyMapChanges([move({ targetRegionName: intermediate.name })]);
    expect(session.reconcileAcceptedMoves([action], outcomes, intents)).toEqual([]);
    expect(intermediate.objects).toContain(unit);
    session.applyMapChanges([move({ type: 'remove_unit', regionName: 'missing' })]);
    const replacement = add('replacement', unit.name);
    expect(session.reconcileAcceptedMoves([action], outcomes, intents)).toEqual([]);
    expect(source.objects).toContain(replacement);
  });

  it.each([false, true])('respects explicit partial model movement in the real batch/playback path (playback=%s)', async playback => {
    const { session, source, target, intermediate, unit, move } = fixture();
    const action = session.queueAction('Sposta I Armata da ФРГ a Польша');
    const events = [{ headline: 'Avanzata parziale', description: 'Avanzata in Italia', date: '1951-01-10',
      mapChanges: [move({ targetRegionName: intermediate.name })] }];
    if (playback) events.push({ headline: 'Rifornimenti', description: 'Le unità attendono rifornimenti', date: '1951-01-20', mapChanges: [] });
    vi.spyOn(session.gameController, 'processTurnWithPrompts').mockResolvedValue({
      events, narration: 'Ordine accettato', convertedActions: [], actionOutcomes: [{ actionId: action.id, action: action.text, status: 'accepted', summary: 'ok' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    });
    await session.processNextAction(31);
    if (playback) {
      const state = session._revivePausedRunState(JSON.parse(JSON.stringify(session.pausedRun)));
      expect(state.movementIntents).toHaveLength(1);
      expect(state.movementChanges).toHaveLength(1);
      session.pausedRun = state;
      while (session.pausedRun) await session.continueSimulation(state.runId);
    }
    expect(source.objects.some((o: any) => o.id === unit.id)).toBe(false);
    expect(target.objects.some((o: any) => o.id === unit.id)).toBe(false);
    expect(session.getRegion(intermediate.id).objects.find((o: any) => o.id === unit.id))
      .toMatchObject({ metadata: { movedDate: '1951-01-10', previousLng: 12, previousLat: 42 } });
  });

  it.each([false, true])('auto-jump never reconciles an arrival discarded after a preparation checkpoint (streaming=%s)', async streaming => {
    const { session, gameId, source, target, unit, move } = fixture();
    const before = JSON.parse(JSON.stringify(unit));
    const action = session.queueAction('Sposta I Armata da ФРГ a Польша');
    const events = [
      { headline: 'Preparativi', description: 'Le truppe si preparano alla partenza', date: '1951-01-10', mapChanges: [] },
      { headline: 'Arrivo', description: 'Le truppe raggiungono la destinazione', date: '1951-01-20', mapChanges: [move()] },
    ];
    vi.spyOn(session.gameController, 'processTurnWithPrompts').mockImplementation(async (...args: any[]) => {
      expect(args[4]).toBe(true);
      if (streaming) events.forEach((event, index) => args[5](event, index));
      return {
        // Streaming sanitization may already have removed the over-budget event.
        events: streaming ? events.slice(0, 1) : events,
        narration: 'Ordine eseguito', convertedActions: [], targetDate: '1951-01-20',
        actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Arrivo completato', eventHeadlines: ['Arrivo'] }],
        voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
      };
    });
    await session.processNextAction(0);
    expect(session.currentDate).toBe('1951-01-10');
    expect(session.pausedRun).toBeFalsy();
    expect(session.getRegion(source.id).objects.find((o: any) => o.id === unit.id)).toEqual(before);
    expect(session.getRegion(target.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
    const saved = gameRepository.getGameRegions(gameId);
    expect(saved.find((r: any) => r.id === source.id).objects.find((o: any) => o.id === unit.id)).toEqual(before);
    expect(saved.find((r: any) => r.id === target.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
  });

  it('an incomplete playback does not execute accepted future movements', async () => {
    const { session, source, target, unit } = fixture();
    const action = session.queueAction('Sposta I Armata da ФРГ a Польша');
    vi.spyOn(session.gameController, 'processTurnWithPrompts').mockResolvedValue({
      events: [
        { headline: 'Preparativi', description: 'Si discute', date: '1951-01-10', mapChanges: [] },
        { headline: 'Attesa', description: 'Non si avanza', date: '1951-01-20', mapChanges: [] },
      ], narration: '', convertedActions: [], incomplete: true,
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'ok' }], voided: [], startChat: [],
    });
    await session.processNextAction(31);
    while (session.pausedRun) await session.continueSimulation(session.pausedRun.runId);
    expect(session.getRegion(source.id).objects.some((o: any) => o.id === unit.id)).toBe(true);
    expect(session.getRegion(target.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
  });

  it.each([false, true])('reconciles omitted mapChanges in real batch/playback and persists both regions (playback=%s)', async playback => {
    const { session, gameId, source, target, unit } = fixture();
    const action = session.queueAction('Sposta I Armata da ФРГ a Польша');
    const events = [{ headline: 'Ordine eseguito', description: 'Le truppe avanzano', date: '1951-01-10', mapChanges: [] }];
    if (playback) events.push({ headline: 'Fine avanzata', description: 'Schieramento completato', date: '1951-01-20', mapChanges: [] });
    vi.spyOn(session.gameController, 'processTurnWithPrompts').mockResolvedValue({
      events, narration: 'Ordine accettato', convertedActions: [], actionOutcomes: [{ actionId: action.id, action: action.text, status: 'accepted', summary: 'ok' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    });
    await session.processNextAction(31);
    if (playback) while (session.pausedRun) await session.continueSimulation(session.pausedRun.runId);
    const saved = gameRepository.getGameRegions(gameId);
    expect(saved.find((r: any) => r.id === source.id).objects.some((o: any) => o.id === unit.id)).toBe(false);
    expect(saved.find((r: any) => r.id === target.id).objects.find((o: any) => o.id === unit.id))
      .toMatchObject({ owner: 'DEU', metadata: { movedDate: '1951-02-01', previousLng: 12, previousLat: 42 } });
  });

  it('il movimento consuma scorte e persiste la logistica nel magazzino materiale', async () => {
    const { session, gameId, source, target, unit, move } = fixture();
    const before = session.getResources().stock;
    expect(before.food).toBeGreaterThan(0);
    const changed = session.applyMapChanges([move()], '1951-02-01');
    expect(changed.map((r: any) => r.id)).toEqual([source.id, target.id]);
    const after = session.getResources().stock;
    expect(after.food).toBeLessThan(before.food);
    expect(after.money).toBeLessThan(before.money);
    // A piedi (nessuna tecnologia): niente carburante, movimento coperto.
    expect((unit as any).metadata.logistics).toMatchObject({ covered: true, motorized: false, fuel: 0 });
    const { resourceRepository } = await import('../src/repositories');
    expect(resourceRepository.get(gameId, 'DEU')?.stock).toEqual(after);
  });

  it('un salto di tempo fa maturare il magazzino e lo riporta nel bollettino', async () => {
    const { session, gameId } = fixture();
    const before = session.getResources().stock;
    await session.advanceDate(30);
    const after = session.getResources().stock;
    expect(after).not.toEqual(before);
    const { resourceRepository } = await import('../src/repositories');
    expect(resourceRepository.get(gameId, 'DEU')).not.toBeNull();
    const events = (session as any).results.at(-1).events as string[];
    expect(events.some(line => line.startsWith('🏭'))).toBe(true);
  });

  it('il magazzino nasce dai dati iniziali del mondo, non dallo stato corrente', async () => {
    const { session, gameId } = createGame();
    const { resourceRepository } = await import('../src/repositories');
    const { WorldStateEngine } = await import('../src/core/simulation/WorldStateEngine');
    const { seedStock } = await import('../src/core/simulation/MaterialEconomy');
    const { naturalResourcesFor } = await import('../src/core/simulation/MilitaryIndustry');
    // Il seed salvato coincide con quello calcolato dalle province INIZIALI
    // e dalle risorse naturali reali della nazione.
    const initial = seedStock(WorldStateEngine.accounts(worldRepository.getRegions(WORLD_ID))['DEU'], naturalResourcesFor('DEU'));
    expect(resourceRepository.get(gameId, 'DEU')?.stock).toEqual(initial);
    // Se lo stato corrente cambia (conquiste/crescita), il magazzino d'origine
    // resta quello dei dati di partenza.
    session.getRegion(`${WORLD_ID}_DEU`).population *= 100;
    session.getRegion(`${WORLD_ID}_DEU`).gdp *= 100;
    expect(resourceRepository.get(gameId, 'DEU')?.stock).toEqual(initial);
  });
});
