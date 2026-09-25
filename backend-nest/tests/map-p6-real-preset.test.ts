/**
 * MAP P6.2 — `modern_world_provinces` è il preset reale **canonical-assets ready**
 * ============================================================================
 * Fino a P6.1 questo file provava l'opposto: che il preset moderno *non* avesse
 * un catalogo e che l'endpoint rispondesse `canonical: false`. Dopo P6.2 la
 * prova è invertita, perché il vertical slice authored esiste e deve restare
 * verificabile contro la mappa **reale** del preset.
 *
 * Contratto degli id di regione (verificato, non assunto):
 *  - `map.geojson:properties.code` è il codice autorevole della regione del
 *    preset (es. `USTX`), ed è l'unica chiave che il catalogo nomina;
 *  - il mondo persistito espone la stessa regione come `<worldId>_<codice>`
 *    (`worlds.routes`: `id: ${worldId}_${code}`);
 *  - il catalogo dichiara il binding in `manifest.regionIdBinding` e la
 *    risoluzione è una **costruzione di id**, mai una somiglianza fra stringhe.
 *
 * Qui si prova l'intera pipeline reale:
 *   `modern_world_provinces → SimulationCatalog → initialState → WorldMapAssets
 *    → GET /map-assets` con array realmente popolati e regioni realmente esistenti.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SimulationCatalog } from '../src/scenario/types';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapp62-real-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const PRESET = 'modern_world_provinces';
const PRESET_DIR = path.join(process.cwd(), 'data', 'presets', PRESET);
const WORLD = 'mapp62realworld';

let db: any;
let registry: any;
let gamesRouter: any;
let catalog: SimulationCatalog;
let presetRegionCodes: Set<string>;

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
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;

  const loaded = (await import('../src/scenario/loader')).loadSimulationCatalog(PRESET_DIR);
  if (!loaded.catalog) throw new Error(`catalogo assente: ${JSON.stringify(loaded.report.errors)}`);
  catalog = loaded.catalog;

  // Spazio id delle regioni **derivato dalla mappa del preset** con le stesse
  // funzioni pure usate da `worlds.routes` (partition + livello di dettaglio +
  // raggruppamento): se un codice viene rinominato nella mappa, questo insieme
  // cambia e i test di binding sotto falliscono.
  const { partitionMapFeatures } = await import('../src/utils/map-polities');
  const { deriveGroups, resolveMapDetail } = await import('../src/utils/map-detail');
  const preset = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'preset.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'map.geojson'), 'utf8'));
  const { provinceFeaturesByCountry } = partitionMapFeatures(map.features);
  const hasProvinceMap = Object.values(provinceFeaturesByCountry).some(list => list.length > 0);
  const mapDetail = resolveMapDetail(preset.map_detail, hasProvinceMap);
  presetRegionCodes = new Set<string>();
  for (const [country, features] of Object.entries(provinceFeaturesByCountry)) {
    for (const group of deriveGroups(features, mapDetail, { owner: country, countryName: country })) {
      presetRegionCodes.add(group.code);
    }
  }

  // Mondo reale: le regioni hanno ESATTAMENTE lo spazio id del binding. Si
  // persistono le sole regioni nominate dal catalogo (la completezza dello
  // spazio id rispetto alla mappa è provata sopra, in modo puro): il binding è
  // comunque esercitato per intero e ogni id pubblicato resta verificato.
  const codes = [...new Set([...catalog.initialState.deposits, ...catalog.initialState.facilities]
    .map(asset => asset.regionId))];
  repos.worldRepository.createWithRegions(
    { id: WORLD, name: 'Mondo moderno', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.85, templateId: PRESET },
    codes.map(code => ({
      id: `${WORLD}_${code}`, name: code, color: '#4488aa', owner: code.slice(0, 3).toUpperCase(),
      population: 1_000_000, gdp: 500, militaryPower: 10, flag: code, borders: [], objects: [],
    })),
  );
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  } catch { /* tmp */ }
});

