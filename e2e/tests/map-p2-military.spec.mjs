/**
 * MAP P2 — stato militare persistente sulla mappa.
 * ===============================================
 * Fronte, reparti persistenti (player e NPC), nazionalità dopo conquista e
 * trasferimenti P6 in corso: la mappa mostra lo stato **attuale**, distinto
 * dalla cronaca recente. Le fixture militari hanno la stessa forma del motore
 * (`MilitaryUnitPayload`/`WarFrontPayload`) e vivono in una macchina a fasi:
 * prima / dopo / arrivato, selezionabile dal test.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, south, east, north) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
} });
const territory = (id, name, color, geojson, owner, polityName, objects = []) => ({
  id, name, polityName, owner, flag: owner, color, geojson, objects,
  population: 1000000, militaryPower: 30, gdp: 300, borders: [], status: 'active', metadata: {},
});

const game = {
  ...MOCK_GAME,
  players: [{ id: 'player', regionId: 'ITA1', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA1: territory('ITA1', 'Pianura', '#609f87', polygon(0, 40, 10, 50), 'ITA', 'Italia'),
    ITA2: territory('ITA2', 'Costa', '#7fb3a0', polygon(10, 40, 20, 50), 'ITA', 'Italia'),
    AUT1: territory('AUT1', 'Tirolo', '#c08d76', polygon(20, 40, 30, 50), 'AUT', 'Austria'),
    HUN1: territory('HUN1', 'Ungheria', '#8f8fc0', polygon(30, 40, 40, 50), 'HUN', 'Ungheria'),
  } },
};

const movementBefore = {
  path: ['ITA2', 'AUT1', 'HUN1'], targetRegionId: 'HUN1', targetRegionName: 'Ungheria',
  startedDate: '1951-02-01', pathIndex: 0, daysPerHop: 15, remainingDaysToNextHop: 15,
  totalHops: 2, estimatedArrivalDate: '1951-03-03', motorized: true,
};

const unit = (id, polityId, regionId, patch = {}) => ({
  id, polityId, armyId: `army-${polityId.toLowerCase()}`, name: id,
  personnel: 8430, equipment: { rifles: 5000 }, monthlyNeeds: { fuel: 1, weapons: 2, food: 3 },
  readiness: 0.62, status: 'operational', regionId, regionName: regionId,
  updatedDate: '1951-02-01', legacyDerived: false, order: 'defend', frontId: null, ...patch,
});

const front = (id, attackerPolityId, defenderPolityId, regionIds, objectiveRegionId, patch = {}) => ({
  id, name: `${attackerPolityId}–${defenderPolityId}`, attackerPolityId, defenderPolityId,
  regionIds, status: 'active', objectiveRegionId, attackerPressure: 0.63, defenderPressure: 0.48,
  momentumPolityId: attackerPolityId, createdDate: '1951-01-01', updatedDate: '1951-02-01', ...patch,
});

const SNAPSHOTS = {
  before: {
    units: [
      unit('ita-alpha', 'ITA', 'ITA1', { order: 'attack', frontId: 'F1', status: 'degraded' }),
      unit('ita-move', 'ITA', 'ITA2', { movement: movementBefore, frontId: null }),
      unit('aut-alpha', 'AUT', 'AUT1', { order: 'defend', frontId: 'F1' }),
      unit('hun-alpha', 'HUN', 'HUN1', { order: 'defend', frontId: 'F2' }),
    ],
    fronts: [
      front('F1', 'ITA', 'AUT', ['ITA1', 'AUT1'], 'AUT1'),
      front('F2', 'AUT', 'HUN', ['AUT1', 'HUN1'], 'HUN1'),
    ],
  },
  // Dopo il primo hop: il reparto è sulla nuova provincia, la rotta riparte da lì.
  // La conquista di AUT1 da parte di ITA non cambia la nazionalità dei reparti AUT.
  after: {
    units: [
      unit('ita-alpha', 'ITA', 'ITA1', { order: 'attack', frontId: 'F1', status: 'degraded' }),
      unit('ita-move', 'ITA', 'AUT1', {
        movement: { ...movementBefore, pathIndex: 1, remainingDaysToNextHop: 15 },
        frontId: null,
      }),
      unit('aut-alpha', 'AUT', 'AUT1', { order: 'defend', frontId: 'F1' }),
      unit('hun-alpha', 'HUN', 'HUN1', { order: 'defend', frontId: 'F2' }),
    ],
    fronts: [
      front('F1', 'ITA', 'AUT', ['ITA1', 'AUT1'], 'AUT1'),
      front('F2', 'AUT', 'HUN', ['AUT1', 'HUN1'], 'HUN1'),
    ],
    regionOwnerOverrides: { AUT1: 'ITA' },
  },
  arrived: {
    units: [
      unit('ita-alpha', 'ITA', 'ITA1', { order: 'attack', frontId: 'F1' }),
      unit('ita-move', 'ITA', 'HUN1', { frontId: null }),
      unit('aut-alpha', 'AUT', 'AUT1', { order: 'defend', frontId: 'F1' }),
      unit('hun-alpha', 'HUN', 'HUN1', { order: 'defend', frontId: 'F2' }),
    ],
    fronts: [front('F1', 'ITA', 'AUT', ['ITA1', 'AUT1'], 'AUT1')],
  },
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

/** Apre la mappa con le fixture MAP P2 e restituisce il controllo di fase. */
async function openMilitaryMap(page, phase = 'before') {
  installMockApi(page);
  await installStoreBridge(page);
  // Le fixture militari sono registrate DOPO il mock base: hanno la precedenza.
  await page.route('**/api/games/*/military/units', route => {
    const snapshot = SNAPSHOTS[page.__phase || phase];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ units: snapshot.units }) });
  });
  await page.route('**/api/games/*/military/fronts', route => {
    const snapshot = SNAPSHOTS[page.__phase || phase];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fronts: snapshot.fronts }) });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async ({ game, phase }) => {
    window.__phase = phase;
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
    const overrides = (window.__phase === 'after') ? { AUT1: 'ITA' } : {};
    const regions = { ...game.world.regions };
    for (const [id, owner] of Object.entries(overrides)) regions[id] = { ...regions[id], owner };
    useGameStore.setState({ currentWorld: { ...game.world, regions }, currentGame: game, selectedCountry: 'ITA', selectedRegion: null });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, { game, phase });
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
}

