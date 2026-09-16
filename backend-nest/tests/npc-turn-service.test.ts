/**
 * NpcTurnService — turni NPC ed eventi casuali (nessuna LLM reale).
 */
import { describe, it, expect, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-npc-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

import { NpcTurnService } from '../src/game/NpcTurnService';

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = TEST_DB + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
});

function region(id: string, name: string, owner: string, borders: string[] = []): any {
  return { id, name, owner, color: '#123456', borders, population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active' };
}

function makeService(npcCountryIds: string[] = []) {
  const regions = new Map<string, any>([
    ['r1', region('r1', 'Roma', 'PLAYER', ['r2'])],
    ['r2', region('r2', 'Milano', 'FRA', ['r1'])],
  ]);
  const calls: any[] = [];
  const svc = new NpcTurnService({
    regions: () => regions,
    playerPolityId: () => 'PLAYER',
    currentTurn: () => 1,
    results: () => [],
    gameController: {
      getNPCCountries: () => npcCountryIds,
      processNPCTurn: async (id: string, ctx: any) => { calls.push({ id, ctx }); return { type: 'develop' }; },
    },
    relationship: () => 'neutral',
    transferRegion: () => {},
  });
  return { svc, regions, calls };
}

describe('NpcTurnService — eventi casuali', () => {
  it('nessun evento sopra la soglia', () => {
    const { svc } = makeService();
    const orig = Math.random;
    Math.random = () => 0.9;
    try {
      expect(svc.applyRandomEvents()).toEqual([]);
    } finally { Math.random = orig; }
  });

  it('un disastro riduce popolazione e PIL della regione colpita', () => {
    const { svc, regions } = makeService();
    const orig = Math.random;
    Math.random = () => 0;
    try {
      const events = svc.applyRandomEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('Terremoto');
      expect(regions.get('r1').population).toBe(Math.floor(10 * 0.95));
      expect(regions.get('r1').gdp).toBeCloseTo(9, 5);
    } finally { Math.random = orig; }
  });
});

describe('NpcTurnService — turni NPC', () => {
  it('senza nazioni NPC non fa nulla', async () => {
    const { svc } = makeService([]);
    await expect(svc.processNPCTurns(3, 7)).resolves.toEqual([]);
  });

  it('lo sviluppo interno cresce PIL e potenza della nazione', async () => {
    const { svc, regions, calls } = makeService(['r2']);
    const events = await svc.processNPCTurns(3, 365);
    expect(calls).toHaveLength(1);
    expect(calls[0].ctx.polityId).toBe('FRA');
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('sviluppo interno');
    expect(regions.get('r2').gdp).toBeCloseTo(10 * 1.05, 5);
    expect(regions.get('r2').militaryPower).toBeCloseTo(10 * 1.03, 5);
  });
});
