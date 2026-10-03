import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const path = `**/api/games/${MOCK_GAME_ID}/government/minister/`;
async function openRoom(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.getByRole('heading', { name: 'Seduta del Consiglio', exact: true })).toBeVisible();
}
function setup(page) {
  installMockApi(page);
  const requests = [];
  page.route(`${path}*/opening`, route => route.fulfill({ json: { reply: 'Presidente, discutiamo le priorità di bilancio.', seat: 'tesoro' } }));
  page.route(`${path}*/stream`, route => {
    const body = route.request().postDataJSON();
    const seat = /minister\/([^/]+)\/stream/.exec(route.request().url())[1];
    requests.push({ ...body, seat });
    let reply;
    if (body.council.phase === 'drafting') {
      reply = seat === 'tesoro' ? 'Inseriamo il limite di spesa nella prima clausola.' : 'Il Tesoro ha ragione; pianifichiamo le tranche successive senza impegnarle ora.';
    } else if (seat === 'guerra') {
      reply = 'Tesoro, accetto il limite e tre tranche annuali.\n```consiglio\n{"position":{"status":"support","reason":"Accetto il limite discusso."},"agreements":["Nessuna nuova emissione"],"disagreements":[]}\n```';
    } else {
      reply = 'Presidente, chiederei alla Guerra tempi e fabbisogno.\n```decision\n{"op":"update-proposal","objective":"Bilancio e piano di riarmo","changes":[{"label":"Prima tranche","value":"700 milioni","source":"minister"}]}\n```\n```consiglio\n{"needs_input_from":[{"minister":"guerra","question":"Quali costi e tempi del programma?"}],"position":{"status":"support","reason":"Il limite di spesa protegge gli investimenti."},"agreements":["Nessuna nuova emissione"],"disagreements":[]}\n```';
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });
  return requests;
}
async function discuss(page) {
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Come finanziare il programma di riarmo?');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true })).toBeVisible();
}

test('chat dominates, the board is closed by default and minister admission preserves the shared context', async ({ page }) => {
  const requests = setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRoom(page);
  await expect(page.locator('.council-room-drawer')).toHaveCount(0);
  await discuss(page);
  expect(requests[0].council.participants).toEqual(['tesoro']);
  await page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[1].seat).toBe('guerra');
  expect(requests[1].history.map(m => m.content).join('\n')).toContain('chiederei alla Guerra');
  expect(requests[2].seat).toBe('tesoro');
  expect(requests[2].message).not.toContain('ti convoca');
  expect(requests[2].history.map(m => m.content).join('\n')).toContain('Tesoro, accetto il limite');
  expect(new Set(requests.map(r => r.council.sessionId)).size).toBe(1);
  await expect(page.locator('.council-room-participants')).toContainText('Guerra');
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Bozza della prossima domanda');
  await page.getByRole('button', { name: /Tavola/, exact: false }).click();
  await expect(page.locator('.council-room-drawer')).toBeVisible();
  const chat = await page.locator('.council-room-dialogue').boundingBox();
  const board = await page.locator('.council-room-drawer').boundingBox();
  expect(chat.width / (chat.width + board.width)).toBeGreaterThan(0.60);
  await page.getByRole('button', { name: 'Chiudi la Tavola' }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Bozza della prossima domanda');
});

test('common drafting hears both ministers and only signing adds an act to the register', async ({ page }) => {
  const requests = setup(page);
  await openRoom(page);
  await discuss(page);
  await page.getByRole('button', { name: 'Convoca Ministro della Guerra', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invia', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Tavola/ }).click();
  await page.getByRole('button', { name: 'Prepara bozza comune', exact: true }).click();
  await expect(page.locator('.act-draft')).toBeVisible();
  expect(requests.filter(r => r.council.phase === 'drafting').map(r => r.seat)).toEqual(['tesoro', 'guerra']);
  const drafting = requests.filter(r => r.council.phase === 'drafting');
  expect(drafting[1].history.map(m => m.content).join('\n')).toContain('prima clausola');
  await expect(page.locator('.act-draft-text')).toHaveValue(/Proponenti: Ministro del Tesoro, Ministro della Guerra/);
  await expect(page.locator('.act-draft-text')).toHaveValue(/Art\. 1/);
  await page.getByRole('button', { name: 'Firma e inserisci nel registro', exact: true }).click();
  await expect(page.locator('.act-draft')).toHaveAttribute('data-state', 'queued');
});

test('engine-verified construction retains its declaration and canonical region when signed', async ({ page }) => {
  setup(page);
  const queued = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/actions/queue')) queued.push(request.postDataJSON()); });
  await page.route(`${path}*/stream`, route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Costruiamo la fabbrica a Sarajevo.\n```decision\n{"op":"update-proposal","objective":"Fabbrica siderurgica a Sarajevo","changes":[{"label":"Costruire una fabbrica siderurgica a Sarajevo","kind":"work","source":"minister"}]}\n```' }));
  await openRoom(page);
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Costruire una fabbrica siderurgica a Sarajevo');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toBeEnabled();
  await page.getByRole('button', { name: /Tavola/ }).click();
  await page.getByRole('button', { name: 'Prepara bozza comune', exact: true }).click();
  await expect(page.locator('.act-draft-capability')).toContainText('ordine d’opera supportato');
  await page.getByRole('button', { name: 'Firma e inserisci nel registro', exact: true }).click();
  await expect.poll(() => queued.length).toBe(1);
  expect(queued[0].work).toEqual({ workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, regionId: 'SARAJEVO' });
});

test('inline evidence opens the real engine block in the common board', async ({ page }) => {
  setup(page);
  await page.route(`${path}*/stream`, route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Guardiamo la spesa.\n```tavola\n{"op":"show","evidence":"spesa"}\n```' }));
  await openRoom(page);
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Mostrami la spesa');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await page.locator('.council-room-evidence-link').click();
  await expect(page.locator('.council-room-drawer')).toBeVisible();
  await expect(page.locator('.council-board-focus-evidence [data-block-id="bilancio"]')).toBeVisible();
});

test('interrupt and resume preserve completed discussion but reject late contributions', async ({ page }) => {
  setup(page);
  let release;
  let requestSeen = false;
  await page.route(`${path}*/stream`, async route => {
    requestSeen = true;
    const text = await new Promise(resolve => { release = resolve; });
    await route.fulfill({ status: 200, contentType: 'text/plain', body: text }).catch(() => {});
  });
  await openRoom(page);
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Domanda in corso');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect.poll(() => requestSeen).toBe(true);
  await page.getByRole('button', { name: 'Interrompi', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toBeEnabled();
  release('LATE risposta con una proposta fittizia');
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Domanda conservata');
  await page.getByRole('button', { name: '← Governo', exact: true }).click();
  await page.getByRole('button', { name: /Riprendi seduta/ }).click();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Domanda conservata');
  await expect(page.locator('.council-room-thread')).toContainText('Domanda in corso');
  await expect(page.locator('.council-room-thread')).not.toContainText('LATE');
});

test('manual admission is accessible on desktop without a model invitation', async ({ page }) => {
  setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRoom(page);
  await page.getByRole('button', { name: '+ Convoca', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Convoca un ministro', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Ministro della Guerra', exact: false }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.council-room-participants')).toContainText('Guerra');
});

test('an ambiguous signature cannot be replaced by another preparation and retries keep its key', async ({ page }) => {
  setup(page);
  const signatures = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, route => {
    signatures.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
    return route.fulfill({ status: 503, json: { error: 'Acknowledgement unavailable' } });
  });
  await openRoom(page);
  await discuss(page);
  await page.getByRole('button', { name: /Tavola/ }).click();
  await page.getByRole('button', { name: 'Prepara bozza comune', exact: true }).click();
  const sign = page.getByRole('button', { name: 'Firma e inserisci nel registro', exact: true });
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(page.locator('.act-draft')).toContainText('Firma non confermata');
  await expect(page.getByRole('button', { name: 'Prepara bozza comune', exact: true })).toBeDisabled();
  await sign.click();
  await expect.poll(() => signatures.length).toBe(2);
  expect(signatures[1]).toEqual(signatures[0]);
});

test('mobile board is a full-screen bottom sheet, Escape returns to the preserved chat', async ({ page }) => {
  setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoom(page);
  await discuss(page);
  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Domanda conservata');
  await page.getByRole('button', { name: /Tavola/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tavola del Consiglio', exact: true });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds.width).toBe(390);
  expect(bounds.height).toBeGreaterThan(800);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Tavola/ })).toBeFocused();
  await expect(page.locator('.government-office')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('Domanda conservata');
});

test('E2E realistico: Tesoro risponde, Guerra fallisce 502 → errore operativo con retry del solo Guerra', async ({ page }) => {
  installMockApi(page);
  let guerraFailures = 0;
  await page.route(`${path}*/opening`, route => route.fulfill({ json: { reply: 'La cassa regge, ma il margine si assottiglia.', seat: 'tesoro' } }));
  await page.route(`${path}*/stream`, route => {
    const seat = /minister\/([^/]+)\/stream/.exec(route.request().url())[1];
    // Tesoro → 200; Guerra → 502 solo al primo tentativo.
    if (seat === 'guerra' && guerraFailures === 0) {
      guerraFailures += 1;
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"minister_unavailable","reason":"provider_error","seat":"guerra"}' });
    }
    const reply = seat === 'guerra'
      ? 'Ministro del Tesoro, per la prima fase propongo un battaglione per novanta giorni.'
      : 'Presidente, posso coprirlo, ma la Guerra mi indichi uomini e durata.';
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });
  await page.setViewportSize({ width: 1774, height: 840 });
  await openRoom(page);

  await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('preparate un atto che sostenga un battaglione al confine');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(page.locator('.council-room-message.assistant[data-seat="tesoro"]')).toHaveCount(2, { timeout: 15_000 });

  // Convocazione esplicita di Guerra: il provider fallisce.
  await page.locator('.council-room-convene').click();
  const sheet = page.locator('.gov-sheet:has(#council-convene-title)');
  await sheet.locator('.gov-sheet-item', { hasText: 'Ministro della Guerra' }).click();

  const failure = page.locator('.council-room-failure');
  await expect(failure).toBeVisible({ timeout: 15_000 });
  await expect(failure).toContainText('Il Ministro della Guerra non riesce a intervenire in questo momento.');
  // Nessuna falsa posizione politica.
  await expect(page.locator('.council-room-thread')).not.toContainText('Non riesco ora a valutare gli interventi dei colleghi');
  await expect(page.locator('.council-room-thread')).not.toContainText('preferisce non pronunciarsi');
  // Nessuno speech di Guerra; l'intervento del Tesoro resta.
  await expect(page.locator('.council-room-message.assistant[data-seat="guerra"]')).toHaveCount(0);
  await expect(page.locator('.council-room-message.assistant[data-seat="tesoro"]')).toHaveCount(2);

  // Retry del SOLO Guerra: un intervento, una volta.
  await failure.getByRole('button', { name: 'Riprova Guerra', exact: true }).click();
  await expect(page.locator('.council-room-message.assistant[data-seat="guerra"]')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.council-room-failure')).toHaveCount(0);
  await expect(page.locator('.council-room-message.assistant[data-seat="tesoro"]')).toHaveCount(2);
});

for (const viewport of [{ width: 1774, height: 840 }, { width: 1440, height: 900 }]) {
  test(`desktop ${viewport.width}×${viewport.height}: transcript dominante, header e composer compatti`, async ({ page }) => {
    setup(page);
    await page.setViewportSize(viewport);
    await openRoom(page);
    await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('Come finanziare il programma di riarmo?');
    await page.getByRole('button', { name: 'Invia', exact: true }).click();
    await expect(page.locator('.council-room-message.assistant:not(.council-room-stream)').last()).toContainText('chiederei alla Guerra', { timeout: 15_000 });

    // Header + partecipanti compatti (~110-135px).
    const head = await page.locator('.council-room-head').boundingBox();
    const participants = await page.locator('.council-room-participants').boundingBox();
    expect(head.height + participants.height).toBeLessThanOrEqual(140);

    // Il transcript domina la finestra.
    const thread = await page.locator('.council-room-thread').boundingBox();
    expect(thread.height).toBeGreaterThan(viewport.height * 0.5);

    // Composer a una riga, «Invia» ~44-48px, footer su una barra.
    const textarea = await page.locator('.council-room-compose textarea').boundingBox();
    expect(textarea.height).toBeLessThanOrEqual(60);
    const send = await page.getByRole('button', { name: 'Invia', exact: true }).boundingBox();
    expect(send.height).toBeGreaterThanOrEqual(40);
    expect(send.height).toBeLessThanOrEqual(60);
    const footer = await page.locator('.council-room-toolbar').boundingBox();
    expect(footer.height).toBeLessThanOrEqual(60);

    // Messaggi larghi e testo leggibile (>= 19px).
    const message = await page.locator('.council-room-message').first().boundingBox();
    expect(message.width).toBeGreaterThan(700);
    const fontSize = await page.locator('.council-room-prose').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(19);

    // Il nuovo intervento non nasce scrollato alla fine: lo speaker resta visibile.
    const speaker = await page.locator('.council-room-message.assistant').last().locator('.council-room-speaker').boundingBox();
    expect(speaker.y).toBeGreaterThanOrEqual(0);
    expect(speaker.y).toBeLessThan(viewport.height);

    // Aprire/chiudere la Tavola non perde l'input.
    await page.getByRole('textbox', { name: 'Messaggio del Presidente' }).fill('bozza in corso');
    await page.getByRole('button', { name: /Tavola/ }).click();
    await expect(page.locator('.council-room-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi la Tavola' }).click();
    await expect(page.getByRole('textbox', { name: 'Messaggio del Presidente' })).toHaveValue('bozza in corso');
  });
}
