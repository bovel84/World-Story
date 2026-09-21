/**
 * MAP P5 — contesto strategico e drill-down tematico
 * ==================================================
 * La mappa non deve solo colorare: selezionando un territorio il dossier deve
 * **spiegare** il layer attivo con dati canonici, e distinguere sempre
 * «fatto della provincia» da «contesto della potenza».
 *
 * Questo harness monta un mondo con PIL diversi, opere territoriali, un cantiere,
 * una riserva nazionale con `regionId` (sito canonico) e una senza (stock non
 * geolocalizzato), relazioni canoniche, agenda strategica e registro impegni.
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
  players: [{ id: 'player', regionId: 'ITA', polityId: 'ITA', name: 'Player' }],
  world: { ...MOCK_GAME.world, regions: {
    ITA: territory('ITA', 'Italia', '#609f87', polygon(0, 40, 10, 50), 'ITA', 'Italia', 1000, [
      { id: 'milano', type: 'factory', name: 'Fabbrica di Milano', lat: 45.46, lng: 9.19 },
      { id: 'cantiere-1', type: 'construction_site', name: 'Porto nuovo', lat: 44.4, lng: 8.9, metadata: { phase: 'fondamenta' } },
      { id: 'radar-sud', type: 'radar', name: 'Stazione radar Sud', lat: 41.1, lng: 16.8 },
      { id: 'armata', type: 'army', name: '1ª Armata', lat: 45.1, lng: 9.5 },
    ], { surface_type: 'Pianura', tags: ['industriale'] }),
    FRA: territory('FRA', 'Francia', '#7fb3a0', polygon(10, 40, 20, 50), 'FRA', 'Francia', 500, [], { surface_type: 'Collina' }),
    AUT: territory('AUT', 'Austria', '#c08d76', polygon(20, 40, 30, 50), 'AUT', 'Austria', 100, [], { terrain: 'Alpino' }),
    SUI: territory('SUI', 'Svizzera', '#8f8fc0', polygon(30, 40, 40, 50), 'SUI', 'Svizzera', 0),
  } },
};

const UNITS = [
  { id: 'ita-1', polityId: 'ITA', armyId: 'army-ita', name: 'ITA 1° Reparto', personnel: 8430, equipment: { rifles: 5000 },
    monthlyNeeds: { fuel: 1, weapons: 2, food: 3 }, readiness: 0.62, status: 'operational', regionId: 'ITA',
    regionName: 'Italia', updatedDate: '1951-02-01', legacyDerived: false, order: 'defend', frontId: null },
];
const FRONTS = [{
  id: 'F1', name: 'ITA–AUT', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
  regionIds: ['ITA', 'AUT'], status: 'active', objectiveRegionId: 'AUT',
  attackerPressure: 0.63, defenderPressure: 0.48, momentumPolityId: 'ITA',
  createdDate: '1951-01-01', updatedDate: '1951-02-01',
}];
const RELATIONSHIPS = { ITA: { FRA: 'ally', AUT: 'hostile' } };

/** Operating Picture minimale: il reparto ITA ha oggetto operativo e azioni. */
const ARSENAL = {
  ...MOCK_ARSENAL,
  objects: {
    counts: { army: 1, unit: 1 },
    conventions: ['Le azioni dei reparti arrivano dal motore.'],
    chains: [],
    objects: [{
      id: 'ita-1', kind: 'unit', label: 'ITA 1° Reparto', subtitle: 'army-ita · Italia',
      status: 'operational', statusLabel: 'Operativa', parentId: 'army-ita', regionId: 'ITA', regionName: 'Italia',
      facts: [], problems: [], why: 'Azioni pubblicate dal motore.',
      actions: [{ id: 'reinforce_unit', label: 'Rinforza', enabled: true, blockedReason: null }],
    }],
  },
};

const AGENDA = { powers: [
  { polityId: 'AUT', name: 'Austria', objectives: [{
    id: 'aut-balcani', description: 'Rafforzare l’influenza nei Balcani', type: 'influence',
    priority: 2, progress: 35, since: '1950-06-01', reviewDate: '1951-06-01', reason: 'Sicurezza dei confini',
  }] },
  { polityId: 'FRA', name: 'Francia', objectives: [{
    id: 'fra-mare', description: 'Obiettivo francese', type: 'naval', priority: 1, progress: 10,
    since: '1950-01-01', reviewDate: '1951-01-01', reason: '',
  }] },
]};

