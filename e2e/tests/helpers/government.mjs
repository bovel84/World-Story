/**
 * Sala del Consiglio — helper E2E condivisi.
 * ==========================================
 * La UI del Governo è stata riprogettata: la seduta è una riunione condivisa
 * (`.council-room`), la Tavola è un pannello a scomparsa (drawer su desktop,
 * bottom sheet full-screen su mobile) e l'atto nasce dalla bozza comune.
 *
 * Questi helper centralizzano il percorso, così le spec restano leggibili e il
 * contratto della UI vive in un solo posto. Non sono una spec: il nome non
 * corrisponde al `testMatch` di Playwright.
 */
import { expect } from 'playwright/test';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso dello smoke test). */
export async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Apre l'Ufficio del Governo (schermata di scelta: registro + ministri). */
export async function openGovernment(page) {
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const office = page.locator('.government-office');
  await expect(office).toBeVisible({ timeout: 10_000 });
  return office;
}

/** Apre una seduta scegliendo la sedia per `data-seat`. */
export async function openCouncilRoom(page, seat = 'tesoro') {
  await openGovernment(page);
  await page.locator(`.cabinet-pick[data-seat="${seat}"]`).click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });
  return page.locator('.council-room');
}

/** Apre una seduta scegliendo la sedia per etichetta visibile. */
export async function openCouncilRoomByLabel(page, label) {
  await openGovernment(page);
  await page.locator('.cabinet-pick', { hasText: label }).first().click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });
  return page.locator('.council-room');
}

/** Il composer del Presidente. */
export function composer(page) {
  return page.locator('.council-room-compose');
}

/** Il filo della conversazione condivisa. */
export function thread(page) {
  return page.locator('.council-room-thread');
}

/** Gli interventi **conclusi** dei ministri (esclude il placeholder di streaming). */
export function replies(page) {
  return page.locator('.council-room-message.assistant:not(.council-room-stream)');
}

/** I messaggi del Presidente. */
export function presidentMessages(page) {
  return page.locator('.council-room-message.user');
}

/** Scrive e invia un messaggio; `seat` (opzionale) sceglie il destinatario. */
export async function send(page, text, { seat } = {}) {
  const form = composer(page);
  if (seat) await form.locator('#council-recipient').selectOption(seat);
  await form.locator('textarea').fill(text);
  await form.getByRole('button', { name: 'Invia', exact: true }).click();
}

/** Attende che la seduta non stia più generando (composer di nuovo attivo). */
export async function waitIdle(page) {
  await expect(composer(page).locator('textarea')).toBeEnabled({ timeout: 20_000 });
}

/** Invia un messaggio e attende **un** intervento concluso in più. */
export async function ask(page, text, { seat } = {}) {
  const before = await replies(page).count();
  await send(page, text, { seat });
  await expect(replies(page)).toHaveCount(before + 1, { timeout: 20_000 });
  await waitIdle(page);
}

/** Invia un messaggio e attende **n** interventi conclusi in più. */
export async function askRound(page, text, { seat, replies: expected = 1 } = {}) {
  const before = await replies(page).count();
  await send(page, text, { seat });
  await expect(replies(page)).toHaveCount(before + expected, { timeout: 20_000 });
  await waitIdle(page);
}

/** Interrompe la generazione in corso. */
export async function interrupt(page) {
  await composer(page).getByRole('button', { name: 'Interrompi', exact: true }).click();
  await waitIdle(page);
}

/** Apre la Tavola (drawer su desktop, bottom sheet su mobile). */
export async function openBoard(page) {
  await page.locator('.council-room-board-toggle').click();
  await expect(page.locator('.council-room-board')).toBeVisible({ timeout: 10_000 });
  return page.locator('.council-room-board');
}

/** Chiude la Tavola riportando il focus al pulsante che l'ha aperta. */
export async function closeBoard(page) {
  if (await page.locator('.council-room-drawer-close').count()) {
    await page.locator('.council-room-drawer-close').click();
  } else {
    await page.locator('.council-room-board-toggle').click();
  }
  await expect(page.locator('.council-room-board')).toHaveCount(0);
}

/** La Tavola è aperta? (drawer desktop o sheet mobile). */
export async function boardIsOpen(page) {
  return (await page.locator('.council-room-board').count()) > 0;
}

/** Le misure della proposta corrente. */
export function measures(page) {
  return page.locator('.council-board-measure');
}

/**
 * Convocazione esplicita: apre il foglio «Convoca», sceglie la sedia e attende
 * che entri davvero (un suo intervento concluso in più, oppure l'evento di
 * ingresso). Il convocato parla per primo, poi i colleghi rispondono.
 */
export async function convene(page, seat) {
  const before = await replies(page).count();
  await page.locator('.council-room-convene').click();
  const sheet = page.locator('.gov-sheet:has(#council-convene-title)');
  await expect(sheet).toBeVisible();
  await sheet.locator('.gov-sheet-item', { hasText: seatLabel(seat) }).click();
  await expect(page.locator(`.council-room-chip[data-seat="${seat}"]`)).toBeVisible({ timeout: 10_000 });
  // Il giro di convocazione: parla il convocato + i colleghi già presenti.
  await expect.poll(() => replies(page).count(), { timeout: 25_000 }).toBeGreaterThan(before);
  await waitIdle(page);
}

/** Convoca da un invito in linea (proposto da un ministro). */
export async function conveneFromInvitation(page, seat) {
  await page.locator('.council-room-invitation button', { hasText: seatLabel(seat) }).first().click();
  await expect(page.locator(`.council-room-chip[data-seat="${seat}"]`)).toBeVisible({ timeout: 10_000 });
  await waitIdle(page);
}

/** Dalla Tavola: «Prepara bozza comune» → la bozza d'atto comune. */
export async function prepareCommonDraft(page) {
  await page.locator('.council-board-prepare').click();
  await expect(page.locator('.act-draft')).toBeVisible({ timeout: 25_000 });
  await waitIdle(page);
  return page.locator('.act-draft');
}

/** Attende che la firma sia possibile (verifica del motore conclusa e capace). */
export async function waitSignEnabled(page) {
  await expect(page.locator('.act-draft-sign')).toBeEnabled({ timeout: 20_000 });
}

/** Firma la bozza e attende lo stato reale «accodato». */
export async function sign(page) {
  await waitSignEnabled(page);
  await page.locator('.act-draft-sign').click();
  await expect(page.locator('.act-draft-state')).toHaveText('accodato', { timeout: 15_000 });
}

/** Torna dall'Ufficio alla scelta dei ministri. */
export async function backToPicker(page) {
  await page.locator('.council-room-back').click();
  await expect(page.locator('.council-room')).toHaveCount(0);
}

/** Le chip dei partecipanti. */
export async function participants(page) {
  return page.locator('.council-room-chip').evaluateAll(nodes => nodes.map(n => n.dataset.seat));
}

/** Il testo visibile del filo (senza i blocchi tecnici). */
export async function threadText(page) {
  return thread(page).innerText();
}

const SEAT_LABELS = {
  tesoro: 'Ministro del Tesoro',
  lavori: 'Ministro dei Lavori',
  istruzione: 'Ministro dell’Istruzione',
  sanita: 'Ministro della Sanità',
  esteri: 'Ministro degli Esteri',
  interno: 'Ministro dell’Interno',
  guerra: 'Ministro della Guerra',
};

export function seatLabel(seat) {
  return SEAT_LABELS[seat] ?? seat;
}
