/**
 * BUG 3 — Risorse map-agnostiche
 * ===============================
 * Direttiva: «Le risorse ci devono essere **sempre**, non solo per alcune
 * mappe.» Il catalogo di `millennium_dawn` nomina le regioni con i codici della
 * **sua** mappa di riferimento (`map.geojson:properties.code`), ma il mondo può
 * essere stato generato su un'altra mappa (es. Pax, codici `pax-N`). In quel
 * caso la costruzione esatta `<worldId>_<codice>` non trova nulla e il layer
 * Risorse risultava **vuoto senza alcun segnale**.
 *
 * Qui si prova l'ancoraggio per paese, che è l'unico collocamento ammesso:
 *  1. id esatto, se esiste (nessuna regressione per i mondi sulla stessa mappa);
 *  2. capitale del paese del bene (chiave condivisa fra le mappe);
 *  3. prima regione del paese;
 *  4. paese assente → bene escluso. **Mai** geografia inventata.
 *
 * I test sono volutamente **map-agnostici**: leggono la mappa di riferimento dal
 * `map_base` del preset e usano l'**altra** mappa nativa come mondo. Così
 * valgono sia per il preset committed (catalogo moderno) sia per un catalogo
 * autorevole già rimappato.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-anchor-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const PRESET = 'millennium_dawn';
const WORLD = 'anchor_world';

let db: any;
let catalog: any;
let referenceMapId: string;
let otherMapId: string;
let loadNativeMap: (id: unknown) => { features?: any[] } | null;
let buildWorldMapAssets: typeof import('../src/game/WorldMapAssets')['buildWorldMapAssets'];
let buildRegionAnchor: typeof import('../src/game/WorldMapAssets')['buildRegionAnchor'];
let loadWorldMapAssets: typeof import('../src/game/WorldMapAssets')['loadWorldMapAssets'];
let worldRepository: any;
let registry: any;

let anchoredWorldIds: string[] = [];
let expectedCapitalByCountry = new Map<string, string>();
let gameId: string;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_m: string, _s: string, _u: string, onToken: (chars: number) => void) {
    onToken(1);
    return { content: '{}' };
  },
  clearCache() {},
};

/** Fatti di regione del mondo a partire da una mappa nativa (id, paese, capitale). */
function mapFacts(mapId: string, worldId: string) {
  const map = loadNativeMap(mapId);
  const out: Array<{ id: string; country: string; isCapital: boolean }> = [];
  const seen = new Set<string>();
  for (const feature of (map?.features || []) as any[]) {
    const properties = feature?.properties || {};
    const code = typeof properties.code === 'string' ? properties.code : null;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      id: `${worldId}_${code}`,
      country: String(properties.country || properties.code || '').toUpperCase(),
      isCapital: properties.is_capital === true,
    });
  }
  return out;
}

/** Codice di regione → paese (ISO3), dalla mappa indicata. */
function codeToCountry(mapId: string) {
  const byCode = new Map<string, string>();
  for (const feature of (loadNativeMap(mapId)?.features || []) as any[]) {
    const properties = feature?.properties || {};
    if (typeof properties.code !== 'string' || byCode.has(properties.code)) continue;
    byCode.set(properties.code, String(properties.country || properties.code || '').toUpperCase());
  }
  return byCode;
}

