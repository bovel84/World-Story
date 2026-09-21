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

// Due reparti ITA e uno AUT nella stessa provincia: a zoom mondo l'aggregato
// deve restare distinto per polity, mai sommato sotto la prima.
SNAPSHOTS.mixed = {
  units: [
    unit('ita-one', 'ITA', 'ITA1', { order: 'defend' }),
    unit('ita-two', 'ITA', 'ITA1', { order: 'defend' }),
    unit('aut-mixed', 'AUT', 'ITA1', { order: 'defend' }),
  ],
  fronts: [],
};

// Fallimento parziale: units risponde, fronts no → snapshot UI atomico non pubblicato.
SNAPSHOTS.failure = { units: SNAPSHOTS.before.units, failFronts: true };

// ---------------------------------------------------------------------------
// MAP P2.2 — rewind / checkpoint restore di un trasferimento P6 a metà.
// Mondo dedicato A/B/C, così le transizioni sono esplicite e non riusano le
// fixture `before`/`after` di P2 (che servono anche ai test di conquista).
// ---------------------------------------------------------------------------
const rewindTerritory = (id, west) => territory(
  id, `Regione ${id}`, '#609f87', polygon(west, 40, west + 10, 50), 'ITA', 'Italia',
);
const rewindGame = {
  ...MOCK_GAME,
  players: [{ id: 'player', regionId: 'A', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    A: rewindTerritory('A', 0),
    B: rewindTerritory('B', 10),
    C: rewindTerritory('C', 20),
  } },
};

// Snapshot A — checkpoint iniziale: nessun hop percorso.
const movementCheckpoint = {
  path: ['A', 'B', 'C'], targetRegionId: 'C', targetRegionName: 'Regione C',
  startedDate: '1951-02-01', pathIndex: 0, daysPerHop: 15, remainingDaysToNextHop: 15,
  totalHops: 2, estimatedArrivalDate: '1951-03-03', motorized: true,
};
// Snapshot B — dopo il primo hop: posizione e progresso avanzati.
const movementAdvanced = { ...movementCheckpoint, pathIndex: 1, remainingDaysToNextHop: 10, estimatedArrivalDate: '1951-02-26' };
SNAPSHOTS.rewindA = { units: [unit('ita-move', 'ITA', 'A', { movement: movementCheckpoint })], fronts: [] };
SNAPSHOTS.rewindB = { units: [unit('ita-move', 'ITA', 'B', { movement: movementAdvanced })], fronts: [] };

async function installStoreBridge(page) {  await page.addInitScript(() => {
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
async function openMilitaryMap(page, phase = 'before', worldGame = game) {
  installMockApi(page);
  await installStoreBridge(page);
  // Le fixture militari sono registrate DOPO il mock base: hanno la precedenza.
  // `page.__delay` è pilotato dal test (leak-proof: pagina nuova per ogni test).
  await page.route('**/api/games/*/military/units', async route => {
    const snapshot = SNAPSHOTS[page.__phase || phase];
    if (page.__delay) await new Promise(resolve => setTimeout(resolve, page.__delay));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ units: snapshot.units }) });
  });
  await page.route('**/api/games/*/military/fronts', async route => {
    const snapshot = SNAPSHOTS[page.__phase || phase];
    if (page.__delay) await new Promise(resolve => setTimeout(resolve, page.__delay));
    // Fallimento parziale: units risponde, fronts no. Nulla deve essere pubblicato.
    if (snapshot.failFronts) {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) });
      return;
    }
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
    for (const [id, owner] of Object.entries(overrides)) if (regions[id]) regions[id] = { ...regions[id], owner };
    useGameStore.setState({ currentWorld: { ...game.world, regions }, currentGame: game, selectedCountry: 'ITA', selectedRegion: null });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, { game: worldGame, phase });
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

/**
 * Applica una transizione di stato di gioco (advance / rewind / restore) usando
 * gli stessi trigger del lifecycle reale: turno, data, revisione e branch devono
 * cambiare perché `useNationSnapshot` rilegga le API militari persistenti.
 * Nessun rollback frontend, nessuna cache: solo lo stato autorevole che cambia.
 */
