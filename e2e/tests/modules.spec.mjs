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

/**
 * WS-MINISTER-UX-06 — L'ordine d'opera che la strada «Investimento» compone dai
 * dati del mock. È la stessa stringa che `composeCabinetOrderText` produce: serve
 * al finto avanzamento per restituire l'esito **esatto** di quell'atto, con cui
 * la UI ricostruisce lo stato «eseguito».
 */
function composedInvestOrder() {
  return [
    'Aprire il cantiere',
    '— Aprire il cantiere della ferrovia transnazionale.',
    'Strada scelta: Impugna la dichiarazione d’opera e i detentori.',
    'Prerequisiti: nessuno',
    'Esito atteso: Cantiere avviato: 38% al prossimo turno.',
  ].join('\n');
}

/** Avanzamento con l'atto eseguito: l'`action.text` è quello firmato. */
function actionsProcessed(text) {
  return {
    type: 'actions_processed',
    simulationId: 'mock-simulation-2',
    revision: 2,
    processedCount: 1,
    actions: [
      {
        id: 'mock-action-1',
        text,
        status: 'completed',
        result: {
          narration: 'L’atto è stato eseguito dal motore.',
          events: ['Atti eseguiti'],
          eventDetails: [],
          outcome: { status: 'accepted', summary: 'Atto eseguito.' },
          objects: [],
          turn: 1,
          periodStart: '1951-01-01',
          periodEnd: '1951-02-01',
        },
      },
    ],
  };
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

    // [2] SEDUTA — UX-01: il dialogo a sinistra è la superficie principale, la
    //     tavola di lavoro a destra. Il saluto e il compositore sono visibili
    //     subito: non c'è un dossier da scorrere per arrivare alla chat.
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    await expect(chat.locator('.minister-chat')).toBeVisible();
    await expect(chat.locator('.minister-greeting')).toContainText('La cassa regge');
    await expect(chat.locator('.minister-compose textarea')).toBeVisible();

    // Il fascicolo della sedia (questioni e cifre) è a scomparsa: la chat non ha
    // più un dossier davanti.
    const brief = ufficio.locator('.seat-brief');
    await expect(brief.locator('.seat-brief-body')).toBeHidden();
    await brief.locator('.seat-brief-summary').click();
    await expect(brief).toContainText('Coprire il disavanzo del trimestre: 6,50 mld entro giugno.');
    await expect(ufficio).not.toContainText('6.5 mld');

    // WS-GOVOFFICE-07 / UX-01 — Lo spazio destro è la TAVOLA: l'atto del
    // Tesoro con le cifre del motore, la visualizzazione principale (piano a
    // cascata) e i supporti (mappa, grafico).
    const tavola = page.locator('.government-office-pane-table');
    const atto = tavola.locator('.treasury-act');
    await expect(atto).toBeVisible();
    await expect(atto).toContainText('Sul tavolo');

    const principale = tavola.locator('.seat-table-main .seat-canvas');
    const supporto = tavola.locator('.seat-table-support .seat-canvas');
    await expect(principale).toBeVisible();
    await expect(principale.locator('[data-kind="strategy"] .plan-diagram')).toBeVisible();
    await expect(supporto.locator('[data-kind="map"] .zone-map')).toBeVisible();
    await expect(supporto.locator('[data-kind="chart"] .advisor-chart').first()).toBeVisible();

    // Gli approfondimenti (chiusi di default) portano le cifre della sedia con
    // la loro provenienza e le idee del ministro.
    await tavola.locator('.seat-table-more-summary').click();
    const approfondimenti = tavola.locator('.seat-table-more .seat-canvas');
    await expect(approfondimenti).toContainText('12,40 mld');
    await expect(approfondimenti).toContainText('misurato · Tesoro');
    await expect(approfondimenti.locator('[data-kind="metrics"]').first()).toBeVisible();
    await expect(approfondimenti.locator('[data-kind="ideas"]')).toBeVisible();

    // L'atto porta sul tavolo la richiesta dei Lavori e le due strade firmabili.
    await expect(atto.locator('.treasury-act-request')).toContainText('Aprire il cantiere');
    await expect(atto.locator('.treasury-act-road')).toHaveCount(2);

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

  test('P04b: Ufficio del Governo — l’atto del Tesoro si prepara, si firma e finisce nel registro', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();

    // WS-GOVOFFICE-07 / UX-06 — La richiesta dei Lavori è in attesa sul tavolo;
    // preparare la strada d'investimento ne fa una bozza, senza accodare.
    const atto = page.locator('.government-office-pane-table .treasury-act');
    await expect(atto).toBeVisible();
    await expect(atto.locator('.treasury-act-request')).toHaveAttribute('data-state', 'pending');
    await atto.locator('.treasury-act-road[data-road="invest"] .treasury-act-prepare').click();

    const bozza = page.locator('.government-office-pane-table .act-draft');
    await expect(bozza).toBeVisible();
    await expect(bozza).toContainText('ordine d’opera supportato');
    await expect(bozza.locator('.act-draft-state')).toHaveText('preparato');
    // Preparare non accoda: il registro resta vuoto finché non si firma.
    await expect(ufficio.locator('.order-register-act')).toHaveCount(0);

    // La firma esplicita del Presidente: solo ora l'atto entra nel registro.
    await bozza.locator('.act-draft-sign').click();
    await expect(bozza.locator('.act-draft-state')).toHaveText('accodato');
    await expect(atto.locator('.treasury-act-request')).toHaveAttribute('data-state', 'accepted');
    await expect(atto.locator('.treasury-act-request-label')).toContainText('accolta');

    // L'atto firmato è nel REGISTRO della prima schermata, non resta una promessa.
    await page.locator('.government-office-back').click();
    await expect(ufficio.locator('.order-register-act').first()).toContainText('Aprire il cantiere');
  });

  test('P04c: Ufficio del Governo — la conversazione guida la tavola (UX-03)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    const tavola = page.locator('.government-office-pane-table');

    // Senza richiesta la tavola è quella predefinita: niente banner, piano in cima.
    await expect(tavola.locator('.seat-presentation-banner')).toHaveCount(0);
    await expect(tavola.locator('.seat-table-main [data-kind="strategy"]')).toBeVisible();

    // [1] «Mi mostri dove va la spesa?» → il grafico pertinente sale in cima.
    await chat.locator('textarea').fill('Mi mostri dove va la spesa?');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)')).toContainText('ha preso nota del problema', { timeout: 15_000 });
    // Il blocco di presentazione non è mai prosa visibile.
    await expect(chat).not.toContainText('```');
    await expect(chat).not.toContainText('"op"');
    const banner = tavola.locator('.seat-presentation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Dove va la spesa');
    await expect(tavola.locator('.seat-table-main [data-kind="chart"] .advisor-chart')).toBeVisible();

    // [2] «Confronta le due strade» → il confronto, dalle strade del motore.
    await chat.locator('textarea').fill('Confronta le due strade');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
    await expect(tavola.locator('.proposal-comparison')).toBeVisible();
    await expect(tavola.locator('.proposal-comparison')).toContainText('Ammortamento del debito');
    await expect(tavola.locator('.proposal-comparison')).toContainText('Investimento');

    // [3] Isolamento: la tavola di un'altra sedia non eredita la presentazione.
    await page.locator('.government-office-back').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
    await expect(page.locator('.government-office-pane-table .seat-presentation-banner')).toHaveCount(0);

    // [4] Tornare alla tavola predefinita chiude l'evidenza presentata.
    await page.locator('.government-office-back').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const bannerBack = page.locator('.government-office-pane-table .seat-presentation-banner');
    await expect(bannerBack).toBeVisible();
    await page.locator('.government-office-pane-table .seat-presentation-clear').click();
    await expect(bannerBack).toHaveCount(0);
  });

  test('P04d: Ufficio del Governo — mappa focalizzata e limiti delle conseguenze (UX-04)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    const tavola = page.locator('.government-office-pane-table');

    // [1] «Quali province coinvolge?» → la mappa sale in cima, inquadrata sulla
    //     geometria reale e con la zona in evidenza.
    await chat.locator('textarea').fill('Quali province coinvolge?');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)')).toContainText('ha preso nota del problema', { timeout: 15_000 });
    const mappa = tavola.locator('.seat-table-main [data-kind="map"]');
    await expect(mappa).toBeVisible();
    await expect(mappa.locator('.zone-map-svg')).toHaveAttribute('viewBox', '-4 -4 108 108');
    await expect(mappa.locator('.zone-map-shape.focused')).toBeVisible();
    await expect(mappa.locator('.zone-map-legend')).toContainText('Alfa');

    // [2] «Confronta le due strade» → le stesse dimensioni per ogni strada, con i
    //     limiti dichiarati e la catena delle conseguenze.
    await chat.locator('textarea').fill('Confronta le due strade');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
    const confronto = tavola.locator('.proposal-comparison');
    await expect(confronto).toContainText('Spesa ricorrente');
    await expect(confronto).toContainText('Incertezza');
    await expect(confronto).toContainText('non dichiarato dal motore');
    await expect(confronto.locator('.proposal-flow-step.kind-not-simulated').first()).toBeVisible();
    await expect(confronto).toContainText('non simulato');
  });

  test('P04e: Ufficio del Governo — la memoria della sedia sopravvive a ministro e ricarica (UX-05)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    const tavola = page.locator('.government-office-pane-table');

    // Un atto firmato e una proposta discussa: due ricordi di specie diversa.
    await tavola.locator('.treasury-act-road[data-road="invest"] .treasury-act-prepare').click();
    await tavola.locator('.act-draft-sign').click();
    await chat.locator('textarea').fill('Confronta le due strade');
    await chat.locator('.minister-compose button').click();
    await expect(tavola.locator('.proposal-comparison')).toBeVisible({ timeout: 15_000 });

    // Il fascicolo dice cosa ricorda il ministro, distinguendo l'atto dalla proposta.
    await page.locator('.seat-brief-summary').click();
    const memoria = page.locator('.seat-brief-memory');
    await expect(memoria).toBeVisible();
    await expect(memoria).toContainText('Cosa ricorda il ministro');
    await expect(memoria).toContainText('Atto accodato: Aprire il cantiere');
    await expect(memoria).toContainText('accodata');
    await expect(memoria).toContainText('discussa');

    // Cambiare ministro e tornare non la perde.
    await page.locator('.government-office-back').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro dei Lavori' }).click();
    await page.locator('.government-office-back').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    await page.locator('.seat-brief-summary').click();
    await expect(page.locator('.seat-brief-memory')).toContainText('Atto accodato: Aprire il cantiere');

    // Ricaricare il browser non la perde: la memoria vive per partita nel browser.
    await page.reload();
    try {
      await page.waitForSelector('.game-shell', { timeout: 12_000 });
    } catch {
      await reachHud(page);
    }
    await page.locator('.rail-btn[aria-label="Governo"]').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    await page.locator('.seat-brief-summary').click();
    await expect(page.locator('.seat-brief-memory')).toContainText('Atto accodato: Aprire il cantiere');
  });

  test('P06: Ufficio del Governo — dalla proposta alla decisione, con esito reale (UX-06)', async ({ page }) => {
    const ordine = composedInvestOrder();
    installMockApi(page, { advanceResult: actionsProcessed(ordine) });
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const tavola = page.locator('.government-office-pane-table');

    // [1] «Confronta le strade» dal tavolo: mostra, non accoda e non spende.
    await tavola.locator('.seat-table-compare').click();
    await expect(tavola.locator('.proposal-comparison')).toBeVisible();
    await expect(ufficio.locator('.order-register-act')).toHaveCount(0);

    // [2] «Prepara l'atto»: bozza correggibile, ancora nessun atto nel registro.
    await tavola.locator('.treasury-act-road[data-road="invest"] .treasury-act-prepare').click();
    const bozza = tavola.locator('.act-draft');
    await expect(bozza).toBeVisible();
    await expect(bozza.locator('.act-draft-state')).toHaveText('preparato');
    await expect(bozza).toContainText('ordine d’opera supportato');
    await expect(ufficio.locator('.order-register-act')).toHaveCount(0);

    // [3] «Modifica proposta»: il testo è del Presidente. Lo si corregge e si
    //     riporta all'atto voluto; la dichiarazione d'opera non cambia.
    await bozza.locator('.act-draft-text').fill('Testo corretto dal Presidente');
    await expect(bozza.locator('.act-draft-text')).toHaveValue('Testo corretto dal Presidente');
    await bozza.locator('.act-draft-text').fill(ordine);

    // [4] La firma esplicita: l'atto entra nel registro, una volta sola.
    await bozza.locator('.act-draft-sign').click();
    await expect(bozza.locator('.act-draft-state')).toHaveText('accodato');
    await page.locator('.government-office-back').click();
    await expect(ufficio.locator('.order-register-act')).toHaveCount(1);
    await expect(ufficio.locator('.order-register-act').first()).toContainText('Aprire il cantiere');

    // [5] Tempo: il motore esegue l'atto. Riaprendo il tavolo la bozza ritrovata
    //     dichiara lo stato **reale** — dalla cronologia, non da un flag locale.
    await page.locator('.government-office .desk-close-x').click();
    await page.locator('.hud-advance-btn').click();
    await expect(page.locator('.time-desk-content')).toBeVisible();
    await page.locator('.time-desk-next').click();

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    await page.locator('.government-office-pane-table .treasury-act-road[data-road="invest"] .treasury-act-prepare').click();
    const bozzaDopo = page.locator('.government-office-pane-table .act-draft');
    await expect(bozzaDopo.locator('.act-draft-state')).toHaveText('eseguito');
    await expect(page.locator('.government-office-pane-table .treasury-act-request')).toHaveAttribute('data-state', 'accepted');
  });

  test('P07: Ufficio del Governo — la voce di spesa in evidenza e l’evidenza fissata (UX-07)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await page.locator('.rail-btn[aria-label="Governo"]').click();
    const ufficio = page.locator('.government-office');
    await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
    const chat = page.locator('.government-office-pane-chat');
    const tavola = page.locator('.government-office-pane-table');
    const banner = tavola.locator('.seat-presentation-banner');

    // [1] A2 — la spesa discute la sanità: la voce pertinente è in evidenza,
    //     non il saldo. La focus label è quella del read model del bilancio.
    await chat.locator('textarea').fill('Mi mostri dove va la spesa per la sanità?');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)')).toContainText('ha preso nota del problema', { timeout: 15_000 });
    await expect(banner).toContainText('Dove va la spesa — Sanità e assistenza');
    await expect(tavola.locator('.advisor-chart-bars li.focused')).toContainText('Sanità e assistenza');

    // [2] C — l'evidenza si fissa: una nuova richiesta non la sostituisce.
    await tavola.locator('.seat-presentation-pin').click();
    await expect(banner).toHaveAttribute('data-pinned', 'true');
    await expect(tavola.locator('.seat-presentation-pin')).toHaveText('Evidenza fissata');
    await chat.locator('textarea').fill('Confronta le due strade');
    await chat.locator('.minister-compose button').click();
    await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
    await expect(banner).toContainText('Dove va la spesa');
    await expect(tavola.locator('.proposal-comparison')).toHaveCount(0);

    // [3] Sbloccando, la conversazione torna a guidare la tavola.
    await tavola.locator('.seat-presentation-pin').click();
    await expect(banner).not.toHaveAttribute('data-pinned', 'true');
    await chat.locator('textarea').fill('Confronta le due strade');
    await chat.locator('.minister-compose button').click();
    await expect(tavola.locator('.proposal-comparison')).toBeVisible();
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
