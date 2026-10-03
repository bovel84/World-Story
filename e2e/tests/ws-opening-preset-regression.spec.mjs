/**
 * WS-OPENING-PRESET-REGRESSION — Test C: nessuna finestra «preset vuoto»
 * ======================================================================
 * Con `opening-narrative` trattenuta, il dossier iniziale deve già mostrare la
 * premessa canonica del mondo (`world.basePrompt` dal contratto `GET /games/:id`),
 * non uno stato vuoto. Al rilascio la narrativa arricchita sostituisce il
 * fallback senza perdere il mondo.
 *
 * Offline: mock API, nessun backend né provider LLM.
 */
import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockApi, MOCK_GAME, MOCK_GAME_ID } from '../mock-api.mjs';

const PREMISE = 'BASE_PROMPT_MARKER: il paese si rialza dalle macerie e cerca un posto nel nuovo ordine mondiale.';
const RULES = 'SIMULATION_RULES_MARKER: le crisi impiegano mesi.';
const ENRICHED = 'NARRATIVE_ENRICHED_MARKER: il nuovo ordine è instabile e nessuno sa cosa accadrà.';
const shotDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/implementation/screenshots/ws-opening-preset-regression');

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.locator('.game-shell').waitFor({ state: 'visible', timeout: 20_000 });
}

test('la premessa del preset è visibile durante il ritardo e l’arricchita la sostituisce senza vuoto', async ({ page }) => {
  page.setDefaultTimeout(15_000);
  fs.mkdirSync(shotDir, { recursive: true });
  await installMockApi(page, { showOpening: true });

  // Il contratto corretto: GET /games/:id porta il record canonico in camelCase.
  await page.route(`**/games/${MOCK_GAME_ID}`, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_GAME, world: { ...MOCK_GAME.world, basePrompt: PREMISE, simulationRules: RULES } }),
    });
  });

  // Trattieni `opening-narrative`: la finestra incoerente è esattamente qui.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let narrativeCalls = 0;
  await page.route(`**/games/${MOCK_GAME_ID}/opening-narrative`, async route => {
    narrativeCalls += 1;
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated: false,
        deterministic: true,
        world: { name: MOCK_GAME.world.name, date: '1951-01-01', narrative: { headline: '1951', worldOrder: ENRICHED, stakesForNation: 'STAKES_MARKER' } },
        nation: { framing: 'Il paese eredita una situazione da consolidare.' },
        council: [],
      }),
    });
  });

  await reachHud(page);

  const overlay = page.locator('.opening-overlay');
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.opening-section')).toHaveText('IL MONDO');

  // Durante il ritardo: la premessa canonica c'è, lo stato vuoto no.
  await expect(page.locator('.opening-page').first()).toContainText('BASE_PROMPT_MARKER');
  await expect(page.locator('.opening-page').first()).not.toContainText('Il mondo non ha ancora una descrizione');
  expect(narrativeCalls).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: path.join(shotDir, 'during-delay.png') });

  // Rilascia la narrativa arricchita: sostituisce il fallback, senza vuoto.
  release();
  await expect(page.locator('.opening-page').first()).toContainText('NARRATIVE_ENRICHED_MARKER');
  await expect(page.locator('.opening-page').first()).not.toContainText('Il mondo non ha ancora una descrizione');
  await expect(page.locator('.opening-world-name')).toHaveText(MOCK_GAME.world.name);
  await page.screenshot({ path: path.join(shotDir, 'after-release.png') });
});
