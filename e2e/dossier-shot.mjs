/**
 * Screenshot + misure del Dossier (Situazione, Governo, Cassa) — mock offline.
 * Uso: node dossier-shot.mjs [prefisso]
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/ws';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));

installMockApi(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
await page.waitForSelector('.game-shell', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('.rail-btn[aria-label="Nazione"]').click({ force: true });
await page.waitForTimeout(1000);

for (const tab of ['Situazione', 'Governo', 'Cassa']) {
  await page.locator('.nation-dock-tab', { hasText: tab }).first().click();
  await page.waitForTimeout(tab === 'Governo' ? 1200 : 400);
  const info = await page.evaluate(() => ({
    overflow: (document.querySelector('.nation-dock')?.scrollWidth || 0) - (document.querySelector('.nation-dock')?.clientWidth || 0),
    factions: document.querySelectorAll('.nation-faction-card').length,
    voices: document.querySelectorAll('.nation-faction-voice').length,
    budgetRows: document.querySelectorAll('.nation-budget-row').length,
  }));
  console.log(tab, JSON.stringify(info));
  await page.screenshot({ path: `${prefix}-${tab.toLowerCase()}.png` });
  console.log('saved:', `${prefix}-${tab.toLowerCase()}.png`);
}
await browser.close();
