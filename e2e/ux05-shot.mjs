/**
 * WS-MINISTER-UX-05 — Screenshot della memoria della sedia.
 * Uso: node ux05-shot.mjs <prefisso-out> [larghezza] [altezza]
 *
 * Cattura il fascicolo della sedia aperto sui ricordi: un atto accodato e le
 * proposte discusse, con la nota che dichiara la natura di tappa intermedia.
 * Mock offline, nessun LLM reale.
 *
 * Variabile d'ambiente: `GOVOFFICE_BASE_URL` (default http://localhost:5173).
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/ux05';
const width = Number(process.argv[3]) || 1440;
const height = Number(process.argv[4]) || 900;
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page, {});
await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
try {
  await page.waitForSelector('.game-shell', { timeout: 60_000 });
} catch {
  console.log('[warn] .game-shell non visibile, proseguo comunque');
}
await page.waitForTimeout(2500);

await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.waitForTimeout(800);
await page.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
await page.locator('.minister-chat').waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForTimeout(600);

const chat = page.locator('.government-office-pane-chat');
const table = page.locator('.government-office-pane-table');
const mobile = width <= 767;

// Un atto accodato... (su mobile la tavola è un'altra linguetta: ci si passa).
if (mobile) await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
await table.locator('.treasury-act-road[data-road="invest"] .treasury-act-sign').click();
await page.waitForTimeout(500);
if (mobile) await page.locator('.minister-session-view', { hasText: 'Dialogo' }).click();
// ...e una proposta discussa: due ricordi di specie diversa.
const textarea = chat.locator('textarea');
await textarea.scrollIntoViewIfNeeded();
await textarea.fill('Confronta le due strade');
await chat.locator('.minister-compose button').click();
await page.waitForTimeout(2400);

await page.locator('.seat-brief-summary').click();
await page.locator('.seat-brief-memory').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}-memoria.png` });

await browser.close();
console.log(`[ok] screenshot in ${prefix}-memoria.png`);
