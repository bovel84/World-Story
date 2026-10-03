import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openCouncilRoom, openGovernment, ask, openBoard, prepareCommonDraft, waitSignEnabled } from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off', video: 'off' });

async function prepareMobileDraft(page) {
  installMockApi(page);
  const minister = `**/api/games/${MOCK_GAME_ID}/government/minister/`;
  await page.route(`${minister}*/opening`, route => route.fulfill({ json: {
    reply: 'Presidente, discutiamo le priorità di bilancio.', seat: 'tesoro',
  } }));
  await page.route(`${minister}*/stream`, route => route.fulfill({ status: 200, contentType: 'text/plain', body:
    'Presidente, propongo una prima tranche con copertura verificata.\n```decision\n{"op":"update-proposal","objective":"Bilancio e piano di riarmo","changes":[{"label":"Prima tranche","value":"700 milioni","source":"minister"}]}\n```',
  }));
  await reachHud(page);
  await openCouncilRoom(page);
  await ask(page, 'Come finanziare il programma di riarmo?');
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Domanda ancora da inviare');
  await openBoard(page);
  await prepareCommonDraft(page);
  await waitSignEnabled(page);
  return page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
}

async function scrollBoardToBottom(sheet) {
  const body = sheet.locator('.gov-sheet-body');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await expect.poll(() => body.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThan(2);
}

async function expectReachableExits(sheet) {
  for (const name of ['Torna al Consiglio', 'Chiudi Governo']) {
    const exit = sheet.getByRole('button', { name, exact: true });
    await expect(exit).toBeVisible();
    await expect(exit).toBeEnabled();
    // A Playwright click can auto-scroll an offscreen control: check geometry
    // and hit testing first, without scrolling the body back to the top.
    await expect(exit).toBeInViewport({ ratio: 1 });
    const bounds = await exit.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThan(180);
    expect(await exit.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
}

test('mobile draft at the bottom: return only closes the board; close Government preserves the room and draft', async ({ page }) => {
  const sheet = await prepareMobileDraft(page);
  const room = page.locator('.council-room');
  const roomId = await room.getAttribute('data-room-id');
  const transcript = await page.locator('.council-room-message, .council-room-event').allTextContents();
  const draftText = await sheet.locator('.act-draft-text-view').innerText();
  await page.keyboard.press('Escape');
  await openBoard(page);
  await scrollBoardToBottom(sheet);
  await expect(sheet.locator('.act-draft-sign')).toBeEnabled();
  await expectReachableExits(sheet);

  await sheet.getByRole('button', { name: 'Torna al Consiglio', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.government-office')).toBeVisible();
  await expect(room).toHaveAttribute('data-room-id', roomId);
  await expect(page.locator('.council-room-board-toggle')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Domanda ancora da inviare');

  await openBoard(page);
  await scrollBoardToBottom(sheet);
  await expectReachableExits(sheet);
  await sheet.getByRole('button', { name: 'Chiudi Governo', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.government-office')).toHaveCount(0);
  await expect(page.locator('.rail-btn[aria-label="Governo"]')).toBeFocused();

  await openGovernment(page);
  await expect(room).toHaveAttribute('data-room-id', roomId);
  expect(await page.locator('.council-room-message, .council-room-event').allTextContents()).toEqual(transcript);
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Domanda ancora da inviare');
  await openBoard(page);
  await expect(sheet.locator('.act-draft-text-view')).toHaveText(draftText);
  await expect(sheet.locator('.act-draft')).toHaveAttribute('data-state', 'prepared');
});

for (const registered of [true, false]) {
  test(`mobile signing ${registered ? 'confirmed' : 'unconfirmed'}: truthful status and both exits remain visible at the bottom`, async ({ page }) => {
    const sheet = await prepareMobileDraft(page);
    if (!registered) {
      await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, route => route.fulfill({ status: 503, json: { error: 'Acknowledgement unavailable' } }));
    }
    await sheet.getByRole('button', { name: 'Firma l’atto', exact: true }).click();
    if (registered) {
      await expect(sheet.locator('.act-draft')).toHaveAttribute('data-state', 'queued');
    } else {
      await expect(sheet.locator('.act-draft')).toContainText('Firma non confermata');
    }
    await scrollBoardToBottom(sheet);
    const status = sheet.getByText('ATTO INSERITO NEL REGISTRO', { exact: true });
    if (registered) {
      await expect(status).toBeInViewport({ ratio: 1 });
      await expect(status).toHaveAttribute('role', 'status');
    } else {
      await expect(status).toHaveCount(0);
    }
    await expectReachableExits(sheet);
    await sheet.getByRole('button', { name: 'Chiudi Governo', exact: true }).click();
    await expect(page.locator('.government-office')).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
  });
}
