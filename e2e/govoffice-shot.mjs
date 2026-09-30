/**
 * WS-GOVOFFICE-03/04/05 — Screenshot dell'Ufficio del Governo, mock offline.
 * Uso: node govoffice-shot.mjs <prefisso-out> [larghezza] [altezza]
 *
 * Il viewport è parametrico (default 1440x960) così lo stesso percorso gira
 * anche sul telefono, dove il layout dell'ufficio cambia a una colonna.
 *
 * WS-GOVOFFICE-05 — due variabili d'ambiente:
 *  · `GOVOFFICE_BASE_URL` (default http://localhost:5173): per fotografare il
 *    «prima» da un albero alla revisione base senza toccare la porta abituale;
 *  · `GOVOFFICE_MULTI=1`: monta il gabinetto a quattro sedie (le due nuove di
 *    Istruzione e Sanità) e apre il pannello dati per mostrarne il contenuto.
 *
 * Fotografa le due schermate nuove: il Registro degli atti (prima schermata) e
 * la seduta a due pannelli; poi registra un atto dal dialogo e rifotografa il
 * registro firmato.
 */
import { chromium } from 'playwright';
import { installMockApi, MOCK_CABINET_MULTI } from './mock-api.mjs';

const prefix = process.argv[2] || '/tmp/govoffice';
const width = Number(process.argv[3]) || 1440;
const height = Number(process.argv[4]) || 960;
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const multi = process.env.GOVOFFICE_MULTI === '1';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

installMockApi(page, multi ? { cabinet: MOCK_CABINET_MULTI } : {});
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
await page.waitForTimeout(1200);
await page.screenshot({ path: `${prefix}-1-registro-vuoto.png` });

// Seduta a due pannelli.
await page.locator('.cabinet-pick').first().click();
await page.waitForTimeout(1200);
const chat = page.locator('.government-office-pane-chat');
const chatTextarea = chat.locator('textarea');
// Sul telefono il campo di scrittura può finire sotto la piega: lo porto in vista.
await chatTextarea.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
// WS-GOVOFFICE-05 — il pannello dati è CHIUSO di default: questa è la schermata.
await page.screenshot({ path: `${prefix}-2-seduta-due-pannelli.png` });

// WS-GOVOFFICE-05 — il pannello aperto: stesso contenuto di prima, su richiesta.
if (multi) {
  const toggle = page.locator('.minister-dossier-toggle');
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${prefix}-2b-pannello-aperto.png` });
    await toggle.first().click();
    await page.waitForTimeout(300);
  }

  // Le due sedie nuove: la chat che le nomina e il pannello che le dettaglia.
  for (const seatName of ['istruzione', 'sanita']) {
    // La scelta delle sedie vive nel registro: ci si torna col tasto indietro.
    await page.locator('.government-office-back').click();
    await page.waitForTimeout(800);
    await page.locator(`.cabinet-pick[data-seat="${seatName}"]`).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${prefix}-2c-${seatName}.png` });
    const seatToggle = page.locator('.minister-dossier-toggle');
    if (await seatToggle.count()) {
      await seatToggle.first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${prefix}-2d-${seatName}-dati.png` });
    }
  }
  // Torna alla prima sedia per il resto del percorso.
  await page.locator('.government-office-back').click();
  await page.waitForTimeout(800);
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await page.waitForTimeout(900);
  await chatTextarea.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

// L'ordine nasce dal dialogo.
await chatTextarea.fill('Aprire un cantiere navale nel porto di Alfa.');
await chat.locator('.minister-compose button').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-3-dialogo.png` });
await chat.locator('.minister-draft-order').click();
await page.waitForTimeout(1200);

await page.locator('.government-office-back').click();
await page.waitForTimeout(800);
// Scorrimento in cima: la foto deve mostrare la testata, non la coda.
await page.locator('.government-office').evaluate(el => { el.scrollTop = 0; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${prefix}-4-registro-firmato.png` });

await browser.close();
console.log(`[ok] screenshot in ${prefix}-*.png`);
