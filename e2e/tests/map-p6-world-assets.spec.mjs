/**
 * MAP P6 — geografia economica canonica mondiale
 * ==============================================
 * Prima di P6 il layer Risorse dipendeva dal quadro operativo del giocatore
 * (`/arsenal`, player-scoped): il mondo fuori dai confini era invisibile.
 * Qui si prova che la mappa pubblica giacimenti e impianti di **tutte** le
 * potenze leggendoli dal catalogo di scenario, con le regole della verità
 * geografica: nessun dato inventato, nessuna stima del browser, `known: null`
 * mai trasformato in `0`, una sola fotografia per snapshot.
 *
 * Fixture: mondo ITA/FRA/DEU con un giacimento tedesco (estero), un giacimento
 * italiano noto e uno con quantità ignota, un impianto francese con proprietario
 * e controllore diversi. Le riserve **nazionali** restano stock senza geografia.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_ACCOUNTS, MOCK_ARSENAL, MOCK_GAME } from '../mock-api.mjs';

const polygon = (west, south, east, north) => JSON.stringify({ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
} });
const territory = (id, name, color, geojson, owner, polityName, gdp, objects = [], metadata = {}) => ({
  id, name, polityName, owner, flag: owner, color, geojson, objects,
  population: 1_000_000, militaryPower: 30, gdp, borders: [], status: 'active', metadata,
});

const game = {
  ...MOCK_GAME,
  worldRevision: 5,
  players: [{ id: 'player', regionId: 'ITA', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA: territory('ITA', 'Italia', '#609f87', polygon(0, 40, 10, 50), 'ITA', 'Italia', 1000, [], { surface_type: 'Pianura' }),
    FRA: territory('FRA', 'Francia', '#7fb3a0', polygon(10, 40, 20, 50), 'FRA', 'Francia', 800, [], { surface_type: 'Collina' }),
    DEU: territory('DEU', 'Germania', '#c0a076', polygon(20, 40, 30, 50), 'DEU', 'Germania', 1200, [], { surface_type: 'Pianura' }),
  } },
};

/** MAP P6 — fotografia canonica mondiale servita da `/map-assets`. */
const WORLD_ASSETS = (
  canonical = true,
  resources = [
    {
      id: 'dep_coal_deu', resourceId: 'coal', resourceName: 'Carbone', regionId: 'DEU',
      accessibility: 'requires_extraction', known: true, knownQuantity: { resourceId: 'coal', baseUnits: '80000' },
    },
    {
      id: 'dep_iron_ita', resourceId: 'iron_ore', resourceName: 'Minerale di ferro', regionId: 'ITA',
      accessibility: 'open', known: true, knownQuantity: { resourceId: 'iron_ore', baseUnits: '100000' },
    },
    {
      // Quantità non determinata: ignoranza, mai zero.
      id: 'dep_unknown_ita', resourceId: 'uranium', resourceName: 'Uranio', regionId: 'ITA',
      accessibility: 'requires_extraction', known: false, knownQuantity: null,
      estimated: { low: '20000', base: '50000', high: '90000' },
    },
  ],
  facilities = [
    {
      id: 'fac_foundry_fra', typeId: 'ft_foundry', typeName: 'Altoforno', regionId: 'FRA',
      ownerActorId: 'fra_private', ownerActorName: 'Acciaierie private FRA',
      controllerActorId: 'deu_admin', controllerActorName: 'Amministrazione DEU',
      polityId: 'FRA', controllerPolityId: 'DEU', operational: true,
    },
  ],
) => ({ canonical, resources, facilities });

/** Riserve nazionali: il contratto non ha `regionId`, quindi nessuna geografia. */
const NATURAL = [
  { kind: 'oil', label: 'Riserva nazionale di greggio', renewable: false, endowment: 100, reserve: 80,
    maxReserve: 100, stockpile: 20, extractionPerMonth: 2, depletionPct: 20, depleted: false },
];

/**
 * Quadro operativo player-scoped: è il fallback P5.1 per i mondi **legacy**.
 * Contiene anche una miniera del giocatore: in stato `canonical` non deve
 * comparire (la sorgente mondiale vince), in stato `error` **nemmeno** (fail
 * closed: una mappa parziale player-only sembrerebbe corrente).
 */
