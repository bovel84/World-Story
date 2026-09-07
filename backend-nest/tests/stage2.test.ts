/**
 * Интеграционные тесты Этапа 2 (с заглушкой LLM):
 *   voided-действия попадают в ленту, rewind откатывает ход,
 *   Intervene обрывает пачку событий, консолидация истории,
 *   сложность доезжает до промпта, auto-jump берёт дату из targetDate.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `open-pax-stage2-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: any;
let getSessionRegistry: any;

/** Последний промпт симуляции, ушедший в «LLM» */
let capturedPrompt = '';
/** Счётчик вызовов механики consolidation */
let consolidationCalls = 0;
/** Режим ответа заглушки на механику jump */
let jumpMode: 'normal' | 'voided' | 'auto' | 'auto_future' | 'world' | 'outcome' | 'outcome_past' | 'outcome_complete' | 'no_event' | 'intervene' | 'auto_same' | 'fixed_same' | 'multi' | 'budget' = 'normal';

const WORLD_ID = 'stage2_world';

function jumpResponse(): any {
  switch (jumpMode) {
    case 'voided':
      return {
        events: [],
        narration: 'Советники отговорили правительство от безумной затеи.',
        voided: [{ action: 'Захватить весь мир за неделю', reason: 'Нереалистично для 1951 года' }],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'auto':
      return {
        events: [
          { headline: 'Подписан важный договор', description: 'Итог месяцев переговоров.', date: '1951-03-10', mapChanges: [] },
        ],
        narration: 'Время шло до значимого события.',
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
        targetDate: '1951-03-10',
      };
    case 'auto_same':
      return {
        events: [
          { headline: 'Primo evento del giorno', description: 'Prima svolta.', date: '1951-03-10', mapChanges: [] },
          { headline: 'Secondo evento stesso giorno', description: 'Seconda svolta nella stessa data.', date: '1951-03-10', mapChanges: [] },
        ],
        narration: 'Due eventi nella stessa data.',
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
        targetDate: '1951-03-10',
      };
    case 'fixed_same':
      return {
        events: [
          { headline: 'Primo evento del giorno', description: 'Prima svolta.', date: '1951-01-20', mapChanges: [] },
          { headline: 'Secondo evento stesso giorno', description: 'Seconda svolta nella stessa data.', date: '1951-01-20', mapChanges: [] },
        ],
        narration: 'Due eventi nella stessa data.',
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
        targetDate: '1951-01-20',
      };
    case 'multi':
      // §9.3: più eventi nel salto fisso → playback «un evento alla volta».
      return {
        events: [
          { headline: 'Prima svolta del periodo', description: 'La prima conseguenza verificabile.', date: '1951-01-20', mapChanges: [{ type: 'transfer', regionName: 'Польша', newOwner: 'ФРГ' }] },
          { headline: 'Seconda svolta del periodo', description: 'La conseguenza successiva nella stessa catena causale.', date: '1951-02-10', mapChanges: [{ type: 'transfer', regionName: 'Чехословакия', newOwner: 'ФРГ' }] },
        ],
        narration: 'Il periodo completo è stato simulato.',
        actionOutcomes: [{
          action: 'Действие игрока',
          status: 'accepted',
          summary: 'L’espansione occidentale procede per tappe.',
          eventHeadlines: ['Prima svolta del periodo', 'Seconda svolta del periodo'],
        }],
        voided: [],
        startChat: [],
        // Effetti globali: applicabili SOLO a destinazione raggiunta.
        worldChanges: { regionOwners: { 'Великобритания': 'ФРГ' }, regionColors: {} },
      };
    case 'budget':
      // §7.2/T36: stream troncato senza record «complete» → budget esaurito.
      // NDJSON con due righe evento e NESSUNA chiusura del periodo.
      return { content: [
        JSON.stringify({ type: 'event', headline: 'Crisi a metà periodo', description: 'La crisi esplode a metà del salto.', date: '1951-01-20', mapChanges: [{ type: 'transfer', regionName: 'Польша', newOwner: 'ФРГ' }] }),
        JSON.stringify({ type: 'event', headline: 'Escalation della crisi', description: 'La crisi si aggravata prima del termine del budget.', date: '1951-02-10', mapChanges: [] }),
      ].join('\n') };
    case 'outcome_past':
      return {
        events: [{ headline: 'Avvio progetto', description: 'Il progetto viene avviato.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Avvio progetto.',
        actionOutcomes: [{
          action: 'Действие игрока', status: 'partial', summary: 'Il progetto è in corso.',
          expectedDate: '1950-12-31', eventHeadlines: ['Avvio progetto'],
        }],
        voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'outcome_complete':
      return {
        events: [
          { headline: 'Misura economica completata', description: 'La misura preparata in precedenza viene attuata.', date: '1951-02-15', mapChanges: [] },
        ],
        narration: 'La misura è completata.',
        actionOutcomes: [{
          action: 'Действие игрока',
          status: 'accepted',
          summary: 'L’ordine ripetuto completa la misura precedentemente avviata.',
          eventHeadlines: ['Misura economica completata'],
        }],
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'outcome':
      return {
        events: [
          { headline: 'Misura economica preparatoria', description: 'Il governo avvia la verifica delle risorse.', date: '1951-01-15', mapChanges: [] },
        ],
        narration: 'È iniziata una misura preparatoria.',
        actionOutcomes: [{
          action: 'Действие игрока',
          status: 'partial',
          summary: 'L’ordine ha avviato una misura preparatoria, non un esito completo.',
          expectedDate: '1951-06-01',
          eventHeadlines: ['Misura economica preparatoria'],
        }],
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'no_event':
      return {
        events: [],
        narration: 'Nessuna svolta importante emerge nell’orizzonte cercato.',
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'world':
      return {
        events: [
          { headline: 'Il mondo reagisce', description: 'Una crisi già in corso produce un fatto verificabile.', date: '1951-01-12', mapChanges: [] },
        ],
        narration: 'Il mondo si è mosso senza un nuovo ordine del giocatore.',
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
    case 'auto_future':
      return {
        events: [
          { headline: 'Il primo evento importante', description: 'La Polonia risponde alla proposta tedesca.', date: '1951-03-10', mapChanges: [] },
          { headline: 'Un evento futuro da non applicare', description: 'La Francia subisce un cambio di governo successivo.', date: '1951-03-20', mapChanges: [] },
        ],
        narration: 'Il primo evento viene seguito da una crisi futura che non deve comparire.',
        voided: [],
        startChat: [{ polityName: 'Polonia', topic: 'Discussione futura da non aprire' }],
        relationshipChanges: [{ from: 'DEU', to: 'POL', relationship: 'ally', reason: 'Esito futuro' }],
        worldChanges: { regionOwners: { 'Francia': 'ФРГ' }, regionColors: {} },
        targetDate: '1951-03-20',
      };
    case 'intervene':
      return {
        events: [
          { headline: 'ФРГ аннексировала Польшу', description: 'Первое событие.', date: '1951-02-01', mapChanges: [{ type: 'transfer', regionName: 'Польша', newOwner: 'ФРГ' }] },
          { headline: 'ФРГ аннексировала Чехословакию', description: 'Второе событие.', date: '1951-02-10', mapChanges: [{ type: 'transfer', regionName: 'Чехословакия', newOwner: 'ФРГ' }] },
          { headline: 'ФРГ аннексировала Францию', description: 'Третье событие.', date: '1951-02-20', mapChanges: [{ type: 'transfer', regionName: 'Франция', newOwner: 'ФРГ' }] },
        ],
        narration: 'Стремительная экспансия.',
        voided: [],
        startChat: [],
        // Итоговые worldChanges при Intervene применяться НЕ должны
        worldChanges: { regionOwners: { 'Великобритания': 'ФРГ' }, regionColors: {} },
      };
    default:
      return {
        events: [
          { headline: 'Польша капитулировала', description: 'Короткая кампания.', date: '1951-01-20', mapChanges: [{ type: 'transfer', regionName: 'Польша', newOwner: 'ФРГ' }] },
        ],
        narration: 'Польша пала.',
        actionOutcomes: [{
          action: 'Действие игрока',
          status: 'partial',
          summary: 'L’ordine ha avviato una misura preparatoria, non un esito completo.',
          eventHeadlines: ['Польша капитулировала'],
        }],
        voided: [],
        startChat: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      };
  }
}

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string, system: string, user: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Действие игрока' }) };
    }
    if (mechanic === 'consolidation') {
      consolidationCalls++;
      return { content: 'КОНСПЕКТ: сжатая история первых раундов' };
    }
    if (mechanic === 'jump') {
      capturedPrompt = `${system}\n${user}`;
      const response = jumpResponse();
      // Il caso «budget» simula uno stream NDJSON troncato: la risposta è già
      // contenuto grezzo, non un oggetto da serializzare una seconda volta.
      if (typeof response?.content === 'string') return { content: response.content };
      return { content: JSON.stringify(response) };
    }
    return { content: JSON.stringify({ type: 'develop', description: 'Развитие', priority: 5 }) };
  },
  async stream(mechanic: string, system: string, user: string, onToken: (chars: number) => void, options?: any) {
    const r = await this.generate(mechanic, system, user, options);
    onToken(r.content.length);
    return r;
  },
  clearCache() {},
};

function createGame(difficulty?: string): { gameId: string; session: any } {
  const created = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}_DEU`, '#FF0000', difficulty);
  return created;
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);

  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();

  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  gameRepository = repos.gameRepository;

  const registryModule = await import('../src/session-registry');
  initSessionRegistry = registryModule.initSessionRegistry;
  getSessionRegistry = registryModule.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Stage2 World', description: '', startDate: '1951-01-01', basePrompt: 'Тестовый лор', historicalAccuracy: 0.8 },
    [
      { id: `${WORLD_ID}_DEU`, name: 'ФРГ', color: '#FF0000', owner: 'DEU', population: 5000000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${WORLD_ID}_POL`, name: 'Польша', color: '#00FF00', owner: 'POL', population: 3000000, gdp: 100, militaryPower: 100, flag: 'POL' },
      { id: `${WORLD_ID}_CZE`, name: 'Чехословакия', color: '#0000FF', owner: 'CZE', population: 2000000, gdp: 90, militaryPower: 80, flag: 'CZE' },
      { id: `${WORLD_ID}_FRA`, name: 'Франция', color: '#FFFF00', owner: 'FRA', population: 4000000, gdp: 180, militaryPower: 200, flag: 'FRA' },
      { id: `${WORLD_ID}_GBR`, name: 'Великобритания', color: '#FF00FF', owner: 'GBR', population: 4500000, gdp: 190, militaryPower: 250, flag: 'GBR' },
    ]
  );

  initSessionRegistry(stubProvider);
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('Engine invariants across a real session', () => {
  it('applies economy for the actual auto-jump period', async () => {
    jumpMode = 'auto';
    const { session } = createGame();
    const gdp = session.getRegion(`${WORLD_ID}_DEU`).gdp;
    session.queueAction('Attendere il trattato');
    await session.processNextAction(0);
    const elapsed = (Date.parse('1951-03-10') - Date.parse('1951-01-01')) / 86400000;
    expect(session.getRegion(`${WORLD_ID}_DEU`).gdp).toBeCloseTo(gdp * 1.012 ** (elapsed / 365), 8);
    jumpMode = 'normal';
  });

  it('does not build factories just because a rejected order names one', async () => {
    jumpMode = 'voided';
    const { session } = createGame();
    const before = structuredClone(session.getRegion(`${WORLD_ID}_DEU`).objects);
    session.queueAction('Costruire una fabbrica istantaneamente senza risorse');
    await session.processNextAction(30);
    expect(session.getRegion(`${WORLD_ID}_DEU`).objects).toEqual(before);
    jumpMode = 'normal';
  });

  it('an invalid horizon neither mutates nor marks an order as processing', async () => {
    const { session } = createGame();
    const action = session.queueAction('Ordine');
    await expect(session.processNextAction(NaN)).rejects.toThrow();
    expect(action.status).toBe('pending');
    expect(session.getCurrentTurn()).toBe(1);
  });

  it('uses national NPC context once per owner and never publishes self-conquest', async () => {
    const { session } = createGame();
    session.getRegion(`${WORLD_ID}_POL`).owner = 'FRA';
    session.getRegion(`${WORLD_ID}_CZE`).owner = 'FRA';
    const nationalPopulation = ['POL', 'CZE', 'FRA'].reduce((sum, code) => sum + session.getRegion(`${WORLD_ID}_${code}`).population, 0);
    const npc = vi.spyOn(session.gameController, 'processNPCTurn').mockImplementation(async () => ({
      type: 'war', targetRegionId: `${WORLD_ID}_POL`, description: 'Conquista inventata', priority: 8,
    }));
    const events = await session.processNPCTurns(3, 7);
    expect(npc).toHaveBeenCalledTimes(2); // FRA (three provinces) + GBR
    const contexts = npc.mock.calls.map(call => call[1] as any);
    expect(contexts.map(ctx => ctx.polityId).sort()).toEqual(['FRA', 'GBR']);
    expect(contexts.find(ctx => ctx.polityId === 'FRA').population).toBe(nationalPopulation);
    expect(events).toEqual([]);
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('FRA');
  });

  it('advanceDate validates the horizon before touching the world', async () => {
    const { session } = createGame();
    const before = { date: session.getCurrentDate(), turn: session.getCurrentTurn() };
    await expect(session.advanceDate(NaN)).rejects.toThrow();
    await expect(session.advanceDate(-5)).rejects.toThrow();
    expect(session.getCurrentDate()).toBe(before.date);
    expect(session.getCurrentTurn()).toBe(before.turn);
  });

  it('advanceDate moves calendar and economy together and persists both', async () => {
    const { gameId, session } = createGame();
    const gdp = session.getRegion(`${WORLD_ID}_DEU`).gdp;
    const { newDate } = await session.advanceDate(90);
    expect(newDate).toBe('1951-04-01');
    expect(session.getRegion(`${WORLD_ID}_DEU`).gdp).toBeCloseTo(gdp * 1.012 ** (90 / 365), 8);
    // Persisted, not only in memory
    expect(db.prepare('SELECT * FROM games WHERE id = ?').get(gameId).current_date).toBe('1951-04-01');
    expect(db.prepare('SELECT gdp FROM game_regions WHERE game_id = ? AND region_id = ?').get(gameId, `${WORLD_ID}_DEU`).gdp)
      .toBeCloseTo(gdp * 1.012 ** (90 / 365), 8);
  });

  it('live ticks broadcast economic changes even when borders stay unchanged', async () => {
    const { session } = createGame();
    const messages: any[] = [];
    session.setSSEBroadcaster((type: string, data: any) => { if (type === 'world_event') messages.push(data); });
    const initialGDP = session.getRegion(`${WORLD_ID}_DEU`).gdp;
    await session.worldTick();
    expect(messages).toHaveLength(1);
    expect(messages[0].changedRegions.find((r: any) => r.id === `${WORLD_ID}_DEU`).gdp).toBeGreaterThan(initialGDP);
    expect(messages[0].newDate).toBe('1951-01-08');
    expect(messages[0].eventDetails).toHaveLength(messages[0].events.length);
  });
});

describe('Auto-jump senza eventi', () => {
  it('non consuma ordini né crea un turno quando non trova una svolta', async () => {
    jumpMode = 'no_event';
    const { gameId, session } = createGame();
    const queued = session.queueAction('Attendere senza assumere iniziative');
    const dateBefore = session.getCurrentDate();
    const turnBefore = session.getCurrentTurn();
    const resultsBefore = session.getResults().length;

    const processed = await session.processAllPendingActions(0);

    expect(processed).toEqual([]);
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(session.getCurrentTurn()).toBe(turnBefore);
    expect(session.getResults()).toHaveLength(resultsBefore);
    expect(session.getPendingActions()).toEqual([
      expect.objectContaining({ id: queued.id, status: 'pending' }),
    ]);
    expect(db.prepare('SELECT status, checkpoint_date FROM simulation_runs WHERE game_id = ? ORDER BY created_at DESC LIMIT 1').get(gameId))
      .toMatchObject({ status: 'no_event', checkpoint_date: dateBefore });
    jumpMode = 'normal';
  });
});

describe('Isolamento regionale per partita', () => {
  it('una conquista in una partita non muta la copia regionale di un’altra', async () => {
    jumpMode = 'normal';
    const first = createGame();
    first.session.queueAction('Attaccare la Polonia');
    await first.session.processNextAction(30);
    expect(first.session.getRegion(`${WORLD_ID}_POL`).owner).toBe('DEU');

    const second = createGame();
    expect(second.session.getRegion(`${WORLD_ID}_POL`).owner).toBe('POL');
    expect(gameRepository.getGameRegions(second.gameId).find((region: any) => region.id === `${WORLD_ID}_POL`)?.owner).toBe('POL');
  });
});

describe('Persistenza della coda di ordini', () => {
  it('ricarica gli ordini pendenti dopo la ricostruzione della sessione', async () => {
    const { gameId, session } = createGame();
    const queued = session.queueAction('Preparare il bilancio per il prossimo trimestre');
    const game = gameRepository.findById(gameId);
    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);

    restored.reconstructFromDB({
      currentTurn: game.current_turn,
      currentDate: game.current_date,
      players: game.players,
      basePrompt: game.world.base_prompt,
      difficulty: game.difficulty,
    });

    expect(restored.getPendingActions()).toEqual([
      expect.objectContaining({ id: queued.id, text: queued.text, status: 'pending' }),
    ]);
  });
});

describe('Idempotenza della simulazione', () => {
  it('rifiuta una seconda richiesta mentre lo stesso turno è in corso', async () => {
    jumpMode = 'world';
    const { session } = createGame();
    const controller = session.gameController as any;
    const original = controller.processTurnWithPrompts.bind(controller);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const simulate = vi.spyOn(controller, 'processTurnWithPrompts')
      .mockImplementation(async (...args: any[]) => {
        await gate;
        return original(...args);
      });

    const first = session.processWorldAdvance(30);
    await Promise.resolve();
    expect(session.isSimulationInProgress()).toBe(true);
    await expect(session.processWorldAdvance(30)).rejects.toMatchObject({
      name: 'SimulationInProgressError',
    });
    release();
    await first;
    expect(session.isSimulationInProgress()).toBe(false);
    simulate.mockRestore();
    jumpMode = 'normal';
  });
});

describe('Simulazione del mondo senza nuovi ordini', () => {
  it('usa il motore causale senza creare un ordine fittizio del giocatore', async () => {
    jumpMode = 'world';
    const { gameId, session } = createGame();
    const controller = session.gameController as any;
    const simulate = vi.spyOn(controller, 'processTurnWithPrompts');
    const npcTurns = vi.spyOn(session as any, 'processNPCTurns');
    const randomEvents = vi.spyOn(session as any, 'applyRandomEvents');

    const result = await session.processWorldAdvance(30, 'world-run-idempotency-key');

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate.mock.calls[0][1]).toEqual([]);
    expect(npcTurns).not.toHaveBeenCalled();
    expect(randomEvents).not.toHaveBeenCalled();
    expect(session.getPendingActions()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM actions WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(result.events).toContain('Il mondo reagisce');
    expect(result.simulationId).toEqual(expect.any(String));
    const run = db.prepare('SELECT status, checkpoint_date, checkpoint_id, idempotency_key FROM simulation_runs WHERE id = ?').get(result.simulationId);
    expect(run).toMatchObject({
      status: 'completed',
      checkpoint_date: '1951-01-31',
      checkpoint_id: expect.any(String),
      idempotency_key: 'world-run-idempotency-key',
    });
    const checkpoint = db.prepare('SELECT revision, turn, game_date, data FROM simulation_checkpoints WHERE id = ?').get(run.checkpoint_id);
    expect(checkpoint).toMatchObject({ revision: 2, turn: 1, game_date: '1951-01-31' });
    expect(JSON.parse(checkpoint.data).currentDate).toBe('1951-01-31');
    expect(db.prepare('SELECT game_date, headline FROM simulation_events WHERE run_id = ?').get(result.simulationId))
      .toMatchObject({ game_date: '1951-01-12', headline: 'Il mondo reagisce' });
    expect(result.timelineEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.any(String),
        date: '1951-01-12',
        headline: 'Il mondo reagisce',
        simulationId: result.simulationId,
      }),
    ]));
    expect(session.getCurrentDate()).toBe('1951-01-31');
    simulate.mockRestore();
    npcTurns.mockRestore();
    randomEvents.mockRestore();
    jumpMode = 'normal';
  });
});

