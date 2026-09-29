/**
 * WS-GOVOFFICE-03 — Screenshot dell'Ufficio del Governo, mock offline.
 * Uso: node govoffice-shot.mjs <prefisso-out>
 *
 * Fotografa le due schermate nuove: il Registro degli atti (prima schermata) e
 * la seduta a due pannelli; poi registra un atto dal dialogo e rifotografa il
 * registro firmato.
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/govoffice';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
try {
  await page.waitForSelector('.game-shell', { timeout: 60000 });
} catch {
  console.log('[warn] .game-shell non visibile, proseguo comunque');
}
await page.waitForTimeout(2500);

await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${prefix}-1-registro-vuoto.png` });

// Seduta a due pannelli.
await page.locator('.cabinet-pick').first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${prefix}-2-seduta-due-pannelli.png` });

// L'ordine nasce dal dialogo.
const chat = page.locator('.government-office-pane-chat');
await chat.locator('textarea').fill('Aprire un cantiere navale nel porto di Alfa.');
await chat.locator('.minister-compose button').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-3-dialogo.png` });
await chat.locator('.minister-draft-order').click();
await page.waitForTimeout(1200);

await page.locator('.government-office-back').click();
await page.waitForTimeout(800);
// Scorrimento in cima: la foto deve mostrare la testata, non la coda.
await page.locator('.government-office').evaluate(el => { el.scrollTop = 0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${prefix}-4-registro-firmato.png` });

await browser.close();
console.log(`[ok] screenshot in ${prefix}-*.png`);
