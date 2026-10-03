/**
 * WS-GOV-COUNCIL-MEETINGS — Il percorso della fabbrica (E2E verticale, B18/B19)
 * ============================================================================
 * Migrata alla **Sala del Consiglio** (seduta condivisa): la seduta è
 * `.council-room`, la Tavola è un drawer/bottom sheet, e l'atto nasce dalla
 * bozza comune («Prepara bozza comune»).
 *
 * Il criterio di successo resta quello di sempre:
 *  1. una decisione multi-competenza si costruisce in **una sola** seduta, con i
 *     dati del motore, contributi attribuiti per sedia e un atto che conserva la
 *     dichiarazione d'opera (incluso il `regionId` canonico `SARAJEVO`);
 *  2. la cassa insufficiente è un **blocco del motore**, non una soluzione
 *     inventata: la bozza è dichiarata incapace e la firma è disabilitata;
 *  3. un provider narrativo in errore non produce voce inventata: la seduta
 *     mostra l'errore, conserva i contributi conclusi e riprende.
 *
 * Contratto: docs/implementation/WS-COUNCIL-ROOM-e2e-contract.md
 * Riferimento verde del percorso fabbrica: tests/council-room.spec.mjs
 * («engine-verified construction retains its declaration and canonical region»).
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, ask, send, composer, replies, waitIdle,
  openBoard, closeBoard, convene, prepareCommonDraft, sign,
} from './helpers/government.mjs';

const STREAM = '**/government/minister/*/stream';

/**
 * Apre la seduta e attende il saluto del relatore: il primo intervento
 * assistente è parte del filo, e conteggiarlo evita che `ask` lo scambi per
 * una risposta.
 */
async function openRoom(page, seat = 'lavori') {
  const room = await openCouncilRoom(page, seat);
  await expect(room.locator('.council-room-message.assistant')).toHaveCount(1);
  return room;
}

/**
 * WS-GOV-COUNCIL-HARDENING — La voce della seduta, mockata in locale.
 * Riproduce le decisioni del mock standard **senza** il vincolo
 * «acciaio mancante» (che altrimenti farebbe scattare il blocco di cassa): la
 * regione `SARAJEVO` viaggia nel testo dell'atto, e il motore conferma la
 * distinta. La sedia del Tesoro porta la sua misura, così la decisione è
 * davvero multi-competenza.
 */
function installFactoryStream(page) {
  const requests = [];
  page.route(STREAM, route => {
    const body = route.request().postDataJSON() || {};
    const seat = /minister\/([^/]+)\/stream/.exec(route.request().url())[1];
    const message = String(body.message || '').toLowerCase();
    requests.push({ seat, phase: body.council?.phase, sessionId: body.council?.sessionId, participants: body.council?.participants });
    let reply = 'Prendo nota e porto il mio contributo alla proposta.';
    if (body.council?.phase !== 'drafting') {
      if (message.includes('fabbrica') || message.includes('siderurgic')) {
        reply = 'Costruiamo la fabbrica, ma va deciso il luogo.\n'
          + '```decision\n{"op":"set-objective","objective":"Costruire una fabbrica siderurgica","source":"minister"}\n```\n'
          + '```decision\n{"op":"update-proposal","changes":[{"kind":"work","label":"Fabbrica siderurgica","source":"minister"}],"unresolvedQuestions":["localizzazione"]}\n```';
      } else if (message.includes('sarajevo')) {
        reply = 'Il luogo canonico è Sarajevo.\n'
          + '```decision\n{"op":"update-proposal","changes":[{"kind":"region","label":"Sarajevo","source":"minister"}]}\n```\n'
          + '```decision\n{"op":"resolve-question","question":"localizzazione"}\n```';
      } else if (seat === 'tesoro') {
        reply = 'Prima di aprire il cantiere serve la copertura.\n'
          + '```decision\n{"op":"update-proposal","changes":[{"kind":"target","label":"Copertura finanziaria","value":"2,00","unit":"mld","source":"minister"}]}\n```';
      }
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });
  return requests;
}

test('WS-GOV-COUNCIL-MEETINGS: la fabbrica è una seduta condivisa, l’atto conserva l’opera e il luogo', async ({ page }) => {
  installMockApi(page);
  const requests = installFactoryStream(page);

  // WS-GOV-COUNCIL-HARDENING — il payload accodato: la localizzazione canonica
  // deve viaggiare con l'ordine, non restare nella frase. Il registro è la coda:
  // prima della firma non deve partire alcun accodamento.
  const queued = [];
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('/actions/queue')) return;
    try { queued.push(request.postDataJSON()); } catch { /* body non JSON */ }
  });

  await reachHud(page);
  await openRoom(page, 'lavori');

  // [1] La decisione multi-competenza si costruisce nella stessa seduta.
  await ask(page, 'Voglio costruire una fabbrica siderurgica.');
  await ask(page, 'A Sarajevo.');

  const board = await openBoard(page);
  await expect(board.locator('.council-board-measure', { hasText: 'Fabbrica siderurgica' })).toBeVisible();
  await expect(board.locator('.council-board-measure', { hasText: 'Sarajevo' })).toBeVisible();
  await closeBoard(page);

  // Il Tesoro entra nella stessa seduta e porta la sua competenza.
  await convene(page, 'tesoro');
  await expect(page.locator('.council-room-chip[data-seat="tesoro"]')).toBeVisible();
  await openBoard(page);
  await expect(board.locator('.council-board-measure', { hasText: 'Copertura finanziaria' })).toBeVisible();

  // Una sola sessione per tutta la seduta (sessionId condiviso dal motore).
  expect(new Set(requests.map(request => request.sessionId)).size).toBe(1);
  expect(requests.some(request => request.participants?.includes('lavori'))).toBe(true);
  expect(requests.some(request => request.participants?.includes('tesoro'))).toBe(true);

  // [2] La bozza comune è un ordine d'opera supportato dal motore. Né la
  //     discussione né la preparazione accodano: il registro resta vuoto, e i
  //     blocchi interni non trapelano nel filo.
  await prepareCommonDraft(page);
  const draft = page.locator('.act-draft');
  await expect(draft.locator('.act-draft-capability')).toContainText('ordine d’opera supportato');
  expect(queued).toHaveLength(0);
  await expect(page.locator('.council-room-thread')).not.toContainText('workDeclaration');
  await expect(page.locator('.council-room-thread')).not.toContainText('```');

  // [3] Solo la firma accoda l'ordine, con l'opera E la sua regione canonica.
  await sign(page);
  await expect.poll(() => queued.length).toBe(1);
  expect(queued[0].work).toEqual({
    workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, regionId: 'SARAJEVO',
  });

  // A mobile la Tavola già aperta diventa un bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.council-room-board')).toBeVisible();
});

