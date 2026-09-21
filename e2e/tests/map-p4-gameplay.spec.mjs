import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_ARSENAL, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, east) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, 40], [east, 40], [east, 50], [west, 50], [west, 40]]],
} });
const territory = (id, name, owner, polityName, west) => ({
  id, name, owner, polityName, flag: owner, color: owner === 'ITA' ? '#609f87' : owner === 'AUT' ? '#c08d76' : '#8f8fc0',
  geojson: polygon(west, west + 10), objects: [], population: 1_000_000, militaryPower: 30,
  gdp: west === 0 ? 500 : 300, borders: [], status: 'active', metadata: {},
});
const regions = {
  ROM: territory('ROM', 'Roma', 'ITA', 'Italia', 0),
  FIR: territory('FIR', 'Firenze', 'ITA', 'Italia', 10),
  BOL: territory('BOL', 'Bologna', 'ITA', 'Italia', 20),
  AUT: territory('AUT', 'Austria', 'AUT', 'Austria', 30),
  HUN: territory('HUN', 'Budapest', 'HUN', 'Ungheria', 40),
};
const game = {
  ...MOCK_GAME,
  currentTurn: 4,
  currentDate: '1951-02-01',
  worldRevision: 5,
  headBranchId: 'branch-live',
  players: [{ id: 'player', regionId: 'ROM', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions },
};

const unit = (id, polityId, regionId, patch = {}) => ({
  id, polityId, armyId: `army-${polityId.toLowerCase()}`, name: id === 'ita-1' ? 'ITA 1° Reparto' : id === 'ita-2' ? 'ITA 2° Reparto' : 'AUT 3° Reparto',
  personnel: id === 'ita-1' ? 8400 : 7600, equipment: { rifles: 5000 },
  monthlyNeeds: { fuel: 1, weapons: 2, food: 3 }, readiness: id === 'ita-1' ? 0.72 : 0.61,
  status: 'operational', regionId, regionName: regions[regionId]?.name || regionId,
  updatedDate: '1951-02-01', legacyDerived: false, order: 'defend', frontId: 'F1', ...patch,
});
const front = {
  id: 'F1', name: 'Fronte Alpino', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
  regionIds: ['ROM', 'AUT', 'HUN'], status: 'active', objectiveRegionId: 'AUT',
  attackerPressure: 0.63, defenderPressure: 0.48, momentumPolityId: 'ITA',
  createdDate: '1951-01-01', updatedDate: '1951-02-01',
};
const INITIAL_UNITS = [
  unit('ita-1', 'ITA', 'ROM'),
  unit('ita-2', 'ITA', 'FIR'),
  // Territorio HUN, authority AUT: la conquista non cambia chi controlla il reparto.
  unit('aut-1', 'AUT', 'HUN'),
];

const ACTIONS = [
  { id: 'reinforce_unit', label: 'Rinforza', enabled: true, blockedReason: null },
  { id: 'reequip_unit', label: 'Riequipaggia', enabled: false, blockedReason: 'Deposito insufficiente.' },
  { id: 'transfer_unit', label: 'Trasferisci', enabled: true, blockedReason: null },
  { id: 'reassign_unit', label: 'Cambia armata', enabled: false, blockedReason: 'Nessuna seconda armata.' },
  { id: 'order_attack', label: 'Attacca', enabled: true, blockedReason: null },
  { id: 'order_defend', label: 'Difendi', enabled: true, blockedReason: null },
  { id: 'order_reserve', label: 'Riserva', enabled: true, blockedReason: null },
  { id: 'order_withdraw', label: 'Ripiega', enabled: true, blockedReason: null },
];

const operatingUnit = value => ({
  id: value.id, kind: 'unit', label: value.name,
  // `runtime.pictureEpoch` distingue due Operating Picture con lo **stesso** ID:
  // serve a provare che una preview sparisce per lo snapshot, non per il read model.
  subtitle: `${value.armyId} · ${value.regionName} · quadro ${value.pictureEpoch ?? 1}`,
  status: value.status === 'degraded' ? 'degraded' : 'operational', statusLabel: value.status,
  parentId: value.armyId, regionId: value.regionId, regionName: value.regionName,
  facts: [], problems: [], actions: ACTIONS, why: 'Azioni pubblicate dal motore.',
});
const pictureFor = runtime => ({
  objects: [
    // MAP P4.1: la radice del settore «Forze armate» esiste solo quando serve
    // (il dossier nazionale raggruppa i settori a partire da un oggetto `force`).
    ...(runtime.forceRoot ? [{ id: 'force-ita', kind: 'force', label: 'Forze armate', subtitle: 'Reparti della polity ITA', status: 'operational', statusLabel: 'Operativa', parentId: null, facts: [], problems: [], actions: [], why: 'Radice del settore pubblicata dal motore.' }] : []),
    { id: 'army-ita', kind: 'army', label: '1ª Armata', status: 'operational', statusLabel: 'Operativa', parentId: null, regionId: 'ROM', regionName: 'Roma', facts: [], problems: [], actions: [] },
    ...runtime.units.filter(item => item.polityId === 'ITA').map(item => operatingUnit({ ...item, pictureEpoch: runtime.pictureEpoch })),
    { id: 'rail-fir', kind: 'facility', label: 'Nodo Firenze', status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'FIR', regionName: 'Firenze', facts: [], problems: [], actions: [] },
    { id: 'rail-bol', kind: 'facility', label: 'Nodo Bologna', status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'BOL', regionName: 'Bologna', facts: [], problems: [], actions: [] },
  ], chains: [], counts: { army: 1, unit: runtime.units.filter(item => item.polityId === 'ITA').length },
  conventions: ['Le azioni dei reparti arrivano dal motore.'],
});

const movement = {
  path: ['ROM', 'FIR', 'BOL'], targetRegionId: 'BOL', targetRegionName: 'Bologna',
  startedDate: '1951-02-01', pathIndex: 0, daysPerHop: 15, remainingDaysToNextHop: 15,
  totalHops: 2, estimatedArrivalDate: '1951-03-03', motorized: true,
};

function actionImpact(runtime, action, unitId, dryRun) {
  const current = runtime.units.find(item => item.id === unitId);
  const after = action === 'reinforce' ? { ...current, personnel: 9000, readiness: 0.78 }
    : action === 'transfer' ? { ...current, movement }
      : current;
  return {
    applied: !dryRun, action, unitId, unitName: current.name, armyId: current.armyId, armyName: '1ª Armata',
    blocked: false, blockedReason: null,
    rows: action === 'reinforce'
      ? [{ label: 'Uomini del reparto', before: current.personnel, after: after.personnel, unit: 'numero', tone: 'positive' }]
      : [{ label: 'Cassa', before: 100, after: 99.5, unit: 'mld', tone: 'neutral' }],
    unit: after, regionName: action === 'transfer' ? 'Bologna' : current.regionName,
    movement: action === 'transfer' ? {
      path: ['ROM', 'FIR', 'BOL'], pathNames: ['Roma', 'Firenze', 'Bologna'], hops: 2,
      daysPerHop: 15, totalDays: 30, estimatedArrivalDate: '1951-03-03',
    } : undefined,
    note: dryRun ? 'Anteprima del motore.' : 'Azione applicata dal motore.',
    why: 'Il motore pubblica costi ed effetti; il browser non li ricalcola.',
  };
}
function orderImpact(runtime, order, unitId, dryRun) {
  const current = runtime.units.find(item => item.id === unitId);
  const after = { ...current, order };
  return {
    applied: !dryRun, unitId, unitName: current.name, order, previousOrder: current.order,
    frontId: current.frontId, frontName: 'Fronte Alpino',
    rows: [{ label: 'Pressione dell’attacco', before: 100, after: order === 'attack' ? 135 : 100, unit: 'pct', tone: 'neutral' }],
    unit: after, note: dryRun ? 'Anteprima ordine.' : 'Ordine registrato.',
    why: 'L’ordine appartiene al reparto, non al fronte.',
  };
}

async function installStoreBridge(page) {
  await page.addInitScript(() => {
    const moduleUrl = pattern => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => pattern.test(url)).at(-1);
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

async function openP4Map(page, { forceRoot = false } = {}) {
  const runtime = {
    units: INITIAL_UNITS.map(item => structuredClone(item)), fronts: [structuredClone(front)],
    actionCalls: [], orderCalls: [], militaryDelay: 0, actionDelay: 0, arsenalDelay: 0, forceNotApplied: false,
    forceRoot, pictureEpoch: 1,
  };
  installMockApi(page);
  await installStoreBridge(page);
  await page.route('**/api/games/*/arsenal', async route => {
    // MAP P4.1: con l'Operating Picture «congelata» (delay) l'unica cosa che può
    // invalidare una preview è la chiave snapshot, non il cambio di `picture`.
    if (runtime.arsenalDelay) await new Promise(resolve => setTimeout(resolve, runtime.arsenalDelay));
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_ARSENAL, objects: pictureFor(runtime) }),
    });
  });
  await page.route('**/api/games/*/military/units', async route => {
    if (runtime.militaryDelay) await new Promise(resolve => setTimeout(resolve, runtime.militaryDelay));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ units: runtime.units }) });
  });
  await page.route('**/api/games/*/military/fronts', async route => {
    if (runtime.militaryDelay) await new Promise(resolve => setTimeout(resolve, runtime.militaryDelay));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fronts: runtime.fronts }) });
  });
  await page.route('**/api/games/*/military/units/*/*', async route => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const action = parts.at(-1);
    const unitId = decodeURIComponent(parts.at(-2));
    const body = route.request().postDataJSON() || {};
    if (action === 'order') {
      runtime.orderCalls.push({ unitId, ...body });
      const impact = orderImpact(runtime, body.order, unitId, body.dryRun === true);
      if (!body.dryRun) runtime.units = runtime.units.map(item => item.id === unitId ? impact.unit : item);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(impact) });
    }
    runtime.actionCalls.push({ action, unitId, ...body });
    if (runtime.actionDelay) await new Promise(resolve => setTimeout(resolve, runtime.actionDelay));
    const impact = actionImpact(runtime, action, unitId, body.dryRun === true);
    if (!body.dryRun && runtime.forceNotApplied) {
      impact.applied = false;
      impact.note = 'Snapshot cambiato: richiedi una nuova anteprima.';
    } else if (!body.dryRun) runtime.units = runtime.units.map(item => item.id === unitId ? impact.unit : item);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(impact) });
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async customGame => {
    await import('/src/components/Map/MapboxMapView.tsx');
    const mapUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/maplibre-gl\.js(?:\?|$)/.test(url));
    if (!mapUrl) throw new Error('MapLibre module not loaded');
    const { default: maplibre } = await import(mapUrl);
    const addSource = maplibre.Map.prototype.addSource;
    maplibre.Map.prototype.addSource = function (id, source) {
      if (id === 'regions') window.__testMap = this;
      return addSource.call(this, id, source);
    };
    const { useGameStore, useUIStore } = await window.__wsAppModules();
    useGameStore.setState({ currentWorld: customGame.world, currentGame: customGame, selectedCountry: 'ITA', selectedRegion: null });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, game);
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
  await page.evaluate(() => window.__testMap.jumpTo({ center: [25, 45], zoom: 3.2 }));
  await expect(page.locator('[data-unit-id="ita-1"]')).toBeVisible();
  return runtime;
}

