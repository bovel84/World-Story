/**
 * MAP P6 — geografia economica canonica mondiale
 * ==============================================
 * Il layer Resources di MAP P5 era player-scoped (quadro operativo `/arsenal`).
 * Qui si prova che il read model pubblica i giacimenti e gli impianti di **tutte**
 * le potenze leggendoli dal catalogo di scenario, con le regole che rendono la
 * geografia vera e non inventata:
 *
 *  - `polityId` deriva **solo** da `ownerActorId → actors[].polityId`
 *    (test con `region.owner` deliberatamente diverso dalla proprietà);
 *  - `hidden` non diventa pubblico; `known: null` resta ignoto, mai `0`;
 *  - `regionId` inesistente nel mondo → escluso (nessun sito orfano);
 *  - nessuna scrittura e nessun seed NPC durante la GET (endpoint chiamato due
 *    volte: la persistenza non cambia).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-mapp6-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

/** Regioni del mondo allineate agli id del catalogo `realism_test_world`. */
const WORLD = 'mapp6_world';
const R = { nord: 'ALPHA-nord', ovest: 'ALPHA-ovest', sud: 'ALPHA-sud', est: 'BETA-est' };
const REGIONI_MONDO = [R.nord, R.ovest, R.sud, R.est];

let db: any;
let registry: any;
let gamesRouter: any;
let buildWorldMapAssets: typeof import('../src/game/WorldMapAssets')['buildWorldMapAssets'];
let loadCatalog: () => any;

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
  buildWorldMapAssets = (await import('../src/game/WorldMapAssets')).buildWorldMapAssets;
  const loader = await import('../src/scenario/loader');
  loadCatalog = () => loader.loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog;

  // `region.owner` resta ALPHA/BETA per geografia politica: la proprietà
  // economica degli impianti arriva dagli attori del catalogo.
  repos.worldRepository.createWithRegions(
    { id: WORLD, name: 'MAP P6 World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8, templateId: 'realism_test_world' },
    [
      { id: R.nord, name: 'Alpina Nord', color: '#111', owner: 'GEO_OWNER', population: 1_000_000, gdp: 100, militaryPower: 10, flag: 'GEO_OWNER', borders: [], objects: [] },
      { id: R.ovest, name: 'Alpina Ovest', color: '#222', owner: 'GEO_OWNER', population: 1_000_000, gdp: 100, militaryPower: 10, flag: 'GEO_OWNER', borders: [], objects: [] },
      { id: R.sud, name: 'Alpina Sud', color: '#333', owner: 'GEO_OWNER', population: 1_000_000, gdp: 100, militaryPower: 10, flag: 'GEO_OWNER', borders: [], objects: [] },
      { id: R.est, name: 'Betania Est', color: '#444', owner: 'GEO_OWNER', population: 1_000_000, gdp: 100, militaryPower: 10, flag: 'GEO_OWNER', borders: [], objects: [] },
    ],
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

/** Invoca una GET sul router Express reale e cattura status/body. */
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
  return response;
};

const makeGame = (worldId = WORLD, regionId = R.nord) => registry.createSession(worldId, 'Player', regionId, '#FF0000').gameId;

describe('MAP P6 — read model puro', () => {
  it('pubblica i giacimenti canonici di tutte le potenze con la loro regionId', () => {
    const assets = buildWorldMapAssets({ catalog: loadCatalog(), worldRegionIds: new Set(REGIONI_MONDO) });
    expect(assets.canonical).toBe(true);
    const iron = assets.resources.find(site => site.id === 'dep_ore_alpha');
    expect(iron).toMatchObject({
      resourceId: 'iron_ore', resourceName: 'Minerale di ferro', regionId: 'ALPHA-nord',
      accessibility: 'requires_extraction', known: true,
    });
    // Il giacimento estero di BETA (`dep_ore_beta`) è `hidden` per il motore:
    // resta escluso. La geografia non è player-scoped sugli impianti esteri.
    expect(assets.facilities.map(site => site.regionId)).toContain('BETA-est');
  });

  it('`hidden` non viene pubblicato, `known: null` resta ignoto (mai zero)', () => {
    const catalog = loadCatalog();
    const hidden = catalog.initialState.deposits.find((d: any) => d.accessibility === 'hidden');
    expect(hidden).toBeTruthy();
    const assets = buildWorldMapAssets({ catalog, worldRegionIds: new Set(REGIONI_MONDO) });
    expect(assets.resources.map(site => site.id)).not.toContain(hidden.id);
    // Il dato ignoto non è un sito mancante: qui è nascosto per policy, ma il
    // contratto «ignoto ≠ assenza» si verifica sul giacimento pubblicato senza `known`.
    const unknown = { id: 'dep_unknown', resourceId: 'coal', regionId: R.ovest, known: null, accessibility: 'open' as const };
    const withUnknown = buildWorldMapAssets({
      catalog: { ...catalog, initialState: { ...catalog.initialState, deposits: [unknown] } },
      worldRegionIds: new Set(REGIONI_MONDO),
    });
    expect(withUnknown.resources).toHaveLength(1);
    expect(withUnknown.resources[0]).toMatchObject({ known: false, knownQuantity: null });
    expect(JSON.stringify(withUnknown.resources[0])).not.toContain('"0"');
  });

  it('`estimated` viene passato come dal catalogo', () => {
    const catalog = loadCatalog();
    const estimated = { ...catalog.initialState.deposits.find((d: any) => d.estimated), accessibility: 'open' as const };
    const assets = buildWorldMapAssets({
      catalog: { ...catalog, initialState: { ...catalog.initialState, deposits: [estimated] } },
      worldRegionIds: new Set([estimated.regionId]),
    });
    expect(assets.resources[0].estimated).toEqual(estimated.estimated);
  });

  it('`polityId` viene da `ownerActorId → actors.polityId`, mai da `region.owner`', () => {
    const assets = buildWorldMapAssets({ catalog: loadCatalog(), worldRegionIds: new Set(REGIONI_MONDO) });
    const mine = assets.facilities.find(site => site.id === 'fac_mine_alpha_1');
    expect(mine).toMatchObject({
      typeId: 'ft_mine', typeName: 'Miniera', regionId: 'ALPHA-nord',
      ownerActorId: 'alpha_steel_co', polityId: 'ALPHA', controllerPolityId: 'ALPHA',
      ownerActorName: 'Acciaierie pubbliche ALPHA',
    });
    // Il mondo dice `GEO_OWNER`: la proprietà economica non viene mai riscritta.
    const foreign = assets.facilities.find(site => site.id === 'fac_mine_beta_1');
    expect(foreign).toMatchObject({ polityId: 'BETA', controllerPolityId: 'BETA' });
    expect(assets.facilities.some(site => site.polityId === 'GEO_OWNER')).toBe(false);
  });

  it('proprietario e controllore diversi restano entrambi preservati', () => {
    const catalog = loadCatalog();
    const mixed = { id: 'fac_mixed', typeId: 'ft_mine', ownerActorId: 'beta_treasury', controllerActorId: 'alpha_steel_co', regionId: R.est, operational: true };
    const assets = buildWorldMapAssets({
      catalog: { ...catalog, initialState: { ...catalog.initialState, facilities: [mixed] } },
      worldRegionIds: new Set(REGIONI_MONDO),
    });
    expect(assets.facilities[0]).toMatchObject({
      ownerActorId: 'beta_treasury', ownerActorName: 'Tesoro di Betaland', polityId: 'BETA',
      controllerActorId: 'alpha_steel_co', controllerPolityId: 'ALPHA',
    });
  });

  it('typeName sconosciuto resta l’id tecnico; nessuna deduzione dal nome', () => {
    const catalog = loadCatalog();
    const unknownType = { id: 'fac_x', typeId: 'ft_unknown', ownerActorId: 'alpha_steel_co', controllerActorId: 'alpha_steel_co', regionId: R.nord, operational: false };
    const assets = buildWorldMapAssets({
      catalog: { ...catalog, initialState: { ...catalog.initialState, facilities: [unknownType] } },
      worldRegionIds: new Set(REGIONI_MONDO),
    });
    expect(assets.facilities[0]).toMatchObject({ typeName: 'ft_unknown', operational: false });
  });

  it('un `regionId` inesistente nel mondo viene escluso (nessun sito orfano)', () => {
    const assets = buildWorldMapAssets({ catalog: loadCatalog(), worldRegionIds: new Set(['GHOST-region']) });
    expect(assets.resources).toEqual([]);
    expect(assets.facilities).toEqual([]);
    // Controprova: con la sola regione reale resta solo ciò che la abita.
    const parziale = buildWorldMapAssets({ catalog: loadCatalog(), worldRegionIds: new Set([R.sud]) });
    expect(parziale.resources).toEqual([]);
    expect(parziale.facilities.map(site => site.id)).toEqual(['fac_farm_alpha']);
  });

  it('lo stato persistente ha precedenza solo a id identico e solo su `operational`', () => {
    const catalog = loadCatalog();
    const assets = buildWorldMapAssets({
      catalog,
      worldRegionIds: new Set(REGIONI_MONDO),
      persistedFacilities: [
        { id: 'fac_mine_alpha_1', data: { operational: false, regionId: 'BETA-est' } },
        { id: 'fac_sconosciuto', data: { operational: false } },
      ],
    });
    const mine = assets.facilities.find(site => site.id === 'fac_mine_alpha_1');
    // Proprietà dinamica dal persistente, geografia dal catalogo.
    expect(mine).toMatchObject({ operational: false, regionId: 'ALPHA-nord' });
    expect(assets.facilities.map(site => site.id)).not.toContain('fac_sconosciuto');
  });
});

describe('MAP P6 — endpoint /map-assets', () => {
  it('espone la fotografia mondiale del catalogo bindato', () => {
    const gameId = makeGame();
    const response = callGetRoute('/:id/map-assets', { id: gameId });
    expect(response.status).toBe(200);
    expect(response.body.canonical).toBe(true);
    expect(response.body.resources.length).toBeGreaterThan(0);
    expect(response.body.facilities.length).toBeGreaterThan(0);
    // Siti esteri presenti: la risposta non è player-scoped.
    expect(response.body.facilities.some((site: any) => site.polityId === 'BETA')).toBe(true);
  });

  it('mondo legacy → array vuoti, `canonical: false` (nessuna geografia inventata)', async () => {
    const repos = await import('../src/repositories');
    repos.worldRepository.createWithRegions(
      { id: 'mapp6_legacy_world', name: 'Legacy', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
      [{ id: 'legacy-mapp6-region', name: 'Regione', color: '#000', owner: 'ITA', population: 1, gdp: 1, militaryPower: 1, flag: 'ITA', borders: [], objects: [] }],
    );
    const gameId = registry.createSession('mapp6_legacy_world', 'Player', 'legacy-mapp6-region', '#FF0000').gameId;
    const response = callGetRoute('/:id/map-assets', { id: gameId });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ resources: [], facilities: [], canonical: false });
  });

  it('partita inesistente → 404 coerente con le altre route', () => {
    const response = callGetRoute('/:id/map-assets', { id: 'non-esiste' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Game not found' });
  });

  it('due GET identiche non cambiano la persistenza e non materializzano NPC', () => {
    const gameId = makeGame();
    const rows = () => db.prepare('SELECT object_id, kind, data FROM game_operational_objects WHERE game_id = ? ORDER BY object_id')
      .all(gameId) as Array<{ object_id: string; kind: string; data: string }>;
    // Il bootstrap della **sessione** semina lo stato del player: non è la GET.
    const before = rows();
    const first = callGetRoute('/:id/map-assets', { id: gameId });
    const middle = rows();
    const second = callGetRoute('/:id/map-assets', { id: gameId });
    const after = rows();
    expect(first.body).toEqual(second.body);
    expect(middle).toEqual(before);
    expect(after).toEqual(before);
    // Nessun impianto NPC è stato creato come effetto della lettura mappa.
    expect(after.some(row => row.kind === 'facility' && row.object_id.startsWith('fac_'))).toBe(false);
  });
});
