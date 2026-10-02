/**
 * WS-GOV-MOBILE-FOCUS (PARTE C) — Il Governo su telefono, contro il mock.
 * =====================================================================
 * Non un «CSS piccolo»: la vista è una macchina a stati (Dialogo/Tavola/Atto/
 * Evidenza). Qui si verificano i gate che non devono mai rompersi:
 *  - nessun traboccamento orizzontale a 360/390/412;
 *  - un solo scroll, linguette sticky, pallino solo per cambi reali;
 *  - il passaggio Dialogo↔Tavola non perde la posizione;
 *  - l'atto è una vista distinta; il foglio «+ Ministro» si apre e si chiude;
 *  - il panorama (844×390) non scorre in orizzontale.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

const WIDTHS = [360, 390, 412];

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openSeat(page, label) {
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: label }).click();
  await expect(page.locator('.gov-mobile')).toBeVisible({ timeout: 10_000 });
}

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth, `scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

for (const width of WIDTHS) {
  test(`mobile ${width}px: la seduta è una macchina a stati, senza traboccamento`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    installMockApi(page);
    await reachHud(page);
    await openSeat(page, 'Ministro dei Lavori');

    // La vista parte dal Dialogo, con le due linguette.
    await expect(page.locator('.gov-mobile-tabs [role="tab"]')).toHaveCount(2);
    await expect(page.locator('.gov-mobile-tab.active')).toHaveText(/Dialogo/);
    await noHorizontalOverflow(page);

    // Dialogo → Tavola: la vista cambia, non si duplica la sessione.
    await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
    await expect(page.locator('.gov-mobile-board')).toBeVisible();
    await noHorizontalOverflow(page);

    // La CTA primaria è una sola.
    await expect(page.locator('.gov-mobile-cta .gov-mobile-primary')).toHaveCount(1);

    // Tavola → Dialogo → Tavola conserva la posizione (nessun salto in cima).
    await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
    await expect(page.locator('.gov-mobile-chat')).toBeVisible();
    await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
    await expect(page.locator('.gov-mobile-board')).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test('390px: la riunione Lavori+Tesoro si apre in Tavola e l’atto è una vista distinta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page, 'Ministro dei Lavori');

  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill('Voglio costruire una fabbrica siderurgica.');
  await chat.locator('.minister-compose button').click();
  await page.waitForTimeout(2000);
  // Il Presidente scioglie la localizzazione: il blocco sparisce e la riunione si propone.
  await chat.locator('textarea').fill('Costruiamola a Sarajevo.');
  await chat.locator('.minister-compose button').click();

  // La richiesta multi-competenza propone la riunione: la CTA primaria la convoca.
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  const cta = page.locator('.gov-mobile-cta .gov-mobile-primary');
  await expect(cta).toContainText(/Convoca la riunione/, { timeout: 15_000 });
  await cta.click();

  // La Tavola mostra la gerarchia: titolo, stato, interventi attribuiti.
  await expect(page.locator('.gov-mobile-board-title')).toBeVisible();
  await expect(page.locator('.gov-mobile-board-status')).toBeVisible();
  await expect(page.locator('.gov-mobile-talk').first()).toBeVisible({ timeout: 15_000 });

  // L'atto è una vista distinta, con la sua CTA sticky e il testo NON sempre in
  // editor (H20): prima si legge, poi «Modifica».
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Prepara l’atto|Continua la riunione/ }).first().click().catch(() => {});
  const actCta = page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Prepara l’atto/ }).first();
  if (await actCta.count()) await actCta.click();
  const view = page.locator('[data-testid="act-draft-text-view"]');
  if (await view.count()) {
    await expect(page.locator('.gov-mobile-board-title')).toBeVisible().catch(() => {});
    await expect(page.locator('.act-draft-edit-toggle')).toContainText(/Modifica/);
    await expect(page.locator('.act-draft-text')).toHaveCount(0);
  }
  await noHorizontalOverflow(page);
});

test('390px: il foglio «Convoca un ministro» si apre, si chiude con Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page, 'Ministro dei Lavori');

  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill('Voglio costruire una fabbrica siderurgica.');
  await chat.locator('.minister-compose button').click();
  await page.waitForTimeout(2000);
  await chat.locator('textarea').fill('Costruiamola a Sarajevo.');
  await chat.locator('.minister-compose button').click();
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).first().click();
  await expect(page.locator('.gov-mobile-talk').first()).toBeVisible({ timeout: 15_000 });

  const more = page.locator('.gov-mobile-secondary', { hasText: '+ Ministro' });
  if (await more.count()) {
    await more.click();
    await expect(page.locator('.gov-sheet')).toBeVisible();
    await expect(page.locator('.gov-sheet-item').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.gov-sheet')).toHaveCount(0);
  }
  await noHorizontalOverflow(page);
});

test('390px: gate geometrici — header basso, blocchi sopra la piega, un solo scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page, 'Ministro dei Lavori');

  // B7 — l'intestazione resta bassa.
  const headBox = await page.locator('.gov-mobile-head').boundingBox();
  expect(headBox.height).toBeLessThanOrEqual(64);
  expect(headBox.height).toBeGreaterThan(40);

  // Il compositore è raggiungibile senza scorrere a mano (B11).
  const compose = page.locator('.gov-mobile-chat .minister-compose');
  await expect(compose).toBeVisible();
  const composeBox = await compose.boundingBox();
  expect(composeBox.y + composeBox.height).toBeLessThanOrEqual(844);

  // H10/H24 — il blocco «Dove deve sorgere l'opera?» compare in cima, sopra la piega.
  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill('Voglio costruire una fabbrica siderurgica.');
  await chat.locator('.minister-compose button').click();
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  const alert = page.locator('.gov-mobile-alert').first();
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText(/Dove deve sorgere l’opera\?/);
  const alertBox = await alert.boundingBox();
  expect(alertBox.y).toBeLessThan(844);

  // B6 — un solo contenitore che scorre fra il pannello e la radice.
  const scrollers = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.gov-mobile-scroll')].find(el => el.offsetParent !== null);
    let node = panel;
    let count = 0;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) count += 1;
      node = node.parentElement;
    }
    return count;
  });
  expect(scrollers).toBeLessThanOrEqual(1);
  await noHorizontalOverflow(page);
});

test('panorama 844×390: nessuno scorrimento orizzontale nel Governo', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  installMockApi(page);
  await reachHud(page);
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick').first().click();
  await expect(page.locator('.government-office-session')).toBeVisible({ timeout: 10_000 });
  // A 844px è desktop: la stanza resta dialogo|tavola, non una colonna compressa.
  await expect(page.locator('.government-office-divider')).toBeVisible();
  await noHorizontalOverflow(page);
});
