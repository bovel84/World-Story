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
import {
  openGovernment, openCouncilRoom, openBoard, ask, prepareCommonDraft, sign, backToPicker,
} from './helpers/government.mjs';

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

/**
 * Percorso canonico della Sala del Consiglio: apre la seduta con il Tesoro come
 * relatore e attende il saluto, così i conteggi delle risposte non corrono.
 */
async function openTesoroRoom(page) {
  await openCouncilRoom(page, 'tesoro');
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
}

/** Dallo schermo di scelta già aperto: entra nella seduta con il Tesoro. */
async function openTesoroRoomFromPicker(page) {
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
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

    // Il registro è la prima schermata dell'Ufficio: vuoto finché non si firma.
    await openGovernment(page);
    const registro = page.locator('.order-register');
    await expect(registro).toBeVisible();
    await expect(registro.locator('.order-register-act')).toHaveCount(0);
    await expect(registro).toContainText('Nessun atto firmato');

    // Concludi una seduta con un ordine: nasce dalla bozza comune e si firma.
    await openTesoroRoomFromPicker(page);
    await ask(page, 'copertura finanziaria');
    await openBoard(page);
    await prepareCommonDraft(page);
    await sign(page);

    // L'atto è nel REGISTRO (prima schermata), non nella seduta.
    await backToPicker(page);
    await expect(registro).toBeVisible();
    await expect(registro.locator('.order-register-act').first()).toContainText('Copertura finanziaria');
    // La firma è in calce, una volta sola.
    await expect(registro.locator('.order-register-signature-office')).toHaveText('Il Presidente del Consiglio');

    // Ritirare l'atto: l'unico modo per non eseguirlo prima del salto.
    await registro.locator('.order-register-withdraw').first().click();
    await expect(registro.locator('.order-register-act')).toHaveCount(0);
    await expect(registro).toContainText('Nessun atto firmato');
  });

  test('P04: Sala del Consiglio — registro, scelta e seduta', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // [1] SCELTA — Apri «Governo»: il registro degli atti e i riquadri dei
    // ministri. Niente pannelli a due colonne, item, chat o compositore libero.
    await openGovernment(page);
    const ufficio = page.locator('.government-office');
    await expect(ufficio).toHaveAttribute('aria-modal', 'true');
    await expect(ufficio.locator('#government-office-title')).toContainText('Governo');
    await expect(page.locator('.game-shell-desk')).toHaveCount(0);
    await expect(ufficio.locator('.order-register')).toBeVisible();
    await expect(ufficio.locator('.cabinet-pick')).toHaveCount(2);
    await expect(ufficio).toContainText('Ministro del Tesoro');
    await expect(ufficio.locator('.cabinet-item')).toHaveCount(0);
    await expect(ufficio.locator('.minister-chat')).toHaveCount(0);
    await expect(ufficio.locator('.pending-item')).toHaveCount(0);
    await expect(ufficio.locator('#free-player-order')).toHaveCount(0);

    // [2] SEDUTA — la stanza condivisa si apre con saluto e compositore visibili.
    await openTesoroRoomFromPicker(page);
    await expect(page.locator('.council-room')).toBeVisible();
    await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
    await expect(page.locator('.council-room-compose textarea')).toBeVisible();

    // Il fascicolo della sedia è a scomparsa sulla Tavola: porta le cifre del
    // Tesoro con la loro provenienza, non un pannello sempre aperto.
    await openBoard(page);
    await page.locator('.council-board-evidence > summary').click();
    const dossier = page.locator('.council-board-dossier');
    await expect(dossier).toContainText('Ministro del Tesoro');
    await expect(dossier).toContainText('Cassa, debito e bilancio');
    await expect(dossier.locator('[data-block-id="cifre-sedia"]')).toContainText('Saldo di cassa');
    await expect(dossier.locator('[data-block-id="cifre-sedia"]')).toContainText('misurato · Tesoro');
    await expect(dossier.locator('[data-block-id="bilancio"]')).toBeVisible();
  });

  test('P04b: Sala del Consiglio — l’atto nasce dal dialogo e finisce nel registro', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    // La richiesta del Presidente produce una misura sulla Tavola condivisa.
    await openTesoroRoom(page);
    await ask(page, 'copertura finanziaria');

    // Preparare non accoda: la bozza nasce dalla discussione e resta «preparata».
    await openBoard(page);
    const bozza = await prepareCommonDraft(page);
    await expect(bozza.locator('.act-draft-capability')).toContainText('bozza testuale da valutare');
    await expect(bozza.locator('.act-draft-state')).toHaveText('preparato');

    // La firma esplicita del Presidente: solo ora l'atto entra nel registro.
    await sign(page);
    await expect(bozza.locator('.act-draft-state')).toHaveText('accodato');

    await backToPicker(page);
    await expect(page.locator('.order-register-act').first()).toContainText('Copertura finanziaria');
  });

  test('P04c: Sala del Consiglio — la conversazione guida la Tavola (UX-03)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await openTesoroRoom(page);

    // [1] «Mi mostri dove va la spesa?» → la card in linea apre il blocco reale
    // del bilancio sulla Tavola.
    await ask(page, 'Mi mostri dove va la spesa?');
    await expect(page.locator('.council-room-evidence-link').last()).toBeVisible();
    await page.locator('.council-room-evidence-link').last().click();
    await expect(page.locator('.council-room-drawer')).toBeVisible();
    const bilancio = page.locator('.council-board-focus-evidence [data-block-id="bilancio"]');
    await expect(bilancio).toBeVisible();
    await expect(bilancio.locator('.advisor-chart')).toBeVisible();

    // [2] «Confronta le due strade» → il confronto, dalle strade del motore.
    await ask(page, 'Confronta le due strade');
    await page.locator('.council-room-evidence-link').last().click();
    const confronto = page.locator('.council-board-focus-evidence .proposal-comparison');
    await expect(confronto).toBeVisible();
    await expect(confronto).toContainText('Ammortamento del debito');
    await expect(confronto).toContainText('Investimento');
  });

  test('P04d: Sala del Consiglio — mappa focalizzata e limiti delle conseguenze (UX-04)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await openTesoroRoom(page);

    // [1] «Quali province coinvolge?» → la mappa reale si apre inquadrata sulla
    // geometria del motore e con la zona in evidenza.
    await ask(page, 'Quali province coinvolge?');
    await page.locator('.council-room-evidence-link').last().click();
    const mappa = page.locator('.council-board-focus-evidence [data-block-id="zone"]');
    await expect(mappa).toBeVisible();
    await expect(mappa.locator('.zone-map-svg')).toHaveAttribute('viewBox', '-4 -4 108 108');
    await expect(mappa.locator('.zone-map-shape.focused')).toBeVisible();
    await expect(mappa.locator('.zone-map-legend')).toContainText('Alfa');

    // [2] «Confronta le due strade» → le stesse dimensioni per ogni strada, con i
    // limiti dichiarati e la catena delle conseguenze.
    await ask(page, 'Confronta le due strade');
    await page.locator('.council-room-evidence-link').last().click();
    const confronto = page.locator('.council-board-focus-evidence .proposal-comparison');
    await expect(confronto).toContainText('Spesa ricorrente');
    await expect(confronto).toContainText('Incertezza');
    await expect(confronto).toContainText('non dichiarato dal motore');
    await expect(confronto.locator('.proposal-flow-step.kind-not-simulated').first()).toBeVisible();
    await expect(confronto).toContainText('non simulato');
  });

  test('P04e: Sala del Consiglio — la memoria della sedia sopravvive alla ricarica (UX-05)', async ({ page }) => {
    installMockApi(page);
    const wire = [];
    page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().includes('/government/minister/')) return;
      try { wire.push(request.postDataJSON()); } catch { /* body non JSON */ }
    });
    await reachHud(page);

    // Un atto firmato: da qui nasce il ricordo «Atto accodato».
    await openTesoroRoom(page);
    await ask(page, 'copertura finanziaria');
    await openBoard(page);
    await prepareCommonDraft(page);
    await sign(page);

    // La memoria vive nel browser per partita: la chiave ha il prefisso stabile.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ws:minister-memory:')));
    expect(keys.length).toBeGreaterThan(0);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ws:minister-memory:')).map(key => localStorage.getItem(key) || ''));
    expect(stored.some(value => value.includes('Atto accodato'))).toBe(true);

    // Il ricordo viaggia con la richiesta successiva al ministro.
    wire.length = 0;
    await ask(page, 'Riepilogo della cassa?');
    await expect.poll(() => wire.some(body => JSON.stringify(body.memory ?? []).includes('Atto accodato'))).toBe(true);

    // Ricaricare il browser non la perde: la memoria è per partita.
    await page.reload();
    try {
      await page.waitForSelector('.game-shell', { timeout: 12_000 });
    } catch {
      await reachHud(page);
    }
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ws:minister-memory:')));
    expect(keysAfter.length).toBeGreaterThan(0);
    await openTesoroRoom(page);
    wire.length = 0;
    await ask(page, 'Come procede?');
    await expect.poll(() => wire.some(body => JSON.stringify(body.memory ?? []).includes('Atto accodato'))).toBe(true);
  });

  test('P06: Sala del Consiglio — dalla proposta alla decisione, con esito reale (UX-06)', async ({ page }) => {
    // L'esito dell'avanzamento è l'atto **firmato**: lo si cattura dal filo e lo
    // si restituisce al motore, così la UI ricostruisce lo stato «eseguito».
    const outcome = actionsProcessed('atto-da-catturare');
    installMockApi(page, { advanceResult: outcome });
    let signedText = '';
    page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().endsWith('/actions/queue')) return;
      try { signedText = request.postDataJSON().text; } catch { /* body non JSON */ }
    });
    await reachHud(page);

    await openTesoroRoom(page);
    await ask(page, 'copertura finanziaria');
    await openBoard(page);
    await prepareCommonDraft(page);
    await sign(page);
    expect(signedText).toContain('Copertura finanziaria');
    outcome.actions[0].text = signedText;

    // Chiudi l'Ufficio e avanza il turno: il motore esegue l'atto.
    await page.locator('.council-room-close').click();
    await page.locator('.hud-advance-btn').click();
    await expect(page.locator('.time-desk-content')).toBeVisible();
    await page.locator('.time-desk-next').click();

    // Riapre la seduta del nuovo turno, ri-prepara la stessa proposta e ritrova
    // lo stato reale dalla cronologia.
    await openTesoroRoom(page);
    await ask(page, 'copertura finanziaria');
    await openBoard(page);
    await prepareCommonDraft(page);
    await expect(page.locator('.act-draft-state')).toHaveText('eseguito');
  });

  test('P07: Sala del Consiglio — la voce di spesa in evidenza (UX-07)', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await openTesoroRoom(page);

    // A2 — la spesa discute la sanità: la card apre il blocco reale e la voce
    // pertinente è marcata, non il saldo.
    await ask(page, 'Mi mostri dove va la spesa per la sanità?');
    await page.locator('.council-room-evidence-link').last().click();
    const bilancio = page.locator('.council-board-focus-evidence [data-block-id="bilancio"]');
    await expect(bilancio).toBeVisible();
    await expect(bilancio.locator('.advisor-chart-bars li.focused')).toContainText('Sanità e assistenza');
    // Il vecchio pin/toggle non esiste più: l'evidenza è la lettura della Tavola.
    await expect(page.locator('.seat-presentation-pin')).toHaveCount(0);
  });

  test('P05: Sala del Consiglio — «Chiudi seduta» chiude senza atti', async ({ page }) => {
    installMockApi(page);
    await reachHud(page);

    await openGovernment(page);
    const registro = page.locator('.order-register');
    await expect(registro).toBeVisible();
    await expect(registro.locator('.order-register-act')).toHaveCount(0);
    // I vecchi esiti non esistono più.
    await expect(page.locator('.cabinet-nothing')).toHaveCount(0);
    await expect(page.locator('.government-office-outcome-note')).toHaveCount(0);

    await openTesoroRoomFromPicker(page);
    await ask(page, 'Quale priorità per il Tesoro?');

    // Si chiude la seduta senza preparare né firmare: si torna alla scelta.
    await page.locator('.council-room-conclude').click();
    await expect(page.locator('.government-office')).toBeVisible();
    await expect(page.locator('.cabinet-pick')).toHaveCount(2);
    await expect(page.locator('.order-register-act')).toHaveCount(0);
    await expect(page.locator('.government-office-outcome-note')).toHaveCount(0);
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
