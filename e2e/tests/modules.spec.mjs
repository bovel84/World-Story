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
    // La stima dichiara *quanto* costa l'ordine e da dove esce il denaro:
    // la cassa deve risentire delle scelte del giocatore.
    const verifica = page.locator('.feasibility-check');
    await expect(verifica).toContainText('Spesa stimata · Infrastrutture');
    await expect(verifica).toContainText('Tesoreria');
    await expect(verifica).toContainText('12,40 mld');
    await expect(verifica).toContainText('25% del gettito annuo');
    await expect(verifica).toContainText('il paese va in debito');
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

    // Le schede non si tagliano fuori dalla colonna: prima Armamenti,
    // Conoscenze e Politiche restavano irraggiungibili su desktop.
    const deskBox = await page.locator('.game-shell-desk').boundingBox();
    const tabs = page.locator('.nation-dock-tab');
    await expect(tabs).toHaveCount(8);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(deskBox.x + deskBox.width + 1);
    }
    const strip = await page.locator('.nation-dock-tabs').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(strip.scroll).toBeLessThanOrEqual(strip.client + 1);

    // Passa a «Progetti»: la percentuale di realizzazione è leggibile, non
    // solo una barra senza numero.
    await page.locator('.nation-dock-tab', { hasText: 'Progetti' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Progetti');
    const progetti = page.locator('.nation-block[aria-label="Progetti e processi"]');
    await expect(progetti).toContainText('Ferrovia transnazionale');
    await expect(progetti.locator('.nation-progress-pct').first()).toHaveText('38% completato');
    await expect(progetti.locator('[role="progressbar"]').first()).toHaveAttribute('aria-valuenow', '38');
    await expect(progetti).toContainText('esito previsto 30 set 1951');
    // Un progetto senza scadenza dichiarata resta «in corso», con la sua nota.
    await expect(progetti).toContainText('nessuna scadenza dichiarata');
    await expect(progetti.locator('.nation-progress-pct').nth(1)).toHaveText('35% completato');

    // Sezione «Governo»: le anime del consiglio premono per i loro interessi.
    await page.locator('.nation-dock-tab', { hasText: 'Governo' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Governo');
    const governo = page.locator('.nation-block[aria-label="Consiglio dei ministri"]');
    await expect(governo).toBeVisible();
    await expect(governo).toContainText('Forze armate');
    await expect(governo).toContainText('Lavoro e sindacati');
    await expect(governo.locator('.nation-faction-card')).toHaveCount(7);
    await expect(governo.locator('.nation-faction-card.is-dominant')).toContainText('Dominante');
    await expect(governo.locator('.nation-faction-card.is-angriest')).toContainText('Preme di più');
    // Le anime parlano con il motore LLM: la petizione è prosa, non statistica.
    await expect(governo.locator('.nation-faction-voice')).toHaveCount(7);
    await expect(governo).toContainText('servono mezzi e riserve addestrate');
    await expect(governo).toContainText('Il consiglio si stringe attorno al bilancio');

    // Sezione «Cassa»: la valuta è la cifra centrale, con variazione reale e
    // mai letta come zero quando il magazzino è annidato in `stock`.
    await page.locator('.nation-dock-tab', { hasText: 'Cassa' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Cassa');
    const cassa = page.locator('.nation-block[aria-label="Tesoreria e debito"]');
    await expect(cassa).toBeVisible();
    await expect(cassa.locator('.nation-metric').first()).toContainText('Tesoreria');
    await expect(cassa.locator('.nation-metric').first()).toContainText('185,85');
    await expect(cassa.locator('.nation-spark').first()).toBeVisible();
    await expect(cassa.locator('.nation-trend').first()).toContainText('vs mese scorso');
    // Portafoglio del debito: titoli con tasso e scadenza, interessi annui,
    // tasso di mercato e la possibilità di fare nuovo debito.
    const debito = cassa.locator('.nation-debt-block');
    await expect(debito).toBeVisible();
    await expect(debito).toContainText('Portafoglio del debito');
    await expect(debito).toContainText('Titolo 10 anni');
    await expect(debito).toContainText('scadenza');
    await expect(debito).toContainText('Interessi annui');
    const borrow = debito.locator('.nation-borrow');
    await expect(borrow).toBeVisible();
    await expect(borrow.locator('button')).toBeEnabled();
    await expect(borrow).toContainText('Spazio disponibile');
    // Composizione del bilancio: le voci dietro i totali pubblicati dal motore.
    const composizione = page.locator('.nation-block[aria-label="Composizione del bilancio"]');
    await expect(composizione).toBeVisible();
    await expect(composizione).toContainText('Imposta sul reddito');
    await expect(composizione).toContainText('Difesa');
    await expect(composizione).toContainText('Istruzione e ricerca');
    // Il verdetto dice a colpo d'occhio come sta andando la nazione.
    await page.locator('.nation-dock-tab', { hasText: 'Situazione' }).click();
    const verdetto = page.locator('.nation-verdict');
    await expect(verdetto).toBeVisible();
    await expect(verdetto.locator('.nation-verdict-head')).toContainText('Come sta andando');

    // Nessuna duplicazione: la tesoreria non compare nel magazzino materiale.
    await page.locator('.nation-dock-tab', { hasText: 'Risorse e industria' }).click();
    const magazzino = page.locator('.nation-block[aria-label="Magazzino materiale"]');
    await expect(magazzino).toBeVisible();
    await expect(magazzino).toContainText('Cibo');
    await expect(magazzino).toContainText('capacità');
    await expect(magazzino).toContainText('mesi di copertura');
    await expect(magazzino).not.toContainText('Tesoreria');
    // La disponibilità dipende dal paese: il Dossier dice da dove viene.
    const capacita = page.locator('.nation-block[aria-label="Capacità produttive e territoriali"]');
    await expect(capacita).toContainText('Da dove viene la disponibilità');
    await expect(capacita).toContainText('PIL 100 mld');
    await expect(capacita).toContainText('1 provincia costiera');
    await expect(capacita).toContainText('2 dal profilo del paese');
    await expect(capacita).toContainText('2 fabbriche, 1 porto, 1 università, 2 reparti');
    // La stessa infrastruttura non è ripetuta in Armamenti.
    await page.locator('.nation-dock-tab', { hasText: 'Armamenti' }).click();
    await expect(page.locator('.nation-block[aria-label="Forza dell\'arsenale"]')).not.toContainText('Università');

    // L'arsenale spiega *che cos'è* ogni mezzo: ruolo, descrizione,
    // caratteristiche e peso sulla forza — non solo «×37».
    const arsenale = page.locator('.nation-block[aria-label="Arsenale"]');
    await expect(arsenale).toBeVisible();
    await expect(arsenale).toContainText('Arma individuale della fanteria di linea');
    await expect(arsenale).toContainText('Calibro');
    await expect(arsenale).toContainText('5,56 / 7,62 mm');
    await expect(arsenale).toContainText('37 in servizio');
    await expect(arsenale).toContainText('% dell\'arsenale');
    // ...e spiega come leggere le cifre.
    const legenda = page.locator('.nation-block[aria-label="Come si legge l\'arsenale"]');
    await expect(legenda).toContainText('quantità × qualità × peso del dominio');
    await expect(legenda).toContainText('Forze di terra');
    // Produzione in corso: percentuale e data prevista leggibili.
    const produzione = page.locator('.nation-block[aria-label="Produzione in corso"]');
    await expect(produzione.locator('.nation-progress-pct').first()).toHaveText('42% completato');
    await expect(produzione.locator('[role="progressbar"]').first()).toHaveAttribute('aria-valuenow', '42');
    await expect(produzione).toContainText('consegna prevista 20 giu 1951');
    await expect(produzione).toContainText('imprevisto');
    // Il catalogo dice cosa si compra, con i requisiti in chiaro.
    await expect(page.locator('.arms-item-details').first()).toContainText('Che cos\'è e cosa sa fare');
    const aria = page.locator('.arms-domain', { hasText: 'Aeronautica' });
    await expect(aria).toContainText('Superiorità aerea e penetrazione');
    await expect(aria).toContainText('Requisiti non soddisfatti');
    await expect(aria).toContainText('manca la tecnologia Aeronautica avanzata');
    await expect(aria).toContainText('servono 5 fabbriche (ne hai 2)');

    // Governo: una richiesta diventa un ordine reale. «Porta in consiglio»
    // riempie la bozza e apre il compositore, senza spendere nulla.
    await page.locator('.nation-dock-tab', { hasText: 'Governo' }).click();
    const governoOrdine = page.locator('.nation-block[aria-label="Consiglio dei ministri"]');
    await governoOrdine.locator('.nation-demand-order').first().click();
    await expect(page.locator('#free-player-order')).toContainText('Difesa');
    await expect(page.locator('#free-player-order')).toContainText('copertura di bilancio');
  });

  test('U03 mobile: la barra moduli resta toccabile e apre il Dossier', async ({ page }) => {
    // Regressione: i controlli zoom della mappa (z-index inline alto) si
    // sovrapponevano alla barra moduli fissa e ne rubavano il tocco.
    await page.setViewportSize({ width: 390, height: 844 });
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();
    await page.locator('.nation-dock-tab', { hasText: 'Cassa' }).click();
    await expect(page.locator('.nation-block[aria-label="Tesoreria e debito"]')).toContainText('185,85');
    // La diplomazia interna non deve coprire le schede (era un foglio fixed).
    await page.locator('.nation-dock-tab', { hasText: 'Risorse e industria' }).click();
    await expect(page.locator('.nation-block[aria-label="Magazzino materiale"]')).toBeVisible();
  });
});
