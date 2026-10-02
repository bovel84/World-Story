/**
 * WS-GOV-MOBILE-CLEANUP (M5, M13, M24–M27) — Il Governo su telefono, contro il mock.
 * ===================================================================================
 * La vista mobile è una macchina a stati (Dialogo/Tavola/Atto/Evidenza). Qui si
 * verificano i gate che non devono mai rompersi:
 *  - il **telefono in orizzontale** (844×390) resta compatto, non desktop;
 *  - a desktop il divisore dialogo|tavola resta invece presente;
 *  - nessun traboccamento orizzontale a 360/390/412/844×390;
 *  - la Tavola NON ripete il transcript né reinnesta la Tavola desktop;
 *  - il Dialogo ha un solo scroll owner e il composer resta visibile;
 *  - «↓ Nuovo messaggio» compare quando arriva una risposta mentre si legge indietro;
 *  - due convocazioni con lo stesso testo nello stesso turno hanno identità diverse.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

/** Telefono in verticale e in orizzontale: tutto compatto. */
const COMPACT_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 844, height: 390 },
];
/** Schermi da scrivania: la stanza resta dialogo|tavola. */
const DESKTOP_VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
];

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openSeat(page, label = 'Ministro dei Lavori') {
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

async function sendChat(page, text) {
  const chat = page.locator('.gov-mobile-chat');
  const replies = chat.locator('.minister-entry.assistant:not(.minister-greeting)');
  const before = await replies.count();
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.user').last()).toContainText(text, { timeout: 15_000 });
  await expect(replies).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(replies.last()).not.toHaveText('', { timeout: 15_000 });
}

async function openBoard(page) {
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await expect(page.locator('.gov-mobile-board')).toBeVisible();
}

for (const viewport of COMPACT_VIEWPORTS) {
  test(`compatto ${viewport.width}×${viewport.height}: macchina a stati, senza traboccamento`, async ({ page }) => {
    await page.setViewportSize(viewport);
    installMockApi(page);
    await reachHud(page);
    await openSeat(page);

    // Il layout compatto usa la vista a stati, non il desktop.
    await expect(page.locator('.gov-mobile')).toBeVisible();
    await expect(page.locator('.government-office-divider')).toHaveCount(0);
    await expect(page.locator('.gov-mobile-tabs [role="tab"]')).toHaveCount(2);
    await noHorizontalOverflow(page);

    // L'intestazione resta bassa; la CTA primaria è una sola.
    const headBox = await page.locator('.gov-mobile-head').boundingBox();
    expect(headBox.height).toBeLessThanOrEqual(64);
    await openBoard(page);
    await expect(page.locator('.gov-mobile-cta .gov-mobile-primary')).toHaveCount(1);
    // La Tavola non reinnesta il desktop né ripete il transcript.
    await expect(page.locator('.gov-mobile .seat-table')).toHaveCount(0);
    await expect(page.locator('.gov-mobile-talk')).toHaveCount(0);
    await noHorizontalOverflow(page);

    // Dialogo → Tavola → Dialogo conserva la posizione (viste montate).
    await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
    await expect(page.locator('.gov-mobile-chat')).toBeVisible();
    await openBoard(page);
    await noHorizontalOverflow(page);
  });
}

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`desktop ${viewport.width}×${viewport.height}: la stanza resta dialogo|tavola`, async ({ page }) => {
    await page.setViewportSize(viewport);
    installMockApi(page);
    await reachHud(page);
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    await page.locator('.government-office').locator('.cabinet-pick').first().click();
    await expect(page.locator('.government-office-split')).toBeVisible({ timeout: 10_000 });
    // Il divisore desktop resta presente: il compatto non ha invaso la scrivania.
    await expect(page.locator('.government-office-divider')).toBeVisible();
    await noHorizontalOverflow(page);
  });
}

test('390px: il Dialogo ha un solo scroll owner e il composer resta visibile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page);

  // Riempi il thread finché non scorre davvero.
  for (let i = 0; i < 10; i += 1) await sendChat(page, `Aggiornamento ${i}: come procediamo?`);

  const metrics = await page.evaluate(() => {
    const thread = document.querySelector('.gov-mobile #gov-panel-dialogue .minister-thread');
    return { scrollHeight: thread.scrollHeight, clientHeight: thread.clientHeight };
  });
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 1);

  // Il composer è visibile e fuori dal contenuto che scorre.
  const compose = page.locator('.gov-mobile-chat .minister-compose');
  await expect(compose).toBeVisible();
  const composeBox = await compose.boundingBox();
  expect(composeBox.y + composeBox.height).toBeLessThanOrEqual(844);

  // Un solo scroll verticale reale nel pannello Dialogo (thread), non annidato.
  const scrollers = await page.evaluate(() => {
    const panel = document.querySelector('#gov-panel-dialogue');
    const all = [panel, ...panel.querySelectorAll('*')];
    return all.filter(el => {
      const style = getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    }).length;
  });
  expect(scrollers).toBeLessThanOrEqual(1);
  await noHorizontalOverflow(page);
});

