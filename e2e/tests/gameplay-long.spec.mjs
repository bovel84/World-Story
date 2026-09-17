/**
 * GAMEPLAY-LONG — il registro degli impegni è visibile dove serve.
 *
 * La cronaca racconta, il registro ricorda: trattati, promesse e ultimatum
 * restano nel Dossier con stato, controparte, importanza e scadenza — date
 * calcolate dal motore, mai dal browser.
 */
import { expect, test } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso degli altri spec). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

test.describe('GAMEPLAY-LONG — impegni della partita', () => {
  test('il Dossier mostra gli impegni con stato, controparte e scadenza', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await page.locator('.rail-btn[aria-label="Nazione"]').click();

    const block = page.locator('.nation-block[aria-label="Impegni della partita"]');
    await expect(block).toBeVisible();
    await expect(block).toContainText('1 impegno in vigore');
    await expect(block).toContainText('1 conclusi');

    const treaty = block.locator('.nation-commitment').first();
    await expect(treaty).toContainText('Trattato');
    await expect(treaty).toContainText('in vigore');
    await expect(treaty).toContainText('Patto sui confini alpini');
    await expect(treaty).toContainText('ITA → FRA');
    await expect(treaty).toContainText('importanza 3/3');
    // La scadenza si legge come tempo residuo rispetto alla data del mondo.
    await expect(treaty).toContainText('scade fra 60 giorni');
    await expect(treaty).toContainText('Ratificato dal parlamento.');

    // Ciò che è finito resta leggibile, ma non è più un vincolo.
    const expired = block.locator('.nation-commitment').nth(1);
    await expect(expired).toContainText('Ultimatum');
    await expect(expired).toContainText('decaduto');
    await expect(expired).toContainText('scaduto il 31 dic 1950');
  });
});