/** Passa a una nuova fase e forza il refresh del lifecycle militare. */
async function switchPhase(page, phase) {
  page.__phase = phase;
  await page.evaluate(async (nextPhase) => {
    window.__phase = nextPhase;
    const { useGameStore } = await window.__wsAppModules();
    const state = useGameStore.getState();
    const revision = (state.currentGame?.worldRevision || 1) + 1;
    const overrides = nextPhase === 'after' ? { ITA1: 'ITA', AUT1: 'ITA' } : {};
    const regions = { ...state.currentWorld.regions };
    for (const [id, owner] of Object.entries(overrides)) {
      regions[id] = { ...regions[id], owner, polityName: regions[id].polityName };
    }
    useGameStore.setState({
      currentWorld: { ...state.currentWorld, regions },
      currentGame: { ...state.currentGame, worldRevision: revision, currentDate: '1951-02-01' },
    });
  }, phase);
  await expect.poll(() => page.evaluate(() => window.__phase)).toBe(phase);
  await page.waitForTimeout(400);
}

const counter = (page, id) => page.locator(`[data-unit-id="${id}"]`);
const route = (page, id) => page.locator(`[data-movement-unit-id="${id}"]`);

test('MAP P2 / A — reparti persistenti: counter distinti per polity, fronti visibili', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));

  await expect(counter(page, 'ita-alpha')).toBeVisible();
  await expect(counter(page, 'aut-alpha')).toBeVisible();
  await expect(counter(page, 'ita-alpha')).toHaveAttribute('data-unit-polity', 'ITA');
  await expect(counter(page, 'aut-alpha')).toHaveAttribute('data-unit-polity', 'AUT');
  await expect(counter(page, 'aut-alpha')).toHaveAttribute('data-unit-status', 'operational');
  // Il fronte ITA/AUT ha un badge con il suo obiettivo reale.
  await expect(page.locator('[data-front-id="F1"]')).toHaveAttribute('data-objective-region', 'AUT1');
  expect(errors).toEqual([]);
});

