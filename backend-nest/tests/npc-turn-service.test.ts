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

describe('NpcTurnService — eventi causali (GAMEPLAY-LONG)', () => {
  /**
   * Mondo a un solo proprietario (FRA), così la causa è univoca: gli eventi non
   * dipendono dall'ordine alfabetico delle politie.
   */
  const causalService = (
    regions: Array<Record<string, unknown>>,
    options: { relationship?: string; neighbourPower?: number; neighbour?: boolean } = {},
  ) => {
    const map = new Map<string, any>();
    regions.forEach((def, index) => {
      map.set(`r${index}`, {
        id: `r${index}`, name: `Città ${index}`, owner: 'FRA', color: '#fff',
        borders: options.neighbour ? ['n0'] : [], population: 10, gdp: 10, militaryPower: 10,
        objects: [], status: 'active', ...def,
      });
    });
    if (options.neighbour) {
      map.set('n0', {
        id: 'n0', name: 'Vienna', owner: 'AUT', color: '#eee', borders: ['r0'],
        population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active',
      });
    }
    const svc = new NpcTurnService({
      regions: () => map,
      playerPolityId: () => 'PLAYER',
      currentTurn: () => 1,
      results: () => [],
      gameController: { getNPCCountries: () => [], processNPCTurn: async () => ({ type: 'develop' }) },
      relationship: () => options.relationship ?? 'neutral',
      transferRegion: () => {},
      publicPolityName: id => (id === 'FRA' ? 'Francia' : id === 'AUT' ? 'Austria' : 'Italia'),
      nationalMilitaryPower: () => options.neighbourPower ?? 10,
    });
    return { svc, regions: map };
  };

  it('la fame nasce dal PIL per abitante, non dal caso', () => {
    const { svc, regions } = causalService([{ population: 100, gdp: 30, militaryPower: 2 }]);
    const before = JSON.parse(JSON.stringify([...regions.values()]));
    const events = svc.applyRandomEvents();
    expect(events[0]).toContain('Carestia');
    // L'evento **osserva** lo stato: le cifre le muove il motore, non il fatto narrato.
    expect([...regions.values()]).toEqual(before);
  });

  it('lo sforzo militare insostenibile pesa sulle casse civili', () => {
    const { svc } = causalService([{ population: 100, gdp: 100, militaryPower: 150 }]);
    const events = svc.applyRandomEvents();
    expect(events[0]).toContain('sforzo militare');
    expect(events[0]).toContain('Francia');
  });

  it('la stessa condizione non si ripete a ogni battito', () => {
    let turn = 1;
    const map = new Map<string, any>();
    map.set('r0', { id: 'r0', name: 'Città 0', owner: 'FRA', color: '#fff', borders: [], population: 100, gdp: 30, militaryPower: 2, objects: [], status: 'active' });
    const svc = new NpcTurnService({
      regions: () => map, playerPolityId: () => 'PLAYER', currentTurn: () => turn, results: () => [],
      gameController: { getNPCCountries: () => [], processNPCTurn: async () => ({ type: 'develop' }) },
      relationship: () => 'neutral', transferRegion: () => {}, publicPolityName: () => 'Francia',
    });
    expect(svc.applyRandomEvents()[0]).toContain('Carestia');
    const orig = Math.random;
    Math.random = () => 0.9;
    try {
      // Turno successivo: la carestia è ancora vera, ma il dispaccio non la ripete.
      turn = 2;
      expect(svc.applyRandomEvents()).toEqual([]);
      // Dopo il raffreddamento la condizione torna a farsi sentire.
      turn = 6;
      expect(svc.applyRandomEvents()[0]).toContain('Carestia');
    } finally { Math.random = orig; }
  });

  it('l’escalation richiede una relazione ostile e uno squilibrio di forze', () => {
    const hostile = causalService([{ population: 100, gdp: 100, militaryPower: 100 }], {
      relationship: 'hostile', neighbour: true, neighbourPower: 40,
    });
    expect(hostile.svc.applyRandomEvents()[0]).toContain('Manovre al confine');
    // Senza ostilità registrata non c’è escalation: nessun evento inventato.
    const peaceful = causalService([{ population: 100, gdp: 100, militaryPower: 100 }], {
      relationship: 'neutral', neighbour: true, neighbourPower: 40,
    });
    const orig = Math.random;
    Math.random = () => 0.9;
    try {
      expect(peaceful.svc.applyRandomEvents()).toEqual([]);
    } finally { Math.random = orig; }
    // Con ostilità ma senza superiorità non si schierano forze.
    const balanced = causalService([{ population: 100, gdp: 100, militaryPower: 30 }], {
      relationship: 'hostile', neighbour: true, neighbourPower: 100,
    });
    Math.random = () => 0.9;
    try {
      expect(balanced.svc.applyRandomEvents()).toEqual([]);
    } finally { Math.random = orig; }
  });

  it('le tensioni territoriali emergono da molte province povere', () => {
    const poor = causalService(Array.from({ length: 6 }, () => ({ population: 100, gdp: 100, militaryPower: 1 })));
    expect(poor.svc.applyRandomEvents()[0]).toContain('Tensioni provinciali');
    // Poche province: nessuna tensione territoriale, quindi nessuna causa.
    const small = causalService([{ population: 100, gdp: 100, militaryPower: 1 }]);
    const orig = Math.random;
    Math.random = () => 0.9;
    try {
      expect(small.svc.applyRandomEvents()).toEqual([]);
    } finally { Math.random = orig; }
  });

  it('l’innovazione segnala la ricchezza diffusa, ma non in presenza di ostilità', () => {
    const rich = causalService([{ population: 100, gdp: 400, militaryPower: 20 }]);
    const events = rich.svc.applyRandomEvents();
    expect(events[0]).toContain('Innovazione');
    const atWar = causalService([{ population: 100, gdp: 400, militaryPower: 20 }], {
      relationship: 'hostile', neighbour: true, neighbourPower: 10,
    });
    expect(atWar.svc.applyRandomEvents()[0]).not.toContain('Innovazione');
  });

  it('lo stato che non offre cause lascia spazio al solo rumore secondario', () => {
    const { svc, regions } = causalService([{ population: 10, gdp: 10, militaryPower: 10 }]);
    const orig = Math.random;
    Math.random = () => 0.9;
    try {
      expect(svc.applyRandomEvents()).toEqual([]);
    } finally { Math.random = orig; }
    Math.random = () => 0;
    try {
      expect(svc.applyRandomEvents()[0]).toContain('Terremoto');
      expect(regions.get('r0').population).toBe(Math.floor(10 * 0.95));
    } finally { Math.random = orig; }
  });
});

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
