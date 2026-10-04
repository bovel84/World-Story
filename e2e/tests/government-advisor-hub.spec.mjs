/**
 * WS-GOV-REALITY-ADVISOR — La home del Governo è la porta del Consulente.
 * ================================================================
 * Mobile 390×844: header «Governo ✕» sticky, Consulente in cima con il quadro
 * verificato e le questioni proposte (fatti canonici), roster completo dei
 * sette ministri. NIENTE card «sfida» generata dal motore.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment, openBoard } from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off', video: 'off' });

test('home Governo: quadro verificato, questione del Consulente, roster dei 7, nessuna card sfida', async ({ page }) => {
  installMockApi(page);
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: {
    pressures: [{ id: 'internal:harvest-failure#t3', kind: 'internal', template: 'harvest-failure', title: 'Scorte alimentari in esaurimento', detail: 'Il grano copre meno di un mese.', severity: 3, source: 'Contadini', options: [], status: 'active', createdDate: '1951-03-01', createdTurn: 3, priority: 'critica', highlighted: true }],
    recent: [], foodCoverageMonths: 0.8,
  } }));
  await reachHud(page);
  await openGovernment(page);

  // Header «Governo ✕» sticky e Consulente in cima.
  await expect(page.locator('#government-office-title')).toHaveText('Governo');
  const close = page.getByRole('button', { name: 'Chiudi il Governo', exact: true });
  await expect(close).toBeVisible();
  await expect(page.getByText('IL PRIMO CONSULENTE', { exact: true })).toBeVisible();
  // Il quadro verificato arriva dal server, non dalla cronaca del giocatore.
  await expect(page.locator('.advisor-opening')).toContainText('0,8 mesi');

  // P0 — Nessuna card «sfida»: la realtà passa dal Consulente.
  await expect(page.locator('.gov-situation')).toHaveCount(0);
  await expect(page.getByText('PROBLEMI CHE RICHIEDONO DECISIONE')).toHaveCount(0);
  await expect(page.getByText('OPPORTUNITÀ')).toHaveCount(0);

  // La questione proposta dal Consulente con i SOLI fatti verificati.
  const issue = page.locator('.council-issue-inline');
  await expect(issue).toContainText('Approvvigionamento alimentare');
  await expect(issue).toContainText('Copertura alimentare: 0,8 mesi');
  await expect(issue.locator('.council-issue-open')).toBeVisible();

  // Roster SEMPRE completo dei sette ministri, anche senza questioni.
  await expect(page.locator('.government-roster-seat')).toHaveCount(7);
  await expect(page.locator('.government-roster-seat[data-seat="lavori"]')).toBeVisible();

  // Scorrendo in fondo, la ✕ resta visibile.
  await page.locator('.government-office').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(close).toBeInViewport({ ratio: 1 });

  // Porta al Consiglio: la seduta nasce dalla questione, senza opzioni preconfezionate.
  await issue.locator('.council-issue-open').click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Approvvigionamento alimentare');
  await expect(room.locator('.council-room-chip')).toHaveCount(1);
  await openBoard(page);
  const board = page.locator('.council-room-board');
  await expect(board.locator('.council-board-question')).toContainText('Approvvigionamento alimentare');
  await expect(board).toContainText('Copertura alimentare: 0,8 mesi');
  await expect(board).toContainText('Come garantiamo l’approvvigionamento nei prossimi mesi?');
  await expect(board).toContainText('Origine: Primo Consulente');
  // NIENTE menu di opzioni Pressure in questa seduta.
  await expect(board.getByRole('button', { name: 'Conferma' })).toHaveCount(0);
});
