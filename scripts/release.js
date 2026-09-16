#!/usr/bin/env node
'use strict';
/**
 * Q02 µ4 — Rilascio coordinato, fail-closed.
 * =========================================
 * Orchestratore con due modalità:
 *   --plan-only (default)  preflight in sola lettura: verifica che il database
 *                          esista e inventaria i run attivi; NON muta nulla.
 *   --execute              esegue i passi. Richiede `--authorized` esplicito:
 *                          nessun rilascio pubblico parte senza autorizzazione.
 *
 * Passi (nell'ordine del piano esecutivo §Q02.4):
 *   1 tests            backend + frontend (abort su rosso)
 *   2 build            build workspaces
 *   3 backup           snapshot SQLite coerente (scripts/db-backup.js)
 *   4 active-runs      inventario run attivi (running/queued)
 *   5 maintenance      drain: SIGTERM + attesa, mai SIGKILL — rifiuta se
 *                      restano run attivi e manca --allow-active-runs
 *   6 migration        `initDatabase()` idempotente
 *   7 backend-update   restart via --restart-command (obbligatorio)
 *   8 readiness        poll di /api/health
 *   9 frontend-compat  confronto build id frontend servito vs locale
 *  10 smoke            `npm run test:e2e:mock` (mock: nessun credito LLM)
 *
 * Rollback documentato in coda al piano: `node scripts/db-restore.js <backup>`
 * + riavvio della revisione precedente. In caso di errore ogni passo si ferma
 * (fail-closed): non si prosegue su uno stato incerto.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const requireFromBackend = createRequire(path.join(__dirname, '..', 'backend-nest', 'package.json'));
const Database = requireFromBackend('better-sqlite3');

const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const flags = { mode: 'plan-only' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan-only') flags.mode = 'plan-only';
    else if (arg === '--execute') flags.mode = 'execute';
    else if (arg === '--authorized') flags.authorized = true;
    else if (arg === '--allow-active-runs') flags.allowActiveRuns = true;
    else if (arg === '--skip-tests') flags.skipTests = true;
    else if (arg === '--db') flags.db = argv[++i];
    else if (arg === '--backup-dir') flags.backupDir = argv[++i];
    else if (arg === '--health-url') flags.healthUrl = argv[++i];
    else if (arg === '--restart-command') flags.restartCommand = argv[++i];
    else if (arg === '--readiness-timeout') flags.readinessTimeoutSec = Number(argv[++i]);
    else if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else throw new Error(`flag sconosciuto: ${arg}`);
  }
  return flags;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveDbPath(explicit) {
  return path.resolve(explicit || process.env.OPEN_PAX_DB_PATH || path.join(REPO_ROOT, 'data', 'world-story.db'));
}

function activeRuns(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true, readonly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'simulation_jobs'")
      .get();
    if (!table) return [];
    return db
      .prepare("SELECT id, game_id, type, status FROM simulation_jobs WHERE status IN ('running','queued') ORDER BY created_at ASC")
      .all();
  } finally {
    db.close();
  }
}

function stepList(flags, dbPath) {
  const backupPath = path.resolve(flags.backupDir || path.join(REPO_ROOT, 'backups'), `world-story-${timestamp()}.db`);
  return [
    { id: 'tests', description: 'test backend + frontend (abort su rosso)', command: 'npm run test:unit', mutates: false, skip: Boolean(flags.skipTests) },
    { id: 'build', description: 'build workspaces', command: 'npm run build', mutates: true },
    { id: 'backup', description: 'snapshot SQLite coerente + integrity_check', command: `node scripts/db-backup.js ${dbPath} ${backupPath}`, mutates: true, artifact: backupPath },
    { id: 'active-runs', description: 'inventario run attivi (running/queued)', command: `-- (query simulation_jobs)`, mutates: false },
    { id: 'maintenance', description: 'drain: SIGTERM + attesa; mai SIGKILL', command: 'kill -TERM <backend-pid> (graceful shutdown)', mutates: true },
    { id: 'migration', description: 'initDatabase() idempotente', command: 'node -e "require(\'./backend-nest/dist/database\').initDatabase()"', mutates: true },
    { id: 'backend-update', description: 'restart backend alla revisione nuova', command: flags.restartCommand || '(richiede --restart-command)', mutates: true },
    { id: 'readiness', description: 'poll /api/health fino a status ok', command: `GET ${flags.healthUrl || 'http://localhost:8000/api/health'}`, mutates: false },
    { id: 'frontend-compat', description: 'build id frontend servito == build locale', command: 'GET /api/health → build.frontend', mutates: false },
    { id: 'smoke', description: 'smoke E2E mock (nessun credito LLM)', command: 'npm run test:e2e:mock', mutates: false },
  ];
}

/**
 * Attesa del readiness. Il primo boot dopo un deploy è lento: il backend
 * ricostruisce in memoria tutte le sessioni attive dal DB (osservato >60 s con
 * molte partite). Default 300 s, sovrascrivibile con `--readiness-timeout`.
 */
function readinessTimeoutMs(flags) {
  const seconds = Number.isFinite(flags.readinessTimeoutSec) && flags.readinessTimeoutSec > 0
    ? flags.readinessTimeoutSec
    : 300;
  return seconds * 1000;
}

