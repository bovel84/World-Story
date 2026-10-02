/**
 * WS-GAME-OPENING — Il dossier di insediamento e lo scroll della pagina Governo.
 * ==============================================================================
 * Due cose, nello stesso giro di consegna:
 *  - l'apertura (5 pagine discrete, porte d'ingresso, non riappare a refresh);
 *  - il bug di scroll della pagina Governo (fino in fondo, un solo scroll owner).
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.locator('.game-shell').waitFor({ state: 'visible', timeout: 20_000 });
}

test('apertura: 5 pagine, porte d’ingresso, non missioni', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  installMockApi(page, { showOpening: true });
  await reachHud(page);

  const overlay = page.locator('.opening-overlay');
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  // Non è un wizard: nessuno «Step 1 di 5».
  await expect(overlay).not.toContainText('Step 1');
  await expect(page.locator('.opening-section')).toHaveText('IL MONDO');

  // Continua → IL PAESE (con letture e vicini dal motore).
  await page.locator('.opening-next').click();
  await expect(page.locator('.opening-section')).toHaveText('IL PAESE');
  await expect(page.locator('.opening-reading').first()).toBeVisible();

  // → IL QUADRO (problemi/opportunità con simboli).
  await page.locator('.opening-next').click();
  await expect(page.locator('.opening-section')).toHaveText('IL QUADRO');

  // → IL CONSIGLIO (max 3 voci).
  await page.locator('.opening-next').click();
  await expect(page.locator('.opening-section')).toHaveText('IL CONSIGLIO');
  expect(await page.locator('.opening-minister').count()).toBeLessThanOrEqual(3);

  // → ORA TOCCA A TE: tre porte + ingresso diretto.
  await page.locator('.opening-next').click();
  await expect(page.locator('.opening-section')).toHaveText('ORA TOCCA A TE');
  await expect(page.locator('.opening-door')).toHaveCount(3);
  await expect(page.locator('.opening-direct')).toBeVisible();

  // La porta «Governo» apre il Governo e chiude l'apertura.
  await page.locator('.opening-door', { hasText: 'Governo' }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.government-office')).toBeVisible({ timeout: 10_000 });
});

test('apertura: «Salta il briefing» e «Rivedi introduzione» dal menu', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  installMockApi(page, { showOpening: true });
  await reachHud(page);
  await expect(page.locator('.opening-overlay')).toBeVisible({ timeout: 10_000 });
  await page.locator('.opening-skip').click();
  await expect(page.locator('.opening-overlay')).toHaveCount(0);

  // Dal menu si può rivedere.
  await page.locator('.game-menu-btn').click();
  await page.locator('.game-menu-item', { hasText: 'Rivedi introduzione' }).click();
  await expect(page.locator('.opening-overlay')).toBeVisible({ timeout: 10_000 });
});

test('apertura: non riappare al refresh (flag UI per gameId)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  installMockApi(page, { showOpening: true });
  await reachHud(page);
  await expect(page.locator('.opening-overlay')).toBeVisible({ timeout: 10_000 });
  await page.locator('.opening-skip').click();
  await expect(page.locator('.opening-overlay')).toHaveCount(0);

  await page.reload();
  await page.locator('.landing-resume, .landing-cta').first().click();
  // Se il reload riporta al menu, si riprende la partita; in entrambi i casi
  // l'apertura NON deve riapparire.
  await page.waitForTimeout(1500);
  await expect(page.locator('.opening-overlay')).toHaveCount(0);
});
