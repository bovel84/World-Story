/**
 * F04 passo 3 — chat e advisor sicuri per ramo.
 *
 * La risposta chat/advisor cattura ramo/revisione all'inizio; prima di
 * scrivere verifica la validità. Politica esplicita durante un run: 409,
 * nessuna mutazione del contesto già congelato. Una risposta tardiva
 * (ramo o revisione cambiati durante l'attesa LLM) non muta il ramo nuovo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-chat-fence-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let getSessionRegistry: any;
let chatsRouter: any;

const WORLD_ID = 'fence-world';
let releaseChat: (() => void) | null = null;
let gateChat = false;

function provider(): any {
  return {
    consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
    async generate(mechanic: string, _system: string, user: string) {
      if (mechanic === 'converter') return { content: JSON.stringify({ type: 'action', text: 'ordine' }) };
      if (mechanic === 'jump') {
        return { content: JSON.stringify({
          events: [{ headline: 'Evento del percorso', description: 'Descrizione.', date: '1951-01-15', mapChanges: [] }],
          narration: 'Fixture', voided: [], startChat: [], relationshipChanges: [],
          worldChanges: { regionOwners: {}, regionColors: {} },
        }) };
      }
      if (mechanic === 'chat') {
        if (user.includes('moderatore invisibile')) return { content: JSON.stringify({ speaker: 'Polonia' }) };
        if (gateChat) await new Promise<void>(resolve => { releaseChat = resolve; });
        return { content: JSON.stringify({ message: 'Replica della controparte' }) };
      }
      return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
    },
    async stream(mechanic: string, _system: string, _user: string, onToken: (n: number) => void) {
      if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
      const content = JSON.stringify({
        events: [
          { headline: 'Evento del percorso 1', description: 'Descrizione.', date: '1951-01-15', mapChanges: [] },
          { headline: 'Evento del percorso 2', description: 'Descrizione.', date: '1951-01-25', mapChanges: [] },
        ],
        narration: 'Fixture', voided: [], startChat: [], relationshipChanges: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
      });
      onToken(content.length);
      return { content };
    },
    clearCache() {},
  };
}

async function pausedGame(): Promise<{ session: any; simulationId: string }> {
  const { session } = getSessionRegistry().createSession(WORLD_ID, 'Germania Ovest', `${WORLD_ID}_DEU`);
  session.queueAction('direttiva di prova');
  // Due eventi → playback scaglionato: il run resta in pausa all'evento 1.
  const paused = await session.processAllPendingActions(30);
  expect((paused as any).paused).toBe(true);
  return { session, simulationId: (paused as any).simulationId };
}

/** Chiude il run sospeso: commette l'evento 2 e chiude a destinazione. */
async function closeRun(session: any, simulationId: string): Promise<void> {
  await session.continueSimulation(simulationId);
  await session.continueSimulation(simulationId);
}

function messageCount(chatId: string): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id = ?').get(chatId) as any).n);
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timeout attesa condizione');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  const registry = await import('../src/session-registry');
  getSessionRegistry = registry.getSessionRegistry;
  chatsRouter = (await import('../src/routes/chats.routes')).chatsRouter;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Fence fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
    [
      { id: `${WORLD_ID}_DEU`, name: 'Germania Ovest', color: '#FF0000', owner: 'DEU', population: 5_000_000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${WORLD_ID}_POL`, name: 'Polonia', color: '#00FF00', owner: 'POL', population: 3_000_000, gdp: 100, militaryPower: 100, flag: 'POL' },
    ],
  );
  (registry as any).initSessionRegistry(provider());
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

describe('F04 passo 3 — fencing chat/advisor', () => {
  it('rifiuta la chat durante un run sospeso: 409, nessuna scrittura', async () => {
    const { session } = await pausedGame();
    expect(session.hasActiveRun()).toBe(true);
    const chat = session.ensureChat(['Polonia']);

    await expect(session.sendChatMessage(chat.id, 'Firma durante il run')).rejects.toThrow(/already in progress/i);
    expect(messageCount(chat.id)).toBe(0);
  });

  it('la risposta tardiva con revisione cambiata non scrive il ramo nuovo', async () => {
    const { session, simulationId } = await pausedGame();
    await closeRun(session, simulationId); // mondo confermato, nessun run attivo
    const chat = session.ensureChat(['Polonia']);

    gateChat = true;
    const pending = session.sendChatMessage(chat.id, 'Propongo il patto');
    await waitFor(() => messageCount(chat.id) === 1); // messaggio giocatore persistito, LLM in attesa

    gameRepository.nextWorldRevision(session.id); // simula un checkpoint commesso altrove
    releaseChat!();
    await expect(pending).rejects.toThrow(/context_changed/i);
    expect(messageCount(chat.id)).toBe(1); // nessuna replica scritta sul ramo nuovo
    gateChat = false;
  });

  it('la risposta tardiva con ramo cambiato non scrive il ramo nuovo', async () => {
    const { session, simulationId } = await pausedGame();
    await closeRun(session, simulationId);
    const chat = session.ensureChat(['Polonia']);

    gateChat = true;
    const pending = session.sendChatMessage(chat.id, 'Propongo il patto');
    await waitFor(() => messageCount(chat.id) === 1);

    const oldHead = gameRepository.getHeadBranch(session.id);
    gameRepository.createBranch({ id: 'fence-branch-x', gameId: session.id, name: 'restore-test', parentBranchId: oldHead, originCheckpointId: null });
    releaseChat!();
    await expect(pending).rejects.toThrow(/context_changed/i);
    expect(messageCount(chat.id)).toBe(1);
    expect(gameRepository.getHeadBranch(session.id)).toBe('fence-branch-x');
    gateChat = false;
  });

  it('l’advisor durante un run risponde 409 (politica esplicita)', async () => {
    const { session } = await pausedGame();
    await expect(session.getAdvisor('Che facciamo?')).rejects.toThrow(/already in progress/i);
  });
});