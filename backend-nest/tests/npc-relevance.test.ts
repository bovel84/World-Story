/**
 * Pertinenza delle reazioni NPC: una crisi locale (Botswana–Zimbabwe) deve
 * coinvolgere la controparte e i vicini, non potenze lontane senza interesse
 * documentato (qui la Malesia). Verifica sia il filtro sulle reactions sia
 * quello sui partecipanti delle chat, e il dossier strategico fornito al modello.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-relevance-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let getSessionRegistry: any;

type Reaction = {
  actorId: string;
  optionId: string;
  polityName: string;
  role: 'counterparty' | 'ally' | 'mediator' | 'observer';
  stance: 'supportive' | 'opposed' | 'conditional' | 'neutral';
  response: string;
  priority?: string;
  counterAction?: string;
};

let stubReactions: Reaction[] = [];
let stubEvents: any[] = [{
  headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
  description: 'Le forze botswane aprono le ostilità lungo la frontiera di Gwanda contro lo Zimbabwe.',
  date: '1951-02-01',
  mapChanges: [],
  reactions: [] as Reaction[],
}];
let stubStartChat: Array<{
  participants?: string[];
  polityName?: string;
  topic: string;
  kind?: 'meeting' | 'summit' | 'negotiation' | 'conference' | 'ultimatum' | 'technical' | 'statement';
  eventHeadline?: string;
}> = [];

const WORLD_ID = 'relevance_world';

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string, _system: string, _user: string) {
    if (mechanic === 'jump') {
      const events = stubEvents.map(event => ({ ...event, reactions: event.reactions?.length ? event.reactions : stubReactions }));
      return {
        content: JSON.stringify({
          events,
          narration: 'La crisi di frontiera entra nella sua fase armata.',
          voided: [],
          startChat: stubStartChat,
          relationshipChanges: [],
          worldChanges: { regionOwners: {}, regionColors: {} },
        }),
      };
    }
    if (mechanic === 'chat') return { content: JSON.stringify({ message: 'Prendiamo atto della situazione.' }) };
    if (mechanic === 'advisor') return { content: 'Commento.' };
    if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'Ordine' }) };
    if (mechanic === 'consolidation') return { content: 'SINTESI' };
    return { content: '{"type":"develop"}' };
  },
  async stream(mechanic: string, system: string, user: string, onToken: (chars: number) => void, options?: any) {
    const result = await this.generate(mechanic, system, user, options);
    onToken(result.content.length);
    return result;
  },
  clearCache() {},
};

function createGame(): any {
  return getSessionRegistry().createSession(WORLD_ID, 'Botswana', `${WORLD_ID}_BWA`, '#FF0000');
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
      name: 'Relevance World',
      description: '',
      startDate: '1951-01-01',
      basePrompt: 'Africa australe alternativa.',
      historicalAccuracy: 0.8,
      simulationRules: 'Le crisi regionali restano regionali.',
    },
    [
      { id: `${WORLD_ID}_BWA`, name: 'Botswana', color: '#FF0000', owner: 'BWA', population: 1_000_000, gdp: 50, militaryPower: 40, flag: 'BWA', borders: [`${WORLD_ID}_ZWE`, `${WORLD_ID}_ZAF`], objects: [], geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[24,-22],[26,-22],[26,-20],[24,-20],[24,-22]]]}}' },
      { id: `${WORLD_ID}_ZWE`, name: 'Zimbabwe', color: '#00FF00', owner: 'ZWE', population: 2_000_000, gdp: 60, militaryPower: 70, flag: 'ZWE', borders: [`${WORLD_ID}_BWA`], objects: [], geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[28,-22],[31,-22],[31,-18],[28,-18],[28,-22]]]}}' },
      { id: `${WORLD_ID}_ZAF`, name: 'Sudafrica', color: '#0000FF', owner: 'ZAF', population: 5_000_000, gdp: 120, militaryPower: 90, flag: 'ZAF', borders: [`${WORLD_ID}_BWA`], objects: [], geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[20,-34],[28,-34],[28,-28],[20,-28],[20,-34]]]}}' },
      { id: `${WORLD_ID}_MYS`, name: 'Malaysia', color: '#FFAA00', owner: 'MYS', population: 3_000_000, gdp: 80, militaryPower: 50, flag: 'MYS', borders: [], objects: [], geojson: '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[100,2],[104,2],[104,6],[100,6],[100,2]]]}}' },
    ],
  );

  registryModule.initSessionRegistry(stubProvider);
});

beforeEach(() => {
  stubReactions = [];
  stubStartChat = [];
  stubEvents = [{
    headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
    description: 'Le forze botswane aprono le ostilità lungo la frontiera di Gwanda contro lo Zimbabwe.',
    date: '1951-02-01',
    mapChanges: [],
    reactions: [],
  }];
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

describe('Pertinenza delle reazioni NPC', () => {
  it('non apre un canale per una potenza citata solo di sfondo nel dispaccio', async () => {
    // L'ordine non nomina la Malesia: un cenno di sfondo nel dispaccio non
    // basta a farle aprire una chat con il giocatore.
    stubEvents = [{
      headline: 'Botswana rafforza la frontiera settentrionale',
      description: 'La Malesia osserva con attenzione gli sviluppi regionali, senza esserne coinvolta.',
      date: '1951-02-01',
      mapChanges: [],
      reactions: [],
    }];
    const session = createGame().session;
    session.queueAction('Rafforzare la frontiera settentrionale');
    await session.processNextAction(0);

    expect(session.getChats().map((chat: any) => chat.polityId)).not.toContain('MYS');
  });

  it('accetta le reazioni di controparte e vicini conformi al contratto', async () => {
    stubReactions = [
      { actorId: 'ZWE', optionId: 'ZWE:counter', polityName: 'Zimbabwe', role: 'counterparty', stance: 'opposed', response: 'Harare mobilita le riserve e rinforza Gwanda.' },
      { actorId: 'ZAF', optionId: 'ZAF:mediate', polityName: 'Sudafrica', role: 'mediator', stance: 'conditional', response: 'Pretoria offre mediazione regionale.' },
    ];
    const session = createGame().session;
    session.queueAction('Attaccare le posizioni dello Zimbabwe a Gwanda');
    await session.processNextAction(0);

    const chatPolities = session.getChats().map((chat: any) => chat.polityId);
    expect(chatPolities).toContain('ZWE');

    const worldEvent = session.getTimeline().flatMap((entry: any) => entry.events)
      .find((event: any) => event.headline === 'Botswana attacca le posizioni zimbabwesi a Gwanda');
    expect(worldEvent.detail).toContain('Zimbabwe');
    expect(worldEvent.detail).toContain('Sudafrica');
    // La potenza lontana non è nel CONTESTO DI REAZIONE: il motore non le
    // consente di decidere, quindi non può comparire nel dispaccio.
    expect((session as any).buildGameData(['Attaccare le posizioni dello Zimbabwe a Gwanda']).reactionContext).not.toContain('MYS');
  });

  it('una reaction di una potenza fuori dal teatro fallisce chiusa invece di essere accettata', async () => {
    stubReactions = [
      { actorId: 'ZWE', optionId: 'ZWE:counter', polityName: 'Zimbabwe', role: 'counterparty', stance: 'opposed', response: 'Harare mobilita le riserve.' },
      // La Malesia non è fra i RelevantActor del contesto: il contratto la rifiuta.
      { actorId: 'MYS', optionId: 'MYS:negotiate', polityName: 'Malaysia', role: 'observer', stance: 'neutral', response: 'Kuala Lumpur invia una nota di comodo.' },
    ];
    const session = createGame().session;
    session.queueAction('Attaccare le posizioni dello Zimbabwe a Gwanda');
    await expect(session.processNextAction(0)).rejects.toThrow(/reactions fuori contratto|fuori contratto/);
    expect(session.getTimeline().flatMap((entry: any) => entry.events)
      .some((event: any) => String(event.detail || '').includes('Malaysia'))).toBe(false);
  });

  it('rimuove un partecipante fuori dal teatro da una riunione avviata dal modello', async () => {
    stubStartChat = [{
      participants: ['Zimbabwe', 'Malaysia'],
      topic: 'Convocazione urgente sulla crisi di Gwanda per concordare una tregua.',
      kind: 'meeting',
      eventHeadline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
    }];
    const session = createGame().session;
    session.queueAction('Attaccare le posizioni dello Zimbabwe a Gwanda');
    await session.processNextAction(0);

    const group = session.getChats().find((chat: any) => chat.participants.some((p: any) => p.id === 'ZWE'));
    expect(group).toBeTruthy();
    expect(group.participants.map((p: any) => p.id)).toContain('ZWE');
    expect(group.participants.map((p: any) => p.id)).not.toContain('MYS');
  });

  it('il dossier strategico copre il teatro e non le potenze lontane', async () => {
    const session = createGame().session;
    const gameData = (session as any).buildGameData(['Attaccare le posizioni dello Zimbabwe a Gwanda']);
    expect(gameData.npcStrategicProfiles).toContain('[ZWE]');
    expect(gameData.npcStrategicProfiles).toContain('[ZAF]');
    expect(gameData.npcStrategicProfiles).not.toContain('[MYS]');
  });

  it('materializza la misura materiale di una controrazione NPC senza mapChange', async () => {
    stubReactions = [{
      actorId: 'ZWE',
      // L'opzione di controazione ammette effetti militari: la misura
      // materializzata dal motore resta dentro la categoria della decisione.
      optionId: 'ZWE:counter',
      polityName: 'Zimbabwe',
      role: 'counterparty',
      stance: 'opposed',
      response: 'Harare mobilita le riserve e rinforza Gwanda.',
      counterAction: 'Mobilitazione generale delle riserve lungo la frontiera.',
    }];
    const session = createGame().session;
    session.queueAction('Attaccare le posizioni dello Zimbabwe a Gwanda');
    await session.processNextAction(0);

    const zimbabwe = [...(session as any).regions.values()].find((region: any) => region.owner === 'ZWE');
    const objects = zimbabwe.objects || [];
    expect(objects.some((object: any) => object.type === 'mobilization')).toBe(true);
  });

  it('un negoziato non materializza automaticamente una misura militare (§7)', async () => {
    stubReactions = [{
      actorId: 'ZWE',
      // «Accettare con condizioni» non ammette effetti materiali: il motore non
      // trasforma il testo della controazione in unità o cantieri.
      optionId: 'ZWE:condition',
      polityName: 'Zimbabwe',
      role: 'counterparty',
      stance: 'conditional',
      response: 'Harare accetta un negoziato limitato sulle garanzie di confine.',
      counterAction: 'Mobilitazione generale delle riserve lungo la frontiera.',
    }];
    const session = createGame().session;
    session.queueAction('Attaccare le posizioni dello Zimbabwe a Gwanda');
    await session.processNextAction(0);

    const zimbabwe = [...(session as any).regions.values()].find((region: any) => region.owner === 'ZWE');
    const objects = zimbabwe.objects || [];
    expect(objects.some((object: any) => object.type === 'mobilization')).toBe(false);
    // La reazione resta narrata: la decisione politica non viene persa.
    const worldEvent = session.getTimeline().flatMap((entry: any) => entry.events)
      .find((event: any) => event.headline === 'Botswana attacca le posizioni zimbabwesi a Gwanda');
    expect(worldEvent.detail).toContain('Zimbabwe');
  });

  it('schiera una formazione di frontiera del giocatore sul confine, non al centro provincia', async () => {
    stubEvents = [{
      headline: 'Botswana schiera una brigata di frontiera verso lo Zimbabwe',
      description: 'La nuova formazione di frontiera prende posizione lungo il confine con lo Zimbabwe.',
      date: '1951-02-01',
      mapChanges: [{
        type: 'start_mobilization',
        regionName: 'Botswana',
        feature: { type: 'battalion', name: 'Brigata di Frontiera Botswana' },
      }],
      reactions: [],
    }];
    const session = createGame().session;
    session.queueAction('crea un esercito di frontiera vicino allo Zimbabwe');
    await session.processNextAction(0);

    const bwa = [...(session as any).regions.values()].find((region: any) => region.owner === 'BWA');
    const unit = (bwa.objects || []).find((object: any) => object.type === 'mobilization');
    expect(unit).toBeTruthy();
    // Il centroide del Botswana è lng 25; il confine con lo Zimbabwe è a lng 26.
    expect(unit.lng).toBeGreaterThan(25.5);
    expect(unit.lng).toBeLessThanOrEqual(26);
  });
});
