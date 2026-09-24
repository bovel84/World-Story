/**
 * PLAYBACK-INTERMEDIATE-OVER — la partita terminata vince su «Continua».
 *
 * Il playback «un evento alla volta» valutava la crisi a ogni checkpoint
 * (`commitPausedStepUnlocked`, corretto da CRISIS-RESIDUAL) ma poi restituiva
 * sempre `awaiting_next`: se il collasso cadeva su un **evento intermedio** la
 * partita risultava `finished` con un run ancora aperto (`remainingEvents > 0`),
 * pronto ad applicare eventi futuri e ad avanzare fino alla destinazione.
 *
 * Qui si verifica il contratto terminale: il checkpoint del collasso è l'ultimo
 * del run, il run si chiude su quella data, gli eventi rimanenti non vengono
 * applicati, «Continua» non riapre nulla (errore di game over esistente) e il
 * percorso normale non è regredito.
 *
 * Il mondo di prova è quello di CRISIS-RESIDUAL/PLAYBACK-CRISIS-LEG: un polity
 * con fatti di riferimento moderni (ITA, startDate 2026-01-01) e un debito
 * insostenibile seminato da `seedInsolventStock`: la crisi di insolvenza è
 * **critica fin dal primo turno**, quindi la scala avanza di un giorno per giorno e i
 * totali sono esatti.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { CRISIS_COLLAPSE_DAYS } from '../src/core/simulation/NationCrisis';
import { daysBetween } from '../src/core/simulation/calendar';

const TEST_DB = path.join(os.tmpdir(), `world-story-playback-intermediate-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'pio_critical_world';
const PERIOD_START = '2026-01-01';
/** Un evento intermedio e un evento futuro mai applicato. */
const EVENT_1 = '2026-01-20';
const EVENT_2 = '2026-02-15';
// 68 giorni complessivi: sotto la soglia di collasso (90) a destinazione.
const DESTINATION = '2026-03-10';
const JUMP_DAYS = daysBetween(PERIOD_START, DESTINATION);
/** Giorni per tratto: periodo → evento 1 → evento 2 → destinazione. */
const LEG_1 = daysBetween(PERIOD_START, EVENT_1);
const LEG_2 = daysBetween(EVENT_1, EVENT_2);
const LEG_3 = daysBetween(EVENT_2, DESTINATION);

let db: any;
let repos: any;
let createGame: () => { gameId: string; session: any };

function eventsScript(events: Array<{ headline: string; description: string; date: string; mapChanges: any[] }>) {
  return () => JSON.stringify({
    events,
    narration: 'Il periodo scorre senza scossoni.',
    voided: [],
    startChat: [],
    worldChanges: { regionOwners: {}, regionColors: {} },
    actionOutcomes: [],
  });
}

const TWO_EVENTS = [
  { headline: 'Lunga deriva', description: 'Il debito diventa insostenibile.', date: EVENT_1, mapChanges: [] },
  { headline: 'Ultimo avviso', description: 'La piazza scende in strada.', date: EVENT_2, mapChanges: [] },
];

let jumpScript: () => string = eventsScript(TWO_EVENTS);

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

/**
 * Precondizione esplicita: uno **Stato sull'orlo del default**.
 *
 * La crisi di insolvenza è sostenibile per costruzione — le tranche di debito
 * ereditate sono valorizzate al tasso di carry e datate all'epoca del mondo —
 * quindi l'Italia **non** parte più in criticità come faceva quando il difetto
 * della semina le caricava il tasso di mercato pieno su titoli già scaduti.
 * Serve un debito che le entrate non coprono, dichiarato nel fixture.
 */
function seedInsolventStock(gameId: string, session: any, polityId = 'ITA'): void {
  repos.resourceRepository.upsert(gameId, polityId, {
    money: 10,
    debts: [{ id: 'crisis-fixture-1', label: 'Debito di prova (insostenibile)', principal: 3600,
      annualRatePct: 8, issuedDate: PERIOD_START, maturityDate: '2036-01-01', termYears: 10 }],
    food: 5, clothing: 5, weapons: 5, fuel: 5, research: 0, technologies: [],
  }, 0, null);
  (session as any).nationState.resourceStocks.clear();
}

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

