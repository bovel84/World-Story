/**
 * WS-GAME-OPENING — Screenshot reali dell'apertura e del fix di scroll (mock offline).
 * ====================================================================================
 * Uso: node wsgameopening-shot.mjs [cartella-out]
 * Richiede il dev server Vite su http://localhost:5173.
 *
 * Produce:
 *   desktop-1-mondo ... desktop-5-padre       (1366×768)
 *   mobile-1-mondo  ... mobile-5-padre        (390×844)
 *   scroll-before-390x844 / scroll-after-390x844
 *   scroll-before-1366x768 / scroll-after-1366x768
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installMockApi, MOCK_CABINET_MULTI } from './mock-api.mjs';

const outDir = process.argv[2] || 'docs/implementation/screenshots/ws-game-opening';
mkdirSync(outDir, { recursive: true });
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({ headless: true, executablePath });

async function reachOpening(page, width, height) {
  await page.setViewportSize({ width, height });
  page.on('dialog', d => d.accept());
  installMockApi(page, { showOpening: true });
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.locator('.opening-overlay').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(500);
}

const shot = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`[shot] ${name}`);
};

const PAGE_NAMES = ['mondo', 'paese', 'quadro', 'consiglio', 'potere'];

// ── Apertura: 5 pagine, desktop e mobile ───────────────────────────────────
for (const vp of [{ width: 1366, height: 768, tag: 'desktop' }, { width: 390, height: 844, tag: 'mobile' }]) {
  const page = await browser.newPage();
  await reachOpening(page, vp.width, vp.height);
  for (let i = 0; i < PAGE_NAMES.length; i += 1) {
    await shot(page, `${vp.tag}-${i + 1}-${PAGE_NAMES[i]}`);
    if (i < PAGE_NAMES.length - 1) await page.locator('.opening-next').click();
  }
  await page.close();
}

// ── Scroll Governo: prima (difetto riprodotto) / dopo (fondo raggiunto) ────
for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  const page = await browser.newPage();
  await page.setViewportSize(vp);
  installMockApi(page, { cabinet: MOCK_CABINET_MULTI });
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.waitForSelector('.game-shell', { timeout: 60_000 });
  // Difesa: se per qualunque motivo l'apertura è in vista, chiudila prima di
  // aprire il Governo (il test di scroll non la riguarda).
  if (await page.locator('.opening-overlay').count()) {
    await page.locator('.opening-skip').click();
    await page.locator('.opening-overlay').waitFor({ state: 'detached' });
  }
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').waitFor({ state: 'visible', timeout: 15_000 });

  // PRIMA: riproduce il vecchio `overflow: hidden` sul modale mobile, con lo
  // scroll in cima. È esattamente lo stato del bug.
  await page.addStyleTag({ content: '.government-office { overflow: hidden !important; }' });
  await page.locator('.government-office').evaluate(el => { el.scrollTop = 0; });
  await shot(page, `scroll-before-${vp.width}x${vp.height}`);

  // DOPO: rimosso il vincolo, si scorre fino all'ultimo ministro.
  await page.evaluate(() => { document.querySelectorAll('style').forEach(s => { if (s.textContent?.includes('overflow: hidden !important')) s.remove(); }); });
  await page.locator('.government-office').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  await shot(page, `scroll-after-${vp.width}x${vp.height}`);
  await page.close();
}

await browser.close();
console.log(`[done] ${outDir}`);
