/**
 * WS-MINISTER-UX-08 (6) — La conversazione completa col provider REALE
 * ===================================================================
 * Percorso verificato dall'inizio alla fine, contro il backend reale su
 * `localhost:8000` (LLM di produzione da `llm.config.json`, non lo stub):
 *
 *   obiettivo → chiarimento → grafico → territorio → alternative →
 *   proposta modificata → decisione → riapertura con memoria
 *
 * A ogni passo misura se l'evidenza **richiesta** sta davvero nella parte
 * **visibile** della tavola (`.seat-table-main`) e se l'atto del Tesoro non la
 * precede (difetto 1). Salva screenshot e un log JSON.
 *
 * Uso: node ux08-real-provider.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const OUT = process.env.OUT_DIR
  || path.resolve(process.cwd(), '..', 'docs', 'implementation', 'assets', 'ws-minister-ux-08', 'real');
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const log = [];
const record = (step, info) => {
  const entry = { step, ...info };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(info));
};

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log(`[pageerror] ${String(e).slice(0, 240)}`));
page.on('dialog', d => d.accept());

async function boot() {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const play = page.locator('.landing-save-play, button:has-text("Gioca")').first();
  if (await play.count()) {
    await play.click({ timeout: 15000 }).catch(() => {});
  } else {
    await page.locator('.landing-cta').click({ timeout: 15000 }).catch(() => {});
  }
  await page.waitForSelector('.game-shell', { timeout: 180000 });
  await page.waitForTimeout(4000);
}

async function openTesoro() {
  await page.locator('.rail-btn[aria-label="Governo"]').click({ timeout: 20000 });
  await page.waitForSelector('.government-office', { timeout: 30000 });
  await page.locator('.cabinet-pick', { hasText: 'Ministro del Tesoro' }).click({ timeout: 20000 });
  await page.waitForSelector('.minister-chat', { timeout: 30000 });
}

async function tableState() {
  return page.evaluate(() => {
    const mainKind = document.querySelector('.seat-table-main [data-kind]')?.getAttribute('data-kind') ?? null;
    const banner = document.querySelector('.seat-presentation-banner')?.textContent?.trim() ?? null;
    const mainBox = document.querySelector('.seat-table-main')?.getBoundingClientRect() ?? null;
    const actBox = document.querySelector('.treasury-act')?.getBoundingClientRect() ?? null;
    const draft = document.querySelector('.act-draft-text')?.value ?? null;
    const memory = document.querySelector('.seat-brief-memory')?.textContent?.trim() ?? null;
    const replies = document.querySelectorAll('.government-office-pane-chat .minister-entry.assistant:not(.minister-greeting)');
    const lastReply = replies.length ? (replies[replies.length - 1].textContent || '').slice(0, 400) : null;
    return {
      mainKind,
      banner,
      comparison: Boolean(document.querySelector('.proposal-comparison')),
      actBeforeMain: Boolean(actBox && mainBox && actBox.top < mainBox.top - 4),
      draftFirstLine: draft ? draft.split('\n')[0] : null,
      memory: memory ? memory.slice(0, 200) : null,
      lastReply,
    };
  });
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function send(text) {
  const chat = page.locator('.government-office-pane-chat');
  const before = await chat.locator('.minister-entry.assistant:not(.minister-greeting)').count();
  await chat.locator('textarea').fill(text);
  await chat.locator('.minister-compose button').click();
  await page.waitForFunction(
    n => document.querySelectorAll('.government-office-pane-chat .minister-entry.assistant:not(.minister-greeting)').length > n,
    before,
    { timeout: 240000 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.government-office-pane-chat .stream-cursor'),
    null,
    { timeout: 240000 },
  );
  await page.waitForTimeout(1200);
}

function matches(target, state) {
  if (target === 'compare') return state.comparison;
  return state.mainKind === target;
}

/** Chiede l'evidenza e, se il modello non la mostra, la richiede in modo più
 *  esplicito (fino a 3 tentativi): il provider reale non è deterministico. */