function simulationEvents(runId: string) {
  return db.prepare('SELECT game_date, headline FROM simulation_events WHERE run_id = ? ORDER BY game_date').all(runId) as Array<{ game_date: string; headline: string }>;
}

function runRow(runId: string) {
  return db.prepare('SELECT status, checkpoint_date, pending_state FROM simulation_runs WHERE id = ?').get(runId) as any;
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
    { id: WORLD_ID, name: 'Playback Intermediate Over', description: '', startDate: PERIOD_START, basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [], objects: [],
      },
    ],
  );
  createGame = () => {
    const created = registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
    seedInsolventStock(created.gameId, created.session);
    return created;
  };
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

/** Partita che cade già **al primo** evento: 89 giorni + il tratto del 20 gennaio. */
function collapsingGame() {
  const { gameId, session } = createGame();
  const before = CRISIS_COLLAPSE_DAYS - 1; // sotto soglia all'avvio…
  expect(before).toBeLessThan(CRISIS_COLLAPSE_DAYS);
  expect(before + LEG_1).toBeGreaterThanOrEqual(CRISIS_COLLAPSE_DAYS); // …sopra al primo evento
  seedCrisis(gameId, before, 2);
  session.queueAction('Direttiva di prova');
  return { gameId, session, before };
}

