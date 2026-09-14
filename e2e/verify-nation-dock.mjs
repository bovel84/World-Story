/**
 * Verifica leggibilità del Dossier Nazione con API mockate.
 * Stampa misure oggettive: font, griglia, dimensioni, overflow.
 * Uso: node verify-nation-dock.mjs
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 160)}`));
installMockApi(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
await page.waitForSelector('.game-shell', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('.rail-btn[aria-label="Nazione"]').click({ force: true });
await page.waitForTimeout(1400);
console.log('nation-dock present:', await page.locator('.nation-dock').count());

const TABS = ['Situazione', 'Progetti', 'Cassa', 'Risorse e industria', 'Armamenti', 'Conoscenze', 'Politiche'];

async function measure(label, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  console.log(`\n===== ${label} (${width}x${height}) =====`);

  const snapshot = async (tab) => {
    const info = await page.evaluate(() => {
      const dock = document.querySelector('.nation-dock');
      if (!dock) return null;
      const cards = [...dock.querySelectorAll('.nation-metric')];
      const first = cards[0];
      const cs = (el) => (el ? getComputedStyle(el) : null);
      return {
        blocks: [...dock.querySelectorAll('.nation-block-title')].map((b) => b.textContent),
        cards: cards.length,
        gridCols: first ? getComputedStyle(first.parentElement).gridTemplateColumns : null,
        cardHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
        labels: cards.map((c) => c.querySelector('small')?.textContent),
        values: cards.map((c) => c.querySelector('b')?.textContent),
        trends: cards.map((c) => c.querySelector('.nation-trend em')?.textContent || null),
        sparks: cards.map((c) => (c.querySelector('.nation-spark') ? 'ok' : null)),
      };
    });
    console.log(`-- ${tab}: cards=${info?.cards} cols=${info?.gridCols} h=${info?.cardHeight}`);
    console.log(`   ${(info?.labels || []).map((l, i) => `${l}=${info.values[i]}`).join(' · ')}`);
    const trends = (info?.trends || []).filter(Boolean);
    if (trends.length) console.log(`   tendenze (${trends.length}): ${trends.join(' · ')}`);
  };

  if (label === 'mobile') {
    // Su mobile il desk è un foglio a tutto schermo: misuriamo senza cambiare tab,
    // ma riportandoci alla sezione iniziale per confronti coerenti.
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.nation-dock-tab')]
        .find((el) => (el.textContent || '').includes('Situazione'));
      if (tab) tab.click();
    });
    await page.waitForTimeout(300);
    await snapshot('Situazione');
  } else {
    console.log('tabs:', (await page.locator('.nation-dock-tab').allTextContents()).join(' | '));
    for (const tab of TABS) {
      await page.locator('.nation-dock-tab', { hasText: tab }).first().click();
      await page.waitForTimeout(300);
      await snapshot(tab);
    }
  }

  const overflow = await page.evaluate(() => {
    const dock = document.querySelector('.nation-dock');
    const tabs = document.querySelector('.nation-dock-tabs');
    return {
      dock: dock ? { scrollW: dock.scrollWidth, clientW: dock.clientWidth } : null,
      tabs: tabs ? { scrollW: tabs.scrollWidth, clientW: tabs.clientWidth, rows: Math.round(tabs.getBoundingClientRect().height) } : null,
    };
  });
  console.log('overflow:', JSON.stringify(overflow));
  await page.screenshot({ path: `/tmp/nation-${label}.png` });
}

await measure('desktop', 1440, 900);
await measure('mobile', 390, 844);

await browser.close();