const COMMITMENTS = { commitments: [
  { id: 'aut-ita-treaty', type: 'treaty', actor: 'AUT', counterparty: 'ITA', description: 'Patto alpino',
    createdDate: '1951-01-01', createdTurn: 1, status: 'active', deadline: '1951-06-01', sourceEventId: null,
    importance: 3, updatedDate: '1951-02-01', updatedTurn: 2, note: 'Ratificato.' },
  { id: 'aut-hun-loan', type: 'loan', actor: 'AUT', counterparty: 'HUN', description: 'Prestito danubiano',
    createdDate: '1950-01-01', createdTurn: 1, status: 'fulfilled', deadline: null, sourceEventId: null,
    importance: 1, updatedDate: '1951-01-15', updatedTurn: 1, note: '' },
  { id: 'fra-ita-culture', type: 'cultural', actor: 'FRA', counterparty: 'ITA', description: 'Accordo culturale franco',
    createdDate: '1950-01-01', createdTurn: 1, status: 'active', deadline: null, sourceEventId: null,
    importance: 2, updatedDate: '1950-12-01', updatedTurn: 1, note: '' },
]};

/** Una riserva con `regionId` canonico e una senza: solo la prima è un sito. */
const NATURAL = [
  { kind: 'oil', label: 'Giacimento di Milano', renewable: false, endowment: 100, reserve: 80,
    maxReserve: 100, stockpile: 20, extractionPerMonth: 2, depletionPct: 20, depleted: false, regionId: 'ITA' },
  { kind: 'coal', label: 'Riserva nazionale di carbone', renewable: false, endowment: 50, reserve: 40,
    maxReserve: 50, stockpile: 10, extractionPerMonth: 1, depletionPct: 20, depleted: false },
];

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

async function openP5Map(page, { relationships = RELATIONSHIPS, failRelationships = false } = {}) {
  installMockApi(page);
  await installStoreBridge(page);
  // Fixture P5 registrate DOPO il mock base: hanno la precedenza.
  await page.route('**/api/games/*/military/units', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ units: UNITS }) }));
  await page.route('**/api/games/*/military/fronts', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fronts: FRONTS }) }));
  await page.route('**/api/games/*/relationships', route => failRelationships
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(relationships) }));
  await page.route('**/api/games/*/arsenal', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ARSENAL),
  }));
  await page.route('**/api/games/*/national-state', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      accounts: MOCK_ACCOUNTS, history: [], resources: { natural: NATURAL },
      government: null, commitments: COMMITMENTS, strategicAgenda: AGENDA,
    }),
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
  await page.evaluate(() => window.__testMap.jumpTo({ center: [18, 45], zoom: 3.2 }));
}

const mapLayer = (page) => page.locator('.world-map');
const context = (page, id) => page.locator(`[data-map-context="region"][data-map-context-id="${id}"]`);

const CENTER = { ITA: [5, 45], FRA: [15, 45], AUT: [25, 45], SUI: [35, 45] };
/** Punti interni al territorio, lontani dai marker (reparti/opere). */
const CLICK = { ITA: [1.5, 42], FRA: [11.5, 42], AUT: [21.5, 42], SUI: [31.5, 42] };

/** Camera e punto di click sono distinti: il contatore del reparto sta al centro. */
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
  // La legenda resta richiusa: non deve coprire il territorio da cliccare.
  if (await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

const camera = (page) => page.evaluate(() => {
  const center = window.__testMap.getCenter();
  return { lng: Number(center.lng.toFixed(4)), lat: Number(center.lat.toFixed(4)) };
});
const featureState = (page, id) => page.evaluate(regionId =>
  window.__testMap.getFeatureState({ source: 'regions', id: regionId }), id);

// A — Economia: il dossier spiega il colore con il bucket canonico del layer.
test('MAP P5 / A — Economia: valore e fascia coerenti con il colore del layer', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Economia');
  const inspector = await clickRegion(page, 'ITA');
  const section = inspector.locator('[data-thematic-layer="economy"]');
  await expect(section).toBeVisible();
  await expect(section).toContainText('1.000');
  // Bucket dal modello P3 puro: nessun numero ricalcolato dal test.
  const expectedBucket = await page.evaluate(async () => {
    const mod = await import('/src/components/Map/thematicMapModel.ts');
    const { useGameStore } = await window.__wsAppModules();
    const regions = Object.values(useGameStore.getState().currentWorld.regions);
    return mod.buildEconomyMapModel(regions).byRegion.ITA.bucket + 1;
  });
  const bucketLabel = await section.locator('[data-economy-bucket]').getAttribute('data-economy-bucket');
  expect(Number(bucketLabel)).toBe(expectedBucket);
  // E il colore del dossier è lo stesso feature-state che colora la mappa.
  const state = await featureState(page, 'ITA');
  const swatch = await section.locator('.thematic-swatch').evaluate(el => getComputedStyle(el).backgroundColor);
  const hex = state.thematicColor;
  const expected = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  expect(swatch).toBe(expected);
  await expect(section).toContainText('Il colore sulla mappa è questa fascia');
  // Una regione senza PIL: nessun valore inventato.
  const swiss = await clickRegion(page, 'SUI');
  await expect(swiss.locator('[data-economy-no-data="SUI"]')).toBeVisible();
  await expect(swiss.locator('[data-economy-bucket]')).toHaveCount(0);
});

