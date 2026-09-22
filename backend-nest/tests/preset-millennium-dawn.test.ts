/**
 * PRESET MILLENNIUM DAWN — «Millennium Dawn — 2000»
 * =================================================
 * Il preset `millennium_dawn` è il vertical slice authored del mondo al
 * **1° gennaio 2000**: catalogo strict (formato `SimulationCatalog`, identico a
 * quello di P6.2) bindato alla mappa nativa `modern_world_provinces`
 * (`world_scoped`). Qui si prova che è **giocabile e verificato** senza mai
 * inventare geografia:
 *
 *  - `loadPreset` lo carica; la data canonica è `2000-01-01` e i suoi
 *    `country_codes` sono ISO-A3 reali;
 *  - `loadSimulationCatalog` lo valida (`mode: authored`, nessun errore);
 *  - **ogni** `regionId` di giacimenti e impianti esiste davvero tra i codici
 *    di `modern_world_provinces/map.geojson` (`properties.code`): zero orfani;
 *  - ogni `ownerActorId`/`controllerActorId` esiste nel registro attori;
 *  - i due giacimenti `hidden` **non** vengono pubblicati;
 *  - l'impianto `operational: false` resta pubblicato e classificato;
 *  - il caso `owner != controller` preserva entrambi i fatti;
 *  - `buildWorldMapAssets` è puro e deterministico (nessuna scrittura, nessuna
 *    mutazione del catalogo).
 *
 * Il test è volutamente **puro**: nessuna sessione, nessun LLM, nessun
 * bootstrap di mondo. La pipeline completa (endpoint `/map-assets`) è già
 * coperta da MAP P6.1/P6.2 sulle stesse funzioni.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SimulationCatalog } from '../src/scenario/types';

const TEST_DB = path.join(os.tmpdir(), `world-story-md-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const PRESET_ID = 'millennium_dawn';
const PRESET_DIR = path.join(process.cwd(), 'data', 'presets', PRESET_ID);
const MAP_FILE = path.join(process.cwd(), 'data', 'presets', 'modern_world_provinces', 'map.geojson');
const WORLD = 'md2000world';
const START_DATE = '2000-01-01';
const HIDDEN_DEPOSITS = ['deposit:RUKYA:crude_oil:1', 'deposit:RUSA:crude_oil:1'];
const MIXED_FACILITY = 'facility:NLNH:refinery:1';
const STOPPED_FACILITY = 'facility:NLNH:refinery:2';

let db: any;
let loadPreset: typeof import('../src/utils/preset-loader')['loadPreset'];
let loadSimulationCatalog: typeof import('../src/scenario/loader')['loadSimulationCatalog'];
let buildWorldMapAssets: typeof import('../src/game/WorldMapAssets')['buildWorldMapAssets'];
let catalog: SimulationCatalog;
let preset: NonNullable<ReturnType<typeof import('../src/utils/preset-loader')['loadPreset']>>;
/** Codici `properties.code` autorevoli della mappa nativa del preset. */
let mapRegionCodes: Set<string>;
/** Spazio id del mondo reale: `<worldId>_<codice>`. */
let worldRegionIds: Set<string>;

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();

  const loader = await import('../src/scenario/loader');
  loadSimulationCatalog = loader.loadSimulationCatalog;
  const presetLoader = await import('../src/utils/preset-loader');
  loadPreset = presetLoader.loadPreset;
  buildWorldMapAssets = (await import('../src/game/WorldMapAssets')).buildWorldMapAssets;

  preset = loadPreset(PRESET_ID)!;
  const loaded = loadSimulationCatalog(PRESET_DIR);
  if (!loaded.catalog) throw new Error(`catalogo millennium_dawn non valido: ${JSON.stringify(loaded.report.errors)}`);
  catalog = loaded.catalog;

  // Lo spazio id delle regioni è **derivato dal file della mappa nativa**
  // (`properties.code`): se un codice viene rinominato, questi test falliscono
  // invece di pubblicare asset nella regione sbagliata.
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) as { features?: Array<{ properties?: Record<string, unknown> }> };
  mapRegionCodes = new Set<string>();
  for (const feature of map.features ?? []) {
    const code = feature?.properties?.code;
    if (typeof code === 'string' && code) mapRegionCodes.add(code);
  }
  worldRegionIds = new Set([...mapRegionCodes].map(code => `${WORLD}_${code}`));
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

const allCatalogRegionIds = () => [
  ...catalog.initialState.deposits.map(deposit => deposit.regionId),
  ...catalog.initialState.facilities.map(facility => facility.regionId),
];

