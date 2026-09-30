/**
 * WS-MINISTER-UX-07 — Verifica visiva e misura di layout (A1/A2/A3).
 * ================================================================
 * Uso: node ux07-shot.mjs <prefisso-out>
 *
 * Cattura, su desktop/tablet/mobile:
 *  - `-markdown.png`  : la frase del ministro resa come documento (A1);
 *  - `-spesa.png`     : la voce di spesa discussa in evidenza, non il saldo (A2);
 *  - `-tavola.png`    : la tavola sul mobile, per il controllo di taglio (A3).
 *
 * Misura anche i contenitori tagliati (`scrollWidth/Height > client`) così la
 * verifica di A3 non è solo a occhio. Mock offline, nessun LLM reale.
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/ux07';
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const sizes = [[1440, 900], [1024, 768], [390, 844]];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

/** Conta gli elementi tagliati nella tavola (overflow nascosto + contenuto più grande). */
async function clippedCount(page) {
  return page.evaluate(() => {
    const scope = document.querySelector('.government-office-pane-table')
      || document.querySelector('.government-office');
    if (!scope) return -1;
    let count = 0;
    for (const el of scope.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const wClip = el.scrollWidth - el.clientWidth;
      const hClip = el.scrollHeight - el.clientHeight;
      if ((style.overflowX === 'hidden' && wClip > 2) || (style.overflowY === 'hidden' && hClip > 2)) count++;
    }
    return count;
  });
}

/** Invia una domanda al ministro aperto e attende la risposta. */
async function ask(page, text) {
  const compose = page.locator('.minister-compose textarea');
  await compose.fill(text);
  await page.locator('.minister-compose button').click();
  await page.waitForTimeout(900);
}

for (const [width, height] of sizes) {
  const mobile = width <= 767;
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log(`[pageerror@${width}] ${String(e).slice(0, 200)}`));

  installMockApi(page, {});
  // A1 — una risposta markdown dedicata: grassetto, corsivo, elenco e una
  // moltiplicazione legittima (`2*3*4`) che NON deve diventare corsivo.
  await page.route('**/government/minister/*', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() || {};
    if (String(body.message || '').toLowerCase().includes('formatta')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Signor Presidente, **la cassa regge** ma il margine è *sottile*.\n\n- Primo punto: il 2*3*4 non è corsivo.\n- Secondo punto: le uscite salgono.\n\nChiudo io: decida lei.',
          seat: 'tesoro',
        }),
      });
    }
    return route.fallback();
  });

  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  try { await page.waitForSelector('.game-shell', { timeout: 60_000 }); } catch { /* mock lento */ }
  await page.waitForTimeout(2000);

  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.waitForTimeout(700);
  await page.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
  await page.locator('.minister-chat').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);

  if (mobile) await page.locator('.minister-session-view', { hasText: 'Dialogo' }).click();
  await ask(page, 'Formatta la risposta, per favore');
  const markdown = await page.evaluate(() => {
    const thread = document.querySelector('.minister-thread');
    if (!thread) return { error: 'thread' };
    return {
      bold: Boolean(thread.querySelector('.rich-text strong')),
      em: Boolean(thread.querySelector('.rich-text em')),
      list: Boolean(thread.querySelector('.rich-text ul li')),
      rawAsterisks: (thread.textContent || '').includes('**'),
      multiplicationPreserved: (thread.textContent || '').includes('2*3*4'),
      multiplicationItalic: Array.from(thread.querySelectorAll('em')).some(el => (el.textContent || '').includes('3')),
    };
  });
  console.log(`[${width}x${height}] markdown=${JSON.stringify(markdown)}`);
  await page.screenshot({ path: `${prefix}-${width}-markdown.png` });

  // A2 — la spesa discute la sanità: la voce sale in cima al grafico.
  await ask(page, 'Mi mostri dove va la spesa per la sanità?');
  if (mobile) await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
  await page.waitForTimeout(600);
  const clippedTable = await clippedCount(page);
  await page.screenshot({ path: `${prefix}-${width}-spesa.png` });
  if (mobile) {
    await page.locator('.minister-session-view', { hasText: 'Dialogo' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${prefix}-${width}-dialogo.png` });
  }

  const focused = await page.evaluate(() => {
    const el = document.querySelector('.advisor-chart-bars li.focused');
    return el ? el.textContent.trim().slice(0, 60) : null;
  });
  const label = await page.evaluate(() => {
    const el = document.querySelector('.seat-presentation-label');
    return el ? el.textContent.trim() : null;
  });
  console.log(`[${width}x${height}] clipped(tavola)=${clippedTable} focused=${JSON.stringify(focused)} label=${JSON.stringify(label)}`);
  await page.close();
}

await browser.close();
console.log(`[ok] screenshot in ${prefix}-<width>-*.png`);
