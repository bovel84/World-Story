/**
 * F00 → F01 hand-off: riproduzione dinamica C01.
 *
 * Due ordini con lo stesso testo ricevono outcome intenzionalmente invertiti,
 * ma identificati dal loro actionId. Il percorso legacy ignora l'ID e associa
 * per testo/indice; il test è expected-fail finché F01 non chiude il contratto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-id-contract-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let PromptBuilder: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;

/** ID correnti usati dai provider stub per echo/associazione. */
let compositeActionId: string | undefined;
let projectActionId: string | undefined;

const WORLD_ID = 'id-contract-world';

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  PromptBuilder = (await import('../src/prompt-builder')).PromptBuilder;
  const registry = await import('../src/session-registry');
  initSessionRegistry = registry.initSessionRegistry;
  getSessionRegistry = registry.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'ID contract fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
    [{ id: `${WORLD_ID}-A`, name: 'A', color: '#123456', owner: 'A', population: 1_000, gdp: 1, militaryPower: 1, flag: 'A' }],
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

describe('C01 — esiti associati mediante actionId', () => {
  it('non attribuisce outcome invertiti a ordini dal testo identico', async () => {
    let actionIds: string[] = [];
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') {
          return { content: JSON.stringify([
            { index: 1, type: 'action', text: 'ordine normalizzato identico' },
            { index: 2, type: 'action', text: 'ordine normalizzato identico' },
          ]) };
        }
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        const content = JSON.stringify({
          events: [{ headline: 'Checkpoint', description: 'Evento fixture', date: '1951-01-02', mapChanges: [] }],
          narration: 'Fixture',
          actionOutcomes: [
            { actionId: actionIds[1], action: 'ordine normalizzato identico', status: 'accepted', summary: 'esito secondo ID' },
            { actionId: actionIds[0], action: 'ordine normalizzato identico', status: 'accepted', summary: 'esito primo ID' },
          ],
          voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
        });
        onToken(content.length);
        return { content };
      },
      clearCache() {},
    };
    initSessionRegistry(provider as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const first = session.queueAction('testo duplicato');
    const second = session.queueAction('testo duplicato');
    actionIds = [first.id, second.id];

    const actions = await session.processAllPendingActions(2);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions[0].id).toBe(first.id);
    expect(actions[0].result.outcome.summary).toBe('esito primo ID');
    expect(actions[1].id).toBe(second.id);
    expect(actions[1].result.outcome.summary).toBe('esito secondo ID');
  });

  it('rifiuta outcome con actionId esterno senza mutare la coda', async () => {
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        const content = JSON.stringify({
          events: [{ headline: 'Checkpoint', description: 'Evento fixture', date: '1951-01-02', mapChanges: [] }],
          narration: 'Fixture',
          actionOutcomes: [{ actionId: 'external-action-id', status: 'accepted', summary: 'Non autorizzato' }],
          voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
        });
        onToken(content.length);
        return { content };
      },
      clearCache() {},
    };
    initSessionRegistry(provider as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const action = session.queueAction('ordine con esito esterno');

    await expect(session.processAllPendingActions(2)).rejects.toThrow('simulation_protocol_error');
    expect(session.getPendingActions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: action.id, status: 'pending' }),
    ]));
  });

  it('C07: include projectId e sourceActionId nel contesto dei processi', () => {
    const variables = new PromptBuilder({
      id: 'prompt-project-fixture', currentDate: '1951-01-01', currentTurn: 1,
      world: { name: 'Fixture', basePrompt: '', startDate: '1951-01-01', regions: {
        r1: { id: 'r1', name: 'A', color: '#123456', owner: 'A', objects: [] },
      } },
      players: [{ id: 'player', name: 'Player', regionId: 'r1', polityId: 'A' }],
      playerPolityId: 'A', actions: [], results: [],
      ongoingProcesses: [{
        id: 'project-context-id', sourceActionId: 'source-action-id', title: 'Titolo', summary: 'In corso', startedDate: '1951-01-01',
      }],
    }).buildVariables();
    expect(variables.ONGOING_PROCESSES).toContain('projectId:project-context-id; sourceActionId:source-action-id');
  });

  it('C07: chiude soltanto il projectId dichiarato, anche con titoli identici', () => {
    initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const runId = `project-run-${session.id}`;
    gameRepository.createSimulationRun({ id: runId, gameId: session.id, mode: 'fixed', startDate: '1951-01-01' });
    for (const id of ['project-A', 'project-B']) {
      gameRepository.upsertOngoingProcess({
        id, gameId: session.id, sourceActionId: `source-${id}`, sourceRunId: runId,
        title: 'Titolo duplicato', summary: 'In corso', startedDate: '1951-01-01',
      });
    }

    expect(gameRepository.completeOngoingProcessById(session.id, 'project-B', 'Concluso B')).toBe(1);
    const projects = gameRepository.snapshotOngoingProcesses(session.id);
    expect(projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project-A', status: 'ongoing', summary: 'In corso' }),
      expect.objectContaining({ id: 'project-B', status: 'completed', summary: 'Concluso B' }),
    ]));
  });
});

