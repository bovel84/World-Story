/**
 * WS-GOV-MOBILE-FOCUS — La Sala del Consiglio su telefono e scrivania.
 * ====================================================================
 * La vecchia vista mobile a due stati (`.gov-mobile-*`) è stata rimossa: la
 * seduta è una **stanza condivisa** (`.council-room`) e la Tavola è un pannello
 * a scomparsa (bottom sheet a tutto viewport su mobile, drawer laterale su
 * desktop). Questa spec migra le garanzie che non devono mai rompersi:
 *  - nessun traboccamento orizzontale a 360/390/412×844 e 844×390;
 *  - un solo scroll owner verticale reale nella stanza (il filo), con il
 *    composer fuori da esso e sempre visibile;
 *  - la Tavola mobile è un bottom sheet `role=dialog` «Tavola del Consiglio»
 *    a tutto viewport, e Escape lo chiude riportando il focus al toggle;
 *  - a desktop (1024/1366×768) la Tavola resta un drawer laterale;
 *  - «↓ Nuovo messaggio» compare quando arriva una risposta mentre si legge
 *    indietro, e il tocco riporta in fondo nascondendo il badge;
 *  - il foglio «+ Convoca» si apre e si chiude con Escape (e convoca davvero);
 *  - l'identità: due sedute aperte per la stessa sedia hanno `data-room-id`
 *    distinto (gli id degli inviti non sono esposti nel DOM).
 *
 * Contratto: docs/implementation/WS-COUNCIL-ROOM-e2e-contract.md
 * Riferimento verde: tests/council-room.spec.mjs («mobile board is a full-screen
 * bottom sheet, Escape returns to the preserved chat»).
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, composer, send, waitIdle,
  openBoard, closeBoard, convene, seatLabel,
} from './helpers/government.mjs';

/** Telefono in verticale e in orizzontale: presentazione compatta. */
const COMPACT_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 844, height: 390 },
];
/** Scrivania: la stanza resta dialogo|tavola, la Tavola è un drawer. */
const DESKTOP_VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
];

/** Overflow orizzontale reale del documento e della stanza. */
async function measureHorizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const room = document.querySelector('.council-room');
    return {
      document: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth },
      room: room ? { scrollWidth: room.scrollWidth, clientWidth: room.clientWidth } : null,
    };
  });
}

/** Asserisce che né il documento né la stanza trabocchino a destra. */
async function expectNoHorizontalOverflow(page) {
  const measured = await measureHorizontalOverflow(page);
  expect(measured.document.scrollWidth, `documento ${measured.document.scrollWidth} > ${measured.document.clientWidth}`)
    .toBeLessThanOrEqual(measured.document.clientWidth + 1);
  if (measured.room) {
    expect(measured.room.scrollWidth, `stanza ${measured.room.scrollWidth} > ${measured.room.clientWidth}`)
      .toBeLessThanOrEqual(measured.room.clientWidth + 1);
  }
}

/** Raggiunge l'HUD e apre una seduta (la sedia è il relatore). */
async function openRoom(page, seat = 'lavori') {
  await reachHud(page);
  return openCouncilRoom(page, seat);
}

/** Riempe il filo finché non scorre davvero. */
async function fillThread(page, count = 10) {
  for (let index = 0; index < count; index += 1) {
    await send(page, `Aggiornamento ${index}: come procediamo sulla questione?`);
    await waitIdle(page);
  }
}

