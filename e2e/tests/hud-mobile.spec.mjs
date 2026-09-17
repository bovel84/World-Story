/**
 * HOTFIX HUD mobile — il badge del turno non deve essere coperto.
 * =============================================================
 * Regressione del bug segnalato: su mobile le tre icone di sinistra
 * (menu ☰, dispacci, impostazioni ⚙) uscivano dalla loro colonna e il
 * pulsante impostazioni finiva sopra il badge «TURNO N».
 *
 * Il test non usa snapshot: misura i rettangoli reali nel browser e
 * verifica che nessun controllo dell'HUD si sovrapponga al badge del turno
 * e che ogni controllo resti dentro la barra (quindi cliccabile).
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

const MOBILE_WIDTHS = [360, 393, 412, 430];

async function enterGame(page) {
  installMockApi(page);
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Rettangoli dei controlli direttamente figli di left/center/right. */
function readHudBoxes(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width };
    };
    return {
      bar: box(document.querySelector('.hud-bar')),
      center: [...document.querySelectorAll('.hud-center > *')].filter((e) => e.getBoundingClientRect().width > 0).map(box),
      left: [...document.querySelectorAll('.hud-left > *')].filter((e) => e.getBoundingClientRect().width > 0).map(box),
      right: [...document.querySelectorAll('.hud-right > *')].filter((e) => e.getBoundingClientRect().width > 0).map(box),
    };
  });
}

const overlaps = (a, b) => a.right > b.x + 1 && b.right > a.x + 1;

test.describe('Hotfix HUD mobile — badge del turno libero', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`a ${width}px il badge del turno è visibile e nessun controllo lo copre`, async ({ page }) => {
      await page.setViewportSize({ width, height: 915 });
      await enterGame(page);

      const badge = page.locator('.hud-turn-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(/TURNO\s+\d+/);

      const boxes = await readHudBoxes(page);
      const badgeBoxes = boxes.center.filter((b) => /hud-turn-badge/.test(b.cls));
      expect(badgeBoxes).toHaveLength(1);
      const badgeBox = badgeBoxes[0];

      for (const control of [...boxes.left, ...boxes.right]) {
        expect(overlaps(control, badgeBox), `«${control.cls}» copre il badge a ${width}px`).toBe(false);
      }

      // Ogni controllo resta dentro la barra: nessun overlay che ruba i tap.
      for (const control of [...boxes.left, ...boxes.right, badgeBox]) {
        expect(control.x, `«${control.cls}» esce a sinistra a ${width}px`).toBeGreaterThanOrEqual(boxes.bar.x - 1);
        expect(control.right, `«${control.cls}» esce a destra a ${width}px`).toBeLessThanOrEqual(boxes.bar.right + 1);
      }
    });
  }
});
