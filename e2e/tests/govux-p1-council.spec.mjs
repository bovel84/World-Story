/**
 * WS-GOVUX-P1 — L'agenda viva del Consiglio (E2E mirato, viewport mobile)
 * ======================================================================
 * Verifica, offline e con API mockate, ciò che il P0 aveva rilevato mancante
 * nella schermata di scelta:
 *  - la **sintesi** del consiglio, contata sugli stessi record della lista;
 *  - per ogni ministro, **stato**, frase, argomento e questioni;
 *  - lo stato cambia **solo** per un fatto: qui, un colloquio avviato;
 *  - una sedia con un colloquio in corso invita a **riprenderlo**, e i messaggi
 *    restano quando si torna indietro;
 *  - una voce **critica del motore** produce «richiede attenzione»: nessuna
 *    urgenza inventata dal testo.
 *
 * Gira a 390×844 (telefono): è il gate ridotto della fase. Lo screenshot è il
 * reperto della fase, salvato negli asset del report.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_CABINET } from '../mock-api.mjs';

test.use({ viewport: { width: 390, height: 844 } });

/** La stessa cabina del mock, ma con una voce del Tesoro **critica** (motore). */
const CRITICAL_CABINET = {
  ...MOCK_CABINET,
  addresses: MOCK_CABINET.addresses.map(address => address.seat !== 'tesoro' ? address : {
    ...address,
    items: address.items.map(item => ({ ...item, urgency: 'critica' })),
  }),
};

/** Raggiunge l'HUD di gioco dal landing (stesso percorso del smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Apre l'Ufficio del Governo sulla schermata di scelta. */
async function openCouncil(page) {
  await reachHud(page);
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const ufficio = page.locator('.government-office');
  await expect(ufficio).toBeVisible();
  await expect(ufficio.locator('.cabinet-pick-alive')).toHaveCount(2);
  return ufficio;
}

const SHOT = '../docs/implementation/assets/ws-govux-p1/390x844-council-agenda.png';
const SHOT_DESKTOP = '../docs/implementation/assets/ws-govux-p1/1366x768-council-agenda.png';

test('P1: l’agenda viva — sintesi, stati, colloquio ripreso', async ({ page }) => {
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

  // [3] Apriamo un colloquio con il Tesoro: la risposta arriva, poi torniamo.
  await tesoro.click();
  const chat = page.locator('.gov-mobile-chat');
  await expect(chat.locator('.minister-chat')).toBeVisible();
  await chat.locator('textarea').fill('Il porto di Alfa resta chiuso: servono fondi.');
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)')).toContainText('ha preso nota del problema', { timeout: 15_000 });
  await page.locator('.gov-mobile-nav').click();

  // [4] Ora il Tesoro è «discussione aperta» e la sintesi è ricalcolata:
  //     lo stato è cambiato per un fatto (il colloquio), non per una stima.
  await expect(tesoro).toHaveAttribute('data-state', 'discussione-aperta');
  await expect(tesoro).toContainText('Riprendi il colloquio');
  await expect(tesoro).toContainText('2 scambi');
  await expect(sintesi).toContainText('1 discussione aperta');
  await expect(sintesi).toContainText('1 disponibile');
  await expect(sintesi).not.toContainText('2 disponibile');

  // Lo screenshot è il reperto della fase: prima il telefono (gate ridotto),
  // poi il desktop, come chiede il report di fase.
  await page.screenshot({ path: SHOT, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: SHOT_DESKTOP, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  // [5] Riaprire la sedia riprende il colloquio: i messaggi ci sono ancora.
  await tesoro.click();
  await expect(chat.locator('.minister-entry:not(.minister-greeting)')).toHaveCount(2);
  await expect(chat).toContainText('Il porto di Alfa resta chiuso');
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
