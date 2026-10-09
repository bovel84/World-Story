import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME } from '../mock-api.mjs';

const regions = Object.fromEntries(['ALPHA', 'BETA', 'GAMMA'].map((id, index) => [id, {
  id, name: ['Alfa', 'Beta', 'Gamma'][index], owner: id, polityName: id, color: ['#609f87', '#c08d76', '#8f8fc0'][index],
  svgPath: `M${index * 100} 0L${index * 100 + 100} 0L${index * 100 + 100} 100L${index * 100} 100Z`,
  geojson: JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[index * 10, 40], [index * 10 + 10, 40], [index * 10 + 10, 50], [index * 10, 50], [index * 10, 40]]] } }),
  objects: [], borders: [], metadata: {}, population: 1000000, gdp: 100, militaryPower: 20,
}]));
const front = { id: 'F1', name: 'Fronte di confine', regionIds: ['ALPHA', 'BETA'], status: 'active', objectiveRegionId: 'BETA', attackerPolityId: 'ALPHA', defenderPolityId: 'BETA', attackerPressure: 0.6, defenderPressure: 0.4, createdDate: '1951-01-01', updatedDate: '1951-01-01' };

async function openAdvisor(page, mode, diplomaticIssue = false) {
  installMockApi(page);
  if (mode === 'static') await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return /^webgl|experimental-webgl/.test(type) ? null : getContext.call(this, type, ...args); };
  });
  const worldRegions = mode === 'svg' ? Object.fromEntries(Object.entries(regions).map(([id, region]) => [id, { ...region, geojson: undefined }])) : regions;
  const runtime = { fronts: diplomaticIssue ? [] : [front], delay: 0, game: { ...MOCK_GAME, headBranchId: 'branch1', worldRevision: 1, world: { ...MOCK_GAME.world, regions: worldRegions } } };
  await page.route('**/api/games/*/military/fronts', async route => {
    if (runtime.delay) await new Promise(resolve => setTimeout(resolve, runtime.delay));
    await route.fulfill({ json: { fronts: runtime.fronts } });
  });
  if (diplomaticIssue) await page.route('**/api/games/*/relationships', route => route.fulfill({ json: { relationships: { ALPHA: { BETA: 'hostile', GAMMA: 'neutral' } }, names: { ALPHA: 'Alfa', BETA: 'Beta' } } }));
  const signalKeys = diplomaticIssue ? ['hostile-relations'] : ['conflict:F1'];
  const issues = diplomaticIssue ? [{ id: 'diplomacy', situationId: 'border', title: 'La questione diplomatica', question: 'Come gestiamo la relazione?', signalKeys, suggestedMinisters: ['esteri'], origin: 'advisor', createdDate: '1951-01-01', sourceRefs: ['relations:ALPHA:BETA'], verifiedFacts: [{ key: 'hostile', label: 'Relazione', value: 'Ostile', source: 'engine', sourceRef: 'relations:ALPHA:BETA' }] }] : [];
  await page.route('**/api/games/*/advisor/opening', route => route.fulfill({ json: {
    reply: 'Presidente, il confine richiede attenzione.', issues, situations: [{ id: 'border', title: 'La questione del confine', summary: 'La relazione richiede attenzione.', importance: 3, signalKeys }], advisorContext: { verifiedWorldSnapshot: { date: '1951-01-01' } },
  } }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async ({ game, mode }) => {
    const urls = performance.getEntriesByType('resource').map(entry => entry.name);
    const gameUrl = urls.find(url => /\/src\/stores\/gameStore\.ts(\?|$)/.test(url)) || '/src/stores/gameStore.ts';
    const uiUrl = urls.find(url => /\/src\/stores\/uiStore\.ts(\?|$)/.test(url)) || '/src/stores/uiStore.ts';
    const simUrl = urls.find(url => /\/src\/stores\/simulationRuntime\.ts(\?|$)/.test(url)) || '/src/stores/simulationRuntime.ts';
    const [{ useGameStore }, { useUIStore }, { useSimulationStore }] = await Promise.all([import(gameUrl), import(uiUrl), import(simUrl)]);
    window.__visualStores = { useGameStore, useUIStore, useSimulationStore };
    if (mode === 'geo') {
      await import('/src/components/Map/MapboxMapView.tsx');
      const mapUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/maplibre-gl\.js(?:\?|$)/.test(url));
      const { default: maplibre } = await import(mapUrl);
      const addSource = maplibre.Map.prototype.addSource;
      const fitBounds = maplibre.Map.prototype.fitBounds;
      window.__visualFits = [];
      maplibre.Map.prototype.addSource = function (id, source) { if (id === 'regions') window.__visualMap = this; return addSource.call(this, id, source); };
      maplibre.Map.prototype.fitBounds = function (bounds, options) { window.__visualFits.push(bounds.toArray ? bounds.toArray() : bounds); return fitBounds.call(this, bounds, options); };
    }
    useGameStore.setState({ currentGame: game, currentWorld: game.world, selectedCountry: 'ALPHA', selectedRegion: null });
    useUIStore.setState({ currentView: 'game', activeModule: 'none', showOpening: false });
  }, { game: runtime.game, mode });
  await expect(page.locator('.game-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await expect(page.locator('.advisor-opening')).toBeVisible();
  if (!diplomaticIssue) await expect(page.locator('.advisor-opening .government-visual-card')).toBeVisible();
  return runtime;
}

for (const [mode, width] of [['geo', 1440], ['svg', 390], ['static', 390]]) {
  test(`Advisor → main map: real ${mode} geometry, multi-focus, no execution or extra model request (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let openings = 0;
    page.on('request', request => { if (request.url().endsWith('/advisor/opening')) openings++; });
    await openAdvisor(page, mode);
    const card = page.locator('.advisor-opening .government-visual-card');
    await expect(card.locator('svg')).toBeVisible();
    await expect(card.locator('canvas, img')).toHaveCount(0);
    await expect(card).toContainText('Alfa · Beta');
    await expect(card.locator('.government-visual-legend')).toContainText('ALPHA');
    await expect(card.locator('.government-visual-legend')).toContainText('BETA');
    expect(await card.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
    await card.screenshot({ path: `/tmp/government-map-focus-${mode}-card.png` });
    const openingsBeforeFocus = openings; // Dev StrictMode can abort/replay the existing opening effect.
    const writes = [];
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await card.getByRole('button', { name: 'Mostra sulla mappa principale' }).click();
    await expect(page.locator('.government-office')).not.toBeVisible();
    if (mode === 'geo') {
      await expect(page.locator('.maplibregl-canvas')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__visualMap?.getFeatureState({ source: 'regions', id: 'BETA' }).focused)).toBe(true);
      expect(await page.evaluate(() => window.__visualFits.at(-1))).toEqual([[0, 40], [20, 50]]);
      expect(await page.evaluate(() => window.__visualMap.getFeatureState({ source: 'regions', id: 'ALPHA' }).focused)).toBe(true);
      expect(await page.evaluate(() => window.__visualMap.getFeatureState({ source: 'regions', id: 'GAMMA' }).focused)).not.toBe(true);
      expect(await page.evaluate(() => window.__visualMap.getPaintProperty('regions-fill', 'fill-color'))).toEqual(['get', 'color']);
    } else {
      const svg = page.locator(mode === 'svg' ? '.map-view-container > svg' : '.static-geo-map-canvas');
      await expect(svg).toBeVisible();
      await expect(svg.locator('path[stroke="#ffffff"]')).toHaveCount(2);
      expect(await svg.getAttribute('viewBox')).not.toBe(mode === 'svg' ? '0 0 2000 1500' : '0 0 1000 600');
    }
    await page.screenshot({ path: `/tmp/government-map-focus-${mode}-main.png` });
    expect(writes).toEqual([]);
    expect(openings).toBe(openingsBeforeFocus);
    expect(errors).toEqual([]);
  });
}

test('branch/restore hides old fronts until matching refresh, then revalidates recovery/removal', async ({ page }) => {
  const runtime = await openAdvisor(page, 'svg');
  runtime.delay = 1500;
  async function replaceEpoch(branchId, worldRevision) {
    await page.evaluate(({ branchId, worldRevision }) => {
      const { useGameStore, useSimulationStore } = window.__visualStores;
      const game = useGameStore.getState().currentGame;
      useGameStore.setState({ currentGame: { ...game, headBranchId: branchId, worldRevision } });
      // Runtime already matches: only the fetch-provenance gate can prevent
      // yesterday's front array from being re-badged in the pre-refresh render.
      useSimulationStore.getState().initGame(game.id, branchId, worldRevision);
    }, { branchId, worldRevision });
  }
  let refreshed = page.waitForResponse(response => response.url().endsWith('/military/fronts'));
  await replaceEpoch('restored-branch', 2);
  await expect(page.locator('.government-visual-card')).toHaveCount(0);
  await refreshed;
  await expect(page.locator('.government-visual-card')).toBeVisible();
  runtime.fronts = [];
  refreshed = page.waitForResponse(response => response.url().endsWith('/military/fronts'));
  await replaceEpoch('rewound-branch', 3);
  await expect(page.locator('.government-visual-card')).toHaveCount(0);
  await refreshed;
  await expect(page.locator('.government-visual-card')).toHaveCount(0);
});

for (const [mode, width, requested] of [['geo', 1440, true], ['svg', 390, false]]) {
  test(`Council ${mode}: ${requested ? 'explicit intent without directive' : 'spontaneous minister directive'}, no front required, one completion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let completions = 0;
    await openAdvisor(page, mode, true);
    await page.route('**/api/games/*/government/minister/esteri', route => {
      completions++;
      const directive = requested ? '' : '\n```tavola\n{"op":"show","evidence":"mappa","regionIds":["ALPHA","BETA"]}\n```';
      return route.fulfill({ json: { seat: 'esteri', reply: 'Presidente, la relazione richiede prudenza.' + directive } });
    });
    if (requested) await page.locator('.advisor-situation-open').click();
    else await page.locator('.cabinet-pick[data-seat="esteri"]').click();
    const input = page.getByRole('textbox', { name: 'Messaggio del Presidente' });
    await expect(input).toBeEnabled();
    await input.fill(requested ? 'Fammi vedere la mappa.' : 'Valutiamo la questione.');
    await page.locator('.council-room-compose button[type="submit"]').click();
    const speech = page.locator('.council-room-message.assistant').last();
    const card = speech.locator('.government-visual-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(requested ? 'Contesto diplomatico' : 'Contesto territoriale');
    await expect(speech.locator('.council-room-prose')).toContainText('la relazione richiede prudenza');
    await expect(speech).not.toContainText('```tavola');
    await expect(card.locator('svg path')).toHaveCount(2);
    await expect(card.locator('canvas, img')).toHaveCount(0);
    expect(await card.evaluate(element => element.previousElementSibling?.className)).toBe('council-room-prose');
    await expect(page.locator('.council-room-summary')).toContainText('0 misure');
    await page.getByRole('button', { name: 'Tavola ↑', exact: true }).click();
    if (width < 600) {
      await expect(page.locator('#council-board-sheet-title')).toBeVisible();
      await page.getByRole('button', { name: 'Torna al Consiglio', exact: true }).click();
    } else {
      await expect(page.locator('.council-room-drawer')).toBeVisible();
      await page.getByRole('button', { name: 'Chiudi la Tavola', exact: true }).click();
    }
    await card.screenshot({ path: `/tmp/council-visual-${mode}-card.png` });
    await card.getByRole('button', { name: 'Mostra sulla mappa principale' }).click();
    await expect(page.locator('.government-office')).not.toBeVisible();
    if (mode === 'geo') {
      await expect.poll(() => page.evaluate(() => window.__visualMap?.getFeatureState({ source: 'regions', id: 'BETA' }).focused)).toBe(true);
      expect(await page.evaluate(() => window.__visualFits.at(-1))).toEqual([[0, 40], [20, 50]]);
    } else {
      await expect(page.locator('.map-view-container > svg path[stroke="#ffffff"]')).toHaveCount(2);
    }
    expect(completions).toBe(1);
  });
}
