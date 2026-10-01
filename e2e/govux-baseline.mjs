/** GOVUX P0: baseline contro API reali, senza firma né avanzamento del tempo.
 * node e2e/govux-baseline.mjs (da root o e2e). Un solo colloquio reale; riaperture senza LLM.
 * Exit nonzero su flusso incompleto. I difetti geometrici sono dati d'audit, non nascosti.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BASE_URL ?? 'http://localhost:8000';
const saveId = process.env.SAVE_ID ?? '56193ead2b2e';
const out = process.env.OUT_DIR ?? path.join(root, 'docs/implementation/assets/ws-govux-p0/real');
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewports = [[390, 844], [768, 1024], [1366, 768], [1920, 1080], [360, 800]];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
const log = { base, saveId, mock: false, reducedMotion: 'reduce', viewports: [], errors: [], writes: [], blockedWrites: [], streams: [] };
let gameId;
let saveLoadAllowed = true;
// Difesa PRIMA della trasmissione, non soltanto un controllo a posteriori.
// /simulation-jobs è l'avanzamento reale: la whitelist blocca anche quello.
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
  if (request.method() === 'POST' && url.pathname === `/api/saves/${saveId}/load` && saveLoadAllowed) {
    saveLoadAllowed = false;
    return route.continue();
  }
  const minister = gameId && [`/api/games/${gameId}/government/minister/tesoro`, `/api/games/${gameId}/government/minister/tesoro/stream`].includes(url.pathname);
  if (request.method() === 'POST' && minister) return route.continue();
  log.blockedWrites.push({ method: request.method(), path: url.pathname });
  await route.abort('blockedbyclient');
});
const session = await page.context().newCDPSession(page);
await session.send('Network.enable');
const streams = new Map();
session.on('Network.requestWillBeSent', event => {
  if (/\/government\/minister\/[^/]+\/stream$/.test(event.request.url)) {
    const info = { started: event.timestamp, chunks: [] };
    streams.set(event.requestId, info);
    log.streams.push(info);
  }
});
session.on('Network.dataReceived', event => {
  const stream = streams.get(event.requestId);
  if (stream) stream.chunks.push({ afterMs: Math.round((event.timestamp - stream.started) * 1000), bytes: event.dataLength });
});
session.on('Network.loadingFinished', event => {
  const stream = streams.get(event.requestId);
  if (stream) stream.finishedAfterMs = Math.round((event.timestamp - stream.started) * 1000);
});
page.on('pageerror', error => log.errors.push(String(error)));
page.on('request', request => {
  const url = new URL(request.url());
  const found = url.pathname.match(/\/api\/games\/([^/]+)\/government\/cabinet$/);
  if (found) gameId = found[1];
  if (request.method() !== 'GET' && url.pathname.startsWith('/api/')) {
    log.writes.push({ method: request.method(), path: url.pathname });
  }
});

async function queue() {
  assert.ok(gameId, 'gameId identificato dalla richiesta cabinet reale');
  const response = await page.request.get(`${base}/api/games/${gameId}/actions/queue`);
  assert.equal(response.status(), 200);
  return response.json();
}
async function openTreasury() {
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await page.locator('.minister-chat').waitFor();
}
async function showTable() {
  const tab = page.getByRole('tab', { name: 'Tavola', exact: true });
  const mobile = await tab.isVisible();
  if (mobile) await tab.click();
  return mobile;
}
async function measure(name, width, height) {
  const info = await page.evaluate(() => {
    const box = selector => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, hasLayout: r.width > 0 && r.height > 0, intersectsViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth };
    };
    const focus = document.activeElement;
    const main = document.querySelector('.seat-table-main')?.getBoundingClientRect();
    const pane = document.querySelector('.government-office-pane-table')?.getBoundingClientRect();
    const mainVisibleHeight = main && pane && main.height > 0
      ? Math.max(0, Math.min(main.bottom, pane.bottom, innerHeight) - Math.max(main.top, pane.top, 0)) : 0;
    return {
      mainVisibleHeight,
      mainVisibleFraction: main?.height > 0 ? mainVisibleHeight / main.height : 0,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      safeAreaPadding: {
        top: getComputedStyle(document.querySelector('.government-office')).paddingTop,
        bottom: getComputedStyle(document.querySelector('.government-office')).paddingBottom,
      },
      noveltyBadge: Boolean(document.querySelector('.minister-session-view-dot')),
      // Contrasto delle sole superfici CSS risolvibili: niente giudizi su foto/backdrop.
      contrast: [...document.querySelectorAll('.cabinet-pick-name, .cabinet-pick-reads, .entry-meta span, .minister-session-date, .minister-session-view, .seat-table-head p, .act-draft-note, .act-draft-label')]
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => {
          const rgba = color => {
            const n = color.match(/[0-9.]+/g)?.map(Number);
            return n && n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : null;
          };
          const layers = [];
          let opaque = false;
          for (let parent = el; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.backgroundImage !== 'none') return { selector: el.className, ratio: null, reason: 'background image' };
            const color = rgba(style.backgroundColor);
            if (color) {
              layers.push(color);
              if (color[3] === 1) { opaque = true; break; }
            }
          }
          const style = getComputedStyle(el);
          const foreground = rgba(style.color);
          if (!opaque || !foreground) return { selector: el.className, ratio: null, reason: 'sfondo non opaco' };
          let bg = layers.pop().slice(0, 3);
          for (const layer of layers.reverse()) bg = bg.map((c, i) => layer[i] * layer[3] + c * (1 - layer[3]));
          const fg = bg.map((c, i) => foreground[i] * foreground[3] + c * (1 - foreground[3]));
          const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const a = luminance(fg), b = luminance(bg);
          const threshold = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
          const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          return { selector: el.className || el.parentElement.className, text: el.textContent.trim().slice(0, 60), ratio: +ratio.toFixed(2), threshold, passes: ratio >= threshold };
        }),
      documentOverflowX: document.documentElement.scrollWidth > innerWidth,
      office: box('.government-office'), dialog: box('.government-office-pane-chat'),
      table: box('.government-office-pane-table'), main: box('.seat-table-main'), draft: box('.act-draft'),
      mainKind: document.querySelector('.seat-table-main [data-kind]')?.getAttribute('data-kind') ?? null,
      focus: focus?.getAttribute('aria-label') || focus?.textContent?.trim().slice(0, 80),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      controls: [...document.querySelectorAll('.government-office button, .government-office textarea')]
        .filter(el => el.getBoundingClientRect().width > 0)
        .map(el => ({ name: el.getAttribute('aria-label') || el.textContent?.trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
      tabs: [...document.querySelectorAll('[role="tab"]')].map(el => ({ text: el.textContent.trim(), selected: el.getAttribute('aria-selected'), controls: el.getAttribute('aria-controls'), tabIndex: el.tabIndex })),
    };
  });
  const filename = `${width}x${height}-${name}.png`;
  await page.screenshot({ path: path.join(out, filename) });
  log.viewports.push({ stage: name, filename, ...info });
  return info;
}

try {
  const health = await page.request.get(`${base}/api/health`);
  assert.equal(health.status(), 200);
  log.health = await health.json();
  await page.goto(base, { waitUntil: 'networkidle' });
  const save = page.locator(`[data-landing-save-card="${saveId}"] .landing-save-play`);
  await save.waitFor({ timeout: 20000 });
  await save.click();
  await page.locator('.game-shell').waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').waitFor({ timeout: 30000 });
  log.queueBefore = await queue();
  await openTreasury();
  const chat = page.locator('.minister-chat');
  for (let attempt = 0; attempt < 3; attempt++) {
    const count = await chat.locator('.minister-entry.assistant:not(.minister-greeting)').count();
    await chat.locator('textarea').fill('Mostra il grafico del bilancio sulla Tavola. Risposta breve, solo fatti dai conti; termina con ```tavola\n{"op":"focus","evidence":"spesa"}\n```. Non deliberare né applicare ordini.');
    await chat.locator('.minister-compose button').click();
    await page.waitForFunction(before => {
      const replies = document.querySelectorAll('.minister-entry.assistant:not(.minister-greeting)');
      const completed = document.querySelector('.minister-compose textarea:not([disabled])');
      return replies.length > before && completed && replies[replies.length - 1].querySelector('.entry-text')?.textContent.trim() && !document.querySelector('.minister-chat .stream-cursor');
    }, count, { timeout: 180000 });
    if (await page.locator('.seat-table-main [data-kind="chart"]').count()) break;
  }
  assert.equal(await page.locator('.seat-table-main [data-kind="chart"]').count(), 1, 'grafico ottenuto dal provider reale');
  const replyCount = await chat.locator('.minister-entry').count();
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.locator('.government-office-back').click();
    await page.locator('.cabinet-pick[data-seat="tesoro"]').waitFor();
    await measure('consiglio', width, height);
    await openTreasury();
    await measure('dialogo', width, height);
    if (width === 1366) {
      const divider = page.getByRole('separator', { name: 'Ridimensiona dialogo e tavola' });
      const before = Number(await divider.getAttribute('aria-valuenow'));
      await divider.focus();
      await page.keyboard.press('ArrowRight');
      const after = Number(await divider.getAttribute('aria-valuenow'));
      assert.equal(after, before + 2, 'divisore azionabile da tastiera');
      await page.keyboard.press('ArrowLeft');
      assert.equal(Number(await divider.getAttribute('aria-valuenow')), before);
      log.splitKeyboard = { before, after, restored: true };
    }
    assert.equal(await chat.locator('.minister-entry').count(), replyCount, 'il colloquio riprende alla riapertura');
    await chat.locator('textarea').fill('Testo in composizione — non inviato');
    const mobile = await showTable();
    await measure('tavola', width, height);
    const prepared = page.locator('.act-draft-text');
    assert.equal(await prepared.count(), 0, 'nessuna bozza ereditata da una seduta precedente');
    await page.locator('.treasury-act-prepare').first().click();
    await prepared.waitFor();
    await prepared.fill(`${await prepared.inputValue()}\nNota d'audit: esplorazione senza firma.`);
    await measure('bozza', width, height);
    await page.locator('.act-draft-cancel').click();
    await prepared.waitFor({ state: 'detached' });
    assert.equal(await prepared.count(), 0, 'bozza scartata senza firma');
    if (mobile) {
      await page.getByRole('tab', { name: 'Dialogo', exact: true }).click();
      assert.equal(await chat.locator('textarea').inputValue(), 'Testo in composizione — non inviato');
      const badgeAfterSeeing = await page.locator('.minister-session-view-dot').count();
      log.viewports.push({ stage: 'ritorno-dialogo', viewport: { width, height }, composerPreserved: true, noveltyBadgeAfterSeeing: badgeAfterSeeing > 0 });
    }
    await chat.locator('textarea').fill('');
  }
  // Tastiera reale: chiusura Esc e restituzione focus, riapertura da tastiera.
  await page.keyboard.press('Escape');
  await page.locator('.government-office').waitFor({ state: 'hidden' });
  log.focusRestored = await page.getByRole('button', { name: 'Governo', exact: true }).evaluate(el => el === document.activeElement);
  assert.equal(log.focusRestored, true);
  await page.keyboard.press('Enter');
  await page.locator('.government-office').waitFor();
  await page.keyboard.press('Tab');
  log.keyboardFocus = await page.evaluate(() => {
    const el = document.activeElement;
    return { name: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 80), outline: getComputedStyle(el).outline, focusVisible: el?.matches(':focus-visible') };
  });
  log.queueAfter = await queue();
  assert.deepEqual(log.queueAfter, log.queueBefore, 'esplorazione/prepara/modifica/scarta non mutano la coda');
  assert.equal(log.blockedWrites.length, 0, 'nessun tentativo di scrittura fuori whitelist');
  assert.equal(log.writes.filter(entry => /actions\/queue|time-skip|process-all|simulation-jobs/.test(entry.path)).length, 0, 'nessuna firma né avanzamento');
  log.completed = true;
} catch (error) {
  log.completed = false;
  log.failure = String(error);
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'baseline-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ completed: log.completed, screenshots: log.viewports.filter(entry => entry.filename).length, error: log.failure, streams: log.streams.length, out }, null, 2));
