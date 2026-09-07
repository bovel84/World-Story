// Verifica layout: hud.top < 60, mappa alta > 400, scrollY = 0 (criteri verify-layout.mjs)
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.route('**/api/saves', async (route) => {
  const res = await route.fetch();
  const data = await res.json();
  if (data?.saves) data.saves = data.saves.map((s) => ({ ...s, name: 'Test' }));
  await route.fulfill({ response: res, json: data });
});

await page.goto('http://localhost:5173/');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
await page.locator('.landing-save-play').first().click();
await page.waitForTimeout(7000);

const m = await page.evaluate(() => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), height: Math.round(b.height), width: Math.round(b.width) };
  };
  return {
    scrollY: window.scrollY,
    hud: r(document.querySelector('.hud-bar')),
    map: r(document.querySelector('.game-map')),
    canvas: r(document.querySelector('.maplibregl-canvas')),
  };
});
console.log(JSON.stringify(m, null, 1));
const ok = m.scrollY === 0 && m.hud && m.hud.top >= 0 && m.hud.top < 60 && m.map && m.map.height > 400;
console.log(ok ? 'LAYOUT OK ✅' : 'LAYOUT FAIL ❌');
await browser.close();