const ARSENAL = {
  ...MOCK_ARSENAL,
  objects: {
    counts: { unit: 1, mine: 1 },
    conventions: ['Le azioni dei reparti arrivano dal motore.'],
    chains: [],
    objects: [{
      id: 'ita-1', kind: 'unit', label: 'ITA 1° Reparto', subtitle: 'army-ita · Italia',
      status: 'operational', statusLabel: 'Operativa', parentId: 'army-ita', regionId: 'ITA', regionName: 'Italia',
      facts: [], problems: [], why: 'Azioni pubblicate dal motore.',
      actions: [{ id: 'reinforce_unit', label: 'Rinforza', enabled: true, blockedReason: null }],
    }, {
      id: 'mine-ita-1', kind: 'mine', label: 'Giacimento del giocatore', subtitle: 'Giacimento 3/5',
      status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'ITA', regionName: 'Italia',
      facts: [], problems: [], why: 'Contributo calcolato dal motore.', actions: [],
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

/**
 * Monta la mappa con la fixture P6. `runtime.assets` è mutabile: cambiare
 * snapshot (turno/data/ramo) deve cambiare la fotografia servita.
 */
async function openP6Map(page, { assets = WORLD_ASSETS(), failAssets = false, delayMs = 0 } = {}) {
  const runtime = { assets, calls: 0 };
  installMockApi(page);
  await installStoreBridge(page);
  await page.route('**/api/games/*/map-assets', async route => {
    runtime.calls += 1;
    if (failAssets) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) });
      return;
    }
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtime.assets) });
  });
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
      selectedCountry: 'ITA', selectedRegion: null,
    });
    useUIStore.setState({ currentView: 'game', activeModule: 'none' });
  }, game);
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled();
  await page.evaluate(() => window.__testMap.jumpTo({ center: [15, 45], zoom: 3.2 }));
  return runtime;
}

const mapLayer = (page) => page.locator('.world-map');
const context = (page, id) => page.locator(`[data-map-context="region"][data-map-context-id="${id}"]`);

const CENTER = { ITA: [5, 45], FRA: [15, 45], DEU: [25, 45] };
const CLICK = { ITA: [1.5, 42], FRA: [11.5, 42], DEU: [21.5, 42] };

async function clickRegion(page, id) {
  await page.evaluate(coords => window.__testMap.jumpTo({ center: coords, zoom: 4 }), CENTER[id]);
  await page.waitForTimeout(200);
  const point = await page.evaluate(coords => {
    const projected = window.__testMap.project(coords);
    return { x: projected.x, y: projected.y };
  }, CLICK[id]);
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(context(page, id)).toBeVisible();
  return context(page, id);
}

async function selectLayer(page, label) {
  const legend = page.locator('.map-legend-toggle');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await page.getByRole('radio', { name: label, exact: true }).check();
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', LAYER_IDS[label]);
  if (await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

const resourceMarker = (page, id) => page.locator(`[data-map-resource-marker="${id}"]`);
const facilityMarker = (page, id) => page.locator(`[data-map-facility-marker="${id}"]`);

const camera = (page) => page.evaluate(() => {
  const center = window.__testMap.getCenter();
  return { lng: Number(center.lng.toFixed(4)), lat: Number(center.lat.toFixed(4)) };
});

async function refreshSnapshot(page, patch) {
  await page.evaluate(async next => {
    const { useGameStore } = await window.__wsAppModules();
    const state = useGameStore.getState();
    useGameStore.setState({ currentGame: { ...state.currentGame, ...next } });
  }, patch);
  await page.waitForTimeout(350);
}

// A — LA prova di P6: un giacimento canonico estero è un marker reale sulla mappa.
test('MAP P6 / A — il giacimento estero è un marker cliccabile che apre il region context', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Risorse');
  const marker = resourceMarker(page, 'dep_coal_deu');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('data-region-id', 'DEU');
  await expect(marker).toHaveAttribute('aria-label', /Carbone — Germania/);
  // Marker → region context → dossier: stesso read model per mappa e dossier.
  await marker.click();
  const germania = context(page, 'DEU');
  await expect(germania).toBeVisible();
  await expect(germania.locator('[data-resource-sites="DEU"]')).toContainText('Carbone');
  await expect(germania.locator('[data-resource-site="dep_coal_deu"]'))
    .toHaveAttribute('data-resource-kind', 'coal');
  await expect(germania.locator('[data-resource-site="dep_coal_deu"]'))
    .toHaveAttribute('data-resource-accessibility', 'requires_extraction');
  // Anche il giacimento del giocatore è un marker, dalla stessa fonte mondiale.
  await expect(resourceMarker(page, 'dep_iron_ita')).toBeVisible();
  // In stato canonico la miniera player-scoped (fallback P5.1) non appare.
  await expect(context(page, 'DEU')).not.toContainText('Giacimento del giocatore');
});

// A2 — Accessibilità: i marker sono <button> reali, attivabili da tastiera.
test('MAP P6 / A2 — i marker sono button accessibili (Enter/Space, focus, aria-label)', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Risorse');
  const marker = resourceMarker(page, 'dep_coal_deu');
  await expect(marker).toBeVisible();
  // Elemento nativo: attivabile da tastiera senza handler aggiuntivi.
  expect(await marker.evaluate(el => el.tagName)).toBe('BUTTON');
  expect(await marker.evaluate(el => el.type)).toBe('button');
  await marker.focus();
  await expect(marker).toBeFocused();
  await marker.press('Enter');
  await expect(context(page, 'DEU')).toBeVisible();
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();
  await expect(context(page, 'DEU')).toHaveCount(0);
  // Anche Space attiva: semantica nativa del bottone, nessun handler aggiuntivo.
  // `locator.press` invia la sequenza al marker (down+up): la finestra tra i due
  // eventi resta minima e il test non dipende dal focus globale della pagina.
  await marker.press('Space');
  await expect(context(page, 'DEU')).toBeVisible();
  // Il marker dichiara la semantica: asset localizzato nella regione, non punto esatto.
  const label = await resourceMarker(page, 'dep_coal_deu').getAttribute('aria-label');
  expect(label).toContain('Germania');
  expect(label).toContain('Carbone');
});

