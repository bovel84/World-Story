/**
 * WS-JEV-W6 — Memoria narrativa delle fazioni interne.
 *
 * Difende le invarianti della fase:
 *  1. gli eventi politici del motore (`FactionMemoryEvent`) entrano nella
 *     memoria narrativa **della fazione** con lo scope canonico `faction:<id>`,
 *     separata dalla memoria di governo (`government`, W2);
 *  2. ogni lettura filtra per `game_id` E `branch_id` e non mescola fazioni;
 *  3. il testo JEV entra nel briefing esistente (`buildGovernmentStateBlock` /
 *     `buildGovernmentVoicePrompt`) senza diventare un numero di gioco.
 *
 * Solo SQLite temporaneo e repository reale: nessun backend, nessuna rete,
 * nessun provider, MAI il DB operativo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FactionMemoryEvent } from '../src/core/simulation/FactionMemory';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w6-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'memory.sqlite');
const originalEnabled = process.env.JEV_MEMORY_ENABLED;

const GAME = 'jev-w6-game';
const OTHER_GAME = 'jev-w6-other';
const BRANCH = 'branch-A';
const POINT = { gameDate: '1951-06-01', turn: 6 };

let db: any;
let service: typeof import('../src/core/government/jev/jev-memory.service');
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let governmentPrompts: typeof import('../src/prompts/government');
let governmentCore: typeof import('../src/core/simulation/GovernmentFactions');
let gameDataModule: typeof import('../src/game/GameDataService');
let configModule: typeof import('../src/core/government/jev/jev.config');
let snapshot: import('../src/core/simulation/GovernmentFactions').GovernmentSnapshot;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('w6-world', 'W6', '', '1951-01-01', '')`).run();
  // Partita con ramo principale (head_branch_id null) per il cursore JEV.
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'w6-world', 6, '1951-06-01')`).run(GAME);
  service = await import('../src/core/government/jev/jev-memory.service');
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  governmentPrompts = await import('../src/prompts/government');
  governmentCore = await import('../src/core/simulation/GovernmentFactions');
  gameDataModule = await import('../src/game/GameDataService');
  configModule = await import('../src/core/government/jev/jev.config');
  snapshot = governmentCore.governmentSnapshot({
    provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0,
  } as any);
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.JEV_MEMORY_ENABLED = 'true';
  jevRepo.deleteBranch({ gameId: GAME, branchId: BRANCH });
  jevRepo.deleteBranch({ gameId: OTHER_GAME, branchId: BRANCH });
  jevRepo.deleteBranch({ gameId: GAME, branchId: null });
  jevRepo.deleteBranch({ gameId: OTHER_GAME, branchId: null });
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(over: Partial<FactionMemoryEvent> = {}): FactionMemoryEvent {
  return {
    factionId: 'lavoratori',
    kind: 'favor',
    lever: 'welfare',
    weight: 12,
    turn: 5,
    gameDate: '1951-05-01',
    text: 'Il lavoro ha ottenuto risposte sul welfare.',
    sourceEventId: 'pressure:p1',
    ...over,
  };
}

function factionScope(factionId = 'lavoratori', gameId = GAME, branchId: string | null = BRANCH) {
  return { kind: 'faction' as const, gameId, branchId, factionId };
}

function ctx(over: Partial<{ gameId: string; branchId: string | null; gameDate: string; turn: number }> = {}) {
  return { gameId: GAME, branchId: BRANCH, gameDate: POINT.gameDate, turn: POINT.turn, ...over };
}

describe('JEV-W6 adapter delle fazioni', () => {
  it('mappa ogni kind su un eventType noto, con scope faction e topics dalla leva', () => {
    const expected: Record<FactionMemoryEvent['kind'], string> = {
      favor: 'government_favor', grievance: 'government_grievance', ignored: 'government_grievance',
      promise: 'government_promise', kept: 'government_kept', broken: 'government_broken',
    };
    for (const [kind, eventType] of Object.entries(expected)) {
      const [input] = service.factionMemoryInputs([event({ kind: kind as FactionMemoryEvent['kind'] })], ctx());
      expect(input.scope).toEqual(factionScope());
      expect(input.eventType).toBe(eventType);
      expect((input.metadata as any).topics).toEqual(['welfare']);
    }
  });

  it('namespace l’id della fazione: nessuna collisione con la memoria di governo', () => {
    const [factionInput] = service.factionMemoryInputs([event()], ctx());
    const governmentInput = service.governmentEventInput(event(), ctx());
    expect(factionInput.scope.kind).toBe('faction');
    expect(governmentInput.scope.kind).toBe('government');
    expect((factionInput.metadata as any).eventId).not.toBe((governmentInput.metadata as any).eventId);
    // Forma documentata `faction:<id>:<source>` con le parti codificate.
    expect((factionInput.metadata as any).eventId).toBe('faction:lavoratori:pressure%3Ap1');
  });

  it('salva in entrambe le memorie senza fondere gli store, ed è idempotente', () => {
    const inputs = [
      ...service.factionMemoryInputs([event()], ctx()),
      service.governmentEventInput(event(), ctx()),
    ];
    expect(service.ingestJevBatch(inputs).telemetry.stored).toBe(2);
    // Re-ingestione: gli stessi id aggiornano, non duplicano.
    expect(service.ingestJevBatch(inputs).telemetry.stored).toBe(2);
    expect(jevRepo.listMemory(factionScope())).toHaveLength(1);
    expect(jevRepo.listMemory({ kind: 'government', gameId: GAME, branchId: BRANCH })).toHaveLength(1);
  });
});

describe('JEV-W6 retrieval: una fazione alla volta', () => {
  function seed() {
    service.ingestJevBatch(service.factionMemoryInputs([
      event(),
      event({ factionId: 'militari', kind: 'grievance', lever: 'difesa', weight: -14, text: 'I comandi non gradiscono il taglio alla difesa.', sourceEventId: 'pressure:p2' }),
    ], ctx()));
  }

  it('restituisce solo la memoria della fazione richiesta', () => {
    seed();
    const lav = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    const mil = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'militari', asOf: POINT });
    expect(lav.scopeKey).toBe('faction:lavoratori');
    expect(lav.text).toContain('welfare');
    expect(lav.text).not.toContain('taglio alla difesa');
    expect(mil.text).toContain('taglio alla difesa');
    expect(mil.text).not.toContain('welfare');
  });

  it('non legge altri rami né altri giochi', () => {
    seed();
    expect(service.getFactionMemory({ gameId: GAME, branchId: 'branch-B', factionId: 'lavoratori', asOf: POINT }).text).toBe('');
    expect(service.getFactionMemory({ gameId: OTHER_GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT }).text).toBe('');
  });

  it('esclude il futuro', () => {
    service.ingestJevBatch(service.factionMemoryInputs([
      event({ gameDate: '1951-12-01', turn: 30, sourceEventId: 'future', text: 'FATTO_FUTURO' }),
    ], ctx()));
    const memory = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    expect(memory.text).not.toContain('FATTO_FUTURO');
  });

  it('rispetta il budget e con un tetto irrisorio resta vuoto', () => {
    seed();
    const full = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    expect(full.bytes).toBeGreaterThan(0);
    expect(full.telemetry.token_upper_bound).toBe(full.bytes);
    const tiny = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT, maxTokens: 1 });
    expect(tiny.text).toBe('');
    expect(tiny.bytes).toBeLessThanOrEqual(1);
  });

  it('rispetta il tetto di default `maxFactionContextTokens` senza tagliarlo', () => {
    // Molte memorie lunghe: la sezione resta entro il budget configurato.
    service.ingestJevBatch(service.factionMemoryInputs(Array.from({ length: 12 }, (_, index) => event({
      sourceEventId: `bulk-${index}`, text: `Decisione ${index}: ${'risposta politica '.repeat(20)}`, gameDate: '1951-05-01',
    })), ctx()));
    const memory = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    expect(memory.bytes).toBeGreaterThan(0);
    expect(memory.bytes).toBeLessThanOrEqual(configModule.getJevConfig().maxFactionContextTokens);
  });

  it('non recupera memorie archiviate o superate (eligibleOnly)', () => {
    service.ingestJevBatch(service.factionMemoryInputs([
      event({ sourceEventId: 'attiva', text: 'MEMORIA_ATTIVA' }),
      event({ sourceEventId: 'archiviata', text: 'MEMORIA_ARCHIVIATA', turn: 4, gameDate: '1951-04-01' }),
    ], ctx()));
    db.prepare(`UPDATE jev_memory SET status = 'archived' WHERE scope_key = 'faction:lavoratori' AND source_event_ids_json LIKE '%archiviata%'`).run();
    const memory = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    expect(memory.text).toContain('MEMORIA_ATTIVA');
    expect(memory.text).not.toContain('MEMORIA_ARCHIVIATA');
  });

  it('la pertinenza filtra quando trova un riscontro, altrimenti ripiega sui fatti salienti', () => {
    seed();
    const match = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', query: 'welfare', asOf: POINT });
    expect(match.text).toContain('welfare');
    const fallback = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', query: 'astronautica', asOf: POINT });
    expect(fallback.text).toContain('welfare');
  });

  it('flag off: nessuna sezione e nessun accesso al repository', () => {
    seed();
    process.env.JEV_MEMORY_ENABLED = 'false';
    const list = vi.spyOn(jevRepo, 'listMemory');
    const memory = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', asOf: POINT });
    expect(memory.text).toBe('');
    expect(memory.ids).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('JEV-W6 innesto nel briefing esistente', () => {
  it('senza memoria il blocco del governo resta identico a prima', () => {
    const legacy = governmentPrompts.buildGovernmentStateBlock(snapshot);
    expect(governmentPrompts.buildGovernmentStateBlock(snapshot, null, null)).toBe(legacy);
    expect(governmentPrompts.buildGovernmentStateBlock(snapshot, null, {})).toBe(legacy);
    expect(legacy).not.toContain("Come il governo l'ha trattata");
    // I numeri deterministici restano la fonte.
    expect(legacy).toContain('Coesione del governo');
  });

  it('con la memoria, il blocco la affianca senza sostituire i numeri', () => {
    const factionId = snapshot.factions[0].id;
    const block = governmentPrompts.buildGovernmentStateBlock(snapshot, null, { [factionId]: 'MEMORIA_NARRATIVA_F0' });
    expect(block).toContain("Come il governo l'ha trattata: MEMORIA_NARRATIVA_F0");
    expect(block).toContain('soddisfazione');
  });

  it('la voce della fazione riceve la memoria come contesto', () => {
    const factionId = snapshot.factions[0].id;
    const prompt = governmentPrompts.buildGovernmentVoicePrompt(
      { PLAYER_POLITY: 'Italia', ORIGIN_ROUND_DATE: '1951-06-01' } as any,
      snapshot,
      { [factionId]: 'MEMORIA_NARRATIVA_F0' },
    );
    expect(prompt).toContain(`Memoria di come è stata trattata: MEMORIA_NARRATIVA_F0`);
  });
});

describe('JEV-W6 innesto nel read model', () => {
  function makeCtx() {
    const regions = new Map<string, any>([
      ['r1', { id: 'r1', name: 'Roma', owner: 'PLAYER', color: '#ff0000', population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active' }],
    ]);
    const accounts = { PLAYER: { provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0 } };
    return {
      gameId: GAME,
      players: () => [{ id: 'p1', name: 'Raw', regionId: 'r1', color: '#ff0000', polityId: 'PLAYER' }],
      regions: () => regions,
      playerPolityId: () => 'PLAYER',
      currentDate: () => '1951-06-01',
      currentTurn: () => 6,
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

  it('il read model porta la memoria della fazione quando il flag è attivo', () => {
    const snapshot = governmentCore.governmentSnapshot({ provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0 } as any);
    const factionId = snapshot.factions[0].id;
    service.ingestJevBatch(service.factionMemoryInputs([
      event({ factionId, text: 'MEMORIA_READ_MODEL' }),
    ], { gameId: GAME, branchId: null, gameDate: '1951-06-01', turn: 6 }));
    const data = new gameDataModule.GameDataService(makeCtx() as any).build();
    expect(data.worldState.factionMemory[factionId]).toContain('MEMORIA_READ_MODEL');
  });

  it('il blocco narrativo resta entro il tetto globale, non N volte quello', () => {
    const snap = governmentCore.governmentSnapshot({ provinces: 1, nominalGdpUsdBillions: 100, militaryPower: 10, forces: 0, mobilized: 0 } as any);
    service.ingestJevBatch(snap.factions.flatMap(faction => service.factionMemoryInputs([
      event({ factionId: faction.id, sourceEventId: `cap-${faction.id}`, text: 'memoria politica '.repeat(200) }),
    ], { gameId: GAME, branchId: null, gameDate: '1951-06-01', turn: 6 })));
    const data = new gameDataModule.GameDataService(makeCtx() as any).build();
    const total = Object.values(data.worldState.factionMemory as Record<string, string>)
      .reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0);
    expect(total).toBeLessThanOrEqual(configModule.getJevConfig().maxFactionContextTokens);
  });

  it('flag off: read model senza memoria e senza accesso al repository', () => {
    service.ingestJevBatch(service.factionMemoryInputs([
      event({ text: 'MEMORIA_SPENTA' }),
    ], { gameId: GAME, branchId: null, gameDate: '1951-06-01', turn: 6 }));
    process.env.JEV_MEMORY_ENABLED = 'false';
    const list = vi.spyOn(jevRepo, 'listMemory');
    const data = new gameDataModule.GameDataService(makeCtx() as any).build();
    expect(data.worldState.factionMemory).toEqual({});
    expect(list).not.toHaveBeenCalled();
  });
});
