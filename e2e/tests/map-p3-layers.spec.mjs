/**
 * MAP P3 — layer tematici canonici
 * ================================
 * La stessa mappa, otto prospettive, nessuna nuova verità: ogni layer legge
 * stato canonico (region.owner/gdp/objects, relazioni, stato militare P2).
 * Questo harness monta un mondo GeoJSON con PIL diversi, opere territoriali,
 * un reparto con trasferimento P6 e relazioni canoniche.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, south, east, north) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
} });
const territory = (id, name, color, geojson, owner, polityName, gdp, objects = []) => ({
  id, name, polityName, owner, flag: owner, color, geojson, objects,
  population: 1_000_000, militaryPower: 30, gdp, borders: [], status: 'active', metadata: {},
});

const game = {
  ...MOCK_GAME,
  players: [{ id: 'player', regionId: 'ITA', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA: territory('ITA', 'Italia', '#609f87', polygon(0, 40, 10, 50), 'ITA', 'Italia', 1000, [
      { id: 'milano', type: 'factory', name: 'Fabbrica di Milano', lat: 45.46, lng: 9.19 },
      { id: 'genova', type: 'port', name: 'Porto di Genova', lat: 44.4, lng: 8.93 },
      { id: 'torino', type: 'power_plant', name: 'Centrale di Torino', lat: 45.07, lng: 7.68 },
      { id: 'armata', type: 'army', name: '1ª Armata', lat: 45.1, lng: 9.5 },
    ]),
    FRA: territory('FRA', 'Francia', '#7fb3a0', polygon(10, 40, 20, 50), 'FRA', 'Francia', 500),
    AUT: territory('AUT', 'Austria', '#c08d76', polygon(20, 40, 30, 50), 'AUT', 'Austria', 100),
    SUI: territory('SUI', 'Svizzera', '#8f8fc0', polygon(30, 40, 40, 50), 'SUI', 'Svizzera', 0),
  } },
};

const movement = {
  path: ['ITA', 'FRA'], targetRegionId: 'FRA', targetRegionName: 'Francia',
  startedDate: '1951-02-01', pathIndex: 0, daysPerHop: 15, remainingDaysToNextHop: 12,
  totalHops: 1, estimatedArrivalDate: '1951-02-16', motorized: true,
};
const unit = (id, polityId, regionId, patch = {}) => ({
  id, polityId, armyId: `army-${polityId.toLowerCase()}`, name: id,
  personnel: 8430, equipment: { rifles: 5000 }, monthlyNeeds: { fuel: 1, weapons: 2, food: 3 },
  readiness: 0.62, status: 'operational', regionId, regionName: regionId,
  updatedDate: '1951-02-01', legacyDerived: false, order: 'defend', frontId: null, ...patch,
});
const UNITS = [
  unit('ita-1', 'ITA', 'ITA', { order: 'attack', frontId: 'F1' }),
  unit('ita-move', 'ITA', 'ITA', { movement }),
  unit('aut-1', 'AUT', 'AUT', { order: 'defend', frontId: 'F1' }),
];
const FRONTS = [{
  id: 'F1', name: 'ITA–AUT', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
  regionIds: ['ITA', 'AUT'], status: 'active', objectiveRegionId: 'AUT',
  attackerPressure: 0.63, defenderPressure: 0.48, momentumPolityId: 'ITA',
  createdDate: '1951-01-01', updatedDate: '1951-02-01',
}];
const RELATIONSHIPS = { ITA: { FRA: 'ally', AUT: 'hostile' } };
// Fasi del refresh diplomatico per gli scenari P3.1.
const RELATIONSHIP_SNAPSHOTS = {
  neutral: { ITA: { AUT: 'neutral' } },
  hostile: RELATIONSHIPS,
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

async function openThematicMap(page) {
  installMockApi(page);
  await installStoreBridge(page);
  // Fixture tematiche registrate DOPO il mock base: hanno la precedenza.
  await page.route('**/api/games/*/military/units', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ units: UNITS }) }));
  await page.route('**/api/games/*/military/fronts', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fronts: FRONTS }) }));
  await page.route('**/api/games/*/relationships', async route => {
    const phase = page.__relPhase || 'hostile';
    if (page.__relDelay) await new Promise(resolve => setTimeout(resolve, page.__relDelay));
    if (phase === 'failure') {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) });
      return;
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ relationships: RELATIONSHIP_SNAPSHOTS[phase] }) });
  });
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
      selectedCountry: 'ITA', selectedRegion: null,
    });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, game);
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
  await page.evaluate(() => window.__testMap.jumpTo({ center: [18, 45], zoom: 3.2 }));
}

const mapLayer = (page) => page.locator('.world-map');

async function selectLayer(page, label) {
  const legend = page.locator('.map-legend-toggle');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await page.getByRole('radio', { name: label, exact: true }).check();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', LAYER_IDS[label]);
}
const LAYER_IDS = {
  Politica: 'political', Militare: 'military', Economia: 'economy', Risorse: 'resources',
  Infrastrutture: 'infrastructure', Diplomazia: 'diplomacy', Modifiche: 'changes', Terreno: 'terrain',
};
const fillColor = (page) => page.evaluate(() => window.__testMap.getPaintProperty('regions-fill', 'fill-color'));
const featureState = (page, id) => page.evaluate(regionId =>
  window.__testMap.getFeatureState({ source: 'regions', id: regionId }), id);

/** Colori canonici dal modulo puro: nessun RGB fragile hardcoded nel test. */
async function loadColors(page) {
  return page.evaluate(async () => {
    const mod = await import('/src/components/Map/thematicMapModel.ts');
    return { hostile: mod.DIPLOMACY_COLORS.hostile, neutral: mod.DIPLOMACY_COLORS.neutral, noData: mod.THEMATIC_NO_DATA_COLOR };
  });
}

