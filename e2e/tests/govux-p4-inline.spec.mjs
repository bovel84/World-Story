/**
 * WS-GOVUX-P4 — L'evidenza in linea nella Sala del Consiglio (E2E mirato, mobile)
 * ==============================================================================
 * Verifica, offline e con API mockate, lo stesso intento del P0 sulla nuova UI
 * della seduta condivisa (niente più macchina a tab, niente badge novità):
 *  - un intervento del ministro può chiedere un **blocco del motore**: la
 *    risposta «spesa» produce un riferimento in linea sotto il messaggio;
 *  - il riferimento punta al **blocco reale** della Tavola (stesso titolo, stesso
 *    `data-block-id`), non a un secondo grafico;
 *  - il blocco strutturato (`tavola`/`op`) **non è mai prosa visibile**;
 *  - il clic sul riferimento apre la Tavola e mette a fuoco il blocco reale;
 *  - su telefono (390×844) la Tavola è un **bottom sheet a tutta pagina**;
 *  - il **testo in composizione** non si perde aprendo e chiudendo la Tavola.
 *
 * Il badge «novità» e la macchina a tab mobile non esistono più: l'intento
 * residuo (una nuova evidenza) è coperto dal fatto che ogni riferimento risolto
 * apre il proprio blocco; la regola del pallino non è più rappresentabile e non
 * viene asserita. Gira a 390×844. Gli screenshot restano il reperto di fase.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, composer, thread, ask,
} from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('P4: il riferimento in linea apre la Tavola sul blocco reale e conserva la bozza', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  // Il saluto del relatore è il primo intervento concluso del filo.
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');

  // [1] «Mi mostri dove va la spesa?» → il ministro chiede un blocco del motore:
  //     il riferimento compare SOTTO il messaggio, con lo stesso titolo del
  //     blocco reale sulla Tavola (il grafico del bilancio).
  await ask(page, 'Mi mostri dove va la spesa?');
  const link = page.locator('.council-room-message.assistant .council-room-evidence-link').last();
  await expect(link).toBeVisible();
  await expect(link).toContainText('Apri');
  await expect(link).toContainText('sulla Tavola');
  await expect(link).toContainText('Dove va il denaro');

  // [2] Il blocco `tavola` non è mai prosa visibile nel filo.
  await expect(thread(page)).not.toContainText('```');
  await expect(thread(page)).not.toContainText('"op"');

  // [3] Lasciamo una bozza nel compositore: non deve perdersi con la Tavola.
  await composer(page).locator('textarea').fill('bozza non inviata');

  // [4] Il clic sul riferimento apre la Tavola e mette a fuoco il blocco reale.
  await link.click();
  const board = page.locator('.council-room-board');
  await expect(board).toBeVisible();
  // Su telefono la Tavola è un bottom sheet a tutta pagina.
  const sheet = page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds.width).toBe(390);
  expect(bounds.height).toBeGreaterThan(800);

  const block = board.locator('.council-board-focus-evidence [data-block-id="bilancio"]');
  await expect(block).toBeVisible();
  // L'evidenza reale è il grafico del bilancio: il riferimento non ne disegna uno.
  await expect(block.locator('.advisor-chart')).toBeVisible();
  await expect(board.locator('.council-board-focus-evidence h3')).toContainText('Dove va il denaro');

  // [5] Chiuso il foglio (Escape), la bozza nel compositore è ancora lì.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(board).toHaveCount(0);
  await expect(composer(page).locator('textarea')).toHaveValue('bozza non inviata');

  // [6] A desktop la Tavola è un cassetto (drawer), non un foglio.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('.council-room-board-toggle').click();
  await expect(page.locator('.council-room-drawer')).toBeVisible();
  await expect(page.locator('.council-room-board')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true })).toHaveCount(0);
  await expect(page.locator('.council-board-focus-evidence [data-block-id="bilancio"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
});