describe('Esiti individuali nel lotto', () => {
  it('associa l’outcome strutturato al singolo ordine senza creare un secondo turno', async () => {
    jumpMode = 'outcome';
    const { session } = createGame();
    session.queueAction('Preparare una misura economica');

    const action = await session.processNextAction(30);

    expect(action.result.outcome).toEqual({
      status: 'partial',
      summary: 'L’ordine ha avviato una misura preparatoria, non un esito completo.',
      expectedDate: '1951-06-01',
    });
    expect(action.result.events).toEqual(['Misura economica preparatoria']);
    expect(db.prepare('SELECT title, summary, status, started_date, expected_date FROM ongoing_processes WHERE game_id = ? AND source_action_id = ?')
      .get(session.id, action.id)).toMatchObject({
        title: 'Preparare una misura economica',
        summary: 'L’ordine ha avviato una misura preparatoria, non un esito completo.',
        status: 'ongoing',
        started_date: '1951-01-01',
        expected_date: '1951-06-01',
      });
    expect(db.prepare('SELECT status, summary, event_headlines FROM simulation_action_outcomes WHERE run_id = ? AND action_id = ?')
      .get(action.result.simulationId, action.id)).toMatchObject({
        status: 'partial',
        summary: 'L’ordine ha avviato una misura preparatoria, non un esito completo.',
        event_headlines: JSON.stringify(['Misura economica preparatoria']),
      });
    expect(session.getResults().at(-1)?.timelineEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        headline: 'Misura economica preparatoria',
        sourceActionIds: [action.id],
      }),
    ]));
    expect(session.getCurrentTurn()).toBe(2);
    // Caricare lo stesso checkpoint ricrea la tabella actions, ma il record
    // del run resta consultabile: l'audit non dipende dalla riga effimera.
    const saved = session.save('verifica audit run');
    const snapshot = db.prepare('SELECT data FROM saves WHERE id = ?').get(saved.saveId);
    session.loadFromSave(JSON.parse(snapshot.data));
    await session.persistLoadedState();
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_action_outcomes WHERE run_id = ?')
      .get(action.result.simulationId).n).toBe(1);
    jumpMode = 'normal';
  });
});