const context = (page, kind, id) => page.locator(`[data-map-context="${kind}"][data-map-context-id="${id}"]`);
const counter = (page, id) => page.locator(`[data-unit-id="${id}"]`);

async function clickRegion(page, lng, lat) {
  const point = await page.evaluate(([x, y]) => { const p = window.__testMap.project([x, y]); return { x: p.x, y: p.y }; }, [lng, lat]);
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
}
async function refreshSnapshot(page, patch) {
  await page.evaluate(async next => {
    const { useGameStore } = await window.__wsAppModules();
    const state = useGameStore.getState();
    useGameStore.setState({ currentGame: { ...state.currentGame, ...next } });
  }, patch);
  await page.waitForTimeout(350);
}
async function selectLayer(page, name) {
  const radio = page.getByRole('radio', { name });
  if (!(await radio.isVisible())) await page.locator('.map-legend-toggle').click();
  await radio.check();
}
async function openUnit(page, id = 'ita-1') {
  await page.evaluate(unitId => window.__testMap.jumpTo({ center: [unitId === 'aut-1' ? 45 : 5, 45], zoom: 3.2 }), id);
  await counter(page, id).click();
  await expect(context(page, 'unit', id)).toBeVisible();
  return context(page, 'unit', id);
}
async function previewAction(inspector, label, target) {
  await inspector.getByRole('button', { name: label, exact: true }).click();
  if (target) await inspector.getByRole('combobox').selectOption(target);
  await inspector.getByRole('button', { name: 'Anteprima', exact: true }).click();
}

