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

test('P16: Uganda senza porti — il Consulente nega, e non esiste alcuna sezione «Sfide»', async ({ page }) => {
  installMockApi(page);
  // Snapshot verificato senza porti: la risposta del Consulente resta ancorata ai fatti.
  await page.route(`**/api/games/${MOCK_GAME_ID}/advisor/context`, route => route.fulfill({ json: {
    reply: 'Presidente, la copertura alimentare è di 0,8 mesi: è il dato che richiede più attenzione.',
    issues: [],
    advisorContext: { verifiedWorldSnapshot: { schemaVersion: 1, gameId: MOCK_GAME_ID, branchId: null, date: '1951-03-01', turn: 3,
      polityId: 'UGA', polityName: 'Uganda',
      geography: { ownedRegions: [{ id: 'UGA', name: 'Uganda', coastal: false, sourceRef: 'world.regions.UGA' }], coastal: false, landlocked: true, borderingPolities: [] },
      infrastructure: { ports: [], airfields: [], railways: [], roads: [], factories: [], constructionSites: [], other: [] },
      facts: { ports: { key: 'ports', label: 'Porti posseduti', value: 'Porti posseduti: nessuno', rawValue: [], source: 'world_map', sourceRef: 'infrastructure.ports' },
        foodCoverageMonths: { key: 'foodCoverageMonths', label: 'Copertura alimentare', value: '0,8 mesi', rawValue: 0.8, source: 'national_economy', sourceRef: 'national_economy.foodCoverageMonths' } },
      changes: { available: false, previousDate: null, previousTurn: null, deltas: [] }, unavailable: [] },
      governmentBrief: 'Presidente, la copertura alimentare è di 0,8 mesi.' },
  } }));
  await page.route(`**/api/games/${MOCK_GAME_ID}/advisor/reality`, route => route.fulfill({ json: {
    reply: 'Presidente, nei dati verificati non risultano porti sotto il nostro controllo: il paese è senza accesso al mare nella mappa corrente. Possiamo valutare approvvigionamento terrestre o accordi di transito.',
    issues: [], advisorContext: { verifiedWorldSnapshot: { facts: {}, infrastructure: { ports: [] } }, governmentBrief: '' },
  } }));
  await reachHud(page);
  await openGovernment(page);

  // Nessuna quest: niente sezione «Sfide», niente card Pressure.
  await expect(page.getByText('Sfide del momento')).toHaveCount(0);
  await expect(page.getByText('PROBLEMI CHE RICHIEDONO DECISIONE')).toHaveCount(0);
  await expect(page.locator('.gov-situation')).toHaveCount(0);

  const input = page.getByRole('textbox', { name: /Interroga il consulente/ });
  await input.fill('Possiamo usare i nostri porti per importare?');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  const reply = page.locator('.advisor-entry.assistant').last();
  await expect(reply).toContainText('non risultano porti', { timeout: 10_000 });
  await expect(reply).not.toContainText('Kampala');
});

test('P17: un ft_port reale è riconosciuto dal Consulente e portato al Consiglio', async ({ page }) => {
  installMockApi(page);
  const issue = {
    id: 'issue-porto-a', title: 'Impiego del Porto A', question: 'Come utilizziamo il Porto A per gli approvvigionamenti?',
    verifiedFacts: [
      { key: 'ports', label: 'Porti posseduti', value: 'Porti posseduti: Porto A (Kampala)', source: 'world_map', sourceRef: 'infrastructure.ports' },
      { key: 'treasury', label: 'Tesoreria', value: '12 mld USD', source: 'national_economy', sourceRef: 'worldState.resources.stock.money' },
    ],
    suggestedMinisters: ['lavori', 'tesoro'], origin: 'advisor',
    sourceRefs: ['infrastructure.ports', 'worldState.resources.stock.money'], createdDate: '1951-03-01',
  };
  await page.route(`**/api/games/${MOCK_GAME_ID}/advisor/context`, route => route.fulfill({ json: {
    reply: 'Presidente, nei dati verificati risulta Porto A: possiamo valutare il suo impiego per gli approvvigionamenti.',
    issues: [issue],
    advisorContext: { verifiedWorldSnapshot: { schemaVersion: 1, gameId: MOCK_GAME_ID, branchId: null, date: '1951-03-01', turn: 3,
      polityId: 'UGA', polityName: 'Uganda',
      geography: { ownedRegions: [{ id: 'UGA', name: 'Uganda', coastal: true, sourceRef: 'world.regions.UGA' }], coastal: true, landlocked: false, borderingPolities: [] },
      infrastructure: { ports: [{ id: 'p1', name: 'Porto A', type: 'ft_port', regionId: 'UGA', regionName: 'Kampala', sourceRef: 'world.regions.UGA.objects.0' }],
        airfields: [], railways: [], roads: [], factories: [], constructionSites: [], other: [] },
      facts: { ports: { key: 'ports', label: 'Porti posseduti', value: 'Porti posseduti: Porto A (Kampala)', rawValue: ['p1'], source: 'world_map', sourceRef: 'infrastructure.ports' } },
      changes: { available: false, previousDate: null, previousTurn: null, deltas: [] }, unavailable: [] },
      governmentBrief: 'Presidente, nei dati verificati risulta Porto A.' },
  } }));

  await reachHud(page);
  await openGovernment(page);
  const opening = page.locator('.advisor-opening');
  await expect(opening).toContainText('Porto A');

  const inline = page.locator('.council-issue-inline').first();
  await expect(inline).toContainText('Porti posseduti: Porto A (Kampala)');
  await inline.locator('.council-issue-open').click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await openBoard(page);
  await expect(page.locator('.council-room-board')).toContainText('Porto A');
  // Nessun menu di opzioni Pressure: la soluzione si costruisce in discussione.
  await expect(page.locator('.council-board-response-options')).toHaveCount(0);
});
