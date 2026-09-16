#!/usr/bin/env node
'use strict';
/**
 * Q02 µ4 — Backup SQLite coerente (fail-closed).
 * =============================================
 * Usa l'API di backup online di SQLite (better-sqlite3 `backup()`), quindi la
 * copia è consistente anche con il backend attivo (nessun `cp` a caldo).
 * Verifica `PRAGMA integrity_check` sul backup: se non è `ok` il backup viene
 * rimosso e il processo esce con codice non-zero.
 *
 * Uso:  node scripts/db-backup.js [dbPath] [outPath]
 * Env:  OPEN_PAX_DB_PATH (fallback del dbPath)
 * Exit: 0 ok · 2 db mancante · 3 integrità non valida · 1 errore inatteso
 * Stampa una riga JSON su stdout.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromBackend = createRequire(path.join(__dirname, '..', 'backend-nest', 'package.json'));
const Database = requireFromBackend('better-sqlite3');

function defaultDbPath() {
  return process.env.OPEN_PAX_DB_PATH || path.join(process.cwd(), 'data', 'world-story.db');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function integrityCheck(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    return String(db.pragma('integrity_check', { simple: true }));
  } finally {
    db.close();
  }
}

async function main() {
  const [dbArg, outArg] = process.argv.slice(2);
  const source = path.resolve(dbArg || defaultDbPath());
  if (!fs.existsSync(source)) {
    console.error(JSON.stringify({ ok: false, error: 'db_not_found', source }));
    process.exitCode = 2;
    return;
  }
  const out = path.resolve(outArg || path.join('backups', `world-story-${timestamp()}.db`));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const db = new Database(source, { fileMustExist: true });
  try {
    await db.backup(out);
  } finally {
    db.close();
  }

  const integrity = integrityCheck(out);
  if (integrity !== 'ok') {
    fs.rmSync(out, { force: true });
    console.error(JSON.stringify({ ok: false, error: 'integrity_check_failed', detail: integrity, source }));
    process.exitCode = 3;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    source,
    backup: out,
    bytes: fs.statSync(out).size,
    integrity,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
  process.exitCode = 1;
});
