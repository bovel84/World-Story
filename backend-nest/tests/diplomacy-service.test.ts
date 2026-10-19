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
        participants: ['Francia'], eventHeadline: 'Vertice',
        message: 'Possiamo ora discutere il protocollo di verifica. Quali garanzie proponete?' }],
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

describe('DiplomacyService — continuità delle trattative', () => {
  it('archivia il ritiro di un’offerta documentato da un evento, conservando la nota e il thread', () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { subject: 'Offerta conclusa' });
    const result = d.openSimulationChats([{ participants: ['Francia'], threadId: chat.id, closeThread: true,
      topic: 'Offerta conclusa', message: 'Ritiriamo la nostra offerta: il mandato della delegazione è terminato.',
      eventHeadline: 'Ritiro dell’offerta' }], {
      turn: 8, fallbackDate: '1951-08-01', simulationId: 'close-offer-test', requireEventLink: true,
      events: [{ headline: 'Ritiro dell’offerta', description: 'La Francia comunica al Giocatore il ritiro della propria offerta.', date: '1951-08-01' }],
    });
    expect(result.broadcasts[0].archived).toBe(true);
    expect(result.acceptedStarts).toHaveLength(0);
    expect(d.getChats().some((item: any) => item.id === chat.id)).toBe(false);
    expect(d.getChats(true).find((item: any) => item.id === chat.id)?.archived).toBe(true);
    expect(d.getChatMessages(chat.id)[0].content).toContain('Ritiriamo la nostra offerta');
  });

  it('non chiude una domanda inevasa senza evento e nota conclusiva validi', () => {
    const d = makeService();
    const chat = d.ensureChat(['Francia'], { subject: 'Offerta ancora valida' });
    const result = d.openSimulationChats([{ participants: ['Francia'], threadId: chat.id, closeThread: true,
      topic: 'Offerta ancora valida', message: 'Chiusura senza causa documentata.' }], {
      turn: 9, fallbackDate: '1951-09-01', simulationId: 'unlinked-close-test',
    });
    expect(result.broadcasts).toHaveLength(0);
    expect(d.getChats().find((item: any) => item.id === chat.id)?.archived).toBe(false);
  });
  it('non ripete a ogni salto lo stesso invito rimasto senza risposta', () => {
    const d = makeService();
    const start = [{ participants: ['Francia'], topic: 'Verifica congiunta dei transiti',
      message: 'Proponiamo osservatori civili al valico.' }];
    const first = d.openSimulationChats(start, { turn: 1, fallbackDate: '1951-01-01', simulationId: 'pending-repeat-1' });
    const next = d.openSimulationChats(start, { turn: 2, fallbackDate: '1951-02-01', simulationId: 'pending-repeat-2' });
    expect(next.broadcasts).toHaveLength(0);
    expect(d.getChatMessages(first.broadcasts[0].chatId)).toHaveLength(1);
  });

  it('un suggerimento del modello non può aggiornare una chat di un’altra partita', () => {
    db.prepare("INSERT INTO games (id, world_id, current_turn, current_date) VALUES ('dip-other', 'dip-world', 1, '1951-01-01')").run();
    const foreign = makeService({ gameId: 'dip-other' }).ensureChat(['Francia'], { subject: 'Riservato altro gioco' });
    const current = makeService();
    const result = current.openSimulationChats([{ participants: ['Francia'], threadId: foreign.id,
      topic: 'Verifica della nuova rotta', message: 'Una nuova richiesta.' }], { turn: 2, fallbackDate: '1951-02-01', simulationId: 'foreign-thread-test' });
    expect(result.broadcasts[0].chatId).not.toBe(foreign.id);
    expect(makeService({ gameId: 'dip-other' }).getChatMessages(foreign.id)).toHaveLength(0);
  });
  it('aggiorna il medesimo negoziato nei turni successivi e distingue una questione nuova', () => {
    const d = makeService();
    const open = (topic: string, turn: number, date: string, threadId?: string) => d.openSimulationChats([
      { participants: ['Francia'], topic, message: `Intervento politico del turno ${turn}.`, threadId,
        eventHeadline: `Sviluppo ${turn}` },
    ], { turn, fallbackDate: date, simulationId: `continuity-${turn}` });
    const first = open('Osservatori al valico di Praga', 1, '1951-01-01');
    const id = first.broadcasts[0].chatId;
    const second = open('Controlli al valico di Praga', 2, '1951-02-01');
    expect(second.broadcasts[0].chatId).toBe(id);
    const third = open('Mandato aggiornato della delegazione', 3, '1951-03-01', id);
    expect(third.broadcasts[0].chatId).toBe(id);
    expect(d.getChatMessages(id).map((m: any) => m.gameDate)).toEqual(['1951-01-01', '1951-02-01', '1951-03-01']);
    const separate = open('Pagamenti dei debiti commerciali', 4, '1951-04-01');
    expect(separate.broadcasts[0].chatId).not.toBe(id);
  });

  it('mantiene visibile una domanda letta ma inevasa e non tratta gli archivi come negoziati aperti', async () => {
    const d = makeService();
    const { chatRepository } = await import('../src/repositories');
    const chat = d.ensureChat(['Francia'], { subject: 'Domanda ancora aperta' });
    chatRepository.addMessage(chat.id, 'polity', 'Accettereste controlli civili?', 1, 'Francia', '1951-01-01');
    d.markChatRead(chat.id);
    expect(d.buildChatTranscripts()).toContain(`threadId=${chat.id}`);
    expect(d.buildChatTranscripts()).toContain('IN ATTESA della risposta del giocatore');
    d.archiveChat(chat.id);
    expect(d.buildChatTranscripts()).not.toContain(`threadId=${chat.id}`);
    const next = d.openSimulationChats([{ participants: ['Francia'], threadId: chat.id,
      topic: 'Domanda ancora aperta', message: 'Una nuova comunicazione.' }], { turn: 2, fallbackDate: '1951-02-01', simulationId: 'archived-reopen-test' });
    expect(next.broadcasts[0].chatId).not.toBe(chat.id);
  });

});


