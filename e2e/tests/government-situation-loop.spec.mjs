/**
 * WS-GOV-SITUATIONS-LOOP — Il ciclo completo, in browser.
 * ======================================================
 * Situazione reale → Sala del Consiglio con i fatti del motore → ministri
 * suggeriti (non convocati) → decisione composta (solo id canonici) → firma →
 * risoluzione della Pressure con gli STESSI id, una volta.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment, openBoard, ask, prepareCommonDraft, waitSignEnabled, sign } from './helpers/government.mjs';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' });

const situation = {
  id: 'situation:external:border-incident#t3',
  pressureId: 'external:border-incident#t3',
  title: 'Incidente di frontiera con Serbia',
  briefing: 'Due militari uccisi e accuse incrociate con Serbia.',
  source: 'Comando di frontiera',
  severity: 3,
  priority: 'critica',
  openedDate: '1951-03-01',
  deadline: '1951-03-31',
  daysLeft: 12,
  leadMinister: 'tesoro',
  suggestedMinisters: ['lavori', 'istruzione'],
  verifiedFacts: ['Forze mobilitate 35', 'Tensione sociale 48/100'],
  decisionQuestion: 'Come rispondiamo all’incidente?',
  options: [
    { id: 'retaliate', label: 'Rafforzare il settore', detail: 'Un battaglione per novanta giorni.', effectNote: 'Escalation possibile.' },
    { id: 'internationalize', label: 'Portare il caso all’ONU', detail: 'Tribuna internazionale.', effectNote: 'Tempo guadagnato.' },
  ],
  inaction: { note: 'la tensione al confine aumenta.' },
  affectedDomains: ['difesa'],
  origin: { type: 'state' },
};

const pressure = {
  id: situation.pressureId, kind: 'external', template: 'border-incident', title: situation.title,
  detail: situation.briefing, severity: 3, source: situation.source, options: [], status: 'active',
  createdDate: '1951-03-01', createdTurn: 3, priority: 'critica', highlighted: true, situation,
};

test('situazione → Consiglio → decisione composta → risoluzione con gli stessi id canonici', async ({ page }) => {
  installMockApi(page);
  const resolves = [];
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: { pressures: [pressure], recent: [], foodCoverageMonths: 2 } }));
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures/*/resolve`, route => {
    resolves.push(route.request().postDataJSON());
    return route.fulfill({ json: { pressure: { id: situation.pressureId }, effect: { note: 'ok' } } });
  });
  const minister = `**/api/games/${MOCK_GAME_ID}/government/minister/`;
  await page.route(`${minister}*/opening`, route => route.fulfill({ json: {
    reply: 'Presidente, stanotte un posto di guardia al confine è stato attaccato: due morti e accuse incrociate. Ci restano 12 giorni prima che la situazione venga considerata irrisolta. Propongo di rafforzare il settore, ma prima vorrei sentire Lavori e Istruzione.',
    seat: 'tesoro',
  } }));
  await page.route(`${minister}*/stream`, route => route.fulfill({ status: 200, contentType: 'text/plain', body:
    'Presidente, propongo di rafforzare il settore e, in parallelo, portare il caso all’ONU.\n```decision\n{"op":"update-proposal","objective":"Risposta all’incidente","changes":[{"label":"Rafforzare il settore","value":"un battaglione","source":"minister"}]}\n```\n```consiglio\n{"pressureOptions":["retaliate","inventata","internationalize"]}\n```',
  }));

  await reachHud(page);
  await openGovernment(page);
  await page.locator('.gov-situation').first().getByRole('button', { name: 'Porta al Consiglio', exact: true }).click();

  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  // L'oggetto è il TITOLO della situazione, non la domanda.
  await expect(room.locator('.council-room-topic')).toHaveText(situation.title);
  await expect(room.locator('.council-room-message.assistant').first()).toContainText('due morti');
  // I suggeriti sono visibili, ma NON sono partecipanti.
  await expect(room.locator('.council-room-suggested-seat')).toHaveCount(2);
  await expect(room.locator('.council-room-chip')).toHaveCount(1);

  // Il ministro risponde: la Tavola riceve la situazione e seleziona solo gli id canonici.
  await ask(page, 'Come rispondiamo all’incidente?');
  await openBoard(page);
  const board = page.locator('.council-room-board');
  await expect(board.locator('.council-board-situation-title')).toHaveText(situation.title);
  await expect(board).toContainText('Forze mobilitate 35');
  await expect(board).toContainText('Come rispondiamo all’incidente?');
  await expect(board).toContainText('Se non decidiamo: la tensione al confine aumenta.');
  // P0 — Il ministro PROPONE; la Tavola non mostra nulla come confermato.
  await expect(board.locator('.council-board-minister-proposal')).toHaveCount(2);
  await expect(board.locator('.council-board-response-picked')).toHaveCount(0);
  await expect(board).not.toContainText('inventata');
  // Il PRESIDENTE conferma le due strade canoniche.
  await board.locator('.council-board-minister-proposal', { hasText: 'Rafforzare il settore' }).getByRole('button', { name: /Conferma/ }).click();
  await board.locator('.council-board-minister-proposal', { hasText: 'Portare il caso all’ONU' }).getByRole('button', { name: /Conferma/ }).click();
  await expect(board.locator('.council-board-response-picked')).toHaveCount(2);

  // Firma: la Pressure si risolve con gli stessi id canonici, una sola volta.
  await prepareCommonDraft(page);
  await waitSignEnabled(page);
  await sign(page);
  await expect.poll(() => resolves.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const payload = resolves[0];
  const ids = payload.optionIds ?? [payload.optionId];
  expect(ids).toEqual(expect.arrayContaining(['retaliate', 'internationalize']));
  expect(JSON.stringify(payload)).not.toContain('inventata');
});

test('Apri rapporto apre un VERO follow-up con gli outcome reali', async ({ page }) => {
  installMockApi(page);
  const followUp = {
    id: 'follow-up:external:border-incident#t3', pressureId: situation.pressureId, owner: 'tesoro', dueDate: '1951-03-31', daysLeft: -1,
    label: 'Schieramento al confine: copertura logistica', checks: ['Copertura finanziaria del costo autorizzato'],
    outcome: ['Disavanzo annuo 4,1% del PIL'], origin: { type: 'previous-decision', sourceId: situation.pressureId }, situation,
  };
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: { pressures: [], recent: [], foodCoverageMonths: 2, followUps: [followUp] } }));
  await page.route(`**/api/games/${MOCK_GAME_ID}/government/minister/*/opening`, route => route.fulfill({ json: {
    reply: 'Presidente, sono passati trenta giorni dallo schieramento: il costo è stato assorbito e il disavanzo annuo è al 4,1% del PIL. Non ripropongo strade: riferisco che cosa è cambiato.',
    seat: 'tesoro',
  } }));

  await reachHud(page);
  await openGovernment(page);
  await expect(page.getByText('RAPPORTI DA LEGGERE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apri rapporto', exact: true }).click();

  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Rapporto: Schieramento al confine: copertura logistica');
  await expect(room.locator('.council-room-message.assistant').first()).toContainText('4,1% del PIL');
  await openBoard(page);
  const board = page.locator('.council-room-board');
  await expect(board.getByRole('heading', { name: 'RAPPORTO' })).toBeVisible();
  await expect(board).toContainText('Disavanzo annuo 4,1% del PIL');
  await expect(board).toContainText('una decisione precedente');
});