describe('Ciclo di vita dei processi', () => {
  it('Save/Load rimuove i processi creati nel futuro del ramo', async () => {
    jumpMode = 'outcome';
    const { session } = createGame();
    const saved = session.save('prima del progetto');
    const snapshot = db.prepare('SELECT data FROM saves WHERE id = ?').get(saved.saveId);
    session.queueAction('Preparare una misura economica');
    await session.processNextAction(30);
    expect(gameRepository.getOngoingProcesses(session.id)).toHaveLength(1);

    session.loadFromSave(JSON.parse(snapshot.data));
    expect(gameRepository.getOngoingProcesses(session.id)).toHaveLength(0);
    jumpMode = 'normal';
  });

  it('scarta una data prevista retrodatata dal modello', async () => {
    jumpMode = 'outcome_past';
    const { session } = createGame();
    session.queueAction('Avviare un progetto');
    await session.processNextAction(30);
    expect(gameRepository.getOngoingProcesses(session.id)[0].expected_date).toBeNull();
    jumpMode = 'normal';
  });

  it('chiude un processo partial quando lo stesso ordine ha esito accepted', async () => {
    jumpMode = 'outcome';
    const { session } = createGame();
    session.queueAction('Preparare una misura economica');
    const first = await session.processNextAction(30);

    jumpMode = 'outcome_complete';
    session.queueAction('Preparare una misura economica');
    await session.processNextAction(30);

    expect(db.prepare('SELECT status, summary FROM ongoing_processes WHERE game_id = ? AND source_action_id = ?')
      .get(session.id, first.id)).toMatchObject({
        status: 'completed',
        summary: 'L’ordine ripetuto completa la misura precedentemente avviata.',
      });
    jumpMode = 'normal';
  });
});

