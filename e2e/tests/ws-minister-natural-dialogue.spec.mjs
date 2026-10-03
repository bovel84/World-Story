/** Un solo giro browser, offline: apertura automatica distinta dalla chat e annullabile. */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const path = `/api/games/${MOCK_GAME_ID}/government/minister/`;
const prose = 'Presidente, l’avanzo c’è. Prima di spenderlo guarderei il debito: io terrei un margine per domani. Vuoi confrontare rimborso e investimenti?';

test('apertura naturale read-only, continuità della chat e cancellazione al cambio sedia', async ({ page }) => {
  installMockApi(page);
  const openings = [];
  const chats = [];
  let releaseWorks;
  const heldWorks = new Promise(resolve => { releaseWorks = resolve; });
  await page.route(`**${path}*/opening`, async route => {
    const seat = new URL(route.request().url()).pathname.split('/').at(-2);
    openings.push(seat);
    if (seat === 'lavori') await heldWorks;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      reply: seat === 'lavori' ? 'STALE intervento dei Lavori' : prose,
      seat, narrativeOnly: true, persistMemory: false, allowDirectives: false,
    }) }).catch(() => {});
  });
  await page.route(`**${path}*/stream`, route => {
    chats.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Valutiamo insieme le coperture.' });
  });
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.minister-greeting')).toContainText(prose);
  expect(openings).toEqual(['tesoro']);
  expect(chats).toHaveLength(0);
  await page.locator('.minister-compose textarea').fill('Confrontiamo le coperture.');
  await page.locator('.minister-compose button').click();
  await expect(page.locator('.minister-entry.assistant').last()).toContainText('Valutiamo insieme le coperture.');
  expect(chats[0].history).toContainEqual({ role: 'assistant', content: prose });
  await page.locator('.government-office-back').click();
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect.poll(() => openings.includes('lavori')).toBe(true);
  await expect(page.getByRole('status', { name: 'Il ministro sta preparando il suo intervento' })).toBeVisible();
  await page.locator('.government-office-back').click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  releaseWorks();
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await expect(page.locator('.minister-thread')).not.toContainText('STALE');
  expect(openings.filter(seat => seat === 'tesoro')).toHaveLength(1);
});