/**
 * MAP P4.1 — percorso `Nazione → Armamenti → sala di governo → reparto`:
 * il secondo punto d'uso di `UnitActionPanel`, quello senza context inspector.
 */
async function openNationArsenal(page, unitLabel = 'ITA 1° Reparto') {
  await page.evaluate(async () => {
    const { useGameStore, useUIStore } = await window.__wsAppModules();
    useGameStore.setState({ selectedRegion: 'ROM' });
    useUIStore.setState({ activeModule: 'nation' });
  });
  await page.getByRole('button', { name: 'Armamenti', exact: true }).click();
  const board = page.locator('.obj-board');
  await expect(board).toBeVisible();
  await board.locator('.obj-sector').filter({ hasText: 'Forze armate' })
    .getByRole('button', { name: /^Apri/ }).click();
  const card = board.locator(`.obj-object[aria-label="${unitLabel}"]`);
  await expect(card).toBeVisible();
  return card;
}

// A — region click selects the canonical region ID and opens the same inspector.
test('MAP P4 / A — click territorio → context region by ID', async ({ page }) => {
  await openP4Map(page);
  await clickRegion(page, 35, 45);
  await expect(context(page, 'region', 'AUT')).toBeVisible();
  await expect(context(page, 'region', 'AUT')).toContainText('Austria');
  await expect.poll(() => page.evaluate(async () => (await window.__wsAppModules()).useGameStore.getState().selectedRegion)).toBe('AUT');
});

