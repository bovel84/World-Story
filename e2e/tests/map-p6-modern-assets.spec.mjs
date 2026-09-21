/**
 * MAP P6.2 — asset canonici del preset moderno **reale**
 * =====================================================
 * P6/P6.1 provavano la pipeline su una fixture geometrica sintetica (ITA/FRA/DEU).
 * Qui la prova è di produzione: la fixture del mondo è costruita dalla
 * **`map.geojson` di `modern_world_provinces`** (geometrie reali, codici reali
 * `properties.code`) e il payload `/map-assets` è costruito dal **catalogo
 * `simulation/` del preset**, letto dai file su disco. Nessun asset è inventato
 * dal test: se il catalogo cambia, cambia ciò che il test vede.
 *
 * Pipeline provata end-to-end:
 *   preset reale → catalogo → `WorldMapAssets` (binding `<worldId>_<codice>`)
 *   → `ThematicMapModel` → `buildThematicAssetMarkers` → marker → click →
 *   region context → Province Inspector.
 *
 * Le fixture restano utili per i test isolati (P6.1); questo file è la prova
 * che i dati authored arrivano davvero sulla mappa moderna.
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { installMockApi, MOCK_ACCOUNTS, MOCK_ARSENAL, MOCK_GAME } from '../mock-api.mjs';

const PRESET_DIR = path.join(process.cwd(), '..', 'backend-nest', 'data', 'presets', 'modern_world_provinces');
const SIM_DIR = path.join(PRESET_DIR, 'simulation');
const readSim = (file) => JSON.parse(fs.readFileSync(path.join(SIM_DIR, file), 'utf8'));

const MANIFEST = readSim('manifest.json');
const RESOURCES = readSim('resources.json');
const FACILITY_TYPES = readSim('facilities.json');
const ACTORS = readSim('actors.json');
const INITIAL = readSim('initial-state.json');
const MAP = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'map.geojson'), 'utf8'));

/**
 * Contratto degli id: `manifest.regionIdBinding.space === 'world_scoped'` e le
 * regioni del mondo sono `<worldId>_<properties.code>`. Il test non lo assume:
 * lo **verifica** e usa esattamente quella costruzione.
 */
test.beforeAll(() => {
  expect(MANIFEST.regionIdBinding).toEqual({ space: 'world_scoped', source: 'map.geojson:properties.code' });
  expect(MAP.features.length).toBeGreaterThan(900);
});

const WORLD_ID = 'modernworld';
const REGION_ID = (code) => `${WORLD_ID}_${code}`;
/** Regioni del vertical slice usate dalla prova (tutte presenti nella mappa). */
const CODES = ['ZANW', 'NLNH', 'USTX', 'AUWA'];
const POLITY_NAMES = { ZAF: 'Sudafrica', NLD: 'Paesi Bassi', USA: 'Stati Uniti', AUS: 'Australia' };
const COLORS = { ZANW: '#c0a076', NLNH: '#7fb3a0', USTX: '#609f87', AUWA: '#a08fc0' };

const featureOf = (code) => MAP.features.find(feature => feature.properties.code === code);
for (const code of CODES) {
  expect(featureOf(code), `regione ${code} assente dalla mappa del preset`).toBeTruthy();
}

