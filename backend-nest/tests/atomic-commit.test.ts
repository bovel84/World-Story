/**
 * F02 — commit atomico del checkpoint (audit A02/C02).
 *
 * Le scritture canoniche di un checkpoint (regioni, turno/data, checkpoint,
 * eventi, esiti, chiusura run) devono avvenire in un'unica transazione breve:
 * un errore a metà commit non può lasciare nel DB uno stato misto (es.
 * checkpoint del futuro accanto a un mondo rimasto al passato).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-atomic-commit-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;

const WORLD_ID = 'atomic-commit-world';
const REGION_ID = `${WORLD_ID}-A`;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  const registry = await import('../src/session-registry');
  initSessionRegistry = registry.initSessionRegistry;
  getSessionRegistry = registry.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Atomic commit fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
    [{ id: REGION_ID, name: 'A', color: '#123456', owner: 'POL', population: 1_000, gdp: 1, militaryPower: 1, flag: 'A' }],
  );
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${TEST_DB}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* fixture temporanea */ }
});

function count(table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

function provider() {
  return {
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate(mechanic: string) {
      if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
      return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
    },
    async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
      if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
      const events = eventsPerJump >= 2 ? [
        { headline: 'Prima svolta', description: 'Primo evento del periodo.', date: '1951-01-15', mapChanges: [] },
        { headline: 'Seconda svolta', description: 'Secondo evento del periodo.', date: '1951-01-25', mapChanges: [] },
      ] : [
        { headline: 'Svolta del periodo', description: 'Evento del percorso ordinario.', date: '1951-01-15', mapChanges: [] },
      ];
      const content = JSON.stringify({
        events,
        narration: 'Fixture',
        worldChanges: { regionOwners: { [REGION_ID]: 'FRA' }, regionColors: {} },
        voided: [], startChat: startChats, relationshipChanges: [],
        actionOutcomes: completionWithInvalidProject ? [{
          actionId: completionWithInvalidProject.actionId,
          status: 'accepted',
          summary: completionWithInvalidProject.summary,
          completesProjectId: completionWithInvalidProject.completesProjectId,
        }] : [],
      });
      onToken(content.length);
      return { content };
    },
    clearCache() {},
  };
}

let completionWithInvalidProject: { actionId: string; summary: string; completesProjectId: string } | null = null;
let startChats: Array<{ polityName: string; topic: string }> = [];
/** Numero di eventi proposti dal provider per il run corrente. */
let eventsPerJump = 1;

