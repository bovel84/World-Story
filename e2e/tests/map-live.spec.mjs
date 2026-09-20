import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, south, east, north) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
} });
const territory = (id, name, color, geojson, objects = []) => ({
  id, name, polityName: name, owner: id, flag: id, color, geojson, objects,
  population: 1000000, militaryPower: 30, gdp: 300, borders: [], status: 'active', metadata: {},
});
const game = { ...MOCK_GAME, players: [{ id: 'player', regionId: 'ITA', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA: territory('ITA', 'Italia', '#609f87', polygon(9, 37, 17, 46), [
      { id: 'city', type: 'city', name: 'Città Nuova', lat: 41, lng: 12, pop: 4 },
      { id: 'army', type: 'army', name: 'Prima armata', lat: 44, lng: 12, owner: 'ITA' },
      { id: 'port', type: 'port', name: 'Porto orientale', lat: 41, lng: 16 },
      { id: 'factory', type: 'factory', name: 'Acciaieria', lat: 39, lng: 14 },
    ]),
    FRA: territory('FRA', 'Francia', '#679cc2', polygon(-4, 43, 8, 51)),
    DEU: territory('DEU', 'Germania', '#b29276', polygon(9, 48, 16, 55)),
    BAD: territory('BAD', 'Dati incompleti', '#333333', '{broken'),
  } },
};

/**
 * Ponte verso i moduli dell'applicazione già caricati dal grafo Vite.
 *
 * Importare a mano `/src/stores/gameStore.ts` creerebbe una SECONDA istanza del
 * modulo (Vite appende `?t=` agli import del grafo): lo stato verrebbe scritto
 * su uno store che React non osserva, quindi la partita non comparirebbe mai.
 * Risolviamo l'URL reale dalle risorse di rete già scaricate, così l'import
 * dinamico restituisce la stessa istanza usata dall'app.
 */
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

