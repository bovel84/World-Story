/**
 * World Story — Verifica palette «azioni proposte» (Ordini).
 * ==========================================================
 * Apre il gioco con API mockate, genera le proposte e misura il contrasto
 * reale (WCAG) di ogni livello testuale della scheda Ordini nel browser.
 * Esce con codice 1 se un testo scende sotto 4.5:1 (o 3:1 per testo grande).
 */
import { chromium } from 'playwright';
import { installMockApi, MOCK_GAME_ID } from './mock-api.mjs';
import { API_BASE } from './mock-constants.mjs';

const SUGGESTIONS = {
  suggestions: [
    {
      topic: 'Economia e produzione',
      description:
        'La produzione industriale richiede carbone e acciaio: il quadro attuale suggerisce di rafforzare la logistica prima dell\u2019espansione.',
      actions: [
        { title: 'Espandi gli stabilimenti', content: 'Aumenta la produzione industriale di acciaio nelle province orientali.' },
        { title: 'Rifornisci il carbone', content: 'Avvia l\u2019acquisto di carbone dai mercati esteri per coprire il fabbisogno.' },
      ],
    },
  ],
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

try {
  installMockApi(page);
  // Le proposte mock sovrascrivono la route vuota di installMockApi
  // (Playwright valuta le route in ordine di registrazione inverso).
  await page.route(`**/api/games/${MOCK_GAME_ID}/suggestions`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUGGESTIONS) }));
  await page.goto('http://localhost:5173/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.waitForSelector('.game-shell', { timeout: 60_000 });

  await page.locator('.rail-btn[aria-label="Ordini"]').click();
  await page.waitForSelector('.suggestions-content', { timeout: 15_000 });
  await page.locator('.btn-generate-suggestions').click();
  await page.waitForSelector('.suggestion-action', { timeout: 15_000 });
  // Accodo la prima proposta: misura anche lo stato «già nel piano».
  await page.locator('.suggestion-action').first().click();
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((x) => parseFloat(x));
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (fg, bg) => {
      const a = lum(fg.slice(0, 3));
      const b = lum(bg.slice(0, 3));
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return (hi + 0.05) / (lo + 0.05);
    };
    const effectiveBg = (el) => {
      const layers = [];
      let node = el;
      while (node && node.nodeType === 1) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c) layers.push(c);
        node = node.parentElement;
      }
      // Composizione dal livello più esterno al più interno.
      let bg = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        bg = [
          a * r + (1 - a) * bg[0],
          a * g + (1 - a) * bg[1],
          a * b + (1 - a) * bg[2],
          1,
        ];
      }
      return bg;
    };
    const targets = [
      ['council-title', '.council-title'],
      ['council-sub', '.council-sub'],
      ['suggestion-topic', '.suggestion-topic'],
      ['suggestion-description', '.suggestion-description'],
      ['suggestion-action (testo)', '.suggestion-action'],
      ['azione: titolo (b)', '.suggestion-action-body b'],
      ['azione: testo (span)', '.suggestion-action-body span'],
      ['azione: CTA', '.suggestion-action-cta'],
      ['order-limits-note', '.order-limits-note'],
      ['pending-header', '.pending-header'],
      ['pending-text', '.pending-text'],
      ['pending-number', '.pending-number'],
      ['free-order-label', '.free-order-label'],
      ['CTA in coda (queued)', '.suggestion-action.queued .suggestion-action-cta'],
    ];
    return targets.map(([name, sel]) => {
      const el = document.querySelector(sel);
      if (!el) return { name, missing: true };
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = effectiveBg(el);
      return {
        name,
        color: cs.color,
        bg: `rgb(${bg.slice(0, 3).join(',')})`,
        ratio: fg ? Math.round(contrast(fg, bg) * 100) / 100 : null,
        fontSize: parseFloat(cs.fontSize),
        bold: parseInt(cs.fontWeight, 10) >= 700,
      };
    });
  });

  let fail = false;
  console.log('Elemento                        colore                sfondo                     contrasto');
  console.log('-'.repeat(104));
  for (const r of report) {
    if (r.missing) {
      console.log(`${r.name.padEnd(30)} ASSENTE`);
      continue;
    }
    // Soglia WCAG: 4.5:1, oppure 3:1 per testo grande (>=24px, o >=18.66px bold)
    const large = r.fontSize >= 24 || (r.bold && r.fontSize >= 18.66);
    const min = large ? 3 : 4.5;
    const ok = r.ratio !== null && r.ratio >= min;
    if (!ok) fail = true;
    console.log(
      `${r.name.padEnd(30)} ${String(r.color).padEnd(20)} ${String(r.bg).padEnd(25)} ${String(r.ratio).padEnd(6)} ${ok ? 'OK' : `ESCO < ${min}:1`}`
    );
  }
  await page.screenshot({ path: 'test-results/suggestions-palette.png' });
  console.log(fail ? '\nESITO: FAIL' : '\nESITO: PASS');
  await browser.close();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[verify] errore:', e);
  await browser.close();
  process.exit(2);
}
