/** P5: identità della bozza e retry browser. Persistenza provata nei test backend. */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

async function prepare(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await page.locator('.treasury-act-road[data-road="invest"] .treasury-act-prepare').click();
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
}

test('risposta di firma persa: retry con stessa chiave, un solo ordine e registro dal GET autorevole', async ({ page }) => {
  installMockApi(page);
  const posts = [];
  let accepted;
  let pending = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { pendingActions: pending } });
    const key = request.headers()['idempotency-key'];
    const body = request.postDataJSON();
    posts.push({ key, body });
    if (!accepted) {
      accepted = { id: 'accepted-once', text: body.text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: false };
      pending = [accepted];
      return route.abort('failed'); // accettata, ma la risposta non arriva
    }
    expect(key).toBe(posts[0].key); expect(body).toEqual(posts[0].body);
    return route.fulfill({ json: { ...accepted, replayed: true } });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft-state')).toHaveText('preparato');
  await expect(page.locator('.act-draft-text')).toBeDisabled();
  await expect(page.locator('.act-draft > p[role="status"]')).toContainText('senza modificarla');
  expect(posts[0].key).toMatch(/^[\da-f-]{36}$/i);
  await page.locator('.act-draft-sign').click();
  await expect(page.locator('.act-draft-state')).toHaveText('accodato');
  await page.locator('.government-office-back').click();
  await expect(page.locator('.order-register')).toBeVisible();
  await expect(page.locator('.order-register-act')).toHaveCount(1);
  expect(posts).toHaveLength(2);
});

test('replay di ricevuta revocata non aggiunge un fantasma al registro locale', async ({ page }) => {
  installMockApi(page);
  let posts = 0;
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { pendingActions: [] } });
    posts++;
    if (posts === 1) return route.abort('failed'); // ricevuta accettata e poi revocata
    return route.fulfill({ json: { id: 'revoked', text: request.postDataJSON().text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: true } });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts).toBe(2);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft > p[role="status"]')).toContainText('Firma non confermata');
  await expect(page.locator('.government-office-outcome-note')).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('"queued-decision"')))).toBe(false);
  await page.locator('.government-office-back').click();
  await expect(page.locator('.order-register')).toBeVisible();
  await expect(page.locator('.order-register-act')).toHaveCount(0);
});

test('candidato già inviato immutabile: nuova preparazione assegna una nuova identità', async ({ page }) => {
  installMockApi(page);
  const posts = [];
  let pending = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { pendingActions: pending } });
    const body = route.request().postDataJSON();
    posts.push({ key: route.request().headers()['idempotency-key'], body });
    if (posts.length === 1) return route.abort('failed');
    const accepted = { id: 'new-signature', text: body.text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: false };
    pending = [accepted];
    return route.fulfill({ json: accepted });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft-text')).toBeDisabled();
  await page.locator('.act-draft-cancel').click();
  await page.locator('.treasury-act-road[data-road="invest"] .treasury-act-prepare').click();
  await expect(page.locator('.act-draft-text')).toBeEnabled();
  await page.locator('.act-draft-text').fill('Nuova deliberazione distinta');
  await page.locator('.act-draft-sign').click();
  await expect(page.locator('.act-draft-state')).toHaveText('accodato');
  expect(posts).toHaveLength(2); expect(posts[1].key).not.toBe(posts[0].key);
  expect(posts[1].body.text).toBe('Nuova deliberazione distinta');
});