async function openMap(page) {
  installMockApi(page);
  await installStoreBridge(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async game => {
    // Dev-only instrumentation, no test hooks shipped in the application.
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
  await expect.poll(() => page.evaluate(async () => (await window.__testMap?.getSource('regions')?.getData())?.features.length)).toBe(3);
}

async function patchWorld(page, transform) {
  await page.evaluate(async transform => {
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    const regions = { ...store.currentWorld.regions };
    if (transform === 'update') {
      regions.ITA = { ...regions.ITA, name: 'Italia aggiornata', owner: 'FRA', color: '#cc9966',
        objects: regions.ITA.objects.map(object => object.id === 'army'
          ? { ...object, name: 'Armata rinforzata', lng: 13, metadata: { status: 'operativa' } } : object) };
      const geometry = JSON.parse(regions.ITA.geojson);
      geometry.geometry.coordinates[0][1][0] = 18;
      geometry.geometry.coordinates[0][2][0] = 18;
      regions.ITA.geojson = JSON.stringify(geometry);
      regions.NEW = { ...regions.DEU, id: 'NEW', name: 'Nuovo territorio' };
      delete regions.FRA;
    } else if (transform === 'move') {
      const army = regions.ITA.objects.find(object => object.id === 'army');
      regions.ITA = { ...regions.ITA, objects: regions.ITA.objects.filter(object => object.id !== 'army') };
      regions.DEU = { ...regions.DEU, objects: [...regions.DEU.objects, { ...army, lat: 50, lng: 12 }] };
    } else if (transform === 'remove') {
      for (const id of ['ITA', 'DEU']) regions[id] = { ...regions[id], objects: regions[id].objects.filter(object => object.id !== 'army') };
    }
    store.setCurrentWorld({ ...store.currentWorld, regions });
    store.setChangedRegions(['ITA']);
  }, transform);
}

test('live updates preserve camera, marker identity and open popup; hover does not upload GeoJSON', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMap(page);
  await page.evaluate(() => {
    const map = window.__testMap;
    map.jumpTo({ center: [11, 45], zoom: 3 });
    window.__before = { center: map.getCenter().toArray(), zoom: map.getZoom(), canvas: map.getCanvas(),
      marker: document.querySelector('[data-object-id="army"]') };
    const source = map.getSource('regions');
    window.__sourceUpdates = 0;
    for (const method of ['setData', 'updateData']) {
      const original = source[method];
      source[method] = function (...args) { window.__sourceUpdates++; return original.apply(this, args); };
    }
  });
  const army = page.locator('[data-object-id="army"]');
  await expect.poll(() => page.evaluate(() => {
    const marker = document.querySelector('[data-object-id="factory"]').getBoundingClientRect();
    const canvas = window.__testMap.getCanvas().getBoundingClientRect();
    const point = window.__testMap.project([14, 39]);
    return Math.hypot(marker.left + marker.width / 2 - canvas.left - point.x, marker.top + marker.height / 2 - canvas.top - point.y);
  })).toBeLessThan(2);
  await army.click();
  await expect(page.locator('.maplibregl-popup')).toContainText('Prima armata');
  const coordinates = await page.evaluate(() => {
    const point = window.__testMap.project([14, 42]);
    const rect = window.__testMap.getCanvas().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await page.mouse.move(coordinates.x, coordinates.y);
  await expect.poll(() => page.evaluate(() => window.__testMap.getFeatureState({ source: 'regions', id: 'ITA' }).hovered)).toBe(true);
  expect(await page.evaluate(() => window.__sourceUpdates)).toBe(0);
  await patchWorld(page, 'update');
  await expect(page.locator('.maplibregl-popup')).toContainText('Armata rinforzata');
  await expect.poll(() => page.evaluate(async () => (await window.__testMap.getSource('regions').getData()).features.map(feature => feature.id).sort())).toEqual(['DEU', 'ITA', 'NEW']);
  const state = await page.evaluate(() => ({
    sameCanvas: window.__before.canvas === window.__testMap.getCanvas(),
    sameMarker: window.__before.marker === document.querySelector('[data-object-id="army"]'),
    center: window.__testMap.getCenter().toArray(), zoom: window.__testMap.getZoom(),
    before: { center: window.__before.center, zoom: window.__before.zoom }, updates: window.__sourceUpdates,
  }));
  expect(state.sameCanvas).toBe(true);
  expect(state.sameMarker).toBe(true);
  expect(state.center).toEqual(state.before.center);
  expect(state.zoom).toBe(state.before.zoom);
  expect(state.updates).toBe(1);
  expect(await page.evaluate(async () => (await window.__testMap.getSource('regions').getData()).features.find(feature => feature.id === 'ITA').geometry.coordinates[0][1][0])).toBe(18);
  await patchWorld(page, 'move');
  await expect(page.locator('.maplibregl-popup')).toContainText('Armata rinforzata');
  expect(await page.evaluate(() => window.__before.marker === document.querySelector('[data-object-id="army"]'))).toBe(true);
  expect(await page.evaluate(() => window.__sourceUpdates)).toBe(1);
  await patchWorld(page, 'remove');
  await expect(army).toHaveCount(0);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await page.getByRole('button', { name: /Modifiche 1/ }).click();
  await expect(page.locator('.map-search-results')).toContainText('Italia aggiornata');
  expect(errors).toEqual([]);
});

test('deleting the inspected region closes the dossier; opening a different world resets the map', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMap(page);
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill('Francia');
  await search.press('Enter');
  await expect(page.getByRole('region', { name: 'Dossier Francia', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    const regions = { ...store.currentWorld.regions };
    delete regions.FRA;
    store.setCurrentWorld({ ...store.currentWorld, regions });
    store.setChangedRegions(['ITA']);
  });
  await expect(page.locator('.province-inspector')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.evaluate(async () => {
    window.__oldCanvas = window.__testMap.getCanvas();
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    store.setChangedRegions([]);
    store.setCurrentWorld({ ...store.currentWorld, id: 'another-world', regions: { ITA: store.currentWorld.regions.ITA } });
  });
  await expect(search).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__testMap.getCanvas() !== window.__oldCanvas)).toBe(true);
  // I territori toccati restano elencati per la sessione (sessionStorage):
  // cambiare mondo non svuota l'elenco «Modifiche», solo il canvas è nuovo.
  await expect(page.getByRole('button', { name: /^Modifiche 1$/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an array snapshot from the server accepts live SSE unit and territory changes', async ({ page }) => {
  await page.addInitScript(() => {
    window.__eventSources = [];
    window.EventSource = class extends EventTarget {
      constructor(url) { super(); this.url = url; window.__eventSources.push(this); }
      close() {}
    };
  });
  await openMap(page);
  await page.evaluate(async game => {
    const { useGameStore } = await window.__wsAppModules();
    // This is the real HTTP/save wire format, not the keyed mock fixture.
    useGameStore.getState().setCurrentWorld({ ...game.world, regions: Object.values(game.world.regions) });
  }, game);
  await page.evaluate(() => {
    const stream = window.__eventSources.findLast(source => source.url.includes('/games/'));
    stream.dispatchEvent(new MessageEvent('jump_event', { data: JSON.stringify({
      checkpoint: true, index: 0, revision: 2, eventId: 'live-map-change',
      event: { date: '1951-01-15', headline: 'La formazione avvia il reclutamento', description: 'I reparti sono in formazione.' },
      changedRegions: [{ id: 'ITA', name: 'Territorio aggiornato', owner: 'DEU', color: '#be5e6f',
        objects: [{ id: 'live-unit', type: 'mobilization', name: 'Eroi', lat: 42, lng: 14, metadata: { status: 'forming', plannedType: 'battalion' } }],
      }],
    }) }));
  });
  await expect(page.locator('[data-object-id="live-unit"]')).toBeVisible();
  await expect(page.locator('[data-object-id="army"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const data = await window.__testMap.getSource('regions').getData();
    return data.features.find(feature => feature.id === 'ITA').properties;
  })).toMatchObject({ owner: 'DEU', color: '#be5e6f', name: 'Territorio aggiornato' });
});

test('construction reports show the same live phase in map popup and province dossier', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    const region = store.currentWorld.regions.ITA;
    store.setCurrentWorld({ ...store.currentWorld, regions: { ...store.currentWorld.regions, ITA: {
      ...region, objects: [...region.objects, { id: 'site', type: 'construction_site', name: 'Nuovo porto', lat: 42, lng: 10,
        metadata: { plannedType: 'port', phase: 'foundations', status: 'paused', blocker: 'Consegna dei materiali in ritardo', nextStep: 'Riprendere le fondazioni', expectedDate: '1951-06-01' } }],
    } } });
    window.__testMap.jumpTo({ center: [12, 43], zoom: 4 });
  });
  await page.locator('[data-object-id="site"]').click();
  await expect(page.locator('.maplibregl-popup')).toContainText('Fondazioni');
  await expect(page.locator('.maplibregl-popup')).toContainText('Lavori sospesi');
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill('Italia');
  await search.press('Enter');
  const dossier = page.getByRole('region', { name: 'Cantieri nel territorio' });
  await expect(dossier).toContainText('Consegna dei materiali in ritardo');
  await expect(dossier).toContainText('Previsione (non garantita)');
  await dossier.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/world-story-construction-mobile.png' });
  await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    const store = useGameStore.getState();
    const region = store.currentWorld.regions.ITA;
    store.setCurrentWorld({ ...store.currentWorld, regions: { ...store.currentWorld.regions, ITA: {
      ...region, objects: region.objects.map(object => object.id === 'site' ? { ...object, type: 'port', metadata: { status: 'operational' } } : object),
    } } });
  });
  await expect(dossier).toHaveCount(0);
});

