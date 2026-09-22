/**
 * DELETE SAVES — E2E mock: eliminazione di un salvataggio dalla UI
 * ===============================================================
 * La modale dei salvataggi è read-only da sempre: qui si prova il nuovo
 * percorso distruttivo, interamente con API mockate nel browser — **due
 * superfici**, archivio in-game e home, con lo stesso meccanismo di conferma.
 *
 *  - lo snapshot di rewind (`__rewind__`) non compare nell'elenco e non ha
 *    pulsante di eliminazione;
 *  - un clic su «Elimina» chiede la conferma: nessuna chiamata parte;
 *  - la conferma manda `DELETE /api/saves/<id>` e solo dopo l'item sparisce;
 *  - un errore del backend lascia l'item al suo posto e lo dice;
 *  - la partita in corso non viene toccata (shell di gioco ancora viva).
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const USER_SAVE = {
  id: 'save-user-a', game_id: MOCK_GAME_ID, name: 'Partita 15/09/2026',
  current_turn: 4, current_date: '2026-09-15', saved_at: '2026-09-15T10:00:00.000Z',
};
const OLD_SAVE = {
  id: 'save-user-b', game_id: 'altra-partita', name: 'Partita 12/09/2026',
  current_turn: 2, current_date: '2026-09-12', saved_at: '2026-09-12T10:00:00.000Z',
};
const REWIND_SAVE = {
  id: 'save-rewind', game_id: MOCK_GAME_ID, name: '__rewind__',
  current_turn: 4, current_date: '2026-09-15', saved_at: '2026-09-15T11:00:00.000Z',
};

/**
 * Installa i salvataggi mock e registra le DELETE ricevute.
 * `failFor` = id che risponde 500 (prova del percorso d'errore).
 */
async function installSaves(page, { failFor = null } = {}) {
  const deletes = [];
  await page.route('**/api/saves', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ saves: [USER_SAVE, OLD_SAVE, REWIND_SAVE] }),
  }));
  await page.route('**/api/saves/*', route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    deletes.push({ id, method: route.request().method() });
    if (route.request().method() !== 'DELETE') return route.fulfill({ status: 405, body: '{}' });
    if (id === failFor) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
    if (id === REWIND_SAVE.id) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Salvataggio riservato: non cancellabile', code: 'reserved_save' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deleted: id }) });
  });
  return deletes;
}