test('WS-GOV-COUNCIL-MEETINGS: cassa insufficiente = blocco del motore, nessuna soluzione inventata', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openRoom(page, 'lavori');

  // Il mock reagisce al vincolo «acciaio mancante» (nato con «A Sarajevo.»):
  // la verifica del motore dichiara la cassa insufficiente e la distinta scoperta.
  await ask(page, 'Voglio costruire una fabbrica siderurgica.');
  await ask(page, 'A Sarajevo.');

  await openBoard(page);
  await prepareCommonDraft(page);
  const draft = page.locator('.act-draft');

  // La bozza è dichiarata incapace: nessun comando supportato, firma bloccata.
  // (La vecchia assenza di `.council-meeting-prepare` non esiste più.)
  await expect(draft.locator('.act-draft-capability')).toContainText('funzione assente', { timeout: 15_000 });
  await expect(draft.locator('.act-draft-note')).toContainText('copertura');
  await expect(draft.locator('.act-draft-sign')).toBeDisabled();

  // La plancia delle conseguenze espone il rischio del motore: «Cassa
  // insufficiente: servono 4,20 mld», non una soluzione inventata.
  const consequence = draft.locator('.consequence-board');
  await expect(consequence).toBeVisible();
  await expect(consequence).toContainText('Cassa insufficiente');
  await expect(consequence).toContainText('4,20 mld');
  await expect(consequence).toContainText('Funzione assente');
});

test('WS-GOV-COUNCIL-HARDENING: guasto del provider → errore operativo con retry, nessuna voce inventata', async ({ page }) => {
  installMockApi(page);
  // Il primo tentativo sulla domanda che deve fallire risponde 502; il retry
  // passa al mock. Le altre domande passano sempre.
  let failures = 0;
  await page.route(STREAM, route => {
    let message = '';
    try { message = String(route.request().postDataJSON()?.message || '').toLowerCase(); } catch { /* body inatteso */ }
    if (message.includes('domanda che fallisce') && failures === 0) {
      failures += 1;
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"minister_unavailable","reason":"provider_error"}' });
    }
    return route.fallback();
  });

  await reachHud(page);
  await openRoom(page, 'lavori');

  // [1] Un contributo già concluso, che deve restare.
  await ask(page, 'Voglio costruire una fabbrica siderurgica.');
  const completed = await replies(page).count();
  await expect(replies(page).last()).toContainText('preso nota del problema');

  // [2] Il guasto: nessuna posizione politica inventata, ma un errore operativo.
  await send(page, 'Questa è una domanda che fallisce.');
  const failure = page.locator('.council-room-failure');
  await expect(failure).toBeVisible({ timeout: 15_000 });
  await expect(failure).toContainText('non riesce a intervenire in questo momento');
  await expect(failure).not.toContainText('Non riesco ora a valutare gli interventi dei colleghi');
  await expect(failure).not.toContainText('preferisce non pronunciarsi');
  await expect(composer(page).locator('textarea')).toBeEnabled();
  await waitIdle(page);
  // Gli interventi conclusi sono intatti: nessun nuovo discorso aggiunto.
  await expect(replies(page)).toHaveCount(completed);
  await expect(replies(page).last()).toContainText('preso nota del problema');

  // [3] Il retry riprova SOLO il ministro fallito e aggiunge un intervento una volta.
  await failure.getByRole('button', { name: /Riprova/ }).click();
  await waitIdle(page);
  await expect(replies(page)).toHaveCount(completed + 1);
  await expect(page.locator('.council-room-failure')).toHaveCount(0);
});