// B — Nessuna invenzione: uno stock nazionale senza `regionId` non produce geografia.
test('MAP P6 / B — le riserve nazionali non diventano marker territoriali', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Risorse');
  const italia = await clickRegion(page, 'ITA');
  await expect(italia.locator('[data-resource-sites="ITA"]')).not.toContainText('Riserva nazionale');
  await expect(page.locator('.maplibregl-marker', { hasText: 'Riserva nazionale di greggio' })).toHaveCount(0);
  const francia = await clickRegion(page, 'FRA');
  await expect(francia.locator('[data-resources-none="FRA"]')).toBeVisible();
  await expect(francia).toContainText('Le riserve nazionali non vengono distribuite arbitrariamente sulla mappa.');
});

// C — `known: null` è ignoranza, non zero.
test('MAP P6 / C — quantità non determinata, mai zero', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Risorse');
  const marker = resourceMarker(page, 'dep_unknown_ita');
  await expect(marker).toBeVisible();
  // Il marker non mostra quantità ignote.
  await expect(marker).toHaveAttribute('aria-label', /quantità non determinata/);
  await marker.click();
  const italia = context(page, 'ITA');
  const ignoto = italia.locator('[data-resource-site="dep_unknown_ita"]');
  await expect(ignoto).toHaveAttribute('data-resource-known', 'false');
  await expect(ignoto).toContainText('quantità non determinata');
  await expect(ignoto).not.toContainText('0');
  const noto = italia.locator('[data-resource-site="dep_iron_ita"]');
  await expect(noto).toHaveAttribute('data-resource-known', 'true');
  await expect(noto).toContainText('dato noto');
});

// D — Impianto estero canonico: marker reale nel layer Infrastrutture.
test('MAP P6 / D — l’impianto estero è un marker cliccabile in Infrastrutture', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Infrastrutture');
  const marker = facilityMarker(page, 'fac_foundry_fra');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('data-region-id', 'FRA');
  await expect(marker).toHaveAttribute('aria-label', /Altoforno — Francia/);
  await marker.click();
  const francia = context(page, 'FRA');
  await expect(francia).toBeVisible();
  const impianto = francia.locator('[data-infrastructure-item="fac_foundry_fra"]');
  await expect(impianto).toBeVisible();
  await expect(impianto).toHaveAttribute('data-infrastructure-source', 'canonical');
  await expect(impianto).toContainText('Altoforno');
  await expect(impianto).toContainText('operativo');
});

// E — Proprietario, controllore e potenza restano distinti.
test('MAP P6 / E — proprietà economica ≠ controllo ≠ territorio', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Infrastrutture');
  const francia = await clickRegion(page, 'FRA');
  const impianto = francia.locator('[data-infrastructure-item="fac_foundry_fra"]');
  await expect(impianto).toContainText('Proprietario: Acciaierie private FRA');
  await expect(impianto).toContainText('Controllore: Amministrazione DEU');
  await expect(impianto).toContainText('Potenza: FRA');
  await expect(impianto).toContainText('Controllo: DEU');
  // La regione francese resta francese: la mappa politica non viene riscritta.
  await selectLayer(page, 'Politica');
  await expect(context(page, 'FRA')).toContainText('Francia');
});

