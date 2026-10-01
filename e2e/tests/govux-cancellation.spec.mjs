/** GOVUX P2 — cancellation at the real browser/API boundary; no backend or LLM. */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const ministerPath = `/api/games/${MOCK_GAME_ID}/government/minister/`;

async function openTreasury(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.minister-chat')).toBeVisible();
}

async function holdStreams(page) {
  installMockApi(page);
  const streams = [];
  const failed = new Set();
  let fallbackPosts = 0;
  page.on('requestfailed', request => {
    if (request.url().includes(ministerPath) && request.url().endsWith('/stream')) failed.add(request);
  });
  // These later routes override the standard mock's stream-404 / POST fallback.
  await page.route(`**${ministerPath}*`, route => {
    fallbackPosts++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'FORBIDDEN fallback answer', seat: 'tesoro' }) });
  });
  await page.route(`**${ministerPath}*/stream`, async route => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const stream = { request: route.request(), release, settled: null };
    streams.push(stream);
    stream.settled = ready.then(async text => {
      // Keep the request pending until the test releases it, including after abort.
      // A canceled request may no longer accept a fulfilled response.
      await route.fulfill({ status: 200, contentType: 'text/plain', body: text }).catch(() => {});
    });
    await stream.settled;
  });
  return { streams, failed, fallbackPosts: () => fallbackPosts };
}

async function sendPending(page, network, text) {
  const count = network.streams.length;
  await page.locator('.minister-compose textarea').fill(text);
  await page.locator('.minister-compose button').click();
  await expect.poll(() => network.streams.length).toBe(count + 1);
  await expect(page.locator('.minister-compose textarea')).toBeDisabled();
  return network.streams[count];
}

async function assertNoCanceledAnswer(page, network) {
  await expect.poll(async () => (await page.locator('.minister-entry.assistant:not(.minister-greeting) .entry-text').allTextContents()).join('\n')).not.toMatch(/FORBIDDEN|STALE|interrott|annullat|non è raggiungibile/i);
  await expect(page.locator('.minister-error')).toHaveCount(0);
  expect(network.fallbackPosts()).toBe(0);
}

test('Interrompi aborts the client request, unlocks the composer and cannot overwrite a new reply', async ({ page }) => {
  const network = await holdStreams(page);
  await openTreasury(page);
  const first = await sendPending(page, network, 'Prima domanda');
  const interrupt = page.getByRole('button', { name: 'Interrompi', exact: true });
  await expect(interrupt).toBeEnabled(); // Input has already been cleared.
  await interrupt.click();
  await expect.poll(() => network.failed.has(first.request)).toBe(true);
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await expect(page.locator('.minister-compose button')).toHaveText('Invia');
  await expect(page.locator('.minister-compose button')).toBeDisabled();

  const second = await sendPending(page, network, 'Seconda domanda');
  first.release('STALE risposta dopo cancellazione');
  await first.settled;
  // Old finally/token/error handlers must not affect the new owned request.
  await expect(interrupt).toBeEnabled();
  await expect(page.locator('.minister-compose textarea')).toBeDisabled();
  second.release('Risposta valida alla seconda domanda.');
  await second.settled;
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await expect(page.locator('.minister-entry.assistant').last()).toContainText('Risposta valida alla seconda domanda.');
  await assertNoCanceledAnswer(page, network);
});

test('leaving a seat and closing the office abort pending requests without contaminating another seat', async ({ page }) => {
  const network = await holdStreams(page);
  await openTreasury(page);
  const treasury = await sendPending(page, network, 'Domanda al Tesoro');
  await page.locator('.government-office-back').click();
  await expect.poll(() => network.failed.has(treasury.request)).toBe(true);
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  const works = await sendPending(page, network, 'Domanda ai Lavori');
  treasury.release('STALE risposta del Tesoro');
  await treasury.settled;
  await expect(page.getByRole('button', { name: 'Interrompi', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.government-office')).toBeHidden();
  await expect.poll(() => network.failed.has(works.request)).toBe(true);
  works.release('STALE risposta dei Lavori');
  await works.settled;

  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await assertNoCanceledAnswer(page, network);
  await page.locator('.government-office-back').click();
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await assertNoCanceledAnswer(page, network);
});
