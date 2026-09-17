/**
 * MAP-UI-POLISH — sezione «5. Mappa» del preset editor.
 * =====================================================
 * Verifica reale nel browser (non snapshot) che la rifinitura estetica non
 * introduca regressioni e che i problemi segnalati siano risolti:
 *
 *   1. il radio nativo non è più un «pallone» che domina la card
 *      (nascosto, 1×1px) e la card resta un bersaglio touch ≥ 44px;
 *   2. lo stato selezionato è evidente (bordo accento + spunta visibile);
 *   3. la card espone un badge con il numero di regioni/province;
 *   4. il riepilogo «Mappa attiva» è INTERAMENTE visibile a 360 e 430px e
 *      non coperto dal footer sticky (testo richiesto dal task);
 *   5. nessuno scroll orizzontale nella sezione.
 *
 * La selezione resta quella del codice (radio + label): qui si controlla solo
 * la presentazione e l'assenza di sovrapposizioni.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

const VIEWPORTS = [
  { width: 360, height: 740, label: '360px' },
  { width: 430, height: 932, label: '430px' },
];

async function openMapTab(page) {
  installMockApi(page);
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.btn-studio-toggle').click();
  await page.locator('.template-edit-btn').first().click();
  await expect(page.locator('.preset-editor')).toBeVisible({ timeout: 10_000 });
  await page.locator('.preset-editor-tabs button', { hasText: '5. Mappa' }).click();
  await expect(page.locator('.preset-map-editor')).toBeVisible();
}

/** Geometria reale dei nodi rilevanti, in coordinate viewport. */
function readMapGeometry(page) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const s = [c.r, c.g, c.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
    const contrastOf = (el) => {
      if (!el) return null;
      const fg = parse(getComputedStyle(el).color);
      let node = el; let bg = null;
      while (node) { const b = parse(getComputedStyle(node).backgroundColor); if (b && b.a > 0.5) { bg = b; break; } node = node.parentElement; }
      if (!fg || !bg) return null;
      const l1 = lum(fg), l2 = lum(bg);
      return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    };
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const radio = document.querySelector('.preset-map-base-option input[type="radio"]');
    const radioRect = radio ? radio.getBoundingClientRect() : null;
    const badge = document.querySelector('.preset-map-base-badge');
    const check = document.querySelector('.preset-map-base-option.selected .preset-map-base-check');
    const selectedCard = document.querySelector('.preset-map-base-option.selected');
    const summary = document.querySelector('.preset-map-summary');
    const body = document.querySelector('.preset-editor-body');
    const footer = document.querySelector('.preset-editor-footer');
    return {
      radio: radioRect ? { width: radioRect.width, height: radioRect.height } : null,
      badgeText: badge ? badge.textContent.replace(/\s+/g, ' ').trim() : null,
      checkOpacity: check ? Number(getComputedStyle(check).opacity) : null,
      selectedCard: selectedCard ? { borderColor: getComputedStyle(selectedCard).borderTopColor, background: getComputedStyle(selectedCard).backgroundColor } : null,
      cardHeight: rect('.preset-map-base-option')?.height ?? null,
      // Contrasto reale del testo sulle card navy e dell'intro sul fondo chiaro.
      titleContrast: contrastOf(document.querySelector('.preset-map-base-option .preset-map-base-text strong')),
      subtitleContrast: contrastOf(document.querySelector('.preset-map-base-option .preset-map-base-text small')),
      introContrast: contrastOf(document.querySelector('.preset-map-intro')),
      summary: rect('.preset-map-summary'),
      body: rect('.preset-editor-body'),
      footer: rect('.preset-editor-footer'),
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    };
  });
}

for (const vp of VIEWPORTS) {
  test(`sezione Mappa rifinita e riepilogo visibile @ ${vp.label}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openMapTab(page);

    const g = await readMapGeometry(page);

    // 1. Radio nativo nascosto: la card è il controllo (bersaglio touch ≥ 44px).
    expect(g.radio).not.toBeNull();
    expect(g.radio.width).toBeLessThanOrEqual(2);
    expect(g.radio.height).toBeLessThanOrEqual(2);
    expect(g.cardHeight).toBeGreaterThanOrEqual(44);

    // 2. Stato selezionato evidente: spunta visibile e accento sul bordo.
    expect(g.checkOpacity).toBe(1);
    expect(g.selectedCard.borderColor.toLowerCase()).toContain('156, 135, 237');

    // 3. Badge con il numero di regioni + testo leggibile (contrasto ≥ 4.5).
    expect(g.badgeText).toMatch(/\d+\s*(paesi|province)/i);
    expect(g.titleContrast).toBeGreaterThanOrEqual(4.5);
    expect(g.subtitleContrast).toBeGreaterThanOrEqual(4.5);
    expect(g.introContrast).toBeGreaterThanOrEqual(4.5);

    // 4. Riepilogo «Mappa attiva» interamente visibile e non coperto dal footer.
    expect(g.summary).not.toBeNull();
    expect(g.summary.x).toBeGreaterThanOrEqual(0);
    expect(g.summary.right).toBeLessThanOrEqual(vp.width + 0.5);
    // Porta il riepilogo in vista scorrendo il body della sezione, poi verifica
    // che non finisca sotto il footer sticky.
    await page.locator('.preset-map-summary').scrollIntoViewIfNeeded();
    const after = await readMapGeometry(page);
    const footerTop = after.footer ? after.footer.y : Infinity;
    expect(after.summary.bottom).toBeLessThanOrEqual(footerTop + 0.5);
    expect(after.summary.bottom).toBeLessThanOrEqual(vp.height + 0.5);

    // 5. Nessuno scroll orizzontale.
    expect(g.docScrollWidth).toBeLessThanOrEqual(vp.width + 1);
  });
}
