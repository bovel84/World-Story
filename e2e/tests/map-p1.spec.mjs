/**
 * MAP P1 — superficie cartografica completa e leggibilità geografica.
 * ==================================================================
 * Regressioni E2E sulle promesse di MAP P1: pan in ogni direzione, selezione
 * provincia, ricerca con focus reale, aggiornamento dinamico di owner/colore
 * senza remount, e uso completo su viewport mobile.
 *
 * Harness: mock API nel browser (nessun backend, nessuna rete esterna).
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, south, east, north) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
} });
const territory = (id, name, color, geojson, objects = []) => ({
  id, name, polityName: name, owner: id, flag: id, color, geojson, objects,
  population: 1000000, militaryPower: 30, gdp: 300, borders: [], status: 'active', metadata: {},
});
// Mondo **ampio** in longitudine: serve a verificare che si possa scorrere fino
// agli estremi est/ovest (la vecchia regressione «mappa non scorre a destra»).
const game = {
  ...MOCK_GAME,
  players: [{ id: 'player', regionId: 'ITA', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA: territory('ITA', 'Italia', '#609f87', polygon(9, 37, 17, 46), [
      { id: 'city', type: 'city', name: 'Città Nuova', lat: 41, lng: 12, pop: 4 },
      // Snapshot volutamente stale: renderer e ricerca devono entrambi usare
      // Roma dal registro canonico ([12.5, 41.9]), non questo punto.
      { id: 'roma-stale', type: 'city', name: 'Roma', lat: 20, lng: 80, pop: 2.8 },
      { id: 'army', type: 'army', name: 'Prima armata', lat: 44, lng: 12, owner: 'ITA' },
    ]),
    FRA: territory('FRA', 'Francia', '#679cc2', polygon(-4, 43, 8, 51)),
    DEU: territory('DEU', 'Germania', '#b29276', polygon(9, 48, 16, 55)),
    EST: territory('EST', 'Estland', '#c0a060', polygon(140, 40, 160, 55)),
    WST: territory('WST', 'Westland', '#7a9ec0', polygon(-170, 30, -150, 45)),
    BAD: territory('BAD', 'Dati incompleti', '#333333', '{broken'),
  } },
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

async function openMap(page, expectedFeatures = 5) {
  installMockApi(page);
  await installStoreBridge(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async game => {
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
    useGameStore.setState({ currentWorld: game.world, currentGame: game, selectedCountry: 'ITA', selectedRegion: null });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, game);
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
  await expect.poll(() => page.evaluate(async () => (await window.__testMap?.getSource('regions')?.getData())?.features.length)).toBe(expectedFeatures);
}

/** Trascinamento reale sul canvas: sposta il contenuto della mappa. */
async function dragMap(page, dx, dy, steps = 12) {
  const canvas = page.locator('.maplibregl-canvas');
  const box = await canvas.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
}

const center = (page) => page.evaluate(() => window.__testMap.getCenter().toArray());
/** Coordinata geografica al centro dello schermo: sensore non ambiguo del pan. */
const screenCenterLng = (page) => page.evaluate(() => {
  const map = window.__testMap;
  const canvas = map.getCanvas();
  return map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]).lng;
});

test('MAP P1 / A1 — un drag reale scopre il lato est (regressione «mappa non scorre a destra»)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMap(page);
  // Zoom alto: un drag di 420px copre ~18°, mai l'intero giro (nessun wrap).
  await page.evaluate(() => window.__testMap.jumpTo({ center: [0, 20], zoom: 4 }));
  await page.waitForTimeout(200);
  const before = await screenCenterLng(page);
  await dragMap(page, -420, 0);
  await page.waitForTimeout(600);
  const after = await screenCenterLng(page);
  expect(after).toBeGreaterThan(before + 3);
  expect(errors).toEqual([]);
});

test('MAP P1 / A2 — un drag reale scopre il lato ovest', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [0, 20], zoom: 4 }));
  await page.waitForTimeout(200);
  const before = await screenCenterLng(page);
  await dragMap(page, 420, 0);
  await page.waitForTimeout(600);
  const after = await screenCenterLng(page);
  expect(after).toBeLessThan(before - 3);
  expect(errors).toEqual([]);
});

test('MAP P1 / A3 — gli estremi est/ovest non sono bloccati da maxBounds', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [170, 10], zoom: 1 }));
  expect(Math.abs((await center(page))[0] - 170)).toBeLessThan(1);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [-170, 10], zoom: 1 }));
  expect(Math.abs((await center(page))[0] + 170)).toBeLessThan(1);
});

test('MAP P1 / B — selezione di una provincia: highlight, inspector e nome corretto', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [13, 41.5], zoom: 4 }));
  const point = await page.evaluate(() => {
    const p = window.__testMap.project([13, 41.5]);
    const rect = window.__testMap.getCanvas().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-map-context="region"][data-map-context-id="ITA"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__testMap.getFeatureState({ source: 'regions', id: 'ITA' }).selected)).toBe(true);
  // Chiudere l'inspector non deve perdere la posizione della mappa.
  const before = await center(page);
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();
  await expect(page.locator('.province-inspector')).toHaveCount(0);
  expect(await center(page)).toEqual(before);
});

