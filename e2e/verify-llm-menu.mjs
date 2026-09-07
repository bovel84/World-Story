/** Smoke test UI del menu «Modello IA»: apertura, preset, carico modelli. */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = process.env.OPEN_PAX_URL || 'http://localhost:5173';
const shotDir = path.resolve(process.cwd(), '..', 'docs', 'e2e');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.locator('.landing-cta').waitFor({ timeout: 15_000 });

  // 1. Apertura da Landing
  await page.getByRole('button', { name: /Modello IA/ }).click();
  const modal = page.locator('.llm-modal');
  await modal.waitFor({ timeout: 10_000 });
  const chips = await page.locator('.llm-provider-chip').count();
  if (chips < 6) throw new Error(`Provider chips insufficienti: ${chips}`);
  await page.screenshot({ path: path.join(shotDir, '18-llm-settings.png') });

  // 2. Selezione preset Ollama Cloud + carico modelli (usa la chiave salvata)
  await page.locator('.llm-provider-chip', { hasText: 'Ollama Cloud' }).click();
  await page.getByRole('button', { name: /Carica modelli/ }).click();
  await page.locator('.llm-model-select').waitFor({ timeout: 45_000 });
  const optionCount = await page.locator('#llm-model-options option').count();
  if (optionCount < 3) throw new Error(`Modelli caricati: ${optionCount}`);
  const active = await page.locator('.llm-current').innerText();
  if (!/gpt-oss:20b/.test(active)) throw new Error(`Stato attivo inatteso: ${active}`);
  await page.screenshot({ path: path.join(shotDir, '19-llm-models.png') });

  // 3. Chiusura con Annulla (nessuna modifica)
  await page.getByRole('button', { name: 'Annulla' }).click();
  await modal.waitFor({ state: 'detached', timeout: 5_000 });

  console.log(JSON.stringify({ ok: true, providers: chips, models: optionCount, active: active.trim() }));
} finally {
  await browser.close();
}