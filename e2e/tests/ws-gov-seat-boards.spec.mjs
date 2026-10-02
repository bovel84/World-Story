/**
 * WS-GOV-SEAT-BOARDS — La Tavola è del Governo, non del Tesoro (E2E)
 * ==================================================================
 * Il criterio di successo del task, end-to-end e con API mockate:
 *  1. ogni ministro ha la **sua** Tavola, contestuale alla sua competenza (i
 *     Lavori non mostrano la tavola del Tesoro);
 *  2. una proposta del singolo ministro si **promuove** al Consiglio senza
 *     duplicazione;
 *  3. la **Tavola comune** aggrega le contribuzioni delle sedie convocate, e si
 *     aggiorna leggendo il workspace vivo (nessuna copia).
 *
 * Flusso: Lavori → fabbrica → Sarajevo → «Convoca il Tesoro» → Tavola comune.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

const SHOT = '../docs/implementation/assets/ws-gov-seat-boards/390x844-council-tavola.png';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Invia un messaggio al ministro e aspetta la risposta conclusa. */
async function ask(page, chat, text) {
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
}

test('WS-GOV-SEAT-BOARDS: i Lavori costruiscono la loro proposta, convocano il Tesoro, e la Tavola comune aggrega', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);

  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const ufficio = page.locator('.government-office');
  await ufficio.locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();

  const chat = page.locator('.government-office-pane-chat');
  const tavola = page.locator('.government-office-pane-table');
  const board = tavola.locator('.decision-board');

  // [1] La Tavola è quella dei Lavori, non del Tesoro: titolo, obiettivo e
  //     sezioni di competenza; nessun blocco finanziario del Tesoro.
  await ask(page, chat, 'Voglio costruire una fabbrica siderurgica.');
  await expect(board).toBeVisible();
  await expect(board).toContainText('La tavola dei Lavori');
  await expect(board).toContainText('Obiettivo dell’opera');
  await expect(board).toContainText('Costruire una fabbrica siderurgica');
  await expect(board).toContainText('Opera');
  await expect(board).toContainText('Fabbrica siderurgica');
  await expect(board).not.toContainText('La tavola del Tesoro');

  // [2] La localizzazione: la decisione dei Lavori si specializza.
  await ask(page, chat, 'A Sarajevo.');
  await expect(board).toContainText('Regione');
  await expect(board).toContainText('Sarajevo');

  // [3] B26 — «Convoca il Tesoro»: la proposta si promuove al Consiglio e si
  //     apre la seduta del Tesoro, senza duplicare nulla.
  await board.locator('.decision-convene').click();
  await expect(page.locator('.minister-session-name')).toContainText('Ministro del Tesoro');
  const council = tavola.locator('.council-board');
  await expect(council).toBeVisible();
  await expect(council).toContainText('Il Consiglio');
  const lavori = council.locator('.council-contribution[data-seat="lavori"]');
  const tesoro = council.locator('.council-contribution[data-seat="tesoro"]');
  await expect(lavori).toContainText('Fabbrica siderurgica');
  await expect(lavori).toContainText('Sarajevo');
  await expect(tesoro).toContainText('Nessuna misura ancora portata');

  // [4] Il Tesoro aggiunge la sua parte: la Tavola comune si aggiorna leggendo
  //     il workspace vivo (la promozione non era una copia congelata).
  await ask(page, chat, 'Qual è la copertura finanziaria?');
  await expect(tesoro).toContainText('Copertura finanziaria');
  await expect(tesoro).toContainText('2,00 mld');
  await expect(council).toContainText('pronta per l’atto');
  // Il piano comune resta quello promosso dai Lavori.
  await expect(council).toContainText('Costruire una fabbrica siderurgica');

  // [5] Reperto mobile: la Tavola comune a 390×844.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await expect(page.locator('.gov-mobile-board-title')).toBeVisible();
  await page.screenshot({ path: SHOT, fullPage: true });
});
