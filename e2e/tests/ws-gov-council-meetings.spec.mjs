/**
 * WS-GOV-COUNCIL-MEETINGS — Il percorso della fabbrica (E2E verticale, B18/B19)
 * ============================================================================
 * Il criterio di successo: una decisione multi-competenza si costruisce in una
 * **riunione condivisa**, con i dati del motore, un solo piano, contributi
 * attribuiti per sedia, e un atto che conserva la dichiarazione d'opera. La
 * cassa insufficiente è un blocco del motore, non una soluzione inventata.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openSeat(page, label) {
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: label }).click();
}

async function ask(page, chat, text) {
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
}

test('WS-GOV-COUNCIL-MEETINGS: la fabbrica è una riunione Lavori+Tesoro, l’atto conserva l’opera', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openSeat(page, 'Ministro dei Lavori');

  const chat = page.locator('.government-office-pane-chat');
  const tavola = page.locator('.government-office-pane-table');
  const meeting = tavola.locator('.council-meeting');

  // [1] Il Presidente chiede una decisione multi-competenza: la richiesta
  //     propone la riunione, e il Presidente la convoca.
  await ask(page, chat, 'Voglio costruire una fabbrica siderurgica a Sarajevo.');
  const prompt = tavola.locator('.council-convene-prompt');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.locator('.council-convene-prompt-btn').click();
  await expect(meeting).toBeVisible({ timeout: 15_000 });
  await expect(meeting).toContainText('Riunione di Governo');
  await expect(meeting).toContainText('Ministro dei Lavori (capofila)');
  await expect(meeting).toContainText('Ministro del Tesoro');

  // [2] Il piano condiviso distingue le competenze, con la provenienza del motore.
  await expect(meeting.locator('[data-owner="lavori"]')).toBeVisible();
  await expect(meeting.locator('[data-owner="tesoro"]')).toBeVisible();
  await expect(meeting).toContainText('fabbrica siderurgica');
  await expect(meeting).toContainText('12,40 mld');
  await expect(meeting).toContainText('check-feasibility');

  // [3] La conversazione è **una**, con le voci attribuite (B19).
  await expect(chat.locator('.entry-meta', { hasText: 'Ministro dei Lavori' }).first()).toBeVisible();
  await expect(chat.locator('.entry-meta', { hasText: 'Ministro del Tesoro' }).first()).toBeVisible();
  // Niente payload interni né «FATTI/LETTURA/PROPOSTA» in chat.
  await expect(chat).not.toContainText('workDeclaration');
  await expect(chat).not.toContainText('FATTI');
  await expect(chat).not.toContainText('```');

  // [4] Nessuna riserva durante la discussione: il registro è vuoto.
  await expect(page.locator('.suggestions-footer')).toContainText('Nessun atto nel registro');

  // [5] La riunione è pronta: si prepara l'atto, e porta la dichiarazione d'opera.
  const prepare = meeting.locator('.council-meeting-prepare');
  await expect(prepare).toBeVisible();
  await prepare.click();
  const draft = tavola.locator('.act-draft');
  await expect(draft).toBeVisible();
  await expect(draft.locator('.act-draft-text')).toHaveValue(/fabbrica siderurgica/i);
  // La bozza d'opera è un ordine supportato: capace di aprire il cantiere.
  await expect(draft.locator('.act-draft-capability')).toContainText('ordine d’opera supportato');

  // [6] Solo la firma accoda l'ordine.
  await expect(draft.locator('.act-draft-sign')).toBeEnabled();
  await draft.locator('.act-draft-sign').click();
  await expect(draft.locator('.act-draft-state')).toHaveText('accodato', { timeout: 10_000 });

  // Reperto: la riunione della fabbrica (mobile).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
  await expect(meeting).toBeVisible();
  await page.locator('.government-office').screenshot({ path: '../docs/implementation/assets/ws-gov-council-meetings/390x844-riunione-fabbrica.png' });
});

test('WS-GOV-COUNCIL-MEETINGS: cassa insufficiente = blocco del motore, nessuna soluzione inventata', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openSeat(page, 'Ministro dei Lavori');

  const chat = page.locator('.government-office-pane-chat');
  const meeting = page.locator('.government-office-pane-table .council-meeting');

  await ask(page, chat, 'Voglio costruire una fabbrica siderurgica, ma mancano i fondi.');
  const prompt = page.locator('.government-office-pane-table .council-convene-prompt');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.locator('.council-convene-prompt-btn').click();
  await expect(meeting).toBeVisible({ timeout: 15_000 });

  // Il Tesoro dice che manca la copertura (dato del motore), non una soluzione.
  await expect(chat).toContainText('Non c’è la copertura necessaria');
  await expect(meeting).toContainText('Da risolvere');
  await expect(meeting).toContainText('blocco del motore');
  await expect(meeting).toContainText('4,20 mld');
  // La riunione non è pronta: nessun pulsante d'atto.
  await expect(meeting.locator('.council-meeting-prepare')).toHaveCount(0);
});