/** Landing → template → paese → HUD: la partita mock è avviata. */
async function openGameShell(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openSavePicker(page) {
  await page.getByRole('button', { name: 'Salva, carica e impostazioni' }).click();
  await page.getByRole('menuitem', { name: 'Carica' }).click();
  await expect(page.getByRole('dialog', { name: 'Carica un salvataggio' })).toBeVisible();
}

test.describe('DELETE SAVES — archivio campagna', () => {
  test('l’elenco mostra solo i salvataggi dell’utente', async ({ page }) => {
    installMockApi(page);
    await installSaves(page);
    await openGameShell(page);
    await openSavePicker(page);

    await expect(page.locator('.save-picker-row')).toHaveCount(2);
    await expect(page.locator('[data-save-delete="save-user-a"]')).toBeVisible();
    // Lo snapshot di rewind non è nell'elenco, quindi non è cancellabile dalla UI.
    await expect(page.locator('[data-save-delete="save-rewind"]')).toHaveCount(0);
    await expect(page.getByText('__rewind__')).toHaveCount(0);
    // L'etichetta accessibile è semantica e nomina il salvataggio.
    await expect(page.locator('[data-save-delete="save-user-a"]'))
      .toHaveAttribute('aria-label', 'Elimina il salvataggio “Partita 15/09/2026”');
  });

  test('un clic su «Elimina» non cancella: chiede conferma', async ({ page }) => {
    installMockApi(page);
    const deletes = await installSaves(page);
    await openGameShell(page);
    await openSavePicker(page);

    await page.locator('[data-save-delete="save-user-a"]').click();

    const confirm = page.getByRole('dialog', { name: 'Conferma eliminazione del salvataggio' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Eliminare il salvataggio?');
    await expect(page.locator('[data-save-delete-target="save-user-a"]')).toContainText('Partita 15/09/2026');
    // Annulla: nessuna chiamata, item ancora presente.
    await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Annulla' }).click();
    await expect(confirm).toHaveCount(0);
    expect(deletes).toEqual([]);
    await expect(page.locator('[data-save-delete="save-user-a"]')).toBeVisible();
  });

  test('la conferma cancella davvero: DELETE reale + item rimosso', async ({ page }) => {
    installMockApi(page);
    const deletes = await installSaves(page);
    await openGameShell(page);
    await openSavePicker(page);

    await page.locator('[data-save-delete="save-user-a"]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();

    await expect(page.locator('[data-save-delete="save-user-a"]')).toHaveCount(0);
    await expect(page.locator('.save-picker-status.ok')).toContainText('Partita 15/09/2026');
    expect(deletes).toEqual([{ id: 'save-user-a', method: 'DELETE' }]);
    // L'altro salvataggio resta, e la partita è ancora in corso.
    await expect(page.locator('[data-save-delete="save-user-b"]')).toBeVisible();
    await expect(page.locator('.game-shell')).toBeVisible();
  });

  test('se il backend rifiuta, l’item resta e l’errore è annunciato', async ({ page }) => {
    installMockApi(page);
    await installSaves(page, { failFor: 'save-user-b' });
    await openGameShell(page);
    await openSavePicker(page);

    await page.locator('[data-save-delete="save-user-b"]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();

    await expect(page.locator('.save-picker-status.error')).toContainText('Impossibile eliminare il salvataggio. Riprova.');
    await expect(page.locator('[data-save-delete="save-user-b"]')).toBeVisible();
    await expect(page.locator('.save-picker-status.ok')).toHaveCount(0);
  });

  test('lo snapshot riservato, se forzato dalla UI, è rifiutato e resta nell’elenco', async ({ page }) => {
    installMockApi(page);
    const deletes = await installSaves(page);
    // Difesa ulteriore: se un elenco «sporco» portasse il rewind nella UI, la
    // lista di presentazione non offre comunque l'eliminazione (vedi il test
    // unitario della lista); qui si prova che il backend risponde 403.
    await page.route('**/api/saves', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ saves: [REWIND_SAVE] }),
    }));
    await openGameShell(page);
    await openSavePicker(page);

    await expect(page.locator('[data-save-delete]')).toHaveCount(0);
    expect(deletes).toEqual([]);
  });
});

/**
 * DELETE SAVES HOME — la stessa eliminazione dalla home, senza aprire la partita.
 * Le card «📂 Continua partita» hanno «Elimina» accanto a «▶ Gioca» e usano la
 * stessa conferma dell'archivio in-game (`SaveDeleteConfirmDialog`).
 */
test.describe('DELETE SAVES HOME — home (Landing)', () => {
  test('dalla home si elimina con conferma: nessuna DELETE al primo clic, card rimossa dopo', async ({ page }) => {
    installMockApi(page);
    const deletes = await installSaves(page);
    await page.goto('/');

    // La home mostra i salvataggi dell'utente: il rewind non è nell'elenco.
    await expect(page.locator('.landing-save-card')).toHaveCount(2);
    await expect(page.locator('[data-landing-save-delete="save-rewind"]')).toHaveCount(0);
    await expect(page.getByText('__rewind__')).toHaveCount(0);
    await expect(page.locator('[data-landing-save-delete="save-user-a"]'))
      .toHaveAttribute('aria-label', 'Elimina il salvataggio “Partita 15/09/2026”');
    // Il salvataggio più recente è anche quello elevato sopra la piega.
    await expect(page.locator('.landing-continue-name')).toHaveText('Partita 15/09/2026');

    // Primo clic: apre la conferma, non cancella.
    await page.locator('[data-landing-save-delete="save-user-a"]').click();
    const confirm = page.getByRole('dialog', { name: 'Conferma eliminazione del salvataggio' });
    await expect(confirm).toBeVisible();
    await expect(page.locator('[data-save-delete-target="save-user-a"]')).toContainText('Partita 15/09/2026');
    await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
    expect(deletes).toEqual([]);

    // Annulla: la card resta, nessuna chiamata.
    await confirm.getByRole('button', { name: 'Annulla' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.locator('[data-landing-save-card="save-user-a"]')).toBeVisible();
    expect(deletes).toEqual([]);

    // Conferma: DELETE reale e card rimossa, senza ricaricare l'elenco.
    await page.locator('[data-landing-save-delete="save-user-a"]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
    await expect(page.locator('[data-landing-save-card="save-user-a"]')).toHaveCount(0);
    await expect(page.locator('.landing-save-status.ok')).toContainText('Partita 15/09/2026');
    expect(deletes).toEqual([{ id: 'save-user-a', method: 'DELETE' }]);

    // La voce sopravvissuta resta e diventa «Continua»: lo stato locale è aggiornato.
    await expect(page.locator('[data-landing-save-card="save-user-b"]')).toBeVisible();
    await expect(page.locator('.landing-continue-name')).toHaveText('Partita 12/09/2026');
    // La partita non è stata avviata: si è rimasti in home.
    await expect(page.locator('.game-shell')).toHaveCount(0);

    // Ultimo salvataggio: la sezione sparisce ma l'esito resta annunciato.
    await page.locator('[data-landing-save-delete="save-user-b"]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
    await expect(page.locator('.landing-save-card')).toHaveCount(0);
    await expect(page.locator('.landing-section-title')).toHaveCount(0);
    await expect(page.locator('.landing-save-status.ok')).toContainText('Partita 12/09/2026');
    await expect(page.locator('.landing-continue')).toHaveCount(0);
    expect(deletes).toEqual([
      { id: 'save-user-a', method: 'DELETE' },
      { id: 'save-user-b', method: 'DELETE' },
    ]);
  });

  test('home: se il backend rifiuta, la card resta e l’errore è annunciato', async ({ page }) => {
    installMockApi(page);
    await installSaves(page, { failFor: 'save-user-a' });
    await page.goto('/');

    await page.locator('[data-landing-save-delete="save-user-a"]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();

    await expect(page.locator('.landing-save-status.error'))
      .toContainText('Impossibile eliminare il salvataggio. Riprova.');
    await expect(page.locator('[data-landing-save-card="save-user-a"]')).toBeVisible();
    await expect(page.locator('.landing-save-status.ok')).toHaveCount(0);
  });

  test('home: un elenco «sporco» con il solo rewind non compare e non è cancellabile', async ({ page }) => {
    installMockApi(page);
    const deletes = await installSaves(page);
    // Difesa di presentazione: la home filtra con `visibleSaves`, quindi uno
    // snapshot interno non arriva nemmeno alle card (e non ha pulsante).
    await page.route('**/api/saves', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ saves: [REWIND_SAVE] }),
    }));
    await page.goto('/');

    await expect(page.locator('.landing-save-card')).toHaveCount(0);
    await expect(page.locator('[data-landing-save-delete]')).toHaveCount(0);
    await expect(page.locator('.landing-section-title')).toHaveCount(0);
    await expect(page.getByText('__rewind__')).toHaveCount(0);
    expect(deletes).toEqual([]);
  });
});