const callGetRoute = (routePath: string, params: Record<string, string>) => {
  const layer = gamesRouter.stack.find((item: any) => item.route?.path === routePath && item.route.methods.get);
  if (!layer) throw new Error(`route missing: ${routePath}`);
  let response: { status: number; body: any } | null = null;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { response = { status: this.statusCode, body: payload }; return this; },
  };
  layer.route.stack[0].handle({ method: 'GET', params }, res);
  if (!response) throw new Error(`route did not respond: ${routePath}`);
  return response as { status: number; body: any };
};

// Una sola partita per file: la sessione carica le regioni del mondo e non
// serve crearne una per asserzione.
let gameId: string | null = null;
const newGame = () => (gameId ??= registry.createSession(WORLD, 'Player', `${WORLD}_USTX`, '#FF0000').gameId);
const assetsOf = (id: string) => callGetRoute('/:id/map-assets', { id }).body;

describe('MAP P6.2 — catalogo authored del preset reale', () => {
  it('il vertice del catalogo è valido: nessun errore, solo ignoranza dichiarata', async () => {
    const { report } = (await import('../src/scenario/loader')).loadSimulationCatalog(PRESET_DIR);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    // L'unico segnale ammesso è la quantità non determinata: nessuna stima inventata.
    expect([...new Set(report.warnings.map(item => item.code))]).toEqual(['unknown_quantity']);
    expect(report.warnings.length).toBe(report.coverage.unknownDeposits);
    expect(catalog.manifest.mode).toBe('authored');
    expect(catalog.manifest.regionIdBinding).toEqual({ space: 'world_scoped', source: 'map.geojson:properties.code' });
  });

  it('il vertical slice copre 3 risorse, 3 tipi di impianto e più paesi', () => {
    expect(catalog.resources.map(resource => resource.id).sort()).toEqual(['coal', 'crude_oil', 'iron_ore']);
    expect([...new Set(catalog.facilityTypes.map(type => type.id))].sort()).toEqual(['coal_power_plant', 'refinery', 'steel_plant']);
    const depositCountries = new Set(catalog.initialState.deposits.map(deposit => deposit.regionId.slice(0, 2)));
    const facilityCountries = new Set(catalog.initialState.facilities.map(facility => facility.regionId.slice(0, 2)));
    expect(depositCountries.size).toBeGreaterThanOrEqual(3);
    expect(facilityCountries.size).toBeGreaterThanOrEqual(3);
    expect(catalog.initialState.deposits.length).toBeGreaterThanOrEqual(6);
    expect(catalog.initialState.facilities.length).toBeGreaterThanOrEqual(6);
  });

  it('la proprietà economica è distinta dal territorio in almeno un impianto', () => {
    const foreign = catalog.initialState.facilities.filter(facility => {
      const owner = catalog.actors.find(actor => actor.actorId === facility.ownerActorId);
      const controller = catalog.actors.find(actor => actor.actorId === facility.controllerActorId);
      return Boolean(owner && controller) && (owner!.polityId !== controller!.polityId
        || owner!.polityId !== facility.regionId.slice(0, 2));
    });
    expect(foreign.length).toBeGreaterThanOrEqual(1);
    expect(foreign.some(facility => facility.ownerActorId !== facility.controllerActorId)).toBe(true);
  });

  it('ogni attore referenziato esiste, con la polity dichiarata', () => {
    const actorIds = new Set(catalog.actors.map(actor => actor.actorId));
    const polityIds = new Set(catalog.polities.map(polity => polity.id));
    for (const facility of catalog.initialState.facilities) {
      expect(actorIds.has(facility.ownerActorId), facility.id).toBe(true);
      expect(actorIds.has(facility.controllerActorId), facility.id).toBe(true);
    }
    for (const actor of catalog.actors) expect(polityIds.has(actor.polityId), actor.actorId).toBe(true);
  });

  it('nessuna quantità inventata: `known` è null su ogni giacimento', () => {
    for (const deposit of catalog.initialState.deposits) {
      expect(deposit.known, deposit.id).toBeNull();
      expect(deposit.estimated, deposit.id).toBeUndefined();
    }
  });
});

