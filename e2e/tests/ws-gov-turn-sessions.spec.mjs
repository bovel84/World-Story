/**
 * WS-GOV-TURN-SESSIONS — La seduta appartiene al turno (E2E A10)
 * =============================================================
 * Verifica, offline e con API mockate, il criterio di successo della Fase A:
 *  - turno N: la seduta costruisce la proposta; si prepara l'atto A;
 *  - si avanza il turno;
 *  - turno N+1: la Sala del Consiglio riparte da zero (schermata di scelta,
 *    nessuna bozza, nessuna misura), l'atto A non è più operativo, ma il
 *    ministro **ricorda** la decisione precedente;
 *  - una nuova conversazione produce un nuovo atto (B), con un'altra origine.
 *
 * Migrata alla **Sala del Consiglio**: la seduta è `.council-room`, la Tavola è
 * un drawer/sheet (`.council-room-board-toggle` → `.council-room-board`) e
 * l'atto nasce dalla **bozza comune** (`.act-draft`).
 *
 * La memoria non ha più una UI dedicata (`SeatBrief`): si verifica sul **corpo
 * della richiesta** al ministro successiva all'avanzamento. La rotta
 * `/stream` risponde 404 nel mock e `askStream` ripiega sul POST
 * `government/minister/:seat`: si catturano **entrambe** e si asserisce sul
 * corpo JSON che le porta.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import {
  reachHud, openGovernment, ask, openBoard, closeBoard, prepareCommonDraft, sign, replies,
} from './helpers/government.mjs';

/**
 * La bozza del turno 1 nomina «Infrastrutture», parola che il mock del motore
 * associa a un'opera: senza una regione canonica nel testo la verifica dichiara
 * la funzione assente e la firma resta (giustamente) bloccata. Questa spec prova
 * il confine fra i turni, non la distinta d'opera: una route mock locale dice al
 * client che l'atto è di sola prosa, così la bozza è firmabile. Il contratto
 * E2E consente route mock aggiuntive dentro la spec.
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

/** Avanza il turno dalla barra del tempo. */
async function advanceTurn(page) {
  await page.locator('.hud-advance-btn').click();
  await expect(page.locator('.time-desk-content')).toBeVisible();
  await page.locator('.time-desk-next').click();
  await expect(page.locator('.time-desk-content')).toBeHidden({ timeout: 20_000 });
}

/** Apre una seduta con il Tesoro come relatore e attende il suo saluto. */
async function openTesoroRoom(page) {
  await page.locator('.cabinet-pick[data-seat="tesoro"]').click();
  await expect(page.locator('.council-room')).toBeVisible({ timeout: 10_000 });
  await expect(replies(page).first()).toContainText('La cassa regge', { timeout: 15_000 });
}

test('WS-GOV-TURN-SESSIONS: il turno nuovo riparte da zero, il passato è memoria', async ({ page }) => {
  installMockApi(page);
  await plainTextFeasibility(page);
  await reachHud(page);

  // ── TURNO N ──────────────────────────────────────────────────────────────
  await openGovernment(page);
  await openTesoroRoom(page);
  const room = page.locator('.council-room');

  // La conversazione costruisce la proposta: obiettivo (turno 1) e misure 80/20.
  await ask(page, 'Voglio investire nelle infrastrutture.');
  await ask(page, '80% infrastrutture, 20% debito.');
  await openBoard(page);
  await expect(page.locator('.council-room-board .council-board-measure')).not.toHaveCount(0);

  // Atto A: preparato dalla proposta del turno 1.
  const draftA = await prepareCommonDraft(page);
  await expect(draftA).toHaveAttribute('data-source-turn', '1');
  const textA = await draftA.locator('.act-draft-text').inputValue();
  expect(textA).toContain('Infrastrutture');
  const titleA = textA.split('\n').map(line => line.trim()).find(Boolean);
  expect(titleA).toBeTruthy();
  // Firma l'atto A: entra nel registro del turno N.
  await sign(page);
  await expect(draftA.locator('.act-draft-state')).toHaveText('accodato', { timeout: 10_000 });

  // Si chiude l'ufficio e si avanza il turno.
  await page.locator('.council-room-close').click();
  await expect(page.locator('.government-office')).toBeHidden();
  await advanceTurn(page);

  // ── TURNO N+1 ────────────────────────────────────────────────────────────
  // La memoria non ha una UI dedicata: si verifica sul filo. Catturiamo ENTRAMBE
  // le rotte della richiesta al ministro (`/stream`, che nel mock risponde 404, e
  // il POST di ripiego): il corpo JSON con `memory` sta in quella che risponde.
  const ministerBodies = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (!/\/government\/minister\/[^/]+(\/stream)?$/.test(request.url())) return;
    try { ministerBodies.push(request.postDataJSON()); } catch { /* body non JSON */ }
  });

  // Riaprendo il Governo si riparte dalla scelta: nessuna seduta del turno 1.
  await openGovernment(page);
  await expect(room).toHaveCount(0);
  await expect(page.locator('.act-draft')).toHaveCount(0);

  // Una nuova seduta (turno 2) riparte da zero: la chat è quella nuova (solo il
  // saluto del turno 2), nessuna misura, nessuna bozza.
  await openTesoroRoom(page);
  await expect(replies(page)).toHaveCount(1);
  await expect(page.locator('.council-room-thread')).not.toContainText('Investire l’avanzo nelle infrastrutture');
  await openBoard(page);
  await expect(page.locator('.council-room-board .council-board-measure')).toHaveCount(0);
  await expect(page.locator('.act-draft')).toHaveCount(0);
  await closeBoard(page);

  // Il passato è **memoria**: il ministro ricorda la decisione del turno 1. La
  // nuova richiesta porta l'atto accodato con il turno d'origine.
  await ask(page, 'Continuiamo il programma per le province orientali.');
  await expect.poll(() => ministerBodies.some(body =>
    Array.isArray(body?.memory) && body.memory.some(record =>
      typeof record?.summary === 'string'
      && record.summary.includes('Atto accodato')
      && record.summary.includes(titleA)
      && record.refs?.turn === 1,
    ),
  ), { timeout: 10_000 }).toBe(true);

  // Una nuova conversazione produce un nuovo atto, con un'altra origine.
  await openBoard(page);
  const draftB = await prepareCommonDraft(page);
  await expect(draftB).toHaveAttribute('data-source-turn', '2');
  const textB = await draftB.locator('.act-draft-text').inputValue();
  expect(textB).toContain('Province orientali');
  // Atto A != Atto B: contenuto e origine diversi.
  expect(textB).not.toBe(textA);
});
