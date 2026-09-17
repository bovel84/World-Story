/**
 * World Story — E2E mock: DECISION-IMPACT (quanto hanno inciso le decisioni)
 * =========================================================================
 *
 * «La cassa sta perdendo ma io non so quanto le mie decisioni stanno incidendo
 * positivamente o negativamente.»
 *
 * Il test verifica nel browser, offline e con API mockate, che dopo un
 * avanzamento in cui il motore ha addebitato un ordine:
 *   1. la cronaca mostri, per il turno, **quanto** è stato addebitato alla
 *      singola decisione (numero del motore, non una stima della UI);
 *   2. mostri il totale delle decisioni e la quota che le singole decisioni
 *      **non** spiegano, ricavata dalla variazione registrata della tesoreria;
 *   3. non compaia alcun importo quando il motore non ha registrato nulla.
 *
 * Nessun backend reale, nessun provider LLM, nessuna rete esterna.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_SETTLEMENT } from '../mock-api.mjs';

/** Raggiunge l'HUD di gioco dal landing (stesso percorso dello smoke test). */
async function reachHud(page) {
  await page.goto('/');
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await expect(page.locator('.game-shell')).toBeVisible({ timeout: 20_000 });
}

/** Esito di avanzamento con un ordine eseguito e il suo addebito registrato. */
function actionsProcessed() {
  return {
    type: 'actions_processed',
    simulationId: 'mock-simulation-2',
    revision: 2,
    processedCount: 1,
    actions: [
      {
        id: 'mock-action-1',
        text: 'Costruire una ferrovia verso il confine',
        status: 'completed',
        result: {
          narration: 'I lavori della linea ferroviaria sono avviati.',
          events: ['Avviati i lavori sulla linea ferroviaria'],
          eventDetails: [],
          outcome: { status: 'accepted', summary: 'I lavori della linea ferroviaria sono avviati.' },
          settlement: MOCK_SETTLEMENT,
          objects: [],
          turn: 1,
          periodStart: '1951-01-01',
          periodEnd: '1951-02-01',
        },
      },
    ],
  };
}

async function advance(page) {
  await page.locator('.hud-advance-btn').click();
  await expect(page.locator('.time-desk-content')).toBeVisible();
  await page.locator('.time-desk-next').click();
}

test.describe('DECISION-IMPACT — quanto hanno inciso le decisioni', () => {
  test('la cronaca mostra l’addebito per decisione e la quota non attribuibile', async ({ page }) => {
    installMockApi(page, {
      advanceResult: actionsProcessed(),
      // Lo storico conti pubblicato dal motore: tesoreria da 100 a 80,5 mld
      // (variazione −19,50) di cui l'ordine spiega −12,40.
      accountHistory: [
        { date: '1951-01-01', turn: 1, account: { money: 100, stability: 60 } },
        { date: '1951-02-01', turn: 2, account: { money: 80.5, stability: 58 } },
      ],
    });
    await reachHud(page);

    // Prima dell'avanzamento nessun ordine è stato eseguito: niente attribuzione.
    await page.locator('.hud-timeline-toggle').click();
    await expect(page.locator('.hud-timeline-panel-content')).toBeVisible();
    await page.locator('.hud-timeline-entry-head').first().click();
    await expect(page.locator('.decision-impact')).toHaveCount(0);
    // Chiudi la cronaca (la ✕ del pannello): l'avanzamento si comanda dalla barra.
    await page.locator('.hud-timeline-panel-content button[aria-label="Chiudi il pannello timeline"]').click();
    await expect(page.locator('.hud-timeline-panel-content')).toBeHidden();

    // Avanza: il motore esegue l'ordine e ne registra l'addebito.
    await advance(page);
    await expect(page.locator('.suggestions-content')).toBeHidden();

    await page.locator('.hud-timeline-toggle').click();
    await expect(page.locator('.hud-timeline-panel-content')).toBeVisible();
    await page.locator('.hud-timeline-entry-head').first().click();

    const block = page.locator('.hud-timeline-decision-impact');
    await expect(block).toBeVisible();
    // Effetto della singola decisione: numero del motore (12,40 mld), negativo.
    await expect(block).toContainText('Costruire una ferrovia verso il confine');
    await expect(block).toContainText('−12,40 mld');
    await expect(block).toContainText('Infrastrutture');
    await expect(block).toContainText('Totale addebitato alle tue decisioni');
    // Variazione registrata (−19,50) e quota non attribuibile (−7,10).
    await expect(block).toContainText('−19,50 mld');
    await expect(block).toContainText('−7,10 mld');
    await expect(block).toContainText('non è attribuibile alle singole decisioni');
    // Le variazioni del turno restano dichiarate come non causali.
    await expect(page.locator('.hud-timeline-impact')).toContainText('Stabilità');
  });

  test('senza addebito registrato dal motore non compare alcun importo inventato', async ({ page }) => {
    installMockApi(page, {
      advanceResult: {
        ...actionsProcessed(),
        actions: [{
          ...actionsProcessed().actions[0],
          // Ordine eseguito ma senza effetto economico registrato.
          result: { ...actionsProcessed().actions[0].result, settlement: undefined },
        }],
      },
      accountHistory: [
        { date: '1951-01-01', turn: 1, account: { money: 100 } },
        { date: '1951-02-01', turn: 2, account: { money: 80.5 } },
      ],
    });
    await reachHud(page);
    await advance(page);
    await expect(page.locator('.suggestions-content')).toBeHidden();

    await page.locator('.hud-timeline-toggle').click();
    await page.locator('.hud-timeline-entry-head').first().click();

    // La variazione del turno resta leggibile (registrata dal motore)…
    await expect(page.locator('.hud-timeline-impact')).toContainText('Tesoreria');
    // …ma nessuna attribuzione per decisione viene inventata.
    await expect(page.locator('.decision-impact')).toHaveCount(0);
  });
});