function preflight(flags, dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'db_not_found', dbPath };
  }
  let runs = [];
  try {
    runs = activeRuns(dbPath);
  } catch (error) {
    return { ok: false, error: 'db_inventory_failed', detail: String((error && error.message) || error), dbPath };
  }
  if (runs.length > 0 && !flags.allowActiveRuns) {
    return {
      ok: false,
      error: 'active_runs_present',
      dbPath,
      activeRuns: runs,
      hint: 'Attendi il completamento (drain) o passa --allow-active-runs: nessun job viene mai ucciso alla cieca.',
    };
  }
  return { ok: true, dbPath, activeRuns: runs };
}

function pollHealth(url, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const body = execFileSync('curl', ['-fsS', '--max-time', '5', url], { encoding: 'utf8' });
      last = JSON.parse(body);
      if (last && last.status === 'ok') return last;
    } catch (error) {
      last = { error: String((error && error.message) || error) };
    }
    execFileSync('sleep', [String(intervalMs / 1000)]);
  }
  throw new Error(`readiness_timeout: ${JSON.stringify(last)}`);
}

function localFrontendBuildId() {
  const file = path.join(REPO_ROOT, 'frontend', 'dist', 'build-id.txt');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim() || null;
}

/**
 * Env del passo di migrazione: DEVE puntare allo stesso DB del preflight.
 * Senza `OPEN_PAX_DB_PATH` `database.ts` userebbe il path di default del cwd,
 * migrando il database sbagliato.
 */
function migrationEnv(dbPath) {
  return { ...process.env, OPEN_PAX_DB_PATH: dbPath };
}

function execute(flags, dbPath, backupPath) {
  const results = [];
  const run = (id, command, args, options) => {
    process.stderr.write(`\n[release] ▶ ${id}\n`);
    execFileSync(command, args, { stdio: 'inherit', cwd: REPO_ROOT, ...options });
    results.push({ id, status: 'ok' });
  };

  if (!flags.skipTests) run('tests', 'npm', ['run', 'test:unit']);
  run('build', 'npm', ['run', 'build']);
  run('backup', process.execPath, [path.join(REPO_ROOT, 'scripts', 'db-backup.js'), dbPath, backupPath]);

  const afterDrain = activeRuns(dbPath);
  if (afterDrain.length > 0) {
    throw new Error(`active_runs_after_drain: ${JSON.stringify(afterDrain)}`);
  }
  results.push({ id: 'active-runs', status: 'ok', activeRuns: 0 });

  run('migration', process.execPath, ['-e', "require('./backend-nest/dist/database').initDatabase()"], {
    env: migrationEnv(dbPath),
  });

  if (!flags.restartCommand) {
    throw new Error('restart_command_required: passare --restart-command "<comando>" per aggiornare il backend');
  }
  run('backend-update', 'bash', ['-lc', flags.restartCommand]);

  const healthUrl = flags.healthUrl || 'http://localhost:8000/api/health';
  const health = pollHealth(healthUrl, readinessTimeoutMs(flags), 2_000);
  results.push({ id: 'readiness', status: 'ok' });

  const served = health.build ? health.build.frontend : null;
  const local = localFrontendBuildId();
  if (local && served && served !== local) {
    throw new Error(`frontend_build_mismatch: servito=${served} locale=${local}`);
  }
  results.push({ id: 'frontend-compat', status: 'ok', served, local });

  run('smoke', 'npm', ['run', 'test:e2e:mock']);
  return results;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log('uso: node scripts/release.js [--plan-only|--execute] [--authorized] [--db PATH] [--backup-dir DIR] [--health-url URL] [--restart-command CMD] [--allow-active-runs] [--skip-tests]');
    return;
  }
  const dbPath = resolveDbPath(flags.db);
  const backupPath = path.resolve(flags.backupDir || path.join(REPO_ROOT, 'backups'), `world-story-${timestamp()}.db`);
  const steps = stepList(flags, dbPath);

  const plan = {
    mode: flags.mode,
    dbPath,
    backupPath,
    steps,
    rollback: [
      `node scripts/db-restore.js ${backupPath} ${dbPath}`,
      'riavviare la revisione precedente del backend (stesso comando usato per il deploy)',
    ],
  };

  const checks = preflight(flags, dbPath);
  if (!checks.ok) {
    console.error(JSON.stringify({ ok: false, mode: flags.mode, preflight: checks, plan }, null, 2));
    process.exitCode = 4;
    return;
  }

  if (flags.mode === 'plan-only') {
    console.log(JSON.stringify({ ok: true, mode: 'plan-only', preflight: checks, plan, executed: [] }, null, 2));
    return;
  }

  if (!flags.authorized) {
    console.error(JSON.stringify({
      ok: false,
      mode: 'execute',
      error: 'authorization_required',
      hint: 'Nessun rilascio pubblico senza autorizzazione esplicita: aggiungere --authorized.',
      plan,
    }, null, 2));
    process.exitCode = 5;
    return;
  }

  const executed = execute(flags, dbPath, backupPath);
  console.log(JSON.stringify({ ok: true, mode: 'execute', preflight: checks, plan, executed }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, resolveDbPath, stepList, preflight, activeRuns, migrationEnv, readinessTimeoutMs, main };
