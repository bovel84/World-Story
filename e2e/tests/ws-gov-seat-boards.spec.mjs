/**
 * WS-GOV-SEAT-BOARDS — La Tavola è della questione, non di una sedia (E2E)
 * =======================================================================
 * Intento preservato dalla vecchia UI a due pannelli, riproiettato sulla Sala
 * del Consiglio condivisa:
 *  1. la Tavola appartiene alla **QUESTIONE/Consiglio**, non a un singolo
 *     ministro (nessun titolo intestato alla sedia);
 *  2. convocare un'altra sedia la fa entrare nella **stessa** Tavola condivisa
 *     (nessuna copia per sedia);
 *  3. le contribuzioni restano attribuite per sedia (`POSIZIONI`) e la Tavola
 *     comune si aggiorna leggendo lo stato vivo.
 *
 * Flusso: Lavori → fabbrica → Sarajevo → convoca il Tesoro → copertura.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, ask, askRound, openBoard, convene,
} from './helpers/government.mjs';

test('WS-GOV-SEAT-BOARDS: i Lavori costruiscono la proposta, convocano il Tesoro e la Tavola comune aggrega', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openCouncilRoom(page, 'lavori');

  // [1] La Tavola è della questione, non di una sedia: QUESTIONE porta
  //     l'obiettivo dell'opera e la misura dell'opera è nella proposta comune.
  await ask(page, 'Voglio costruire una fabbrica siderurgica.');
  const board = await openBoard(page);
  await expect(board.locator('.council-board-question')).toContainText('Costruire una fabbrica siderurgica');
  const steelworks = board.locator('.council-board-measure', { hasText: 'Fabbrica siderurgica' });
  await expect(steelworks).toHaveCount(1);
  // Il motore etichetta la misura `work`; la Tavola rende la misura con la sua
  // provenienza e il suo stato (il `kind` non è esposto come attributo DOM:
  // l'equivalente più vicino è la riga-misura dell'opera, senza un valore
  // numerico quotato, attribuita al ministro e ancora `proposed`).
  await expect(steelworks).toHaveAttribute('data-source', 'minister');
  await expect(steelworks).toHaveAttribute('data-status', 'proposed');
  await expect(steelworks.locator('.council-board-measure-value')).toHaveText('');
  // Nessun titolo intestato a una sedia: la Tavola non è «dei Lavori» né «del Tesoro».
  await expect(board).not.toContainText('La tavola dei Lavori');
  await expect(board).not.toContainText('La tavola del Tesoro');

  // [2] La localizzazione: la misura della regione si aggiunge alla **stessa**
  //     proposta condivisa, non apre una Tavola separata per sedia.
  await ask(page, 'A Sarajevo.');
  const sarajevo = board.locator('.council-board-measure', { hasText: 'Sarajevo' });
  await expect(sarajevo).toHaveCount(1);

  // [3] Convocazione esplicita del Tesoro (non più il pulsante di promozione
  //     `.decision-convene`): la sedia entra nella seduta e nella Tavola.
  await convene(page, 'tesoro');
  await expect(page.locator('.council-room-chip[data-seat="tesoro"]')).toBeVisible();
  await expect(board.locator('.council-board-position[data-seat="lavori"]')).toBeVisible();
  await expect(board.locator('.council-board-position[data-seat="tesoro"]')).toBeVisible();

  // [4] Il Tesoro aggiunge la sua parte: la Tavola comune si aggiorna leggendo
  //     lo stato vivo, senza duplicare la proposta per sedia. Con più di una
  //     sedia convocata il messaggio apre un giro completo (Tesoro + Lavori):
  //     il contratto prescrive `askRound`.
  await askRound(page, 'Qual è la copertura finanziaria?', { seat: 'tesoro', replies: 2 });
  const coverage = board.locator('.council-board-measure', { hasText: 'Copertura finanziaria' });
  await expect(coverage).toHaveCount(1);
  await expect(coverage).toContainText('2,00 mld');
  // Una sola proposta attiva: le misure dei Lavori e del Tesoro convivono nella
  // stessa PROPOSTA ATTUALE, ciascuna una sola volta (niente copia per sedia).
  await expect(board.locator('.council-board-proposal')).toHaveCount(1);
  await expect(board.locator('.council-board-measure')).toHaveCount(3);
  await expect(board.locator('.council-board-measure', { hasText: 'Fabbrica siderurgica' })).toHaveCount(1);
  // Le posizioni restano attribuite per sedia.
  await expect(board.locator('.council-board-position[data-seat="lavori"]')).toBeVisible();
  await expect(board.locator('.council-board-position[data-seat="tesoro"]')).toBeVisible();

  // [5] A mobile (390×844) la Tavola aperta diventa un bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.locator('.council-board-measure', { hasText: 'Copertura finanziaria' })).toBeVisible();
});