for (const viewport of COMPACT_VIEWPORTS) {
  test(`compatto ${viewport.width}×${viewport.height}: niente traboccamento orizzontale e composer visibile`, async ({ page }) => {
    await page.setViewportSize(viewport);
    installMockApi(page);
    await openRoom(page);

    // Presentazione compatta: la stanza c'è, il divisore desktop no.
    await expect(page.locator('.council-room')).toBeVisible();
    await expect(page.locator('.government-office-divider')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Il composer resta visibile e dentro il viewport.
    const compose = composer(page);
    await expect(compose).toBeVisible();
    const box = await compose.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });
}

test('390px: un solo scroll owner verticale (il filo) e il composer ne è fuori', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await openRoom(page);
  await fillThread(page, 10);

  // Il filo scorre davvero.
  const thread = page.locator('.council-room-thread');
  const metrics = await thread.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 1);

  // Il composer è visibile e fuori dal contenuto che scorre.
  const compose = composer(page);
  await expect(compose).toBeVisible();
  const composeBox = await compose.boundingBox();
  expect(composeBox.y + composeBox.height).toBeLessThanOrEqual(845);
  const composerOutsideThread = await page.evaluate(() => {
    const threadEl = document.querySelector('.council-room-thread');
    const composeEl = document.querySelector('.council-room-compose');
    return Boolean(threadEl && composeEl) && !threadEl.contains(composeEl);
  });
  expect(composerOutsideThread).toBe(true);

  // Un solo scroll verticale reale nella stanza: proprio il filo.
  const scrollers = await page.evaluate(() => {
    const room = document.querySelector('.council-room');
    return [room, ...room.querySelectorAll('*')].filter(el => {
      const style = getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    }).map(el => `${el.tagName.toLowerCase()}.${el.className || ''}`);
  });
  expect(scrollers).toHaveLength(1);
  expect(scrollers[0]).toContain('council-room-thread');
  await expectNoHorizontalOverflow(page);
});

test('390px: la Tavola è un bottom sheet a tutto viewport; Escape chiude e riporta il focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await openRoom(page);

  const toggle = page.locator('.council-room-board-toggle');
  await openBoard(page);
  const sheet = page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds.width).toBe(390);
  expect(bounds.height).toBeGreaterThan(800);
  // Su mobile non deve esistere il drawer laterale desktop.
  await expect(page.locator('.council-room-drawer')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`desktop ${viewport.width}×${viewport.height}: la Tavola è un drawer laterale, non un foglio`, async ({ page }) => {
    await page.setViewportSize(viewport);
    installMockApi(page);
    await openRoom(page);

    await openBoard(page);
    await expect(page.locator('.council-room-drawer')).toBeVisible();
    await expect(page.locator('.council-room-board')).toBeVisible();
    // Niente bottom sheet a tutto viewport sulla scrivania.
    await expect(page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await closeBoard(page);
    await expect(page.locator('.council-room-board')).toHaveCount(0);
  });
}

test('390px: «↓ Nuovo messaggio» compare leggendo indietro e riporta in fondo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await openRoom(page);
  await fillThread(page, 10);

  // Il giocatore risale la cronologia: un vero evento di scroll disattiva
  // l'autoscroll, così la risposta in arrivo non lo trascina giù.
  const thread = page.locator('.council-room-thread');
  await thread.hover();
  await page.mouse.wheel(0, -20_000);
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(1);

  await send(page, 'Questa risposta deve arrivare mentre sto leggendo indietro.');
  await waitIdle(page);

  const unread = page.locator('.council-room-unread');
  await expect(unread).toBeVisible({ timeout: 15_000 });
  await expect(unread).toHaveText('↓ Nuovo messaggio');
  await expect(composer(page)).toBeVisible();

  // Il tocco riporta in fondo e il badge sparisce.
  await unread.click();
  await expect(unread).toHaveCount(0);
  await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(48);
  await expect(composer(page)).toBeVisible();
});

test('390px: il foglio «+ Convoca» si apre, si chiude con Escape e convoca davvero', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await openRoom(page, 'lavori');

  // Il foglio si apre e si chiude con Escape.
  await page.locator('.council-room-convene').click();
  const sheet = page.getByRole('dialog', { name: 'Convoca un ministro', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.gov-sheet-item', { hasText: seatLabel('tesoro') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.council-room-convene')).toBeVisible();

  // Il percorso reale di convocazione resta quello dell'helper.
  await convene(page, 'tesoro');
  await expect(page.locator('.council-room-chip[data-seat="tesoro"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('identità: due sedute aperte per la stessa sedia hanno data-room-id distinto', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  installMockApi(page);
  await reachHud(page);
  await openCouncilRoom(page, 'lavori');

  const firstRoom = page.locator('.council-room');
  const firstId = await firstRoom.getAttribute('data-room-id');
  expect(firstId).toBeTruthy();

  // Torna alla scelta e riapre la stessa sedia: deve nascere una nuova seduta,
  // non riprendere quella lasciata.
  await page.locator('.council-room-back').click();
  await expect(page.locator('.council-room')).toHaveCount(0);
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });

  const secondId = await page.locator('.council-room').getAttribute('data-room-id');
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);

  await expectNoHorizontalOverflow(page);
});
