/**
 * WS-GOV-DIALOGUE-TO-ACT — Il flusso Tesoro end-to-end (gate fondamentale)
 * ======================================================================
 * Il criterio di successo del task: **la conversazione modifica la Tavola, la
 * Tavola rappresenta la proposta corrente, e l'atto nasce dalla proposta
 * corrente**. Verifica, offline e con API mockate, che:
 *
 *  1. la conversazione produce una proposta strutturata e revisionabile (obiettivo
 *     del Presidente, proposta del ministro, 80/20 del Presidente);
 *  2. la Tavola mostra la proposta corrente (non il vecchio atto del Tesoro);
 *  3. l'atto preparato contiene **quei** valori e **non** quelli iniziali;
 *  4. i blocchi `decision` non sono mai prosa visibile.
 *
 * È vietato che chat, tavola e atto divergano: qui i tre livelli convergono.
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';

const SHOT = '../docs/implementation/assets/ws-gov-dialogue-to-act/390x844-decision-workspace.png';

async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Invia un messaggio al ministro e aspetta la risposta conclusa. */
async function ask(page, chat, text) {
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await expect(chat.locator('.minister-entry.assistant:not(.minister-greeting)').last()).toContainText('ha preso nota del problema', { timeout: 15_000 });
}

test('WS-GOV-DIALOGUE-TO-ACT: la conversazione diventa proposta, e l’atto nasce da lei', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);

  await page.locator('.rail-btn[aria-label="Governo"]').click();
  const ufficio = page.locator('.government-office');
  await ufficio.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();

  const chat = page.locator('.government-office-pane-chat');
  const tavola = page.locator('.government-office-pane-table');
  const board = tavola.locator('.decision-board');

  // [1] QUESTIONE / OBIETTIVO — il Presidente dice cosa vuole.
  await ask(page, chat, 'Voglio investire nelle infrastrutture.');
  await expect(board).toBeVisible();
  await expect(board).toContainText('Obiettivo');
  await expect(board).toContainText('Investire l’avanzo nelle infrastrutture');
  await expect(board).toContainText('Continua la discussione');

  // [2] PROPOSTA DEL MINISTRO — 70/30 resta una proposta, non una decisione.
  await ask(page, chat, 'Come useresti l’avanzo?');
  await expect(board).toContainText('Proposta corrente');
  await expect(board).toContainText('70%');
  await expect(board).toContainText('30%');
  await expect(board).toContainText('proposta del ministro');
  await expect(board).toContainText('Da decidere');

  // [3] DECISIONE DEL PRESIDENTE — 80/20 diventa concordata; proposta pronta.
  await ask(page, chat, '80% infrastrutture, 20% debito.');
  await expect(board).toContainText('80%');
  await expect(board).toContainText('20%');
  await expect(board).toContainText('scelta del Presidente');
  await expect(board).toContainText('pronta per l’atto');
  // La proposta CORRENTE non contiene più il 70% (la cronologia sì: è storia).
  await expect(board.locator('.decision-current')).not.toContainText('70%');

  // I blocchi strutturati non sono mai prosa visibile.
  await expect(chat).not.toContainText('```');
  await expect(chat).not.toContainText('update-proposal');

  // [3b] L'evidenza mostrata sulla tavola entra nella decisione come
  //      riferimento (non come copia, non come revisione).
  await ask(page, chat, 'Mi mostri dove va la spesa?');
  await board.getByText('Approfondimenti', { exact: false }).first().click();
  await expect(board).toContainText('Dove va la spesa');

  // [4] L'ATTO NASCE DALLA PROPOSTA CORRENTE: «Trasforma questa proposta in atto».
  await board.locator('.decision-prepare').click();
  const bozza = tavola.locator('.act-draft');
  await expect(bozza).toBeVisible();
  const testo = bozza.locator('.act-draft-text');
  await expect(testo).toHaveValue(/80%/);
  await expect(testo).toHaveValue(/20%/);
  await expect(testo).toHaveValue(/Infrastrutture/);
  // La bozza NON contiene i valori iniziali della strada del Tesoro.
  await expect(testo).not.toHaveValue(/Rimborso titoli/);
  await expect(testo).not.toHaveValue(/8,40 mld/);

  // [5] Una nuova revisione rende l'atto «non più attuale»; «Rigenera atto» lo
  //     riallinea alla proposta corrente, con i valori nuovi e senza i vecchi.
  await ask(page, chat, 'Portiamo le infrastrutture al 90%.');
  await expect(board).toContainText('Atto non più attuale');
  await expect(board.locator('.decision-regenerate')).toBeVisible();
  await board.locator('.decision-regenerate').click();
  await expect(testo).toHaveValue(/90%/);
  await expect(testo).not.toHaveValue(/80%/);
  await expect(testo).not.toHaveValue(/Rimborso titoli/);

  // Reperto: la proposta corrente sulla tavola (mobile).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.minister-session-view', { hasText: 'Tavola' }).click();
  await expect(board).toBeVisible();
  await page.screenshot({ path: SHOT, fullPage: true });
});
