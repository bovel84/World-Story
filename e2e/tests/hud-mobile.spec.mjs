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

/**
 * BUG 2 — l'ingranaggio ⚙ non apriva il menu su smartphone Android.
 *
 * Il popover `.game-menu-dropdown` è `position: absolute` dentro `.hud-left`,
 * a sua volta dentro `.hud-bar` che a ≤480px aveva `overflow: hidden`: il menu
 * veniva **ritagliato** all'altezza della barra (~54px) e restava invisibile e
 * non cliccabile, pur con `open=true`. Qui non basta `toBeVisible()`
 * (Playwright non considera il clipping degli antenati): si verifica con
 * `elementFromPoint` che la voce sia **davvero** raggiungibile dal dito.
 */
test.describe('BUG 2 — il menu ⚙ è visibile e cliccabile su mobile', () => {
  const MENU_WIDTHS = [360, 393, 412];

  for (const width of MENU_WIDTHS) {
    test(`a ${width}px l'ingranaggio apre il menu con le 4 voci cliccabili`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      await enterGame(page);

      const gear = page.locator('.game-menu-btn');
      await expect(gear).toBeEnabled();
      await expect(gear).toHaveAttribute('aria-expanded', 'false');

      await gear.click();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');
      const dropdown = page.locator('.game-menu-dropdown');
      await expect(dropdown).toBeVisible();
      await expect(page.locator('.game-menu-item')).toHaveCount(4);

      // Il popover non è ritagliato da `.hud-bar`: ogni voce supera l'hit-test.
      const allClickable = await page.evaluate(() => {
        const inside = (x, y) => {
          const el = document.elementFromPoint(x, y);
          return !!(el && el.closest('.game-menu-dropdown'));
        };
        return [...document.querySelectorAll('.game-menu-item')].every((item) => {
          const r = item.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && inside(r.x + r.width / 2, r.y + r.height / 2);
        });
      });
      expect(allClickable, `voci del menu non cliccabili a ${width}px`).toBe(true);

      // Il popover resta dentro lo schermo.
      const box = await dropdown.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

      // Esc chiude.
      await page.keyboard.press('Escape');
      await expect(dropdown).toHaveCount(0);
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('secondo click e click fuori chiudono il menu', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await enterGame(page);
    const gear = page.locator('.game-menu-btn');
    const dropdown = page.locator('.game-menu-dropdown');

    await gear.click();
    await expect(dropdown).toBeVisible();
    await gear.click();
    await expect(dropdown).toHaveCount(0);

    await gear.click();
    await expect(dropdown).toBeVisible();
    await page.mouse.click(20, 320); // tap sulla mappa, lontano dal popover
    await expect(dropdown).toHaveCount(0);
  });

  test('una voce del menu è cliccabile e chiude il popover', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await enterGame(page);
    await page.locator('.game-menu-btn').click();
    const dropdown = page.locator('.game-menu-dropdown');
    await expect(dropdown).toBeVisible();
    await page.locator('.game-menu-item', { hasText: 'Salva' }).click();
    await expect(dropdown).toHaveCount(0);
  });
});
