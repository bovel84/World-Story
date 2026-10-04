/**
 * WS-GOVUX-P1 — L'agenda viva del Governo (E2E mirato, viewport mobile)
 * ==================================================================
 * WS-GOV-REALITY-ADVISOR: la schermata di scelta duplicata è uscita; la home è
 * il Consulente più un roster UNICO dei sette ministri. Qui si verifica che:
 *  - il roster è completo e apre le sedute;
 *  - una seduta avviata è riprendibile dopo il ritorno alla home;
 *  - l'apertura della seduta parte dalla home, senza percorsi duplicati.
 */

import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_CABINET } from '../mock-api.mjs';
import { reachHud, openGovernment, ask, replies } from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('roster unico, seduta ripresa e apertura dalla home', async ({ page }) => {
  installMockApi(page);
  await reachHud(page);
  const ufficio = await openGovernment(page);

  // Il roster è completo: sette sedie, sempre visibili.
  const roster = ufficio.locator('.government-roster-seat');
  await expect(roster).toHaveCount(7);

  // Apriamo la seduta con il Tesoro e facciamo un solo scambio.
  await ufficio.locator('.government-roster-seat[data-seat="tesoro"]').click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await ask(page, 'La cassa regge?');
  await expect(replies(page)).toHaveCount(2);

  // Torna alla home: la seduta resta riprendibile, con il suo stato.
  await page.locator('.council-room-back').click();
  await expect(ufficio).toBeVisible();
  const resume = ufficio.locator('.council-room-resume');
  await expect(resume).toHaveCount(1);
  await expect(resume).toContainText('Riprendi seduta');
  await resume.click();
  await expect(room).toBeVisible();
  await expect(replies(page)).toHaveCount(2);
});

test('la home resta coerente anche con una voce critica del motore', async ({ page }) => {
  // La stessa cabina del mock, con una voce del Tesoro critica (dal motore).
  const critical = { ...MOCK_CABINET,
    addresses: MOCK_CABINET.addresses.map(address => address.seat !== 'tesoro' ? address : {
      ...address,
      items: address.items.map(item => ({ ...item, urgency: 'critica' })),
    }) };
  installMockApi(page, { cabinet: critical });
  await reachHud(page);
  const ufficio = await openGovernment(page);
  // Il Consulente e il roster restano la sola porta: nessuna lista duplicata.
  await expect(ufficio.locator('.government-advisor')).toBeVisible();
  await expect(ufficio.locator('.government-roster-seat')).toHaveCount(7);
});
