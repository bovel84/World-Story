/**
 * PLAYBACK-CRISIS-LEG — il tratto finale del playback scaglionato.
 *
 * Il playback «un evento alla volta» aggiornava la crisi a ogni evento
 * (`commitPausedStepUnlocked`) ma **non** quando il run veniva completato:
 * `completePausedRunUnlocked` portava economia, popolazione e risorse alla
 * destinazione (`advanceWorldState(elapsedDays, finalDate)`) lasciando la crisi
 * ferma all'ultimo evento. Qui si verifica che crisi ed economia arrivino alla
 * **stessa data**, che «Intervieni»/budget esaurito non simulino tempo futuro e
 * che il tratto finale possa produrre il collasso.
 *
 * Il mondo di prova è quello di CRISIS-RESIDUAL: un polity con «fatti di
 * riferimento» moderni (ITA, startDate 2026-01-01) la cui crisi di insolvenza è
 * **critica**, quindi la scala avanza di un giorno per giorno: i totali sono
 * esatti e il doppio conteggio sarebbe visibile subito.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { CRISIS_COLLAPSE_DAYS } from '../src/core/simulation/NationCrisis';
import { daysBetween } from '../src/core/simulation/calendar';

const TEST_DB = path.join(os.tmpdir(), `world-story-playback-crisis-leg-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'pcl_critical_world';
const PERIOD_START = '2026-01-01';
/** Due sviluppi nel periodo, poi la destinazione oltre l'ultimo evento. */
const EVENTS = [
  { headline: 'Primo sviluppo', description: 'Il paese regge.', date: '2026-01-10', mapChanges: [] },
  { headline: 'Secondo sviluppo', description: 'Il paese tira avanti.', date: '2026-01-20', mapChanges: [] },
];
const JUMP_DAYS = 31;
const DESTINATION = '2026-02-01';
/** Giorni di ogni tratto: periodo → evento 1 → evento 2 → destinazione. */
const LEG_1 = daysBetween(PERIOD_START, EVENTS[0].date);
const LEG_2 = daysBetween(EVENTS[0].date, EVENTS[1].date);
const LEG_3 = daysBetween(EVENTS[1].date, DESTINATION);

let db: any;
let repos: any;
let createGame: () => { gameId: string; session: any };

/** Script del salto: batch JSON con chiusura (caso normale). */
function eventsScript(events = EVENTS) {
  return () => JSON.stringify({
    events,
    narration: 'Il periodo scorre senza scossoni.',
    voided: [],
    startChat: [],
    worldChanges: { regionOwners: {}, regionColors: {} },
    actionOutcomes: [],
  });
}

/** Script NDJSON: eventi senza record di chiusura → budget esaurito (`incomplete`). */
function incompleteScript(events = EVENTS) {
  return () => events.map(event => JSON.stringify({ type: 'event', ...event })).join('\n');
}

let jumpScript: () => string = eventsScript();

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string) {
    return { content: mechanic === 'jump' ? jumpScript() : '{}' };
  },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    const content = mechanic === 'jump' ? jumpScript() : '{}';
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

/** Stato di crisi di partenza, come se i giorni fossero già maturati nel passato. */
function seedCrisis(gameId: string, days: number, episodes = 0): void {
  repos.gameRepository.saveCrisisState({
    gameId,
    criticalDays: { revolt: 0, insolvency: days, invasion: 0 },
    episodes: { revolt: 0, insolvency: episodes, invasion: 0 },
    overall: days > 0 ? 'critical' : 'calm',
    ending: null,
    updatedTurn: 1,
    updatedDate: PERIOD_START,
  });
}

function crisisOf(gameId: string) {
  return repos.gameRepository.getCrisisState(gameId)!;
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Playback Crisis Leg', description: '', startDate: PERIOD_START, basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [], objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch { /* tmp */ }
});

  it('collasso in un passo per-evento: il run si chiude al collasso, un solo game_over', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 0, 2);
    session.queueAction('Direttiva di prova');
    const events: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: any) => { events.push({ type, data }); });
    // Prima svolta oltre la soglia: la nazione cade su un passo per-evento, non
    // sul tratto finale. Il game_over esce a transazione riuscita, una volta
    // sola, e — da PLAYBACK-INTERMEDIATE-OVER — chiude qui il run: niente
    // `awaiting_next`, niente eventi successivi (vedi
    // playback-intermediate-over.test.ts).
    jumpScript = eventsScript([
      { headline: 'Lunga deriva', description: 'Il debito diventa insostenibile.', date: '2026-04-06', mapChanges: [] },
      { headline: 'Ultimo avviso', description: 'La piazza scende in strada.', date: '2026-04-20', mapChanges: [] },
    ]);
    try {
      const first = await session.processWorldAdvance(120) as any;
      expect(first.type).toBe('game_over');
      const leg = daysBetween(PERIOD_START, '2026-04-06');
      expect(leg).toBeGreaterThanOrEqual(CRISIS_COLLAPSE_DAYS);
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(leg);
      expect(crisisOf(gameId).updatedDate).toBe('2026-04-06');
      expect(crisisOf(gameId).ending).not.toBeNull();
      expect(session.isFinished()).toBe(true);
      expect(session.getPausedRunInfo()).toBeNull();
      expect(events.filter(event => event.type === 'game_over')).toHaveLength(1);
    } finally {
      jumpScript = eventsScript();
    }
  });

