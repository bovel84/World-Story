/**
 * Apertura automatica read-only, continuità della chat e cancellazione al
 * cambio sedia — migrata alla Sala del Consiglio.
 * ==========================================================================
 * Nella nuova UI la seduta è condivisa (`.council-room`): il saluto iniziale
 * non è più un pannello separato, ma il **primo messaggio assistant** del filo
 * comune. Viene chiesto a `government/minister/:seat/opening` e, se la rotta
 * fallisce, ripiega su `address.opening`.
 *
 * Intenti preservati dall'originale:
 *  - l'apertura non è una richiesta di chat: dopo il saluto nessun `POST …
 *    /stream` è partito;
 *  - il saluto entra nella history della richiesta successiva (`councilHistory`)
 *    una sola volta ed è prefissato col nome del relatore;
 *  - i blocchi `decision` diventano stato sulla Tavola, mai prosa nel filo;
 *  - una `/opening` in sospeso per una sedia viene annullata lasciando la seduta
 *    e non contamina la sedia successiva.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, backToPicker, replies, waitIdle,
  openBoard, closeBoard, ask,
} from './helpers/government.mjs';

const ministerPath = `/api/games/${MOCK_GAME_ID}/government/minister/`;
const treasuryOpening = 'La cassa regge, ma il margine si assottiglia.';
const prose = 'Presidente, l’avanzo c’è. Prima di spenderlo guarderei il debito: io terrei un margine per domani. Vuoi confrontare rimborso e investimenti?';

/** Un blocco `decision` strutturato: deve finire sulla Tavola, non nel filo. */
function decision(source) {
  return `\n\`\`\`decision\n${JSON.stringify({
    op: 'update-proposal',
    objective: 'Usare l’avanzo',
    changes: ['Debito', 'Investimenti'].map(label => ({
      label, kind: 'allocation', sharePct: 50, source,
    })),
    unresolvedQuestions: ['Quali investimenti?'],
  })}\n\`\`\``;
}

/**
 * Installa le rotte del dialogo: `/opening` (con i Lavori trattenuti) e
 * `/stream` (le richieste di chat, catturate per ispezionare la history).
 */
function installDialogue(page) {
  const openings = [];
  const chats = [];
  let releaseWorks;
  const heldWorks = new Promise(resolve => { releaseWorks = resolve; });
  let resolveWorksSettled;
  const worksSettled = new Promise(resolve => { resolveWorksSettled = resolve; });

  page.route(`**${ministerPath}*/opening`, async route => {
    const seat = new URL(route.request().url()).pathname.split('/').at(-2);
    openings.push(seat);
    if (seat === 'lavori') await heldWorks;
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: seat === 'lavori' ? 'STALE intervento dei Lavori' : prose,
          seat, narrativeOnly: true, persistMemory: false, allowDirectives: false,
        }),
      });
    } catch { /* richiesta annullata dal cambio sedia */ }
    if (seat === 'lavori') resolveWorksSettled();
  });

  page.route(`**${ministerPath}*/stream`, route => {
    const body = route.request().postDataJSON();
    chats.push(body);
    const reply = body.message === 'Perché?' ? 'Per non impegnare tutto il margine prima di sapere cosa otteniamo.'
      : body.message === 'E il resto?' ? 'Il resto è la quota per gli investimenti che abbiamo appena discusso.'
        : body.message === 'Fammi vedere.' ? 'Certo. Ti metto a confronto le due strade.\n```tavola\n{"op":"compare"}\n```'
          : body.message === 'Va bene.' ? 'Va bene, segno il 50/50. Restano da scegliere gli investimenti.' + decision('president')
            : 'Valutiamo insieme le coperture. Io partirei da metà per il debito e metà per gli investimenti.' + decision('minister');
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });

  return { openings, chats, release: () => releaseWorks(), worksSettled };
}

test('apertura naturale read-only, continuità della chat e cancellazione al cambio sedia', async ({ page }) => {
  installMockApi(page);
  const network = installDialogue(page);

  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  // Il saluto è il primo messaggio del filo condiviso.
  await expect(page.locator('.council-room-message.assistant').first()).toContainText(prose);
  expect(network.openings).toEqual(['tesoro']);
  // Apertura read-only: nessuna richiesta di chat è partita per il saluto.
  expect(network.chats).toHaveLength(0);

  // Continuità: il primo messaggio porta il saluto nella history condivisa.
  await ask(page, 'Confrontiamo le coperture.');
  await expect(replies(page).last()).toContainText('Valutiamo insieme le coperture.');
  expect(network.chats).toHaveLength(1);
  const greetingInHistory = network.chats[0].history.filter(
    message => message.role === 'assistant' && message.content.includes(prose),
  );
  expect(greetingInHistory).toHaveLength(1);
  // La history è prefissata col nome del relatore, non è la prosa nuda.
  expect(greetingInHistory[0].content).toContain('Ministro del Tesoro:');

  // Il blocco `decision` è diventato misura strutturata sulla Tavola.
  await openBoard(page);
  await expect(page.locator('.council-board-measure[data-source="minister"]')).toHaveCount(2);
  await closeBoard(page);

  for (const question of ['Perché?', 'E il resto?', 'Fammi vedere.', 'Va bene.']) {
    await ask(page, question);
    const request = network.chats.at(-1);
    expect(request.message).toBe(question);
    // Il saluto non si duplica lungo la conversazione.
    expect(request.history.filter(
      message => message.role === 'assistant' && message.content.includes(prose),
    )).toHaveLength(1);
    // Lo stato strutturato viaggia nel currentDecision della richiesta.
    expect(request.currentDecision.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Debito', sharePct: 50, source: 'minister', status: 'proposed' }),
    ]));
  }

  // Nella nuova UI solo l'atto esplicito del Presidente rende concordate le misure.
  await openBoard(page);
  await page.locator('.council-board-confirm').click();
  await expect(page.locator('.council-board-measure[data-source="president"][data-status="accepted"]')).toHaveCount(2);
  const visibleThread = await page.locator('.council-room-thread').innerText();
  expect(visibleThread).not.toContain('```decision');
  expect(visibleThread).not.toContain('"op":"update-proposal"');
  expect(visibleThread).not.toContain('Fatti:');
  await closeBoard(page);
  expect(network.chats).toHaveLength(5);

  // Cambio sedia con `/opening` dei Lavori in sospeso: niente contaminazione.
  await backToPicker(page);
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect.poll(() => network.openings.includes('lavori')).toBe(true);
  // La rotta è trattenuta: nessun saluto è ancora comparso.
  await expect(page.locator('.council-room-message.assistant')).toHaveCount(0);
  await backToPicker(page);
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.council-room-message.assistant').first()).toContainText(prose);
  network.release();
  await network.worksSettled;
  await expect(page.locator('.council-room-thread')).not.toContainText('STALE');
  expect(network.openings.filter(seat => seat === 'lavori')).toHaveLength(1);
});

test('il saluto iniziale ripiega su address.opening quando /opening fallisce', async ({ page }) => {
  installMockApi(page);
  const chats = [];
  await page.route(`**${ministerPath}*/opening`, route => route.fulfill({ status: 500, json: { error: 'opening non disponibile' } }));
  await page.route(`**${ministerPath}*/stream`, route => {
    chats.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Va bene.' });
  });

  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  await expect(page.locator('.council-room-message.assistant').first()).toContainText(treasuryOpening);
  // Anche il ripiego non genera una richiesta di chat.
  expect(chats).toHaveLength(0);
  await waitIdle(page);
});
