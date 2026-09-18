/**
 * World Story — E2E mock: OP-OBJECTS (sala di governo)
 * ===================================================
 *
 * «Non voglio leggere numeri aggregati: voglio vedere l'esercito, la fabbrica,
 * il cantiere, la nave, e capire cosa succede se agisco.» Verifica, nel browser
 * offline e con API mockate, che:
 *   1. la sala di governo apra sul livello di settore con i numeri del motore;
 *   2. da lì si arrivi al singolo oggetto con la grammatica universale;
 *   3. l'azione di creazione reparto mostri il PRIMA → DOPO e sia bloccata
 *      quando il motore la blocca (motivo incluso);
 *   4. il testo lungo resti sotto «Perché?».
 *
 * Nessun backend reale, nessun provider LLM, nessuna rete esterna.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openSalaDiGoverno(page) {
  await page.locator('.rail-btn[aria-label="Nazione"]').click();
  await page.locator('.nation-dock-tab', { hasText: 'Armamenti' }).click();
  const block = page.locator('.nation-block[aria-label="Sala di governo"]');
  await expect(block).toBeVisible();
  return block;
}

test.describe('OP-OBJECTS — sala di governo', () => {
  test('apre sui settori con i numeri del motore e non mostra paragrafi', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    // Livello A: i settori presenti (la marina non esiste per Alpha: assente ≠ zero).
    const settori = block.locator('.obj-sector');
    await expect(settori).toHaveCount(3);
    await expect(block.locator('.obj-sector-name')).toHaveText(['Forze armate', 'Industria', 'Risorse']);
    await expect(block.locator('.obj-sector', { hasText: 'Forze armate' })).toContainText('3 reparti · 55.000 uomini in armi');
    await expect(block.locator('.obj-sector', { hasText: 'Forze armate' })).toContainText('15%');
    await expect(block.locator('.obj-sector', { hasText: 'Industria' })).toContainText('Linee totali');
    await expect(block).not.toContainText('Marina');

    // Testo ridotto: nessuna spiegazione lunga nella prima schermata.
    await expect(block).not.toContainText('La dotazione di riferimento è quella');
  });

  test('dal settore si arriva all’oggetto con la grammatica universale', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await block.locator('.obj-sector', { hasText: 'Forze armate' }).locator('.obj-open').click();

    // Livello B: lo schieramento nazionale con le sue armate.
    await expect(block.locator('.obj-object-name')).toContainText(['Forze armate', 'I Corpo', 'II Corpo']);
    const corpo = block.locator('.obj-object[aria-label="I Corpo"]');
    await expect(corpo).toContainText('Dislocata in Alpha');
    // Le armate dipendono dallo schieramento: sono già aperte, con la grammatica.
    // L'ordine è quello della grammatica: stato, capacità, personale, output…
    await expect(corpo.locator('.obj-section h5')).toContainText(['Stato', 'Capacità', 'Personale', 'Output', 'Costi', 'Autonomia']);
    await expect(corpo).toContainText('Copertura armi individuali');
    // Le spiegazioni lunghe stanno sotto «Perché?» e si aprono a richiesta.
    await expect(corpo.locator('.obj-why summary')).toHaveText('Perché?');
    await corpo.locator('.obj-why summary').click();
    await expect(corpo.locator('.obj-why p')).toContainText('Armata reale del mondo');
  });

  test('il cantiere mostra un’opera che non produce nulla prima del completamento', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await block.locator('.obj-sector', { hasText: 'Industria' }).locator('.obj-open').click();
    const cantiere = block.locator('.obj-object', { hasText: 'Ferrovia transnazionale' });
    await expect(cantiere).toBeVisible();
    await expect(cantiere).toContainText('In costruzione');
    await cantiere.locator('.obj-object-toggle').click();
    await expect(cantiere).toContainText('Avanzamento');
    await expect(cantiere).toContainText('38%');
    await expect(cantiere).toContainText('Nessuno prima del completamento');
  });

  test('l’azione mostra il PRIMA → DOPO e si conferma', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await block.locator('.obj-sector', { hasText: 'Forze armate' }).locator('.obj-open').click();
    const forza = block.locator('.obj-object', { hasText: 'Forze armate' }).first();
    await forza.locator('.obj-object-toggle').click();
    await forza.locator('.obj-action-button', { hasText: 'Crea 1 reparto' }).click();

    const azione = forza.locator('.obj-action');
    await expect(azione).toBeVisible();
    await expect(azione.locator('.obj-action-head')).toContainText('Costo immediato');
    await expect(azione).toContainText('11.000 uomini');
    await expect(azione.locator('.obj-delta')).toContainText('Uomini in armi');
    await expect(azione.locator('.obj-delta')).toContainText('55.000');
    await expect(azione.locator('.obj-delta')).toContainText('66.000');
    await expect(azione.locator('.obj-delta')).toContainText('Consumo carburante');

    await azione.locator('.obj-confirm').click();
    // Il motore applica: l'arsenale viene ricaricato e la vista resta coerente.
    await expect(block).toBeVisible();
  });

  test('l’azione bloccata dal motore resta visibile con il suo motivo', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await block.locator('.obj-sector', { hasText: 'Forze armate' }).locator('.obj-open').click();
    const secondo = block.locator('.obj-object[aria-label="II Corpo"]');
    const pulsante = secondo.locator('.obj-action-button', { hasText: 'Aggiungi 1 reparto' });
    await expect(pulsante).toBeDisabled();
    await expect(secondo.locator('.obj-blocked-hint')).toContainText('Servono 8.763 fucili');
  });

  test('catene e convenzioni sono dichiarate, non inventate dalla UI', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await block.locator('.obj-why.block summary').click();
    await expect(block.locator('.obj-chain')).toContainText('Minerali e industria → armamenti');
    await expect(block.locator('.obj-chain')).toContainText('La filiera si rompe a valle');
    await expect(block.locator('.obj-conventions')).toContainText('Le armate derivano dagli oggetti');
  });

  test('la sala di governo si legge in verticale, senza traboccamenti', async ({ page }) => {
    installMockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await reachHud(page);
    const block = await openSalaDiGoverno(page);

    await expect(block.locator('.obj-sector')).toHaveCount(3);
    await block.locator('.obj-sector', { hasText: 'Forze armate' }).locator('.obj-open').click();
    await expect(block.locator('.obj-object').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
