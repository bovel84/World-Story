/**
 * GameDataService — assemblaggio del read model GameData (DB temporaneo per
 * le pressioni; nessuna LLM).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-gamedata-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let GameDataService: any;
const GAME_ID = 'gamedata-game';

function makeCtx() {
  const regions = new Map<string, any>([
    ['r1', { id: 'r1', name: 'Roma', owner: 'PLAYER', color: '#ff0000', population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active' }],
    ['r2', { id: 'r2', name: 'Parigi', owner: 'FRA', color: '#0000ff', population: 8, gdp: 8, militaryPower: 8, objects: [], status: 'active' }],
  ]);
  const accounts = {
    PLAYER: { provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0 },
    FRA: { provinces: 1, nominalGdpUsdBillions: 80, militaryPower: 8, forces: 0, mobilized: 0 },
  };
  return {
    gameId: GAME_ID,
    players: () => [{ id: 'p1', name: 'Raw', regionId: 'r1', color: '#ff0000', polityId: 'PLAYER' }],
    regions: () => regions,
    playerPolityId: () => 'PLAYER',
    currentDate: () => '1951-01-01',
    currentTurn: () => 1,
    difficulty: () => 'normal',
    consolidatedHistory: () => '',
    keepRawTail: () => 3,
    worldName: () => 'Test World',
    worldBasePrompt: () => 'lore',
    worldStartDate: () => '1951-01-01',
    worldSimulationRules: () => undefined,
    isStrictGame: () => false,
    publicPolityName: (id: string) => (id === 'PLAYER' ? 'Italia' : id),
    sessionAccounts: () => accounts,
    arsenalUnits: () => ({ infantry: 1 }),
    peekArsenal: () => undefined,
    resourceStock: () => ({ money: 10, food: 10, fuel: 10, clothing: 0, weapons: 0, debts: [] }),
    resourceLedger: () => ({}),
    modifiersFor: () => ({ stability: 50 }),
    productionOrders: () => [],
    governmentVoices: () => null,
    governmentVoiceKey: () => 'k',
    peekCrisis: () => ({ level: 'low', headline: 'h', summary: 's', risks: [], criticalDays: {}, episodes: {}, collapseDays: 90 }),
    ending: () => null,
    pendingFundingNotes: () => null,
    buildNpcStrategicDossiers: () => 'dossier-testo',
    relationships: () => ({ relations: [] }),
    chatTranscripts: () => ({ chats: [] }),
    actions: () => [],
    results: () => [],
  };
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('gd-world', 'W', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'gd-world', 1, '1951-01-01')`).run(GAME_ID);
  const mod = await import('../src/game/GameDataService');
  GameDataService = mod.GameDataService;
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

describe('GameDataService — read model', () => {
  it('assembla identità, mondo e giocatore', () => {
    const data = new GameDataService(makeCtx()).build();
    expect(data.id).toBe(GAME_ID);
    expect(data.world.name).toBe('Test World');
    expect(data.world.startDate).toBe('1951-01-01');
    expect(data.playerPolityId).toBe('PLAYER');
    // Il nome grezzo del giocatore è sostituito dal nome pubblico della polity.
    expect(data.players[0].name).toBe('Italia');
    expect(data.playerPolityName).toBe('Italia');
  });

  it('include stato materiale, crisi e dossier NPC', () => {
    const data = new GameDataService(makeCtx()).build();
    expect(data.worldState.accounts.PLAYER.effectiveMilitaryPower).toBeTypeOf('number');
    expect(data.worldState.crisis.level).toBe('low');
    expect(data.worldState.modifiers.stability).toBe(50);
    expect(data.npcStrategicProfiles).toBe('dossier-testo');
    expect(data.strictMode).toBe(false);
  });
});
