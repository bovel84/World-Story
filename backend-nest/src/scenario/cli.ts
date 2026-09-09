/**
 * World Story — M01 µ1: `validate:scenario`
 * ======================================
 * Uso: npm run validate:scenario [presetDir ...]
 * Senza argomenti valida tutti i preset in data/presets/.
 *
 * Rapporto JSON su stdout + sintesi umana su stderr; exit 1 se esistono
 * errori bloccanti. I preset legacy senza `simulation/` sono dichiarati
 * tali (warning), mai migrati silenziosamente.
 */
import fs from 'fs';
import path from 'path';
import { loadSimulationCatalog } from './loader';

const PRESETS_DIR = path.join(process.cwd(), 'data', 'presets');

function main(): number {
  const args = process.argv.slice(2);
  const presetDirs = args.length > 0
    ? args.map(dir => path.resolve(dir))
    : fs.readdirSync(PRESETS_DIR)
        .filter(entry => fs.statSync(path.join(PRESETS_DIR, entry)).isDirectory())
        .map(entry => path.join(PRESETS_DIR, entry));

  const reports = presetDirs.map(dir => loadSimulationCatalog(dir).report);
  const blocking = reports.reduce((sum, r) => sum + r.errors.length, 0);
  const warnings = reports.reduce((sum, r) => sum + r.warnings.length, 0);

  process.stdout.write(JSON.stringify({ ok: blocking === 0, blocking, warnings, reports }, null, 2) + '\n');
  for (const report of reports) {
    const status = report.errors.length > 0 ? 'BLOCCANTE' : 'ok';
    process.stderr.write(`[${status}] ${report.presetId}: ${report.errors.length} errori, ${report.warnings.length} avvisi\n`);
    for (const e of report.errors) process.stderr.write(`  ✗ ${e.path} [${e.code}] ${e.message}\n`);
    for (const w of report.warnings) process.stderr.write(`  ⚠ ${w.path} [${w.code}] ${w.message}\n`);
  }
  return blocking === 0 ? 0 : 1;
}

process.exit(main());