test('MAP P1 / C — la ricerca di una città centra il risultato e seleziona la regione', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [0, 20], zoom: 1 }));
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  // Normalizzazione accenti: «citta» trova «Città Nuova».
  await search.fill('citta');
  await expect(page.locator('.map-search-results')).toContainText('Città Nuova');
  await search.press('Enter');
  // Il punto cercato è davvero centrato: lo zoom sale e la città resta nel viewport.
  await expect.poll(() => page.evaluate(() => window.__testMap.getZoom())).toBeGreaterThan(4);
  await expect.poll(() => page.evaluate(() => window.__testMap.getFeatureState({ source: 'regions', id: 'ITA' }).selected)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const marker = document.querySelector('[data-object-id="city"]');
    if (!marker || getComputedStyle(marker).display === 'none') return false;
    const rect = marker.getBoundingClientRect();
    const canvas = window.__testMap.getCanvas().getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    return cx > canvas.left && cx < canvas.right && cy > canvas.top && cy < canvas.bottom;
  })).toBe(true);
});

test('MAP P1.1 — renderer e ricerca usano la stessa coordinata canonica', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [12.5, 41.9], zoom: 5 }));
  const marker = page.locator('[data-object-id="roma-stale"]');
  await expect(marker).toBeVisible();

  // Il marker ignora le coordinate stale [80, 20] ed è ancorato a Roma canonica.
  const markerOffset = await page.evaluate(() => {
    const map = window.__testMap;
    const projected = map.project([12.5, 41.9]);
    const canvas = map.getCanvas().getBoundingClientRect();
    const rect = document.querySelector('[data-object-id="roma-stale"]').getBoundingClientRect();
    return {
      x: Math.abs(rect.left + rect.width / 2 - (canvas.left + projected.x)),
      y: Math.abs(rect.top + rect.height / 2 - (canvas.top + projected.y)),
    };
  });
  expect(markerOffset.x).toBeLessThan(2);
  expect(markerOffset.y).toBeLessThan(2);

  await page.evaluate(() => {
    const map = window.__testMap;
    map.jumpTo({ center: [0, 20], zoom: 1 });
    const flyTo = map.flyTo;
    map.flyTo = function (options, eventData) {
      window.__lastSearchCenter = Array.from(options.center);
      return flyTo.call(this, options, eventData);
    };
  });
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill('Roma');
  await search.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__lastSearchCenter)).toEqual([12.5, 41.9]);
  await expect.poll(() => page.evaluate(() => window.__testMap.getZoom())).toBeGreaterThan(4);

  // Anche dopo il resize causato dall'inspector, Roma canonica resta nel
  // viewport e vicino al centro; il punto stale è fuori dalla vista.
  const finalView = await page.evaluate(() => {
    const map = window.__testMap;
    const canvas = map.getCanvas();
    const inside = ([lng, lat]) => {
      const p = map.project([lng, lat]);
      return p.x >= 0 && p.x <= canvas.clientWidth && p.y >= 0 && p.y <= canvas.clientHeight;
    };
    const center = map.getCenter();
    return {
      center: center.toArray(),
      canonicalInside: inside([12.5, 41.9]),
      staleInside: inside([80, 20]),
    };
  });
  expect(finalView.canonicalInside).toBe(true);
  expect(finalView.staleInside).toBe(false);
  expect(Math.abs(finalView.center[0] - 12.5)).toBeLessThan(8);
  expect(Math.abs(finalView.center[1] - 41.9)).toBeLessThan(2);
});

test('MAP P1 / D — cambio owner/colore senza remount: canvas stabile, feature aggiornata', async ({ page }) => {
  await openMap(page);
  await page.evaluate(() => {
    window.__beforeCanvas = window.__testMap.getCanvas();
    window.__beforeCenter = window.__testMap.getCenter().toArray();
    window.__sourceUpdates = 0;
    const source = window.__testMap.getSource('regions');
    for (const method of ['setData', 'updateData']) {
      const original = source[method];
      source[method] = function (...args) { window.__sourceUpdates++; return original.apply(this, args); };
    }
  });
  await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    const regions = { ...store.currentWorld.regions };
    regions.ITA = { ...regions.ITA, owner: 'FRA', color: '#cc9966' };
    store.setCurrentWorld({ ...store.currentWorld, regions });
  });
  await expect.poll(() => page.evaluate(async () => {
    const data = await window.__testMap.getSource('regions').getData();
    return data.features.find(feature => feature.id === 'ITA').properties;
  })).toMatchObject({ owner: 'FRA', color: '#cc9966' });
  const state = await page.evaluate(() => ({
    sameCanvas: window.__beforeCanvas === window.__testMap.getCanvas(),
    center: window.__testMap.getCenter().toArray(),
    before: window.__beforeCenter,
    updates: window.__sourceUpdates,
  }));
  expect(state.sameCanvas).toBe(true);
  // Un cambio dati non recentra la mappa.
  expect(state.center).toEqual(state.before);
  expect(state.updates).toBe(1);
});

test('MAP P1 / E — 360px: pan, zoom, ricerca, selezione e nessun overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 740 });
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [12, 42], zoom: 3 }));
  const before = await center(page);
  await dragMap(page, -120, 0, 8);
  const after = await center(page);
  expect(after[0]).not.toBe(before[0]);
  await page.getByRole('button', { name: 'Ingrandisci' }).click();
  await expect.poll(() => page.evaluate(() => window.__testMap.getZoom())).toBeGreaterThan(3);
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill('Italia');
  await search.press('Enter');
  await expect(page.locator('[data-map-context="region"][data-map-context-id="ITA"]')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
    map: document.querySelector('.map-keyboard-surface').getBoundingClientRect(),
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  // La mappa deve conservare una porzione significativa del viewport.
  expect(dimensions.map.width).toBeGreaterThan(300);
  expect(dimensions.map.height).toBeGreaterThan(400);
  expect(errors).toEqual([]);
});