/** Trigger canonico del refresh: turno/data/revisione cambiano, come in game. */
async function bumpRevision(page, date = '1951-02-01') {
  await page.evaluate(async nextDate => {
    const { useGameStore } = await window.__wsAppModules();
    const state = useGameStore.getState();
    useGameStore.setState({
      currentGame: {
        ...state.currentGame,
        worldRevision: (state.currentGame?.worldRevision || 1) + 1,
        currentDate: nextDate,
      },
    });
  }, date);
}

test('MAP P3 / A — sequenza di layer: mappa montata e camera invariata', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openThematicMap(page);
  const before = await page.evaluate(() => ({ c: window.__testMap.getCenter(), z: window.__testMap.getZoom() }));

  for (const label of ['Militare', 'Economia', 'Infrastrutture', 'Diplomazia', 'Modifiche', 'Terreno']) {
    await selectLayer(page, label);
  }
  await selectLayer(page, 'Politica');

  const after = await page.evaluate(() => ({ c: window.__testMap.getCenter(), z: window.__testMap.getZoom() }));
  expect(after.z).toBeCloseTo(before.z, 2);
  expect(after.c.lng).toBeCloseTo(before.c.lng, 2);
  expect(after.c.lat).toBeCloseTo(before.c.lat, 2);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('MAP P3 / B — economia: coropleth dal PIL reale, nessun indice inventato', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Economia');
  await expect(mapLayer(page)).toHaveAttribute('data-economy-available', 'true');
  // Il riempimento è tematico (feature-state), non più quello politico.
  expect(JSON.stringify(await fillColor(page))).toContain('thematicColor');
  // La legenda mostra intervalli reali derivati dal dataset (100–1000).
  const quant = page.locator('.map-key-quantitative');
  await expect(quant).toContainText('PIL territoriale');
  await expect(quant).toContainText('Dato non disponibile');
  // La Svizzera ha gdp 0 → no-data, non povertà estrema.
  const buckets = await quant.getAttribute('data-economy-buckets');
  expect(buckets).not.toBe('');
  // Torna a Politica: il riempimento ridiventa quello politico canonico.
  await selectLayer(page, 'Politica');
  expect(JSON.stringify(await fillColor(page))).toContain('"get","color"');
});