// B — Risorse: solo siti canonici; lo stock nazionale resta fuori dalla provincia.
test('MAP P5 / B — Risorse: sito canonico sì, riserva nazionale no', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Risorse');
  const italia = await clickRegion(page, 'ITA');
  await expect(italia.locator('[data-resource-sites="ITA"]')).toContainText('Giacimento di Milano');
  await expect(italia).not.toContainText('Riserva nazionale di carbone');
  // Nessun marker inventato per la riserva senza `regionId`.
  await expect(page.locator('.maplibregl-marker', { hasText: 'Riserva nazionale di carbone' })).toHaveCount(0);
  const francia = await clickRegion(page, 'FRA');
  await expect(francia.locator('[data-resources-none="FRA"]')).toBeVisible();
  await expect(francia).toContainText('Le riserve nazionali non vengono distribuite arbitrariamente sulla mappa.');
});

// C — Infrastrutture: opere e cantieri canonici; un reparto non è un'opera.
test('MAP P5 / C — Infrastrutture: fabbrica, cantiere e radar nel dossier', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Infrastrutture');
  const inspector = await clickRegion(page, 'ITA');
  const section = inspector.locator('[data-thematic-layer="infrastructure"]');
  await expect(section.locator('[data-infrastructure-item="milano"]')).toContainText('Fabbrica di Milano');
  await expect(section.locator('[data-infrastructure-item="cantiere-1"]')).toHaveAttribute('data-infrastructure-kind', 'construction');
  await expect(section.locator('[data-infrastructure-item="radar-sud"]')).toBeVisible();
  await expect(section).toContainText('Installazioni strategiche');
  // Il reparto non entra mai fra le opere.
  await expect(section.locator('[data-infrastructure-item="armata"]')).toHaveCount(0);
  await expect(section).toContainText('un reparto non è un');
});

// D — Diplomazia: il colore viene spiegato a parole.
test('MAP P5 / D — Diplomazia: rapporto canonico dichiarato nel dossier', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Diplomazia');
  const austria = await clickRegion(page, 'AUT');
  await expect(austria.locator('[data-diplomacy-status="hostile"]')).toContainText('Ostile');
  const francia = await clickRegion(page, 'FRA');
  await expect(francia.locator('[data-diplomacy-status="ally"]')).toContainText('Alleato');
  const italia = await clickRegion(page, 'ITA');
  await expect(italia.locator('[data-diplomacy-status="player"]')).toContainText('Il tuo Stato');
});

// E — Strategic Agenda: contesto della potenza, mai fatto provinciale.
test('MAP P5 / E — Agenda strategica: obiettivi della polity, etichettati come tali', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Diplomazia');
  const austria = await clickRegion(page, 'AUT');
  const agenda = austria.locator('[data-polity-agenda="AUT"]');
  await expect(agenda).toContainText('Rafforzare l’influenza nei Balcani');
  await expect(agenda.locator('[data-agenda-objective="aut-balcani"]')).toContainText('Sicurezza dei confini');
  await expect(austria).toContainText('CONTESTO DELLA POTENZA');
  await expect(austria).toContainText('non descrivono questa provincia');
  // Nessun obiettivo francese nel territorio austriaco.
  await expect(austria.locator('[data-polity-agenda="FRA"]')).toHaveCount(0);
  await expect(austria).not.toContainText('Obiettivo francese');
  const francia = await clickRegion(page, 'FRA');
  await expect(francia.locator('[data-polity-agenda="FRA"]')).toContainText('Obiettivo francese');
});

// F — Commitments: solo gli impegni che coinvolgono quella polity.
test('MAP P5 / F — Impegni: attivi e storico della sola polity selezionata', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Diplomazia');
  const austria = await clickRegion(page, 'AUT');
  await expect(austria.locator('[data-commitment="aut-ita-treaty"]')).toContainText('Patto alpino');
  await expect(austria.locator('[data-commitment-history="aut-hun-loan"]')).toContainText('Prestito danubiano');
  await expect(austria).toContainText('Impegni attivi');
  await expect(austria).toContainText('Storico recente');
  await expect(austria).not.toContainText('Accordo culturale franco');
  await expect(austria.locator('[data-commitment="fra-ita-culture"]')).toHaveCount(0);
});

// G — Unknown diplomacy: mai neutral di default.
test('MAP P5 / G — Diplomazia sconosciuta: fail closed, non diventa neutrale', async ({ page }) => {
  await openP5Map(page, { failRelationships: true });
  await selectLayer(page, 'Diplomazia');
  const austria = await clickRegion(page, 'AUT');
  await expect(austria.locator('[data-diplomacy-status="unknown"]')).toContainText('Sconosciuto');
  await expect(austria.locator('[data-diplomacy-status="unknown"]')).not.toContainText('Neutrale');
});