/** Paese → codice della provincia-capitale, dalla mappa indicata. */
function capitalByCountry(mapId: string) {
  const capitals = new Map<string, string>();
  for (const feature of (loadNativeMap(mapId)?.features || []) as any[]) {
    const properties = feature?.properties || {};
    const country = String(properties.country || properties.code || '').toUpperCase();
    if (properties.is_capital === true && !capitals.has(country)) capitals.set(country, properties.code);
  }
  return capitals;
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  const assetsModule = await import('../src/game/WorldMapAssets');
  buildWorldMapAssets = assetsModule.buildWorldMapAssets;
  buildRegionAnchor = assetsModule.buildRegionAnchor;
  loadWorldMapAssets = assetsModule.loadWorldMapAssets;
  const loader = await import('../src/scenario/loader');
  const presetLoader = await import('../src/utils/preset-loader');
  const nativeMaps = await import('../src/utils/native-maps');
  loadNativeMap = nativeMaps.loadNativeMap as typeof loadNativeMap;

  const loaded = loader.loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', PRESET));
  if (!loaded.catalog) throw new Error('catalogo millennium_dawn assente');
  catalog = loaded.catalog;

  const preset = presetLoader.loadPreset(PRESET)!;
  const source = nativeMaps.resolveMapSource({ hasCustomMap: preset.has_custom_map, mapBase: preset.map_base });
  referenceMapId = source.kind === 'native' ? source.id : 'modern_world_provinces';
  otherMapId = referenceMapId === 'pax_modern_provinces' ? 'modern_world_provinces' : 'pax_modern_provinces';

  // ---------------------------------------------------------------------------
  // Mondo reale "già creato" su una mappa DIVERSA da quella del catalogo: si
  // persistono la capitale di ogni paese nominato dal catalogo. È il caso di
  // Andrea (mondo su Pax, catalogo con i codici della mappa di riferimento):
  // la risoluzione avviene a read-time, quindi vale per mondi esistenti.
  // ---------------------------------------------------------------------------
  const catalogCountryByCode = codeToCountry(referenceMapId);
  const catalogCountries = new Set(
    [...catalog.initialState.deposits, ...catalog.initialState.facilities]
      .map((asset: any) => catalogCountryByCode.get(asset.regionId))
      .filter(Boolean),
  );
  expectedCapitalByCountry = capitalByCountry(otherMapId);
  const worldFacts = mapFacts(otherMapId, WORLD).filter(fact =>
    catalogCountries.has(fact.country) && (fact.isCapital || !expectedCapitalByCountry.has(fact.country)));
  // Dedup per id (una capitale per paese, più il fallback dove manca).
  const uniqueFacts = [...new Map(worldFacts.map(fact => [fact.id, fact])).values()];
  anchoredWorldIds = uniqueFacts.map(fact => fact.id);

  worldRepository.createWithRegions(
    { id: WORLD, name: 'Mondo ancorato', description: '', startDate: '2000-01-01', basePrompt: 'Test', historicalAccuracy: 0.8, templateId: PRESET },
    uniqueFacts.map(fact => ({
      id: fact.id, name: fact.id, color: '#4488aa', owner: fact.country, flag: fact.country,
      population: 1_000_000, gdp: 500, militaryPower: 10, borders: [], objects: [],
    })),
  );
  // BUG 3 — nessuna iniezione di metadata: `regionFacts` deriva il paese da
  // `flag` e la capitale dalla mappa nativa reale del mondo.
  gameId = registry.createSession(WORLD, 'Player', uniqueFacts[0].id, '#FF0000').gameId;
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

const visibleDeposits = () => catalog.initialState.deposits.filter((deposit: any) => deposit.accessibility !== 'hidden');

describe('BUG 3 — ancoraggio per paese (puro, map-agnostico)', () => {
  it('mondo sulla mappa del catalogo: id esatto, nessuna regressione', () => {
    const facts = mapFacts(referenceMapId, WORLD);
    const worldRegionIds = new Set(facts.map(fact => fact.id));
    const anchor = buildRegionAnchor(PRESET, WORLD, facts);
    const withAnchor = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds, anchor });
    const withoutAnchor = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    // Il percorso esatto vince sempre: l'ancoraggio non sposta nulla.
    expect(JSON.stringify(withAnchor)).toBe(JSON.stringify(withoutAnchor));
    const catalogCodes = new Set(
      [...catalog.initialState.deposits, ...catalog.initialState.facilities].map((asset: any) => asset.regionId),
    );
    for (const site of [...withAnchor.resources, ...withAnchor.facilities]) {
      expect(catalogCodes.has(site.regionId.slice(`${WORLD}_`.length)), site.id).toBe(true);
    }
  });

  it("mondo su un'altra mappa: tutti i beni risolti per paese, 0 orfani", () => {
    const facts = mapFacts(otherMapId, WORLD);
    const worldRegionIds = new Set(facts.map(fact => fact.id));
    const anchor = buildRegionAnchor(PRESET, WORLD, facts);
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds, anchor });

    expect(assets.canonical).toBe(true);
    expect(assets.resources.length).toBe(visibleDeposits().length);
    expect(assets.facilities.length).toBe(catalog.initialState.facilities.length);
    for (const site of [...assets.resources, ...assets.facilities]) {
      expect(worldRegionIds.has(site.regionId), site.id).toBe(true);
    }
    // Ogni bene sta sulla provincia-capitale del **suo** paese.
    const codeMap = codeToCountry(referenceMapId);
    const capitals = capitalByCountry(otherMapId);
    for (const deposit of visibleDeposits()) {
      const expected = `${WORLD}_${capitals.get(codeMap.get(deposit.regionId)!)}`;
      const site = assets.resources.find((item: any) => item.id === deposit.id);
      expect(site?.regionId, deposit.id).toBe(expected);
    }
  });

  it('paese assente dal mondo: il bene è escluso, gli altri restano', () => {
    const codeMap = codeToCountry(referenceMapId);
    const target = visibleDeposits()[0];
    const targetCountry = codeMap.get(target.regionId)!;
    const facts = mapFacts(otherMapId, WORLD).filter(fact => fact.country !== targetCountry);
    const worldRegionIds = new Set(facts.map(fact => fact.id));
    const anchor = buildRegionAnchor(PRESET, WORLD, facts);
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds, anchor });

    expect(assets.resources.map((site: any) => site.id)).not.toContain(target.id);
    const survivor = visibleDeposits().find((deposit: any) => codeMap.get(deposit.regionId) !== targetCountry);
    expect(survivor).toBeTruthy();
    expect(assets.resources.map((site: any) => site.id)).toContain(survivor!.id);
  });

  it('deterministico: stessi input ⇒ stesso output', () => {
    const facts = mapFacts(otherMapId, WORLD);
    const worldRegionIds = new Set(facts.map(fact => fact.id));
    const anchor = buildRegionAnchor(PRESET, WORLD, facts);
    const first = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds, anchor });
    const second = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds, anchor });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('i giacimenti `hidden` restano esclusi anche con l\'ancoraggio', () => {
    const facts = mapFacts(otherMapId, WORLD);
    const anchor = buildRegionAnchor(PRESET, WORLD, facts);
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds: new Set(facts.map(fact => fact.id)), anchor });
    for (const deposit of catalog.initialState.deposits.filter((item: any) => item.accessibility === 'hidden')) {
      expect(assets.resources.map((site: any) => site.id), deposit.id).not.toContain(deposit.id);
    }
    expect(assets.resources.length).toBe(visibleDeposits().length);
  });
});