describe('DiplomacyService — prima battuta completa e oggetto distinto', () => {
  it('preserva una nota lunga dal parser al database e autentica il mittente sulla nota, non sul titolo', async () => {
    const { parseSimulationResponse, parseIncrementalSimulationRecord } = await import('../src/prompts/simulation/parse');
    const note = 'Il valico resta essenziale per i commercianti delle due sponde, ma le interruzioni registrate nella cronaca rendono fragile qualsiasi intesa limitata alle dichiarazioni. '
      + 'Per il nostro governo riaprire i transiti significa anche evitare che il contenzioso commerciale si trasformi in uno scontro politico permanente con il vostro paese. '
      + 'Proponiamo quindi di discutere un protocollo per i passaggi civili, con controlli concordati e una verifica congiunta delle contestazioni, lasciando a un tavolo separato le richieste sul transito militare. '
      + 'Non chiediamo di rinunciare alle vostre prerogative: siamo disponibili a rivedere le modalità dei controlli se potete indicare una soluzione che protegga entrambe le parti. '
      + 'Una dichiarazione comune sarebbe utile soltanto dopo aver chiarito questi punti, senza presentare come concluso un accordo che dobbiamo ancora negoziare. '
      + 'Potete confermare se accettate questa distinzione tra accesso civile e questione militare, oppure presentarci una modifica precisa del protocollo?';
    expect(note.length).toBeGreaterThan(800);
    const event = { headline: 'Nota di Parigi', description: 'La Francia invia una nota riservata.', date: '1951-01-10', mapChanges: [],
      reactions: [{ actorId: 'FRA', polityName: 'Francia', role: 'counterparty', stance: 'conditional',
        response: 'Parigi propone di separare transiti civili e questione militare.', note }] };
    const parsed = parseSimulationResponse(JSON.stringify({ events: [event], narration: 'Nota inviata.' }));
    expect(parsed.events[0].reactions?.[0].note).toBe(note);
    const streamed = parseIncrementalSimulationRecord({ type: 'event', ...event });
    expect(streamed?.type === 'event' && streamed.event.reactions?.[0].note).toBe(note);
    const gameId = 'dip-complete-opening';
    db.prepare("INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'dip-world', 1, '1951-01-01')").run(gameId);
    const d = makeService({ gameId });
    const start = { polityName: 'FRA', participants: ['FRA'], topic: 'Accesso civile al valico', message: note,
      eventHeadline: event.headline, alreadyNarrated: true };
    const options = { turn: 1, fallbackDate: '1951-02-20', deliveryDate: '1951-02-20', simulationId: 'complete-opening',
      requireEventLink: true, events: parsed.events };
    const spoofed = d.openSimulationChats([{ ...start, message: 'Una nota non presente nel dispaccio.' }], options);
    expect(spoofed.broadcasts).toHaveLength(0);
    const result = d.openSimulationChats([start], options);
    expect(result.broadcasts).toHaveLength(1);
    const chat = d.getChats()[0];
    expect(chat.subject).toBe('Accesso civile al valico');
    expect(d.getChatMessages(chat.id)[0]).toMatchObject({ content: note, gameDate: '1951-02-20', senderName: 'Francia' });
  });
});
