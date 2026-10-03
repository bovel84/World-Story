/**
 * GOVUX P2 — Cancellazione al confine browser/API reale, senza backend né LLM.
 * ===========================================================================
 * Nella Sala del Consiglio la generazione avviene quando un ministro sta
 * intervenendo. Interrompere deve:
 *  - abortire la richiesta HTTP in volo;
 *  - riabilitare il composer;
 *  - non lasciare che una risposta tardiva si sovrascriva sul filo condiviso;
 *  - non avviare mai un secondo percorso ambiguo (il POST di fallback).
 *
 * Lasciare la seduta o chiudere l'Ufficio interrompe la generazione in corso,
 * senza contaminare un'altra sedia.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, composer, replies, presidentMessages, waitIdle,
} from './helpers/government.mjs';

const ministerPath = `/api/games/${MOCK_GAME_ID}/government/minister/`;

/** Apre la seduta del Tesoro e attende il saluto (fallback su `address.opening`). */
async function openTreasury(page) {
  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
}

/**
 * Tiene in sospeso ogni stream ministeriale e intercetta il POST di fallback:
 * se il client lo chiama, la risposta «FORBIDDEN» finirebbe nel filo.
 */
async function holdStreams(page) {
  installMockApi(page);
  const streams = [];
  const failed = new Set();
  let fallbackPosts = 0;
  page.on('requestfailed', request => {
    if (request.url().includes(ministerPath) && request.url().endsWith('/stream')) failed.add(request);
  });
  await page.route(`**${ministerPath}*`, route => {
    fallbackPosts++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply: 'FORBIDDEN fallback answer', seat: 'tesoro' }),
    });
  });
  await page.route(`**${ministerPath}*/stream`, async route => {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const stream = { request: route.request(), release, settled: null };
    streams.push(stream);
    stream.settled = ready.then(async text => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: text }).catch(() => {});
    });
    await stream.settled;
  });
  return { streams, failed, fallbackPosts: () => fallbackPosts };
}

/** Invia un messaggio che resta in volo e restituisce lo stream trattenuto. */
async function sendPending(page, network, text) {
  const count = network.streams.length;
  await composer(page).locator('textarea').fill(text);
  await composer(page).getByRole('button', { name: 'Invia', exact: true }).click();
  await expect.poll(() => network.streams.length).toBe(count + 1);
  await expect(composer(page).locator('textarea')).toBeDisabled();
  return network.streams[count];
}

async function assertNoCanceledAnswer(page, network) {
  const text = await page.locator('.council-room-thread').innerText();
  expect(text).not.toMatch(/FORBIDDEN|STALE|non è raggiungibile/i);
  await expect(page.locator('.council-room-error')).toHaveCount(0);
  expect(network.fallbackPosts()).toBe(0);
}

test('Interrompi abortisce la richiesta, sblocca il composer e non sovrascrive con una risposta tardiva', async ({ page }) => {
  const network = await holdStreams(page);
  await openTreasury(page);

  const first = await sendPending(page, network, 'Prima domanda');
  const interrupt = composer(page).getByRole('button', { name: 'Interrompi', exact: true });
  await expect(interrupt).toBeEnabled();
  await interrupt.click();
  await expect.poll(() => network.failed.has(first.request)).toBe(true);
  await expect(composer(page).locator('textarea')).toBeEnabled();
  await expect(composer(page).getByRole('button', { name: 'Invia', exact: true })).toBeDisabled();

  const second = await sendPending(page, network, 'Seconda domanda');
  first.release('STALE risposta dopo cancellazione');
  await first.settled;
  // Gli handler vecchi non devono toccare la richiesta nuova.
  await expect(interrupt).toBeEnabled();
  await expect(composer(page).locator('textarea')).toBeDisabled();
  second.release('Risposta valida alla seconda domanda.');
  await second.settled;
  await waitIdle(page);
  await expect(replies(page).last()).toContainText('Risposta valida alla seconda domanda.');
  await assertNoCanceledAnswer(page, network);
});

test('lasciare la seduta e chiudere l’Ufficio abortiscono le richieste in volo senza contaminare un’altra sedia', async ({ page }) => {
  const network = await holdStreams(page);
  await openTreasury(page);

  const treasury = await sendPending(page, network, 'Domanda al Tesoro');
  await page.locator('.council-room-back').click();
  await expect.poll(() => network.failed.has(treasury.request)).toBe(true);
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect(composer(page).locator('textarea')).toBeEnabled();
  const works = await sendPending(page, network, 'Domanda ai Lavori');
  treasury.release('STALE risposta del Tesoro');
  await treasury.settled;
  await expect(composer(page).getByRole('button', { name: 'Interrompi', exact: true })).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(page.locator('.government-office')).toBeHidden();
  await expect.poll(() => network.failed.has(works.request)).toBe(true);
  works.release('STALE risposta dei Lavori');
  await works.settled;

  // Riaprire l'Ufficio riprende la seduta attiva (i Lavori) senza risposte annullate.
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await expect(composer(page).locator('textarea')).toBeEnabled();
  await assertNoCanceledAnswer(page, network);

  // E la seduta del Tesoro, aperta da capo, non eredita nulla di quella abortita.
  await page.locator('.council-room-back').click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(composer(page).locator('textarea')).toBeEnabled();
  await assertNoCanceledAnswer(page, network);
  await expect(presidentMessages(page)).toHaveCount(0);
});
