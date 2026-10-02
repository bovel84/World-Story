/**
 * WS-GOV-MOBILE-CLEANUP (M29) — Screenshot reali del Governo (mock offline).
 * =========================================================================
 * Uso: node wsgovmobilecleanup-shot.mjs [cartella-out]
 * Richiede il dev server Vite su http://localhost:5173.
 *
 * Produce i reperti richiesti:
 *   390x844-dialogue-long, 390x844-unread, 390x844-board-blocked,
 *   390x844-council-ready, 390x844-act,
 *   844x390-dialogue, 844x390-board, 1366x768-desktop.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installMockApi } from './mock-api.mjs';

const outDir = process.argv[2] || 'docs/implementation/screenshots/ws-gov-mobile-cleanup';
mkdirSync(outDir, { recursive: true });
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ headless: true, executablePath });

async function reachOffice(page, width, height) {
  await page.setViewportSize({ width, height });
  page.on('dialog', d => d.accept());
  installMockApi(page);
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.waitForSelector('.game-shell', { timeout: 60_000 });
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
  await page.waitForSelector('.gov-mobile', { timeout: 15_000 });
  await page.waitForTimeout(600);
}

const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`[shot] ${name}`);
};

async function send(page, text) {
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await chat.locator('.minister-compose button').waitFor({ state: 'visible' });
  await page.waitForTimeout(1800);
}

// ── 390×844: dialogo lungo, badge, Tavola, riunione, atto ──────────────────
{
  const page = await browser.newPage();
  await reachOffice(page, 390, 844);
  for (let i = 0; i < 10; i += 1) await send(page, `Aggiornamento ${i}: come procediamo, signor ministro?`);
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await shot(page, '390x844-dialogue-long');

  // Badge «↓ Nuovo messaggio» mentre si legge indietro.
  await send(page, 'Voglio costruire una fabbrica siderurgica.');
  await send(page, 'Costruiamola a Sarajevo.');
  await page.evaluate(() => {
    const thread = document.querySelector('.gov-mobile #gov-panel-dialogue .minister-thread');
    if (thread) thread.scrollTop = 0;
  });
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  const convene = page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ });
  if (await convene.count()) {
    await convene.click();
    await page.waitForSelector('.gov-mobile-minister', { timeout: 15_000 }).catch(() => {});
  }
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await page.waitForTimeout(600);
  await shot(page, '390x844-unread');

  // La Tavola della riunione (risultato per ministero, non transcript).
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.waitForSelector('.gov-mobile-minister', { timeout: 15_000 }).catch(() => {});
  await shot(page, '390x844-council-ready');

  // L'atto.
  const prepare = page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Prepara l’atto/ });
  if (await prepare.count()) {
    await prepare.first().click();
    await page.waitForTimeout(1500);
    await shot(page, '390x844-act');
  }
  await page.close();
}

// ── 390×844: il blocco di localizzazione (prima della riunione) ────────────
{
  const page = await browser.newPage();
  await reachOffice(page, 390, 844);
  await send(page, 'Voglio costruire una fabbrica siderurgica.');
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.waitForSelector('.gov-mobile-alert', { timeout: 15_000 }).catch(() => {});
  await shot(page, '390x844-board-blocked');
  await page.close();
}

// ── 844×390: telefono in orizzontale (compatto) ────────────────────────────
{
  const page = await browser.newPage();
  await reachOffice(page, 844, 390);
  await send(page, 'Voglio costruire una fabbrica siderurgica.');
  await send(page, 'Costruiamola a Sarajevo.');
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await shot(page, '844x390-dialogue');
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await shot(page, '844x390-board');
  await page.close();
}

// ── 1366×768: la scrivania resta dialogo|tavola ────────────────────────────
{
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  page.on('dialog', d => d.accept());
  installMockApi(page);
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.waitForSelector('.game-shell', { timeout: 60_000 });
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
  await page.waitForSelector('.government-office-divider', { timeout: 15_000 });
  await shot(page, '1366x768-desktop');
  await page.close();
}

await browser.close();
console.log(`[ok] screenshot in ${outDir}`);
