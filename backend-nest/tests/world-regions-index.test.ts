/**
 * world_regions — l'indice su `world_id` (anti full-scan).
 * ========================================================
 * `world_regions` conserva le geometrie di **tutti** i mondi: su una partita
 * reale sono ~590k righe per ~1.5 GB. Senza indice su `world_id`, ogni lettura
 * dell'anagrafica di un mondo (`SELECT * FROM world_regions WHERE world_id = ?`)
 * scansiona l'intera tabella (~13 s misurati). better-sqlite3 è **sincrono**:
 * quella scansione blocca l'event loop, tutte le richieste in volo scadono e il
 * tunnel risponde **524**.
 *
 * Questo test difende l'invariante: l'indice esiste e il pianificatore lo usa
 * (SEARCH, non SCAN). È un test di schema su un DB temporaneo, senza rete.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-regions-index-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
});

afterAll(() => {
  try { db?.close(); } catch { /* già chiuso */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
});

describe('world_regions — indice su world_id', () => {
  it('l’indice idx_world_regions_world esiste ed è su world_regions(world_id)', () => {
    const rows = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='world_regions'"
    ).all() as Array<{ name: string; sql: string | null }>;
    const index = rows.find(row => row.name === 'idx_world_regions_world');
    expect(index, 'manca idx_world_regions_world: la mappa torna a scansionare 1.5 GB per richiesta').toBeTruthy();
    expect(index!.sql ?? '').toMatch(/world_id/i);
  });

  it('la lettura per world_id usa SEARCH (indice), mai SCAN', () => {
    // Righe reali: su una tabella vuota il pianificatore può scegliere piani
    // diversi; con qualche riga l'uguaglianza su indice è quella attesa.
    db.prepare("INSERT OR IGNORE INTO worlds (id, name, description, start_date, base_prompt) VALUES ('idx-world', 'W', '', '2000-01-01', '')").run();
    const insert = db.prepare("INSERT OR IGNORE INTO world_regions (id, world_id, name) VALUES (?, 'idx-world', ?)");
    for (let i = 0; i < 8; i++) insert.run(`idx-world-region-${i}`, `R${i}`);

    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM world_regions WHERE world_id = ?')
      .all('idx-world') as Array<{ detail: string }>;
    const detail = plan.map(row => row.detail).join(' | ');
    expect(detail).toMatch(/SEARCH world_regions USING INDEX idx_world_regions_world/);
    expect(detail).not.toMatch(/SCAN world_regions/);
  });
});