describe('Этап 2: очередь действий', () => {
  it('simula tutti gli ordini pendenti nello stesso salto, non un salto per ordine', async () => {
    // Evita modifiche di confine nel fixture condiviso: qui verifichiamo il
    // batching, non un particolare esito militare.
    jumpMode = 'voided';
    const { session } = createGame();
    const controller = session.gameController as any;
    const simulate = vi.spyOn(controller, 'processTurnWithPrompts');
    const first = session.queueAction('Preparare le difese occidentali');
    const second = session.queueAction('Proporre un patto alla Polonia');

    const processed = await session.processAllPendingActions(30);

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate.mock.calls[0][1]).toEqual([first.text, second.text]);
    expect(processed.map((action: any) => action.id)).toEqual([first.id, second.id]);
    expect(processed.every((action: any) => action.status === 'completed')).toBe(true);
    expect(processed.map((action: any) => action.result.turn)).toEqual([1, 1]);
    expect(session.getCurrentTurn()).toBe(2);
    expect(session.getCurrentDate()).toBe('1951-01-31');
    simulate.mockRestore();
    jumpMode = 'normal';
  });

  it('удаляет ожидающее действие и не оставляет скрытый приказ на сервере', () => {
    const { session } = createGame();
    const first = session.queueAction('Первое действие');
    session.queueAction('Второе действие');

    expect(session.removePendingAction(first.id)).toBe(true);
    expect(session.getPendingActions().map((action: any) => action.text)).toEqual(['Второе действие']);
    expect(session.removePendingAction(first.id)).toBe(false);
  });

  it('modifica un ordine in coda prima della presa in carico e la persiste', async () => {
    const { gameId, session } = createGame();
    const first = session.queueAction('Ordine originale');
    session.queueAction('Secondo ordine');

    // Modifica valida: testo aggiornato in memoria.
    const updated = session.updatePendingAction(first.id, 'Ordine riformulato');
    expect(updated).not.toBeNull();
    expect(updated!.text).toBe('Ordine riformulato');
    expect(session.getPendingActions().map((a: any) => a.text)).toEqual(['Ordine riformulato', 'Secondo ordine']);

    // La modifica sopravvive alla ricostruzione della sessione dal DB.
    const game = gameRepository.findById(gameId);
    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    restored.reconstructFromDB({
      currentTurn: game.current_turn,
      currentDate: game.current_date,
      players: game.players,
      basePrompt: game.world.base_prompt,
      difficulty: game.difficulty,
    });
    expect(restored.getPendingActions().map((a: any) => a.text)).toEqual(['Ordine riformulato', 'Secondo ordine']);

    // Testo vuoto o ordine inesistente: nessuna mutazione.
    expect(session.updatePendingAction(first.id, '   ')).toBeNull();
    expect(session.updatePendingAction('inesistente', 'Nuovo testo')).toBeNull();
    expect(session.getPendingActions().map((a: any) => a.text)).toEqual(['Ordine riformulato', 'Secondo ordine']);
  });
});

