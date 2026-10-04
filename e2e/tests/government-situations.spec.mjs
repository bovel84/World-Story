/**
 * WS-GOV-REALITY-ADVISOR — Il Consulente legge la realtà, non genera quest.
 * ==================================================================
 * Desktop 1440×900: il giocatore chiede al Consulente; la risposta arriva con
 * il quadro verificato e una questione con fatti canonici. [Approfondisci]
 * entra nel contesto della questione; [Porta al Consiglio] apre la seduta.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment, openBoard } from './helpers/government.mjs';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' });

test('il Consulente propone la questione con fatti verificati e la porta al Consiglio', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openGovernment(page);

  // Il quadro verificato è la prima voce del Consulente.
  const opening = page.locator('.advisor-opening');
  await expect(opening).toContainText('0,8 mesi');
  await expect(opening).not.toContainText('sfida');

  // Approfondisci: la questione entra nel contesto della conversazione.
  await page.getByRole('button', { name: /Approfondisci/ }).click();
  await expect(page.locator('.advisor-focus')).toContainText('Approvvigionamento alimentare');

  // Domanda al Consulente: la risposta resta ancorata ai dati verificati.
  const input = page.getByRole('textbox', { name: /Interroga il consulente/ });
  await input.fill('Possiamo ampliare i nostri porti?');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  const reply = page.locator('.advisor-entry.assistant').last();
  await expect(reply).toBeVisible({ timeout: 10_000 });

  // La questione proposta resta portabile al Consiglio.
  const issue = page.locator('.council-issue-inline').first();
  await issue.locator('.council-issue-open').click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Approvvigionamento alimentare');
  await openBoard(page);
  const board = page.locator('.council-room-board');
  await expect(board).toContainText('Tesoreria: 12 mld USD');
  // Nessuna opzione Pressure: i ministri costruiscono la soluzione in libera discussione.
  await expect(board.locator('.council-board-response-options')).toHaveCount(0);
});