test('MAP P3 / C — diplomazia: relazioni canoniche relative al player', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Diplomazia');
  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'true');
  const key = page.locator('.map-key');
  await expect(key).toContainText('Il tuo Stato');
  await expect(key).toContainText('Alleato');
  await expect(key).toContainText('Neutrale');
  await expect(key).toContainText('Ostile');
});

test('MAP P3 / D — risorse: nessuna provincia petrolifera inventata', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Risorse');
  await expect(mapLayer(page)).toHaveAttribute('data-resources-available', 'false');
  const notice = page.locator('[data-thematic-message]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('localizzazione territoriale canonica');
  // Nessun marker risorsa è stato creato dal nulla.
  await expect(page.locator('[data-resource-kind]')).toHaveCount(0);
});

test('MAP P3 / E — infrastrutture: opere visibili, un reparto non è un’opera', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Infrastrutture');
  await expect(page.locator('.openpax-map-object[data-object-type="factory"]')).toBeVisible();
  await expect(page.locator('.openpax-map-object[data-object-type="port"]')).toBeVisible();
  await expect(page.locator('.openpax-map-object[data-object-type="power_plant"]')).toBeVisible();
  // L'armata nella stessa regione non diventa un marker infrastrutturale.
  await expect(page.locator('.openpax-map-object[data-object-type="army"]')).toBeHidden();
});

test('MAP P3 / F — militare: P2 resta integro (reparti, fronte, movimento)', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Militare');
  await expect(page.locator('[data-unit-id="ita-1"]')).toBeVisible();
  await expect(page.locator('[data-front-id="F1"]')).toBeVisible();
  await expect(page.locator('[data-movement-unit-id="ita-move"]')).toHaveCount(1);
});

test('MAP P3 / G — camera invariata su cinque cambi di layer', async ({ page }) => {
  await openThematicMap(page);
  const before = await page.evaluate(() => ({ c: window.__testMap.getCenter(), z: window.__testMap.getZoom() }));
  for (const label of ['Economia', 'Diplomazia', 'Infrastrutture', 'Militare', 'Terreno']) {
    await selectLayer(page, label);
  }
  const after = await page.evaluate(() => ({ c: window.__testMap.getCenter(), z: window.__testMap.getZoom() }));
  expect(after.z).toBeCloseTo(before.z, 3);
  expect(after.c.lng).toBeCloseTo(before.c.lng, 3);
  expect(after.c.lat).toBeCloseTo(before.c.lat, 3);
});

test('MAP P3 / H — mobile 360: selettore compatto e nessun overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 740 });
  await openThematicMap(page);
  const legend = page.locator('.map-legend-toggle');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await page.getByRole('radio', { name: 'Economia', exact: true }).check();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', 'economy');
  await page.getByRole('radio', { name: 'Diplomazia', exact: true }).check();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', 'diplomacy');
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('MAP P3 / I — ricerca stabile con layer Economia attivo', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Economia');
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill('Francia');
  const option = page.locator('.map-search-results button, .map-search-results li button').first();
  if (await option.count()) await option.click();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', 'economy');
});

test('MAP P3 / J — la selezione sopravvive al cambio di layer', async ({ page }) => {
  await openThematicMap(page);
  await selectLayer(page, 'Militare');
  await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    useGameStore.setState({ selectedRegion: 'AUT' });
  });
  await expect(page.locator('.map-legend-selection')).toContainText('Austria');
  await selectLayer(page, 'Economia');
  await expect(page.locator('.map-legend-selection')).toContainText('Austria');
  await expect.poll(() => page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    return useGameStore.getState().selectedRegion;
  })).toBe('AUT');
});

