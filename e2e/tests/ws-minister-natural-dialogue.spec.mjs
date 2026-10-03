/** Un solo giro browser, offline: apertura automatica distinta dalla chat e annullabile. */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const path = `/api/games/${MOCK_GAME_ID}/government/minister/`;
const prose = 'Presidente, l’avanzo c’è. Prima di spenderlo guarderei il debito: io terrei un margine per domani. Vuoi confrontare rimborso e investimenti?';

test('apertura naturale read-only, continuità della chat e cancellazione al cambio sedia', async ({ page }) => {
  installMockApi(page);
  const openings = [];
  const chats = [];
  let releaseWorks;
  const heldWorks = new Promise(resolve => { releaseWorks = resolve; });
  await page.route(`**${path}*/opening`, async route => {
    const seat = new URL(route.request().url()).pathname.split('/').at(-2);
    openings.push(seat);
    if (seat === 'lavori') await heldWorks;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      reply: seat === 'lavori' ? 'STALE intervento dei Lavori' : prose,
      seat, narrativeOnly: true, persistMemory: false, allowDirectives: false,
    }) }).catch(() => {});
  });
  await page.route(`**${path}*/stream`, route => {
    const body = route.request().postDataJSON();
    chats.push(body);
    const decision = source => `\n\`\`\`decision\n${JSON.stringify({ op: 'update-proposal', objective: 'Usare l’avanzo', changes: ['Debito', 'Investimenti'].map(label => ({ label, kind: 'allocation', sharePct: 50, source, status: source === 'president' ? 'accepted' : 'proposed' })), unresolvedQuestions: ['Quali investimenti?'] })}\n\`\`\``;
    const reply = body.message === 'Perché?' ? 'Per non impegnare tutto il margine prima di sapere cosa otteniamo.'
      : body.message === 'E il resto?' ? 'Il resto è la quota per gli investimenti che abbiamo appena discusso.'
      : body.message === 'Fammi vedere.' ? 'Certo. Ti metto a confronto le due strade.\n```tavola\n{"op":"compare"}\n```'
      : body.message === 'Va bene.' ? 'Va bene, segno il 50/50. Restano da scegliere gli investimenti.' + decision('president')
      : 'Valutiamo insieme le coperture. Io partirei da metà per il debito e metà per gli investimenti.' + decision('minister');
    return route.fulfill({ status: 200, contentType: 'text/plain', body: reply });
  });
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Governo', exact: true }).click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.minister-greeting')).toContainText(prose);
  expect(openings).toEqual(['tesoro']);
  expect(chats).toHaveLength(0);
  await page.locator('.minister-compose textarea').fill('Confrontiamo le coperture.');
  await page.locator('.minister-compose button').click();
  await expect(page.locator('.minister-entry.assistant').last()).toContainText('Valutiamo insieme le coperture.');
  expect(chats[0].history).toContainEqual({ role: 'assistant', content: prose });
  await expect(page.locator('.decision-measure[data-source="minister"]')).toHaveCount(2);
  for (const question of ['Perché?', 'E il resto?', 'Fammi vedere.', 'Va bene.']) {
    await page.locator('.minister-compose textarea').fill(question);
    await page.locator('.minister-compose button').click();
    await expect(page.locator('.minister-compose textarea')).toBeEnabled();
    await expect.poll(() => chats.at(-1)?.message).toBe(question);
    const request = chats.at(-1);
    expect(request.history.filter(message => message.role === 'assistant' && message.content === prose)).toHaveLength(1);
    expect(request.currentDecision.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Debito', sharePct: 50, source: 'minister', status: 'proposed' }),
    ]));
  }
  await expect(page.locator('.decision-measure[data-source="president"][data-status="accepted"]')).toHaveCount(2);
  await expect(page.locator('.minister-thread')).not.toContainText('Fatti:');
  await expect(page.locator('.minister-thread')).not.toContainText('```decision');
  expect(chats).toHaveLength(5);
  await page.locator('.government-office-back').click();
  await page.locator('.cabinet-pick[data-seat="lavori"]').click();
  await expect.poll(() => openings.includes('lavori')).toBe(true);
  await expect(page.getByRole('status', { name: 'Il ministro sta preparando il suo intervento' })).toBeVisible();
  await page.locator('.government-office-back').click();
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  releaseWorks();
  await expect(page.locator('.minister-compose textarea')).toBeEnabled();
  await expect(page.locator('.minister-thread')).not.toContainText('STALE');
  expect(openings.filter(seat => seat === 'tesoro')).toHaveLength(1);
});