async function applyGameState(page, { phase, currentTurn, currentDate, worldRevision, headBranchId, regionOwners = {} }) {
  page.__phase = phase;
  await page.evaluate(async next => {
    window.__phase = next.phase;
    const { useGameStore } = await window.__wsAppModules();
    const state = useGameStore.getState();
    const regions = { ...state.currentWorld.regions };
    for (const [id, owner] of Object.entries(next.regionOwners)) {
      if (regions[id]) regions[id] = { ...regions[id], owner };
    }
    useGameStore.setState({
      currentWorld: { ...state.currentWorld, regions },
      currentGame: {
        ...state.currentGame,
        ...(next.currentTurn !== undefined ? { currentTurn: next.currentTurn } : {}),
        ...(next.currentDate !== undefined ? { currentDate: next.currentDate } : {}),
        ...(next.worldRevision !== undefined ? { worldRevision: next.worldRevision } : {}),
        ...(next.headBranchId !== undefined ? { headBranchId: next.headBranchId } : {}),
      },
    });
  }, { phase, currentTurn, currentDate, worldRevision, headBranchId, regionOwners });
  await expect.poll(() => page.evaluate(() => window.__phase)).toBe(phase);
  await page.waitForTimeout(400);
}

const counter = (page, id) => page.locator(`[data-unit-id="${id}"]`);
const route = (page, id) => page.locator(`[data-movement-unit-id="${id}"]`);
const context = (page, kind, id) => page.locator(`[data-map-context="${kind}"][data-map-context-id="${id}"]`);

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
  const inspector = context(page, 'unit', 'ita-alpha');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Italia');
  await expect(inspector).toContainText('Attacca');
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();

  await page.locator('[data-front-id="F1"]').click();
  const frontInspector = context(page, 'front', 'F1');
  await expect(frontInspector).toBeVisible();
  await expect(frontInspector).toContainText('Austria');
  await expect(frontInspector).toContainText('63%');
  await expect(frontInspector).toContainText('Iniziativa');
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
  const inspector = context(page, 'unit', 'ita-move');
  await expect(inspector).toContainText('In trasferimento');
  await expect(inspector).toContainText('Ungheria');
  await expect(inspector).toContainText('1951-03-03'.split('-').reverse().join('.'));
  await expect(inspector).toContainText('Motorizzato');
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
  await expect(context(page, 'unit', 'ita-alpha')).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('MAP P2.1 / H — refresh fallito: niente snapshot stale come stato attuale, poi recovery', async ({ page }) => {
  await openMilitaryMap(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [17, 45], zoom: 3.4 }));
  await expect(counter(page, 'ita-alpha')).toBeVisible();
  await expect(page.locator('[data-front-id="F1"]')).toBeVisible();
  await expect(route(page, 'ita-move')).toHaveCount(1);

  // Fallimento parziale: units ok, fronts ko. Lo snapshot UI resta atomico.
  await switchPhase(page, 'failure');
  await expect(counter(page, 'ita-alpha')).toHaveCount(0);
  await expect(counter(page, 'aut-alpha')).toHaveCount(0);
  await expect(page.locator('[data-front-id="F1"]')).toHaveCount(0);
  await expect(route(page, 'ita-move')).toHaveCount(0);
  const error = page.locator('.military-state-unavailable');
  await expect(error).toBeVisible();
  await expect(error).toHaveText('Situazione militare non disponibile');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();

  // Un refresh valido successivo non è bloccato dall'errore precedente.
  await switchPhase(page, 'before');
  await expect(counter(page, 'ita-alpha')).toBeVisible();
  await expect(page.locator('[data-front-id="F1"]')).toBeVisible();
  await expect(page.locator('.military-state-unavailable')).toHaveCount(0);
});

test('MAP P2.1 / K — race: una risposta lenta non sovrascrive quella più recente', async ({ page }) => {
  page.__delay = 3000; // richiesta A (phase before) lenta
  await openMilitaryMap(page);
  page.__delay = 0; // richiesta B (phase after) immediata
  await switchPhase(page, 'after');

  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'AUT1');
  // A completa dopo B: il request-id guard deve scartarla.
  await page.waitForTimeout(3400);
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'AUT1');
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'AUT1,HUN1');
});

