/**
 * World Story — E2E mock: MATERIEL-CLARITY
 * =======================================
 *
 * «Armamenti o risorse non so quante ne ho e se ne sto producendo o altro: deve
 * essere più chiaro e rapido per il giocatore.»
 *
 * Verifica nel browser, offline e con API mockate:
 *  1. nella scheda «Risorse e industria» c'è una riga di sintesi per materiale
 *     con disponibilità, produzione/mese, consumo/mese, saldo con segno
 *     (verde = avanzo, rosso = deficit) e stato (critico per il carburante);
 *  2. nella scheda «Armamenti» la sintesi viene **prima** del dettaglio tecnico:
 *     le scorte di armamenti con il loro saldo, la fotografia dell'arsenale e,
 *     per ogni mezzo, quante unità sono in servizio e quante in produzione;
 *  3. il dettaglio tecnico (calibro, gittata…) esiste ancora ma è in una
 *     sezione espandibile, non più al primo livello.
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

async function openDossierSection(page, section) {
  // Il Dossier Nazione è un modulo della scrivania: prima si apre il rail.
  await page.locator('.rail-btn[aria-label="Nazione"]').click();
  await expect(page.locator('.nation-dock')).toBeVisible();
  await page.locator('.nation-dock-tab', { hasText: section }).click();
}

test.describe('MATERIEL-CLARITY — quanto ho, quanto produco, avanzo o deficit', () => {
  test('Risorse e industria: riga di sintesi per materiale, con segno e stato', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await openDossierSection(page, 'Risorse e industria');

    const magazzino = page.locator('.nation-block[aria-label="Magazzino materiale"]');
    await expect(magazzino).toContainText('Ritmo del mese');

    // Una riga per materiale, con le quattro cifre che servono a decidere.
    const rows = magazzino.locator('.material-balance-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'Cibo' })).toContainText('Produce');
    await expect(rows.filter({ hasText: 'Cibo' })).toContainText('Consuma');
    await expect(rows.filter({ hasText: 'Cibo' })).toContainText('Saldo');
    await expect(rows.filter({ hasText: 'Cibo' })).toContainText('+0,40/mese');

    // Avanzo: saldo verde. Deficit: saldo rosso e stato critico.
    await expect(rows.filter({ hasText: 'Armamenti' }).locator('dd.tone-positive')).toContainText('+0,30/mese');
    const carburante = rows.filter({ hasText: 'Carburante' });
    await expect(carburante).toHaveClass(/state-critico/);
    await expect(carburante.locator('dd.tone-negative')).toContainText('−0,50/mese');
    await expect(carburante).toContainText('critico');
    await expect(carburante).toContainText('meno di un mese di copertura');
  });

  test('Armamenti: la sintesi viene prima, il dettaglio tecnico resta espandibile', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await openDossierSection(page, 'Armamenti');

    // 1) Sintesi in testa alla scheda: scorte di armamenti + fotografia.
    const sintesi = page.locator('.nation-block[aria-label="Quanto hai e quanto produci"]');
    await expect(sintesi).toBeVisible();
    await expect(sintesi).toContainText('Disponibilità');
    await expect(sintesi).toContainText('160,0 / 200,0');
    await expect(sintesi).toContainText('+0,30/mese');
    await expect(sintesi).toContainText('2 voci · 43 unità in servizio · 1 ordine in corso (40 pezzi)');
    // OP-OBJECTS PERSISTENT: dove sono i pezzi — deposito o assegnati a un oggetto.
    await expect(sintesi).toContainText('deposito 42 · assegnato 1 su 43');
    // Solo le scorte che alimentano l'arsenale: il resto vive in Risorse.
    await expect(sintesi.locator('.material-balance-row')).toHaveCount(1);
    await expect(sintesi).not.toContainText('Carburante');

    // 2) Per ogni mezzo: quante unità in servizio e quante in produzione.
    const arsenale = page.locator('.nation-block[aria-label="Arsenale"]');
    const fucili = arsenale.locator('.arms-line-card', { hasText: 'Fucili' });
    await expect(fucili.locator('.arms-line-summary')).toContainText('×37 in servizio');
    await expect(fucili.locator('.arms-line-summary')).toContainText('in produzione ×40 (42%, consegna 20 giu 1951)');
    const carri = arsenale.locator('.arms-line-card', { hasText: 'Carri armati' });
    await expect(carri.locator('.arms-line-summary')).toContainText('nessun ordine in corso');

    // 3) Il dettaglio tecnico è chiuso (non è più il primo livello)…
    const dettaglio = fucili.locator('details.arms-line-detail');
    await expect(dettaglio).toHaveJSProperty('open', false);
    await expect(fucili.locator('.arms-specs')).toBeHidden();
    // …ma resta disponibile: si apre e mostra calibro e gittata.
    await dettaglio.locator('summary').click();
    await expect(fucili.locator('.arms-specs')).toBeVisible();
    await expect(fucili).toContainText('5,56 / 7,62 mm');
    await expect(fucili).toContainText('Arma individuale della fanteria di linea');

    // La scheda resta leggibile: il riepilogo della forza non è stato toccato.
    await expect(page.locator('.nation-block[aria-label="Forza dell\'arsenale"]')).toContainText('Potenza effettiva');
  });

  test('senza bilancio pubblicato dal motore non compare alcun numero inventato', async ({ page }) => {
    installMockApi(page, { resources: { balance: null } });
    await reachHud(page);
    await openDossierSection(page, 'Armamenti');
    const sintesi = page.locator('.nation-block[aria-label="Quanto hai e quanto produci"]');
    await expect(sintesi).toContainText('Il motore non pubblica il bilancio');
    await expect(sintesi.locator('.material-balance-row')).toHaveCount(0);
    // La fotografia dell'arsenale resta (viene da un'altra fonte del motore).
    await expect(sintesi).toContainText('unità in servizio');
  });
});