const boundsOf = (feature) => {
  const points = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates.flat(2);
  const lngs = points.map(point => point[0]);
  const lats = points.map(point => point[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
};

const territory = (code) => {
  const feature = featureOf(code);
  const country = feature.properties.country;
  return {
    id: REGION_ID(code), name: feature.properties.name, polityName: POLITY_NAMES[country] || country,
    owner: country, flag: country, color: COLORS[code] || '#888888',
    // Geometria **reale** del preset: la mappa disegna la provincia vera.
    geojson: JSON.stringify({ type: 'Feature', properties: feature.properties, geometry: feature.geometry }),
    objects: [], population: 1_000_000, militaryPower: 30, gdp: 900, borders: [], status: 'active',
    metadata: { surface_type: 'Pianura' },
  };
};

const game = {
  ...MOCK_GAME,
  worldRevision: 5,
  players: [{ id: 'player', regionId: REGION_ID('ZANW'), polityId: 'ZAF', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: Object.fromEntries(CODES.map(code => [REGION_ID(code), territory(code)])) },
};

/**
 * `/map-assets` come lo serve il motore: solo asset le cui regioni **esistono**
 * nel mondo, nomi risolti dal catalogo, binding `<worldId>_<codice>`.
 * Nessun asset aggiunto a mano: è il catalogo del preset, filtrato.
 */
const buildAssets = () => {
  const resourceNames = new Map(RESOURCES.map(resource => [resource.id, resource.name]));
  const typeNames = new Map(FACILITY_TYPES.map(type => [type.id, type.name]));
  const actors = new Map(ACTORS.map(actor => [actor.actorId, actor]));
  const worldRegionIds = new Set(CODES.map(REGION_ID));
  const resolve = (code) => REGION_ID(code);
  return {
    canonical: true,
    resources: INITIAL.deposits
      .filter(deposit => deposit.accessibility !== 'hidden' && worldRegionIds.has(resolve(deposit.regionId)))
      .map(deposit => ({
        id: deposit.id, resourceId: deposit.resourceId,
        resourceName: resourceNames.get(deposit.resourceId) || deposit.resourceId,
        regionId: resolve(deposit.regionId), accessibility: deposit.accessibility,
        known: deposit.known !== null, knownQuantity: deposit.known ?? null,
      })),
    facilities: INITIAL.facilities
      .filter(facility => worldRegionIds.has(resolve(facility.regionId)))
      .map(facility => {
        const owner = actors.get(facility.ownerActorId);
        const controller = actors.get(facility.controllerActorId);
        return {
          id: facility.id, typeId: facility.typeId, typeName: typeNames.get(facility.typeId) || facility.typeId,
          regionId: resolve(facility.regionId), ownerActorId: facility.ownerActorId,
          ownerActorName: owner?.name, controllerActorId: facility.controllerActorId,
          controllerActorName: controller?.name, polityId: owner?.polityId ?? null,
          controllerPolityId: controller?.polityId ?? null, operational: facility.operational,
        };
      }),
  };
};
const WORLD_ASSETS = buildAssets();

/** Riserve nazionali: nessun `regionId` nel contratto, quindi nessuna geografia. */
const NATURAL = [
  { kind: 'coal', label: 'Riserva nazionale di carbone', renewable: false, endowment: 100, reserve: 80,
    maxReserve: 100, stockpile: 20, extractionPerMonth: 2, depletionPct: 20, depleted: false },
];

const ARSENAL = {
  ...MOCK_ARSENAL,
  objects: {
    counts: { mine: 1 }, conventions: [], chains: [],
    objects: [{
      id: 'zaf-mine', kind: 'mine', label: 'Giacimento del giocatore (fallback legacy)',
      subtitle: 'Giacimento 1/1', status: 'operational', statusLabel: 'Operativo',
      parentId: null, regionId: REGION_ID('ZANW'), regionName: 'North West',
      facts: [], problems: [], actions: [],
    }],
  },
};

const LAYER_IDS = {
  Politica: 'political', Militare: 'military', Economia: 'economy', Risorse: 'resources',
  Infrastrutture: 'infrastructure', Diplomazia: 'diplomacy', Modifiche: 'changes', Terreno: 'terrain',
};

async function installStoreBridge(page) {
  await page.addInitScript(() => {
    const moduleUrl = (pattern) => performance.getEntriesByType('resource')
      .map(entry => entry.name).filter(url => pattern.test(url)).at(-1);
    window.__wsAppModules = async () => {
      if (!window.__wsAppModulesCache) {
        const gameUrl = moduleUrl(/\/src\/stores\/gameStore\.ts(\?|$)/) || '/src/stores/gameStore.ts';
        const uiUrl = moduleUrl(/\/src\/stores\/uiStore\.ts(\?|$)/) || '/src/stores/uiStore.ts';
        const [gameModule, uiModule] = await Promise.all([import(gameUrl), import(uiUrl)]);
        window.__wsAppModulesCache = { useGameStore: gameModule.useGameStore, useUIStore: uiModule.useUIStore };
      }
      return window.__wsAppModulesCache;
    };
  });
}

async function openModernMap(page, { failAssets = false } = {}) {
  installMockApi(page);
  await installStoreBridge(page);
  await page.route('**/api/games/*/map-assets', route => failAssets
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WORLD_ASSETS) }));
  await page.route('**/api/games/*/arsenal', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ARSENAL),
  }));
  await page.route('**/api/games/*/national-state', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ accounts: MOCK_ACCOUNTS, history: [], resources: { natural: NATURAL }, government: null }),
  }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async fixtureGame => {
    await import('/src/components/Map/MapboxMapView.tsx');
    const mapUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => /\/maplibre-gl\.js(?:\?|$)/.test(url));
    if (!mapUrl) throw new Error('MapLibre module not loaded');
    const { default: maplibre } = await import(mapUrl);
    const addSource = maplibre.Map.prototype.addSource;
    maplibre.Map.prototype.addSource = function (id, source) {
      if (id === 'regions') window.__testMap = this;
      return addSource.call(this, id, source);
    };
    const { useGameStore, useUIStore } = await window.__wsAppModules();
    useGameStore.setState({
      currentWorld: fixtureGame.world, currentGame: fixtureGame,
      selectedCountry: 'ZAF', selectedRegion: null,
    });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, game);
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
}