test('MAP P2.1 / L — zoom mondo: aggregati separati per polity, nessuna somma sotto la prima', async ({ page }) => {
  await openMilitaryMap(page, 'mixed');
  await page.evaluate(() => window.__testMap.jumpTo({ center: [5, 45], zoom: 1.8 }));

  const ita = page.locator('[data-unit-polity="ITA"]');
  const aut = page.locator('[data-unit-polity="AUT"]');
  await expect(ita).toHaveCount(1);
  await expect(aut).toHaveCount(1);
  await expect(ita).toHaveAttribute('data-unit-aggregate', '2');
  await expect(aut).toHaveAttribute('data-unit-aggregate', '1');
  // Nessun counter ITA che rivendica i tre reparti della provincia.
  await expect(page.locator('[data-unit-polity="ITA"][data-unit-aggregate="3"]')).toHaveCount(0);
  await expect(ita).toHaveAttribute('aria-label', /2 reparti Italia in Pianura/);

  // Il drill-down parte filtrato per polity e non finge che gli altri siano ITA.
  await ita.click();
  const dialog = page.getByRole('dialog', { name: 'Reparti Italia in Pianura' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2 reparti Italia in Pianura');
  await expect(dialog).toContainText('Vedi tutti i 3 reparti della regione');
});

test('MAP P2.2 / M — rewind ripristina posizione e rotta P6 del checkpoint', async ({ page }) => {
  await openMilitaryMap(page, 'rewindA', rewindGame);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [15, 45], zoom: 3.4 }));

  // --- Snapshot A: checkpoint iniziale (nessun hop percorso). ---
  await expect(counter(page, 'ita-move')).toHaveCount(1);
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'A');
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-moving', 'true');
  await expect(route(page, 'ita-move')).toHaveCount(1);
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'A,B,C');
  await counter(page, 'ita-move').click();
  const inspector = context(page, 'unit', 'ita-move');
  await expect(inspector.locator('[data-route-path]')).toHaveAttribute('data-route-path', 'A,B,C');
  await expect(inspector).toContainText('0 / 2');
  await expect(inspector).toContainText('15 giorni');
  await expect(inspector).toContainText('03.03.1951');
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();

  // --- Avanzamento: Snapshot B, primo hop percorso. ---
  await applyGameState(page, { phase: 'rewindB', worldRevision: 2, currentTurn: 2, currentDate: '1951-02-16' });
  await expect(counter(page, 'ita-move')).toHaveCount(1);
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'B');
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'B,C');
  await counter(page, 'ita-move').click();
  await expect(inspector.locator('[data-route-path]')).toHaveAttribute('data-route-path', 'B,C');
  await expect(inspector).toContainText('1 / 2');
  await expect(inspector).toContainText('10 giorni');
  await expect(inspector).toContainText('26.02.1951');
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();

  // --- Rewind: turno, data e revisione riavvolti al checkpoint A. ---
  await applyGameState(page, { phase: 'rewindA', worldRevision: 1, currentTurn: 1, currentDate: '1951-02-01' });
  // Nessun ghost counter: una sola rappresentazione, di nuovo in A.
  await expect(counter(page, 'ita-move')).toHaveCount(1);
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'A');
  // Nessuna ghost route: solo la rotta ripristinata, nessuna copia di B,C.
  await expect(route(page, 'ita-move')).toHaveCount(1);
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'A,B,C');
  await expect(page.locator('[data-route-path="B,C"]')).toHaveCount(0);
  // Il dettaglio P6 riflette il checkpoint, non lo stato futuro.
  await counter(page, 'ita-move').click();
  await expect(inspector.locator('[data-route-path]')).toHaveAttribute('data-route-path', 'A,B,C');
  await expect(inspector).toContainText('0 / 2');
  await expect(inspector).toContainText('15 giorni');
  await expect(inspector).toContainText('03.03.1951');
  await expect(inspector).not.toContainText('26.02.1951');
  await expect(inspector).not.toContainText('1 / 2');
});

test('MAP P2.2 / N — checkpoint restore rilegge il movimento dal nuovo branch', async ({ page }) => {
  await openMilitaryMap(page, 'rewindB', rewindGame);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [15, 45], zoom: 3.4 }));

  // Si parte da uno stato avanzato (branch futuro).
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'B');
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'B,C');

  // Restore su un nuovo branch: headBranchId cambia insieme a revisione e data.
  await applyGameState(page, {
    phase: 'rewindA', headBranchId: 'branch-restored',
    worldRevision: 1, currentTurn: 1, currentDate: '1951-02-01',
  });

  await expect.poll(() => page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    return useGameStore.getState().currentGame.headBranchId;
  })).toBe('branch-restored');
  await expect(counter(page, 'ita-move')).toHaveCount(1);
  await expect(counter(page, 'ita-move')).toHaveAttribute('data-unit-region', 'A');
  await expect(route(page, 'ita-move')).toHaveCount(1);
  await expect(route(page, 'ita-move')).toHaveAttribute('data-route-path', 'A,B,C');
  // La rappresentazione del branch futuro non sopravvive da nessuna parte.
  await expect(page.locator('[data-route-path="B,C"]')).toHaveCount(0);
  await expect(page.locator('[data-unit-region="B"]')).toHaveCount(0);
});
