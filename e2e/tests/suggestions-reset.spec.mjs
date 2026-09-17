/**
 * World Story — E2E mock: le proposte elaborate si azzerano a ogni turno
 * =========================================================================
 *
 * ARMY-MOVE Parte 3. Al turno 8 il pannello «Pianifica la prossima mossa»
 * mostrava ancora le proposte dei turni precedenti: nessuno azzerava lo store
 * all'avanzamento (solo il resume di un salvataggio lo faceva).
 *
 * Qui si verifica il ciclo completo nel browser, offline e con API mockate:
 *   1. «Elabora proposte» pubblica la lista;
 *   2. l'avanzamento del turno la azzera e lascia lo stato vuoto spiegato;
 *   3. le proposte NON riappaiono da sole: servono solo su richiesta.
 *
 * Nessun backend reale, nessun provider LLM, nessuna rete esterna.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso dello smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

test.describe('ARMY-MOVE P3 — le proposte elaborate valgono per un turno', () => {
  test('avanzare il turno azzera le proposte; si rigenerano solo su richiesta', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Pannello Ordini: nessuna proposta finché il giocatore non le chiede.
    await page.locator('.rail-btn[aria-label="Ordini"]').click();
    await expect(page.locator('.suggestions-content')).toBeVisible();
    await expect(page.locator('.suggestions-empty')).toBeVisible();
    await expect(page.locator('.suggestion-item')).toHaveCount(0);

    // «Elabora proposte» → la lista compare.
    await page.locator('.btn-generate-suggestions').click();
    await expect(page.locator('.suggestion-item')).toHaveCount(2);
    await expect(page.locator('.suggestions-empty')).toHaveCount(0);

    // Avanza il tempo: il pannello resta aperto, la lista sparisce.
    await page.locator('.hud-advance-btn').click();
    await expect(page.locator('.time-desk-content')).toBeVisible();
    await page.locator('.time-desk-next').click();

    // Le proposte del turno precedente non sono più a schermo…
    await expect(page.locator('.suggestion-item')).toHaveCount(0, { timeout: 20_000 });
    // …e lo stato vuoto spiega perché, indicando come rigenerarle.
    await expect(page.locator('.suggestions-empty')).toBeVisible();
    await expect(page.locator('.suggestions-empty')).toContainText('Elabora proposte');
    // Il turno è davvero avanzato (il mock risponde al 01/02/1951).
    await expect(page.locator('.hud-turn-badge')).toContainText('TURNO 2');

    // Le proposte non riappaiono da sole: si rigenerano solo su richiesta.
    await page.locator('.btn-generate-suggestions').click();
    await expect(page.locator('.suggestion-item')).toHaveCount(2);
  });

  test('una ricerca senza eventi non azzera le proposte (nulla è cambiato)', async ({ page }) => {
    installMockApi(page, {
      advanceResult: {
        type: 'no_event_found',
        simulationId: 'mock-simulation-2',
        startDate: '1951-01-01',
        searchedUntil: '1951-03-01',
      },
    });
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Ordini"]').click();
    await page.locator('.btn-generate-suggestions').click();
    await expect(page.locator('.suggestion-item')).toHaveCount(2);

    await page.locator('.hud-advance-btn').click();
    await page.locator('.time-desk-next').click();

    // Nessun turno committato: le proposte restano valide.
    await expect(page.locator('.time-desk-content')).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('.suggestion-item')).toHaveCount(2);
    await expect(page.locator('.suggestions-empty')).toHaveCount(0);
  });
});
