/**
 * P5: identità della bozza e retry browser. Persistenza provata nei test backend.
 * ============================================================================
 * Migrata alla Sala del Consiglio: la seduta è `.council-room`, l'atto nasce
 * dalla **bozza comune** sulla Tavola (`.act-draft`) e la firma entra nel
 * registro passando da `actions/queue` (idempotente).
 *
 * I tre intenti restano gli stessi:
 *  1. una risposta di firma persa si ritenta con la **stessa** chiave di
 *     idempotenza e lo **stesso** payload; il registro mostra un solo atto e lo
 *     stato reale viene riletto dal GET autorevole;
 *  2. il replay di una ricevuta revocata non aggiunge un atto fantasma né una
 *     memoria locale «accodata»;
 *  3. il candidato già inviato è immutabile: annullare esplicitamente e
 *     preparare una nuova bozza assegna una **nuova** identità/chiave e il testo
 *     corretto è quello firmato.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, ask, openBoard, prepareCommonDraft, waitSignEnabled, backToPicker,
} from './helpers/government.mjs';

/**
 * La bozza dell'80% nomina «Infrastrutture», parola che il mock del motore
 * associa a un'opera: senza una regione canonica nel testo la verifica la
 * dichiara «funzione assente» e la firma resta (giustamente) bloccata. Questi
 * test provano l'identità della firma, non la distinta d'opera: una route mock
 * locale dice al client che l'atto è di sola prosa, così la bozza è firmabile.
 * Il contratto E2E consente route mock aggiuntive dentro la spec.
 */
async function plainTextFeasibility(page) {
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/check-feasibility`, route => {
    let text = 'Bozza comune';
    try {
      const body = route.request().postDataJSON();
      if (typeof body?.text === 'string') text = body.text;
    } catch { /* body non JSON → testo di default */ }
    return route.fulfill({ json: {
      feasible: true,
      costs: {
        timeDays: 45,
        inputs: [{ resourceId: 'money', name: 'Tesoreria', quantity: '12,40', unit: 'mld' }],
        upkeep: [], basis: 'request', note: '25% del gettito annuo (Infrastrutture)', category: 'Infrastrutture',
      },
      prerequisites: [], risks: [], warnings: [], summary: `Fattibile: ${text}`,
      deficits: [], availability: { money: [{ holder: 'POL', unitId: 'mld', available: '18,00' }] },
    } });
  });
}

/**
 * Percorso canonico fino alla firma: una misura sul tavolo → bozza comune →
 * firma abilitata dalla verifica del motore.
 */
async function prepare(page) {
  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  // Il saluto del relatore è il primo assistente: aspettarlo evita di contare
  // due risposte quando arriva in ritardo.
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');
  await ask(page, '80% infrastrutture, 20% debito.');
  await openBoard(page);
  await prepareCommonDraft(page);
  await waitSignEnabled(page);
}

test('risposta di firma persa: retry con stessa chiave, un solo ordine e registro dal GET autorevole', async ({ page }) => {
  installMockApi(page);
  await plainTextFeasibility(page);
  const posts = [];
  let accepted;
  let pending = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { pendingActions: pending } });
    const key = request.headers()['idempotency-key'];
    const body = request.postDataJSON();
    posts.push({ key, body });
    if (!accepted) {
      accepted = { id: 'accepted-once', text: body.text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: false };
      pending = [accepted];
      return route.abort('failed'); // accettata, ma la risposta non arriva
    }
    expect(key).toBe(posts[0].key); expect(body).toEqual(posts[0].body);
    return route.fulfill({ json: { ...accepted, replayed: true } });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft-state')).toHaveText('preparato');
  await expect(page.locator('.act-draft-text')).toBeDisabled();
  await expect(page.locator('.act-draft > p[role="status"]')).toContainText('Firma non confermata');
  expect(posts[0].key).toMatch(/^[\da-f-]{36}$/i);
  await page.locator('.act-draft-sign').click();
  await expect(page.locator('.act-draft-state')).toHaveText('accodato');
  await backToPicker(page);
  await expect(page.locator('.order-register')).toBeVisible();
  await expect(page.locator('.order-register-act')).toHaveCount(1);
  expect(posts).toHaveLength(2);
});

test('replay di ricevuta revocata non aggiunge un fantasma al registro locale', async ({ page }) => {
  installMockApi(page);
  await plainTextFeasibility(page);
  let posts = 0;
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { pendingActions: [] } });
    posts++;
    if (posts === 1) return route.abort('failed'); // ricevuta accettata e poi revocata
    return route.fulfill({ json: { id: 'revoked', text: request.postDataJSON().text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: true } });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts).toBe(2);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft > p[role="status"]')).toContainText('Firma non confermata');
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('"queued-decision"')))).toBe(false);
  await backToPicker(page);
  await expect(page.locator('.order-register')).toBeVisible();
  await expect(page.locator('.order-register-act')).toHaveCount(0);
});

test('candidato già inviato immutabile: nuova preparazione assegna una nuova identità', async ({ page }) => {
  installMockApi(page);
  await plainTextFeasibility(page);
  const posts = [];
  let pending = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/actions/queue`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { pendingActions: pending } });
    const body = route.request().postDataJSON();
    posts.push({ key: route.request().headers()['idempotency-key'], body });
    if (posts.length === 1) return route.abort('failed');
    const accepted = { id: 'new-signature', text: body.text, status: 'pending', createdAt: '1951-01-01T00:00:00Z', replayed: false };
    pending = [accepted];
    return route.fulfill({ json: accepted });
  });
  await prepare(page);
  await page.locator('.act-draft-sign').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('.act-draft-sign')).toBeEnabled();
  await expect(page.locator('.act-draft-text')).toBeDisabled();
  // Annullare è esplicito: la bozza già inviata sparisce e libera una nuova preparazione.
  await page.locator('.act-draft-cancel').click();
  await expect(page.locator('.act-draft')).toHaveCount(0);
  await prepareCommonDraft(page);
  await expect(page.locator('.act-draft-text')).toBeEnabled();
  await page.locator('.act-draft-text').fill('Nuova deliberazione distinta');
  // Modificare il testo invalida la verifica: il ricalcolo è esplicito.
  await page.locator('.consequence-refresh').click();
  await waitSignEnabled(page);
  await page.locator('.act-draft-sign').click();
  await expect(page.locator('.act-draft-state')).toHaveText('accodato');
  expect(posts).toHaveLength(2); expect(posts[1].key).not.toBe(posts[0].key);
  expect(posts[1].body.text).toBe('Nuova deliberazione distinta');
});
