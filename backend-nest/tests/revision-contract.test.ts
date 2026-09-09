/**
 * F02 — revisione mondiale monotona (audit A02/A09).
 *
 * La revisione dei checkpoint era derivata dal turno: un run multi-evento e il
 * percorso ordinario successivo potevano produrre la stessa revisione o una
 * revisione minore. Il maestro richiede un contatore monotono di mutazioni
 * canoniche: ogni checkpoint incrementa una volta, mai il contrario.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-revision-contract-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;

const WORLD_ID = 'revision-contract-world';

/** Modalità di risposta del provider jump per il run corrente. */
let jumpMode: 'multi' | 'single' = 'multi';

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  const registry = await import('../src/session-registry');
  initSessionRegistry = registry.initSessionRegistry;
  getSessionRegistry = registry.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Revision contract fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
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

function provider() {
  return {
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate(mechanic: string) {
      if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
      return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
    },
    async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
      if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
      const events = jumpMode === 'multi'
        ? [
          { headline: 'Primo evento', description: 'Prima svolta del periodo.', date: '1951-01-10', mapChanges: [] },
          { headline: 'Secondo evento', description: 'Seconda svolta dello stesso periodo.', date: '1951-01-20', mapChanges: [] },
        ]
        : [
          { headline: 'Evento del run successivo', description: 'Svolta del periodo successivo.', date: '1951-02-10', mapChanges: [] },
        ];
      const content = JSON.stringify({
        events,
        narration: 'Fixture',
        voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} },
      });
      onToken(content.length);
      return { content };
    },
    clearCache() {},
  };
}

describe('C02/C09 — le revisioni dei checkpoint sono globalmente monotone', () => {
  it('un run multi-evento e il salto ordinario successivo non collidono mai', async () => {
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', `${WORLD_ID}-A`);

    // Run 1: salto fisso con due eventi → playback scaglionato: checkpoint
    // per ogni evento, quindi «Continua» finale fino a destinazione (§9.3).
    session.queueAction('direttiva di prova');
    const paused = await session.processAllPendingActions(30);
    expect(paused).toMatchObject({ paused: true });
    const runId = (paused as any).simulationId;
    await session.continueSimulation(runId); // secondo checkpoint per-evento
    const resumed = await session.continueSimulation(runId); // nessuna proposta: destinazione
    expect(resumed).toMatchObject({ type: 'run_completed' });

    // Run 2: salto ordinario senza nuovi ordini, un solo checkpoint.
    jumpMode = 'single';
    const world = await session.processWorldAdvance(30);
    expect(world).not.toBeNull();

    const revisions = (db.prepare(
      'SELECT revision FROM simulation_checkpoints WHERE game_id = ? ORDER BY rowid'
    ).all(session.id) as Array<{ revision: number }>).map(row => Number(row.revision));

    // Quattro checkpoint (3 del playback + finale a destinazione): ognuno deve
    // superare strettamente il precedente, anche fra run diversi.
    expect(revisions).toHaveLength(4);
    for (let i = 1; i < revisions.length; i++) {
      expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    }
  });
});