test('MAP P4 / B — reparto player → dettaglio e controlli pubblicati dal motore', async ({ page }) => {
  await openP4Map(page);
  await page.evaluate(() => window.__testMap.jumpTo({ center: [5, 45], zoom: 3.2 }));
  await counter(page, 'ita-1').focus();
  await page.keyboard.press('Enter');
  const inspector = context(page, 'unit', 'ita-1');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/8[.\u00a0]?400/);
  await expect(inspector).toContainText('72%');
  await expect(inspector.locator('[data-unit-action-panel="ita-1"]')).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Rinforza', exact: true })).toBeEnabled();
});

test('MAP P4 / C — reparto NPC visibile ma read-only', async ({ page }) => {
  await openP4Map(page);
  const inspector = await openUnit(page, 'aut-1');
  await expect(inspector).toContainText('AUT 3° Reparto');
  await expect(inspector.locator('[data-unit-readonly="aut-1"]')).toBeVisible();
  await expect(inspector.locator('[data-unit-action-panel]')).toHaveCount(0);
});

test('MAP P4 / D — dry-run Reinforce non muta e mostra PRIMA → DOPO', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  await expect(inspector.getByRole('group', { name: /Rinforza · ITA 1° Reparto/ })).toBeVisible();
  await expect(inspector).toContainText(/8[.\u00a0]?400/);
  await expect(inspector).toContainText(/9[.\u00a0]?000/);
  expect(runtime.actionCalls.at(-1)).toMatchObject({ action: 'reinforce', unitId: 'ita-1', dryRun: true });
  expect(runtime.units.find(item => item.id === 'ita-1').personnel).toBe(8400);
});

test('MAP P4 / E — conferma usa stesso endpoint con dryRun=false e refresh canonico', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  await inspector.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect.poll(() => runtime.actionCalls.map(call => call.dryRun)).toEqual([true, false]);
  await expect(inspector).toContainText(/9[.\u00a0]?000/);
  expect(runtime.units.find(item => item.id === 'ita-1').personnel).toBe(9000);
});

test('MAP P4 / F — transfer mostra rotta server e conferma P6 senza teleport', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Trasferisci', 'BOL');
  await expect(inspector).toContainText('Roma → Firenze → Bologna');
  await expect(inspector).toContainText('2 tratte');
  await expect(inspector).toContainText('15 giorni/tratta');
  await expect(inspector).toContainText('3 mar 1951');
  expect(runtime.actionCalls.at(-1)).toMatchObject({ action: 'transfer', regionId: 'BOL', dryRun: true });
  await inspector.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect.poll(() => runtime.actionCalls.map(call => call.dryRun)).toEqual([true, false]);
  await expect(counter(page, 'ita-1')).toHaveAttribute('data-unit-region', 'ROM');
  await expect(page.locator('[data-movement-unit-id="ita-1"]')).toHaveAttribute('data-route-path', 'ROM,FIR,BOL');
});

test('MAP P4 / G — fronte → dettaglio → reparto player', async ({ page }) => {
  await openP4Map(page);
  await page.locator('[data-front-id="F1"]').focus();
  await page.keyboard.press('Space');
  const inspector = context(page, 'front', 'F1');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Fronte Alpino');
  await expect(inspector).toContainText('63%');
  await expect(inspector).toContainText('48%');
  await expect(inspector).toContainText('Austria');
  await inspector.locator('[data-context-unit="ita-1"]').click();
  await expect(context(page, 'unit', 'ita-1')).toBeVisible();
});

