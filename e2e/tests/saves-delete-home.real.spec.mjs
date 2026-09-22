/**
 * DELETE SAVES HOME — E2E a **backend reale**: eliminazione dalla home
 * ==================================================================
 * La home è il posto da cui i salvataggi si usano davvero: qui si prova che da
 * lì si possono anche **cancellare**, contro il backend Express vero (nessun mock
 * di `/api/saves`), e che la riga sparisce **dal database**.
 *
 * Percorso reale, senza scorciatoie:
 *
 *   landing → scenario `modern_world_provinces` → paese (USA) → «Avvia»
 *   → mondo generato (job + polling) → partita reale (`POST /games`)
 *   → ⚙ → 💾 Salva → `POST /games/:id/save` (salvataggio utente nel DB)
 *   → ritorno alla home → card «📂 Continua partita»
 *   → «Elimina» → conferma → `DELETE /api/saves/:id`
 *   → `GET /api/saves` reale: il salvataggio non c'è più
 *   → `GET /api/games/:id` reale: la partita è intatta
 *
 * L'unica finzione è il provider LLM (stub OpenAI-compatibile, vedi
 * `e2e/real-backend/`): il contenuto narrativo non è oggetto della verifica.
 */
import { test, expect } from 'playwright/test';

const PRESET_LABEL = 'Mondo Provinciale Moderno';
const SAVE_NAME = 'Home delete e2e';

const listSaves = async (page) => (await (await page.request.get('/api/saves')).json()).saves || [];
const gameSnapshot = async (page, gameId) => {
  const response = await page.request.get(`/api/games/${gameId}`);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return body.state || body;
};

test.describe('DELETE SAVES HOME — backend reale', () => {
  test('dalla home un salvataggio si elimina con conferma e sparisce dal DB, senza toccare la partita', async ({ page }) => {
    test.setTimeout(20 * 60_000);

    const health = await page.request.get('/api/health');
    expect(health.ok()).toBe(true);
    expect((await health.json()).status).toBe('ok');

    // ---------------------------------------------------------------------
    // 1. Partita reale (stesso flusso dell'utente, mondo provinciale completo).
    // ---------------------------------------------------------------------
    const gameReply = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/games'
      && response.request().method() === 'POST'
      && response.status() === 200,
      { timeout: 12 * 60_000 });

    await page.goto('/');
    await page.locator('.landing-cta').click();
    await page.getByRole('searchbox', { name: 'Cerca scenario' }).fill('Provinciale');
    const presetCard = page.getByRole('button', { name: `Apri scenario ${PRESET_LABEL}` });
    await expect(presetCard).toBeVisible();
    await presetCard.click();
    await page.getByRole('searchbox', { name: 'Cerca paese per nome o codice' }).fill('USA');
    const usaItem = page.locator('.country-list-item').first();
    await expect(usaItem).toBeVisible();
    await usaItem.click();
    await page.locator('.btn-play').click();

    await expect(page.locator('.game-shell')).toBeVisible({ timeout: 12 * 60_000 });
    const { game_id: gameId } = await (await gameReply).json();
    expect(gameId).toBeTruthy();

    const before = await gameSnapshot(page, gameId);
    const turnBefore = before.currentTurn;

    // ---------------------------------------------------------------------
    // 2. Salvataggio reale dalla UI (⚙ → 💾 Salva).
    // ---------------------------------------------------------------------
    await page.getByRole('button', { name: 'Salva, carica e impostazioni' }).click();
    await page.getByRole('menuitem', { name: 'Salva' }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Salva partita' });
    await expect(saveDialog).toBeVisible();
    await saveDialog.locator('#save-modal-name').fill(SAVE_NAME);
    await saveDialog.getByRole('button', { name: 'Salva' }).click();
    await expect(saveDialog).toHaveCount(0);

    // Il salvataggio è davvero nel DB (endpoint reale, nessuna scorciatoia).
    await expect.poll(async () => (await listSaves(page)).some(s => s.name === SAVE_NAME), { timeout: 30_000 }).toBe(true);
    const created = (await listSaves(page)).find(s => s.name === SAVE_NAME);
    expect(created.id).toBeTruthy();

    // Fail-closed reale in creazione: lo spazio `__…__` è del motore.
    const reservedCreate = await page.request.post(`/api/games/${gameId}/save`, { data: { name: '__rewind__' } });
    expect(reservedCreate.status()).toBe(400);
    expect((await reservedCreate.json()).code).toBe('reserved_save_name');

    // ---------------------------------------------------------------------
    // 3. Home: la card è lì, con «Elimina» accanto a «▶ Gioca».
    // ---------------------------------------------------------------------
    await page.goto('/');
    const card = page.locator('.landing-save-card').filter({ hasText: SAVE_NAME });
    await expect(card).toBeVisible({ timeout: 30_000 });
    const deleteButton = card.locator('[data-landing-save-delete]');
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toHaveAttribute('data-landing-save-delete', created.id);
    await expect(deleteButton).toHaveAttribute('aria-label', `Elimina il salvataggio “${SAVE_NAME}”`);
    // Gli snapshot interni del motore non compaiono nella home.
    await expect(page.getByText('__rewind__')).toHaveCount(0);

    // Primo clic: conferma, nessuna cancellazione.
    await deleteButton.click();
    const confirm = page.getByRole('dialog', { name: 'Conferma eliminazione del salvataggio' });
    await expect(confirm).toBeVisible();
    await expect(page.locator(`[data-save-delete-target="${created.id}"]`)).toContainText(SAVE_NAME);
    await confirm.getByRole('button', { name: 'Annulla' }).click();
    await expect(confirm).toHaveCount(0);
    expect((await listSaves(page)).some(s => s.name === SAVE_NAME)).toBe(true);

    // ---------------------------------------------------------------------
    // 4. Conferma: la card sparisce e il salvataggio sparisce dal DB.
    // ---------------------------------------------------------------------
    await card.locator('[data-landing-save-delete]').click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.landing-save-status.ok')).toContainText(SAVE_NAME);
    await expect.poll(async () => (await listSaves(page)).some(s => s.name === SAVE_NAME), { timeout: 30_000 }).toBe(false);

    // L'id non esiste più: la seconda DELETE è un 404 reale.
    const secondDelete = await page.request.delete(`/api/saves/${created.id}`);
    expect(secondDelete.status()).toBe(404);

    // ---------------------------------------------------------------------
    // 5. La partita non è stata toccata: stessa sessione, stesso turno.
    // ---------------------------------------------------------------------
    const after = await gameSnapshot(page, gameId);
    expect(after.currentTurn).toBe(turnBefore);
    expect(after.id || after.gameId || gameId).toBeTruthy();
    expect((after.players || []).length).toBeGreaterThan(0);
  });
});
