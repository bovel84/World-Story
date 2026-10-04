/**
 * WS-GOV-ADVISOR-HUB — La home del Governo è il Primo Consulente.
 * ==============================================================
 * Mobile 390×844: header «Governo ✕» sticky e sempre raggiungibile, Consulente
 * in cima, card compatte con [Esamina] e [Porta al Consiglio], roster dei sette
 * ministri. Nessuna voce «Questioni» nella barra comandi.
 */
import { test, expect } from 'playwright/test';
import { installMockApi, MOCK_GAME_ID } from '../mock-api.mjs';
import { reachHud, openGovernment } from './helpers/government.mjs';

test.use({ viewport: { width: 390, height: 844 }, trace: 'off', screenshot: 'off', video: 'off' });

const situation = {
  id: 'situation:internal:harvest-failure#t3',
  pressureId: 'internal:harvest-failure#t3',
  title: 'Scorte alimentari in esaurimento',
  briefing: 'Il grano in magazzino copre meno di un mese.',
  source: 'Contadini e mercati urbani',
  severity: 3,
  priority: 'critica',
  openedDate: '1951-03-01',
  deadline: '1951-05-30',
  daysLeft: 90,
  leadMinister: 'interno',
  suggestedMinisters: ['tesoro', 'lavori'],
  verifiedFacts: ['Copertura alimentare 0,8 mesi'],
  decisionQuestion: 'Come copriamo il fabbisogno alimentare?',
  options: [{ id: 'import', label: 'Importare grano', detail: 'Cassa subito.', effectNote: 'La carestia è evitata.' }],
  inaction: { note: 'fame e rivolte del pane.' },
  affectedDomains: ['approvvigionamenti'],
  origin: { type: 'state' },
};

const cabinet = [
  { seat: 'tesoro', label: 'Ministro del Tesoro', state: 'engaged' },
  { seat: 'lavori', label: 'Ministro dei Lavori', state: 'available' },
  { seat: 'istruzione', label: 'Ministro dell’Istruzione', state: 'available' },
  { seat: 'sanita', label: 'Ministro della Sanità', state: 'available' },
  { seat: 'esteri', label: 'Ministro degli Esteri', state: 'available' },
  { seat: 'interno', label: 'Ministro dell’Interno', state: 'engaged' },
  { seat: 'guerra', label: 'Ministro della Guerra', state: 'available' },
];

const followUp = {
  id: 'follow-up:p#1', pressureId: 'p#1', owner: 'guerra', dueDate: '1951-03-31', daysLeft: -1,
  label: 'Schieramento al confine', checks: [], outcome: ['Tensione sociale 48/100'],
  origin: { type: 'previous-decision', sourceId: 'p#1' }, situation,
};

test('home Governo: Consulente in cima, card compatte, roster dei 7, Esamina e Porta al Consiglio', async ({ page }) => {
  installMockApi(page);
  await page.route(`**/api/games/${MOCK_GAME_ID}/pressures`, route => route.fulfill({ json: {
    pressures: [{ id: situation.pressureId, kind: 'internal', template: 'harvest-failure', title: situation.title, detail: situation.briefing, severity: 3, source: situation.source, options: [], status: 'active', createdDate: '1951-03-01', createdTurn: 3, priority: 'critica', highlighted: true, situation }],
    recent: [], foodCoverageMonths: 0.8, followUps: [followUp],
    brief: { date: '1951-03-01', situations: [situation], followUps: [followUp], cabinet, recentDecisions: [] },
  } }));
  await reachHud(page);
  await openGovernment(page);

  // Header «Governo ✕» e Consulente in cima.
  await expect(page.locator('#government-office-title')).toHaveText('Governo');
  await expect(page.getByRole('button', { name: 'Chiudi il Governo', exact: true })).toBeVisible();
  await expect(page.getByText('IL PRIMO CONSULENTE', { exact: true })).toBeVisible();

  // Roster SEMPRE completo dei sette ministri, anche senza questioni.
  await expect(page.locator('.government-roster-seat')).toHaveCount(7);
  await expect(page.locator('.government-roster-seat[data-seat="lavori"]')).toBeVisible();

  // Card compatta con [Esamina] e [Porta al Consiglio]; gruppo rapporti.
  const card = page.locator('.gov-situation[data-nature="problem"]').first();
  await expect(card.getByRole('button', { name: 'Esamina', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Porta al Consiglio', exact: true })).toBeVisible();
  await expect(page.getByText('RAPPORTI DA LEGGERE', { exact: true })).toBeVisible();

  // Scorrendo in fondo, la ✕ resta visibile e cliccabile.
  await page.locator('.government-office').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const close = page.getByRole('button', { name: 'Chiudi il Governo', exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });

  // Esamina: il Consulente entra nel contesto di QUELLA situazione.
  await page.locator('.gov-situation[data-nature="problem"]').first().getByRole('button', { name: 'Esamina', exact: true }).click();
  await expect(page.locator('.advisor-focus')).toContainText('Scorte alimentari in esaurimento');

  // Porta al Consiglio: la seduta nasce dalla situazione, senza convocare nessuno.
  await page.locator('.gov-situation[data-nature="problem"]').first().getByRole('button', { name: 'Porta al Consiglio', exact: true }).click();
  const room = page.locator('.council-room');
  await expect(room).toBeVisible({ timeout: 10_000 });
  await expect(room.locator('.council-room-topic')).toHaveText('Scorte alimentari in esaurimento');
  await expect(room.locator('.council-room-chip')).toHaveCount(1);
});
