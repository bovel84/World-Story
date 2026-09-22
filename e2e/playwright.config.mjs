/**
 * World Story — Playwright config per gli E2E mock (Q01 µ1)
 * ========================================================
 *
 * Esegue i test in `e2e/tests/` contro il dev server del frontend. Le API
 * `/api/**` sono MOCKATE nel browser (vedi mock-api.mjs): nessun backend
 * reale, nessun provider LLM, nessuna rete esterna. Il webServer avvia solo
 * il dev server Vite del frontend.
 *
 * Esecuzione offline/sicura:
 *   - nessun browser apre il sito pubblico (solo localhost:5173);
 *   - la rete esterna è bloccata da `installMockApi` (route glob → abort);
 *   - nessun credito LLM consumato (nessuna chiamata a provider reali).
 */

import { defineConfig, devices } from 'playwright/test';
import fs from 'node:fs';

const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

// Portabile: su macOS si può usare il Chrome di sistema (i binari Playwright
// richiedono macOS 12+); su Linux/CI, senza CHROME_PATH, si usa il Chromium
// incluso in Playwright. Nessun override forzato quando il path non esiste.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PATH = process.env.CHROME_PATH || (fs.existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
const launchOptions = CHROME_PATH ? { executablePath: CHROME_PATH } : {};

export default defineConfig({
  testDir: './tests',
  // Le spec a backend reale (MAP P6.3) girano solo con `playwright.real.config.mjs`:
  // qui non c'è alcun backend e non deve esserci alcun mock implicito.
  testIgnore: '**/*.real.spec.mjs',
  // Un solo worker: i mock sono per-processo e il dev server è condiviso.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // macOS 11: i binari Playwright richiedono macOS 12+. Usiamo il Chrome di
    // sistema quando disponibile (vedi CHROME_PATH sopra), altrimenti il
    // Chromium incluso (CI/Linux).
    launchOptions,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '../frontend',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
