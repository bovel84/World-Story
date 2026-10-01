/**
 * WS-MINISTER-UX-01 — Screenshot della seduta del ministro, mock offline.
 * Uso: node ux01-shot.mjs <prefisso-out> [larghezza] [altezza]
 *
 * Cattura la nuova gerarchia UX-01: il dialogo come superficie principale a
 * sinistra e la tavola di lavoro a destra. Su mobile (≤767px) mostra le due
 * viste separate — «Dialogo» e «Tavola» — perché lì si vede una superficie alla
 * volta. Il viewport è parametrico (default 1440×900).
 *
 * Variabili d'ambiente: vedi `govoffice-shot.mjs` (`GOVOFFICE_BASE_URL`,
 * `GOVOFFICE_MULTI`, `GOVOFFICE_CABINET`).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { installMockApi, MOCK_CABINET_MULTI } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/ux01';
const width = Number(process.argv[3]) || 1440;
const height = Number(process.argv[4]) || 900;
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const cabinetMode = process.env.GOVOFFICE_CABINET || (process.env.GOVOFFICE_MULTI === '1' ? 'multi' : 'default');
const multi = cabinetMode === 'multi';
const cabinet = cabinetMode === 'raw'
  ? JSON.parse(readFileSync(new URL('./fixtures/ws-govoffice-05b-tesoro-raw.json', import.meta.url), 'utf8'))
  : cabinetMode === 'multi' ? MOCK_CABINET_MULTI : null;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page, cabinet ? { cabinet } : {});
await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${prefix}-1-scelta.png` });

/** La vista «Tavola» esiste solo su mobile: la linguetta è visibile? */
async function onMobile() {
  return page.locator('.minister-session-views').isVisible().catch(() => false);
}

async function captureSeat(tag) {
  await page.locator('.minister-chat').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${prefix}-${tag}-dialogo.png` });

  // Il fascicolo della sedia: chiuso di default, si apre per la prova.
  const brief = page.locator('.seat-brief-summary');
  if (await brief.count()) {
    await brief.first().click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${prefix}-${tag}-fascicolo.png` });
    await brief.first().click();
    await page.waitForTimeout(250);
  }

  if (await onMobile()) {
    await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${prefix}-${tag}-tavola.png` });
    await page.locator('.minister-session-view', { hasText: 'Dialogo' }).click();
    await page.waitForTimeout(250);
  } else {
    const table = page.locator('.government-office-pane-table');
    if (await table.count()) {
      await table.evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: `${prefix}-${tag}-tavola.png` });
  }
}

await page.locator('.cabinet-pick').first().click();
await captureSeat('2-tesoro');

if (multi) {
  for (const seatName of ['istruzione', 'sanita']) {
    await page.locator('.government-office-back').click();
    await page.waitForTimeout(700);
    await page.locator(`.cabinet-pick[data-seat="${seatName}"]`).click();
    await captureSeat(`3-${seatName}`);
  }
  // Torna alla prima sedia per il resto del percorso.
  await page.locator('.government-office-back').click();
  await page.waitForTimeout(700);
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await page.waitForTimeout(700);
}

// L'ordine nasce dal dialogo.
const chat = page.locator('.government-office-pane-chat');
const chatTextarea = chat.locator('textarea');
await chatTextarea.scrollIntoViewIfNeeded();
await chatTextarea.fill('Aprire un cantiere navale nel porto di Alfa.');
await chat.locator('.minister-compose button').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-4-dialogo-risposta.png` });
// WS-MINISTER-UX-08 (5) — L'ordine nasce dalla proposta concreta sul tavolo.
const tavola = page.locator('.government-office-pane-table');
await tavola.locator('.treasury-act-prepare').first().click();
await tavola.locator('.act-draft-sign').click();
await page.waitForTimeout(1000);

await page.locator('.government-office-back').click();
await page.waitForTimeout(700);
await page.locator('.government-office').evaluate(el => { el.scrollTop = 0; });
await page.waitForTimeout(250);
await page.screenshot({ path: `${prefix}-5-registro-firmato.png` });

await browser.close();
console.log(`[ok] screenshot in ${prefix}-*.png`);
