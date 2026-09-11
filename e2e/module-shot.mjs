/**
 * Screenshot dei moduli desk (diplomazia, consulente, notizie, nazione) — mock offline.
 * Uso: node module-shot.mjs <prefisso-out>
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/module';
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
  await page.waitForSelector('.game-shell', { timeout: 60000 });
} catch {
  console.log('[warn] .game-shell non visibile, proseguo comunque');
}
await page.waitForTimeout(2500);

const MODULES = [
  { aria: 'Ordini', file: 'orders' },
  { aria: 'Diplomazia', file: 'diplomacy' },
  { aria: 'Consulente', file: 'advisor' },
  { aria: 'Notizie', file: 'news' },
  { aria: 'Nazione', file: 'nation' },
];

for (const mod of MODULES) {
  try {
    await page.locator(`.rail-btn[aria-label="${mod.aria}"]`).click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${prefix}-${mod.file}.png` });
    console.log('saved:', `${prefix}-${mod.file}.png`);
    // chiudi il desk se c'è la X
    await page.locator('.desk-close-x').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
  } catch (e) {
    console.log(`[warn] ${mod.aria}: ${String(e).slice(0, 120)}`);
  }
}

// Chat APERTA: Diplomazia → + Nuova chat → primo paese → screenshot
try {
  await page.locator('.rail-btn[aria-label="Diplomazia"]').click({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.locator('.btn-new-chat').click({ timeout: 5000 });
  await page.waitForTimeout(600);
  await page.locator('.polity-pick-item').first().click({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.locator('button:has-text("APRI CHAT DIRETTA"), button:has-text("Apri chat")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Invia un messaggio per vedere i fumetti (player + eventuale risposta)
  const input = page.locator('.chat-input-row textarea, .chat-input-row input').first();
  if (await input.count()) {
    await input.fill('Test diplomatico: propongo un trattato di alleanza.');
    await page.locator('.btn-chat-send').click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${prefix}-chat-open.png` });
  console.log('saved:', `${prefix}-chat-open.png`);
} catch (e) {
  console.log(`[warn] chat-open: ${String(e).slice(0, 160)}`);
  await page.screenshot({ path: `${prefix}-chat-open-fail.png` }).catch(() => {});
}
await browser.close();
