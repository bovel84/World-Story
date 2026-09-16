#!/usr/bin/env node
'use strict';
/**
 * Q02 µ4 — Ripristino da backup SQLite (fail-closed, per il rollback).
 * ==================================================================
 * 1. verifica `PRAGMA integrity_check` sul backup: se non è `ok` non tocca nulla;
 * 2. mette da parte il database corrente (`<db>.pre-restore-<timestamp>`) —
 *    nessun dato reale viene distrutto senza una copia;
 * 3. copia il backup sul database e rimuove i file WAL/SHM residui.
 *
 * Uso:  node scripts/db-restore.js <backupPath> [dbPath]
 * Exit: 0 ok · 2 argomenti/backup mancante · 3 integrità non valida · 1 errore
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

function main() {
  const [backupArg, dbArg] = process.argv.slice(2);
  if (!backupArg) {
    console.error(JSON.stringify({ ok: false, error: 'usage', hint: 'node scripts/db-restore.js <backupPath> [dbPath]' }));
    process.exitCode = 2;
    return;
  }
  const backup = path.resolve(backupArg);
  if (!fs.existsSync(backup)) {
    console.error(JSON.stringify({ ok: false, error: 'backup_not_found', backup }));
    process.exitCode = 2;
    return;
  }
  const integrity = integrityCheck(backup);
  if (integrity !== 'ok') {
    console.error(JSON.stringify({ ok: false, error: 'integrity_check_failed', detail: integrity, backup }));
    process.exitCode = 3;
    return;
  }

  const target = path.resolve(dbArg || defaultDbPath());
  let safetyCopy = null;
  if (fs.existsSync(target)) {
    safetyCopy = `${target}.pre-restore-${timestamp()}`;
    fs.copyFileSync(target, safetyCopy);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(backup, target);
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${target}${suffix}`, { force: true });
  }
  console.log(JSON.stringify({ ok: true, restored: target, from: backup, safetyCopy, integrity }));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
  process.exitCode = 1;
}
