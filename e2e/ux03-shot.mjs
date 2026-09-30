/**
 * WS-MINISTER-UX-03 — Screenshot della tavola guidata dalla conversazione.
 * Uso: node ux03-shot.mjs <prefisso-out> [larghezza] [altezza]
 *
 * Cattura il cambio della tavola su richiesta del Presidente: «Mi mostri dove va
 * la spesa?» porta in cima il grafico del bilancio; «Confronta le due strade»
 * mostra il confronto tra le proposte. Mock offline, nessun LLM reale.
 *
 * Variabile d'ambiente: `GOVOFFICE_BASE_URL` (default http://localhost:5173).
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/ux03';
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

async function ask(question) {
  const textarea = chat.locator('textarea');
  await textarea.scrollIntoViewIfNeeded();
  await textarea.fill(question);
  await chat.locator('.minister-compose button').click();
  await page.waitForTimeout(2200);
}

await ask('Mi mostri dove va la spesa?');
await table.locator('.seat-presentation-banner').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}-1-focus-spesa.png` });

await ask('Confronta le due strade');
await table.locator('.proposal-comparison').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${prefix}-2-confronto.png` });

await browser.close();
console.log(`[ok] screenshot in ${prefix}-*.png`);
