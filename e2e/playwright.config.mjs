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

const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './tests',
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
    // sistema (stesso approccio degli script legacy e2e/*.mjs).
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
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
