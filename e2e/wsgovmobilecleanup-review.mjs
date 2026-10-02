/**
 * WS-GOV-MOBILE-CLEANUP — Revisione oggettiva della schermata (A–H).
 * ==================================================================
 * Il modello che scrive questo task non ha accesso all'immagine: invece di
 * dichiarare una «review visiva» che non è stata fatta, questo harness misura le
 * domande A–H sul DOM reale e le stampa. Le PNG restano il reperto per l'occhio
 * umano; qui ci sono i numeri che le rendono verificabili.
 *
 * Uso: node wsgovmobilecleanup-review.mjs
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath });

async function reach(page, width, height) {
  await page.setViewportSize({ width, height });
  installMockApi(page);
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.waitForSelector('.game-shell', { timeout: 60_000 });
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
  await page.waitForSelector('.gov-mobile', { timeout: 15_000 });
}

async function send(page, text) {
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await page.waitForTimeout(1800);
}

async function review(page, label) {
  const box = sel => page.locator(sel).first().boundingBox();
  const dialogue = await page.locator('.gov-mobile #gov-panel-dialogue .minister-thread').evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  const compose = await box('.gov-mobile-chat .minister-compose');
  const scrollers = await page.evaluate(() => {
    const panel = document.querySelector('#gov-panel-dialogue');
    if (!panel) return 0;
    return [panel, ...panel.querySelectorAll('*')].filter(el => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
    }).length;
  });

  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.waitForTimeout(400);
  const boardTitle = await page.locator('.gov-mobile-board-title').textContent().catch(() => null);
  const boardStatus = await page.locator('.gov-mobile-board-status').textContent().catch(() => null);
  const blocker = await page.locator('.gov-mobile-alert-q').first().textContent().catch(() => null);
  const cta = await box('.gov-mobile-cta .gov-mobile-primary');
  const ctaLabel = await page.locator('.gov-mobile-cta .gov-mobile-primary').first().textContent().catch(() => null);
  const ctaCount = await page.locator('.gov-mobile-cta .gov-mobile-primary').count();
  const talks = await page.locator('.gov-mobile-talk').count();
  const seatTables = await page.locator('.gov-mobile .seat-table').count();
  const ministers = await page.locator('.gov-mobile-minister').count();
  const divider = await page.locator('.government-office-divider').count();
  const mobile = await page.locator('.gov-mobile').count();

  console.log(`\n=== ${label} ===`);
  console.log(`A. Dove sono       : header «${(await page.locator('.gov-mobile-title').textContent().catch(() => ''))?.trim()}»`);
  console.log(`B. Con chi parlo   : ${dialogue ? `${dialogue.scrollHeight}px di cronaca in ${dialogue.clientHeight}px` : 'n/d'}`);
  console.log(`C. Cosa decidiamo  : «${boardTitle?.trim()}» — stato ${boardStatus?.trim()}`);
  console.log(`D. Cosa manca      : ${blocker ? blocker.trim() : 'nessun blocco'}`);
  console.log(`E. Azione primaria : «${ctaLabel?.trim()}» (CTA visibili: ${ctaCount}) — y=${cta ? Math.round(cta.y) : 'n/d'}, fine=${cta ? Math.round(cta.y + cta.height) : 'n/d'}`);
  console.log(`F. Duplicazioni    : transcript nella Tavola=${talks}, SeatTable nel mobile=${seatTables}, sezioni ministero=${ministers}`);
  console.log(`G. Scroll          : composer fine=${compose ? Math.round(compose.y + compose.height) : 'n/d'}, scroll reali nel Dialogo=${scrollers}`);
  console.log(`H. Card in card    : .gov-mobile=${mobile}, divisore desktop=${divider}`);
}

{
  const page = await browser.newPage();
  await reach(page, 390, 844);
  await send(page, 'Voglio costruire una fabbrica siderurgica.');
  await review(page, '390×844 — blocco di localizzazione');
  await send(page, 'Costruiamola a Sarajevo.');
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).click();
  await page.waitForSelector('.gov-mobile-minister', { timeout: 15_000 }).catch(() => {});
  await review(page, '390×844 — riunione convocata');
  await page.close();
}

{
  const page = await browser.newPage();
  await reach(page, 844, 390);
  await send(page, 'Voglio costruire una fabbrica siderurgica.');
  await review(page, '844×390 — telefono in orizzontale');
  await page.close();
}

await browser.close();
