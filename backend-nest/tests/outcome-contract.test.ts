/**
 * F01 — outcome mancante = outcome tecnico non risolto.
 *
 * Audit A01 / F01 passo 2: un ordine del lotto senza esito LLM non può essere
 * persistito come «accepted». Il record tecnico deve dichiarare l'assenza
 * (unresolved), mentre il payload in memoria non inventa uno status.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-outcome-contract-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;

const WORLD_ID = 'outcome-contract-world';

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
    { id: WORLD_ID, name: 'Outcome contract fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
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

describe('C01 — outcome mancante resta tecnico, mai accettazione implicita', () => {
  it('persiste unresolved per l’ordine senza esito e non inventa status in memoria', async () => {
    let actionIds: string[] = [];
    const provider = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async generate(mechanic: string) {
        if (mechanic === 'converter') {
          return { content: JSON.stringify([
            { actionId: actionIds[0], type: 'action', text: 'primo ordine' },
            { actionId: actionIds[1], type: 'action', text: 'secondo ordine' },
          ]) };
        }
        return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
      },
      async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
        if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
        const content = JSON.stringify({
          events: [{ headline: 'Checkpoint', description: 'Evento fixture', date: '1951-01-02', mapChanges: [] }],
          narration: 'Fixture',
          // Esito solo per il primo ordine: il secondo resta senza risposta.
          actionOutcomes: [
            { actionId: actionIds[0], status: 'accepted', summary: 'esito primo' },
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
    const first = session.queueAction('ordine risolto');
    const second = session.queueAction('ordine senza esito');
    actionIds = [first.id, second.id];

    const actions = await session.processAllPendingActions(2);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions[0].result.outcome).toMatchObject({ status: 'accepted', summary: 'esito primo' });
    // Nessuno status inventato nel payload in memoria del secondo ordine.
    expect(actions[1].result.outcome).toBeUndefined();

    const persisted = db.prepare(
      'SELECT action_id, status FROM simulation_action_outcomes WHERE game_id = ? ORDER BY action_id'
    ).all(session.id) as Array<{ action_id: string; status: string }>;
    const byAction = new Map(persisted.map(row => [row.action_id, row.status]));
    expect(byAction.get(first.id)).toBe('accepted');
    // Vietata l’accettazione implicita: il record tecnico dichiara l’assenza.
    expect(byAction.get(second.id)).toBe('unresolved');
  });
});