describe('BUG 3 — mondo già creato, risoluzione a read-time', () => {
  it('`regionFacts` legge paese e capitale senza idratare gli oggetti', () => {
    const before = db.prepare('SELECT id, objects FROM world_regions WHERE world_id = ? ORDER BY id').all(WORLD);
    const facts = worldRepository.regionFacts(WORLD);
    const after = db.prepare('SELECT id, objects FROM world_regions WHERE world_id = ? ORDER BY id').all(WORLD);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(facts.map((fact: any) => fact.id).sort()).toEqual([...anchoredWorldIds].sort());
    const capital = facts.find((fact: any) => fact.isCapital);
    expect(capital).toBeTruthy();
    expect(capital!.country.length).toBe(3);
  });

  it('`loadWorldMapAssets` risolve i beni sul mondo reale, non sulla mappa del catalogo', () => {
    const assets = loadWorldMapAssets(gameId);
    expect(assets.canonical).toBe(true);
    expect(assets.resources.length).toBe(visibleDeposits().length);
    expect(assets.facilities.length).toBe(catalog.initialState.facilities.length);

    const worldIds = new Set(worldRepository.regionIds(WORLD));
    for (const site of [...assets.resources, ...assets.facilities]) {
      expect(worldIds.has(site.regionId), site.id).toBe(true);
    }

    const codeMap = codeToCountry(referenceMapId);
    const deposit = visibleDeposits()[0];
    const expected = `${WORLD}_${expectedCapitalByCountry.get(codeMap.get(deposit.regionId)!)}`;
    expect(assets.resources.find((site: any) => site.id === deposit.id)?.regionId).toBe(expected);
  });
});