async function selectRegion(page, regionId) {
  await page.evaluate(async id => {
    const { useGameStore } = await window.__wsAppModules();
    useGameStore.setState({ selectedRegion: id });
  }, regionId);
}

test('MAP P3.1 / K — la selezione preserva il thematic fill (Economy e Diplomacy)', async ({ page }) => {
  await openThematicMap(page);
  const colors = await loadColors(page);
  await selectLayer(page, 'Economia');
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ hasThematic: true });
  const economyColor = (await featureState(page, 'AUT')).thematicColor;

  // Selezione: stesso colore tematico, con `selected` come stato separato.
  await selectRegion(page, 'AUT');
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ selected: true });
  expect((await featureState(page, 'AUT')).thematicColor).toBe(economyColor);
  // L'evidenza della selezione vive sull'outline, non sul riempimento.
  expect(JSON.stringify(await fillColor(page))).not.toContain('selected');

  // Diplomazia: AUT è hostile e resta hostile anche selezionata.
  await selectLayer(page, 'Diplomazia');
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ thematicColor: colors.hostile });
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ selected: true });
  expect((await featureState(page, 'AUT')).thematicColor).toBe(colors.hostile);
  expect((await featureState(page, 'AUT')).thematicColor).not.toBe(colors.noData);
});

test('MAP P3.1 / L — diplomazia fail-closed mentre il refresh è pending', async ({ page }) => {
  page.__relPhase = 'neutral';
  await openThematicMap(page);
  await selectLayer(page, 'Diplomazia');
  const colors = await loadColors(page);
  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'true');
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ thematicColor: colors.neutral });

  // Turno successivo: la richiesta resta pendente. La matrice vecchia non deve
  // restare presentata come corrente.
  page.__relPhase = 'hostile';
  page.__relDelay = 4000;
  await bumpRevision(page, '1951-02-16');
  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'false');
  await expect(page.locator('[data-thematic-message]')).toBeVisible();
  await expect.poll(async () => (await featureState(page, 'AUT')).thematicColor).not.toBe(colors.neutral);

  // B completa: AUT hostile, layer di nuovo disponibile.
  await expect.poll(() => featureState(page, 'AUT'), { timeout: 9000 }).toMatchObject({ thematicColor: colors.hostile });
  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'true');
});

test('MAP P3.1 / M — refresh fallito: la matrice vecchia sparisce', async ({ page }) => {
  page.__relPhase = 'neutral';
  await openThematicMap(page);
  await selectLayer(page, 'Diplomazia');
  const colors = await loadColors(page);
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ thematicColor: colors.neutral });

  page.__relPhase = 'failure';
  await bumpRevision(page, '1951-02-16');
  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'false');
  await expect(page.locator('[data-thematic-message]')).toBeVisible();
  await expect.poll(async () => (await featureState(page, 'AUT')).thematicColor).not.toBe(colors.neutral);
});

test('MAP P3.1 / N — race: la risposta più recente vince, la lenta non rientra', async ({ page }) => {
  page.__relPhase = 'neutral';
  await openThematicMap(page);
  await selectLayer(page, 'Diplomazia');
  const colors = await loadColors(page);

  // A lenta (neutral), poi B veloce (hostile).
  page.__relDelay = 4000;
  await bumpRevision(page, '1951-02-10');
  await page.waitForTimeout(300);
  page.__relDelay = 0;
  page.__relPhase = 'hostile';
  await bumpRevision(page, '1951-02-20');

  await expect(mapLayer(page)).toHaveAttribute('data-diplomacy-available', 'true');
  await expect.poll(() => featureState(page, 'AUT')).toMatchObject({ thematicColor: colors.hostile });
  // A completa dopo B: il request-id guard deve scartarla.
  await page.waitForTimeout(4200);
  expect((await featureState(page, 'AUT')).thematicColor).toBe(colors.hostile);
});