describe('T08: coda con soli ordini già completati', () => {
  it('usa lo stesso motore causale senza nuovi ordini, un solo turno', async () => {
    jumpMode = 'world';
    const { session } = createGame();
    const completed = session.queueAction('Ordine già svolto');
    // Simula un ordine già portato a termine (non più pendente).
    session.getPendingActions().find(a => a.id === completed.id)!.status = 'completed';

    const controller = session.gameController as any;
    const simulate = vi.spyOn(controller, 'processTurnWithPrompts');

    const processed = await session.processAllPendingActions(30);

    // Nessun ordine nuovo: il lotto è vuoto, il mondo usa il motore causale.
    expect(processed).toEqual([]);
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate.mock.calls[0][1]).toEqual([]);
    // Un solo salto, non uno per ogni ordine completato.
    expect(session.getCurrentTurn()).toBe(2);
    expect(session.getCurrentDate()).toBe('1951-01-31');
    simulate.mockRestore();
    jumpMode = 'normal';
  });
});

describe('G24: migliora formulazione (anteprima senza accodare)', () => {
  it('restituisce una riformulazione senza mutare coda, data o turno', async () => {
    const { session } = createGame();
    const dateBefore = session.getCurrentDate();
    const turnBefore = session.getCurrentTurn();

    const result = await session.enhanceAction('Costruire nuove fabbriche');

    // Il convertitore stub restituisce «Действие игрока»: l'anteprima è
    // quella proposta, non l'originale.
    expect(result.original).toBe('Costruire nuove fabbriche');
    expect(result.enhanced).toBe('Действие игрока');

    // Nessun ordine accodato, nessun avanzamento del tempo.
    expect(session.getPendingActions()).toEqual([]);
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(session.getCurrentTurn()).toBe(turnBefore);
  });

  it('rifiuta un testo vuoto senza chiamare il convertitore', async () => {
    const { session } = createGame();
    const controller = session.gameController as any;
    const spy = vi.spyOn(controller, 'enhanceAction');
    await expect(session.enhanceAction('   ')).rejects.toThrow('obbligatorio');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Этап 2: voided-действия', () => {
  it('отклонённое симуляцией действие попадает в ленту с пометкой', async () => {
    jumpMode = 'voided';
    const { session } = createGame();
    session.queueAction('Захватить весь мир за неделю');
    const action = await session.processNextAction(30);

    expect(action.status).toBe('completed');
    const events = action.result.events as string[];
    expect(events.some(e => e.includes('⊘ Respinto') && e.includes('Захватить весь мир за неделю'))).toBe(true);
    expect(events.some(e => e.includes('Нереалистично для 1951 года'))).toBe(true);
    jumpMode = 'normal';
  });
});

describe('Этап 2: rewind', () => {
  it('откат возвращает владельцев, дату и ход; повторный откат невозможен', async () => {
    jumpMode = 'normal';
    const { gameId, session } = createGame();
    const dateBefore = session.getCurrentDate();
    const turnBefore = session.getCurrentTurn();

    session.queueAction('Атаковать Польшу');
    await session.processNextAction(30);

    // Ход применился
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('DEU');
    expect(session.getCurrentDate()).not.toBe(dateBefore);
    expect(session.canRewind()).toBe(true);

    const rewound = session.rewind();
    expect(rewound).not.toBeNull();
    expect(rewound.date).toBe(dateBefore);
    expect(rewound.turn).toBe(turnBefore);
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('POL');
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(session.getCurrentTurn()).toBe(turnBefore);

    // Записи откаченного хода вычищены из БД
    const actions = db.prepare('SELECT COUNT(*) AS n FROM actions WHERE game_id = ?').get(gameId);
    const results = db.prepare('SELECT COUNT(*) AS n FROM turn_results WHERE game_id = ?').get(gameId);
    expect(actions.n).toBe(0);
    expect(results.n).toBe(0);

    // Снапшот потреблён — второй откат подряд невозможен
    expect(session.canRewind()).toBe(false);
    expect(session.rewind()).toBeNull();
  });
});

describe('Этап 2: Intervene', () => {
  it('§9.3 «Intervieni qui»: chiude il salto al checkpoint mostrato, senza applicare il futuro', async () => {
    jumpMode = 'intervene';
    const { session } = createGame();

    const broadcasts: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: any) => broadcasts.push({ type, data }));

    session.queueAction('Экспансия на запад');
    // Salto fisso di 90 giorni con TRE eventi proposti: il primo diventa
    // checkpoint, gli altri restano in attesa di conferma esplicita.
    const batch = await session.processNextAction(90);
    expect(batch).toBeNull(); // il batch non è concluso: è in pausa su un evento

    const paused = (session as any).getPausedRunInfo();
    expect(paused).toMatchObject({ remaining: 2, destination: '1951-04-01' });
    expect(session.getCurrentDate()).toBe('1951-02-01');
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('DEU');
    expect(session.getRegion(`${WORLD_ID}_CZE`).owner).toBe('CZE');
    expect(session.getRegion(`${WORLD_ID}_FRA`).owner).toBe('FRA');

    // «Intervieni qui»: il run si chiude AL CHECKPOINT MOSTRATO.
    const outcome = await (session as any).tryIntervenePausedRun(paused.simulationId);
    expect(outcome.type).toBe('intervened');
    expect(outcome.newDate).toBe('1951-02-01');

    // Nessun evento futuro applicato, nessun worldChanges di fine periodo.
    expect(session.getRegion(`${WORLD_ID}_CZE`).owner).toBe('CZE');
    expect(session.getRegion(`${WORLD_ID}_GBR`).owner).toBe('GBR');
    expect(session.getCurrentDate()).toBe('1951-02-01');

    // Il run è persistito come «intervened» con il checkpoint dell'evento.
    const run = db.prepare('SELECT status, checkpoint_date FROM simulation_runs WHERE id = ?').get(paused.simulationId);
    expect(run).toMatchObject({ status: 'intervened', checkpoint_date: '1951-02-01' });
    expect((session as any).getPausedRunInfo()).toBeNull();

    // L'ordine è finalized con gli eventi APPLICATI, non quelli scartati.
    const queue = session.getPendingActions();
    expect(queue).toHaveLength(0);
    // La coda persistita non lo contiene più: l'audit vive in «actions» e
    // «simulation_action_outcomes», non come ordine ancora elaborabile.
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_actions WHERE game_id = ?').get(session.id).n).toBe(0);
    const audit = db.prepare('SELECT text FROM actions WHERE game_id = ?').get(session.id);
    expect(audit.text).toBe('Экспансия на запад');
    const events = outcome.result.events as string[];
    expect(events).toContain('ФРГ аннексировала Польшу');
    expect(events).not.toContain('ФРГ аннексировала Чехословакия');
    expect(events).not.toContain('ФРГ аннексировала Францию');
    expect(events.some(e => e.includes('Intervene'))).toBe(true);

    // Il checkpoint per-evento è stato pubblicato con `checkpoint: true`, non
    // come anteprima di streaming; la chiusura arriva con turn_complete.
    const checkpointEvent = broadcasts.find(m => m.type === 'jump_event');
    expect(checkpointEvent.data).toMatchObject({ checkpoint: true, streaming: false });
    expect(checkpointEvent.data.awaitingNext).toMatchObject({ remaining: 2 });
    expect(checkpointEvent.data.changedRegions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${WORLD_ID}_POL`, owner: 'DEU' }),
    ]));
    const committed = broadcasts.find(m => m.type === 'turn_complete');
    expect(committed.data).toMatchObject({ intervened: true, newDate: '1951-02-01' });
    jumpMode = 'normal';
  });
});

describe('Этап 2: auto-jump «к следующему событию»', () => {
  it('non applica effetti globali, chat o narrazione successivi al primo evento', async () => {
    jumpMode = 'auto_future';
    const { session } = createGame();
    session.queueAction('Attendere la risposta polacca');

    const action = await session.processNextAction(0);

    expect(session.getCurrentDate()).toBe('1951-03-10');
    expect(session.getRegion(`${WORLD_ID}_FRA`).owner).toBe('FRA');
    expect(session.getChats()).toHaveLength(0);
    expect(action.result.events).toContain('Il primo evento importante');
    expect(action.result.events).not.toContain('Un evento futuro da non applicare');
    expect(action.result.narration).toContain('La Polonia risponde alla proposta tedesca.');
    expect(action.result.narration).not.toContain('crisi futura');
    expect(capturedPrompt).toContain('Questa modalità PREVALE su qualunque istruzione del preset');
    expect(capturedPrompt).toContain('targetDate DEVE essere identica alla data dell’unico evento emesso');
    expect(capturedPrompt).toContain('"targetDate":null');
    expect(capturedPrompt).toContain("oppure prendere un'iniziativa propria SOLO se deriva");
    jumpMode = 'normal';
  });

  it('дата берётся из targetDate ответа LLM, а не +365 дней', async () => {
    jumpMode = 'auto';
    const { session } = createGame();
    session.queueAction('Ждать важных новостей');
    await session.processNextAction(0); // jumpDays <= 0 — auto-режим

    expect(session.getCurrentDate()).toBe('1951-03-10');
    jumpMode = 'normal';
  });

  it('T24: nel salto fisso eventi distinti sulla stessa data sono ordinabili e applicati uno alla volta', async () => {
    jumpMode = 'fixed_same';
    const { session } = createGame();
    const queued = session.queueAction('Preparare una proposta');

    // Salto fisso (jumpDays > 0): il primo evento diventa checkpoint e il
    // secondo resta in attesa di conferma (§9.3). Nessun giorno inventato.
    const batch = await session.processAllPendingActions(30);
    expect((batch as any).paused).toBe(true);
    const runId = (batch as any).simulationId;
    expect(session.getCurrentDate()).toBe('1951-01-20');
    expect((session as any).getPausedRunInfo()).toMatchObject({ remaining: 1 });

    // «Continua»: il secondo evento della stessa data è applicato dopo il
    // primo, con sequenza stabile (T24) e senza aggiungere giorni.
    await (session as any).continueSimulation(runId);
    expect(session.getCurrentDate()).toBe('1951-01-20');
    expect((session as any).getPausedRunInfo()).toMatchObject({ remaining: 0 });

    // L'ultimo «Continua» autorizza l'avanzamento a destinazione.
    const done = await (session as any).continueSimulation(runId);
    expect(done.type).toBe('run_completed');
    expect(session.getCurrentDate()).toBe('1951-01-31');
    expect(session.getCurrentTurn()).toBe(2);

    // Entrambi gli eventi sono in cronaca, nello stesso ordine di sequenza.
    const runEvents = session.getResults()
      .filter((record: any) => record.simulationId === runId)
      .flatMap((record: any) => record.events);
    expect(runEvents.indexOf('Primo evento del giorno')).toBeLessThan(runEvents.indexOf('Secondo evento stesso giorno'));
    expect(runEvents).toContain('Primo evento del giorno');
    expect(runEvents).toContain('Secondo evento stesso giorno');

    // Un solo turno logico per l'intero salto (§9.1) e ordini finalized una volta sola.
    expect(db.prepare('SELECT COUNT(*) AS n FROM turn_results WHERE game_id = ? AND turn = 1').get(session.id).n).toBe(3);
    expect(session.getPendingActions().find((a: any) => a.id === queued.id)).toBeUndefined();
    jumpMode = 'normal';
  });

  it('T24: nell\'auto-jump due eventi sulla stessa data applicano solo il primo, senza aggiungere un giorno', async () => {
    jumpMode = 'auto_same';
    const { session } = createGame();
    session.queueAction('Attendere la svolta');
    const action = await session.processNextAction(0);

    expect(session.getCurrentDate()).toBe('1951-03-10');
    expect(action.result.events).toContain('Primo evento del giorno');
    expect(action.result.events).not.toContain('Secondo evento stesso giorno');
    jumpMode = 'normal';
  });
});

describe('Этап 2: сложность', () => {
  it('блок сложности доезжает до промпта симуляции', async () => {
    const { session } = createGame('hard');
    session.queueAction('Обычное действие');
    await session.processNextAction(30);
    expect(capturedPrompt).toContain('Difficoltà: Difficile');
  });

  it('без явной сложности — Обычная', async () => {
    const { session } = createGame();
    session.queueAction('Обычное действие');
    await session.processNextAction(30);
    expect(capturedPrompt).toContain('Difficoltà: Normale');
  });

  it('мусорная сложность нормализуется в Обычную', async () => {
    const { session } = createGame('impossible-mode');
    session.queueAction('Обычное действие');
    await session.processNextAction(30);
    expect(capturedPrompt).toContain('Difficoltà: Normale');
  });
});

describe('Этап 2: консолидация истории', () => {
  it('сжимает старые раунды через LLM и персистит результат; повтор без новых раундов — no-op', async () => {
    const { gameId, session } = createGame();

    // Симулируем 26 прожитых раундов без реальных ходов
    (session as any).currentTurn = 27;
    (session as any).results = Array.from({ length: 26 }, (_, i) => ({
      id: `r${i + 1}`,
      turn: i + 1,
      narration: `Раунд ${i + 1}: что-то произошло`,
      countryResponse: '',
      events: [],
    }));
    (session as any).consolidatedUpTo = 0;
    (session as any).consolidatedHistory = '';

    consolidationCalls = 0;
    await (session as any).maybeConsolidate();

    expect(consolidationCalls).toBe(1);
    expect((session as any).consolidatedHistory).toContain('КОНСПЕКТ');
    expect((session as any).consolidatedUpTo).toBe(26);

    const row = db.prepare('SELECT consolidated_history, consolidated_up_to FROM games WHERE id = ?').get(gameId);
    expect(row.consolidated_history).toContain('КОНСПЕКТ');
    expect(row.consolidated_up_to).toBe(26);

    // Новых раундов нет — повторный вызов ничего не делает
    await (session as any).maybeConsolidate();
    expect(consolidationCalls).toBe(1);
  });

  it('до startRound консолидация не запускается', async () => {
    const { session } = createGame();
    (session as any).currentTurn = 10;
    (session as any).results = Array.from({ length: 9 }, (_, i) => ({
      id: `x${i}`, turn: i + 1, narration: 'n', countryResponse: '', events: [],
    }));
    (session as any).consolidatedUpTo = 0;

    consolidationCalls = 0;
    await (session as any).maybeConsolidate();
    expect(consolidationCalls).toBe(0);
  });

  it('consolida la memoria senza perdere la cronaca persistita paginabile', async () => {
    const { gameId, session } = createGame();
    // Simula 150 turni già persistiti nel DB.
    const insert = db.prepare(`
      INSERT INTO turn_results (id, game_id, turn, narration, country_response, events, timeline_events, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let t = 1; t <= 150; t++) {
      const ev = [{ id: `ev-${t}`, date: '1951-01-01', headline: `Evento ${t}`, detail: 'd', source: 'world' }];
      insert.run(`turn-${t}`, gameId, t, '', '[]', '[]', JSON.stringify(ev), '1951-01-01');
    }

    // Pagina 1: i primi 50 turni.
    const page1 = session.getTimelinePage(0, 50);
    expect(page1.timeline.length).toBe(50);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextAfter).toBe(50);
    expect(page1.timeline[0].turn).toBe(1);
    expect(page1.timeline[0].events[0].headline).toBe('Evento 1');

    // Pagina 2: continua dal cursore.
    const page2 = session.getTimelinePage(page1.nextAfter, 50);
    expect(page2.timeline[0].turn).toBe(51);
    expect(page2.hasMore).toBe(true);

    // Pagina finale.
    const page3 = session.getTimelinePage(page2.nextAfter, 50);
    expect(page3.timeline.length).toBe(50);
    expect(page3.hasMore).toBe(false);
    expect(page3.timeline.at(-1)!.turn).toBe(150);
  });
});

