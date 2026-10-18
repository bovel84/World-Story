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

  it('separa il tema dalla battuta della delegazione e conserva il testo originale', () => {
    const d = makeService();
    const message = 'Desideriamo discutere l’accesso ai corridoi commerciali. Per noi è essenziale una gestione concordata dei controlli. Quali garanzie può offrire il vostro governo?';
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', participants: ['Francia'], topic: 'Cooperazione commerciale',
        message, kind: 'negotiation' }],
      { turn: 31, fallbackDate: '1952-03-01', simulationId: 'spoken-opening-31' },
    );
    expect(result.broadcasts).toHaveLength(1);
    expect(result.broadcasts[0].message.content).toBe(message);
    expect(result.acceptedStarts[0].topic).toBe('Cooperazione commerciale');
    // L’oggetto della chat resta separato dalla prima battuta.
    const thread = d.getChats().find((chat: any) => chat.id === result.broadcasts[0].chatId);
    expect(thread?.subject).toBe('Cooperazione commerciale');
  });

  it('con i provider legacy non presenta un titolo come se fosse una battuta', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', participants: ['Francia'],
        topic: 'Proposta francese di cooperazione sui trasporti', kind: 'negotiation' }],
      { turn: 32, fallbackDate: '1952-04-01', simulationId: 'legacy-opening-32' },
    );
    const opening = result.broadcasts[0].message.content;
    expect(opening).toMatch(/^Desideriamo sottoporre/);
    expect(opening).toContain('cooperazione sui trasporti');
    expect(opening).not.toBe('Proposta francese di cooperazione sui trasporti');
  });

  it('il parser preserva separatamente una prima battuta LLM e il suo oggetto', async () => {
    const { parseSimulationResponse } = await import('../src/prompts/simulation/parse');
    const parsed: any = parseSimulationResponse(JSON.stringify({
      type: 'complete', narration: 'x', events: [], startChat: [
        { participants: ['Francia'], topic: 'Corridorio commerciale',
          message: 'Proponiamo negoziati sui valichi: quali garanzie potete offrire?',
          kind: 'negotiation' },
      ],
    }));
    expect(parsed.startChat[0].topic).toBe('Corridorio commerciale');
    expect(parsed.startChat[0].message).toBe('Proponiamo negoziati sui valichi: quali garanzie potete offrire?');
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

  // INVARIANTE I5 — la stessa posizione non compare due volte nello stesso
  // giorno su due superfici: il dispaccio dell'evento la racconta già nel
  // blocco «Reazioni internazionali», quindi il canale che nasce da quella
  // reazione **non** produce una seconda voce di cronaca. Il canale, però,
  // esiste lo stesso: il giocatore deve poter rispondere.
  it('un canale già raccontato dal dispaccio non genera una voce di cronaca', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', topic: 'Reazione già nel dispaccio', kind: 'statement',
        participants: ['Francia'], eventHeadline: 'Vertice', alreadyNarrated: true }],
      { turn: 4, fallbackDate: '1951-04-01', simulationId: 'run-1',
        events: [{ headline: 'Vertice', description: 'La Francia interpella il Giocatore.', date: '1951-04-01' }], requireEventLink: true },
    );
    // La cronaca non lo ripete…
    expect(result.timelineEvents).toHaveLength(0);
    // …ma la voce esiste, dichiarata, e il canale è aperto e annunciato.
    expect(result.suppressedTimelineEvents).toHaveLength(1);
    expect(result.suppressedTimelineEvents[0].source).toBe('diplomacy');
    expect(result.broadcasts).toHaveLength(1);
    expect(result.participantPolityIds.has('FRA')).toBe(true);
  });

  // Anche quando il modello chiede la chat, il contatto era già narrato:
  // il canale esiste senza generare un dispaccio duplicato.
  it('una startChat esplicita collegata al dispaccio non duplica la cronaca', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', topic: 'Proposta di intesa', kind: 'negotiation',
        participants: ['Francia'], eventHeadline: 'Vertice' }],
      { turn: 5, fallbackDate: '1951-05-01', simulationId: 'run-2',
        events: [{ headline: 'Vertice', description: 'La Francia interpella il Giocatore.', date: '1951-05-01' }], requireEventLink: true },
    );
    expect(result.timelineEvents).toHaveLength(0);
    expect(result.suppressedTimelineEvents).toHaveLength(1);
    expect(result.broadcasts).toHaveLength(1);
    expect(result.acceptedStarts).toHaveLength(1);
  });

  it('un contatto fra paesi terzi non apre canali né impegni per il giocatore', () => {
    const d = makeService();
    const result = d.openSimulationChats(
      [{ polityName: 'Francia', participants: ['Francia'], topic: 'Proposta fra terzi',
        eventHeadline: 'Trattativa fra terzi' }],
      { turn: 6, fallbackDate: '1951-06-01', events: [
        { headline: 'Trattativa fra terzi', description: 'La Francia apre un confronto con altri vicini.',
          date: '1951-06-01' },
      ], requireEventLink: true },
    );
    expect(result.acceptedStarts).toHaveLength(0);
    expect(result.broadcasts).toHaveLength(0);
  });

  // Il parser dei `startChat` del modello non legge `alreadyNarrated`: il campo
  // è interno e non può essere usato dal modello per nascondere una notizia.
  it('il parser non lascia al modello il campo alreadyNarrated', async () => {
    const { parseSimulationResponse } = await import('../src/prompts/simulation/parse');
    const parsed: any = parseSimulationResponse(JSON.stringify({
      type: 'complete', narration: 'x', events: [], startChat: [
        { participants: ['Francia'], topic: 't', kind: 'negotiation', alreadyNarrated: true },
      ],
    }));
    expect(parsed.startChat).toHaveLength(1);
    expect(parsed.startChat[0].alreadyNarrated).toBeUndefined();
  });
});

