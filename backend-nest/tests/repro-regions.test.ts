import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `repro-regions-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;

beforeAll(async () => {
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('createWithRegions direct', () => {
  it('persists regions', () => {
    const worldId = 'repro_world';
    const regions = [
      { id: `${worldId}_ALP`, worldId, name: 'ALPHA', geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}', color: '#ff0000', owner: 'ALP', population: 100, gdp: 10, militaryPower: 5, flag: 'ALP', objects: [], borders: [] },
      { id: `${worldId}_BET`, worldId, name: 'BETA', geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[2,0],[3,0],[3,1],[2,1],[2,0]]]}}', color: '#00ff00', owner: 'BET', population: 200, gdp: 20, militaryPower: 10, flag: 'BET', objects: [], borders: [] },
    ];

    const result = worldRepository.createWithRegions(
      { id: worldId, name: 'Repro World', description: '', startDate: '1951-01-01', basePrompt: 'test', historicalAccuracy: 0.8 },
      regions
    );
    expect(result.regions.length).toBe(2);

    const found = worldRepository.findById(worldId);
    expect(found.regions.length).toBe(2);
    expect(found.regions.map((r: any) => r.id)).toEqual([`${worldId}_ALP`, `${worldId}_BET`]);
  });
});