// H — Cambio layer: stessa selezione, stessa camera, contenuto diverso.
test('MAP P5 / H — Cambio layer: selezione e camera ferme, dossier aggiornato', async ({ page }) => {
  await openP5Map(page);
  const inspector = await clickRegion(page, 'ITA');
  const before = await camera(page);
  for (const label of ['Economia', 'Infrastrutture', 'Diplomazia', 'Politica']) {
    await selectLayer(page, label);
    await expect(context(page, 'ITA')).toBeVisible();
    await expect(inspector.locator('[data-thematic-region="ITA"]')).toHaveAttribute('data-thematic-layer', LAYER_IDS[label]);
  }
  expect(await camera(page)).toEqual(before);
  const selected = await page.evaluate(async () => {
    const { useGameStore } = await window.__wsAppModules();
    return useGameStore.getState().selectedRegion;
  });
  expect(selected).toBe('ITA');
  // Layer militare: la sezione tematica P5 sparisce, l'esperienza P4 resta.
  await selectLayer(page, 'Militare');
  await expect(inspector.locator('[data-thematic-layer]')).toHaveCount(0);
  await expect(inspector.getByRole('heading', { name: 'Reparti presenti' })).toBeVisible();
});

// I — Cambio territorio: il layer resta quello scelto.
test('MAP P5 / I — Cambio territorio: il layer attivo non cambia', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Infrastrutture');
  await clickRegion(page, 'ITA');
  await clickRegion(page, 'AUT');
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', 'infrastructure');
  await expect(context(page, 'AUT').locator('[data-thematic-layer="infrastructure"]')).toBeVisible();
  await clickRegion(page, 'FRA');
  await expect(mapLayer(page)).toHaveAttribute('data-map-layer', 'infrastructure');
});

// J — Regressione militare: il contesto P4 resta intatto.
test('MAP P5 / J — Militare: contesto reparto e fronte invariati (P4)', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Militare');
  await page.locator('[data-unit-id="ita-1"]').click();
  const unit = page.locator('[data-map-context="unit"][data-map-context-id="ita-1"]');
  await expect(unit).toBeVisible();
  await expect(unit.locator('[data-unit-action-panel="ita-1"]')).toBeVisible();
  await unit.getByRole('button', { name: 'Rinforza', exact: true }).click();
  await expect(unit.getByRole('button', { name: 'Anteprima', exact: true })).toBeVisible();
  await page.locator('[data-front-id="F1"]').click();
  const front = page.locator('[data-map-context="front"][data-map-context-id="F1"]');
  await expect(front).toBeVisible();
  await expect(front).toContainText('ITA–AUT');
  await expect(front).toContainText('Attaccante');
});

// K — Changes: nessuna causa inventata (il caso «cambiata» è coperto dai test unitari).
test('MAP P5 / K — Modifiche: stato dichiarato senza inventare la causa', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Modifiche');
  const inspector = await clickRegion(page, 'ITA');
  const state = inspector.locator('[data-changes-state]');
  await expect(state).toHaveAttribute('data-changes-state', 'unchanged');
  await expect(state).toContainText('Nessun cambiamento recente registrato per questo territorio.');
  await expect(inspector).not.toContainText('economia migliorata');
  await expect(inspector).not.toContainText('rivolta');
  await expect(inspector).not.toContainText('battaglia');
});

// L — Nessuna geografia inventata: processi senza `regionId` non producono fatti.
test('MAP P5 / L — nessuna geografia inventata da processi senza regionId', async ({ page }) => {
  await openP5Map(page);
  await selectLayer(page, 'Infrastrutture');
  const inspector = await clickRegion(page, 'AUT');
  // Il mock pubblica processi nazionali: nessuno diventa un'opera provinciale.
  await expect(inspector.locator('[data-thematic-layer="infrastructure"]')).toContainText('Nessuna opera territoriale pubblicata');
  const body = await inspector.innerText();
  expect(body).not.toContain('Ferrovia del Sud');
});

// M — Mobile 360: dossier leggibile, nessun overflow orizzontale.
test('MAP P5 / M — 360×740: blocco tematico leggibile e nessun overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openP5Map(page);
  await selectLayer(page, 'Infrastrutture');
  const inspector = await clickRegion(page, 'ITA');
  await expect(inspector.locator('[data-thematic-layer="infrastructure"]')).toBeVisible();
  await expect(inspector).toContainText('Fabbrica di Milano');
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // Il blocco tematico è raggiungibile scrollando il dossier.
  await inspector.locator('[data-thematic-layer="infrastructure"]').scrollIntoViewIfNeeded();
  await expect(inspector.locator('[data-thematic-layer="infrastructure"]')).toBeInViewport();
});
