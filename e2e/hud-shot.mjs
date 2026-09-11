/**
 * Screenshot HUD desktop (flussi mock, offline) — diagnostica UI.
 * Uso: CHROME_PATH=... node hud-shot.mjs <out.png>
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';
import path from 'node:path';

const out = process.argv[2] || path.join(process.cwd(), 'hud-shot.png');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
try {
  await page.waitForSelector('.game-wrapper', { timeout: 60000 });
} catch {
  console.log('[warn] .game-wrapper non visibile, proseguo comunque');
}
await page.waitForSelector('.hud-bar', { timeout: 30000 }).catch(() => {});
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
      fs: s.fontSize, color: s.color, fill: s.webkitTextFillColor, font: s.fontFamily.slice(0, 40),
      disp: s.display, op: s.opacity, shadow: s.textShadow.slice(0, 60),
    };
  };
  return {
    hud: q('.hud-bar'),
    logo: q('.hud-logo-text'),
    world: q('.hud-world-name'),
    turn: q('.hud-turn-badge'),
    dispatch: q('.hud-dispatch-toggle'),
    advance: q('.hud-advance-btn'),
    pill: q('.hud-date-pill'),
    dateDisplay: q('.hud-date-display'),
    dateLong: q('.hud-date-long'),
    dateCompact: q('.hud-date-compact'),
    navPrev: q('.hud-date-nav'),
    navNext: q('.hud-timeline-toggle'),
  };
});
console.log(JSON.stringify(metrics, null, 1));

await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height: 220 } });
console.log('saved:', out);
await browser.close();