describe('MAP P6.2 — binding regioni: nessun asset orfano', () => {
  it('ogni regione nominata dal catalogo esiste nella mappa del preset', () => {
    expect(presetRegionCodes.size).toBeGreaterThan(900);
    for (const deposit of catalog.initialState.deposits) {
      expect(presetRegionCodes.has(deposit.regionId), deposit.id).toBe(true);
    }
    for (const facility of catalog.initialState.facilities) {
      expect(presetRegionCodes.has(facility.regionId), facility.id).toBe(true);
    }
  });

  it('l’endpoint pubblica **tutti** gli asset dichiarati tranne gli hidden: nulla è scartato in silenzio', () => {
    const body = assetsOf(newGame());
    const hidden = catalog.initialState.deposits.filter(deposit => deposit.accessibility === 'hidden');
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    expect(body.canonical).toBe(true);
    expect(body.resources.length).toBe(catalog.initialState.deposits.length - hidden.length);
    expect(body.facilities.length).toBe(catalog.initialState.facilities.length);
    // Il binding è portante: senza prefisso del mondo nulla combacerebbe.
    expect(body.resources.length).toBeGreaterThan(0);
    expect(body.facilities.length).toBeGreaterThan(0);
  });

  it('ogni `regionId` pubblicato esiste davvero nel mondo ed è un id del mondo', async () => {
    const repos = await import('../src/repositories');
    const body = assetsOf(newGame());
    const worldRegions = new Set(repos.worldRepository.regionIds(WORLD));
    for (const site of [...body.resources, ...body.facilities]) {
      expect(worldRegions.has(site.regionId), site.id).toBe(true);
      expect(site.regionId.startsWith(`${WORLD}_`)).toBe(true);
    }
  });

  it('una regione rinominata **esclude** l’asset, non lo sposta: mai geografia dedotta', async () => {
    const { buildWorldMapAssets } = await import('../src/game/WorldMapAssets');
    const renamed = new Set([...presetRegionCodes]
      .filter(code => code !== 'USTX')
      .map(code => `${WORLD}_${code}`));
    const body = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds: renamed });
    expect(body.resources.map(site => site.id)).not.toContain('deposit:USTX:crude_oil:1');
    // Nessun riposizionamento: gli altri restano dove sono.
    expect(body.resources.map(site => site.id)).toContain('deposit:SA04:crude_oil:1');
    expect(body.resources.length).toBe(catalog.initialState.deposits.length - 1 - 1); // hidden + rinominata
  });

  it('senza `regionIdBinding` il catalogo non indovina: nessun asset pubblicato', async () => {
    const { buildWorldMapAssets } = await import('../src/game/WorldMapAssets');
    const withoutBinding: SimulationCatalog = {
      ...catalog,
      manifest: { ...catalog.manifest, regionIdBinding: undefined },
    };
    const body = buildWorldMapAssets({
      catalog: withoutBinding, worldId: WORLD,
      worldRegionIds: new Set([...presetRegionCodes].map(code => `${WORLD}_${code}`)),
    });
    expect(body.resources).toEqual([]);
    expect(body.facilities).toEqual([]);
  });

  it('senza `worldId` un catalogo `world_scoped` non pubblica nulla', async () => {
    const { buildWorldMapAssets } = await import('../src/game/WorldMapAssets');
    const body = buildWorldMapAssets({
      catalog,
      worldRegionIds: new Set([...presetRegionCodes].map(code => `${WORLD}_${code}`)),
    });
    expect(body.resources).toEqual([]);
    expect(body.facilities).toEqual([]);
  });
});

