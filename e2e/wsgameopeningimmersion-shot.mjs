/**
 * WS-GAME-OPENING-IMMERSION — Screenshot immersivi (fixture ricca).
 * =================================================================
 * Uso: node wsgameopeningimmersion-shot.mjs [cartella-out]
 * Richiede il dev server Vite su http://localhost:5173.
 *
 * Fixture credibile (non «Mondo di prova»): Millennium Dawn 2000, un paese con
 * ricostruzione e cassa ristretta, due relazioni, tre ministri. Gli override
 * sono registrati DOPO `installMockApi`, che in Playwright vince per ultimo.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installMockApi, MOCK_GAME, MOCK_GAME_ID, MOCK_CABINET_MULTI } from './mock-api.mjs';

const outDir = process.argv[2] || 'docs/implementation/screenshots/ws-game-opening-immersion';
mkdirSync(outDir, { recursive: true });
const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API = '/api';

const RICH_WORLD = {
  ...MOCK_GAME.world,
  name: 'Millennium Dawn — 2000',
  description: 'Il mondo dopo la fine della Guerra Fredda.',
  startDate: '2000-01-01',
  basePrompt: [
    'Il 1° gennaio 2000. La Guerra Fredda è finita da un decennio, ma il nuovo ordine internazionale non è ancora assestato.',
    'Gli Stati Uniti restano la potenza dominante; la Russia cerca un nuovo equilibrio; la Cina cresce rapidamente; l’Europa prepara l’allargamento verso est.',
    'Per un paese che esce da una guerra recente, la ricostruzione e la posizione internazionale sono la stessa scelta.',
  ].join(' '),
};
const RICH_GAME = { ...MOCK_GAME, world: RICH_WORLD, currentDate: '2000-01-01' };

const RICH_OPENING = {
  generated: false,
  deterministic: true,
  world: {
    name: RICH_WORLD.name,
    date: '2000-01-01',
    narrative: {
      headline: '1 gennaio 2000',
      worldOrder: 'La Guerra Fredda è finita, ma il nuovo ordine internazionale è ancora instabile. Gli Stati Uniti dominano il sistema, la Russia cerca un nuovo equilibrio, la Cina cresce e l’Europa guarda a est.',
      regionalSituation: 'Nella regione, la ricostruzione dopo il conflitto non è terminata e i rapporti con i vicini restano il vero vincolo delle scelte interne.',
      stakesForNation: 'Per il tuo paese, le scelte interne saranno inseparabili dalla posizione che saprà costruirsi in questo ordine.',
    },
  },
  nation: { framing: 'La pace tiene, ma lo Stato resta fragile. La ricostruzione non è terminata e le finanze consentono di agire, ma non su tutto insieme.' },
  council: [
    { seat: 'lavori', label: 'Ministro dei Lavori', line: 'Presidente, la ricostruzione ci impone di scegliere da dove partire.' },
    { seat: 'tesoro', label: 'Ministro del Tesoro', line: 'Possiamo muoverci, ma non possiamo aprire ogni fronte insieme.' },
    { seat: 'esteri', label: 'Ministro degli Esteri', line: 'Ogni scelta interna avrà conseguenze anche nella regione.' },
  ],
};

const browser = await chromium.launch({ headless: true, executablePath });

async function reachOpening(page, width, height) {
  await page.setViewportSize({ width, height });
  page.on('dialog', d => d.accept());
  installMockApi(page, { showOpening: true, cabinet: MOCK_CABINET_MULTI });
  // Override (ultimi registrati → vincono): mondo ricco, narrativa ricca, relazioni reali.
  await page.route(`${API}/games/${MOCK_GAME_ID}`, route => route.fulfill({ json: RICH_GAME }));
  await page.route(`${API}/games/${MOCK_GAME_ID}/opening-narrative`, route => route.fulfill({ json: RICH_OPENING }));
  await page.route(`${API}/games/${MOCK_GAME_ID}/relationships`, route => route.fulfill({ json: {
    relationships: { ALPHA: { BETA: 'hostile', GAMMA: 'neutral' } },
    names: { BETA: 'Serbia', GAMMA: 'Croazia' },
  } }));
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.landing-cta').click();
  await page.locator('.template-card').first().click();
  await page.locator('.country-list-item').first().click();
  await page.locator('.btn-play').click();
  await page.locator('.opening-overlay').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(600);
}

const shot = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`[shot] ${name}`);
};

const NAMES = ['world', 'nation', 'situation', 'council'];
for (const vp of [{ width: 1366, height: 768, tag: 'desktop' }, { width: 390, height: 844, tag: 'mobile' }]) {
  const page = await browser.newPage();
  await reachOpening(page, vp.width, vp.height);
  for (let i = 0; i < NAMES.length; i += 1) {
    await shot(page, `${vp.tag}-${i + 1}-${NAMES[i]}-immersive`);
    if (i < NAMES.length - 1) await page.locator('.opening-next').click();
  }
  await page.close();
}

await browser.close();
console.log(`[done] ${outDir}`);
