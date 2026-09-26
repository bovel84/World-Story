/**
 * World Story — E2E mock: COUNTRY-CLARITY
 * ======================================
 *
 * «Voglio capire come sta il mio paese senza interpretare decine di numeri
 * isolati.» Verifica, nel browser offline e con API mockate, che il Dossier si
 * apra sul **Quadro d'insieme**: stato complessivo, cinque domini con le loro
 * cifre e la sala operativa con le risposte brevi; e che da lì si arrivi al
 * dettaglio senza cercare.
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

async function openDossier(page) {
  await page.locator('.rail-btn[aria-label="Nazione"]').click();
  await expect(page.locator('.nation-dock')).toBeVisible();
  // La sintesi è la prima lettura; il quadro completo è un dettaglio richiudibile.
  await page.locator('details.nation-synthesis-detail > summary').click();
  await expect(page.locator('.op-board')).toBeVisible();
}

test.describe('COUNTRY-CLARITY — un solo schermo per capire il paese', () => {
  test('il Dossier si apre sul quadro d’insieme con stato, domini e attenzioni', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await openDossier(page);

    const board = page.locator('.op-board');
    await expect(board).toBeVisible();
    await expect(board.locator('.nation-block-title')).toHaveText('Quadro d’insieme');
    await expect(board.locator('.op-verdict .op-status')).toHaveText(/^(Solido|Stabile|Sotto pressione|Fragile|Critico)$/);

    // Sei domini: economia, risorse, industria, forze, popolo e governo.
    await expect(board.locator('.op-domain')).toHaveCount(6);
    await expect(board.locator('.op-domain', { hasText: 'Economia e cassa' })).toBeVisible();
    await expect(board.locator('.op-domain', { hasText: 'Forze armate' }).locator('.op-facts dd').first()).not.toBeEmpty();
    await expect(board.locator('.op-attention')).toContainText('Da decidere per primo');
  });

  test('la sala operativa risponde alle domande del giocatore, senza manuali', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await openDossier(page);

    const answers = page.locator('.op-board .op-answer');
    await expect(answers).toHaveCount(20);
    const answer = (question) => answers.filter({ hasText: question }).locator('b');

    await expect(answer('Come sta il paese?')).not.toBeEmpty();
    await expect(answer('Qual è il problema più urgente?')).not.toBeEmpty();
    await expect(answer('Quante forze ho sotto le armi?')).toHaveText('55.000 uomini · 5 reparti');
    await expect(answer('Quanti reparti sono mobilitati?')).toHaveText('2 reparti');
    await expect(answer('Con quali equipaggiamenti combattono?')).toHaveText('2 categorie in servizio');
    await expect(answer('Sono equipaggiati a sufficienza?')).toContainText('Copertura più debole');
    await expect(answer('Quanto carburante possiedo?')).toHaveText('1,0 mesi');
    await expect(answer('Quanto tempo posso sostenere le operazioni?')).toContainText('Prontezza');
    await expect(answer('Che cosa producono le mie fabbriche?')).not.toBeEmpty();
    await expect(answer('Quanto della capacità industriale sto usando?')).toContainText('%');
    await expect(answer('Quali devo importare?')).not.toBeEmpty();
    await expect(answer('Quanto produce e quanto spende il paese?')).not.toBeEmpty();
    await expect(answer('Sto accumulando debito?')).toContainText('del PIL');
    await expect(answer('Quale fazione politica mi sostiene?')).not.toBeEmpty();
    await expect(answer('Quale fazione è arrabbiata e perché?')).not.toBeEmpty();
    await expect(answer('Quali progetti sono in corso e cosa li rallenta?')).not.toBeEmpty();
    await expect(answer('Quali promesse sto mantenendo o tradendo?')).toContainText('mantenute');
    await expect(answer('Quanta ricerca ho e che cosa ho sbloccato?')).toContainText('punti ricerca');
    await expect(answer('Che infrastrutture ho?')).toContainText('stabilimenti');
  });

  test('dal dominio si salta al dettaglio, e il dettaglio ripete gli stessi numeri', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);
    await openDossier(page);

    const military = page.locator('.op-domain', { hasText: 'Forze armate' });
    await military.locator('.op-goto', { hasText: 'Apri Stato maggiore' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Stato maggiore');

    // Il quadro del dominio apre la sezione: stessi numeri, più dettaglio.
    const quadro = page.locator('.nation-block[aria-label="Quadro delle forze armate"]');
    await expect(quadro).toBeVisible();
    await expect(quadro).toContainText('Uomini in armi');
    await expect(quadro).toContainText('Prontezza');
    await expect(quadro).toContainText('Copertura armi individuali');
    // La scheda delle forze armate mostra personale, copertura e prontezza:
    // le stesse cifre del quadro, con il dettaglio che serve a decidere.
    await expect(quadro).toContainText('Dottrina d’epoca: Guerra fredda');
    await expect(quadro).toContainText('Personale');
    await expect(quadro).toContainText('Riserva addestrata');
    // Le armi individuali sono una quota degli uomini in armi, non 40 per reparto.
    await expect(quadro).toContainText('80% degli uomini in armi');
    await expect(quadro).toContainText('Equipaggiamento — copertura per categoria');
    await expect(quadro).toContainText('mancano 43.963 pezzi');
    await expect(quadro).toContainText('Prontezza operativa');
    await expect(page.locator('.nation-block[aria-label="Quanto hai e quanto produci"]')).toBeVisible();

    // Anche le altre sezioni tematiche partono dal loro quadro.
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    await expect(page.locator('.nation-block[aria-label="Quadro economico"]')).toContainText('Debito / PIL');
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    const industria = page.locator('.nation-block[aria-label="Quadro di risorse e industria"]');
    await expect(industria).toContainText('Capacità usata');
    // La scheda dell'industria mostra stabilimenti, assegnazioni e produzioni.
    await expect(industria).toContainText('Linee di lavorazione');
    await expect(industria).toContainText('Assegnazioni');
    await expect(industria).toContainText('Ferrovia transnazionale');
    await expect(industria).toContainText('Produzioni militari');
    await expect(industria).toContainText('consegnate 0');
    await page.locator('.nation-dock-tab', { hasText: 'Regno' }).click();
    await expect(page.locator('.nation-block[aria-label="Quadro del governo"]')).toContainText('Fazioni insoddisfatte');
  });

  test('il quadro si legge anche in verticale (mobile)', async ({ page }) => {
    installMockApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await reachHud(page);
    await openDossier(page);

    await expect(page.locator('.op-board')).toBeVisible();
    await expect(page.locator('.op-domain')).toHaveCount(6);
    // Nessun traboccamento orizzontale: il quadro sta nella larghezza dello schermo.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
