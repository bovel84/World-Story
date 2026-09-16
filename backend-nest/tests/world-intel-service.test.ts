/**
 * WorldIntelService — risoluzione polity/regioni, potenza, memoria e dossier
 * (DB temporaneo; nessuna LLM).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-intel-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let WorldIntelService: any;
const GAME_ID = 'intel-game';

function region(id: string, name: string, owner: string, color: string, borders: string[] = []): any {
  return { id, name, owner, color, borders, population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active' };
}

function makeService(relations: Record<string, string> = {}) {
  const regions = new Map<string, any>([
    ['r1', region('r1', 'Roma', 'PLAYER', '#ff0000', ['r2'])],
    ['r2', region('r2', 'Milano', 'FRA', '#0000ff', ['r1'])],
  ]);
  const accounts = {
    PLAYER: { provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0 },
    FRA: { provinces: 1, nominalGdpUsdBillions: 80, militaryPower: 8, forces: 0, mobilized: 0 },
  };
  return new WorldIntelService({
    gameId: GAME_ID,
    regions: () => regions,
    playerPolityId: () => 'PLAYER',
    publicPolityName: (id: string) => (id === 'PLAYER' ? 'Italia' : id),
    results: () => [],
    relationship: (from: string, to: string) => relations[`${from}->${to}`] || 'neutral',
    arsenalUnits: () => ({}),
    worldStateOptions: () => ({ modernFacts: false, startDate: '1951-01-01' }),
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('wi-world', 'W', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'wi-world', 1, '1951-01-01')`).run(GAME_ID);
  const mod = await import('../src/game/WorldIntelService');
  WorldIntelService = mod.WorldIntelService;
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

describe('WorldIntelService — risoluzione e geografia', () => {
  it('buildResolvers risolve regioni e politie', () => {
    const svc = makeService();
    const resolvers = svc.buildResolvers();
    expect(resolvers.regions.resolve('Roma')?.id).toBe('r1');
    expect(resolvers.polities.resolve('Milano')).toBeTruthy();
  });

  it('mentionedNpcPolityIds riconosce nomi di regione e codici', () => {
    const svc = makeService();
    expect(svc.mentionedNpcPolityIds(['Milano è caduta'])).toContain('FRA');
    expect(svc.mentionedNpcPolityIds(['FRA mobilized'])).toContain('FRA');
  });

  it('crisisRelevantPolityIds include il vicino geografico', () => {
    const svc = makeService();
    expect(svc.crisisRelevantPolityIds(['Milano'])).toContain('FRA');
  });

  it('polityColor sceglie il colore più frequente', () => {
    const svc = makeService();
    expect(svc.polityColor('PLAYER')).toBe('#ff0000');
  });
});

describe('WorldIntelService — potenza e vicini', () => {
  it('nationalMilitaryPower somma le regioni possedute', () => {
    const svc = makeService();
    expect(svc.nationalMilitaryPower('PLAYER')).toBe(10);
    expect(svc.nationalMilitaryPower('FRA')).toBe(10);
  });

  it('hostileNeighbourCount conta solo i rapporti ostili', () => {
    expect(makeService({ 'PLAYER->FRA': 'hostile' }).hostileNeighbourCount('PLAYER')).toBe(1);
    expect(makeService({ 'PLAYER->FRA': 'ally' }).hostileNeighbourCount('PLAYER')).toBe(0);
  });
});

describe('WorldIntelService — contratto mappa NPC', () => {
  it('materializza una mobilitazione dichiarata ma senza mapChange', () => {
    const svc = makeService();
    const event: any = {
      headline: 'Crisi',
      description: 'Tensione al confine',
      reactions: [{ polityName: 'Milano', stance: 'opposed', response: 'Avviamo la mobilitazione delle riserve.', counterAction: '' }],
    };
    const out = svc.reconcileNpcMaterialMeasures(event);
    expect(out.mapChanges?.length).toBe(1);
    expect(out.mapChanges[0].type).toBe('start_mobilization');
    expect(out.mapChanges[0].regionName).toBe('Milano');
  });
});

describe('WorldIntelService — dossier NPC', () => {
  it('produce una riga per ogni controparte in teatro', () => {
    const svc = makeService({ 'PLAYER->FRA': 'neutral' });
    const accounts = {
      PLAYER: { provinces: 1, militaryPower: 10, effectiveMilitaryPower: 10 },
      FRA: { provinces: 1, militaryPower: 8, effectiveMilitaryPower: 8 },
    };
    const dossier = svc.buildNpcStrategicDossiers(['Milano'], accounts);
    expect(dossier).toContain('FRA');
    expect(dossier).toContain('Priorità correnti');
  });
});
