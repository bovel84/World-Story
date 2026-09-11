/**
 * Screenshot chat diplomazia APERTA contro il backend REALE (localhost:8000).
 * Uso: node real-chat-shot.mjs [gameId]
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

// Riprendi una salvataggio esistente (sezione «Continua»)
const playBtn = page.locator('.landing-save-play, button:has-text("Gioca")').first();
await playBtn.click({ timeout: 10000 }).catch(async () => {
  console.log('[warn] nessun bottone continua, provo nuovo gioco');
  await page.locator('.landing-cta').click().catch(() => {});
});
try {
  await page.waitForSelector('.game-shell, .game-wrapper', { timeout: 60000 });
} catch { console.log('[warn] partita non caricata'); }
await page.waitForTimeout(4000);

// Apri Diplomazia
await page.locator('.rail-btn[aria-label="Diplomazia"]').click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/real-chat-list.png' });

// Stato PICKER (+ Nuova chat)
await page.locator('.btn-new-chat').click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const pickerInfo = await page.evaluate(() => {
  const st = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, fill: s.webkitTextFillColor };
  };
  return {
    chatsPanel: st('.chats-panel'),
    picker: st('.new-chat-picker'),
    pickItem: st('.polity-pick-item'),
    pickName: st('.polity-pick-name'),
    hint: st('.picker-hint'),
    cancel: st('.picker-cancel'),
  };
});
console.log('PICKER:', JSON.stringify(pickerInfo, null, 1));
await page.screenshot({ path: '/tmp/real-chat-picker.png' });

// Apri la prima chat esistente (se presente)
const firstChat = page.locator('.chat-item').first();
if (await firstChat.count()) {
  await firstChat.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/real-chat-open.png' });
}
// Analisi antenati del pannello chat (stato picker/lista)
const info = await page.evaluate(() => {
  const chain = (el) => {
    const out = [];
    let n = el;
    while (n && n !== document.body) {
      out.push(n.className && typeof n.className === 'string' ? n.className.slice(0, 80) : n.tagName);
      n = n.parentElement;
    }
    return out;
  };
  const st = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, fill: s.webkitTextFillColor };
  };
  const panel = document.querySelector('.chats-panel');
  return {
    chain: panel ? chain(panel) : null,
    chatsPanel: st('.chats-panel'),
    chatsList: st('.chats-list'),
    chatItem: st('.chat-item'),
    picker: st('.new-chat-picker'),
    pickItem: st('.polity-pick-item'),
    pickName: st('.polity-pick-name'),
    empty: st('.chats-empty'),
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/real-chat-state.png' });
await browser.close();