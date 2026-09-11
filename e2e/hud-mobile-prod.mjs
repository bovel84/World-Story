/**
 * Screenshot HUD mobile (flussi mock, offline) — diagnostica UI.
 * Uso: CHROME_PATH=... node hud-mobile-shot.mjs <out.png>
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';
import path from 'node:path';

const out = process.argv[2] || path.join(process.cwd(), 'hud-mobile-shot.png');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page);
await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
try {
  await page.waitForSelector('.game-shell', { timeout: 60000 });
} catch {
  console.log('[warn] .game-shell non visibile, proseguo comunque');
}
await page.waitForTimeout(3000);

// Catena dei container reali della HUD
const chain = await page.evaluate(() => {
  const hud = document.querySelector('.hud-bar');
  if (!hud) return { error: 'no .hud-bar' };
  const path = [];
  let el = hud;
  while (el && el !== document.body) {
    path.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')}`);
    el = el.parentElement;
  }
  return {
    path,
    gameWrapperExists: !!document.querySelector('.game-wrapper'),
    gameShellExists: !!document.querySelector('.game-shell'),
    shellChildren: Array.from(document.querySelector('.game-shell')?.children || []).map(c => `${c.tagName.toLowerCase()}.${String(c.className)}`),
  };
});
console.log('CHAIN:', JSON.stringify(chain, null, 1));

// Metriche HUD utili
const metrics = await page.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      disp: s.display, op: s.opacity, vis: s.visibility, ov: s.overflow, z: s.zIndex,
      pos: s.position, gt: s.gridTemplateRows, gc: s.gridColumn, gr: s.gridRow,
    };
  };
  return {
    shell: q('.game-shell'),
    shellHud: q('.game-shell-hud'),
    grid: q('.game-shell-grid'),
    map: q('.game-shell-map'),
    hud: q('.hud-bar'),
    advance: q('.hud-advance-btn'),
    pill: q('.hud-date-pill'),
    dateDisplay: q('.hud-date-display'),
  };
});
console.log(JSON.stringify(metrics, null, 1));

await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('OK:', out);