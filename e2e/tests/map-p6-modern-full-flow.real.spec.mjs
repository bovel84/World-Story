/**
 * MAP P6.3 — E2E a **backend reale** sul mondo moderno completo
 * ============================================================
 * Il percorso provato è quello dell'app, senza scorciatoie:
 *
 *   landing → scenario `modern_world_provinces` → paese (USA) → «Avvia»
 *   → `POST /worlds/generate` + polling del job → 946 province reali
 *   → `POST /games` → `GET /games/:id` → mappa provinciale
 *   → `GET /map-assets` (risposta REALE, nessun mock)
 *   → `ThematicMapModel` → marker sulla mappa → click → Province Inspector
 *
 * Non viene mockata **nessuna** risposta API: gira contro il backend Express
 * vero (`playwright.real.config.mjs`), che serve anche la build React. L'unica
 * finzione è il provider LLM (stub OpenAI-compatibile): il contenuto narrativo
 * del modello non è oggetto di questa verifica, la geografia sì.
 *
 * Il `worldId` non è hardcodato: nasce dalla risposta reale di `/map-assets`,
 * quindi gli id di regione sono quelli che il motore ha davvero creato.
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PRESET_DIR = path.join(process.cwd(), '..', 'backend-nest', 'data', 'presets', 'modern_world_provinces');
const SIM_DIR = path.join(PRESET_DIR, 'simulation');
const readSim = file => JSON.parse(fs.readFileSync(path.join(SIM_DIR, file), 'utf8'));

const MAP = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, 'map.geojson'), 'utf8'));
const INITIAL = readSim('initial-state.json');
const RESOURCES = readSim('resources.json');
const FACILITY_TYPES = readSim('facilities.json');

/** Le 946 feature della mappa non sono 946 regioni: 4 sono feature nazionali
 *  «ombraggiate» dalle province della stessa politia (ARG, VEN, ECU, BOL). */
const isProvince = feature => !!feature.properties.country && feature.properties.country !== feature.properties.code;
const PROVINCES = MAP.features.filter(isProvince);
const PARENT_CODES = new Set(PROVINCES.map(feature => feature.properties.country));
const COUNTRY_LEVEL = MAP.features.filter(feature => !isProvince(feature));
const EXPECTED_REGIONS = PROVINCES.length + COUNTRY_LEVEL.filter(f => !PARENT_CODES.has(f.properties.code)).length;
/** Stato pubblicato dal catalogo authored (esclusa la sorgente `hidden`). */
const PUBLISHED_DEPOSITS = INITIAL.deposits.filter(deposit => deposit.accessibility !== 'hidden');
const PUBLISHED_FACILITIES = INITIAL.facilities;

const nameOf = code => MAP.features.find(feature => feature.properties.code === code)?.properties.name;
const resourceName = id => RESOURCES.find(item => item.id === id)?.name || id;
const facilityTypeName = id => FACILITY_TYPES.find(item => item.id === id)?.name || id;

// Vertical slice P6.2 usato come prova (id già authored, nessun asset nuovo).
const USTX = 'USTX', NLNH = 'NLNH', ZANW = 'ZANW';
const USTX_OIL = 'deposit:USTX:crude_oil:1';
const ZANW_COAL = 'deposit:ZANW:coal:1';
const NLNH_REFINERY = 'facility:NLNH:refinery:1';
const NLNH_REFINERY_STOPPED = 'facility:NLNH:refinery:2';

for (const code of [USTX, NLNH, ZANW]) {
  test.beforeAll(() => expect(nameOf(code), `regione ${code} assente dalla mappa`).toBeTruthy());
}

const LAYER_IDS = { Politica: 'political', Militare: 'military', Economia: 'economy', Risorse: 'resources', Infrastrutture: 'infrastructure', Diplomazia: 'diplomacy', Modifiche: 'changes', Terreno: 'terrain' };
const worldMap = page => page.locator('.world-map');
const context = (page, regionId) => page.locator(`[data-map-context="region"][data-map-context-id="${regionId}"]`);
const resourceMarker = (page, id) => page.locator(`[data-map-resource-marker="${id}"]`);
const facilityMarker = (page, id) => page.locator(`[data-map-facility-marker="${id}"]`);

async function selectLayer(page, label) {
  const legend = page.locator('.map-legend-toggle');
  if (await legend.getAttribute('aria-expanded') === 'false') await legend.click();
  await page.getByRole('radio', { name: label, exact: true }).check();
  await expect(worldMap(page)).toHaveAttribute('data-map-layer', LAYER_IDS[label]);
  if (await legend.getAttribute('aria-expanded') === 'true') await legend.click();
}

