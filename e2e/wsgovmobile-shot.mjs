/**
 * WS-GOV-MOBILE-FOCUS — Screenshot reali del Governo su telefono (mock offline).
 * ===========================================================================
 * Uso: node wsgovmobile-shot.mjs [cartella-out]
 * Produce i sette stati richiesti dalla PARTE I a 390×844:
 *  01-ministers, 02-dialogue, 03-board-unresolved, 04-council-ready,
 *  05-evidence-map, 06-act, 07-signed.
 * Richiede il dev server Vite su http://localhost:5173.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installMockApi } from './mock-api.mjs';

const outDir = process.argv[2] || 'docs/implementation/screenshots/ws-gov-mobile-focus';
mkdirSync(outDir, { recursive: true });
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('dialog', d => d.accept());
page.on('pageerror', e => console.log(`[pageerror] ${String(e).slice(0, 200)}`));
installMockApi(page);

await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
await page.waitForSelector('.game-shell', { timeout: 60000 });
await page.waitForTimeout(2000);

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`[shot] ${name}`);
};

// 01 — i ministri (scelta).
await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.waitForTimeout(1000);
await shot('01-ministers');

// 02 — il dialogo della seduta.
await page.locator('.government-office').locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
await page.waitForSelector('.gov-mobile', { timeout: 10000 });
await page.waitForTimeout(600);
await shot('02-dialogue');

const sendMessage = async (text) => {
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await page.waitForTimeout(300);
  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await page.waitForTimeout(2500);
};

// 03 — la Tavola con il blocco «Dove deve sorgere l'opera?».
await sendMessage('Voglio costruire una fabbrica siderurgica.');
await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
await page.waitForTimeout(800);
await shot('03-board-unresolved');

// 04 — la riunione convocata e pronta.
await sendMessage('Costruiamola a Sarajevo.');
await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
const convene = page.locator('.gov-mobile-primary', { hasText: /Convoca la riunione/ });
if (await convene.count()) {
  await convene.first().click();
  await page.waitForTimeout(3000);
}
await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
await page.waitForSelector('.gov-mobile-talk', { timeout: 15000 }).catch(() => {});
await shot('04-council-ready');

// 05 — l'evidenza (la mappa) in primo piano.
await sendMessage('Mostrami la mappa delle province.');
await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
await page.waitForTimeout(400);
const card = page.locator('.minister-evidence-card').first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(800);
  await shot('05-evidence-map');
} else {
  console.log('[warn] nessuna card evidenza: 05 saltata');
}

// 06 — la vista Atto.
await page.locator('.gov-mobile-nav').first().click();
await page.waitForTimeout(500);
await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
await page.waitForTimeout(800);
const prepare = page.locator('.gov-mobile-primary', { hasText: /Prepara l’atto/ });
if (await prepare.count()) {
  await prepare.first().click();
  await page.waitForTimeout(1200);
  await shot('06-act');

  // 07 — la firma.
  const sign = page.locator('.act-draft-sign');
  if (await sign.count()) {
    await sign.click();
    await page.waitForTimeout(2000);
    await shot('07-signed');
  }
} else {
  console.log('[warn] CTA «Prepara l’atto» assente: 06/07 saltate');
}

await browser.close();
console.log(`[ok] screenshot in ${outDir}`);