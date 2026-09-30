/**
 * WS-MINISTER-UX-01 — Verifica di composizione della seduta (senza screenshot).
 * Uso: node ux01-check.mjs [larghezza] [altezza]
 *
 * Controlla ciò che l'occhio deve vedere e che i test unitari non possono
 * misurare: niente overflow orizzontale, il composer dentro la finestra, il
 * rapporto dialogo/tavola a desktop, una superficie alla volta su mobile, il
 * saluto e la scrittura visibili subito. Stampa una riga per controllo.
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const width = Number(process.argv[2]) || 1440;
const height = Number(process.argv[3]) || 900;
const BASE = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
installMockApi(page, {});

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
await page.locator('.game-shell').waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);
await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.locator('.cabinet-pick').first().click();
await page.locator('.minister-chat').waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(500);

const metrics = await page.evaluate(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; };
  const office = document.querySelector('.government-office');
  const chat = document.querySelector('.government-office-pane-chat');
  const table = document.querySelector('.government-office-pane-table');
  const composer = document.querySelector('.minister-compose');
  const thread = document.querySelector('.minister-thread');
  const greeting = document.querySelector('.minister-greeting');
  const textarea = document.querySelector('.minister-compose textarea');
  const views = document.querySelector('.minister-session-views');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docScrollW: document.documentElement.scrollWidth,
    office: office && rect(office),
    chat: chat && rect(chat),
    table: table && rect(table),
    composer: composer && rect(composer),
    threadOverflowX: thread ? thread.scrollWidth - thread.clientWidth : null,
    tableOverflowX: table ? table.scrollWidth - table.clientWidth : null,
    hasGreeting: !!greeting,
    greetingText: greeting ? greeting.textContent.trim().slice(0, 80) : '',
    hasTextarea: !!textarea && !!textarea.offsetParent,
    viewsVisible: views ? getComputedStyle(views).display !== 'none' : false,
    tableVisible: table ? !!table.offsetParent : false,
    chatVisible: chat ? !!chat.offsetParent : false,
  };
});

const mobile = metrics.viewsVisible || metrics.viewport.w <= 767;
console.log(`# viewport ${width}x${height} (mobile: ${mobile})`);

check(metrics.docScrollW <= metrics.viewport.w + 1, 'nessun overflow orizzontale della pagina', `scrollW=${metrics.docScrollW} vw=${metrics.viewport.w}`);
check(metrics.hasTextarea, 'il composer è visibile subito');
check(metrics.hasGreeting, 'il saluto del ministro è presente', metrics.greetingText);
check(metrics.threadOverflowX !== null && metrics.threadOverflowX <= 1, 'la cronologia non sborda in orizzontale', `overflowX=${metrics.threadOverflowX}`);
check(metrics.composer && metrics.composer.bottom <= metrics.office.bottom + 1, 'il composer resta dentro la finestra della seduta', metrics.composer && metrics.office ? `composer.bottom=${Math.round(metrics.composer.bottom)} office.bottom=${Math.round(metrics.office.bottom)}` : '');

if (!mobile) {
  const ratio = metrics.chat.w / metrics.table.w;
  check(ratio > 0.55 && ratio < 0.95, 'rapporto dialogo/tavola vicino a 42/58', `chat/table=${ratio.toFixed(2)}`);
  check(metrics.chat.w >= 300 && metrics.table.w >= 320, 'le colonne rispettano le larghezze minime', `chat=${Math.round(metrics.chat.w)} table=${Math.round(metrics.table.w)}`);
  check(metrics.tableOverflowX !== null && metrics.tableOverflowX <= 1, 'la tavola non sborda in orizzontale', `overflowX=${metrics.tableOverflowX}`);
  check(metrics.chatVisible && metrics.tableVisible, 'dialogue e tavola sono entrambi visibili a desktop');
} else {
  check(metrics.chatVisible && !metrics.tableVisible, 'su mobile si vede una superficie alla volta (Dialogo)');
  await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const table = document.querySelector('.government-office-pane-table');
    const chat = document.querySelector('.government-office-pane-chat');
    return { tableVisible: !!table.offsetParent, chatVisible: !!chat.offsetParent, tableOverflowX: table.scrollWidth - table.clientWidth };
  });
  check(!after.chatVisible && after.tableVisible, 'la linguetta «Tavola» mostra la tavola e nasconde il dialogo');
  check(after.tableOverflowX <= 1, 'la tavola mobile non sborda in orizzontale', `overflowX=${after.tableOverflowX}`);
}

await browser.close();
console.log(failures === 0 ? '[ok] tutti i controlli passano' : `[!!] ${failures} controlli falliti`);
process.exit(failures === 0 ? 0 : 1);
