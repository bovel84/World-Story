/** Integrazione chat diplomatiche, gruppi, SSE e timeline. */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `open-pax-chats-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let getSessionRegistry: any;
let capturedPrompt = '';
let capturedChatPrompt = '';
let chatReply = 'Accettiamo il patto di non aggressione alle condizioni discusse.';
let stubStartChat: { polityName: string; topic: string }[] = [];
let stubRelationshipChanges: any[] = [];

const WORLD_ID = 'chats_world';

function jumpResponse(): any {
  return {
    events: [
      { headline: 'Vertice di frontiera', description: 'Le delegazioni firmano un protocollo di sicurezza.', date: '1951-02-01', mapChanges: [] },
    ],
    narration: 'Un mese di diplomazia prudente modifica gli equilibri regionali.',
    voided: [],
    startChat: stubStartChat,
    relationshipChanges: stubRelationshipChanges,
    worldChanges: { regionOwners: {}, regionColors: {} },
  };
}

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string, system: string, user: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Azione del giocatore' }) };
    }
    if (mechanic === 'consolidation') return { content: 'SINTESI: storia consolidata' };
    if (mechanic === 'jump') {
      capturedPrompt = `${system}\n${user}`;
      return { content: JSON.stringify(jumpResponse()) };
    }
    if (mechanic === 'chat') {
      if (user.includes('moderatore invisibile')) {
        return { content: JSON.stringify({ speaker: 'Cecoslovacchia' }) };
      }
      capturedChatPrompt = user;
      return { content: JSON.stringify({ message: chatReply }) };
    }
    if (mechanic === 'advisor') return { content: 'Commento del consigliere sul periodo.' };
    return { content: JSON.stringify({ type: 'develop', description: 'Sviluppo', priority: 5 }) };
  },
  async stream(mechanic: string, system: string, user: string, onToken: (chars: number) => void, options?: any) {
    const result = await this.generate(mechanic, system, user, options);
    onToken(result.content.length);
    return result;
  },
  clearCache() {},
};

function createGame(): { gameId: string; session: any } {
  return getSessionRegistry().createSession(WORLD_ID, 'Germania Ovest', `${WORLD_ID}_DEU`, '#FF0000');
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();

  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  const registryModule = await import('../src/session-registry');
  getSessionRegistry = registryModule.getSessionRegistry;

  worldRepository.createWithRegions(
    {
      id: WORLD_ID,
      name: 'Chats World',
      description: '',
      startDate: '1951-01-01',
      basePrompt: 'Lore europeo del dopoguerra',
      historicalAccuracy: 0.8,
      simulationRules: 'Nessuna guerra totale senza escalation.',
    },
    [
      { id: `${WORLD_ID}_DEU`, name: 'Germania Ovest', color: '#FF0000', owner: 'DEU', population: 5000000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${WORLD_ID}_POL`, name: 'Polonia', color: '#00FF00', owner: 'POL', population: 3000000, gdp: 100, militaryPower: 100, flag: 'POL' },
      { id: `${WORLD_ID}_CZE`, name: 'Cecoslovacchia', color: '#0000FF', owner: 'CZE', population: 2000000, gdp: 90, militaryPower: 80, flag: 'CZE' },
    ],
  );

  registryModule.initSessionRegistry(stubProvider);
});

beforeEach(() => {
  capturedPrompt = '';
  capturedChatPrompt = '';
  chatReply = 'Accettiamo il patto di non aggressione alle condizioni discusse.';
  stubStartChat = [];
  stubRelationshipChanges = [];
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* file temporaneo già rimosso */ }
});

