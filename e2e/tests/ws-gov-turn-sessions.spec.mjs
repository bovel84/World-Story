/**
 * WS-GOV-TURN-SESSIONS — La seduta appartiene al turno (E2E A10)
 * =============================================================
 * Verifica, offline e con API mockate, il criterio di successo della Fase A:
 *  - turno N: la conversazione costruisce la proposta; si prepara l'atto A;
 *  - si avanza il turno;
 *  - turno N+1: la Tavola e la chat ripartono da zero (`revision = 0`), l'atto A
 *    non è più operativo, ma il ministro **ricorda** la decisione precedente;
 *  - una nuova conversazione produce un nuovo atto (B), con un'altra origine.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

async function ask(page, chat, text) {
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
}

/** Apre l'ufficio e la seduta del Tesoro. */
async function openTesoro(page) {
  await page.locator('.rail-btn[aria-label="Governo"]').click();
  await page.locator('.government-office').locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
}

/** Avanza il turno dalla barra del tempo. */
async function advanceTurn(page) {
  await page.locator('.hud-advance-btn').click();
  await expect(page.locator('.time-desk-content')).toBeVisible();
  await page.locator('.time-desk-next').click();
  await expect(page.locator('.time-desk-content')).toBeHidden({ timeout: 20_000 });
}

test('WS-GOV-TURN-SESSIONS: il turno nuovo riparte da zero, il passato è memoria', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);

  // ── TURNO N ──────────────────────────────────────────────────────────────
  await openTesoro(page);
  const chat = page.locator('.government-office-pane-chat');
  const tavola = page.locator('.government-office-pane-table');
  const board = tavola.locator('.decision-board');

  await ask(page, chat, 'Voglio investire nelle infrastrutture.');
  await ask(page, chat, '80% infrastrutture, 20% debito.');
  await expect(board).toContainText('Investire l’avanzo nelle infrastrutture');

  // Atto A: preparato dalla proposta del turno 1.
  await board.locator('.decision-prepare').click();
  const draftA = tavola.locator('.act-draft');
  await expect(draftA).toBeVisible();
  await expect(draftA).toHaveAttribute('data-source-turn', '1');
  const textA = await draftA.locator('.act-draft-text').inputValue();
  expect(textA).toContain('Infrastrutture');
  // Firma l'atto A: entra nel registro del turno N.
  await expect(draftA.locator('.act-draft-sign')).toBeEnabled();
  await draftA.locator('.act-draft-sign').click();
  await expect(draftA.locator('.act-draft-state')).toHaveText('accodato', { timeout: 10_000 });

  // Si chiude l'ufficio e si avanza il turno.
  await page.locator('.government-office').locator('.desk-close-x').click();
  await expect(page.locator('.government-office')).toBeHidden();
  await advanceTurn(page);

  // ── TURNO N+1 ────────────────────────────────────────────────────────────
  await openTesoro(page);

  // Lo stato operativo è ripartito da zero: nessuna proposta, nessun atto.
  await expect(page.locator('.government-office-pane-table').locator('.decision-board')).toHaveCount(0);
  await expect(page.locator('.government-office-pane-table').locator('.act-draft')).toHaveCount(0);
  // La chat visibile è quella della seduta corrente: nessun messaggio del turno 1.
  await expect(page.locator('.government-office-pane-chat').locator('.minister-entry.assistant:not(.minister-greeting)')).toHaveCount(0);

  // Il passato è **memoria**: il ministro ricorda la decisione del turno 1.
  await expect(page.locator('.seat-brief-memory').first()).toContainText('Investire l’avanzo nelle infrastrutture', { timeout: 10_000 });
  // Reperto: la nuova seduta (turno 2) — stato operativo a zero, memoria viva.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.government-office').screenshot({ path: '../docs/implementation/assets/ws-gov-turn-sessions/390x844-nuova-seduta.png' });
  // Si torna al desktop: entrambe le pane sono visibili per la nuova discussione.
  await page.setViewportSize({ width: 1280, height: 800 });

  // Una nuova conversazione produce un nuovo atto, con un'altra origine.
  const chat2 = page.locator('.government-office-pane-chat');
  const board2 = page.locator('.government-office-pane-table').locator('.decision-board');
  await ask(page, chat2, 'Continuiamo il programma per le province orientali.');
  await expect(board2).toContainText('Programma per le province orientali');
  await expect(board2).toContainText('Province orientali');
  await board2.locator('.decision-prepare').click();
  const draftB = page.locator('.government-office-pane-table').locator('.act-draft');
  await expect(draftB).toHaveAttribute('data-source-turn', '2');
  const textB = await draftB.locator('.act-draft-text').inputValue();
  expect(textB).toContain('Province orientali');
  // Atto A != Atto B: contenuto e origine diversi.
  expect(textB).not.toBe(textA);
  // Reperto: la Tavola del nuovo turno con gli Approfondimenti chiusi (A7).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.gov-mobile-tab', { hasText: 'Tavola' }).click();
  await page.locator('.government-office').screenshot({ path: '../docs/implementation/assets/ws-gov-turn-sessions/390x844-atto-b.png' });
});
