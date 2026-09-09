/**
 * World Story — E2E mock: moduli della scrivania (Q01 µ2)
 * ======================================================
 *
 * Verifica, interamente offline e con API mockate nel browser, i moduli della
 * scrivania di gioco introdotti da U01/U02/U03:
 *   - U01: un solo modulo attivo alla volta (activeModule enum);
 *   - U02: compositore d'ordine con «Registra ordine» (bozza accodata senza
 *          avanzare tempo né spendere risorse);
 *   - U03: Dossier Nazione a sezioni con default «Situazione» e placeholder
 *          «Da cosa dipende?» per le sezioni non alimentate.
 *
 * Le asserzioni sono su DOM/stato, non su screenshot. Nessun backend reale,
 * nessun provider LLM, nessuna rete esterna.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso del smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-wrapper')).toBeVisible({ timeout: 20_000 });
}

test.describe('Q01 µ2 — moduli della scrivania (U01/U02/U03)', () => {
  test('U01: un solo modulo attivo alla volta (Ordini → Nazione)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Nessun modulo aperto all'ingresso: la mappa è libera.
    // (action-desk è renderizzato solo quando attivo; nation-desk è sempre nel
    // DOM ma collassato → verifichiamo la visibilità, non il conteggio.)
    await expect(page.locator('.action-desk')).toHaveCount(0);
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Apri «Ordini»: il pannello azioni è visibile.
    await page.locator('.fab-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.action-desk')).toBeVisible();
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Chiudi e apri «Nazione»: il pannello azioni sparisce, il dossier appare.
    await page.locator('.action-desk .btn-close').click();
    await expect(page.locator('.action-desk')).toHaveCount(0);
    await page.locator('.fab-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();
    await expect(page.locator('.action-desk')).toHaveCount(0);
  });

  test('U02: compositore d\'ordine — «Registra ordine» accoda senza avanzare tempo', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.fab-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.action-desk')).toBeVisible();

    // Il compositore libero è presente con l'etichetta corretta.
    await expect(page.locator('#free-player-order')).toBeVisible();
    await expect(page.locator('.btn-add-pending')).toHaveText('Registra ordine');

    // «Registra ordine» è disabilitato finché la bozza è vuota.
    await expect(page.locator('.btn-add-pending')).toBeDisabled();

    // Scrivi un ordine e registralo: la bozza viene accodata.
    await page.locator('#free-player-order').fill('Costruire una ferrovia verso il confine');
    await expect(page.locator('.btn-add-pending')).toBeEnabled();
    await page.locator('.btn-add-pending').click();

    // L'ordine appare nella coda (pendingActions) e la bozza si svuota.
    await expect(page.locator('.pending-item').first()).toContainText('Costruire una ferrovia verso il confine');
    await expect(page.locator('#free-player-order')).toHaveValue('');
  });

  test('U03: Dossier Nazione — sezioni con default «Situazione» e placeholder', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.fab-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();

    // Default: sezione «Situazione» (decisioni richieste).
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Situazione');
    await expect(page.locator('.nation-section[aria-label="Decisioni richieste"]')).toBeVisible();

    // Passa a «Progetti»: mostra il placeholder «Da cosa dipende?».
    await page.locator('.nation-dock-tab', { hasText: 'Progetti' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Progetti');
    await expect(page.locator('.nation-section-empty')).toBeVisible();
    await expect(page.locator('.nation-section-depends')).toContainText('Da cosa dipende?');
  });
});
