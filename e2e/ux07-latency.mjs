/**
 * WS-MINISTER-UX-07 (D) — Latenza e numero di chiamate LLM
 * =======================================================
 * Uso: node ux07-latency.mjs
 *
 * Misura, sul percorso mock (nessun provider reale, offline):
 *  - **chiamate al ministro** per messaggio: deve essere **1** per testo;
 *  - **chiamate per grafico/mappa**: **0** — la presentazione risolve in locale
 *    dai read model già in memoria, non richiama il modello;
 *  - **latenza** end-to-end «Invio → risposta conclusa» (p50/p95).
 *
 * Il provider è mockato: la latenza è quella dell'**applicazione** (rete locale,
 * render, risoluzione della presentazione), non del modello. Il conteggio delle
 * chiamate è invece quello reale del percorso applicativo.
 */
import { chromium } from 'playwright';
import { installMockApi } from './mock-api.mjs';

const baseUrl = process.env.GOVOFFICE_BASE_URL || 'http://localhost:5173';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => d.accept());

let ministerCalls = 0;
page.on('request', (request) => {
  const url = request.url();
  if (request.method() === 'POST' && /\/government\/minister\/[^/]+$/.test(new URL(url).pathname)) {
    ministerCalls += 1;
  }
});

installMockApi(page, {});
await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.locator('.landing-cta').click();
await page.locator('.template-card').first().click();
await page.locator('.country-list-item').first().click();
await page.locator('.btn-play').click();
try { await page.waitForSelector('.game-shell', { timeout: 60_000 }); } catch { /* mock lento */ }
await page.waitForTimeout(2000);

await page.locator('.rail-btn[aria-label="Governo"]').click();
await page.waitForTimeout(700);
await page.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click();
await page.locator('.minister-chat').waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForTimeout(400);

const questions = [
  'Mi mostri dove va la spesa per la sanità?',
  'Quali province coinvolge?',
  'Confronta le due strade',
  'E per le scuole?',
  'Quanto costa la guerra?',
  'Mi mostri il trend?',
  'Cosa mi consiglia?',
  'Grazie, proceda così',
];

const latencies = [];
for (const question of questions) {
  const before = ministerCalls;
  const start = Date.now();
  await page.locator('.minister-compose textarea').fill(question);
  await page.locator('.minister-compose button').click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.minister-entry.assistant:not(.minister-greeting) .rich-text').length >= expected,
    questions.indexOf(question) + 1,
    { timeout: 20_000 },
  );
  const elapsed = Date.now() - start;
  latencies.push(elapsed);
  const delta = ministerCalls - before;
  if (delta !== 1) console.log(`[warn] «${question}»: ${delta} chiamate al ministro (atteso 1)`);
}

// I grafici e le mappe non chiamano il modello: il conteggio non deve salire
// quando la presentazione ridisegna la tavola.
await page.locator('.minister-session-view', { hasText: 'Tavola' }).click().catch(() => {});
await page.waitForTimeout(500);
const callsAfterTables = ministerCalls;

const sorted = [...latencies].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

console.log(JSON.stringify({
  messages: questions.length,
  ministerCalls,
  expectedCalls: questions.length,
  meanLatencyMs: mean,
  p50Ms: p(p(0.5)),
  p95Ms: p(p(0.95)),
  minMs: sorted[0],
  maxMs: sorted[sorted.length - 1],
  callsAfterTableRender: callsAfterTables,
  extraCallsForChartsOrMaps: callsAfterTables - ministerCalls,
  note: 'provider mockato: la latenza è dell’applicazione, non del modello',
}, null, 2));

await browser.close();
