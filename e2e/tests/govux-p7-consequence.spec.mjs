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
 * Migrata alla Sala del Consiglio: la seduta è `.council-room`, la Tavola è un
 * bottom sheet su mobile e la bozza nasce da «Prepara bozza comune». Gira a
 * 390×844. Lo screenshot è il reperto della fase.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, ask, openBoard, prepareCommonDraft, backToPicker,
} from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('P7: la plancia mostra le conseguenze prima della firma, senza accodare', async ({ page }) => {
  installMockApi(page);
  // La plancia è una lettura: nessuna richiesta di accodamento deve partire.
  const queueCalls = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/actions/queue')) queueCalls.push(request.url());
  });
  await reachHud(page);

  await openCouncilRoom(page, 'tesoro');

  // Si stabilisce una misura proposta senza domande aperte.
  await ask(page, 'Portiamo gli investimenti al 90 per cento.');

  // La Tavola (bottom sheet su mobile) prepara la bozza d'atto.
  await openBoard(page);
  const bozza = await prepareCommonDraft(page);

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
  await expect(plancia.locator('.consequence-not-estimable')).not.toContainText('%');
  // La nota del motore è citata come tale, non spacciata per calcolo locale.
  await expect(plancia).toContainText('Avviso del motore');
  // La plancia è **prima** della firma.
  const boardBox = await plancia.boundingBox();
  const signBox = await bozza.locator('.act-draft-sign').boundingBox();
  expect(boardBox.y).toBeLessThan(signBox.y);

  // [2] La plancia non accoda: nessuna richiesta di coda è partita.
  expect(queueCalls).toHaveLength(0);

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
  //     Su mobile la Tavola è un bottom sheet: prima di tornare al registro
  //     la si chiude con Escape (il toggle resta sotto l'overlay del foglio).
  expect(queueCalls).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.council-room-board')).toHaveCount(0);
  await backToPicker(page);
  await expect(page.locator('.government-office')).toBeVisible();
  await expect(page.locator('.order-register-act')).toHaveCount(0);
});