describe('MILLENNIUM DAWN — preset caricabile', () => {
  it('id, nome, data canonica, mappa e accuratezza dichiarati', () => {
    expect(preset).toBeTruthy();
    expect(preset.id).toBe(PRESET_ID);
    expect(preset.name).toContain('Millennium Dawn');
    expect(preset.start_date).toBe(START_DATE);
    expect(preset.map_base).toBe('modern_world_provinces');
    expect(preset.map_detail).toBe('full');
    expect(preset.historical_accuracy).toBe(0.8);
    // Il preset non porta una mappa propria: usa `map_base` (vincolo di task).
    expect(preset.has_custom_map).toBe(false);
    expect(fs.existsSync(path.join(PRESET_DIR, 'map.geojson'))).toBe(false);
  });

  it('`country_codes` è un elenco ISO-A3 reale, non vuoto e senza duplicati', () => {
    expect(preset.country_codes.length).toBeGreaterThan(0);
    expect(preset.country_codes.length).toBe(101);
    for (const code of preset.country_codes) expect(code, code).toMatch(/^[A-Z]{3}$/);
    expect(new Set(preset.country_codes).size).toBe(preset.country_codes.length);
  });
});

describe('MILLENNIUM DAWN — catalogo strict valido', () => {
  it('il catalogo si carica senza errori bloccanti', () => {
    const { catalog: loaded, report } = loadSimulationCatalog(PRESET_DIR);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(loaded).not.toBeNull();
  });

  it('manifest: `authored`, data 2000-01-01 e binding `world_scoped`', () => {
    expect(catalog.manifest.id).toBe(PRESET_ID);
    expect(catalog.manifest.mode).toBe('authored');
    expect(catalog.manifest.startDate).toBe(START_DATE);
    expect(catalog.manifest.declaration).toBe('historical_estimated');
    expect(catalog.manifest.regionIdBinding).toEqual({
      space: 'world_scoped',
      source: 'map.geojson:properties.code',
    });
  });

  it('il vertical slice dichiara 3 risorse, 3 tipi impianto, 15 attori e 14 politie', () => {
    expect(catalog.resources.map(resource => resource.id).sort()).toEqual(['coal', 'crude_oil', 'iron_ore']);
    expect(catalog.facilityTypes.map(type => type.id).sort()).toEqual(['coal_power_plant', 'refinery', 'steel_plant']);
    expect(catalog.actors).toHaveLength(15);
    expect(catalog.polities).toHaveLength(14);
    expect(catalog.initialState.deposits).toHaveLength(20);
    expect(catalog.initialState.facilities).toHaveLength(14);
  });

  it('ogni riferimento interno è coerente (nessun id inventato)', () => {
    const resourceIds = new Set(catalog.resources.map(resource => resource.id));
    const typeIds = new Set(catalog.facilityTypes.map(type => type.id));
    const polityIds = new Set(catalog.polities.map(polity => polity.id));
    const actorIds = new Set(catalog.actors.map(actor => actor.actorId));
    for (const deposit of catalog.initialState.deposits) {
      expect(resourceIds.has(deposit.resourceId), deposit.id).toBe(true);
    }
    for (const facility of catalog.initialState.facilities) {
      expect(typeIds.has(facility.typeId), facility.id).toBe(true);
      expect(actorIds.has(facility.ownerActorId), facility.id).toBe(true);
      expect(actorIds.has(facility.controllerActorId), facility.id).toBe(true);
    }
    for (const actor of catalog.actors) {
      expect(polityIds.has(actor.polityId), actor.actorId).toBe(true);
    }
  });

  it('nessuna quantità fabbricata: ogni giacimento è `known: null`', () => {
    for (const deposit of catalog.initialState.deposits) {
      expect(deposit.known, deposit.id).toBeNull();
      expect(deposit.estimated, deposit.id).toBeUndefined();
    }
  });
});

describe('MILLENNIUM DAWN — binding geografico: nessun asset orfano', () => {
  it('la mappa nativa espone centinaia di codici di regione autorevoli', () => {
    expect(mapRegionCodes.size).toBeGreaterThan(900);
  });

  it('ogni `regionId` del catalogo esiste in `modern_world_provinces` (`properties.code`)', () => {
    for (const deposit of catalog.initialState.deposits) {
      expect(mapRegionCodes.has(deposit.regionId), `${deposit.id} → ${deposit.regionId}`).toBe(true);
    }
    for (const facility of catalog.initialState.facilities) {
      expect(mapRegionCodes.has(facility.regionId), `${facility.id} → ${facility.regionId}`).toBe(true);
    }
  });

  it('un asset che punta a un id inesistente viene **escluso**, non spostato', () => {
    const ghostDeposit = { id: 'deposit:GHOST:crude_oil:1', resourceId: 'crude_oil', regionId: 'GHOST', known: null, accessibility: 'open' as const };
    const ghostFacility = {
      id: 'facility:GHOST:refinery:1', typeId: 'refinery',
      ownerActorId: 'sau_state_oil', controllerActorId: 'sau_state_oil',
      regionId: 'GHOST', operational: true,
    };
    const patched: SimulationCatalog = {
      ...catalog,
      initialState: {
        ...catalog.initialState,
        deposits: [...catalog.initialState.deposits, ghostDeposit],
        facilities: [...catalog.initialState.facilities, ghostFacility],
      },
    };
    const assets = buildWorldMapAssets({ catalog: patched, worldId: WORLD, worldRegionIds });
    expect(assets.resources.map(site => site.id)).not.toContain(ghostDeposit.id);
    expect(assets.facilities.map(site => site.id)).not.toContain(ghostFacility.id);
    // Gli asset reali restano: l'orfano è escluso singolarmente, non in blocco.
    expect(assets.resources.map(site => site.id)).toContain('deposit:SA04:crude_oil:1');
    expect(assets.facilities.map(site => site.id)).toContain('facility:SA04:refinery:1');
  });

  it('l’endpoint pubblica gli asset con id del mondo `<worldId>_<codice>`', () => {
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    for (const site of [...assets.resources, ...assets.facilities]) {
      expect(site.regionId.startsWith(`${WORLD}_`), site.id).toBe(true);
      expect(worldRegionIds.has(site.regionId), site.id).toBe(true);
    }
  });
});

