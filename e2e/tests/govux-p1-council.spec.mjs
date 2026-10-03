/**
 * WS-GOVUX-P1 — L'agenda viva del Consiglio (E2E mirato, viewport mobile)
 * ======================================================================
 * Verifica, offline e con API mockate, ciò che il P0 aveva rilevato mancante
 * nella schermata di scelta:
 *  - la **sintesi** del consiglio, contata sugli stessi record della lista;
 *  - per ogni ministro, **stato**, frase, argomento e questioni;
 *  - lo stato cambia **solo** per un fatto: qui, una seduta avviata;
 *  - una sedia con un colloquio in corso invita a **riprenderlo**, e la seduta
 *    resta riprendibile quando si torna alla scelta;
 *  - una voce **critica del motore** produce «richiede attenzione»: nessuna
 *    urgenza inventata dal testo.
 *
 * Gira a 390×844 (telefono): è il gate ridotto della fase. Lo screenshot è il
 * reperto della fase, salvato negli asset del report.
 *
 * Migrata alla Sala del Consiglio: il colloquio 1:1 è diventato una **seduta
 * condivisa** (`.council-room`). Il filo della sedia è il filo condiviso, quindi
 * dopo un solo scambio l'agenda conta apertura + messaggio + risposta.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_CABINET } from '../mock-api.mjs';
import {
  reachHud, openGovernment, openCouncilRoom, ask, backToPicker, replies,
} from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 } });

/** La stessa cabina del mock, ma con una voce del Tesoro **critica** (motore). */
const CRITICAL_CABINET = {
  ...MOCK_CABINET,
  addresses: MOCK_CABINET.addresses.map(address => address.seat !== 'tesoro' ? address : {
    ...address,
    items: address.items.map(item => ({ ...item, urgency: 'critica' })),
  }),
};

/** Apre l'Ufficio del Governo sulla schermata di scelta. */
async function openCouncil(page) {
  await reachHud(page);
  const ufficio = await openGovernment(page);
  await expect(ufficio.locator('.cabinet-pick-alive')).toHaveCount(2);
  return ufficio;
}

test('P1: l’agenda viva — sintesi, stati, seduta ripresa', async ({ page }) => {
  installMockApi(page);
  const ufficio = await openCouncil(page);

  // [1] La sintesi è visibile e contata sugli stessi record della lista:
  //     nessuna sedia critica, quindi due «disponibile» e due questioni.
  const sintesi = ufficio.locator('.council-agenda-summary');
  await expect(sintesi).toBeVisible();
  await expect(sintesi).toContainText('2 ministri');
  await expect(sintesi).toContainText('2 disponibile');
  await expect(sintesi).toContainText('2 questioni sul tavolo');

  // [2] Ogni ministro porta stato, frase, argomento e questioni.
  const tesoro = ufficio.locator('.cabinet-pick-alive[data-seat="tesoro"]');
  await expect(tesoro).toHaveAttribute('data-state', 'disponibile');
  await expect(tesoro).toContainText('Ministro del Tesoro');
  await expect(tesoro).toContainText('La cassa regge, ma il margine si assottiglia.');
  await expect(tesoro).toContainText('Sul tavolo: Coprire il disavanzo del trimestre');
  const lavori = ufficio.locator('.cabinet-pick-alive[data-seat="lavori"]');
  await expect(lavori).toHaveAttribute('data-state', 'disponibile');

  // L'ordine è quello dichiarato: il Tesoro precede i Lavori.
  const seats = await ufficio.locator('.cabinet-pick-alive').evaluateAll(nodes => nodes.map(node => node.dataset.seat));
  expect(seats).toEqual(['tesoro', 'lavori']);

  // [3] Apriamo la seduta con il Tesoro e facciamo un solo scambio; poi si torna
  //     alla scelta con `.council-room-back` (la seduta resta riprendibile).
  //     L'helper `openCouncilRoom` riapre l'Ufficio dal rail: chiudiamo la scelta
  //     già ispezionata senza toccare lo stato, così il percorso resta canonico.
  await page.keyboard.press('Escape');
  await expect(ufficio).toBeHidden();
  const room = await openCouncilRoom(page, 'tesoro');
  await expect(room.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
  await ask(page, 'Il porto di Alfa resta chiuso: servono fondi.');
  await expect(replies(page).last()).toContainText('ha preso nota del problema');
  await backToPicker(page);

  // [4] Ora il Tesoro è «discussione aperta» e la sintesi è ricalcolata:
  //     lo stato è cambiato per un fatto (la seduta), non per una stima.
  //     Il filo condiviso conta apertura + messaggio + risposta = 3 scambi.
  await expect(tesoro).toHaveAttribute('data-state', 'discussione-aperta');
  await expect(tesoro).toContainText('Riprendi il colloquio');
  await expect(tesoro).toContainText('3 scambi');
  await expect(sintesi).toContainText('1 discussione aperta');
  await expect(sintesi).toContainText('1 disponibile');
  await expect(sintesi).not.toContainText('2 disponibile');

  // [5] La seduta lasciata è riprendibile: i messaggi ci sono ancora.
  await page.locator('.council-room-resume').first().click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.council-room-thread')).toContainText('Il porto di Alfa resta chiuso');
  await expect(replies(page)).toHaveCount(2);
});

test('P1: una voce critica del motore è «richiede attenzione»', async ({ page }) => {
  installMockApi(page, { cabinet: CRITICAL_CABINET });
  const ufficio = await openCouncil(page);

  const tesoro = ufficio.locator('.cabinet-pick-alive[data-seat="tesoro"]');
  await expect(tesoro).toHaveAttribute('data-state', 'richiede-attenzione');
  await expect(tesoro).toContainText('richiede attenzione');
  // La sintesi lo conta: 1 richiede attenzione, 1 disponibile.
  await expect(ufficio.locator('.council-agenda-summary')).toContainText('1 richiede attenzione');
  await expect(ufficio.locator('.council-agenda-summary')).toContainText('1 disponibile');
});
