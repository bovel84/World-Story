/**
 * World Story — E2E mock: smoke test del flusso di creazione partita (Q01 µ1)
 * =========================================================================
 *
 * Verifica, interamente offline e con API mockate nel browser, il percorso
 * landing → template → paese → generazione mondo → HUD di gioco. Nessun
 * backend reale, nessun provider LLM, nessuna rete esterna.
 *
 * Copre (parzialmente) UI01: un solo modulo attivo, ingresso partita.
 * Le asserzioni sono su DOM/stato, non su screenshot.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

test.describe('Q01 µ1 — smoke mock (creazione partita)', () => {
  test('landing → template → paese → mondo → HUD di gioco', async ({ page }) => {
    installMockApi(page);

    // 1. Landing
    await page.goto('/');
    await expect(page.locator('.landing-cta')).toBeVisible();
    await expect(page.locator('.landing-title')).toHaveText('World Story');

    // 2. Nuova partita → template
    await page.locator('.landing-cta').click();
    await expect(page.locator('.template-card')).toBeVisible();
    await expect(page.locator('.template-card').first()).toContainText('Mondo di prova');

    // 3. Seleziona template → paese
    await page.locator('.template-card').first().click();
    await expect(page.locator('.country-list-item').first()).toBeVisible();
    await expect(page.locator('.country-list-item').first()).toContainText('Alfa');

    // 4. Seleziona paese e conferma → generazione mondo (mock) → HUD
    await page.locator('.country-list-item').first().click();
    await page.locator('.btn-play').click();

    // 5. HUD di gioco
    await expect(page.locator('.game-wrapper')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.hud-bar')).toBeVisible();
    await expect(page.locator('.hud-turn-badge')).toContainText('TURNO 1');
    await expect(page.locator('.game-map')).toBeVisible();

    // 6. La mappa SVG è renderizzata (regioni Alfa/Beta)
    await expect(page.locator('.game-map svg')).toBeVisible();
  });

  test('generazione mondo fallita → errore e ritorno al menu (stato di errore)', async ({ page }) => {
    installMockApi(page, { failWorldGen: true });

    await page.goto('/');
    await page.locator('.landing-cta').click();
    await page.locator('.template-card').first().click();
    await page.locator('.country-list-item').first().click();

    // Il mock fa fallire il job di generazione: la UI mostra un alert e torna al menu.
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('.btn-play').click();

    // Dopo il fallimento la vista torna al menu (landing).
    await expect(page.locator('.landing-cta')).toBeVisible({ timeout: 20_000 });
  });
});
