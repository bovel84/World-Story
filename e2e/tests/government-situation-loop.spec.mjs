/**
 * WS-GOV-REALITY-ADVISOR — Il ciclo della questione: report e nessuna risoluzione.
 * ================================================================
 * Desktop 1440×900. I rapporti di verifica degli atti restano (come report,
 * non come «sfide»): «Rapporti verificati → Apri rapporto» apre una seduta di
 * RIFERIMENTO. La firma NON risolve più una Pressure con opzioni preconfezionate.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment, openBoard, ask, prepareCommonDraft, waitSignEnabled, sign } from './helpers/government.mjs';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' });

test('Apri rapporto apre un VERO follow-up con gli outcome reali', async ({ page }) => {
  installMockApi(page);
  const followUp = {
    id: 'follow-up:external:border-incident#t3', pressureId: 'external:border-incident#t3', owner: 'tesoro', dueDate: '1951-03-31', daysLeft: -1,
    label: 'Schieramento al confine: copertura logistica', checks: ['Copertura finanziaria del costo autorizzato'],
    outcome: ['Disavanzo annuo 4,1% del PIL'], origin: { type: 'previous-decision', sourceId: 'external:border-incident#t3' },
  };
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: { pressures: [], recent: [], foodCoverageMonths: 2, followUps: [followUp] } }));
  await page.route(`**/api/games/${MOCK_GAME_ID}/government/minister/*/opening`, route => route.fulfill({ json: {
    reply: 'Presidente, sono passati trenta giorni dallo schieramento: il costo è stato assorbito e il disavanzo annuo è al 4,1% del PIL. Non ripropongo strade: riferisco che cosa è cambiato.',
    seat: 'tesoro',
  } }));

  await reachHud(page);
  await openGovernment(page);
  const reports = page.locator('.government-reports');
  await expect(reports).toContainText('Schieramento al confine: copertura logistica');
  await reports.locator('summary').click();
  await reports.getByRole('button', { name: 'Apri rapporto', exact: true }).click();

  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Rapporto: Schieramento al confine: copertura logistica');
  await expect(room.locator('.council-room-message.assistant').first()).toContainText('4,1% del PIL');
  await openBoard(page);
  const board = page.locator('.council-room-board');
  await expect(board.getByRole('heading', { name: 'RAPPORTO' })).toBeVisible();
  await expect(board).toContainText('Disavanzo annuo 4,1% del PIL');
  await expect(board).toContainText('una decisione precedente');
});

test('la firma registra l\u2019atto nel registro e NON risolve una Pressure', async ({ page }) => {
  installMockApi(page);
  const resolves = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: { pressures: [], recent: [], foodCoverageMonths: 2 } }));
  // La verifica del motore qui non dichiara un'opera: la firma resta possibile
  // e serve a provare che NESSUNA Pressure viene risolta dal frontend.
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/check-feasibility`, route => route.fulfill({ json: {
    feasible: true, costs: { timeDays: 30, inputs: [], upkeep: [], basis: 'none' },
    prerequisites: [], risks: [], warnings: [], summary: 'Fattibile' } }));
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures/*/resolve`, route => {
    resolves.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });

  await reachHud(page);
  await openGovernment(page);
  // Una seduta aperta dal roster: questione libera, senza opzioni del motore.
  await page.locator('.government-roster-seat[data-seat="lavori"]').click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await ask(page, 'Come useresti l\u2019avanzo per i trasporti verso il confine nord?');
  await openBoard(page);
  await prepareCommonDraft(page);
  await waitSignEnabled(page);
  await sign(page);
  // L\u2019atto entra nel registro; NESSUNA chiamata di risoluzione della Pressure.
  await expect(page.locator('#government-office-title')).toBeVisible({ timeout: 10_000 });
  await expect(resolves).toEqual([]);
});