for (const width of [1440, 390, 320]) {
  test(`tactical routes and battle dispatches work at ${width}px with reduced motion`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__eventSources = [];
      window.EventSource = class extends EventTarget {
        constructor(url) { super(); this.url = url; window.__eventSources.push(this); }
        close() {}
      };
    });
    await openMap(page);
    await page.evaluate(async () => {
      const { useGameStore } = await window.__wsAppModules();
      const store = useGameStore.getState();
      const regions = store.currentWorld.regions;
      const army = regions.ITA.objects.find(object => object.id === 'army');
      window.__armyBefore = document.querySelector('[data-object-id="army"]');
      window.__testMap.jumpTo({ center: [12, 47], zoom: innerWidth < 500 ? 3 : 4 });
      const stream = window.__eventSources.findLast(source => source.url.includes('/games/'));
      stream.dispatchEvent(new MessageEvent('jump_event', { data: JSON.stringify({
        checkpoint: true, index: 0, revision: 2, eventId: 'battle-germany',
        event: { date: '1951-02-01', headline: 'Battaglia in Germania', description: 'La Prima armata avanza. I difensori ripiegano oltre il fiume.' },
        changedRegions: [
          { ...regions.ITA, objects: regions.ITA.objects.filter(object => object.id !== 'army') },
          { ...regions.DEU, objects: [{ ...army, lng: 13, lat: 50, metadata: { movedDate: '1951-02-01', previousRegionId: 'ITA', previousRegionName: 'Italia', previousLng: 12, previousLat: 44 } }] },
        ],
      }) }));
    });
    await expect(page.locator('.news-flash')).toBeVisible();
    await page.keyboard.press('Escape');
    const summary = page.getByRole('button', { name: 'Apri situazione militare' });
    await expect(summary).toContainText('1 spostamento');
    await expect(summary).toContainText('1 scontro');
    const route = page.locator('[data-route-id="army"] .tactical-route-line');
    await expect(route).toHaveCount(1);
    expect(await route.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    expect(await page.evaluate(() => window.__armyBefore === document.querySelector('[data-object-id="army"]'))).toBe(true);
    const battle = page.getByRole('button', { name: 'Leggi il dispaccio: Battaglia in Germania' });
    await expect(battle).toBeVisible();
    await page.screenshot({ path: `/tmp/world-story-battles-${width}.png` });
    await battle.click();
    const report = page.getByRole('dialog', { name: 'Situazione militare' });
    await expect(report).toContainText('I difensori ripiegano oltre il fiume.');
    // Il rapporto di battaglia è un overlay fixed della mappa: deve stare SOPRA
    // rail e desk. Un contesto di impilamento sulla mappa lo intrappolerebbe
    // sotto la shell (regressione già vista con `isolation: isolate`).
    expect(await page.evaluate(() => {
      const rail = document.querySelector('.game-shell-rail .rail-btn');
      if (!rail) return false;
      const box = rail.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(top?.closest('.tactical-report-backdrop'));
    })).toBe(true);
    await page.screenshot({ path: `/tmp/world-story-battle-report-${width}.png` });
    await page.keyboard.press('Escape');
    await summary.click();
    await expect(report).toContainText('Italia → Germania');
    await page.keyboard.press('Escape');
    const legend = page.getByRole('button', { name: /Livelli e legenda/ });
    if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
    await page.getByRole('checkbox', { name: 'Unità e fronti' }).uncheck();
    await expect(route).toHaveCount(0);
    await expect(battle).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Unità e fronti' }).check();
    await expect(route).toHaveCount(1);
    await page.evaluate(async () => {
      const { useGameStore } = await window.__wsAppModules();
      const store = useGameStore.getState();
      store.setCurrentGame({ ...store.currentGame, currentDate: '1951-03-15' });
    });
    await expect(route).toHaveCount(0);
    await expect(battle).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a moving unit animates between committed coordinates without moving the camera', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [12, 47], zoom: 4 }));
  const start = await page.locator('[data-object-id="army"]').boundingBox();
  await patchWorld(page, 'move');
  const distance = async () => page.evaluate(() => {
    const rect = document.querySelector('[data-object-id="army"]').getBoundingClientRect();
    const canvas = window.__testMap.getCanvas().getBoundingClientRect();
    const target = window.__testMap.project([12, 50]);
    return Math.hypot(rect.left + rect.width / 2 - canvas.left - target.x, rect.top + rect.height / 2 - canvas.top - target.y);
  });
  // The first committed update starts a short traversal, not an instantaneous teleport.
  expect(await distance()).toBeGreaterThan(10);
  await expect.poll(distance).toBeLessThan(2);
  const end = await page.locator('[data-object-id="army"]').boundingBox();
  expect(Math.abs(end.y - start.y)).toBeGreaterThan(30);
  expect(await page.evaluate(() => window.__testMap.getCenter().toArray())).toEqual([12, 47]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`search, layers, filters and resize at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMap(page);
    const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
    await search.fill('citta');
    await expect(page.locator('.map-search-results')).toContainText('Città Nuova');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.map-search-results')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__testMap.getFeatureState({ source: 'regions', id: 'ITA' }).selected)).toBe(true);
    // Close the dossier opened by location selection to expose map controls on mobile.
    await page.getByRole('button', { name: 'Chiudi dossier provincia' }).click();
    const legend = page.getByRole('button', { name: /Livelli e legenda/ });
    if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
    await page.getByRole('radio', { name: 'Terreno', exact: true }).check();
    await expect(page.locator('.world-map')).toHaveAttribute('data-map-layer', 'terrain');
    expect(await page.evaluate(() => window.__testMap.getPaintProperty('regions-fill', 'fill-opacity').at(-1))).toBe(0.12);
    await page.getByRole('checkbox', { name: 'Unità e fronti' }).uncheck();
    await expect(page.locator('[data-object-id="army"]')).toBeHidden();
    await page.getByRole('checkbox', { name: 'Unità e fronti' }).check();
    await page.getByRole('checkbox', { name: 'Città', exact: true }).uncheck();
    await expect(page.locator('[data-object-id="city"]')).toBeHidden();
    await page.getByRole('checkbox', { name: 'Città', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Porti e basi navali' }).uncheck();
    await expect(page.locator('[data-object-id="port"]')).toBeHidden();
    await page.getByRole('checkbox', { name: 'Porti e basi navali' }).check();
    await page.getByRole('checkbox', { name: 'Opere e industria' }).uncheck();
    await expect(page.locator('[data-object-id="factory"]')).toBeHidden();
    await page.getByRole('checkbox', { name: 'Opere e industria' }).check();
    await page.getByRole('radio', { name: 'Politica', exact: true }).check();
    await legend.click();
    await page.getByRole('button', { name: '◎ Mondo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__testMap.isMoving())).toBe(false);
    await expect(page.locator('.openpax-country-label[data-owner="FRA"]')).toBeHidden();
    await page.screenshot({ path: `/tmp/world-story-map-${viewport.width}.png` });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      canvas: document.querySelector('.maplibregl-canvas').clientWidth,
      host: document.querySelector('.map-keyboard-surface').clientWidth,
      controls: [...document.querySelectorAll('.map-tools button')].map(button => {
        const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height };
      }),
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.canvas).toBe(dimensions.host);
    for (const control of dimensions.controls) {
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(dimensions.viewport);
      expect(control.height).toBeGreaterThanOrEqual(44);
    }
  });
}
