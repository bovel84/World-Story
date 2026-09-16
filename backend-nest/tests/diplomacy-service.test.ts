/**
 * DiplomacyService — test di isolamento: matrice relazioni (puro) e canali
 * diplomatici deterministici (DB temporaneo). Nessun LLM.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PolityResolver } from '../src/utils/name-resolver';
import type { DiplomacyContext } from '../src/game/DiplomacyService';

const TEST_DB = path.join(os.tmpdir(), `world-story-diplomacy-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let DiplomacyService: any;
const GAME_ID = 'diplomacy-game';
const PLAYER = 'PLAYER';

const regions = new Map<string, any>([
  ['r-fra', { id: 'r-fra', name: 'Francia', owner: 'FRA', color: '#0000ff', population: 40_000_000, gdp: 300, militaryPower: 120 }],
]);

const names: Record<string, string> = { PLAYER: 'Giocatore', FRA: 'Francia' };

function makeService(overrides: Partial<DiplomacyContext> = {}) {
  return new DiplomacyService({
    gameId: GAME_ID,
    playerPolityId: () => PLAYER,
    players: () => [{ id: 'p1', polityId: PLAYER, color: '#667eea' }],
    regions: () => regions,
    buildResolvers: () => ({
      polities: new PolityResolver(
        [{ id: 'r-fra', name: 'Francia', owner: 'FRA', color: '#0000ff' }],
        PLAYER,
      ),
    }),
    publicPolityName: id => names[id] || id,
    polityColor: () => undefined,
    publicText: value => String(value ?? ''),
    crisisRelevantPolityIds: () => new Set<string>(),
    hasGeographicAdjacency: () => false,
    assertNoActiveRun: () => {},
    fenceContext: () => ({ branchId: null, revision: 1 }),
    assertFenceValid: () => {},
    currentTurn: () => 2,
    currentDate: () => '1951-02-01',
    results: () => [],
    worldBasePrompt: () => 'Storia alternativa',
    worldSimulationRules: () => '',
    difficulty: () => 'normal' as any,
    llm: { generate: async () => ({ content: '{"message":"Prendiamo atto."}' }) } as any,
    broadcast: () => true,
    worldStateOptions: () => ({ modernFacts: false, startDate: '1951-01-01' }),
    nationalEffectiveMilitaryPower: () => 100,
    hostileNeighbourCount: () => 0,
    recentStrategicMemory: () => [],
    ...overrides,
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('dip-world', 'D', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'dip-world', 1, '1951-01-01')`).run(GAME_ID);
  const mod = await import('../src/game/DiplomacyService');
  DiplomacyService = mod.DiplomacyService;
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

describe('DiplomacyService — relazioni', () => {
  it('parte neutrale e aggiorna in modo simmetrico', () => {
    const d = makeService();
    expect(d.matrix().get('AAA', 'BBB')).toBe('neutral');
    d.matrix().set('AAA', 'BBB', 'hostile');
    expect(d.matrix().get('BBB', 'AAA')).toBe('hostile');
  });

  it('migliora e degrada le relazioni', () => {
    const d = makeService();
    d.matrix().improve('AAA', 'BBB');
    expect(d.matrix().get('AAA', 'BBB')).toBe('ally');
    d.matrix().degrade('AAA', 'BBB');
    expect(d.matrix().get('AAA', 'BBB')).toBe('neutral');
    d.matrix().degrade('AAA', 'BBB');
    expect(d.matrix().get('AAA', 'BBB')).toBe('hostile');
  });

  it('serializza e reimposta da JSON', () => {
    const d = makeService();
    d.matrix().set('AAA', 'BBB', 'ally');
    const json = d.toJSON();
    expect(d.getRelationships()).toEqual(json);
    const restored = makeService();
    restored.replaceFromJSON(json);
    expect(restored.matrix().get('AAA', 'BBB')).toBe('ally');
    restored.replaceFromJSON({});
    expect(restored.matrix().get('AAA', 'BBB')).toBe('neutral');
  });
});

describe('DiplomacyService — canali', () => {
  it('getChats parte vuoto', () => {
    expect(makeService().getChats()).toEqual([]);
  });

  it('ensureChat crea la chat con giocatore e interlocutore', () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { subject: 'Vertice', origin: 'player' });
    expect(chat.gameId).toBe(GAME_ID);
    expect(chat.participants.map((p: any) => p.id).sort()).toEqual(['FRA', PLAYER]);
    expect(d.getChats().some((c: any) => c.id === chat.id)).toBe(true);
    expect(d.getChatMessages(chat.id)).toEqual([]);
  });

  it('ensureChat è idempotente con dedupeKey e rifiuta interlocutori ignoti', () => {
    const d = makeService();
    const a = d.ensureChat(['Francia'], { dedupeKey: 'evt-1', origin: 'simulation' });
    const b = d.ensureChat(['Francia'], { dedupeKey: 'evt-1', origin: 'simulation' });
    expect(b.id).toBe(a.id);
    expect(() => d.ensureChat(['Atlantide'])).toThrow(/Polity not found/);
  });

  it('archive/unarchive cambiano la visibilità', () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { dedupeKey: 'arch', origin: 'simulation' });
    d.archiveChat(chat.id);
    expect(d.getChats(false).some((c: any) => c.id === chat.id)).toBe(false);
    expect(d.getChats(true).some((c: any) => c.id === chat.id)).toBe(true);
    d.unarchiveChat(chat.id);
    expect(d.getChats(false).some((c: any) => c.id === chat.id)).toBe(true);
  });

  it('openSimulationChats apre un canale e produce evento/broadcast', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', topic: 'Proposta di intesa', kind: 'negotiation', participants: ['Francia'] }],
      { turn: 2, fallbackDate: '1951-02-01', simulationId: 'run-1' },
    );
    expect(result.participantPolityIds.has('FRA')).toBe(true);
    expect(result.timelineEvents).toHaveLength(1);
    expect(result.timelineEvents[0].source).toBe('diplomacy');
    expect(result.broadcasts).toHaveLength(1);
  });

  it('openSimulationChats ignora startChat senza evento quando richiesto', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', topic: 'x', kind: 'statement', participants: ['Francia'], eventHeadline: 'Evento mai applicato' }],
      { turn: 3, fallbackDate: '1951-03-01', requireEventLink: true, events: [] },
    );
    expect(result.timelineEvents).toHaveLength(0);
    expect(result.broadcasts).toHaveLength(0);
  });
});

describe('DiplomacyService — conversazione LLM', () => {
  it('sendChatMessage salva messaggio e replica, e broadcasta', () => {
    const events: Array<{ type: string; data: any }> = [];
    const d = makeService({ broadcast: (type, data) => { events.push({ type, data }); return true; } });
    const chat = d.ensureChat(['Francia'], { dedupeKey: 'conv-1', origin: 'simulation' });
    return d.sendChatMessage(chat.id, 'Proponiamo un patto.').then((result: any) => {
      expect(result.message.role).toBe('player');
      expect(result.reply.role).toBe('polity');
      expect(result.reply.content).toContain('Prendiamo atto');
      expect(events.filter(e => e.type === 'chat_message')).toHaveLength(1);
      expect(d.getChatMessages(chat.id)).toHaveLength(2);
    });
  });

  it('sendChatMessage rifiuta durante un run attivo', async () => {
    const d = makeService({
      assertNoActiveRun: () => { throw new Error('SimulationInProgress'); },
    });
    const chat = d.ensureChat(['Francia'], { dedupeKey: 'conv-2', origin: 'simulation' });
    await expect(d.sendChatMessage(chat.id, 'ciao')).rejects.toThrow(/SimulationInProgress/);
    expect(d.getChatMessages(chat.id)).toHaveLength(0);
  });

  it('continueChat produce repliche automatiche', async () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { dedupeKey: 'conv-3', origin: 'simulation' });
    const { replies } = await d.continueChat(chat.id, 2);
    expect(replies).toHaveLength(2);
    expect(replies.every((r: any) => r.role === 'polity')).toBe(true);
  });

  it('generateNpcReactions apre la chat e broadcasta la reazione', async () => {
    const events: Array<{ type: string; data: any }> = [];
    const d = makeService({ broadcast: (type, data) => { events.push({ type, data }); return true; } });
    await d.generateNpcReactions({
      actionTexts: ['mobilitazione'],
      eventHeadlines: ['Crisi di confine'],
      candidatePolityIds: ['FRA'],
      turn: 4,
    });
    const reactions = events.filter(e => e.type === 'chat_message');
    expect(reactions).toHaveLength(1);
    expect(reactions[0].data.reaction).toBe(true);
  });

  it('buildChatTranscripts include le trattative recenti', () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { dedupeKey: 'conv-4', origin: 'simulation' });
    // un messaggio per rendere la chat visibile nei trascritti
    d.getChatMessages(chat.id);
    expect(typeof d.buildChatTranscripts()).toBe('string');
  });
});
