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
let jumpMode: 'normal' | 'voided' | 'auto' | 'auto_future' | 'world' | 'outcome' | 'outcome_past' | 'outcome_complete' | 'no_event' | 'intervene' | 'auto_same' = 'normal';

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
      return { content: JSON.stringify(jumpResponse()) };
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
  it('обрывает пачку: применяется только первое событие, worldChanges игнорируются, дата — по последнему событию', async () => {
    jumpMode = 'intervene';
    const { session } = createGame();

    // L'anteprima SSE permette Intervene, ma non deve pubblicare una mappa
    // non ancora committata. Il delta arriva insieme al turn_complete.
    const broadcasts: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: any) => {
      broadcasts.push({ type, data });
      if (type === 'jump_event' && data.index === 0) session.requestIntervene();
    });

    session.queueAction('Экспансия на запад');
    // Events in February must be inside the requested simulation horizon.
    const action = await session.processNextAction(90);
    expect(action.status).toBe('completed');

    // Первое событие применилось, остальные — нет
    expect(session.getRegion(`${WORLD_ID}_POL`).owner).toBe('DEU');
    expect(session.getRegion(`${WORLD_ID}_CZE`).owner).toBe('CZE');
    expect(session.getRegion(`${WORLD_ID}_FRA`).owner).toBe('FRA');
    // Итоговые worldChanges при Intervene не применяются
    expect(session.getRegion(`${WORLD_ID}_GBR`).owner).toBe('GBR');

    // Дата — по последнему ПРИМЕНЁННОМУ событию, а не +30 дней
    expect(session.getCurrentDate()).toBe('1951-02-01');

    const preview = broadcasts.find(message => message.type === 'jump_event');
    const committed = broadcasts.find(message => message.type === 'turn_complete');
    expect(preview.data).toMatchObject({ checkpoint: false });
    expect(preview.data.changedRegions).toBeUndefined();
    expect(committed.data.changedRegions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${WORLD_ID}_POL`, owner: 'DEU' }),
    ]));

    const events = action.result.events as string[];
    expect(events).toContain('ФРГ аннексировала Польшу');
    expect(events).not.toContain('ФРГ аннексировала Францию');
    expect(events.some(e => e.includes('Intervene'))).toBe(true);
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

  it('T24: nel salto fisso eventi distinti sulla stessa data sono ordinabili e applicati insieme', async () => {
    jumpMode = 'fixed_same';
    const { session } = createGame();
    session.queueAction('Preparare una proposta');

    // Salto fisso (jumpDays > 0): entrambi gli eventi della stessa data possono
    // comparire; la data finale segue il periodo, non un giorno inventato.
    await session.processNextAction(30);

    const last = session.getResults().at(-1) as any;
    expect(last.events).toContain('Primo evento del giorno');
    expect(last.events).toContain('Secondo evento stesso giorno');
    expect(session.getCurrentDate()).toBe('1951-01-31');
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