// F — Isolamento dei layer, verificato sui **marker** (non solo sul dossier).
test('MAP P6 / F — ogni layer disegna solo i propri marker', async ({ page }) => {
  await openP6Map(page);
  await selectLayer(page, 'Politica');
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(0);
  await selectLayer(page, 'Economia');
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(0);
  await selectLayer(page, 'Risorse');
  expect(await page.locator('[data-map-resource-marker]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(0);
  await selectLayer(page, 'Infrastrutture');
  expect(await page.locator('[data-map-facility-marker]').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  // E il dossier segue lo stesso layer.
  const francia = await clickRegion(page, 'FRA');
  await expect(francia.locator('[data-resource-site]')).toHaveCount(0);
});

// G — Coerenza di snapshot: i marker cambiano con lo snapshot, mai stale.
test('MAP P6 / G — il cambio snapshot sostituisce i marker, il rewind li ripristina', async ({ page }) => {
  const runtime = await openP6Map(page);
  await selectLayer(page, 'Risorse');
  await expect(resourceMarker(page, 'dep_coal_deu')).toBeVisible();
  // Nuovo snapshot: il marker tedesco sparisce, ne compare uno francese.
  runtime.assets = WORLD_ASSETS(true, [
    {
      id: 'dep_oil_fra', resourceId: 'oil', resourceName: 'Petrolio', regionId: 'FRA',
      accessibility: 'requires_extraction', known: true, knownQuantity: null,
    },
  ], []);
  await refreshSnapshot(page, { currentTurn: 2, currentDate: '1951-02-01', worldRevision: 6, headBranchId: 'branch-next' });
  await selectLayer(page, 'Risorse');
  await expect(resourceMarker(page, 'dep_oil_fra')).toBeVisible();
  await expect(resourceMarker(page, 'dep_coal_deu')).toHaveCount(0);
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(1);
  // Rewind: torna lo snapshot precedente e con esso i suoi marker.
  runtime.assets = WORLD_ASSETS();
  await refreshSnapshot(page, { currentTurn: 1, currentDate: '1951-01-15', worldRevision: 7, headBranchId: 'branch-rewind' });
  await selectLayer(page, 'Risorse');
  await expect(resourceMarker(page, 'dep_coal_deu')).toBeVisible();
  await expect(resourceMarker(page, 'dep_oil_fra')).toHaveCount(0);
  // Anche il dossier racconta lo stesso snapshot.
  const germania = await clickRegion(page, 'DEU');
  await expect(germania.locator('[data-resource-site="dep_oil_fra"]')).toHaveCount(0);
});

// G2 — Fail closed: errore della sorgente canonica ≠ mondo legacy.
test('MAP P6 / G2 — errore: nessun asset canonico e nessun fallback player-only', async ({ page }) => {
  const runtime = await openP6Map(page);
  await selectLayer(page, 'Risorse');
  await expect(resourceMarker(page, 'dep_coal_deu')).toBeVisible();
  // Il refresh successivo fallisce: la sorgente canonica non è più disponibile.
  runtime.assets = WORLD_ASSETS();
  await page.unroute('**/api/games/*/map-assets');
  await page.route('**/api/games/*/map-assets', route => {
    runtime.calls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) });
  });
  await refreshSnapshot(page, { currentTurn: 3, currentDate: '1951-03-01', worldRevision: 8 });
  await selectLayer(page, 'Risorse');
  // 1. il marker dello snapshot precedente sparisce (mai asset stale);
  await expect(resourceMarker(page, 'dep_coal_deu')).toHaveCount(0);
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(0);
  // 2. **nessun** fallback player-scoped: la miniera del giocatore resta fuori;
  await expect(page.locator('.maplibregl-marker', { hasText: 'Giacimento del giocatore' })).toHaveCount(0);
  // 3. il layer dichiara l'indisponibilità invece di mostrare un mondo parziale.
  await expect(mapLayer(page)).toHaveAttribute('data-resources-available', 'false');
  await expect(mapLayer(page)).toContainText('Dati territoriali non disponibili');
  const italia = await clickRegion(page, 'ITA');
  await expect(italia.locator('[data-resource-site]')).toHaveCount(0);
  await expect(italia).not.toContainText('Giacimento del giocatore');
  expect(runtime.calls).toBeGreaterThan(1);
});

// H — Mobile 360×740: marker cliccabile, dossier leggibile, nessun traboccamento.
test('MAP P6 / H — 360×740: marker e impianto canonico restano leggibili', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openP6Map(page);
  await selectLayer(page, 'Infrastrutture');
  const marker = facilityMarker(page, 'fac_foundry_fra');
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(16);
  expect(box.height).toBeGreaterThanOrEqual(16);
  await marker.click();
  const francia = context(page, 'FRA');
  const impianto = francia.locator('[data-infrastructure-item="fac_foundry_fra"]');
  await expect(impianto).toBeVisible();
  await impianto.scrollIntoViewIfNeeded();
  await expect(impianto).toContainText('Proprietario: Acciaierie private FRA');
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  expect(await camera(page)).toEqual({ lng: 15, lat: 45 });
});
