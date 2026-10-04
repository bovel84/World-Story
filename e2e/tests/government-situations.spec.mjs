/**
 * WS-GOV-SITUATIONS — la porta del Governo sono le situazioni del motore.
 * =======================================================================
 * La schermata iniziale non è più solo «scegli un ministro»: mostra ciò che
 * preme (urgenze e opportunità) con i fatti reali, il ministro competente e la
 * domanda da sciogliere. «Apri Consiglio» apre la seduta sul relatore giusto,
 * con la questione come oggetto — e NON convoca gli altri ministri da solo.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment } from './helpers/government.mjs';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' });

function situation(overrides) {
  return {
    id: `situation:${overrides.id}`,
    pressureId: overrides.id,
    title: overrides.title,
    briefing: overrides.briefing,
    source: overrides.source,
    severity: overrides.severity,
    priority: overrides.priority,
    openedDate: '1951-03-01',
    deadline: null,
    daysLeft: overrides.daysLeft,
    leadMinister: overrides.leadMinister,
    suggestedMinisters: overrides.suggestedMinisters,
    verifiedFacts: overrides.verifiedFacts,
    decisionQuestion: overrides.decisionQuestion,
    options: [{ id: 'opt', label: 'Opzione', detail: 'Dettaglio', effectNote: 'Nota del motore.' }],
    inaction: { note: overrides.inaction },
    affectedDomains: ['difesa'],
    origin: { type: overrides.originType ?? 'state' },
  };
}

const pressures = [
  {
    id: 'external:border-incident#t3', kind: 'external', template: 'border-incident',
    title: 'Incidente di frontiera con Serbia', detail: 'Due militari uccisi e accuse incrociate.',
    severity: 3, source: 'Comando di frontiera', options: [], status: 'active',
    createdDate: '1951-03-01', createdTurn: 3, priority: 'critica', highlighted: true,
    situation: situation({ id: 'external:border-incident#t3', title: 'Incidente di frontiera con Serbia',
      briefing: 'Due militari uccisi e accuse incrociate con Serbia.', source: 'Comando di frontiera',
      severity: 3, priority: 'critica', daysLeft: 4, leadMinister: 'guerra', suggestedMinisters: ['tesoro', 'esteri'],
      verifiedFacts: ['Forze mobilitate 35', 'Potenziale militare 1201'],
      decisionQuestion: 'Come rispondiamo all’incidente?', inaction: 'la tensione al confine aumenta.' }),
  },
  {
    id: 'external:alliance-offer#t3', kind: 'external', template: 'alliance-offer',
    title: 'Romania propone un patto', detail: 'Offerta di mutua assistenza.',
    severity: 1, source: 'Ambasciata di Romania', options: [], status: 'active',
    createdDate: '1951-03-01', createdTurn: 3, priority: 'ordinaria', highlighted: false,
    situation: situation({ id: 'external:alliance-offer#t3', title: 'Romania propone un patto',
      briefing: 'Offerta di mutua assistenza: basi e transito in cambio di protezione.', source: 'Ambasciata di Romania',
      severity: 1, priority: 'ordinaria', daysLeft: 25, leadMinister: 'esteri', suggestedMinisters: ['tesoro', 'guerra'],
      verifiedFacts: ['Potenziale militare 1201'],
      decisionQuestion: 'Accettiamo il patto proposto?', inaction: 'l’offerta resta sul tavolo, ma la fiducia cala.' }),
  },
];

test('la porta del Governo mostra urgenze e opportunità, e apre il Consiglio sul relatore competente', async ({ page }) => {
  installMockApi(page);
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: { pressures, recent: [], foodCoverageMonths: 2 } }));
  await reachHud(page);
  await openGovernment(page);

  const panel = page.locator('.government-situations');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('PROBLEMI CHE RICHIEDONO DECISIONE', { exact: true })).toBeVisible();
  await expect(panel.getByText('OPPORTUNITÀ', { exact: true })).toBeVisible();
  await expect(panel.locator('.gov-situation')).toHaveCount(2);
  await expect(panel).toContainText('Incidente di frontiera con Serbia');
  await expect(panel).toContainText('Forze mobilitate 35');
  await expect(panel).toContainText('Come rispondiamo all’incidente?');
  await expect(panel).toContainText('Se non decidiamo: la tensione al confine aumenta.');
  // Nessun numero con più di due decimali nella prosa del Governo.
  expect(await panel.innerText()).not.toMatch(/[.,]\d{3,}/);

  // Apre il Consiglio: relatore la Guerra, oggetto la domanda, nessuna convocazione automatica.
  const incident = panel.locator('.gov-situation').first();
  await incident.getByRole('button', { name: 'Porta al Consiglio', exact: true }).click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Incidente di frontiera con Serbia');
  await expect(room.locator('.council-room-rapporteur')).toContainText('Ministro della Guerra');
  await expect(room.locator('.council-room-chip')).toHaveCount(1);
});
