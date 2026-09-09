/**
 * F02 passo 3 — pubblicatore outbox separato e ripetibile.
 *
 * Gli eventi canonici entrano nell'outbox nella STESSA transazione del
 * checkpoint; la pubblicazione SSE avviene solo dopo il commit, marca
 * «published» solo dopo la diffusione e senza client le righe restano
 * «pending» per il flush alla (ri)connessione. ID stabili = deduplica.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-outbox-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let initSessionRegistry: (provider: any) => void;
let getSessionRegistry: () => any;

const WORLD_ID = 'outbox-world';
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
    { id: WORLD_ID, name: 'Outbox fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
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

function provider() {
  return {
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate(mechanic: string) {
      if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine convertito' }) };
      return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
    },
    async stream(mechanic: string, _system: string, _user: string, onToken: (count: number) => void) {
      if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
      const content = JSON.stringify({
        events: [
          { headline: 'Svolta del periodo', description: 'Evento del percorso ordinario.', date: '1951-01-15', mapChanges: [] },
        ],
        narration: 'Fixture',
        worldChanges: { regionOwners: { [REGION_ID]: 'FRA' }, regionColors: {} },
        voided: [], startChat: [], relationshipChanges: [],
      });
      onToken(content.length);
      return { content };
    },
    clearCache() {},
  };
}

describe('F02 passo 3 — outbox separato e ripetibile', () => {
  it('committa eventi e outbox insieme; pubblica solo dopo il commit; rinfusa alla riconnessione', async () => {
    initSessionRegistry(provider() as any);
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);

    // Nessun client SSE al momento del commit: le righe restano «pending».
    const result = await session.processWorldAdvance(30);
    expect(result).not.toBeNull();

    const eventRows = db.prepare('SELECT id, game_date, headline FROM simulation_events WHERE game_id = ? ORDER BY rowid')
      .all(session.id) as Array<{ id: string; game_date: string; headline: string }>;
    expect(eventRows.length).toBeGreaterThan(0);

    const outboxRows = db.prepare(`SELECT id, event_id, sequence, payload, delivery_state, published_at
      FROM simulation_outbox WHERE game_id = ? ORDER BY sequence`).all(session.id) as any[];
    // Una riga di outbox per ogni evento canonico, stessi ID stabili, ordine crescente.
    expect(outboxRows).toHaveLength(eventRows.length);
    expect(outboxRows.map((row: any) => row.event_id)).toEqual(eventRows.map(row => row.id));
    const sequences = outboxRows.map((row: any) => Number(row.sequence));
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
    expect(outboxRows.every((row: any) => row.delivery_state === 'pending' && row.published_at === null)).toBe(true);

    // Il client si (ri)connette: il flush pubblica gli eventi pendenti.
    const received: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: unknown) => { received.push({ type, data }); });
    const published = session.publishPendingOutbox();
    expect(published).toBe(eventRows.length);
    expect(received.every(item => item.type === 'world_event')).toBe(true);
    expect(received.map(item => item.data.eventId)).toEqual(eventRows.map(row => row.id));
    const first = received[0].data;
    expect(first).toMatchObject({ headline: eventRows[0].headline, date: eventRows[0].game_date });

    // Dopo la diffusione le righe sono marcate pubblicate con istante.
    const after = db.prepare(`SELECT delivery_state, published_at FROM simulation_outbox WHERE game_id = ?`).all(session.id) as any[];
    expect(after.every((row: any) => row.delivery_state === 'published' && row.published_at !== null)).toBe(true);

    // Ripetibile: un secondo flush non duplica nulla.
    const again = session.publishPendingOutbox();
    expect(again).toBe(0);
    expect(received).toHaveLength(eventRows.length);
  });

  it('un run successivo con client connesso pubblica subito al commit', async () => {
    const { session } = getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
    const received: Array<{ type: string; data: any }> = [];
    session.setSSEBroadcaster((type: string, data: unknown) => { received.push({ type, data }); });

    await session.processWorldAdvance(30);

    const outboxRows = db.prepare(`SELECT delivery_state FROM simulation_outbox WHERE game_id = ?`).all(session.id) as any[];
    expect(outboxRows.length).toBeGreaterThan(0);
    expect(outboxRows.every((row: any) => row.delivery_state === 'published')).toBe(true);
    expect(received.some(item => item.type === 'world_event' && item.data.headline === 'Svolta del periodo')).toBe(true);
  });
});