/**
 * World Story — Playwright config per l'audit accessibilità (Q01 µ3)
 * ================================================================
 *
 * Esegue i test in `e2e/a11y/` contro il dev server del frontend con le API
 * mockate nel browser (nessun backend reale, nessun provider LLM, nessuna rete
 * esterna). Separato dalla suite E2E mock perché l'audit a11y è un gate
 * distinto (`test:a11y`).
 */

import { defineConfig, devices } from 'playwright/test';

const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './a11y',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
