/**
 * WS-GAME-OPENING §27 — BUG: la pagina Governo non scorre fino in fondo.
 * ======================================================================
 * Causa reale: su mobile il modale full-screen `.government-office` era
 * `overflow: hidden`; la schermata di scelta (registro + ministri) non ha un
 * inner scroll owner, quindi con un gabinetto completo l'ultimo ministro
 * restava irraggiungibile. Fix minimal: `overflow-y: auto` sul modale mobile,
 * un solo scroll owner (la seduta usa già `.gov-mobile-scroll`).
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_CABINET_MULTI } from '../mock-api.mjs';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.locator('.game-shell').waitFor({ state: 'visible', timeout: 20_000 });
}

for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`la pagina Governo scorre fino all'ultimo ministro a ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    installMockApi(page, { cabinet: MOCK_CABINET_MULTI });
    await reachHud(page);
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const office = page.locator('.government-office');
    await expect(office).toBeVisible({ timeout: 10_000 });

    // Un solo scroll owner: il modale (la scelta non ha `.gov-mobile-scroll`).
    const owner = await office.evaluate(el => getComputedStyle(el).overflowY);
    expect(['auto', 'scroll']).toContain(owner);

    await office.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const lastPick = page.locator('.cabinet-picks .cabinet-pick').last();
    await expect(lastPick).toBeVisible();

    // L'ultimo ministro è davvero dentro il viewport…
    const inViewport = await lastPick.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight + 1;
    });
    expect(inViewport).toBe(true);

    // …e non è coperto: il centro è il target reale del puntatore.
    const box = await lastPick.boundingBox();
    expect(box).not.toBeNull();
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.cabinet-pick') !== null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toBe(true);
  });
}
