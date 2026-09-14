/**
 * World Story — E2E mock: moduli della scrivania (Q01 µ2)
 * ======================================================
 *
 * Verifica, interamente offline e con API mockate nel browser, i moduli della
 * scrivania di gioco:
 *   - un solo modulo attivo alla volta (rail → desk);
 *   - compositore d'ordine con «Registra ordine» (bozza accodata senza
 *     avanzare tempo né spendere risorse);
 *   - Dossier Nazione a sezioni con default «Situazione».
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
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

test.describe('Q01 µ2 — moduli della scrivania', () => {
  test('un solo modulo attivo alla volta (Ordini → Nazione)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Nessun modulo aperto all'ingresso: la mappa è libera.
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Apri «Ordini»: il pannello azioni è visibile.
    await page.locator('.rail-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.suggestions-content')).toBeVisible();
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Chiudi e apri «Nazione»: il pannello azioni sparisce, il dossier appare.
    await page.locator('.suggestions-content .desk-close-x').click();
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
  });

  test('U02: compositore d\'ordine — «Registra ordine» accoda senza avanzare tempo', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.suggestions-content')).toBeVisible();

    // Il compositore libero è presente con l'etichetta corretta.
    await expect(page.locator('#free-player-order')).toBeVisible();
    await expect(page.locator('.btn-add-pending')).toHaveText('Registra ordine');

    // «Registra ordine» è disabilitato finché la bozza è vuota.
    await expect(page.locator('.btn-add-pending')).toBeDisabled();

    // Scrivi un ordine e registralo: la bozza viene accodata.
    await page.locator('#free-player-order').fill('Costruire una ferrovia verso il confine');
    await expect(page.locator('.btn-add-pending')).toBeEnabled();
    await page.locator('.btn-add-pending').click();

    // «Registra ordine» apre la verifica di fattibilità: solo un esito
    // fattibile accoda l'ordine (G4-B).
    await expect(page.locator('.feasibility-check')).toBeVisible();
    await expect(page.locator('.btn-feasibility-register')).toContainText('Registra ordine');
    await page.locator('.btn-feasibility-register').click();

    // L'ordine appare nella coda (pendingActions) e la bozza si svuota.
    await expect(page.locator('.pending-item').first()).toContainText('Costruire una ferrovia verso il confine');
    await expect(page.locator('#free-player-order')).toHaveValue('');
  });

  test('U03: Dossier Nazione — sezioni con default «Situazione»', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();

    // Default: sezione «Situazione» (sintesi + decisioni richieste).
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Situazione');
    await expect(page.locator('.nation-block[aria-label="Decisioni richieste"]')).toBeVisible();
    await expect(page.locator('.nation-block[aria-label="Sintesi"]')).toBeVisible();

    // Le carte di sintesi mostrano la tendenza reale dalla storia (3 punti):
    // sparkline SVG + variazione rispetto al mese precedente.
    await expect(page.locator('.nation-spark').first()).toBeVisible();
    await expect(page.locator('.nation-trend').first()).toContainText('vs mese scorso');

    // Passa a «Progetti»: mostra lo stato vuoto e la nota di provenienza.
    await page.locator('.nation-dock-tab', { hasText: 'Progetti' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Progetti');
    await expect(page.locator('.nation-empty')).toBeVisible();
    await expect(page.locator('.nation-footnote')).toContainText('registro della simulazione');
  });
});
