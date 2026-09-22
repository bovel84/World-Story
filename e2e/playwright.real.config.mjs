/**
 * World Story — MAP P6.3: Playwright contro il **backend reale**
 * ============================================================
 * A differenza della suite mock (`playwright.config.mjs`), qui non c'è alcun
 * `installMockApi`: il browser parla con il backend Express reale che serve
 * anche la build React (`frontend/dist`). L'unica finzione è il provider LLM
 * (`real-backend/llm-stub.mjs`): preset, geografia, SQLite, sessioni, endpoint
 * e read model sono quelli di produzione.
 *
 * Avvio (da `e2e/`):
 *   node_modules/.bin/playwright test --config=playwright.real.config.mjs
 * Prerequisiti: `npm run build` (backend `dist/` + frontend `dist/`).
 * Suite volutamente separata: non fa parte di `test:e2e:mock`.
 */
import { defineConfig, devices } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const E2E_DIR = process.cwd();
const ROOT = path.resolve(E2E_DIR, '..');
const TMP_DIR = path.join(E2E_DIR, '.tmp');
const DB_PATH = path.join(TMP_DIR, 'map-p6-real-e2e.db');
const LLM_CONFIG = path.join(E2E_DIR, 'real-backend', 'llm.stub.json');
const BACKEND_PORT = Number(process.env.REAL_E2E_PORT || 8100);
const LLM_STUB_PORT = Number(process.env.LLM_STUB_PORT || 8791);

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PATH = process.env.CHROME_PATH || (fs.existsSync(MAC_CHROME) ? MAC_CHROME : undefined);

// Il DB fresco si cancella **nel comando** che avvia il backend: è l'unico
// punto che gira prima che il file venga aperto. Un `globalSetup` lo
// cancellerebbe *dopo* l'avvio del server (Playwright avvia i webServer prima),
// staccando il file sotto l'handle SQLite (`SQLITE_READONLY_DBMOVED`).

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.real.spec.mjs',
  fullyParallel: false,
  workers: 1,
  // La creazione del mondo provinciale completo (946 province) avviene davvero,
  // nel browser, dentro questo test: il tetto è alto di proposito.
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${BACKEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: CHROME_PATH ? { executablePath: CHROME_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `sh -c 'node real-backend/llm-stub.mjs > "${TMP_DIR}/llm-stub.log" 2>&1'`,
      cwd: E2E_DIR,
      url: `http://127.0.0.1:${LLM_STUB_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { LLM_STUB_PORT: String(LLM_STUB_PORT) },
    },
    {
      // Log su file: senza di essi un fallimento del server è invisibile.
      command: `sh -c 'rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm" && node dist/index.js > "${TMP_DIR}/backend.log" 2>&1'`,
      cwd: path.join(ROOT, 'backend-nest'),
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(BACKEND_PORT),
        OPEN_PAX_DB_PATH: DB_PATH,
        LLM_CONFIG_PATH: LLM_CONFIG,
      },
    },
  ],
});