describe('MILLENNIUM DAWN — actor registry', () => {
  it('ogni proprietario e controllore esiste nel registro attori', () => {
    const actorIds = new Set(catalog.actors.map(actor => actor.actorId));
    for (const facility of catalog.initialState.facilities) {
      expect(actorIds.has(facility.ownerActorId), facility.id).toBe(true);
      expect(actorIds.has(facility.controllerActorId), facility.id).toBe(true);
    }
  });

  it('il caso `owner != controller` preserva entrambi i fatti e le due polity', () => {
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    const mixed = assets.facilities.find(site => site.id === MIXED_FACILITY);
    expect(mixed).toBeTruthy();
    expect(mixed).toMatchObject({
      regionId: `${WORLD}_NLNH`,
      ownerActorId: 'usa_gulf_refining',
      ownerActorName: 'Raffinazione privata (USA)',
      controllerActorId: 'nld_port_authority',
      controllerActorName: 'Autorità portuale (NLD)',
      polityId: 'USA',
      controllerPolityId: 'NLD',
    });
    expect(mixed!.ownerActorId).not.toBe(mixed!.controllerActorId);
  });
});

describe('MILLENNIUM DAWN — giacimenti `hidden` non pubblicati', () => {
  it('i due giacimenti russi nascosti NON compaiono, tutti gli altri sì', () => {
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    const publishedIds = assets.resources.map(site => site.id);
    for (const hiddenId of HIDDEN_DEPOSITS) {
      expect(publishedIds, hiddenId).not.toContain(hiddenId);
      // Controprova: il giacimento esiste nel catalogo ed è davvero `hidden`.
      const deposit = catalog.initialState.deposits.find(item => item.id === hiddenId);
      expect(deposit).toBeTruthy();
      expect(deposit!.accessibility).toBe('hidden');
    }
    // Pubblicati tutti gli altri: nulla è scartato in silenzio.
    const visible = catalog.initialState.deposits.filter(deposit => deposit.accessibility !== 'hidden');
    expect(publishedIds.sort()).toEqual(visible.map(deposit => deposit.id).sort());
    expect(assets.resources).toHaveLength(catalog.initialState.deposits.length - HIDDEN_DEPOSITS.length);
  });
});

describe('MILLENNIUM DAWN — impianto non operativo', () => {
  it('è nel catalogo con `operational: false` e viene pubblicato come tale', () => {
    const stopped = catalog.initialState.facilities.find(facility => facility.id === STOPPED_FACILITY);
    expect(stopped).toBeTruthy();
    expect(stopped!.operational).toBe(false);
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    const published = assets.facilities.find(site => site.id === STOPPED_FACILITY);
    expect(published).toBeTruthy();
    expect(published!.operational).toBe(false);
    // Non viene nascosto: è classificato. Tutti gli impianti sono pubblicati.
    expect(assets.facilities).toHaveLength(catalog.initialState.facilities.length);
  });
});

describe('MILLENNIUM DAWN — read model puro e deterministico', () => {
  it('due chiamate identiche producono lo stesso risultato', () => {
    const first = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    const second = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('non muta il catalogo né lo spazio regioni', () => {
    const catalogBefore = JSON.stringify(catalog);
    const regionsBefore = [...worldRegionIds].sort();
    buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    expect(JSON.stringify(catalog)).toBe(catalogBefore);
    expect([...worldRegionIds].sort()).toEqual(regionsBefore);
  });

  it('senza `worldId` il catalogo `world_scoped` non pubblica nulla', () => {
    const assets = buildWorldMapAssets({ catalog, worldRegionIds });
    expect(assets.resources).toEqual([]);
    expect(assets.facilities).toEqual([]);
  });

  it('ogni `regionId` pubblicato appartiene davvero alla mappa del preset', () => {
    const assets = buildWorldMapAssets({ catalog, worldId: WORLD, worldRegionIds });
    const publishedCodes = [...assets.resources, ...assets.facilities]
      .map(site => site.regionId.slice(`${WORLD}_`.length));
    expect(new Set(allCatalogRegionIds()).size).toBeGreaterThan(0);
    for (const code of publishedCodes) expect(mapRegionCodes.has(code), code).toBe(true);
  });
});