test('MAP P2 / B — NPC–NPC visibile senza il player: fronte AUT–HUN e reparti', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [25, 45], zoom: 3.4 }));
  await expect(page.locator('[data-front-id="F2"]')).toBeVisible();
  await expect(counter(page, 'hun-alpha')).toHaveAttribute('data-unit-polity', 'HUN');
  await expect(counter(page, 'aut-alpha')).toHaveAttribute('data-unit-polity', 'AUT');
});

test('MAP P2 / C — dettaglio reparto e fronte sono di sola lettura dal motore', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));
  await counter(page, 'ita-alpha').click();
  const dialog = page.getByRole('dialog', { name: 'Reparto ita-alpha' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Italia');
  await expect(dialog).toContainText('Attacca');
  await page.getByRole('button', { name: 'Chiudi dettaglio militare' }).click();

  await page.locator('[data-front-id="F1"]').click();
  const frontDialog = page.getByRole('dialog', { name: 'Fronte ITA–AUT' });
  await expect(frontDialog).toBeVisible();
  await expect(frontDialog).toContainText('Austria');
  await expect(frontDialog).toContainText('63%');
  await expect(frontDialog).toContainText('Iniziativa');
});

test('MAP P2 / D — conquista: il reparto AUT resta AUT dentro territorio italiano', async ({ page }) => {
  await openMilitaryMap(page, 'after');
  await page.evaluate(() => window.__testMap.jumpTo({ center: [25, 45], zoom: 3.6 }));
  await expect(counter(page, 'aut-alpha')).toHaveAttribute('data-unit-polity', 'AUT');
  await expect.poll(() => page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    return useGameStore.getState().currentWorld.regions.AUT1.owner;
  })).toBe('ITA');
});

test('MAP P2 / E — trasferimento P6: counter sulla posizione reale e rotta persistita', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));
  // Posizione canonica: l'ultima provincia raggiunta (ITA2), non il target.
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'ITA2');
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-moving', 'true');
  // Rotta = movement.path.slice(pathIndex): ITA2 → AUT1 → HUN1.
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'ITA2,AUT1,HUN1');
  await counter(page, 'ita-move').click();
  const dialog = page.getByRole('dialog', { name: 'Reparto ita-move' });
  await expect(dialog).toContainText('In trasferimento');
  await expect(dialog).toContainText('Ungheria');
  await expect(dialog).toContainText('1951-03-03'.split('-').reverse().join('.'));
  await expect(dialog).toContainText('Motorizzato');
});

test('MAP P2 / F — dopo il primo hop il counter e la rotta ripartono dalla nuova provincia', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'ITA2');
  await switchPhase(page, 'after');
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'AUT1');
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'AUT1,HUN1');
});

test('MAP P2 / G — all’arrivo il counter è sulla destinazione e la rotta attiva sparisce', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [25, 45], zoom: 3.4 }));
  await expect(route(page, 'ita-move')).toHaveCount(1);
  await switchPhase(page, 'arrived');
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'HUN1');
  await expect(route(page, 'ita-move')).toHaveCount(0);
});

test('MAP P2 / I — il filtro «Unità e fronti» nasconde reparti, fronti e rotte; la base resta', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));
  await expect(counter(page, 'ita-alpha')).toBeVisible();
  await expect(page.locator('[data-front-id="F1"]')).toBeVisible();
  await expect(route(page, 'ita-move')).toHaveCount(1);
  await page.locator('.map-legend-toggle').click();
  await page.getByRole('checkbox', { name: 'Unità e fronti' }).uncheck();
  await expect(counter(page, 'ita-alpha')).toHaveCount(0);
  await expect(page.locator('[data-front-id="F1"]')).toHaveCount(0);
  await expect(route(page, 'ita-move')).toHaveCount(0);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Unità e fronti' }).check();
  await expect(counter(page, 'ita-alpha')).toBeVisible();
});

test('MAP P2 / J — 360px: fronti e reparti leggibili, nessun overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 740 });
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3 }));
  await expect(counter(page, 'ita-alpha')).toBeVisible();
  await expect(page.locator('[data-front-id="F1"]')).toBeVisible();
  await counter(page, 'ita-alpha').click();
  await expect(page.getByRole('dialog', { name: 'Reparto ita-alpha' })).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi dettaglio militare' }).click();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});