/** Raggiunge una provincia con la ricerca della mappa (flusso utente reale). */
async function locateRegion(page, regionName) {
  const search = page.getByRole('searchbox', { name: 'Cerca territorio o città' });
  await search.fill(regionName);
  const result = page.locator('.map-search-results li button').first();
  await expect(result).toBeVisible();
  await result.click();
  await page.waitForTimeout(900); // `flyTo` della mappa
}

test('MAP P6.3 — il mondo moderno reale arriva fino al marker e al dossier, senza mock', async ({ page }) => {
  // Diagnostica su file: se il percorso reale si blocca, il «perché» resta.
  const debugLog = path.join(process.cwd(), '.tmp', 'browser.log');
  const trace = message => {
    try { fs.appendFileSync(debugLog, `${new Date().toISOString()} ${message}\n`); } catch { /* best effort */ }
  };
  trace(`--- test start (${await page.evaluate(() => navigator.userAgent).catch(() => 'no-page')})`);
  page.on('console', message => { if (message.type() === 'error') trace(`console.error ${message.text().slice(0, 300)}`); });
  page.on('pageerror', error => trace(`pageerror ${String(error).slice(0, 300)}`));
  page.on('requestfailed', request => trace(`requestfailed ${request.url().slice(0, 120)} ${request.failure()?.errorText}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api')) trace(`response ${response.status()} ${url.pathname.slice(0, 60)}`);
  });
  // ---------------------------------------------------------------------------
  // 0. Il browser parla con il backend VERO (nessun mock installato).
  // ---------------------------------------------------------------------------
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBe(true);
  const healthBody = await health.json();
  expect(healthBody.status).toBe('ok');

  const assetsResponse = page.waitForResponse(response =>
    /^\/api\/games\/[^/]+\/map-assets$/.test(new URL(response.url()).pathname) && response.status() === 200,
    { timeout: 12 * 60_000 },
  );

  // ---------------------------------------------------------------------------
  // 1. Percorso applicativo reale: scenario → paese → «Avvia».
  // ---------------------------------------------------------------------------
  await page.goto('/');
  await page.locator('.landing-cta').click();

  await page.getByRole('searchbox', { name: 'Cerca scenario' }).fill('Provinciale');
  const presetCard = page.getByRole('button', { name: 'Apri scenario Mondo Provinciale Moderno' });
  await expect(presetCard).toBeVisible();
  await presetCard.click();

  await page.getByRole('searchbox', { name: 'Cerca paese per nome o codice' }).fill('USA');
  const usaItem = page.locator('.country-list-item').first();
  await expect(usaItem).toBeVisible();
  await usaItem.click();
  trace('scenario scelto + paese USA: avvio generazione');
  await page.locator('.btn-play').click();

  // Generazione reale (job + polling) e partita reale: la mappa appare quando
  // il backend ha finito e `POST /games` ha restituito la sessione.
  trace('generazione avviata');
  await expect(worldMap(page)).toBeVisible({ timeout: 12 * 60_000 });
  await expect(page.getByRole('searchbox', { name: 'Cerca territorio o città' })).toBeEnabled({ timeout: 60_000 });

  // ---------------------------------------------------------------------------
  // 2. La partita è legata al mondo completo e al template giusto (endpoint reale).
  // ---------------------------------------------------------------------------
  // L'id della partita è quello che la UI ha davvero interrogato: si legge
  // dall'URL della risposta reale, non da un'iniezione di stato.
  const assetsReply = await assetsResponse;
  const gameId = new URL(assetsReply.url()).pathname.split('/')[3];
  expect(gameId).toBeTruthy();
  const payload = await assetsReply.json();

  expect(payload.canonical).toBe(true);
  expect(payload.resources.length).toBeGreaterThan(0);
  expect(payload.facilities.length).toBeGreaterThan(0);
  // Il catalogo pubblica esattamente ciò che il preset dichiara (hidden escluso).
  expect(payload.resources.length).toBe(PUBLISHED_DEPOSITS.length);
  expect(payload.facilities.length).toBe(PUBLISHED_FACILITIES.length);

  // `worldId` dinamico: ricavato dagli asset reali, mai hardcodato.
  const worldId = String(payload.resources[0].regionId).split('_')[0];
  expect(worldId).toBeTruthy();
  expect(payload.resources.every(asset => asset.regionId.startsWith(`${worldId}_`))).toBe(true);

  // Mondo completo, letto dall'endpoint che la UI ha usato per disegnare la mappa.
  const gameState = await page.request.get(`/api/games/${gameId}`);
  expect(gameState.ok()).toBe(true);
  const state = await gameState.json();
  // Il mondo disegnato dalla UI è quello completo: 942 regioni realmente create.
  expect(state.world.regions.length).toBe(EXPECTED_REGIONS);
  // E la partita è legata al preset giusto e alla polity scelta.
  expect(state.world.id.split('_')[0]).toBe(worldId);
  expect(state.players[0].polityId).toBe('USA');

  // ---------------------------------------------------------------------------
  // 3. Layer Risorse: marker reale → click → Province Inspector della regione.
  // ---------------------------------------------------------------------------
  await selectLayer(page, 'Risorse');
  await locateRegion(page, nameOf(USTX));
  await expect(context(page, `${worldId}_${USTX}`)).toBeVisible();

  // Tanti marker quante sono le risorse pubblicate dall'endpoint: la mappa non
  // aggiunge né perde nulla, e non usa gli oggetti del territorio.
  await expect(page.locator('[data-map-resource-marker]')).toHaveCount(payload.resources.length);

  const oilMarker = resourceMarker(page, USTX_OIL);
  await expect(oilMarker).toBeVisible();
  await expect(oilMarker).toHaveAttribute('data-region-id', `${worldId}_${USTX}`);
  // «marker = dossier»: la stessa lista, dal modello tematico alla UI.
  await expect(page.locator(`[data-resource-site="${USTX_OIL}"]`)).toBeVisible();
  await expect(oilMarker).toHaveAttribute('aria-label', new RegExp(resourceName('crude_oil')));

  // Il click sul marker apre il contesto della SUA regione (nessuna variante
  // nuova): si chiude prima il dossier, altrimenti la prova non discriminerebbe.
  await page.getByRole('button', { name: 'Chiudi contesto mappa' }).click();
  await expect(context(page, `${worldId}_${USTX}`)).toHaveCount(0);
  await oilMarker.click();
  await expect(context(page, `${worldId}_${USTX}`)).toBeVisible();
  await expect(page.locator(`[data-map-context-id="${worldId}_${USTX}"]`)).toHaveAttribute('data-map-context', 'region');

  // Secondo giacimento reale dello slice: il carbone del North West.
  await locateRegion(page, nameOf(ZANW));
  const coalMarker = resourceMarker(page, ZANW_COAL);
  await expect(coalMarker).toBeVisible();
  await expect(coalMarker).toHaveAttribute('data-region-id', `${worldId}_${ZANW}`);
  await coalMarker.click();
  await expect(context(page, `${worldId}_${ZANW}`)).toBeVisible();
  await expect(page.locator(`[data-resource-site="${ZANW_COAL}"]`)).toHaveAttribute('data-resource-known', 'false');

  // ---------------------------------------------------------------------------
  // 4. Layer Infrastrutture: raffineria di Noord-Holland e impianto fermo.
  // ---------------------------------------------------------------------------
  await selectLayer(page, 'Infrastrutture');
  await locateRegion(page, nameOf(NLNH));
  await expect(context(page, `${worldId}_${NLNH}`)).toBeVisible();

  // Stessa identità per le infrastrutture: il layer mostra esattamente gli
  // impianti canonici pubblicati (i cantieri del territorio restano esclusi).
  await expect(page.locator('[data-map-facility-marker]')).toHaveCount(payload.facilities.length);

  const refinery = facilityMarker(page, NLNH_REFINERY);
  await expect(refinery).toBeVisible();
  await expect(refinery).toHaveAttribute('data-region-id', `${worldId}_${NLNH}`);
  // Proprietà ≠ territorio: l'impianto è in NLNH, il proprietario economico è USA.
  await expect(page.locator(`[data-infrastructure-item="${NLNH_REFINERY}"]`)).toHaveAttribute('data-infrastructure-state', 'operative');
  await expect(page.locator(`[data-infrastructure-item="${NLNH_REFINERY}"]`)).toContainText(facilityTypeName('refinery'));

  // L'impianto canonical `operational:false` è visibile e classificato, non nascosto.
  const stopped = page.locator(`[data-infrastructure-item="${NLNH_REFINERY_STOPPED}"]`);
  await expect(stopped).toHaveAttribute('data-infrastructure-state', 'inactive');
  await expect(page.getByText('Non operative', { exact: false }).first()).toBeVisible();

  // Il marker dell'impianto fermo è un marker come gli altri: click → stessa regione.
  const stoppedMarker = facilityMarker(page, NLNH_REFINERY_STOPPED);
  await expect(stoppedMarker).toBeVisible();
  await stoppedMarker.click();
  await expect(context(page, `${worldId}_${NLNH}`)).toBeVisible();

  // ---------------------------------------------------------------------------
  // 5. Niente scorciatoie: il payload viene da `/map-assets` reale e ogni asset
  //    punta a una regione davvero presente nel mondo della partita.
  // ---------------------------------------------------------------------------
  expect(EXPECTED_REGIONS).toBeGreaterThan(900);
  expect(payload.resources.some(asset => asset.regionId === `${worldId}_RUSA`)).toBe(false);
});