describe('§9.3 — playback «un evento alla volta» per i salti fissi', () => {
  it('committa un checkpoint per evento; gli effetti globali solo a destinazione raggiunta', async () => {
    jumpMode = 'multi';
    const { session } = createGame();
    const queued = session.queueAction('Espandere l’influenza occidentale');

    // 90 giorni: destinazione 1951-04-01. Due eventi proposti (20/01, 10/02).
    const batch = await session.processAllPendingActions(90);
    const pausedResult = batch as any;
    expect(pausedResult.paused).toBe(true);
    expect(pausedResult.type).toBe('awaiting_next');
    expect(pausedResult.event.headline).toBe('Prima svolta del periodo');
    expect(pausedResult.event.date).toBe('1951-01-20');
    expect(pausedResult.remaining).toBe(1);
    expect(pausedResult.destination).toBe('1951-04-01');

    // Il primo evento è APPLICATO; il secondo resta una proposta non applicata.
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('DEU');
    expect(session.getRegion(`${WORLD_ID}_CZE`).owner).toBe('CZE');
    expect(session.getRegion(`${WORLD_ID}_GBR`).owner).toBe('GBR');
    expect(session.getCurrentDate()).toBe('1951-01-20');
    // Il turno cresce UNA volta per l’intero salto, non per evento.
    expect(session.getCurrentTurn()).toBe(2);

    // Il run è in pausa durevole: stato, checkpoint e proposte persistite.
    const run = db.prepare('SELECT status, checkpoint_date, checkpoint_id, turn, pending_state FROM simulation_runs WHERE id = ?')
      .get(pausedResult.simulationId) as any;
    expect(run.status).toBe('awaiting_next');
    expect(run.checkpoint_date).toBe('1951-01-20');
    expect(run.turn).toBe(1);
    const persisted = JSON.parse(run.pending_state);
    expect(persisted.remainingEvents).toHaveLength(1);
    expect(persisted.remainingEvents[0].headline).toBe('Seconda svolta del periodo');
    expect(persisted.destination).toBe('1951-04-01');
    // L’ordine è emesso: resta in coda come «processing», non è reinviato.
    expect(session.getPendingActions()[0]).toMatchObject({ id: queued.id, status: 'processing' });

    // Checkpoint per-evento con revisione crescente.
    const cp1 = db.prepare('SELECT revision, turn, game_date FROM simulation_checkpoints WHERE id = ?').get(run.checkpoint_id) as any;
    expect(cp1).toMatchObject({ revision: 2, turn: 1, game_date: '1951-01-20' });
    const eventRow = db.prepare('SELECT game_date, headline, checkpoint_id FROM simulation_events WHERE run_id = ?').get(pausedResult.simulationId) as any;
    expect(eventRow).toMatchObject({ game_date: '1951-01-20', headline: 'Prima svolta del periodo' });

    // «Continua»: il secondo evento diventa checkpoint, il mondo resta in pausa.
    const second = await (session as any).continueSimulation(pausedResult.simulationId) as any;
    expect(second.type).toBe('awaiting_next');
    expect(second.event.headline).toBe('Seconda svolta del periodo');
    expect(session.getRegion(`${WORLD_ID}_CZE`).owner).toBe('DEU');
    expect(session.getRegion(`${WORLD_ID}_GBR`).owner).toBe('GBR'); // effetti globali NON anticipati
    expect(session.getCurrentDate()).toBe('1951-02-10');
    expect((session as any).getPausedRunInfo()).toMatchObject({ remaining: 0 });

    // Ultimo «Continua»: avanzamento deterministico a destinazione e chiusura.
    const done = await (session as any).continueSimulation(pausedResult.simulationId) as any;
    expect(done.type).toBe('run_completed');
    expect(session.getCurrentDate()).toBe('1951-04-01');
    expect(session.getCurrentTurn()).toBe(2);
    // Solo ora gli effetti globali del periodo completato si applicano.
    expect(session.getRegion(`${WORLD_ID}_GBR`).owner).toBe('DEU');

    // Il run è chiuso: completed, con il checkpoint finale a destinazione.
    const finished = db.prepare('SELECT status, checkpoint_date FROM simulation_runs WHERE id = ?').get(pausedResult.simulationId) as any;
    expect(finished).toMatchObject({ status: 'completed', checkpoint_date: '1951-04-01' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE run_id = ?').get(pausedResult.simulationId).n).toBe(3);
    // Due eventi canonici + i bollettini economici del periodo finale.
    const eventRows = db.prepare('SELECT headline FROM simulation_events WHERE run_id = ? ORDER BY rowid').all(pausedResult.simulationId) as any[];
    expect(eventRows.map(row => row.headline)).toContain('Prima svolta del periodo');
    expect(eventRows.map(row => row.headline)).toContain('Seconda svolta del periodo');

    // Ordini finalized UNA volta sola, con esiti collegati agli eventi applicati.
    expect(session.getPendingActions()).toHaveLength(0);
    const outcome = db.prepare('SELECT status, summary, event_headlines FROM simulation_action_outcomes WHERE run_id = ?')
      .get(pausedResult.simulationId) as any;
    expect(outcome).toMatchObject({
      status: 'accepted',
      summary: 'L’espansione occidentale procede per tappe.',
      event_headlines: JSON.stringify(['Prima svolta del periodo', 'Seconda svolta del periodo']),
    });
    jumpMode = 'normal';
  });

  it('T36: budget esaurito a metà salto → paused_budget, destinazione NON raggiunta', async () => {
    jumpMode = 'budget';
    const { session } = createGame();
    session.queueAction('Gestire la crisi');

    // Stream NDJSON troncato: due eventi, nessun record «complete».
    const batch = await session.processAllPendingActions(90) as any;
    expect(batch.paused).toBe(true);
    expect(batch.event.headline).toBe('Crisi a metà periodo');
    expect((session as any).getPausedRunInfo()).toMatchObject({ incomplete: true });

    const second = await (session as any).continueSimulation(batch.simulationId) as any;
    // L’ultimo evento applicato chiude il run: il budget non ha coperto il resto.
    expect(second.type).toBe('paused_budget');
    expect(second.newDate).toBe('1951-02-10');
    expect(session.getCurrentDate()).toBe('1951-02-10');
    expect(second.destination).toBe('1951-04-01');

    const run = db.prepare('SELECT status, checkpoint_date FROM simulation_runs WHERE id = ?').get(batch.simulationId) as any;
    expect(run).toMatchObject({ status: 'paused_budget', checkpoint_date: '1951-02-10' });
    // Gli effetti globali di un periodo non coperto non entrano nel mondo.
    expect(db.prepare('SELECT pending_state FROM simulation_runs WHERE id = ?').get(batch.simulationId).pending_state).toBeNull();
    // Il periodo è dichiarato NON completato: la ripresa è un nuovo salto.
    const events = second.result.events as string[];
    expect(events.some(e => e.includes('Budget di simulazione esaurito'))).toBe(true);
    expect(session.getPendingActions()).toHaveLength(0);
    jumpMode = 'normal';
  });

  it('il playback in pausa sopravvive al riavvio del backend (§9.2/§9.3)', async () => {
    jumpMode = 'multi';
    const { gameId, session } = createGame();
    const queued = session.queueAction('Espansione verificabile');

    const batch = await session.processAllPendingActions(90) as any;
    expect(batch.paused).toBe(true);

    // Ricostruzione della sessione dal DB, come dopo un riavvio del processo.
    const game = gameRepository.findById(gameId);
    const { GameSession } = await import('../src/game-session');
    const revived = new GameSession(gameId, WORLD_ID, stubProvider);
    revived.reconstructFromDB({
      currentTurn: game.current_turn,
      currentDate: game.current_date,
      players: game.players,
      basePrompt: game.world.base_prompt,
      difficulty: game.difficulty,
    });

    // Il run in pausa e i suoi ordini «processing» sono ancora lì.
    const info = (revived as any).getPausedRunInfo();
    expect(info).toMatchObject({ simulationId: batch.simulationId, remaining: 1 });
    expect(revived.getPendingActions()[0]).toMatchObject({ id: queued.id, status: 'processing' });

    // «Continua» funziona dal nuovo processo: il mondo riprende dal checkpoint.
    const second = await (revived as any).continueSimulation(batch.simulationId) as any;
    expect(second.type).toBe('awaiting_next');
    expect(second.event.headline).toBe('Seconda svolta del periodo');
    expect(revived.getCurrentDate()).toBe('1951-02-10');
    const done = await (revived as any).continueSimulation(batch.simulationId) as any;
    expect(done.type).toBe('run_completed');
    expect(revived.getCurrentDate()).toBe('1951-04-01');
    expect(revived.getPendingActions()).toHaveLength(0);
    jumpMode = 'normal';
  });

  it('un nuovo salto durante la pausa è un conflitto esplicito (409 simulation_paused)', async () => {
    jumpMode = 'multi';
    const { session } = createGame();
    session.queueAction('Prima direttiva');
    const batch = await session.processAllPendingActions(90) as any;
    expect(batch.paused).toBe(true);

    session.queueAction('Ordine durante la pausa');
    await expect(session.processAllPendingActions(30)).rejects.toThrow('attend');
    await expect(session.processWorldAdvance(30)).rejects.toThrow('attend');
    // Il mondo non è avanzato di un giorno per il tentativo rifiutato.
    expect(session.getCurrentDate()).toBe('1951-01-20');

    // Interviene chiude il run e riabilita i salti.
    await (session as any).tryIntervenePausedRun(batch.simulationId);
    expect(session.getCurrentDate()).toBe('1951-01-20');
    jumpMode = 'normal';
  });

  it('Save durante la pausa preserva il run; Rewind lo invalida e restituisce gli ordini (§12)', async () => {
    jumpMode = 'multi';
    const { session } = createGame();
    const queued = session.queueAction('Direttiva da preservare');
    const batch = await session.processAllPendingActions(90) as any;
    expect(batch.paused).toBe(true);

    // Save durante la pausa: salva l’ultimo checkpoint confermato.
    const saved = session.save('pausa del playback');
    const snapshot = db.prepare('SELECT data FROM saves WHERE id = ?').get(saved.saveId);

    // Load: il playback scaglionato continua dal medesimo run.
    session.loadFromSave(JSON.parse(snapshot.data));
    expect((session as any).getPausedRunInfo()).toMatchObject({ simulationId: batch.simulationId, remaining: 1 });
    expect(session.getPendingActions()[0]).toMatchObject({ id: queued.id, status: 'processing' });
    const resumed = await (session as any).continueSimulation(batch.simulationId) as any;
    expect(resumed.type).toBe('awaiting_next');
    expect(resumed.event.headline).toBe('Seconda svolta del periodo');

    // Rewind di un run in pausa: ritorno all’ORIGINE del salto, ordini in coda
    // di nuovo disponibili e run scartato del ramo annullato (§12).
    jumpMode = 'multi';
    const { session: other } = createGame();
    const queued2 = other.queueAction('Direttiva annullabile');
    const batch2 = await other.processAllPendingActions(90) as any;
    expect(batch2.paused).toBe(true);
    const rewound = other.rewind();
    expect(rewound).not.toBeNull();
    expect(rewound.date).toBe('1951-01-01');
    expect(other.getRegion(`${WORLD_ID}_POL`).owner).toBe('POL');
    // L’ordine è di nuovo in coda, non consumato dal ramo annullato.
    expect(other.getPendingActions().map((a: any) => a.id)).toContain(queued2.id);
    expect(other.getPendingActions()[0].status).toBe('pending');
    // Il run del ramo annullato è invalidato e non è più proseguibile.
    expect((other as any).getPausedRunInfo()).toBeNull();
    const stale = db.prepare('SELECT status FROM simulation_runs WHERE id = ?').get(batch2.simulationId) as any;
    expect(stale.status).toBe('interrupted');
    // Un nuovo salto è di nuovo possibile.
    const again = await other.processAllPendingActions(90) as any;
    expect(again.paused).toBe(true); // orizzonte ampio: due eventi → di nuovo in pausa
    jumpMode = 'normal';
  });
});