describe('Chat diplomatiche', () => {
  it('crea lo schema completo anche su un database nuovo', () => {
    const chatColumns = db.prepare('PRAGMA table_info(chats)').all().map((c: any) => c.name);
    const messageColumns = db.prepare('PRAGMA table_info(chat_messages)').all().map((c: any) => c.name);
    expect(chatColumns).toContain('participants');
    expect(chatColumns).toContain('participant_key');
    expect(messageColumns).toContain('sender_name');
    expect(messageColumns).toContain('game_date');
  });

  it('salva messaggio e risposta strutturata con data, contesto e unread', async () => {
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);

    expect(chat.polityId).toBe('POL');
    expect(chat.participants.map((p: any) => p.role)).toEqual(['player', 'polity']);
    expect(session.ensureChat(['Polonia']).id).toBe(chat.id);

    const { message, reply } = await session.sendChatMessage(chat.id, 'Proponiamo un patto di non aggressione');
    expect(message.content).toContain('patto');
    expect(message.gameDate).toBe('1951-01-01');
    expect(reply.content).toBe(chatReply);
    expect(reply.senderName).toBe('Polonia');
    expect(reply.gameDate).toBe('1951-01-01');
    expect(capturedChatPrompt).toContain('Proponiamo un patto di non aggressione');
    expect(capturedChatPrompt).toContain('Lore europeo del dopoguerra');
    expect(capturedChatPrompt).toContain('[Difficoltà: Normale]');
    expect(capturedChatPrompt).toContain('Personalità politica');

    expect(session.getChats()[0].lastMessage).toBe(chatReply);
    expect(session.getChats()[0].unread).toBe(1);
    session.markChatRead(chat.id);
    expect(session.getChats()[0].unread).toBe(0);
  });

  it('supporta gruppi sovrapposti e fa scegliere al modello il prossimo interlocutore', async () => {
    const { session } = createGame();
    const direct = session.ensureChat(['Polonia']);
    const group = session.ensureChat(['Polonia', 'Cecoslovacchia']);

    expect(group.id).not.toBe(direct.id);
    expect(group.participants).toHaveLength(3); // giocatore + due nazioni
    const { replies } = await session.continueChat(group.id, 1);
    expect(replies).toHaveLength(1);
    expect(replies[0].senderName).toBe('Cecoslovacchia');
  });

  it('rifiuta una politia inesistente e la nazione del giocatore', () => {
    const { session } = createGame();
    expect(() => session.ensureChat(['Atlantide'])).toThrow(/not found/);
    expect(() => session.ensureChat(['Germania Ovest'])).toThrow(/not found/);
  });

  it('crea una chat avviata dalla simulazione e la trasmette via SSE', async () => {
    stubStartChat = [{ polityName: 'Polonia', topic: 'Chiediamo un negoziato urgente sulla frontiera.' }];
    const { session } = createGame();
    const sseEvents: { type: string; data: any }[] = [];
    session.setSSEBroadcaster((type: any, data: any) => sseEvents.push({ type, data }));

    session.queueAction('Rafforzare la frontiera');
    await session.processNextAction(30);

    const chat = session.getChats()[0];
    const messages = session.getChatMessages(chat.id);
    expect(messages[0].content).toContain('negoziato urgente');
    expect(messages[0].senderName).toBe('Polonia');
    expect(messages[0].gameDate).toBe('1951-01-31');
    expect(sseEvents.find(e => e.type === 'chat_message')?.data.chatId).toBe(chat.id);
    expect(session.getTimeline().flatMap((entry: any) => entry.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'diplomacy', chatId: chat.id, date: '1951-01-31' }),
    ]));
  });

  it('rewind ripristina le chat del checkpoint e rimuove i messaggi futuri', async () => {
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);
    session.queueAction('Osservare il confine');
    await session.processNextAction(30);
    await session.sendChatMessage(chat.id, 'Questo messaggio appartiene al futuro del ramo.');
    expect(session.getChatMessages(chat.id)).not.toHaveLength(0);

    session.rewind();

    const restoredChat = session.getChats().find((item: any) => item.id === chat.id);
    expect(restoredChat).toBeTruthy();
    expect(session.getChatMessages(chat.id)).toHaveLength(0);
  });

  it('inietta le trattative nel salto e applica i cambi di relazione', async () => {
    stubRelationshipChanges = [{ from: 'Germania Ovest', to: 'Polonia', relationship: 'ally', reason: 'Patto concluso' }];
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);
    await session.sendChatMessage(chat.id, 'Concludiamo un trattato di difesa comune');

    session.queueAction('Sviluppare l’economia');
    await session.processNextAction(30);

    expect(capturedPrompt).toContain('Trattative con Polonia');
    expect(capturedPrompt).toContain('trattato di difesa comune');
    expect(session.getRelationships().DEU.POL).toBe('ally');
  });

  it('isola le relazioni di due partite dello stesso mondo', async () => {
    stubRelationshipChanges = [{ from: 'Germania Ovest', to: 'Polonia', relationship: 'ally', reason: 'Patto della prima partita' }];
    const first = createGame();
    first.session.queueAction('Concludere un patto con la Polonia');
    await first.session.processNextAction(30);
    expect(first.session.getRelationships().DEU.POL).toBe('ally');

    const second = createGame();
    expect(second.session.getRelationships().DEU?.POL).not.toBe('ally');
  });

  it('espone una timeline con dettagli simulati ed eventi diplomatici chiave', async () => {
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);
    await session.sendChatMessage(chat.id, 'Proponiamo un trattato commerciale');
    session.queueAction('Osservare il mondo');
    await session.processNextAction(31); // Includes the summit on February 1

    const timeline = session.getTimeline();
    const events = timeline.flatMap((entry: any) => entry.events);
    expect(events.some((event: any) => event.headline === 'Vertice di frontiera'
      && event.detail.includes('protocollo di sicurezza')
      && event.date === '1951-02-01')).toBe(true);
    // Un semplice testo in chat non è un evento diplomatico: servono
    // apertura chat o relationshipChange emessi e committati dal simulatore.
    expect(events.some((event: any) => event.source === 'diplomacy'
      && event.detail.includes('trattato commerciale'))).toBe(false);
  });

  it('trasmette il commento proattivo del consigliere dopo il turno', async () => {
    const { session } = createGame();
    const sseEvents: { type: string; data: any }[] = [];
    session.setSSEBroadcaster((type: any, data: any) => sseEvents.push({ type, data }));

    session.queueAction('Osservare il mondo');
    await session.processNextAction(30);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(sseEvents.find(e => e.type === 'advisor_proactive')?.data.content)
      .toBe('Commento del consigliere sul periodo.');
  });
});
