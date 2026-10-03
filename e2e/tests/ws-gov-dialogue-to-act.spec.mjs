/**
 * WS-GOV-DIALOGUE-TO-ACT — Il flusso Tesoro end-to-end (gate fondamentale)
 * ======================================================================
 * Migrata alla Sala del Consiglio (seduta condivisa + Tavola a scomparsa).
 * Il criterio di successo resta lo stesso: **la conversazione modifica la
 * Tavola, la Tavola rappresenta la proposta corrente, e l'atto nasce dalla
 * proposta corrente** (mai da una strada preimpostata).
 *
 *  1. la conversazione produce una proposta strutturata e revisionabile
 *     (obiettivo del Presidente, proposta del ministro 70/30, 80/20 del
 *     Presidente);
 *  2. la Tavola mostra la proposta corrente (non un vecchio atto del Tesoro);
 *  3. l'atto preparato (bozza comune) contiene **quei** valori e **non** quelli
 *     iniziali;
 *  4. i blocchi `decision`/`tavola` non sono mai prosa visibile nel filo.
 *
 * Adattamento obbligatorio #1: il mock etichetta le misure 80/20 come
 * `source: president`, ma il client declassa una fonte dichiarata dal modello a
 * `minister`/`proposed`. Per renderle concordate serve l'atto esplicito del
 * Presidente: «Conferma proposta» (`.council-board-confirm`).
 */

import { test, expect } from 'playwright/test';
import { installMockApi } from '../mock-api.mjs';
import {
  reachHud, openCouncilRoom, ask, openBoard, prepareCommonDraft,
} from './helpers/government.mjs';

test('WS-GOV-DIALOGUE-TO-ACT: la conversazione diventa proposta, e l’atto nasce da lei', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  await openCouncilRoom(page, 'tesoro');
  // Il saluto del relatore è il primo intervento assistente.
  await expect(page.locator('.council-room-message.assistant').first()).toContainText('La cassa regge');

  // [1] QUESTIONE / OBIETTIVO — il Presidente dice cosa vuole.
  await ask(page, 'Voglio investire nelle infrastrutture.');
  const board = await openBoard(page);
  await expect(board.locator('.council-board-question')).toContainText('Investire l’avanzo nelle infrastrutture');

  // [2] PROPOSTA DEL MINISTRO — 70/30 resta una proposta, non una decisione.
  await ask(page, 'Come useresti l’avanzo?');
  const ministerProposals = board.locator('.council-board-measure[data-source="minister"][data-status="proposed"]');
  await expect(ministerProposals).toHaveCount(2);
  await expect(ministerProposals.filter({ hasText: '70%' })).toHaveCount(1);
  await expect(ministerProposals.filter({ hasText: '30%' })).toHaveCount(1);

  // [3] L'80/20 arriva dal modello, ma il client lo declassa a proposta del
  //     ministro: la proposta corrente non contiene più 70/30.
  await ask(page, '80% infrastrutture, 20% debito.');
  await expect(board.locator('.council-board-proposal')).toContainText('80%');
  await expect(board.locator('.council-board-proposal')).toContainText('20%');
  await expect(board.locator('.council-board-proposal')).not.toContainText('70%');
  await expect(board.locator('.council-board-measure[data-source="minister"][data-status="proposed"]')).toHaveCount(2);

  // I blocchi strutturati non sono mai prosa visibile nel filo.
  const thread = page.locator('.council-room-thread');
  await expect(thread).not.toContainText('```');
  await expect(thread).not.toContainText('update-proposal');
  await expect(thread).not.toContainText('set-objective');

  // [3b] L'evidenza richiesta in conversazione è un blocco `tavola`: resta
  //      invisibile come prosa e apre il blocco reale sulla Tavola.
  await ask(page, 'Mi mostri dove va la spesa?');
  await expect(thread).not.toContainText('```');
  await expect(thread).not.toContainText('"op"');
  await expect(page.locator('.council-room-evidence-link')).toBeVisible();
  await page.locator('.council-room-evidence-link').first().click();
  await expect(page.locator('.council-board-focus-evidence [data-block-id="bilancio"]')).toBeVisible();

  // [4] DECISIONE DEL PRESIDENTE — la conferma esplicita rende le misure
  //     concordate (`accepted`), non basta la dichiarazione del modello.
  await board.locator('.council-board-confirm').click();
  await expect(board.locator('.council-board-measure[data-status="accepted"]')).toHaveCount(2);

  // [5] L'ATTO NASCE DALLA PROPOSTA CORRENTE: la bozza comune contiene 80/20 e
  //     NON i valori della vecchia strada del Tesoro.
  await prepareCommonDraft(page);
  const draftText = page.locator('.act-draft-text');
  await expect(draftText).toHaveValue(/80%/);
  await expect(draftText).toHaveValue(/20%/);
  await expect(draftText).toHaveValue(/Infrastrutture/);
  await expect(draftText).not.toHaveValue(/Rimborso titoli/);
  await expect(draftText).not.toHaveValue(/8,40 mld/);

  // [6] Una nuova revisione rende la bozza preparata non più attuale; la
  //     ri-preparazione la riallinea (90/10) senza i vecchi 80.
  await ask(page, 'Portiamo le infrastrutture al 90%.');
  await expect(board.locator('.council-board-warning')).toBeVisible();
  await prepareCommonDraft(page);
  await expect(draftText).toHaveValue(/90%/);
  await expect(draftText).toHaveValue(/10%/);
  await expect(draftText).not.toHaveValue(/80%/);
  await expect(draftText).not.toHaveValue(/Rimborso titoli/);
  await expect(thread).not.toContainText('```');

  // La Tavola resta aperta sulla seduta (mobile, bottom sheet).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.council-room-board')).toBeVisible();
});
