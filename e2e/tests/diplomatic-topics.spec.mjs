import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

for (const width of [360, 390, 1280]) test(`trattative per argomento a ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  installMockApi(page);
  const participants = [
    { id: 'DEU', name: 'Germania', role: 'player', color: '#32644e' },
    { id: 'POL', name: 'Polonia', role: 'polity', color: '#be3939' },
    { id: 'CZE', name: 'Cecoslovacchia', role: 'polity', color: '#335f91' },
  ];
  const messages = [
    { id: 'm1', role: 'polity', senderName: 'Cecoslovacchia', gameDate: '1951-02-01', seq: 1,
      content: 'Proponiamo un incontro a Praga per definire le modalità di transito lungo il confine. La nostra delegazione è pronta a discutere controlli congiunti e garanzie per i convogli civili. Attendiamo la vostra posizione prima di concordare la data.' },
    { id: 'm2', role: 'polity', senderName: 'Polonia', gameDate: '1951-02-01', seq: 2,
      content: 'Sosteniamo la proposta cecoslovacca. Per parte nostra chiediamo controlli in entrambi i valichi, con osservatori delle delegazioni presenti: questa garanzia ci permetterebbe di partecipare al vertice.' },
  ];
  const chats = [
    { id: 'security', subject: 'Coordinamento per la sicurezza dei confini', participants, polityId: 'POL', polityName: 'Polonia', unread: 1, lastMessage: messages[1].content, lastMessageGameDate: '1951-02-01' },
    { id: 'trade', subject: 'Accordo sui transiti commerciali', participants, polityId: 'POL', polityName: 'Polonia', unread: 0, lastMessage: 'Restiamo disponibili a definire le condizioni commerciali.', lastMessageGameDate: '1951-01-01' },
  ];
  let created;
  await page.route(`**/games/${MOCK_GAME_ID}/chats**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const body = req.method() === 'POST' ? req.postDataJSON() : {};
    let result;
    if (path.endsWith('/messages') && req.method() === 'POST') {
      const message = { id: 'm3', role: 'player', content: body.content, gameDate: '1951-02-01', seq: 3 };
      const reply = { ...messages[1], id: 'm4', content: 'Accettiamo di discuterne al vertice, alle condizioni indicate.', seq: 4 };
      messages.push(message, reply); result = { message, reply };
    } else if (path.endsWith('/messages')) result = { messages: path.includes('new-topic') ? [] : messages };
    else if (path.endsWith('/auto')) {
      const reply = { ...messages[0], id: 'm5', content: 'Polonia, possiamo discutere i controlli congiunti al vertice di Praga.', seq: 5 };
      messages.push(reply); result = { replies: [reply] };
    } else if (path.endsWith('/read')) result = { ok: true };
    else if (path.endsWith('/archive')) {
      const chat = chats.find(chat => path.includes(`/${chat.id}/`));
      chat.archived = true; result = { chat };
    }
    else if (req.method() === 'POST') {
      created = body;
      const chat = { ...chats[0], id: 'new-topic', subject: body.subject, lastMessage: null, unread: 0 };
      chats.push(chat); result = { chat };
    } else result = { chats };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible();
  await page.locator('.rail-btn[aria-label="Diplomazia"]').click();
  await expect(page.getByRole('heading', { name: 'Chat diplomatiche' })).toBeVisible();
  await expect(page.locator('.chat-item')).toHaveCount(2);
  await expect(page.locator('.chat-date-divider').first()).toHaveText('1 feb 1951');
  // Check computed styles: unread/hover previously restored the dark theme.
  const firstChat = page.locator('.chat-item').first();
  await firstChat.hover();
  await expect(firstChat).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(firstChat.locator('.chat-item-name')).toHaveCSS('-webkit-text-fill-color', 'rgb(32, 36, 38)');
  await expect(firstChat).toHaveCSS('border-left-width', '1px');
  await page.screenshot({ path: `/tmp/diplomacy-inbox-${width}.png` });
  await page.getByRole('button', { name: /^Coordinamento per la sicurezza/ }).click();
  await expect(page.locator('.chat-thread-title')).toHaveText(chats[0].subject);
  await expect(page.locator('.chat-bubble')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Chiudi chat diplomatiche' })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Messaggio diplomatico' });
  await expect(composer).toBeVisible();
  await expect(page.locator('.chat-turn-hint')).toHaveText('Le delegazioni attendono la vostra risposta');
  await expect(page.locator('.chat-bubble').first()).toHaveCSS('border-left-width', '0px');
  expect(await page.locator('.chat-bubble').first().evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
  await expect(page.locator('.chat-bubble').first()).toHaveCSS('font-size', width <= 360 ? '16px' : '17px');
  await page.screenshot({ path: `/tmp/diplomacy-thread-${width}.png` });
  expect(await page.locator('.chats-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const box = await composer.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await composer.fill('Concordiamo sul vertice e chiediamo osservatori congiunti.');
  await page.getByRole('button', { name: 'Invia messaggio' }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(4);
  await page.getByRole('button', { name: 'Mostra partecipanti e opzioni' }).click();
  await expect(page.locator('.chat-participants')).toContainText('Cecoslovacchia');
  await page.getByRole('button', { name: 'Prosegui dialogo' }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(5);
  await page.getByRole('button', { name: 'Torna alle conversazioni' }).click();
  await page.getByRole('button', { name: 'Archivia la conversazione Accordo sui transiti commerciali' }).click();
  await expect(page.locator('.chat-item')).toHaveCount(1);
  await page.getByRole('button', { name: /Archivio \(1\)/ }).click();
  await expect(page.locator('.chat-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Inizia una nuova chat' }).click();
  await page.getByLabel('Argomento della trattativa').fill('Cooperazione ferroviaria');
  await page.locator('.polity-pick-item input').first().check();
  await page.getByRole('button', { name: /Apri trattativa/ }).click();
  await expect(page.locator('.chat-thread-title')).toHaveText('Cooperazione ferroviaria');
  expect(created.subject).toBe('Cooperazione ferroviaria');
  expect(created.polityNames).toHaveLength(1);
});