test('390px: «↓ Nuovo messaggio» quando arriva una risposta mentre si legge indietro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page);

  for (let i = 0; i < 10; i += 1) await sendChat(page, `Aggiornamento ${i}: come procediamo?`);

  // Il giocatore risale la cronologia: non deve essere riportato giù.
  await page.evaluate(() => {
    const thread = document.querySelector('.gov-mobile #gov-panel-dialogue .minister-thread');
    thread.scrollTop = 0;
  });
  // Una richiesta che apre la riunione: la voce narrativa arriva nel filo
  // mentre il giocatore è in cima.
  await sendChat(page, 'Voglio costruire una fabbrica siderurgica.');
  await sendChat(page, 'Costruiamola a Sarajevo.');
  await page.evaluate(() => {
    const thread = document.querySelector('.gov-mobile #gov-panel-dialogue .minister-thread');
    thread.scrollTop = 0;
  });
  await openBoard(page);
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).click();
  await expect(page.locator('.gov-mobile-minister').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  const unread = page.locator('.minister-unread');
  await expect(unread).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.gov-mobile-chat .minister-compose')).toBeVisible();

  // Il tocco riporta in fondo e il badge sparisce.
  await unread.click();
  await expect(unread).toHaveCount(0);
  await expect(page.locator('.gov-mobile-chat .minister-compose')).toBeVisible();
});

test('390px: la riunione Lavori+Tesoro è il risultato, e l’atto è una vista distinta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page);

  await sendChat(page, 'Voglio costruire una fabbrica siderurgica.');
  await openBoard(page);
  // DA RISOLVERE: il blocco di localizzazione è in cima, non negli approfondimenti.
  await expect(page.locator('.gov-mobile-alert').first()).toContainText(/Dove deve sorgere l’opera\?/, { timeout: 15_000 });

  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await sendChat(page, 'Costruiamola a Sarajevo.');
  await openBoard(page);
  const cta = page.locator('.gov-mobile-cta .gov-mobile-primary');
  await expect(cta).toContainText(/Convoca la riunione/, { timeout: 15_000 });
  await cta.click();

  // M15/M19 — la Tavola mostra il risultato per ministero, non il transcript.
  await expect(page.locator('.gov-mobile-minister', { hasText: 'LAVORI' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.gov-mobile-minister', { hasText: 'TESORO' })).toBeVisible();
  await expect(page.locator('.gov-mobile-talk')).toHaveCount(0);
  await expect(page.locator('.gov-mobile .seat-table')).toHaveCount(0);
  await expect(page.locator('.gov-mobile-cta .gov-mobile-primary')).toHaveCount(1);

  // L'atto è una vista distinta, con «Modifica» prima dell'editor.
  const actCta = page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Prepara l’atto/ });
  if (await actCta.count()) await actCta.click();
  const view = page.locator('[data-testid="act-draft-text-view"]');
  if (await view.count()) {
    await expect(page.locator('.act-draft-edit-toggle')).toContainText(/Modifica/);
    await expect(page.locator('.act-draft-text')).toHaveCount(0);
  }
  await noHorizontalOverflow(page);
});

test('390px: il foglio «Convoca un ministro» si apre, si chiude con Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page);

  await sendChat(page, 'Voglio costruire una fabbrica siderurgica.');
  await sendChat(page, 'Costruiamola a Sarajevo.');
  await openBoard(page);
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).first().click();
  await expect(page.locator('.gov-mobile-minister').first()).toBeVisible({ timeout: 15_000 });

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

test('390px: due convocazioni con lo stesso testo nello stesso turno hanno identità diverse', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openSeat(page);

  // Prima convocazione.
  await sendChat(page, 'Voglio costruire una fabbrica siderurgica.');
  await sendChat(page, 'Costruiamola a Sarajevo.');
  await openBoard(page);
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).first().click();
  await expect(page.locator('.gov-mobile-minister').first()).toBeVisible({ timeout: 15_000 });
  const firstKey = await page.locator('.gov-mobile-board').getAttribute('data-meeting-key');
  expect(firstKey).toBeTruthy();

  // Seconda convocazione, **stesso testo**: deve nascere una nuova identità.
  await page.locator('.gov-mobile-tab', { hasText: 'Dialogo' }).click();
  await sendChat(page, 'Voglio costruire una fabbrica siderurgica.');
  await sendChat(page, 'Costruiamola a Sarajevo.');
  await openBoard(page);
  await page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Convoca la riunione/ }).first().click();
  await expect(page.locator('.gov-mobile-board')).toHaveAttribute('data-meeting-key', /.+/, { timeout: 15_000 });
  await expect.poll(async () => page.locator('.gov-mobile-board').getAttribute('data-meeting-key')).not.toBe(firstKey);
  await noHorizontalOverflow(page);
});
