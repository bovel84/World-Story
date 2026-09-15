/** Integrazione chat diplomatiche, gruppi, SSE e timeline. */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-chats-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let getSessionRegistry: any;
let capturedPrompt = '';
let capturedChatPrompt = '';
let chatReply = 'Accettiamo il patto di non aggressione alle condizioni discusse.';
let chatShouldFail = false;
let stubStartChat: Array<{
  polityName?: string;
  participants?: string[];
  topic: string;
  kind?: 'meeting' | 'summit' | 'negotiation' | 'conference' | 'ultimatum' | 'technical' | 'statement';
  eventHeadline?: string;
}> = [];
let stubEventReactions: Array<{
  polityName: string;
  role: 'counterparty' | 'ally' | 'mediator' | 'observer';
  stance: 'supportive' | 'opposed' | 'conditional' | 'neutral';
  response: string;
  counterAction?: string;
  note?: string;
}> = [];
let stubRelationshipChanges: any[] = [];

const WORLD_ID = 'chats_world';

function jumpResponse(): any {
  return {
    events: [
      { headline: 'Vertice di frontiera', description: 'Le delegazioni discutono un protocollo di sicurezza.', date: '1951-02-01', mapChanges: [], reactions: stubEventReactions },
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
      if (chatShouldFail) throw new Error('modello free temporaneamente non disponibile');
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
  chatShouldFail = false;
  stubStartChat = [];
  stubEventReactions = [];
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

  it('un evento auto-jump apre una riunione con tutte le nazioni coinvolte', async () => {
    stubStartChat = [{
      participants: ['Polonia', 'Cecoslovacchia'],
      topic: 'Convocazione urgente per concordare osservatori e regole comuni lungo la frontiera.',
      kind: 'meeting',
      eventHeadline: 'Vertice di frontiera',
    }];
    const { session } = createGame();
    const sseEvents: { type: string; data: any }[] = [];
    session.setSSEBroadcaster((type: any, data: any) => sseEvents.push({ type, data }));

    session.queueAction('Convocare consultazioni con i vicini');
    await session.processNextAction(0);

    const chat = session.getChats()[0];
    expect(chat.participants.filter((p: any) => p.role === 'polity').map((p: any) => p.id))
      .toEqual(['POL', 'CZE']);
    const firstMessage = session.getChatMessages(chat.id)[0];
    expect(firstMessage.senderName).toBe('Polonia');
    expect(firstMessage.gameDate).toBe('1951-02-01');
    expect(firstMessage.content).toContain('osservatori');
    expect(sseEvents.find(e => e.type === 'chat_message')?.data).toEqual(expect.objectContaining({
      chatId: chat.id,
      meetingKind: 'meeting',
      eventHeadline: 'Vertice di frontiera',
    }));
    expect(session.getTimeline().flatMap((entry: any) => entry.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'diplomacy',
        chatId: chat.id,
        date: '1951-02-01',
        headline: expect.stringContaining('riunione multilaterale'),
      }),
    ]));
    // Coerenza dei soggetti: la riunione è fra Polonia e Cecoslovacchia e il
    // dispaccio non deve farvi comparire anche la nazione del giocatore.
    const meetingEvent = session.getTimeline().flatMap((entry: any) => entry.events)
      .find((event: any) => event.chatId === chat.id);
    expect(meetingEvent.detail).toContain('prendono parte Polonia, Cecoslovacchia.');
    expect(meetingEvent.detail).not.toContain('Germania');
  });

  it('rende visibili le reazioni autonome e apre i canali delle controparti', async () => {
    stubEventReactions = [
      {
        polityName: 'Polonia',
        role: 'counterparty',
        stance: 'opposed',
        response: 'Varsavia respinge il dispositivo unilaterale e chiede il ritiro delle unità avanzate.',
      },
      {
        polityName: 'Cecoslovacchia',
        role: 'mediator',
        stance: 'conditional',
        response: 'Praga offre una missione di osservazione soltanto con mandato concordato da entrambe le parti.',
      },
    ];
    const { session } = createGame();
    const sseEvents: { type: string; data: any }[] = [];
    session.setSSEBroadcaster((type: any, data: any) => sseEvents.push({ type, data }));

    session.queueAction('Imporre un dispositivo di frontiera alla Polonia con mediazione cecoslovacca');
    await session.processNextAction(0);

    const chats = session.getChats();
    expect(chats.map((chat: any) => chat.polityId).sort()).toEqual(['CZE', 'POL']);
    expect(session.getChatMessages(chats.find((chat: any) => chat.polityId === 'POL').id)[0].content)
      .toContain('respinge');
    expect(session.getChatMessages(chats.find((chat: any) => chat.polityId === 'CZE').id)[0].content)
      .toContain('mandato concordato');
    const worldEvent = session.getTimeline().flatMap((entry: any) => entry.events)
      .find((event: any) => event.headline === 'Vertice di frontiera');
    expect(worldEvent.detail).toContain('Reazioni internazionali:');
    expect(worldEvent.detail).toContain('Polonia si dichiara contraria');
    expect(worldEvent.detail).toContain('Cecoslovacchia si dichiara condizionata');
    expect(sseEvents.filter(event => event.type === 'chat_message')).toHaveLength(2);
  });

  it('la chat apre con la nota diretta della nazione, non col dispaccio di cronaca', async () => {
    stubEventReactions = [{
      polityName: 'Polonia',
      role: 'counterparty',
      stance: 'opposed',
      response: 'Varsavia ordina il richiamo delle riserve e riorienta le uscite verso la difesa.',
      counterAction: 'Mobilitazione del Gruppo tattico Vistola nel territorio polacco.',
      note: 'Non accettiamo il vostro dispositivo di frontiera: ritirate le unità avanzate e torniamo a parlare.',
    }];
    const { session } = createGame();
    session.queueAction('Imporre un dispositivo di frontiera alla Polonia');
    await session.processNextAction(0);

    const chat = session.getChats().find((item: any) => item.polityId === 'POL');
    expect(chat).toBeTruthy();
    const first = session.getChatMessages(chat.id)[0];
    // Messaggio in prima persona della controparte…
    expect(first.content).toContain('Non accettiamo il vostro dispositivo');
    // …e niente etichette da bollettino né il testo di cronaca.
    expect(first.content).not.toContain('Misura annunciata');
    expect(first.content).not.toContain('Varsavia ordina il richiamo');
  });

  it('senza nota usa la decisione, senza l’etichetta «Misura annunciata»', async () => {
    stubEventReactions = [{
      polityName: 'Polonia',
      role: 'counterparty',
      stance: 'opposed',
      response: 'Varsavia respinge il dispositivo unilaterale.',
      counterAction: 'Richiamo delle riserve di confine.',
    }];
    const { session } = createGame();
    session.queueAction('Imporre un dispositivo di frontiera alla Polonia');
    await session.processNextAction(0);

    const chat = session.getChats().find((item: any) => item.polityId === 'POL');
    const first = session.getChatMessages(chat.id)[0];
    expect(first.content).toContain('respinge');
    expect(first.content).toContain('Richiamo delle riserve');
    expect(first.content).not.toContain('Misura annunciata');
  });

  it('genera una reazione fallback quando il provider omette reactions', async () => {
    const { session } = createGame();
    session.queueAction('Inviare un ultimatum alla Polonia');

    await session.processNextAction(0);

    await vi.waitFor(() => {
      const chat = session.getChats().find((item: any) => item.polityId === 'POL');
      expect(chat).toBeTruthy();
      expect(session.getChatMessages(chat.id)[0].content).toBe(chatReply);
    });
  });

  it('usa una presa d’atto prudente se il modello free fallisce nella reazione fallback', async () => {
    chatShouldFail = true;
    const { session } = createGame();
    session.queueAction('Inviare una richiesta formale alla Polonia');

    await session.processNextAction(0);

    await vi.waitFor(() => {
      const chat = session.getChats().find((item: any) => item.polityId === 'POL');
      expect(chat).toBeTruthy();
      expect(session.getChatMessages(chat.id)[0].content.toLowerCase()).toContain('non considera concluso alcun accordo');
      expect(session.getChatMessages(chat.id)[0].content).toContain('priorità');
    });
  });

  it('apre una nuova discussione con la stessa nazione e archivia la precedente', async () => {
    const { session } = createGame();
    const first = session.ensureChat(['Polonia']);
    await session.sendChatMessage(first.id, 'Proponiamo un patto di non aggressione.');

    // La prima discussione ha ormai un contenuto: una nuova apertura è una
    // discussione nuova, non la continuazione della precedente.
    const second = session.ensureChat(['Polonia']);
    expect(second.id).not.toBe(first.id);
    expect(session.getChats().map((c: any) => c.id)).toEqual([second.id]);
    expect(session.getChats(true).map((c: any) => c.id).sort())
      .toEqual([first.id, second.id].sort());
    expect(session.getChats(true).find((c: any) => c.id === first.id)?.archived).toBe(true);
    // La discussione archiviata resta consultabile con i suoi messaggi.
    expect(session.getChatMessages(first.id)).not.toHaveLength(0);
  });

  it('riapre una bozza ancora vuota invece di moltiplicare le chat', () => {
    const { session } = createGame();
    const a = session.ensureChat(['Polonia']);
    const b = session.ensureChat(['Polonia']);
    expect(b.id).toBe(a.id);
    expect(session.getChats()).toHaveLength(1);
  });

  it('archivia e riapre una discussione su comando', async () => {
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);
    await session.sendChatMessage(chat.id, 'Nota diplomatica riservata.');

    session.archiveChat(chat.id);
    expect(session.getChats()).toHaveLength(0);
    expect(session.getChats(true).find((c: any) => c.id === chat.id)?.archived).toBe(true);

    session.unarchiveChat(chat.id);
    expect(session.getChats().map((c: any) => c.id)).toContain(chat.id);
  });

  it('ogni turno di reazioni apre una nuova discussione e archivia la precedente', async () => {
    const { session } = createGame();
    session.queueAction('Chiedere spiegazioni formali alla Polonia');
    await session.processNextAction(0);
    await vi.waitFor(() => {
      expect(session.getChats().some((c: any) => c.polityId === 'POL')).toBe(true);
    });
    const first = session.getChats().find((c: any) => c.polityId === 'POL');

    session.queueAction('Inviare una nuova richiesta alla Polonia');
    await session.processNextAction(30);
    await vi.waitFor(() => {
      const active = session.getChats().find((c: any) => c.polityId === 'POL');
      expect(active?.id).toBeTruthy();
      expect(active?.id).not.toBe(first.id);
    });
    // La discussione del turno precedente è archiviata, non cancellata.
    expect(session.getChats(true).find((c: any) => c.id === first.id)?.archived).toBe(true);
    expect(session.getChatMessages(first.id)).not.toHaveLength(0);
  });

  it('non apre in auto-jump una chat collegata a un evento non applicato', async () => {
    stubStartChat = [{
      participants: ['Polonia', 'Cecoslovacchia'],
      topic: 'Discussione riferita a un futuro che non è entrato nel mondo.',
      kind: 'conference',
      eventHeadline: 'Evento futuro scartato',
    }];
    const { session } = createGame();
    session.queueAction('Osservare gli sviluppi diplomatici');

    await session.processNextAction(0);

    expect(session.getChats()).toHaveLength(0);
  });

  it('lo stile diplomatico vieta cifre e statistiche e limita i presenti', async () => {
    const { session } = createGame();
    const chat = session.ensureChat(['Polonia']);

    await session.sendChatMessage(chat.id, 'Proponiamo un patto di non aggressione.');

    // Stile naturale: nessuna cifra o metrica nei messaggi.
    expect(capturedChatPrompt).toContain('NON citare cifre, percentuali, punteggi');
    expect(capturedChatPrompt).toContain('giudizi politici naturali');
    // Coerenza: solo i partecipanti reali possono parlare.
    expect(capturedChatPrompt).toContain('Le sole nazioni presenti in questa trattativa sono: Polonia');
    // La vecchia formula che invitava a "considerare forza militare" è sparita.
    expect(capturedChatPrompt).not.toContain('considera forza militare, territori e relazioni');
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
