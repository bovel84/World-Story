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
    // MAP-COMPLETE: la mappa è completa e le nazioni consigliate sono marcate.
    await expect(page.locator('.map-completeness')).toContainText('2');
    await expect(page.locator('.country-list-item').first().locator('.country-recommended')).toBeVisible();

    // 4. Seleziona paese e conferma → generazione mondo (mock) → HUD
    await page.locator('.country-list-item').first().click();
    await page.locator('.btn-play').click();

    // 5. HUD di gioco (shell a griglia: HUD, rail, mappa, desk)
    await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.hud-bar')).toBeVisible();
    await expect(page.locator('.hud-turn-badge')).toContainText('TURNO 1');
    await expect(page.locator('.game-shell-map')).toBeVisible();
    await expect(page.locator('.game-shell-rail')).toBeVisible();

    // 6. La mappa SVG è renderizzata (regioni Alfa/Beta senza geojson)
    await expect(page.locator('.game-shell-map svg').first()).toBeVisible();
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