test('MAP P4 / H — ordine di fronte appartiene al reparto: dry-run poi confirm', async ({ page }) => {
  const runtime = await openP4Map(page);
  await page.locator('[data-front-id="F1"]').click();
  await context(page, 'front', 'F1').locator('[data-context-unit="ita-1"]').click();
  const inspector = context(page, 'unit', 'ita-1');
  await previewAction(inspector, 'Attacca');
  await expect(inspector).toContainText('Fronte Alpino');
  await inspector.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect.poll(() => runtime.orderCalls.map(call => call.dryRun)).toEqual([true, false]);
  expect(runtime.units.find(item => item.id === 'ita-1').order).toBe('attack');
  await expect(inspector).toContainText('Attacca');
});

test('MAP P4 / I — il fronte non espone comandi front-wide inventati', async ({ page }) => {
  await openP4Map(page);
  await page.locator('[data-front-id="F1"]').click();
  const inspector = context(page, 'front', 'F1');
  await expect(inspector.getByRole('button', { name: /Attacca fronte/i })).toHaveCount(0);
  await expect(inspector).toContainText(/ordini ai reparti, non al fronte/i);
});

test('MAP P4 / J — territorio conquistato non cambia unit.polityId authority', async ({ page }) => {
  await openP4Map(page);
  const inspector = await openUnit(page, 'aut-1');
  await expect(inspector).toContainText('Austria (AUT)');
  await expect(inspector).toContainText('Budapest');
  await expect(inspector.locator('[data-unit-readonly="aut-1"]')).toBeVisible();
  await expect(inspector.locator('[data-unit-action-panel]')).toHaveCount(0);
});

test('MAP P4 / K — cambio snapshot invalida una preview stale', async ({ page }) => {
  await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toBeVisible();
  await refreshSnapshot(page, { worldRevision: 6, currentDate: '1951-02-02' });
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toHaveCount(0);
});

test('MAP P4 / L — rewind ribinda l’ID al reparto canonico aggiornato', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  runtime.units = runtime.units.map(item => item.id === 'ita-1'
    ? { ...item, regionId: 'BOL', regionName: 'Bologna', order: 'reserve', updatedDate: '1951-01-15' }
    : item);
  await refreshSnapshot(page, { worldRevision: 2, currentTurn: 2, currentDate: '1951-01-15', headBranchId: 'branch-restored' });
  await expect(inspector).toContainText('Bologna');
  await expect(inspector).toContainText('Riserva');
  await expect(inspector).not.toContainText('Roma →');
});

test('MAP P4 / M — unità rimossa: nessun dettaglio stale', async ({ page }) => {
  const runtime = await openP4Map(page);
  await openUnit(page);
  runtime.units = runtime.units.filter(item => item.id !== 'ita-1');
  await refreshSnapshot(page, { worldRevision: 6, currentDate: '1951-02-02' });
  await expect(context(page, 'unit', 'ita-1')).toHaveCount(0);
  await expect(page.locator('[data-map-context-id="ita-1"]')).toHaveCount(0);
});

test('MAP P4 / N — 360×740: select, dry-run, confirm e nessun overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect.poll(() => runtime.actionCalls.map(call => call.dryRun)).toEqual([true, false]);
  const dimensions360 = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions360.scroll).toBeLessThanOrEqual(dimensions360.width);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(inspector).toBeVisible();
  const dimensions430 = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions430.scroll).toBeLessThanOrEqual(dimensions430.width);
});

test('MAP P4 / O — il contesto non cambia automaticamente il layer', async ({ page }) => {
  await openP4Map(page);
  await selectLayer(page, 'Economia');
  await clickRegion(page, 35, 45);
  await expect(page.locator('.world-map')).toHaveAttribute('data-map-layer', 'economy');
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();
  await selectLayer(page, 'Militare');
  await counter(page, 'ita-1').click();
  await expect(page.locator('.world-map')).toHaveAttribute('data-map-layer', 'military');
});