const mapLayer = (page) => page.locator('.world-map');
const context = (page, regionId) => page.locator(`[data-map-context="region"][data-map-context-id="${regionId}"]`);
const resourceMarker = (page, id) => page.locator(`[data-map-resource-marker="${id}"]`);
const facilityMarker = (page, id) => page.locator(`[data-map-facility-marker="${id}"]`);

async function selectLayer(page, label) {
  const legend = page.locator('.map-legend-toggle');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await page.getByRole('radio', { name: label, exact: true }).check();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', LAYER_IDS[label]);
  if (await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

/** Inquadra la provincia reale: il marker (ancorato alla regione) entra in viewport. */
async function focusRegion(page, code) {
  const bounds = boundsOf(featureOf(code));
  await page.evaluate(box => window.__testMap.fitBounds(box, { padding: 40, animate: false }), bounds);
  await page.waitForTimeout(120);
}

const camera = (page) => page.evaluate(() => {
  const center = window.__testMap.getCenter();
  return { lng: Number(center.lng.toFixed(3)), lat: Number(center.lat.toFixed(3)) };
});

// A — una risorsa reale authored è un marker reale sulla mappa moderna.
test('MAP P6.2 / A — il carbone del North West è un marker canonico cliccabile', async ({ page }) => {
  await openModernMap(page);
  await selectLayer(page, 'Risorse');
  await focusRegion(page, 'ZANW');
  const marker = resourceMarker(page, 'deposit:ZANW:coal:1');
  await expect(marker).toBeVisible();
  // Il marker dichiara la regione **giusta** (id del mondo, non il codice nudo).
  await expect(marker).toHaveAttribute('data-region-id', REGION_ID('ZANW'));
  await expect(marker).toHaveAttribute('aria-label', /Carbone — North West/);
  // Click → region context → stesso asset nel dossier.
  await marker.click();
  const northWest = context(page, REGION_ID('ZANW'));
  await expect(northWest).toBeVisible();
  const site = northWest.locator('[data-resource-site="deposit:ZANW:coal:1"]');
  await expect(site).toBeVisible();
  await expect(site).toContainText('Carbone');
  await expect(site).toHaveAttribute('data-resource-kind', 'coal');
  // Quantità non verificabile: ignoranza dichiarata, mai un numero inventato.
  await expect(site).toHaveAttribute('data-resource-known', 'false');
  await expect(site).toContainText('quantità non determinata');
  // Le riserve nazionali del giocatore non diventano geografia.
  await expect(northWest).not.toContainText('Riserva nazionale');
  // La sorgente canonica vince: il fallback player-scoped non compare.
  await expect(northWest).not.toContainText('fallback legacy');
});

// B — un impianto reale authored con proprietà ≠ territorio ≠ controllo.
test('MAP P6.2 / B — raffineria di Noord-Holland: proprietario, controllore e potenza', async ({ page }) => {
  await openModernMap(page);
  await selectLayer(page, 'Infrastrutture');
  await focusRegion(page, 'NLNH');
  const marker = facilityMarker(page, 'facility:NLNH:refinery:1');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('data-region-id', REGION_ID('NLNH'));
  await expect(marker).toHaveAttribute('aria-label', /Raffineria — Noord-Holland/);
  await marker.click();
  const noordHolland = context(page, REGION_ID('NLNH'));
  await expect(noordHolland).toBeVisible();
  const plant = noordHolland.locator('[data-infrastructure-item="facility:NLNH:refinery:1"]');
  await expect(plant).toBeVisible();
  await expect(plant).toHaveAttribute('data-infrastructure-source', 'canonical');
  await expect(plant).toHaveAttribute('data-infrastructure-state', 'operative');
  await expect(plant).toContainText('Raffineria');
  await expect(plant).toContainText('operativo');
  // Le tre cose restano distinte: chi possiede, chi controlla, di chi è il territorio.
  await expect(plant).toContainText('Proprietario: Raffinazione privata (USA)');
  await expect(plant).toContainText('Controllore: Energia portuale privata (NLD)');
  await expect(plant).toContainText('Potenza: USA');
  await expect(plant).toContainText('Controllo: NLD');
  // Il layer non riscrive la politica territoriale: la regione resta dei Paesi Bassi.
  await expect(noordHolland).toContainText('Paesi Bassi');
});

// C — DISCRIMINANTE: un impianto canonico `operational:false` non è «operativo».
test('MAP P6.2 / C — l’impianto non operativo resta visibile sotto «Non operative»', async ({ page }) => {
  await openModernMap(page);
  await selectLayer(page, 'Infrastrutture');
  await focusRegion(page, 'NLNH');
  const stopped = facilityMarker(page, 'facility:NLNH:refinery:2');
  // 1. resta sulla mappa: non viene nascosto.
  await expect(stopped).toBeVisible();
  await expect(stopped).toHaveAttribute('aria-label', /non operativo/);
  await stopped.click();
  const noordHolland = context(page, REGION_ID('NLNH'));
  await expect(noordHolland).toBeVisible();
  const item = noordHolland.locator('[data-infrastructure-item="facility:NLNH:refinery:2"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-infrastructure-state', 'inactive');
  await expect(item).toContainText('non operativo');
  // 2. sta nel gruppo «Non operative»…
  const inactive = noordHolland.locator('.thematic-group')
    .filter({ has: page.getByRole('heading', { name: /^Non operative/ }) });
  await expect(inactive.locator('[data-infrastructure-item="facility:NLNH:refinery:2"]')).toBeVisible();
  // 3. …e NON in «Operative», dove finiva prima di P6.2.
  const operative = noordHolland.locator('.thematic-group')
    .filter({ has: page.getByRole('heading', { name: /^Operative/ }) });
  await expect(operative.locator('[data-infrastructure-item="facility:NLNH:refinery:2"]')).toHaveCount(0);
  await expect(operative.locator('[data-infrastructure-item="facility:NLNH:refinery:1"]')).toBeVisible();
});

// D — isolamento dei layer sugli asset reali.
test('MAP P6.2 / D — ogni layer disegna solo i propri marker', async ({ page }) => {
  await openModernMap(page);
  await selectLayer(page, 'Politica');
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(0);
  await selectLayer(page, 'Risorse');
  expect(await page.locator('[data-map-resource-marker]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(0);
  await selectLayer(page, 'Infrastrutture');
  expect(await page.locator('[data-map-facility-marker]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
});

// E — fail-closed P6.1 invariato sul preset reale: errore ≠ legacy.
test('MAP P6.2 / E — errore della sorgente: nessun asset e nessun fallback', async ({ page }) => {
  await openModernMap(page, { failAssets: true });
  await selectLayer(page, 'Risorse');
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  await expect(mapLayer(page)).toHaveAttribute('data-resources-available', 'false');
  await expect(mapLayer(page)).toContainText('Dati territoriali non disponibili');
  // La miniera player-scoped non sostituisce la sorgente mondiale assente.
  await expect(page.locator('.maplibregl-marker', { hasText: 'fallback legacy' })).toHaveCount(0);
});

// F — mobile: il dataset reale resta leggibile a 360×740.
test('MAP P6.2 / F — 360×740: marker e impianto reale cliccabili', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openModernMap(page);
  await selectLayer(page, 'Infrastrutture');
  await focusRegion(page, 'NLNH');
  const marker = facilityMarker(page, 'facility:NLNH:refinery:1');
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(16);
  // Due impianti nella stessa provincia: il target di tocco non si copre.
  const neighbour = facilityMarker(page, 'facility:NLNH:refinery:2');
  await expect(neighbour).toBeVisible();
  const neighbourBox = await neighbour.boundingBox();
  expect(Math.hypot(neighbourBox.x - box.x, neighbourBox.y - box.y)).toBeGreaterThanOrEqual(box.width);
  const before = await camera(page);
  await marker.click();
  const noordHolland = context(page, REGION_ID('NLNH'));
  const plant = noordHolland.locator('[data-infrastructure-item="facility:NLNH:refinery:1"]');
  await expect(plant).toBeVisible();
  await plant.scrollIntoViewIfNeeded();
  await expect(plant).toContainText('Proprietario: Raffinazione privata (USA)');
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  // La camera non si è mossa da sola per effetto del click sul marker.
  expect(await camera(page)).toEqual(before);
});