describe('MAP P6.2 — endpoint su partita della mappa moderna', () => {
  it('`canonical: true` con risorse e impianti realmente popolati', () => {
    const response = callGetRoute('/:id/map-assets', { id: newGame() });
    expect(response.status).toBe(200);
    expect(response.body.canonical).toBe(true);
    expect(response.body.resources.length).toBeGreaterThan(0);
    expect(response.body.facilities.length).toBeGreaterThan(0);
    const coal = response.body.resources.find((site: any) => site.id === 'deposit:ZANW:coal:1');
    expect(coal).toMatchObject({ resourceId: 'coal', resourceName: 'Carbone', known: false, knownQuantity: null });
  });

  it('proprietà ≠ territorio ≠ controllo restano tre fatti distinti', () => {
    const body = assetsOf(newGame());
    const foreign = body.facilities.find((site: any) => site.id === 'facility:NLNH:refinery:1');
    expect(foreign).toMatchObject({
      regionId: `${WORLD}_NLNH`, ownerActorId: 'usa_gulf_refining', ownerActorName: 'Raffinazione privata (USA)',
      controllerActorId: 'nld_port_energy', polityId: 'USA', controllerPolityId: 'NLD',
    });
    // La regione è dei Paesi Bassi: il marker non riscrive la politica territoriale.
    expect(foreign.regionId).toBe(`${WORLD}_NLNH`);
    expect(foreign.polityId).not.toBe('NLD');
  });

  it('un impianto canonico non operativo è pubblicato con `operational: false`', () => {
    const body = assetsOf(newGame());
    const stopped = body.facilities.find((site: any) => site.id === 'facility:NLNH:refinery:2');
    expect(stopped).toBeTruthy();
    expect(stopped.operational).toBe(false);
    // Resta pubblicato: non viene nascosto, viene classificato.
    expect(body.facilities.filter((site: any) => site.operational === false).length).toBe(
      catalog.initialState.facilities.filter(facility => facility.operational === false).length,
    );
  });

  it('il giacimento `hidden` non viene pubblicato (il motore non lo rende estraibile)', () => {
    const body = assetsOf(newGame());
    expect(body.resources.map((site: any) => site.id)).not.toContain('deposit:RUSA:crude_oil:1');
    expect(catalog.initialState.deposits.find(deposit => deposit.id === 'deposit:RUSA:crude_oil:1')?.accessibility).toBe('hidden');
  });

  it('la pubblicazione canonica dipende dal catalogo, non dalla modalità economica', async () => {
    const repos = await import('../src/repositories');
    const id = newGame();
    // Il vertical slice è `authored`: la partita resta `legacy` e il motore
    // economico non cambia. Il layer di lettura della mappa pubblica comunque i
    // dati canonici, perché la loro autorevolezza viene dal catalogo validato.
    expect(repos.gameRepository.getEconomyMode(id)).toBe('legacy');
    expect(assetsOf(id).canonical).toBe(true);
    expect(assetsOf(id).resources.length).toBeGreaterThan(0);
  });

  it('due GET identiche non materializzano stato NPC né scrivono', async () => {
    newGame();
    const before = db.prepare('SELECT COUNT(*) AS n FROM game_operational_objects').get().n;
    const first = assetsOf(gameId);
    const second = assetsOf(gameId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(db.prepare('SELECT COUNT(*) AS n FROM game_operational_objects').get().n).toBe(before);
  });

  it('gli altri preset reali restano non migrati: dichiarato, non silenzioso', async () => {
    const { loadSimulationCatalog } = await import('../src/scenario/loader');
    // P01 — `mondo_1989`, `europa_1815` e il preset `paxh_ww2_provinces` sono stati
    // eliminati (mondi non provinciali): restano i preset reali **senza catalogo**
    // (`simulation/`). `millennium_dawn` e `modern_world_provinces` hanno il loro
    // catalogo e sono verificati altrove: metterli qui asserirebbe il falso.
    for (const preset of ['mondo_1936', 'europa_1914', 'pax_modern_provinces']) {
      const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', preset));
      expect(loaded.catalog, preset).toBeNull();
      expect(loaded.report.warnings.map(item => item.code), preset).toContain('no_catalog');
      expect(loaded.report.ok, preset).toBe(true);
    }
  });
});
