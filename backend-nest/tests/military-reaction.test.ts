/**
 * MILITARY-REACTION — i paesi reagiscono alle mosse militari materiali
 * ===================================================================
 * Due cause reali, verificate sul gioco dell'utente:
 *
 *  1. le regioni di sessione perdevano `borders` (0/243 contro 167/243 nel
 *     database) → `frontierOwnerIds()` del contesto di reazione era vuoto e il
 *     tetto di 8 attori veniva riempito con politie lontane prese dalla
 *     matrice completa dei rapporti;
 *  2. la postura militare materiale (unità create, mobilitazioni in corso,
 *     reparti spostati) non entrava nel contesto: restava solo il testo
 *     dell'ordine, quindi un turno puramente materiale non aveva attori.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-milreact-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

import { buildReactionContext } from '../src/core/simulation/ReactionContext';
import { playerCentricRelationships } from '../src/game/reactionInputs';
import { playerMilitaryPosture, renderMilitaryPosture } from '../src/game/MilitaryPosture';

const PLAYER = 'DEU';

function region(id: string, name: string, owner: string, borders: string[] = [], objects: any[] = []) {
  return { id, name, owner, borders, objects };
}

describe('MILITARY-REACTION — alimentazione del contesto di reazione', () => {
  it('i rapporti passati al contesto sono solo quelli del giocatore', () => {
    const full = {
      DEU: { AUT: 'hostile', FRA: 'ally' },
      AUT: { DEU: 'hostile' },
      FRA: { DEU: 'ally' },
      // Rapporto fra due terze politie: non deve creare attori per il giocatore.
      RUS: { GBR: 'hostile' },
      GBR: { RUS: 'hostile' },
    };
    const centric = playerCentricRelationships(full, PLAYER)!;
    expect(Object.keys(centric).sort()).toEqual(['AUT', 'DEU', 'FRA']);
    expect(centric.AUT.DEU).toBe('hostile');
    expect(centric.DEU.AUT).toBe('hostile');
    // Il rispecchiamento non sovrascrive un valore registrato.
    expect(centric.DEU.FRA).toBe('ally');
    expect(playerCentricRelationships(undefined, PLAYER)).toBeUndefined();
  });

  it('una mossa militare senza nomi include i vicini REALI e nessun attore lontano', () => {
    const regions: Record<string, any> = {
      DEU: region('DEU', 'Confederazione Germanica', PLAYER, ['AUT', 'FRA', 'POL']),
      AUT: region('AUT', "Impero d'Austria", 'AUT', ['DEU']),
      FRA: region('FRA', 'Regno di Francia', 'FRA', ['DEU']),
      POL: region('POL', 'Regno di Polonia', 'POL', ['DEU']),
      RUS: region('RUS', 'Impero Russo', 'RUS', []),
      GBR: region('GBR', 'Regno Unito', 'GBR', []),
    };
    const context = buildReactionContext({
      playerPolityId: PLAYER,
      playerPolityName: 'Confederazione Germanica',
      focusTexts: ['Creiamo un esercito permanente con coscrizione federale'],
      currentActions: [{ actionId: 'a1', text: 'Creiamo un esercito permanente con coscrizione federale' }],
      polityNames: Object.fromEntries(Object.values(regions).map(r => [r.owner, r.name])),
      regions,
      // Matrice completa: RUS e GBR hanno un rapporto fra loro, non col giocatore.
      relationships: playerCentricRelationships(
        { RUS: { GBR: 'hostile' }, GBR: { RUS: 'hostile' } },
        PLAYER,
      ),
      accounts: { DEU: { militaryPower: 20 }, AUT: { militaryPower: 30 }, FRA: { militaryPower: 25 }, POL: { militaryPower: 8 } },
    });
    const ids = context.actors.map(actor => actor.id).filter(id => !id.includes(':'));
    expect(ids.sort()).toEqual(['AUT', 'FRA', 'POL']);
    expect(ids).not.toContain('RUS');
    expect(ids).not.toContain('GBR');
    for (const id of ids) {
      const actor = context.actors.find(a => a.id === id)!;
      expect(actor.role).toBe('neighbour');
      expect(actor.because).toContain('confina');
      // Opzioni militari ammesse dal motore, non dal modello.
      const options = actor.options.map(option => option.id);
      expect(options).toContain(`${id}:mobilize`);
      expect(options).toContain(`${id}:counter`);
    }
    expect(context.trigger.kind).toBe('player_action');

    // Prova del comportamento precedente: con la matrice COMPLETA gli attori
    // lontani entravano davvero nel tetto degli 8, togliendo posto ai vicini.
    const stale = buildReactionContext({
      playerPolityId: PLAYER,
      playerPolityName: 'Confederazione Germanica',
      focusTexts: ['Creiamo un esercito permanente con coscrizione federale'],
      currentActions: [{ actionId: 'a1', text: 'Creiamo un esercito permanente con coscrizione federale' }],
      polityNames: Object.fromEntries(Object.values(regions).map(r => [r.owner, r.name])),
      regions,
      relationships: { RUS: { GBR: 'hostile' }, GBR: { RUS: 'hostile' } },
      accounts: { DEU: { militaryPower: 20 }, AUT: { militaryPower: 30 }, FRA: { militaryPower: 25 }, POL: { militaryPower: 8 } },
    });
    const staleIds = stale.actors.map(actor => actor.id).filter(id => !id.includes(':'));
    expect(staleIds).toContain('RUS');
    expect(staleIds).toContain('GBR');
  });

  it('la postura militare materiale elenca solo le formazioni del giocatore', () => {
    const regions = [
      region('DEU', 'Confederazione Germanica', PLAYER, [], [
        { id: 'mob-1', type: 'mobilization', name: 'Battaglione federale del Sud', owner: PLAYER, metadata: { status: 'forming', plannedType: 'battalion' } },
        { id: 'arm-1', type: 'army', name: 'Armata del Reno', owner: PLAYER, metadata: { status: 'operational' } },
      ]),
      // Formazione di un'altra politia: non è una mossa del giocatore.
      region('AUT', "Impero d'Austria", 'AUT', [], [
        { id: 'aut-1', type: 'battalion', name: 'Corpo di osservazione austriaco del Reno', owner: 'AUT' },
      ]),
    ];
    const facts = playerMilitaryPosture(regions, PLAYER);
    expect(facts.map(fact => fact.unitName)).toEqual(['Battaglione federale del Sud', 'Armata del Reno']);
    // Le formazioni in via di costituzione vengono prima: sono la notizia.
    expect(facts[0].status).toBe('forming');
    expect(facts[0].type).toBe('battalion');
    expect(renderMilitaryPosture(facts, 'Confederazione Germanica')).toContain('in formazione');
    expect(renderMilitaryPosture([], 'Confederazione Germanica')).toBe('');
  });

  it('limita il numero di formazioni elencate e regge un mondo senza unità', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `u${i}`, type: 'battalion', name: `Battaglione ${i}`, owner: PLAYER,
    }));
    expect(playerMilitaryPosture([region('DEU', 'Confederazione Germanica', PLAYER, [], many)], PLAYER)).toHaveLength(6);
    expect(playerMilitaryPosture([region('DEU', 'Confederazione Germanica', PLAYER)], PLAYER)).toEqual([]);
  });
});

describe('MILITARY-REACTION — il bootstrap di sessione conserva l\'adiacenza', () => {
  // Id unico per esecuzione: nessuna collisione se un run precedente è rimasto.
  const WORLD_ID = `milreact_world_${Date.now()}`;
  let db: any;
  let registry: any;
  let gameId = '';

  beforeAll(async () => {
    const database = await import('../src/database');
    db = database.default;
    database.initDatabase();
    const { worldRepository } = await import('../src/repositories');
    const registryModule = await import('../src/session-registry');
    const stub: any = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate() { return { content: '{}' }; },
      async stream(_a: string, _b: string, _c: string, onToken: any) { onToken?.(0, ''); return { content: '{}' }; },
      clearCache() { /* stub */ },
    };
    registryModule.initSessionRegistry(stub);
    registry = registryModule.getSessionRegistry();
    worldRepository.createWithRegions(
      { id: WORLD_ID, name: 'MilReact World', description: '', startDate: '1815-01-01', basePrompt: 'lore', historicalAccuracy: 0.8 },
      [
        { id: `${WORLD_ID}_DEU`, name: 'Confederazione Germanica', color: '#111111', owner: 'DEU', population: 5, gdp: 200, militaryPower: 300, flag: 'DEU', borders: [`${WORLD_ID}_AUT`, `${WORLD_ID}_FRA`] },
        { id: `${WORLD_ID}_AUT`, name: "Impero d'Austria", color: '#222222', owner: 'AUT', population: 4, gdp: 180, militaryPower: 280, flag: 'AUT', borders: [`${WORLD_ID}_DEU`] },
        { id: `${WORLD_ID}_FRA`, name: 'Regno di Francia', color: '#333333', owner: 'FRA', population: 4, gdp: 180, militaryPower: 250, flag: 'FRA', borders: [`${WORLD_ID}_DEU`] },
      ],
    );
    gameId = registry.createSession(WORLD_ID, 'Giocatore', `${WORLD_ID}_DEU`, '#111111').gameId;
  });

  afterAll(() => {
    try {
      db?.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const file = TEST_DB + suffix;
        if (fs.existsSync(file)) fs.rmSync(file);
      }
    } catch { /* tmp */ }
  });

  it('le regioni ricostruite dal DB mantengono borders e status', async () => {
    const { SessionRegistry } = await import('../src/session-registry');
    const stub: any = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate() { return { content: '{}' }; },
      async stream(_a: string, _b: string, _c: string, onToken: any) { onToken?.(0, ''); return { content: '{}' }; },
      clearCache() { /* stub */ },
    };
    // Istanza nuova: forza il percorso di ricostruzione dal database.
    const session: any = new SessionRegistry(stub).getSession(gameId);
    const deu = session.getRegion(`${WORLD_ID}_DEU`);
    expect(deu.borders).toEqual([`${WORLD_ID}_AUT`, `${WORLD_ID}_FRA`]);
    expect(deu.status).toBe('active');
    // La lettura che alimenta il contesto di reazione trova i vicini reali.
    const deuNeighbours = deu.borders.map((id: string) => session.getRegion(id).owner).sort();
    expect(deuNeighbours).toEqual(['AUT', 'FRA']);
  });
});
