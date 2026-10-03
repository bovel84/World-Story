import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const path = `**/api/games/${MOCK_GAME_ID}/government/minister/`;
async function openRoom(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.getByRole('heading', { name: 'Seduta del Consiglio', exact: true })).toBeVisible();
}
function setup(page) {
  installMockApi(page);
  const requests = [];
  page.route(`${path}*/opening`, route => route.fulfill({ json: { reply: 'Presidente, discutiamo le priorità di bilancio.', seat: 'tesoro' } }));
  page.route(`${path}*/stream`, route => {
    const body = route.request().postDataJSON();
    const seat = /minister\/([^/]+)\/stream/.exec(route.request().url())[1];
    requests.push({ ...body, seat });
    let reply;
    if (body.council.phase === 'drafting') {
      reply = seat === 'tesoro' ? 'Inseriamo il limite di spesa nella prima clausola.' : 'Il Tesoro ha ragione; pianifichiamo le tranche successive senza impegnarle ora.';
    } else if (seat === 'guerra') {
      reply = 'Tesoro, accetto il limite e tre tranche annuali.\n```consiglio\n{"position":{"status":"support","reason":"Accetto il limite discusso."},"agreements":["Nessuna nuova emissione"],"disagreements":[]}\n```';
    } else {
      reply = 'Presidente, chiederei alla Guerra tempi e fabbisogno.\n```decision\n{"op":"update-proposal","objective":"Bilancio e piano di riarmo","changes":[{"label":"Prima tranche","value":"700 milioni","source":"minister"}]}\n```\n```consiglio\n{"needs_input_from":[{"minister":"guerra","question":"Quali costi e tempi del programma?"}],"position":{"status":"support","reason":"Il limite di spesa protegge gli investimenti."},"agreements":["Nessuna nuova emissione"],"disagreements":[]}\n```';
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });
  return requests;
}
async function discuss(page) {
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Come finanziare il programma di riarmo?');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true })).toBeVisible();
}

test('chat dominates, the board is closed by default and minister admission preserves the shared context', async ({ page }) => {
  const requests = setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRoom(page);
  await expect(page.locator('.council-room-drawer')).toHaveCount(0);
  await discuss(page);
  expect(requests[0].council.participants).toEqual(['tesoro']);
  await page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[1].seat).toBe('guerra');
  expect(requests[1].history.map(m => m.content).join('\n')).toContain('chiederei alla Guerra');
  expect(requests[2].seat).toBe('tesoro');
  expect(requests[2].history.map(m => m.content).join('\n')).toContain('Tesoro, accetto il limite');
  expect(new Set(requests.map(r => r.council.sessionId)).size).toBe(1);
  await expect(page.locator('.council-room-participants')).toContainText('Guerra');
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Bozza della prossima domanda');
  await page.getByRole('button', { name: /Tavola/, exact: false }).click();
  await expect(page.locator('.council-room-drawer')).toBeVisible();
  const chat = await page.locator('.council-room-dialogue').boundingBox();
  const board = await page.locator('.council-room-drawer').boundingBox();
  expect(chat.width / (chat.width + board.width)).toBeGreaterThan(0.60);
  await page.getByRole('button', { name: 'Chiudi la Tavola' }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Bozza della prossima domanda');
  await page.screenshot({ path: '/tmp/world-story-council-desktop.png' });
});

test('common drafting hears both ministers and only signing adds an act to the register', async ({ page }) => {
  const requests = setup(page);
  await openRoom(page);
  await discuss(page);
  await page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invia', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Tavola/ }).click();
  await page.getByRole('button', { name: 'Prepara bozza comune', exact: true }).click();
  await expect(page.locator('.act-draft')).toBeVisible();
  expect(requests.filter(r => r.council.phase === 'drafting').map(r => r.seat)).toEqual(['tesoro', 'guerra']);
  const drafting = requests.filter(r => r.council.phase === 'drafting');
  expect(drafting[1].history.map(m => m.content).join('\n')).toContain('prima clausola');
  await expect(page.locator('.act-draft-text')).toHaveValue(/Proponenti: Ministro del Tesoro, Ministro della Guerra/);
  await expect(page.locator('.act-draft-text')).toHaveValue(/Art\. 1/);
  await page.getByRole('button', { name: 'Firma e inserisci nel registro', exact: true }).click();
  await expect(page.locator('.act-draft')).toHaveAttribute('data-state', 'queued');
});

test('mobile board is a full-screen bottom sheet, Escape returns to the preserved chat', async ({ page }) => {
  setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoom(page);
  await discuss(page);
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Domanda conservata');
  await page.getByRole('button', { name: /Tavola/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds.width).toBe(390);
  expect(bounds.height).toBeGreaterThan(800);
  await page.screenshot({ path: '/tmp/world-story-council-mobile-board.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.government-office')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Domanda conservata');
  await page.screenshot({ path: '/tmp/world-story-council-mobile-chat.png' });
});