describe('PLAYBACK-CRISIS-LEG — invariante: stesso orologio simulato per tutti i sottosistemi', () => {
  it('primo salto, battito del mondo, salto con ordini e salto senza ordini', async () => {
    // Primo salto di una partita nuova: nessuno stato di crisi precedente.
    const pure = createGame();
    await pure.session.advanceDate(30);
    expect(pure.session.getCrisis().state.criticalDays.insolvency).toBe(30);
    expect(pure.session.getCurrentDate()).toBe('2026-01-31');
    expect(pure.session.getCrisis().state.criticalDays.insolvency)
      .toBe(daysBetween(PERIOD_START, pure.session.getCurrentDate()));

    // Battito del mondo: sette giorni, come il tempo che il mondo ha mosso.
    const ticking = createGame();
    await ticking.session.worldTick();
    expect(ticking.session.getCrisis().state.criticalDays.insolvency).toBe(7);
    expect(ticking.session.getCrisis().state.criticalDays.insolvency)
      .toBe(daysBetween(PERIOD_START, ticking.session.getCurrentDate()));

    // Salto con ordini: la crisi riceve i giorni del periodo, non i turni.
    const withOrders = createGame();
    const action = withOrders.session.queueAction('Nazionalizza le banche');
    withOrders.session.gameController.processTurnWithPrompts = vi.fn().mockResolvedValue({
      events: [{ headline: 'Decreto', description: 'Le banche passano allo Stato.', date: '2026-01-31', mapChanges: [] }],
      narration: 'Il decreto è firmato.',
      convertedActions: [],
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Decreto firmato' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    } as any);
    await withOrders.session.processNextAction(30);
    expect(withOrders.session.getCrisis().state.criticalDays.insolvency).toBe(30);
    expect(crisisOf(withOrders.gameId).updatedDate).toBe(withOrders.session.getCurrentDate());

    // Salto senza ordini (una sola proposta: percorso standard, nessuna pausa).
    const worldOnly = createGame();
    jumpScript = eventsScript([{ headline: 'Un fatto', description: 'Il mondo tira avanti.', date: '2026-01-31', mapChanges: [] }]);
    try {
      const result = await worldOnly.session.processWorldAdvance(30) as any;
      expect(result.type).toBeUndefined(); // nessuna pausa: esito di turno normale
      expect(worldOnly.session.getCurrentDate()).toBe('2026-01-31');
      expect(worldOnly.session.getCrisis().state.criticalDays.insolvency).toBe(30);
      expect(crisisOf(worldOnly.gameId).updatedDate).toBe('2026-01-31');
    } finally {
      jumpScript = eventsScript();
    }
  });
});

describe('PLAYBACK-CRISIS-LEG — il tratto finale del playback scaglionato', () => {
  it('completamento a destinazione: la crisi arriva alla stessa data dell’economia', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 0);
    session.queueAction('Direttiva di prova');

    // Evento 1: la crisi avanza del tratto periodo → 10 gennaio.
    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    expect(first.type).toBe('awaiting_next');
    expect(crisisOf(gameId).criticalDays.insolvency).toBe(LEG_1);
    expect(crisisOf(gameId).updatedDate).toBe(EVENTS[0].date);

    // Evento 2: il tratto 10 gennaio → 10 febbraio.
    const runId = first.simulationId;
    const second = await session.continueSimulation(runId) as any;
    expect(second.type).toBe('awaiting_next');
    expect(crisisOf(gameId).criticalDays.insolvency).toBe(LEG_1 + LEG_2);
    expect(crisisOf(gameId).updatedDate).toBe(EVENTS[1].date);

    // Completamento: anche il tratto 20 gennaio → 1 febbraio è tempo simulato.
    const done = await session.continueSimulation(runId) as any;
    expect(done.type).toBe('run_completed');
    expect(done.newDate).toBe(DESTINATION);

    const final = crisisOf(gameId);
    expect(final.updatedDate).toBe(DESTINATION);
    expect(final.criticalDays.insolvency).toBe(LEG_1 + LEG_2 + LEG_3);
    expect(final.episodes.insolvency).toBe(3);
    // Stesso orologio per tutti i sottosistemi: crisi ed economia sono alla
    // stessa data, e il totale è la somma dei tratti realmente simulati.
    expect(session.getCurrentDate()).toBe(DESTINATION);
    expect(LEG_1 + LEG_2 + LEG_3).toBe(daysBetween(PERIOD_START, DESTINATION));
  });

  it('nessun doppio conteggio: i giorni degli eventi non si sommano due volte', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 0);
    session.queueAction('Direttiva di prova');

    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    const runId = first.simulationId;
    await session.continueSimulation(runId);
    await session.continueSimulation(runId);

    const final = crisisOf(gameId);
    const total = LEG_1 + LEG_2 + LEG_3;
    // Corretto: 9 + 10 + 12 = 31 giorni complessivi.
    expect(total).toBe(31);
    expect(final.criticalDays.insolvency).toBe(total);
    // Un completion che ricontasse l'intero periodo (periodo → destinazione) o
    // ripartisse dal primo evento darebbe 50 o 40: mai quello che deve valere.
    const wholePeriod = daysBetween(PERIOD_START, DESTINATION);
    expect(final.criticalDays.insolvency).not.toBe(LEG_1 + LEG_2 + wholePeriod);
    expect(final.criticalDays.insolvency).not.toBe(LEG_1 + wholePeriod);
    expect(final.criticalDays.insolvency).toBeLessThan(wholePeriod + LEG_1 + LEG_2);
  });

  it('il collasso può maturare solo nel tratto finale', async () => {
    const { gameId, session } = createGame();
    // 60 giorni + i tre tratti = 91: sotto la soglia a fine evento 2, sopra solo
    // grazie ai 12 giorni finali (nella segnalazione: 80 + 30).
    seedCrisis(gameId, 60, 2);
    session.queueAction('Direttiva di prova');

    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    const runId = first.simulationId;
    await session.continueSimulation(runId);
    expect(crisisOf(gameId).criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2);
    expect(crisisOf(gameId).criticalDays.insolvency).toBeLessThan(CRISIS_COLLAPSE_DAYS);
    // Senza il tratto finale la partita sarebbe ancora in piedi.
    expect(session.isFinished()).toBe(false);
    expect(session.getEnding()).toBeNull();

    const done = await session.continueSimulation(runId) as any;
    expect(done.type).toBe('run_completed');
    const final = crisisOf(gameId);
    expect(final.criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2 + LEG_3);
    expect(final.criticalDays.insolvency).toBeGreaterThanOrEqual(CRISIS_COLLAPSE_DAYS);
    // Il motore resta l'autorità: l'epilogo nasce anche senza un altro evento.
    expect(final.ending).not.toBeNull();
    expect(session.isFinished()).toBe(true);
    expect(session.getEnding()).not.toBeNull();
  });

  it('«Intervieni qui» non simula il tempo che resta fino alla destinazione', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 60, 2);
    session.queueAction('Direttiva di prova');

    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    const runId = first.simulationId;
    const second = await session.continueSimulation(runId) as any;
    expect(second.type).toBe('awaiting_next');

    const intervened = await session.tryIntervenePausedRun(runId, second.event.id, second.revision) as any;
    expect(intervened.type).toBe('intervened');
    const after = crisisOf(gameId);
    // La crisi resta al checkpoint dell'ultimo evento: nessun giorno fino al 1° febbraio.
    expect(after.updatedDate).toBe(EVENTS[1].date);
    expect(after.criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2);
    expect(after.updatedDate).not.toBe(DESTINATION);
    expect(session.getCurrentDate()).toBe(EVENTS[1].date);
    expect(session.isFinished()).toBe(false);
  });

  it('un budget esaurito chiude all’ultimo evento, senza futuro simulato', async () => {
    jumpScript = incompleteScript();
    try {
      const { gameId, session } = createGame();
      seedCrisis(gameId, 60, 2);
      session.queueAction('Direttiva di prova');

      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      expect(first.type).toBe('awaiting_next');
      const runId = first.simulationId;

      const done = await session.continueSimulation(runId) as any;
      expect(done.type).toBe('paused_budget');
      expect(done.newDate).toBe(EVENTS[1].date);
      expect(done.result.periodEnd).toBe(EVENTS[1].date);

      const after = crisisOf(gameId);
      expect(after.updatedDate).toBe(EVENTS[1].date);
      expect(after.criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2);
      expect(session.getCurrentDate()).toBe(EVENTS[1].date);
    } finally {
      jumpScript = eventsScript();
    }
  });

  it('atomicità: un completion fallito dopo il collasso non lascia epilogo né game_over', async () => {
    const { gameId, session } = createGame();
    // 60 giorni + i tre tratti = 91: il tratto finale fa cadere la nazione
    // **dentro** la transazione, prima che il CAS dell'ancora fallisca.
    seedCrisis(gameId, 60, 2);
    session.queueAction('Direttiva di prova');

    const events: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: any) => { events.push({ type, data }); });
    const gameOverEvents = () => events.filter(event => event.type === 'game_over');
    const notes = () => (session as any).pendingNationalNotes as string[];
    const dbStatus = () => (db.prepare('SELECT status FROM games WHERE id = ?').get(gameId) as any).status;

    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    const runId = first.simulationId;
    await session.continueSimulation(runId);
    const before = crisisOf(gameId);
    expect(before.criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2);
    expect(before.updatedDate).toBe(EVENTS[1].date);
    expect(session.isFinished()).toBe(false);
    expect(notes().some(note => note.startsWith('⛔'))).toBe(false);

    // Il mondo è cambiato altrove: il CAS dell'ancora fa fallire il completion
    // DOPO l'avanzamento di economia e crisi (che nel tratto finale producono il
    // collasso), quindi la transazione rolla.
    db.prepare('UPDATE games SET current_turn = current_turn + 1 WHERE id = ?').run(gameId);
    await expect(session.continueSimulation(runId)).rejects.toThrow(/world_anchor_conflict/);

    // DB: la crisi è tornata al checkpoint precedente, senza epilogo.
    const after = crisisOf(gameId);
    expect(after.criticalDays.insolvency).toBe(before.criticalDays.insolvency);
    expect(after.episodes.insolvency).toBe(before.episodes.insolvency);
    expect(after.updatedDate).toBe(before.updatedDate);
    expect(after.ending).toBeNull();
    expect(dbStatus()).toBe('playing');
    // RAM: la partita non è finita, e il collasso fallito non ha lasciato tracce.
    expect(session.isFinished()).toBe(false);
    expect(session.getEnding()).toBeNull();
    expect(session.getStatus()).toBe('playing');
    expect(notes().some(note => note.startsWith('⛔'))).toBe(false);
    // Il client non ha mai visto un game_over che il rollback ha cancellato.
    expect(gameOverEvents()).toHaveLength(0);

    // Ripristinata l'ancora del mondo, il «Continua» riesegue il tratto finale
    // una sola volta: 79 + 12 = 91, un solo collasso, un solo game_over.
    db.prepare('UPDATE games SET current_turn = ?, current_date = ? WHERE id = ?')
      .run(session.getCurrentTurn(), session.getCurrentDate(), gameId);
    const retried = await session.continueSimulation(runId) as any;
    expect(retried.type).toBe('run_completed');
    expect(crisisOf(gameId).criticalDays.insolvency).toBe(60 + LEG_1 + LEG_2 + LEG_3);
    expect(crisisOf(gameId).updatedDate).toBe(DESTINATION);
    expect(crisisOf(gameId).ending).not.toBeNull();
    expect(session.isFinished()).toBe(true);
    expect(session.getEnding()).not.toBeNull();
    expect(notes().some(note => note.startsWith('⛔'))).toBe(true);
    expect(gameOverEvents()).toHaveLength(1);
  });

  it('completion riuscito con collasso: il game_over esce una sola volta, dopo il commit', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 60, 2);
    session.queueAction('Direttiva di prova');

    const events: Array<{ type: string; data: any }> = [];
    let finishedWhenBroadcast = false;
    session.setSSEBroadcaster((type: string, data: any) => {
      // A commit avvenuto lo stato è già coerente quando l'evento esce.
      if (type === 'game_over') finishedWhenBroadcast = session.isFinished();
      events.push({ type, data });
    });

    const first = await session.processWorldAdvance(JUMP_DAYS) as any;
    const runId = first.simulationId;
    await session.continueSimulation(runId);
    // Nessun collasso prima del tratto finale: niente game_over nei passi.
    expect(events.filter(event => event.type === 'game_over')).toHaveLength(0);

    const done = await session.continueSimulation(runId) as any;
    expect(done.type).toBe('run_completed');
    const gameOver = events.filter(event => event.type === 'game_over');
    expect(gameOver).toHaveLength(1);
    expect(finishedWhenBroadcast).toBe(true);
    expect((gameOver[0].data as any).ending).toBeTruthy();
    expect((gameOver[0].data as any).date).toBe(DESTINATION);
  });
});
