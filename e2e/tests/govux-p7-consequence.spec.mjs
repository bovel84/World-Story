/**
 * WS-GOVUX-P7 — La plancia delle conseguenze (E2E mirato, viewport mobile)
 * =======================================================================
 * Verifica, offline e con API mockate, che **prima della firma** il Presidente
 * veda quattro letture distinte — effetti diretti, previsioni, rischi,
 * incertezze — e che:
 *  - i costi mostrati siano **quelli del motore** (`check-feasibility`), non una
 *    percentuale inventata dalla plancia;
 *  - **modificare la bozza** dichiari la stima `stale` e offra il ricalcolo
 *    esplicito;
 *  - la plancia **non accodi nulla**: il registro resta vuoto finché non si firma.
 *
 * Gira a 390×844. Lo screenshot è il reperto della fase.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const SHOT = '../docs/implementation/assets/ws-govux-p7/390x844-consequence-board.png';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso dello smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

test('P7: la plancia mostra le conseguenze prima della firma, senza accodare', async ({ page }) => {
  installMockApi(page);
  // La plancia è una lettura: nessuna richiesta di accodamento deve partire.
  const queueCalls = [];
  page.on('request', request => {
    if (request.url().includes('/actions/queue')) queueCalls.push(request.url());
  });
  await reachHud(page);

  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const ufficio = page.locator('.government-office');
  await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();

  // A 390×844 la Tavola non reinnesta più la Tavola desktop: la bozza d'atto si
  // prepara dalla **CTA primaria** della vista mobile (M6/M21).
  // Prima si stabilisce una misura accettata e senza domande aperte.
  const chat = page.locator('.gov-mobile-chat');
  await chat.locator('textarea').fill('Portiamo gli investimenti al 90 per cento.');
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant').last()).not.toHaveText('', { timeout: 15_000 });
  await expect(chat.locator('.minister-compose button')).toHaveText(/Invia/, { timeout: 15_000 });

  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  const prepareCta = page.locator('.gov-mobile-cta .gov-mobile-primary', { hasText: /Prepara l’atto/ });
  await expect(prepareCta).toBeVisible({ timeout: 15_000 });
  await prepareCta.click();

  // [1] La CTA apre la vista Atto (H19): la bozza e la plancia vivono lì.
  const bozza = page.locator('.gov-mobile .act-draft');
  await expect(bozza).toBeVisible();

  const plancia = bozza.locator('.consequence-board');
  await expect(plancia).toBeVisible();
  // La verifica del motore arriva: è la stessa funzione di costo dell'esecuzione.
  await expect(plancia).toContainText('verifica del motore', { timeout: 15_000 });
  await expect(plancia).toContainText('Tesoreria');
  await expect(plancia).toContainText('12,40 mld');
  await expect(plancia).toContainText('applicato dal motore');
  // I quattro gruppi sono distinti ed etichettati.
  await expect(plancia).toContainText('Effetti diretti calcolati');
  await expect(plancia).toContainText('Previsioni del motore');
  await expect(plancia).toContainText('Rischi');
  await expect(plancia).toContainText('Incertezze');
  // Ciò che il motore non simula è dichiarato non stimabile, senza percentuali.
  await expect(plancia.locator('.consequence-not-estimable')).toContainText('Effetti sociali');
  // L'unica percentuale può venire dalla nota del motore, mai dalla plancia.
  await expect(plancia.locator('.consequence-not-estimable')).not.toContainText('%');
  // La nota del motore è citata come tale, non spacciata per calcolo locale.
  await expect(plancia).toContainText('Avviso del motore');
  // La plancia è **prima** della firma.
  const boardBox = await plancia.boundingBox();
  const signBox = await bozza.locator('.act-draft-sign').boundingBox();
  expect(boardBox.y).toBeLessThan(signBox.y);

  // [2] La plancia non accoda: nessuna richiesta di coda è partita.
  expect(queueCalls).toHaveLength(0);

  await page.screenshot({ path: SHOT, fullPage: true });

  // [3] Modificare la bozza invalida la stima: niente costi del motore sotto
  //     un testo diverso, e il ricalcolo è esplicito.
  await bozza.locator('.act-draft-edit-toggle', { hasText: 'Modifica' }).click();
  await bozza.locator('.act-draft-text').fill('Rimborso titoli: testo corretto dal Presidente');
  await expect(plancia).toContainText('La bozza è cambiata');
  await expect(plancia.locator('.consequence-refresh')).toBeVisible();
  await expect(plancia).not.toContainText('Tesoreria');

  // [4] Il ricalcolo riporta i costi del motore per la versione corrente.
  await plancia.locator('.consequence-refresh').click();
  await expect(plancia).toContainText('verifica del motore', { timeout: 15_000 });
  await expect(plancia).toContainText('Tesoreria');

  // [5] Ancora nessun accodamento, e il registro è vuoto sulla schermata reale.
  expect(queueCalls).toHaveLength(0);
  // Atto → Tavola → Dialogo → Ministri (← = dentro la sessione).
  await page.locator('.gov-mobile-nav').click();
  await page.locator('.gov-mobile-nav').click();
  await page.locator('.gov-mobile-nav').click();
  await expect(ufficio.locator('.order-register-act')).toHaveCount(0);
});
