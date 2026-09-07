/** Focused E2E for province preset, group diplomacy/SSE and enriched timeline. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.OPEN_PAX_URL || 'http://localhost:5173';
const shotDir = path.resolve(process.cwd(), '..', 'docs', 'e2e');
fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  // Il runner di sviluppo usa macOS 11: il Chrome di sistema è compatibile,
  // mentre i binari Playwright recenti richiedono macOS 12+.
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const consoleErrors = [];
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('dialog', dialog => dialog.accept());

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  const preset = page.locator('.template-card', { hasText: 'Mondo Provinciale WW2' });
  await preset.waitFor({ timeout: 20_000 });
  await preset.click();

  await page.locator('.country-list-item').first().waitFor({ timeout: 30_000 });
  const germany = page.locator('.country-list-item').filter({ has: page.locator('.country-code', { hasText: /^DEU$/ }) });
  await germany.click();

  const gameResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
      && /\/api\/games$/.test(new URL(response.url()).pathname)
      && response.ok(),
    { timeout: 180_000 },
  );
  await page.locator('.btn-play').click();
  const gameId = (await (await gameResponse).json()).game_id;
  await page.locator('.game-wrapper').waitFor({ timeout: 180_000 });

  const game = await page.evaluate(async id => {
    const response = await fetch(`/api/games/${id}`);
    if (!response.ok) throw new Error(`GET game: ${response.status}`);
    return response.json();
  }, gameId);
  const provinceCount = Object.keys(game.world?.regions || {}).length;
  if (provinceCount !== 3178) throw new Error(`Expected 3178 provinces, got ${provinceCount}`);

  await page.getByRole('button', { name: 'Diplomazia' }).click();
  await page.locator('.advisor-tab', { hasText: 'Diplomazia' }).waitFor();
  await page.locator('.btn-new-chat').click();
  const options = page.locator('.polity-pick-item');
  if (await options.count() < 2) throw new Error('Not enough nations for a group chat');
  await options.nth(0).click();
  await options.nth(1).click();
  await page.locator('.btn-create-group-chat').click();
  await page.locator('.chat-thread-header').waitFor({ timeout: 30_000 });

  await page.locator('.chat-input-row textarea').fill('Proponiamo un patto di non aggressione e consultazioni reciproche.');
  const sendResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
      && /\/messages$/.test(new URL(response.url()).pathname),
    { timeout: 240_000 },
  );
  await page.locator('.btn-chat-send').click();
  const sent = await sendResponse;
  if (!sent.ok()) throw new Error(`Chat request failed: ${sent.status()} ${await sent.text()}`);
  await page.locator('.chat-typing').waitFor({ state: 'detached', timeout: 30_000 });
  if (await page.locator('.chat-bubble').count() < 2) throw new Error('Diplomatic reply not rendered');

  await page.locator('.btn-close').click();
  await page.getByRole('button', { name: 'Apri il pannello timeline' }).click();
  await page.locator('.hud-timeline-panel').waitFor();
  await page.locator('.hud-timeline-source', { hasText: 'Diplomazia' }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(shotDir, '17-stage23-chat-timeline.png'), fullPage: false });

  console.log(JSON.stringify({ ok: true, gameId, provinceCount, consoleErrors }, null, 2));
} finally {
  await browser.close();
}