async function ensureEvidence(target, prompts, label) {
  let state = await tableState();
  for (const prompt of prompts) {
    if (matches(target, state)) break;
    await send(prompt);
    state = await tableState();
  }
  await shot(label);
  record(label, state);
  return state;
}

try {
  await boot();

  // ── [0] Obiettivo del Presidente ────────────────────────────────────────
  await openTesoro();
  await send('Presidente: l’obiettivo di questo mandato è rimettere in ordine i conti e rilanciare le opere. Che cosa proponi per il Tesoro?');
  await shot('01-obiettivo');
  record('obiettivo', await tableState());

  // ── [1] Chiarimento ─────────────────────────────────────────────────────
  await send('Chiariscimi una cosa: il margine di cassa basta per un intervento quest’anno, o serve altro?');
  await shot('02-chiarimento');
  record('chiarimento', await tableState());

  // ── [2] Grafico richiesto ───────────────────────────────────────────────
  await ensureEvidence('chart', [
    'Mi mostri dove va la spesa?',
    'Voglio proprio il grafico di bilancio sulla tavola: usa il blocco tavola con {"op":"focus","evidence":"spesa"}.',
    'Mostra il grafico della spesa, non le cifre.',
  ], '03-grafico-richiesto');

  // ── [3] Territorio richiesto ────────────────────────────────────────────
  await ensureEvidence('map', [
    'E quali regioni del paese coinvolge questo investimento? Mostrami la mappa.',
    'Voglio la mappa delle zone del paese: blocco tavola con {"op":"focus","evidence":"mappa"}.',
    'Mostra la mappa, non il grafico.',
  ], '04-mappa-richiesta');

  // ── [4] Alternative (confronto) ─────────────────────────────────────────
  await ensureEvidence('compare', [
    'Confronta le due strade.',
    'Voglio il confronto tra le due proposte: blocco tavola con {"op":"compare"}.',
    'Metti le due strade fianco a fianco nella tavola.',
  ], '05-alternative');

  // ── [5] Proposta modificata ─────────────────────────────────────────────
  const prepare = page.locator('.government-office-pane-table .treasury-act-prepare').first();
  if (await prepare.count()) {
    await prepare.click({ timeout: 10000 });
    const textarea = page.locator('.government-office-pane-table .act-draft-text');
    await textarea.waitFor({ timeout: 10000 });
    const original = await textarea.inputValue();
    await textarea.fill(`${original}\nNota del Presidente: scaglionare in due trimestri e verificare la cassa prima di firmare.`);
    await page.waitForTimeout(400);
  }
  await shot('06-proposta-modificata');
  record('proposta-modificata', await tableState());

  // ── [6] Decisione (firma) ───────────────────────────────────────────────
  const sign = page.locator('.government-office-pane-table .act-draft-sign');
  if (await sign.count()) {
    await sign.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
  }
  await shot('07-decisione');
  record('decisione', await tableState());

  // ── [7] Riapertura con memoria (con ricarica del browser) ───────────────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const play = page.locator('.landing-save-play, button:has-text("Gioca")').first();
  if (await play.count()) await play.click({ timeout: 15000 }).catch(() => {});
  await page.waitForSelector('.game-shell', { timeout: 120000 });
  await page.waitForTimeout(3000);
  await openTesoro();
  const brief = page.locator('.seat-brief');
  await brief.locator('.seat-brief-summary').click().catch(() => {});
  await page.waitForTimeout(500);
  await shot('08-riapertura-memoria');
  record('riapertura-memoria', await tableState());
} catch (e) {
  record('errore', { message: String(e).slice(0, 400) });
} finally {
  fs.writeFileSync(path.join(OUT, 'real-provider-log.json'), JSON.stringify(log, null, 2));
  await browser.close();
}

console.log(`\nScreenshot e log in ${OUT}`);