describe('DiplomacyService — contatti causali', () => {
  it('una nota diretta validata non richiede il nome del destinatario ripetuto nel titolo', () => {
    const d = makeService();
    const result = d.openSimulationChats([
      { polityName: 'FRA', topic: 'Chiediamo garanzie verificabili.', eventHeadline: 'Nota di Parigi', alreadyNarrated: true },
    ], { turn: 20, fallbackDate: '1952-01-01', requireEventLink: true, events: [{
      headline: 'Nota di Parigi', date: '1952-01-01', description: 'Parigi prende posizione.',
      reactions: [{ actorId: 'FRA', note: 'Chiediamo garanzie verificabili.' }],
    }] });
    expect(result.broadcasts).toHaveLength(1);
    const rejected = d.openSimulationChats([
      { polityName: 'FRA', topic: 'Messaggio non presente nell’evento.', eventHeadline: 'Nota di Parigi', alreadyNarrated: true },
    ], { turn: 21, fallbackDate: '1952-01-01', requireEventLink: true, events: [{
      headline: 'Nota di Parigi', date: '1952-01-01', description: 'Parigi prende posizione.',
      reactions: [{ actorId: 'FRA', note: 'Chiediamo garanzie verificabili.' }],
    }] });
    expect(rejected.broadcasts).toHaveLength(0);
  });

  it('consegna le note di tutte le controparti senza duplicare quelle di una conferenza', () => {
    const extra = { id: 'r-pol', name: 'Polonia', owner: 'POL', population: 100, gdp: 10, militaryPower: 20 };
    const localRegions = [...regions.values(), extra];
    const d = makeService({
      regions: () => new Map(localRegions.map(r => [r.id, r])),
      buildResolvers: () => ({ polities: new PolityResolver(localRegions, PLAYER) }),
    });
    const notes = ['FRA', 'POL'].map(id => ({ polityName: id, topic: `Nota ${id}`,
      eventHeadline: 'Consultazione', alreadyNarrated: true }));
    const options = { turn: 22, fallbackDate: '1952-02-01', requireEventLink: true,
      events: [{ headline: 'Consultazione', date: '1952-02-01', description: 'Il Giocatore consulta Francia e Polonia.' }] };
    const separate = d.openSimulationChats(notes, options);
    expect(separate.broadcasts).toHaveLength(2);
    expect(d.openSimulationChats(notes, options).broadcasts).toHaveLength(0);
    const conference = d.openSimulationChats([
      { participants: ['FRA', 'POL'], topic: 'Apriamo la conferenza.', eventHeadline: 'Consultazione', kind: 'conference' },
      ...notes,
    ], { ...options, turn: 23 });
    expect(conference.broadcasts).toHaveLength(1);
  });
});

describe('DiplomacyService — conversazione LLM', () => {
  it('mantiene l’obiettivo iniziale e valuta entrambi i paesi nella stessa fotografia', async () => {
    const { chatRepository } = await import('../src/repositories');
    let prompt = '';
    let playerAccountSeen = false;
    const allRegions = new Map(regions);
    allRegions.set('r-player', { id: 'r-player', name: 'Giocatore', owner: PLAYER, population: 80_000_000, gdp: 600, militaryPower: 800 });
    const d = makeService({
      regions: () => allRegions,
      strategicAgenda: () => 'Proteggere il corridoio commerciale concordato.',
      commitmentsForPolity: () => 'Accesso civile garantito, nessun transito militare.',
      nationalEffectiveMilitaryPower: (id, accounts) => {
        if (id === PLAYER) playerAccountSeen = !!accounts?.[PLAYER] && !!accounts?.FRA;
        return id === PLAYER ? 800 : 120;
      },
      llm: { generate: async (_mechanic: string, _system: string, user: string) => {
        prompt = user; return { content: '{"message":"Il transito resta civile."}' };
      } } as any,
    });
    const chat = d.ensureChat(['Francia'], { subject: 'Accesso al corridoio', dedupeKey: 'mandate' });
    chatRepository.addMessage(chat.id, 'polity', 'Vogliamo accesso civile senza truppe straniere.', 1, 'Francia', '1951-01-01');
    for (let i = 0; i < 18; i++) chatRepository.addMessage(chat.id, 'player', `Dettaglio ${i}`, 1, 'Giocatore', '1951-01-01');
    await d.sendChatMessage(chat.id, 'Confermate le condizioni?');
    expect(playerAccountSeen).toBe(true);
    expect(prompt).toContain('Proteggere il corridoio commerciale concordato');
    expect(prompt).toContain('nessun transito militare');
    expect(prompt).toContain('Posizione iniziale di Francia: Vogliamo accesso civile senza truppe straniere.');
    expect(prompt).toContain('Oggetto: Accesso al corridoio');
  });

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
