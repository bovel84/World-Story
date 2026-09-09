/**
 * World Story — Baseline performance bundle (Q01 µ3)
 * ================================================
 *
 * Misura la dimensione del bundle di produzione del frontend (JS + CSS) e
 * fallisce con exit nonzero se supera la soglia. È una baseline: il chunk
 * splitting e l'audit prestazioni del profilo del maestro arrivano nelle µ
 * successive (Q01 passo 5).
 *
 * Esecuzione offline/sicura: legge solo `frontend/dist/`, nessun browser,
 * nessuna rete, nessun credito LLM.
 *
 * Uso: node e2e/perf/baseline.mjs
 */

import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'frontend', 'dist', 'assets');

// Soglia di baseline (byte). Il bundle attuale è ~1.38MB JS + ~0.45MB CSS.
// La soglia lascia margine per le µ successive ma blocca regressioni grosse.
const JS_LIMIT = 2_000_000; // 2 MB
const CSS_LIMIT = 1_000_000; // 1 MB

let jsTotal = 0;
let cssTotal = 0;
let files = [];

try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
} catch (e) {
  console.error(`[perf] Impossibile leggere ${DIST}: ${e.message}`);
  console.error('[perf] Esegui prima `npm --prefix frontend run build`.');
  process.exit(1);
}

for (const f of files) {
  const size = statSync(join(DIST, f)).size;
  if (f.endsWith('.js')) jsTotal += size;
  else cssTotal += size;
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`[perf] Bundle di produzione (${files.length} file):`);
console.log(`[perf]   JS  ${mb(jsTotal)} MB (${jsTotal} byte)`);
console.log(`[perf]   CSS ${mb(cssTotal)} MB (${cssTotal} byte)`);
console.log(`[perf]   TOT ${mb(jsTotal + cssTotal)} MB`);

let failed = false;
if (jsTotal > JS_LIMIT) {
  console.error(`[perf] FAIL: JS ${mb(jsTotal)} MB supera la soglia ${mb(JS_LIMIT)} MB`);
  failed = true;
}
if (cssTotal > CSS_LIMIT) {
  console.error(`[perf] FAIL: CSS ${mb(cssTotal)} MB supera la soglia ${mb(CSS_LIMIT)} MB`);
  failed = true;
}

if (failed) {
  console.error('[perf] Regressione di dimensione bundle. Intervieni prima di procedere.');
  process.exit(1);
}

console.log('[perf] OK: bundle entro la baseline.');
