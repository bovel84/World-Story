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
import fs from 'node:fs';

const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

// Portabile come `playwright.config.mjs`: Chrome di sistema su macOS, Chromium
// incluso su Linux/CI quando CHROME_PATH non è impostato.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PATH = process.env.CHROME_PATH || (fs.existsSync(MAC_CHROME) ? MAC_CHROME : undefined);
const launchOptions = CHROME_PATH ? { executablePath: CHROME_PATH } : {};

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