describe('C02 — il commit del checkpoint è atomico', () => {
  it('un errore a metà commit non lascia checkpoint né scritture orfane', async () => {
    eventsPerJump = 1;
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);

    const boom = new Error('boom simulato a metà commit');
    const spy = vi.spyOn(gameRepository, 'addSimulationEvents').mockImplementation(() => { throw boom; });
    await expect(session.processWorldAdvance(30)).rejects.toThrow('boom simulato');

    // Nessuna scrittura canonica orfana: il checkpoint del futuro non può
    // sopravvivere accanto a un mondo che il catch ha riportato al passato.
    expect(count('simulation_checkpoints')).toBe(0);
    expect(count('simulation_events')).toBe(0);
    expect(count('turn_results')).toBe(0);
    expect(count('actions')).toBe(0);
    const game = db.prepare('SELECT current_turn, "current_date" AS world_date FROM games WHERE id = ?').get(session.id) as any;
    // NB: current_date è una keyword SQLite (CURRENT_DATE): referenziarla per
    // nome in una SELECT valuta la data di oggi, non la colonna. Quotare.
    expect(game).toMatchObject({ current_turn: 1, world_date: '1951-01-01' });
    const region = db.prepare('SELECT owner FROM game_regions WHERE game_id = ? AND region_id = ?').get(session.id, REGION_ID) as any;
    expect(region).toMatchObject({ owner: 'POL' });

    // Il mondo resta utilizzabile: senza il guasto il run va a buon fine.
    spy.mockRestore();
    const result = await session.processWorldAdvance(30);
    expect(result).not.toBeNull();
    expect(count('simulation_checkpoints')).toBe(1);
  });

  it('errore SSE post-commit non provoca falso rollback e lascia outbox pending', async () => {
    eventsPerJump = 1;
    startChats = [];
    initSessionRegistry(provider() as never);
    const { gameId, session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    session.setSSEBroadcaster(() => { throw new Error('client SSE chiuso'); });
    const result = await session.processWorldAdvance(30);
    expect(result).not.toBeNull();
    expect(session.getCurrentDate()).toBe('1951-01-31');
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id=? ORDER BY created_at DESC LIMIT 1').get(gameId).status).toBe('completed');
    expect(db.prepare("SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id=? AND delivery_state='pending'").get(gameId).n).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id=?').get(gameId).n).toBe(1);
  });

  it('un rollback non trasmette chat_message creato nella transazione (F02/M06)', async () => {
    eventsPerJump = 1;
    startChats = [{ polityName: 'POL', topic: 'Messaggio non committabile' }];
    initSessionRegistry(provider() as never);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    const internal = session as unknown as { broadcast: (type: string, data: unknown) => void };
    const emitted = vi.spyOn(internal, 'broadcast');
    const boom = new Error('rollback dopo chat');
    const fail = vi.spyOn(gameRepository, 'addSimulationEvents').mockImplementation(() => { throw boom; });
    await expect(session.processWorldAdvance(30)).rejects.toThrow('rollback dopo chat');
    expect(emitted.mock.calls.some(([type]) => type === 'chat_message')).toBe(false);
    fail.mockRestore();
    emitted.mockRestore();
    startChats = [];
  });

  it('un protocol error nella chiusura del run riporta il DB al checkpoint precedente', async () => {
    eventsPerJump = 2;
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);

    // Due eventi → playback scaglionato; l’esito chiude un projectId che non
    // esiste: protocol error DENTRO la transazione di chiusura.
    eventsPerJump = 2;
    completionWithInvalidProject = { actionId: '', summary: 'Chiusura invalida', completesProjectId: 'progetto-inesistente' };
    const queued = session.queueAction('direttiva che chiude un progetto');
    completionWithInvalidProject.actionId = queued.id;
    const paused = await session.processAllPendingActions(30);
    expect(paused).toMatchObject({ paused: true });
    await session.continueSimulation((paused as any).simulationId);

    const checkpointsBefore = count('simulation_checkpoints');
    await expect(session.continueSimulation((paused as any).simulationId))
      .rejects.toThrow('simulation_protocol_error');

    // Il DB è tornato al secondo checkpoint: nessun checkpoint finale, nessun
    // esito registrato, l’ordine resta in carico (processing/issued/in_progress).
    expect(count('simulation_checkpoints')).toBe(checkpointsBefore);
    expect(count('simulation_action_outcomes')).toBe(0);
    const pending = db.prepare('SELECT status, delivery_status, execution_status FROM pending_actions WHERE id = ?')
      .get(queued.id) as any;
    expect(pending).toMatchObject({ status: 'processing', delivery_status: 'issued', execution_status: 'in_progress' });
  });

  it('un errore a metà commit scarta anche lo staging di RAM (F02 passo 4)', async () => {
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    eventsPerJump = 2;
    completionWithInvalidProject = { actionId: '', summary: 'Chiusura invalida', completesProjectId: 'progetto-inesistente' };
    const queued = session.queueAction('direttiva con progetto inesistente');
    completionWithInvalidProject.actionId = queued.id;
    const paused = await session.processAllPendingActions(30);
    await session.continueSimulation((paused as any).simulationId);

    await expect(session.continueSimulation((paused as any).simulationId))
      .rejects.toThrow('simulation_protocol_error');

    // La RAM riflette il DB rollbackato: l’ordine non risulta concluso e il
    // mondo resta alla data dell’ultimo checkpoint confermato.
    const ramAction = (session.getPendingActions() as any[]).find(action => action.id === queued.id);
    expect(ramAction).toMatchObject({ status: 'processing', deliveryStatus: 'issued', executionStatus: 'in_progress' });
    expect(session.getCurrentDate()).toBe('1951-01-25');
    // Il run è ancora in pausa: la finestra di decisione resta aperta.
    expect((session as any).getPausedRunInfo()).toMatchObject({ simulationId: (paused as any).simulationId });
  });

  it('CAS sull’ancora del mondo: fallisce su ancora stantia e non scrive', () => {
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    expect(gameRepository.compareAndSwapTurnAndDate(session.id, 1, '1951-01-01', 2, '1951-01-31')).toBe(true);
    // L’ancora precedente ora è stantia: il CAS non scrive.
    expect(gameRepository.compareAndSwapTurnAndDate(session.id, 1, '1951-01-01', 3, '1951-02-01')).toBe(false);
    const row = db.prepare('SELECT current_turn, "current_date" AS world_date FROM games WHERE id = ?').get(session.id) as any;
    expect(row).toMatchObject({ current_turn: 2, world_date: '1951-01-31' });
  });

  it('un writer esterno all’ancora blocca il commit del playback (fencing)', async () => {
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    eventsPerJump = 2;
    completionWithInvalidProject = null;
    const paused = await session.processAllPendingActions(30);
    expect(paused).toMatchObject({ paused: true });
    const checkpointsAfterFirst = count('simulation_checkpoints');
    const eventsAfterFirst = count('simulation_events');

    // Un writer esterno muta il mondo dietro la schiena del run.
    db.prepare('UPDATE games SET current_turn = 7 WHERE id = ?').run(session.id);

    await expect(session.continueSimulation((paused as any).simulationId))
      .rejects.toThrow('world_anchor_conflict');

    // Nessuna scrittura del playback: il DB mostra solo la mutazione esterna.
    expect(count('simulation_checkpoints')).toBe(checkpointsAfterFirst);
    expect(count('simulation_events')).toBe(eventsAfterFirst);
    const row = db.prepare('SELECT current_turn FROM games WHERE id = ?').get(session.id) as any;
    expect(row).toMatchObject({ current_turn: 7 });
    // Lo staging di RAM è scartato: la data resta quella del checkpoint letto.
    expect(session.getCurrentDate()).toBe('1951-01-15');
  });
});