test('MAP P4 / P — cambio snapshot durante il refresh: preview non confermabile, ID ribindato', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toBeVisible();

  // Refresh lento: la preview appartiene allo snapshot precedente e non è
  // confermabile (MAP P2.1 resta invariata: il banner dichiara il pending).
  runtime.militaryDelay = 2500;
  await refreshSnapshot(page, { worldRevision: 6, currentDate: '1951-02-02' });
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toHaveCount(0);
  runtime.militaryDelay = 0;
  // Alla risposta lo stesso ID è ribindato al reparto canonico aggiornato.
  await expect(inspector).toContainText(/8[.\u00a0]?400/);
  await expect(counter(page, 'ita-1')).toBeVisible({ timeout: 7000 });
  expect(runtime.actionCalls.every(call => call.dryRun)).toBe(true);
});

test('MAP P4 / Q — lock atomico: doppio click invia un solo dry-run', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await inspector.getByRole('button', { name: 'Rinforza', exact: true }).click();
  runtime.actionDelay = 1200;
  const preview = inspector.getByRole('button', { name: 'Anteprima', exact: true });
  await preview.evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => runtime.actionCalls.length).toBe(1);
  await expect(inspector.getByRole('group', { name: /Rinforza · ITA 1° Reparto/ })).toBeVisible();
});

test('MAP P4 / R — confirm non applicato invalida la preview, niente retry stale', async ({ page }) => {
  const runtime = await openP4Map(page);
  const inspector = await openUnit(page);
  await previewAction(inspector, 'Rinforza');
  runtime.forceNotApplied = true;
  await inspector.getByRole('button', { name: 'Conferma', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Conferma', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('alert')).toContainText('Snapshot cambiato');
  expect(runtime.units.find(item => item.id === 'ita-1').personnel).toBe(8400);
});

// S — MAP P4.1: la sala di governo (dossier nazionale) usa la stessa identità
// snapshot del context inspector: una preview stale non resta confermabile
// nemmeno mentre l'Operating Picture non è ancora tornata dal motore.
test('MAP P4.1 / S — dossier nazionale: anteprima invalidata dal cambio snapshot', async ({ page }) => {
  const runtime = await openP4Map(page, { forceRoot: true });
  const card = await openNationArsenal(page);
  const panel = card.locator('[data-unit-action-panel="ita-1"]');
  await expect(panel).toBeVisible();

  // A — preview valida: dry-run del motore e Conferma disponibile.
  await previewAction(panel, 'Rinforza');
  await expect(panel.getByRole('group', { name: /Rinforza · ITA 1° Reparto/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Conferma', exact: true })).toBeVisible();
  expect(runtime.actionCalls.at(-1)).toMatchObject({ action: 'reinforce', unitId: 'ita-1', dryRun: true });

  // B — cambia lo snapshot canonico mentre l'Operating Picture è **ferma**
  // (richiesta in volo, delay lungo): la preview sparisce per la chiave snapshot,
  // non perché è arrivato un `picture` nuovo.
  runtime.arsenalDelay = 12000;
  runtime.pictureEpoch = 2;
  await refreshSnapshot(page, { currentTurn: 5, currentDate: '1951-02-02', worldRevision: 6, headBranchId: 'branch-next' });
  await expect(panel.getByRole('group', { name: /Rinforza · ITA 1° Reparto/ })).toHaveCount(0, { timeout: 5000 });
  await expect(panel.getByRole('button', { name: 'Conferma', exact: true })).toHaveCount(0);
  // Prova che il read model è ancora quello vecchio: senza `snapshotKey` la
  // preview sarebbe ancora lì (il pannello si svuota solo col picture nuovo).
  await expect(card).toContainText('quadro 1');
  // Il reparto è sempre lo stesso oggetto: non è un unmount a nascondere la preview.
  await expect(panel).toBeVisible();
  // Nessuna mutazione stale è partita: serve una nuova anteprima.
  expect(runtime.actionCalls.every(call => call.dryRun)).toBe(true);
  await expect(panel.getByRole('button', { name: 'Rinforza', exact: true })).toBeEnabled();

  // C — stesso unit ID, nuovo Operating Picture: una preview richiesta nel
  // frattempo resta comunque invalidata quando il read model arriva.
  await previewAction(panel, 'Rinforza');
  const freshPreview = panel.getByRole('group', { name: /Rinforza · ITA 1° Reparto/ });
  await expect(freshPreview).toBeVisible();
  await expect(card).toContainText('quadro 2', { timeout: 20000 });
  await expect(freshPreview).toHaveCount(0, { timeout: 10000 });
  expect(runtime.actionCalls.every(call => call.dryRun)).toBe(true);
  expect(runtime.actionCalls.filter(call => call.action === 'reinforce')).toHaveLength(2);
});
