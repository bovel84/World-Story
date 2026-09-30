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
  test('un solo modulo attivo alla volta (Governo → Nazione)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // Nessun modulo aperto all'ingresso: la mappa è libera.
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Apri «Governo»: il pannello azioni è visibile.
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    await expect(page.locator('.suggestions-content')).toBeVisible();
    await expect(page.locator('.nation-desk')).toBeHidden();

    // Chiudi e apri «Nazione»: il pannello azioni sparisce, il dossier appare.
    await page.locator('.suggestions-content .desk-close-x').click();
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();
    await expect(page.locator('.suggestions-content')).toHaveCount(0);
  });

  test('U02: Registro degli atti — un ordine in coda si legge e si ritira', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // WS-GOVOFFICE-03 — Il compositore libero è uscito dall'Ufficio. L'ordine
    // nasce dal dialogo con un ministro; qui si verifica che il **registro**
    // (prima schermata) lo legga e che **«Ritira»** lo tolga dalla coda.
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    await expect(page.locator('.suggestions-content')).toBeVisible();

    // Registro vuoto all'apertura: nessun atto firmato.
    const registro = page.locator('.order-register');
    await expect(registro).toBeVisible();
    await expect(registro.locator('.order-register-act')).toHaveCount(0);
    await expect(registro).toContainText('Nessun atto firmato');

    // Concludi una seduta con un ordine dal dialogo.
    await page.locator('.cabinet-pick').first().click();
    const chat = page.locator('.minister-chat');
    await chat.locator('textarea').fill('Costruire una ferrovia verso il confine');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant')).toContainText('ha preso nota del problema', { timeout: 15_000 });
    await chat.locator('.minister-draft-order').click();

    // L'atto è nel REGISTRO (prima schermata), non nella seduta.
    await page.locator('.government-office-back').click();
    await expect(registro.locator('.order-register-act').first())
      .toContainText('Costruire una ferrovia verso il confine');
    // La firma è in calce, una volta sola.
    await expect(registro.locator('.order-register-signature-office')).toHaveText('Il Presidente del Consiglio');
    // Nella seduta l'ordine NON si vede.
    await page.locator('.cabinet-pick').first().click();
    await expect(page.locator('.pending-item')).toHaveCount(0);
    await page.locator('.government-office-back').click();

    // Ritirare l'atto: l'unico modo per non eseguirlo prima del salto.
    await registro.locator('.order-register-withdraw').first().click();
    await expect(registro.locator('.order-register-act')).toHaveCount(0);
    await expect(registro).toContainText('Nessun atto firmato');
  });

  test('P04: Ufficio del Governo — registro, scelta, e la seduta a due pannelli', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // [1] SCELTA — Apri «Governo»: il registro degli atti e i riquadri dei
    // ministri. Niente item, chat, coda o compositore.
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await expect(ufficio).toBeVisible();
    await expect(ufficio).toHaveAttribute('aria-modal', 'true');
    await expect(ufficio.locator('#government-office-title')).toContainText('Ufficio del Governo');
    await expect(page.locator('.game-shell-desk')).toHaveCount(0);
    await expect(ufficio.locator('.order-register')).toBeVisible();
    await expect(ufficio.locator('.cabinet-pick')).toHaveCount(2);
    await expect(ufficio).toContainText('Ministro del Tesoro');
    await expect(ufficio.locator('.cabinet-item')).toHaveCount(0);
    await expect(ufficio.locator('.minister-chat')).toHaveCount(0);
    await expect(ufficio.locator('.pending-item')).toHaveCount(0);
    await expect(ufficio.locator('#free-player-order')).toHaveCount(0);

    // [2] SEDUTA — due pannelli: dialogo a sinistra, dati a destra.
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    await expect(chat.locator('.minister-chat')).toBeVisible();
    const dati = page.locator('.government-office-pane-dossier .minister-dossier');
    await expect(dati).toBeVisible();
    // WS-GOVOFFICE-05 — Il pannello dati è a scomparsa, chiuso di default.
    // Il contenuto si verifica aprendo il controllo: stessa sostanza di prima.
    const datiToggle = dati.locator('.minister-dossier-toggle');
    await expect(datiToggle).toHaveAttribute('aria-expanded', 'false');
    await datiToggle.click();
    await expect(datiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dati).toContainText('Ministro del Tesoro');
    // Il ministro parla in prima persona, con le cifre del motore.
    await expect(ufficio).toContainText('Coprire il disavanzo del trimestre.');
    await expect(dati).toContainText('misurato · Tesoro');
    // Il pannello mostra il dominio nazionale di quella sedia.
    await expect(dati.locator('.op-domain')).toHaveCount(2);

    // WS-GOVOFFICE-03 — Le «strade proposte» non stanno più nella seduta.
    await expect(ufficio.locator('.minister-path')).toHaveCount(0);

    // Il problema presentato dal giocatore riceve risposta, poi si conclude
    // con un ordine in un clic.
    await chat.locator('textarea').fill('Il porto di Alfa resta chiuso: servono fondi.');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant')).toContainText('ha preso nota del problema', { timeout: 15_000 });
    await chat.locator('.minister-draft-order').click();

    // L'atto è nel REGISTRO della prima schermata, non nella seduta.
    await page.locator('.government-office-back').click();
    await expect(ufficio.locator('.order-register-act').first())
      .toContainText('Il porto di Alfa resta chiuso');
    await expect(ufficio.locator('.order-register-signature-office')).toHaveText('Il Presidente del Consiglio');
  });

  test('P05: Ufficio del Governo — «Nulla di fatto» chiude la seduta senza atti', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    await expect(page.locator('.minister-chat')).toBeVisible();

    // Nessun atto nel registro mentre si discute.
    await expect(page.locator('.order-register-act')).toHaveCount(0);

    // L'esito NULLA DI FATTO: dichiarato, nessun ordine, ritorno alla scelta.
    await page.locator('.cabinet-nothing').click();
    await expect(ufficio.locator('.cabinet-pick')).toHaveCount(2);
    await expect(ufficio.locator('.order-register-act')).toHaveCount(0);
    await expect(page.locator('.government-office-outcome-note')).toContainText('nulla di fatto');
  });

  test('U03: Dossier Nazione — sezioni con default «Situazione»', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();

    // Default: sezione «Situazione» (sintesi + decisioni richieste).
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Situazione');
    await expect(page.locator('.nation-block[aria-label="Decisioni richieste"]')).toBeVisible();
    await expect(page.locator('.nation-synthesis[aria-label="Sintesi della nazione"]')).toBeVisible();

    // Le carte di sintesi mostrano la tendenza reale dalla storia (3 punti):
    // sparkline SVG + variazione rispetto al mese precedente.
    await expect(page.locator('.nation-spark').first()).toBeVisible();
    await expect(page.locator('.nation-trend').first()).toContainText('vs mese scorso');

    // Le schede non si tagliano fuori dalla colonna: prima Armamenti,
    // Conoscenze e Politiche restavano irraggiungibili su desktop.
    const deskBox = await page.locator('.game-shell-desk').boundingBox();
    const tabs = page.locator('.nation-dock-tab');
    await expect(tabs).toHaveCount(4);
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(deskBox.x + deskBox.width + 1);
    }
    const strip = await page.locator('.nation-dock-tabs').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(strip.scroll).toBeLessThanOrEqual(strip.client + 1);

    // Passa a «Progetti»: la percentuale di realizzazione è leggibile, non
    // solo una barra senza numero.
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Tesoro');
    const progetti = page.locator('.nation-block[aria-label="Progetti e processi"]');
    await expect(progetti).toContainText('Ferrovia transnazionale');
    await expect(progetti.locator('.nation-progress-pct').first()).toHaveText('38% completato');
    await expect(progetti.locator('[role="progressbar"]').first()).toHaveAttribute('aria-valuenow', '38');
    await expect(progetti).toContainText('esito previsto 30 set 1951');
    // Un progetto senza scadenza dichiarata resta «in corso», con la sua nota.
    await expect(progetti).toContainText('nessuna scadenza dichiarata');
    await expect(progetti.locator('.nation-progress-pct').nth(1)).toHaveText('35% completato');

    // Sezione «Governo»: le anime del consiglio premono per i loro interessi.
    await page.locator('.nation-dock-tab', { hasText: 'Regno' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Regno');
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
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    await expect(page.locator('.nation-dock-tab.active')).toHaveText('Tesoro');
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
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
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
    await page.locator('.nation-dock-tab', { hasText: 'Stato maggiore' }).click();
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
    // La formula è nel dettaglio richiudibile; i pesi restano dati visibili.
    const legenda = page.locator('details.nation-synthesis-detail', { hasText: 'Come si legge l\'arsenale' });
    await legenda.locator('summary').click();
    await expect(legenda).toContainText('quantità × qualità × peso del dominio');
    await expect(page.locator('.nation-block[aria-label="Peso dei domini"]')).toContainText('Forze di terra');
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

    // Governo: la richiesta di una fazione resta in LETTURA nel pannello del
    // consiglio. WS-GOVOFFICE-03 — il pulsante «Porta in consiglio» è uscito
    // insieme al compositore libero: non c'è più una bozza dove la richiesta
    // sarebbe diventata visibile, quindi non si promette un'azione che non c'è.
    await page.locator('.nation-dock-tab', { hasText: 'Regno' }).click();
    const governoOrdine = page.locator('.nation-block[aria-label="Consiglio dei ministri"]');
    await expect(governoOrdine).toContainText('Più fondi ai comandi');
    await expect(governoOrdine).toContainText('sollecita · urgenza');
    await expect(governoOrdine.locator('.nation-demand-order')).toHaveCount(0);
    await expect(governoOrdine).not.toContainText('Porta in consiglio');
  });

  test('U03 mobile: la barra moduli resta toccabile e apre il Dossier', async ({ page }) => {
    // Regressione: i controlli zoom della mappa (z-index inline alto) si
    // sovrapponevano alla barra moduli fissa e ne rubavano il tocco.
    await page.setViewportSize({ width: 390, height: 844 });
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Nazione"]').click();
    await expect(page.locator('.nation-desk')).toBeVisible();
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    await expect(page.locator('.nation-block[aria-label="Tesoreria e debito"]')).toContainText('185,85');
    // La diplomazia interna non deve coprire le schede (era un foglio fixed).
    await page.locator('.nation-dock-tab', { hasText: 'Tesoro' }).click();
    await expect(page.locator('.nation-block[aria-label="Magazzino materiale"]')).toBeVisible();
  });
});