describe('F01 — conversione riformulata, ordine composto, contesto con zero ordini', () => {
  it('associa l’outcome al testo riformulato solo quando individua un’unica azione', async () => {
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') {
          return { content: JSON.stringify({ type: 'action', text: 'ponte ristrutturato con finanziamento regionale' }) };
        }
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        const content = JSON.stringify({
          events: [{ headline: 'Cantiere avviato', description: 'Il cantiere si avvia.', date: '1951-01-02', mapChanges: [] }],
          narration: 'Fixture',
          // Adapter legacy: l’esito cita il testo RIFORMULATO, senza actionId.
          actionOutcomes: [{
            action: 'ponte ristrutturato con finanziamento regionale',
            status: 'partial', summary: 'Progettazione in corso.', expectedDate: '1951-02-01',
          }],
          voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
        });
        onToken(content.length);
        return { content };
      },
      clearCache() {},
    };
    initSessionRegistry(provider as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const action = session.queueAction('costruire un ponte');

    const actions = await session.processAllPendingActions(2);
    expect(actions[0].id).toBe(action.id);
    expect(actions[0].result.outcome).toMatchObject({ status: 'partial', summary: 'Progettazione in corso.' });
    const projects = gameRepository.getOngoingProcesses(session.id);
    expect(projects).toEqual([expect.objectContaining({
      source_action_id: action.id,
      expected_date: '1951-02-01',
    })]);
  });

  it('ordine composto a testo multi-intento: un solo ID, un solo salto, un solo esito', async () => {
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') {
          return { content: JSON.stringify({ type: 'action', text: 'guerra al nord e cantiere portuale nello stesso piano' }) };
        }
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        const content = JSON.stringify({
          events: [{ headline: 'Offensiva e cantiere', description: 'Entrambe le direttrici del piano.', date: '1951-01-02', mapChanges: [] }],
          narration: 'Fixture',
          actionOutcomes: [{ actionId: compositeActionId!, status: 'accepted', summary: 'Piano composto avviato.' }],
          voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
        });
        onToken(content.length);
        return { content };
      },
      clearCache() {},
    };
    initSessionRegistry(provider as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const compositeText = 'Dichiara guerra al nord e avvia un cantiere portuale';
    const action = session.queueAction(compositeText);
    compositeActionId = action.id;

    const actions = await session.processAllPendingActions(2);
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe(action.id);
    expect(actions[0].result.outcome).toMatchObject({ status: 'accepted' });
    // Nessuna scomposizione implicita in salti o esiti extra.
    expect(session.getCurrentDate()).toBe('1951-01-03');
    const outcomeRows = db.prepare('SELECT action_id, status FROM simulation_action_outcomes WHERE game_id = ?')
      .all(session.id) as any[];
    expect(outcomeRows).toHaveLength(1);
    expect(outcomeRows[0]).toMatchObject({ action_id: action.id, status: 'accepted' });
    // Il testo originale resta la fonte dell’ordine, non la riformulazione.
    const stored = db.prepare('SELECT text FROM actions WHERE game_id = ?').all(session.id) as any[];
    expect(stored).toEqual([{ text: compositeText }]);
    compositeActionId = undefined;
  });

  it('C07/MAT29: il salto senza nuovi ordini mantiene i progetti nel contesto', async () => {
    let jumpCount = 0;
    let lastJumpPrompt = '';
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        lastJumpPrompt = user;
        jumpCount += 1;
        const payload: any = {
          events: [{
            headline: jumpCount === 1 ? 'Progetto avviato' : 'Il mondo prosegue',
            description: 'Fatto del periodo.',
            date: jumpCount === 1 ? '1951-01-02' : '1951-01-04',
            mapChanges: [],
          }],
          narration: 'Fixture',
          voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
        };
        if (jumpCount === 1) {
          payload.actionOutcomes = [{
            actionId: projectActionId!, status: 'partial', summary: 'In corso.', expectedDate: '1951-02-01',
          }];
        }
        const content = JSON.stringify(payload);
        onToken(content.length);
        return { content };
      },
      clearCache() {},
    };
    initSessionRegistry(provider as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);
    const action = session.queueAction('avviare il progetto di riserva idrica');
    projectActionId = action.id;
    await session.processAllPendingActions(2);
    expect(gameRepository.getOngoingProcesses(session.id)).toHaveLength(1);

    // Zero nuovi ordini: il mondo avanza e il progetto resta nel contesto.
    await session.processWorldAdvance(2);
    expect(lastJumpPrompt).toContain('[projectId:');
    expect(lastJumpPrompt).toContain(`sourceActionId:${action.id}`);
    expect(gameRepository.getOngoingProcesses(session.id)).toHaveLength(1);
    projectActionId = undefined;
  });
});