describe('PLAYBACK-INTERMEDIATE-OVER — il collasso su un evento intermedio chiude il run', () => {
  it('1) il checkpoint del collasso è terminale: finished, nessun run in attesa', async () => {
    const { gameId, session, before } = collapsingGame();
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;

      // Mai «finished + awaiting_next»: l'esito del passo è terminale.
      expect(first.paused).toBe(false);
      expect(first.type).toBe('game_over');
      expect(session.isFinished()).toBe(true);
      expect(session.getEnding()).not.toBeNull();
      expect(session.getStatus()).toBe('finished');
      // Il mondo resta alla data del collasso, non alla destinazione.
      expect(session.getCurrentDate()).toBe(EVENT_1);
      expect(session.getCurrentDate()).not.toBe(DESTINATION);
      // Nessun run sospeso: la finestra di lettura non esiste più.
      expect(session.getPausedRunInfo()).toBeNull();
      expect(crisisOf(gameId).updatedDate).toBe(EVENT_1);
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(before + LEG_1);
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });

  it('2) l’evento futuro non viene applicato: fuori cronaca, fuori crisi', async () => {
    const { gameId, session, before } = collapsingGame();
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      const runId = first.simulationId;

      // Cronaca del run: l'evento del collasso c'è, il futuro no. I bollettini
      // dei conti nazionali sono datati alla data del collasso, non oltre.
      const rows = simulationEvents(runId);
      expect(rows.some(row => row.game_date === EVENT_1 && row.headline === 'Lunga deriva')).toBe(true);
      expect(rows.some(row => row.game_date === EVENT_2)).toBe(false);
      expect(rows.every(row => row.game_date <= EVENT_1)).toBe(true);
      expect(rows).not.toHaveLength(0);

      // Il tempo non è avanzato oltre il collasso: né crisi né data di gioco.
      const crisis = crisisOf(gameId);
      expect(crisis.updatedDate).toBe(EVENT_1);
      expect(crisis.criticalDays.insolvency).toBe(before + LEG_1);
      expect(crisis.episodes.insolvency).toBe(3);
      expect(session.getCurrentDate()).toBe(EVENT_1);
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });

  it('3) «Continua» a partita finita non applica nulla e non emette un secondo game_over', async () => {
    const { gameId, session, before } = collapsingGame();
    const broadcast: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: any) => { broadcast.push({ type, data }); });
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      const runId = first.simulationId;
      const before_ = { date: session.getCurrentDate(), crisis: crisisOf(gameId), events: simulationEvents(runId).length };
      const gameOvers = broadcast.filter(event => event.type === 'game_over').length;
      expect(gameOvers).toBe(1);

      // Difesa server-side con l'errore di game over esistente
      // (`GameOverError`, lo stesso delle altre porte di gioco).
      await expect(session.continueSimulation(runId)).rejects.toThrow(/^game_over: /);

      // Mondо, data e cronaca identici: nessun evento nuovo, nessuna scrittura.
      expect(session.getCurrentDate()).toBe(before_.date);
      expect(session.getPausedRunInfo()).toBeNull();
      const crisis = crisisOf(gameId);
      expect(crisis.criticalDays.insolvency).toBe(before_.crisis.criticalDays.insolvency);
      expect(crisis.updatedDate).toBe(before_.crisis.updatedDate);
      expect(simulationEvents(runId)).toHaveLength(before_.events);
      expect(broadcast.filter(event => event.type === 'game_over')).toHaveLength(1);
      expect(broadcast.some(event => event.type === 'jump_event')).toBe(false);
      expect(before + LEG_1).toBeLessThan(CRISIS_COLLAPSE_DAYS + LEG_1);
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });

  it('4) nessun tratto finale: il run è chiuso alla data del collasso', async () => {
    const { gameId, session, before } = collapsingGame();
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      const runId = first.simulationId;

      // Il run persistito è terminale e senza proposte in sospeso.
      const run = runRow(runId);
      expect(run.status).toBe('game_over');
      expect(run.checkpoint_date).toBe(EVENT_1);
      expect(run.pending_state).toBeNull();
      expect(db.prepare('SELECT status FROM games WHERE id = ?').get(gameId)).toEqual({ status: 'finished' });

      // I giorni dei tratti 2 e 3 non sono mai stati simulati.
      const crisis = crisisOf(gameId);
      expect(crisis.criticalDays.insolvency).toBe(before + LEG_1);
      expect(crisis.criticalDays.insolvency).not.toBe(before + LEG_1 + LEG_2);
      expect(crisis.criticalDays.insolvency).not.toBe(before + LEG_1 + LEG_2 + LEG_3);
      expect(session.getCurrentDate()).not.toBe(DESTINATION);
      expect(crisis.updatedDate).not.toBe(DESTINATION);
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });

  it('6) «Intervieni» a partita finita non riapre e non modifica il run', async () => {
    const { gameId, session } = collapsingGame();
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      const runId = first.simulationId;
      const before = { date: session.getCurrentDate(), crisis: crisisOf(gameId), run: runRow(runId) };

      // Nessun run in pausa: l'intervento non trova nulla da chiudere…
      expect(session.getPausedRunInfo()).toBeNull();
      expect(await session.tryIntervenePausedRun(runId, 'evento-inesistente', 1)).toBeNull();
      // …e la richiesta «durante la generazione» non è accettata: nessun flag
      // di intervento resta acceso su una partita chiusa.
      expect(session.requestIntervene(runId)).toEqual({ accepted: false });

      expect(session.getCurrentDate()).toBe(before.date);
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(before.crisis.criticalDays.insolvency);
      expect(crisisOf(gameId).updatedDate).toBe(before.crisis.updatedDate);
      expect(runRow(runId)).toEqual(before.run);
      expect(session.isFinished()).toBe(true);
      expect(session.getStatus()).toBe('finished');
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });

  it('5) percorso normale non regredito: evento 1 → evento 2 → destinazione', async () => {
    const { gameId, session } = createGame();
    seedCrisis(gameId, 0);
    session.queueAction('Direttiva di prova');
    jumpScript = eventsScript(TWO_EVENTS);
    try {
      const first = await session.processWorldAdvance(JUMP_DAYS) as any;
      expect(first.type).toBe('awaiting_next');
      expect(first.paused).toBe(true);
      expect(session.isFinished()).toBe(false);
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(LEG_1);
      expect(session.getCurrentDate()).toBe(EVENT_1);

      const runId = first.simulationId;
      const second = await session.continueSimulation(runId) as any;
      expect(second.type).toBe('awaiting_next');
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(LEG_1 + LEG_2);
      expect(session.getCurrentDate()).toBe(EVENT_2);

      const done = await session.continueSimulation(runId) as any;
      expect(done.type).toBe('run_completed');
      expect(done.newDate).toBe(DESTINATION);
      expect(session.getPausedRunInfo()).toBeNull();
      expect(crisisOf(gameId).updatedDate).toBe(DESTINATION);
      expect(crisisOf(gameId).criticalDays.insolvency).toBe(LEG_1 + LEG_2 + LEG_3);
      expect(session.isFinished()).toBe(false);
    } finally {
      jumpScript = eventsScript(TWO_EVENTS);
    }
  });
});
