/**
 * World Story — E2E mock: CHAT-ORDER
 * =================================
 *
 * «Le chat sono in disordine: la nota dell'Austria e "Arrendetevi" sono fuori
 * sequenza» (turno 4, 1815-09-08).
 *
 * Il server ordina correttamente ma il client mostrava i messaggi nell'ordine di
 * **arrivo**: fetch, invio locale e messaggio in ritardo via SSE potevano
 * consegnarli in ordini diversi. Qui il mock consegna deliberatamente i messaggi
 * in ordine sbagliato (la nota del turno 3 per ultima, dopo lo scambio del
 * turno 4) e verifichiamo che a schermo l'ordine sia quello della timeline del
 * mondo — nel thread **e** nel riepilogo dell'elenco chat.
 *
 * Nessun backend reale, nessun provider LLM, nessuna rete esterna.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';

const CHAT_ID = 'mock-chat-austria';

/** Gli stessi tre messaggi reali della segnalazione. */
const NOTA_TURNO_3 = {
  id: 'nota-3', role: 'polity', senderName: 'Impero d’Austria',
  content: 'Nota austriaca del turno precedente', turn: 3, gameDate: '1815-09-08',
  seq: 230, createdAt: '2026-09-17T19:14:01.834Z',
};
const ORDINE_TURNO_4 = {
  id: 'ordine-4', role: 'player', senderName: 'Confederazione Germanica',
  content: 'Arrendetevi', turn: 4, gameDate: '1815-09-08',
  seq: 231, createdAt: '2026-09-17T19:14:50.270Z',
};
const RISPOSTA_TURNO_4 = {
  id: 'risposta-4', role: 'polity', senderName: 'Impero d’Austria',
  content: 'Risposta austriaca al nostro ordine', turn: 4, gameDate: '1815-09-08',
  seq: 232, createdAt: '2026-09-17T19:14:54.511Z',
};

const MOCK_CHAT = {
  id: CHAT_ID, polityId: 'AUS', polityName: 'Impero d’Austria', polityColor: '#c8b273',
  subject: 'Ultimatum di settembre',
  participants: [
    { id: 'DEU', name: 'Confederazione Germanica', role: 'player', color: '#4a7ebb' },
    { id: 'AUS', name: 'Impero d’Austria', role: 'polity', color: '#c8b273' },
  ],
  unread: 0, archived: false,
  lastMessage: NOTA_TURNO_3.content,
  lastMessageGameDate: NOTA_TURNO_3.gameDate,
  lastMessageAt: NOTA_TURNO_3.createdAt,
};

/** Registra i mock chat DOPO `installMockApi`: le route successive vincono. */
async function mockChatApi(page, messages) {
  await page.route(`**/games/${MOCK_GAME_ID}/chats/${CHAT_ID}/messages*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages }) }));
  await page.route(`**/games/${MOCK_GAME_ID}/chats*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chats: [MOCK_CHAT] }) }));
}

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function openDiplomacy(page) {
  await page.locator('.rail-btn[aria-label="Diplomazia"]').click();
  await expect(page.locator('.chat-item').first()).toBeVisible();
  await page.locator('.chat-item').first().click();
  await expect(page.locator('.chat-bubble').first()).toBeVisible();
}

test.describe('CHAT-ORDER — i messaggi seguono la timeline del mondo, non l’arrivo', () => {
  test('thread in ordine: nota turno 3, ordine turno 4, risposta turno 4', async ({ page }) => {
    installMockApi(page);
    // Il server consegna i messaggi in ordine sbagliato: la nota del turno 3
    // arriva per ultima, dopo lo scambio del turno 4.
    await mockChatApi(page, [RISPOSTA_TURNO_4, NOTA_TURNO_3, ORDINE_TURNO_4]);

    await reachHud(page);
    await openDiplomacy(page);

    const bubbles = page.locator('.chat-bubble');
    await expect(bubbles).toHaveCount(3);
    await expect(bubbles.nth(0)).toContainText('Nota austriaca del turno precedente');
    await expect(bubbles.nth(1)).toContainText('Arrendetevi');
    await expect(bubbles.nth(2)).toContainText('Risposta austriaca al nostro ordine');
  });

  test('l’indicatore di data del thread segue il messaggio più recente, non l’ultimo arrivato', async ({ page }) => {
    installMockApi(page);
    // Un quarto messaggio, appartenente a una data precedente, consegnato per
    // ultimo: se il client mostrasse l’ordine di arrivo, l’intestazione del
    // thread segnerebbe il 20 agosto invece dell’8 settembre.
    const NOTA_AGOSTO = {
      id: 'nota-ago', role: 'polity', senderName: 'Impero d’Austria',
      content: 'Nota di agosto, arrivata in ritardo', turn: 2, gameDate: '1815-08-20',
      seq: 90, createdAt: '2026-09-17T19:14:09.000Z',
    };
    await mockChatApi(page, [RISPOSTA_TURNO_4, ORDINE_TURNO_4, NOTA_TURNO_3, NOTA_AGOSTO]);

    await reachHud(page);
    await openDiplomacy(page);

    const bubbles = page.locator('.chat-bubble');
    await expect(bubbles).toHaveCount(4);
    await expect(bubbles.nth(0)).toContainText('Nota di agosto, arrivata in ritardo');
    await expect(bubbles.nth(3)).toContainText('Risposta austriaca al nostro ordine');
    await expect(page.locator('.chat-thread-stamp')).toContainText('8 set 1815');
  });
});
