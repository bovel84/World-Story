/**
 * WS-GOVUX-P4 — L'evidenza in linea (E2E mirato, viewport mobile)
 * ==============================================================
 * Verifica, offline e con API mockate, il percorso che il P0 aveva rilevato
 * assente o difettoso:
 *  - la **card compatta sotto il messaggio** del ministro, con lo stesso `id`
 *    (`data-block-id`) del blocco sulla tavola: è un riferimento, non un
 *    secondo grafico;
 *  - il clic sulla card **apre la Tavola e mette a fuoco** il blocco reale
 *    (mobile), con il blocco evidenziato;
 *  - il **badge novità** è un fatto di visione: si spegne quando l'evidenza è
 *    vista, non quando arriva, e si riaccende solo per una **nuova** evidenza;
 *  - il **testo in composizione** non si perde passando da una tab all'altra.
 *
 * Gira a 390×844 (eccezione UI minima della fase). Lo screenshot è il reperto.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const SHOT = '../docs/implementation/assets/ws-govux-p4/390x844-inline-evidence.png';
const SHOT_DESKTOP = '../docs/implementation/assets/ws-govux-p4/1366x768-inline-evidence.png';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso del smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

test('P4: la card in linea mette a fuoco l’evidenza; il badge si spegne quando è vista', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);

  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const ufficio = page.locator('.government-office');
  await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
  const chat = page.locator('.gov-mobile-chat');
  const tavola = page.locator('.gov-mobile-evidence');
  const tavolaTab = page.locator('.gov-mobile-tab', { hasText: 'Tavola' });
  const dialogoTab = page.locator('.gov-mobile-tab', { hasText: 'Dialogo' });

  // [1] «Mi mostri dove va la spesa?» → la card compare SOTTO il messaggio, con
  //     lo stesso `id` e lo stesso titolo del blocco sulla tavola.
  await chat.locator('textarea').fill('Mi mostri dove va la spesa?');
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)')).toContainText('ha preso nota del problema', { timeout: 15_000 });
  const card = chat.locator('.minister-evidence-card[data-block-id="bilancio"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Dove va il denaro');
  // Il blocco `tavola` non è mai prosa visibile.
  await expect(chat).not.toContainText('```');
  await expect(chat).not.toContainText('"op"');

  // [2] Il pallino «novità» è acceso mentre si legge il dialogo.
  await expect(tavolaTab.locator('.gov-mobile-dot')).toBeVisible();

  // [3] Lasciamo una bozza nel compositore: non deve perdersi al cambio tab.
  await chat.locator('textarea').fill('bozza non inviata');

  // [4] Il clic sulla card apre la Tavola e mette a fuoco il blocco reale.
  await card.click();
  await expect(tavola).toBeVisible();
  await expect(chat).toBeHidden();
  const block = tavola.locator('[data-block-id="bilancio"]');
  await expect(block).toBeVisible();
  await expect(block).toHaveClass(/seat-evidence-focus/);
  // L'evidenza reale è il grafico del bilancio: la card non ne ha disegnato uno.
  await expect(block.locator('.advisor-chart')).toBeVisible();
  // Il pallino è spento: l'evidenza è stata vista.
  await expect(tavolaTab.locator('.gov-mobile-dot')).toHaveCount(0);

  // [5] Tornando al dialogo il pallino NON si riaccende, e la bozza è conservata.
  //     Dalla vista evidenza si torna alla Tavola (←), poi al Dialogo.
  await page.locator('.gov-mobile-nav').click();
  await dialogoTab.click();
  await expect(chat).toBeVisible();
  await expect(tavolaTab.locator('.gov-mobile-dot')).toHaveCount(0);
  await expect(chat.locator('textarea')).toHaveValue('bozza non inviata');

  await page.screenshot({ path: SHOT, fullPage: true });

  // [6] Una NUOVA evidenza riaccende il pallino; poi il desktop mostra le due
  //     superfici insieme (report di fase).
  await chat.locator('textarea').fill('Quali province coinvolge?');
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
  await expect(tavolaTab.locator('.gov-mobile-dot')).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: SHOT_DESKTOP, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
});
