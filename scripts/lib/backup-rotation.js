'use strict';
/**
 * Rotazione dei backup SQLite.
 * ===========================
 * Ogni release crea uno snapshot completo del database (centinaia di MB). Senza
 * un limite la cartella `backups/` cresce senza fine (osservato: ~3,5 GB in un
 * giorno, 5,8 GB totali). Questa utility tiene solo i backup **più recenti** e
 * rimuove i più vecchi, così lo spazio resta costante nel tempo.
 *
 * La rotazione avviene **solo** su file che rispettano il pattern atteso, dentro
 * la cartella indicata: mai file arbitrari, mai il database attivo.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Numero di backup da conservare (default 3, override con OPEN_PAX_BACKUP_KEEP). */
function keepCount(explicit) {
  const raw = explicit ?? process.env.OPEN_PAX_BACKUP_KEEP;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

/** I backup riconosciuti: `world-story-<timestamp>.db` (timestamp = ISO con `-`). */
function isManagedBackup(name) {
  return /^world-story-[\dTZ-]+\.db$/.test(name) || /^open-pax-[\dTZ-]+\.db$/.test(name);
}

/**
 * Ruota i backup in `dir`: tiene i `keep` più recenti per mtime, rimuove gli
 * altri. Ritorna `{ kept, removed }` (array di path) per log e test.
 */
function rotate(dir, keep) {
  const limit = keepCount(keep);
  if (!fs.existsSync(dir)) return { kept: [], removed: [] };

  const candidates = fs.readdirSync(dir)
    .filter(isManagedBackup)
    .map(name => path.join(dir, name))
    .map(file => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs); // più recenti prima

  const kept = candidates.slice(0, limit).map(item => item.file);
  const removed = [];
  for (const item of candidates.slice(limit)) {
    try {
      fs.rmSync(item.file, { force: true });
      removed.push(item.file);
    } catch { /* un file già rimosso non deve interrompere la rotazione */ }
  }
  return { kept, removed };
}

module.exports = { rotate, keepCount, isManagedBackup };
