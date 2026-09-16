/**
 * Q02 µ4 — Script fail-closed: backup SQLite coerente, preflight, rifiuto del
 * rilascio non autorizzato e rollback documentato.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

const REPO_ROOT = path.resolve(__dirname, '../..');
const BACKUP = path.join(REPO_ROOT, 'scripts', 'db-backup.js');
const RESTORE = path.join(REPO_ROOT, 'scripts', 'db-restore.js');
const RELEASE = path.join(REPO_ROOT, 'scripts', 'release.js');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-q02-'));
const dbPath = path.join(workDir, 'world-story.db');

function runScript(script: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function jsonFrom(stdout: string): any {
  return JSON.parse(stdout.trim());
}

beforeAll(() => {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE simulation_jobs (id TEXT PRIMARY KEY, game_id TEXT, type TEXT, status TEXT, created_at TEXT)');
  db.exec("INSERT INTO simulation_jobs (id, game_id, type, status, created_at) VALUES ('job-1','game-1','advance','completed','1951-01-01T00:00:00.000Z')");
  db.close();
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('Q02 µ4 — backup/restore fail-closed', () => {
  it('crea un backup coerente e ne verifica l’integrità', () => {
    const out = path.join(workDir, 'backup.db');
    const result = runScript(BACKUP, [dbPath, out]);
    expect(result.code).toBe(0);
    const payload = jsonFrom(result.stdout);
    expect(payload).toMatchObject({ ok: true, source: dbPath, backup: out, integrity: 'ok' });
    expect(fs.existsSync(out)).toBe(true);
    expect(payload.bytes).toBeGreaterThan(0);
  });

  it('rifiuta un database mancante senza creare nulla', () => {
    const result = runScript(BACKUP, [path.join(workDir, 'non-esiste.db'), path.join(workDir, 'x.db')]);
    expect(result.code).toBe(2);
    expect(jsonFrom(result.stderr)).toMatchObject({ ok: false, error: 'db_not_found' });
    expect(fs.existsSync(path.join(workDir, 'x.db'))).toBe(false);
  });

  it('il restore mette al sicuro il database corrente prima di sovrascriverlo', () => {
    const backup = path.join(workDir, 'restore-source.db');
    expect(runScript(BACKUP, [dbPath, backup]).code).toBe(0);

    const other = path.join(workDir, 'to-restore.db');
    const db = new Database(other);
    db.exec('CREATE TABLE t (x TEXT)');
    db.close();

    const result = runScript(RESTORE, [backup, other]);
    expect(result.code).toBe(0);
    const payload = jsonFrom(result.stdout);
    expect(payload).toMatchObject({ ok: true, restored: other, from: backup, integrity: 'ok' });
    expect(fs.existsSync(payload.safetyCopy)).toBe(true);

    const restored = new Database(other, { readonly: true });
    const counts = restored.prepare("SELECT COUNT(*) AS n FROM simulation_jobs").get() as { n: number };
    restored.close();
    expect(counts.n).toBe(1);
  });

  it('il restore rifiuta un backup inesistente', () => {
    const result = runScript(RESTORE, [path.join(workDir, 'manca.db'), dbPath]);
    expect(result.code).toBe(2);
    expect(jsonFrom(result.stderr)).toMatchObject({ ok: false, error: 'backup_not_found' });
  });
});

describe('Q02 µ4 — preflight di rilascio', () => {
  it('--plan-only elenca i passi e il rollback senza mutare nulla', () => {
    const result = runScript(RELEASE, ['--plan-only', '--db', dbPath, '--backup-dir', workDir]);
    expect(result.code).toBe(0);
    const payload = jsonFrom(result.stdout);
    expect(payload.mode).toBe('plan-only');
    expect(payload.preflight).toMatchObject({ ok: true, activeRuns: [] });
    const ids = payload.plan.steps.map((step: any) => step.id);
    expect(ids).toEqual([
      'tests', 'build', 'backup', 'active-runs', 'maintenance',
      'migration', 'backend-update', 'readiness', 'frontend-compat', 'smoke',
    ]);
    expect(payload.plan.rollback[0]).toContain('db-restore.js');
    expect(payload.executed).toEqual([]);
  });

  it('si ferma se ci sono run attivi (mai killare un job alla cieca)', () => {
    const busy = path.join(workDir, 'busy.db');
    const db = new Database(busy);
    db.exec('CREATE TABLE simulation_jobs (id TEXT PRIMARY KEY, game_id TEXT, type TEXT, status TEXT, created_at TEXT)');
    db.exec("INSERT INTO simulation_jobs VALUES ('job-active','game-1','advance','running','1951-01-01T00:00:00.000Z')");
    db.close();

    const blocked = runScript(RELEASE, ['--plan-only', '--db', busy]);
    expect(blocked.code).toBe(4);
    expect(jsonFrom(blocked.stderr).preflight).toMatchObject({ ok: false, error: 'active_runs_present' });

    const allowed = runScript(RELEASE, ['--plan-only', '--db', busy, '--allow-active-runs']);
    expect(allowed.code).toBe(0);
    expect(jsonFrom(allowed.stdout).preflight.activeRuns).toHaveLength(1);
  });

  it('un database mancante ferma il preflight', () => {
    const result = runScript(RELEASE, ['--plan-only', '--db', path.join(workDir, 'assente.db')]);
    expect(result.code).toBe(4);
    expect(jsonFrom(result.stderr).preflight).toMatchObject({ ok: false, error: 'db_not_found' });
  });

  it('--execute senza --authorized non esegue alcun passo (nessun rilascio pubblico non autorizzato)', () => {
    const result = runScript(RELEASE, ['--execute', '--db', dbPath, '--backup-dir', workDir]);
    expect(result.code).toBe(5);
    const payload = jsonFrom(result.stderr);
    expect(payload.error).toBe('authorization_required');
    expect(fs.readdirSync(workDir).filter((name) => name.startsWith('world-story-'))).toEqual([]);
  });

  it('un flag sconosciuto è un errore, non un silenzio', () => {
    const result = runScript(RELEASE, ['--plan-only', '--db', dbPath, '--sconosciuto']);
    expect(result.code).toBe(1);
    expect(jsonFrom(result.stderr).error).toContain('flag sconosciuto');
  });

  it('la migrazione opera sullo stesso DB del preflight (OPEN_PAX_DB_PATH)', () => {
    // Difetto trovato durante il primo deploy reale: senza questa env la
    // migrazione avrebbe toccato il database di default del cwd.
    const { migrationEnv, resolveDbPath, parseArgs } = require(path.join(REPO_ROOT, 'scripts', 'release.js'));
    expect(migrationEnv(dbPath).OPEN_PAX_DB_PATH).toBe(dbPath);
    expect(parseArgs(['--execute', '--authorized', '--db', dbPath])).toMatchObject({
      mode: 'execute',
      authorized: true,
      db: dbPath,
    });
    expect(parseArgs(['--execute']).authorized).toBeUndefined();
    expect(resolveDbPath(dbPath)).toBe(path.resolve(dbPath));
  });
});
