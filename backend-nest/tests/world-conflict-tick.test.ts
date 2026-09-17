/**
 * WORLD-ALIVE P3 — battito deterministico dei conflitti del mondo.
 * ================================================================
 * `NpcTurnService.processWorldConflictTick` apre nuove guerre fra NPC
 * (via `degradeRelationship`, cioè `RelationshipMatrix.degrade`) e continua i
 * conflitti ostili su fronti reali con `canNpcCapture` + `transferRegion`.
 *
 * I test forzano il seme scegliendo un turno il cui tiro `stableRoll` passa:
 * il comportamento è riproducibile, mai `Math.random`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-conflict-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

import { NpcTurnService } from '../src/game/NpcTurnService';
import { stableRoll } from '../src/core/simulation/MilitaryProduction';

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = TEST_DB + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
});

function region(id: string, name: string, owner: string, militaryPower: number, borders: string[] = []): any {
  return { id, name, owner, color: '#123456', borders, population: 10, gdp: 10, militaryPower, objects: [], status: 'active' };
}

/** Primo turno (>=1) il cui tiro per l'azione indicata passa la soglia. */
function turnFor(seed: string, tag: string, chance: number): number {
  for (let turn = 1; turn < 100_000; turn++) {
    if (stableRoll(`${seed}|${tag}|${turn}`) < chance) return turn;
  }
  throw new Error(`nessun turno utile per ${tag}`);
}

function makeService(regions: Map<string, any>, seed = 'test-game', turn = 1) {
  const relations = new Map<string, string>();
  const transferred: any[] = [];
  const svc = new NpcTurnService({
    regions: () => regions,
    playerPolityId: () => 'PLAYER',
    currentTurn: () => turn,
    results: () => [],
    gameController: { getNPCCountries: () => [], processNPCTurn: async () => null },
    relationship: (from, to) => relations.get(`${from}>${to}`) ?? 'neutral',
    transferRegion: (r, owner, color) => { transferred.push({ id: r.id, owner, color }); r.owner = owner; },
    seed: () => seed,
    degradeRelationship: (from, to) => { relations.set(`${from}>${to}`, 'hostile'); relations.set(`${to}>${from}`, 'hostile'); },
  });
  return { svc, relations, transferred };
}

describe('WORLD-ALIVE P3 — conflitti NPC deterministici', () => {
  it('senza frontiere reali non succede nulla (nessuna invenzione)', () => {
    const regions = new Map<string, any>([
      ['r1', region('r1', 'Alfa', 'AAA', 1000)],
      ['r2', region('r2', 'Beta', 'BBB', 10)],
    ]);
    const { svc } = makeService(regions, 'g-nofrontier', 1);
    expect(svc.processWorldConflictTick(7)).toEqual([]);
  });

  it('apre una nuova guerra fra NPC neutrali quando esiste un vantaggio reale', () => {
    const regions = new Map<string, any>([
      ['r1', region('r1', 'Alfa', 'AAA', 1000, ['r2'])],
      ['r2', region('r2', 'Beta', 'BBB', 10, ['r1'])],
    ]);
    const seed = 'g-war';
    const turn = turnFor(seed, 'war-open', 0.05);
    const { svc, relations } = makeService(regions, seed, turn);

    const events = svc.processWorldConflictTick(7);
    expect(relations.get('AAA>BBB')).toBe('hostile');
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('dichiara guerra');
    expect(regions.get('r2').owner).toBe('BBB'); // la dichiarazione non conquista da sola
  });

  it('la nuova guerra non viene mai aperta contro la politia del giocatore', () => {
    const regions = new Map<string, any>([
      ['p', region('p', 'Casa', 'PLAYER', 10, ['r1'])],
      ['r1', region('r1', 'Alfa', 'AAA', 1000, ['p'])],
    ]);
    const seed = 'g-player';
    const turn = turnFor(seed, 'war-open', 0.05);
    const { svc, relations } = makeService(regions, seed, turn);

    expect(svc.processWorldConflictTick(7)).toEqual([]);
    expect(relations.get('AAA>PLAYER')).toBeUndefined();
  });

  it('continua un conflitto ostile e conquista una provincia debole sul fronte', () => {
    const regions = new Map<string, any>([
      ['r1', region('r1', 'Alfa', 'AAA', 1000, ['r2'])],
      ['r2', region('r2', 'Beta', 'BBB', 10, ['r1'])],
    ]);
    const seed = 'g-conquest';
    const turn = turnFor(seed, 'conquest', 0.08);
    const { svc, relations, transferred } = makeService(regions, seed, turn);
    relations.set('AAA>BBB', 'hostile');
    relations.set('BBB>AAA', 'hostile');

    const events = svc.processWorldConflictTick(7);
    expect(transferred).toEqual([{ id: 'r2', owner: 'AAA', color: '#123456' }]);
    expect(regions.get('r2').owner).toBe('AAA');
    expect(events).toEqual(['AAA conquista Beta']);
  });

  it('non conquista se il difensore non è davvero più debole', () => {
    const regions = new Map<string, any>([
      ['r1', region('r1', 'Alfa', 'AAA', 100, ['r2'])],
      ['r2', region('r2', 'Beta', 'BBB', 90, ['r1'])],
    ]);
    const seed = 'g-strong';
    const turn = turnFor(seed, 'conquest', 0.08);
    const { svc, relations, transferred } = makeService(regions, seed, turn);
    relations.set('AAA>BBB', 'hostile');
    relations.set('BBB>AAA', 'hostile');

    expect(svc.processWorldConflictTick(7)).toEqual([]);
    expect(transferred).toEqual([]);
    expect(regions.get('r2').owner).toBe('BBB');
  });

  it('è limitato: al più una guerra e una conquista per tick', () => {
    const regions = new Map<string, any>([
      ['a1', region('a1', 'Alfa1', 'AAA', 1000, ['b1', 'c1'])],
      ['b1', region('b1', 'Beta1', 'BBB', 1, ['a1'])],
      ['c1', region('c1', 'Gamma1', 'CCC', 1, ['a1'])],
    ]);
    const seed = 'g-bound';
    const turn = turnFor(seed, 'war-open', 0.05);
    const { svc } = makeService(regions, seed, turn);

    const events = svc.processWorldConflictTick(7);
    expect(events.filter(e => e.includes('dichiara guerra'))).toHaveLength(1);
    // Al più una regione cambia proprietario per tick.
    expect(regions.get('b1').owner === 'AAA' && regions.get('c1').owner === 'AAA').toBe(false);
  });

  it('lo stesso seme e lo stesso turno producono lo stesso esito (determinismo)', () => {
    const build = () => new Map<string, any>([
      ['r1', region('r1', 'Alfa', 'AAA', 1000, ['r2'])],
      ['r2', region('r2', 'Beta', 'BBB', 10, ['r1'])],
    ]);
    const seed = 'g-replay';
    const turn = turnFor(seed, 'war-open', 0.05);
    const first = makeService(build(), seed, turn);
    const second = makeService(build(), seed, turn);
    expect(first.svc.processWorldConflictTick(7)).toEqual(second.svc.processWorldConflictTick(7));
    expect(first.transferred).toEqual(second.transferred);
  });
});
