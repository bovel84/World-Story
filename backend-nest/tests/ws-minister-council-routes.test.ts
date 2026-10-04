import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { advisorSchema } from '../src/routes/games/schemas';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-minister-council-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
const originalJev = process.env.JEV_MEMORY_ENABLED;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'test.sqlite');

const council = {
  sessionId: 'route-shared-1', topic: 'Confrontare la tutela dei porti', initiatorMinister: 'esteri',
  participants: ['esteri', 'tesoro', 'guerra'], phase: 'discussion', respondingTo: 'Guerra: verificare prima le scorte.',
};
const history = [
  { role: 'assistant', content: 'Esteri: aprire prima il negoziato.' },
  { role: 'assistant', content: 'Guerra: verificare prima le scorte.' },
];
const currentDecision = { objective: 'Tutelare i porti', constraints: ['Nessuna spesa già autorizzata'] };
const reply = 'Esteri, preferisco il negoziato; Guerra, senza una verifica delle scorte mantengo una posizione condizionata.';
const captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, _system: string, prompt: string) { captured.push(prompt); return { content: reply }; },
  async stream(_mechanic: string, _system: string, prompt: string, onToken: (chars: number) => void) { captured.push(prompt); onToken(reply.length); return { content: reply }; },
  clearCache() {},
};
let db: any;
let session: any;
let server: Server;
let url: string;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const { worldRepository, gameRepository } = await import('../src/repositories');
  worldRepository.createWithRegions(
    { id: 'council-world', name: 'Council World', description: '', startDate: '1951-01-01', basePrompt: 'COUNCIL_WORLD_AUTHORITY', historicalAccuracy: 0.8 },
    [{ id: 'council-world-ITA', name: 'Italia', color: '#112233', owner: 'ITA', population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true, borders: [], objects: [] }],
  );
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession('council-world', 'Player', 'council-world-ITA', '#112233'));
  gameRepository.ensureMainBranch(session.id);
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerAdvisorRoutes(router);
  app.use('/api/games', router);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}/api/games/${session.id}/government/minister/tesoro`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalJev === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalJev;
  fs.rmSync(directory, { recursive: true, force: true });
});

async function post(stream: boolean, body: unknown) {
  const response = await fetch(url + (stream ? '/stream' : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe('minister council: actual ask/stream request propagation', () => {
  it('the existing body schema keeps council for the minister bridge', () => {
    expect(advisorSchema.parse({ message: 'Rispondi.', council }).council).toEqual(council);
  });

  it.each([
    { jev: 'false', stream: false }, { jev: 'false', stream: true },
    { jev: 'true', stream: false }, { jev: 'true', stream: true },
  ])('uses normalized context and named shared history (JEV $jev, stream $stream)', async ({ jev, stream }) => {
    process.env.JEV_MEMORY_ENABLED = jev;
    const start = captured.length;
    const result = await post(stream, {
      message: 'Rispondi ai colleghi.', history, currentDecision,
      council: { ...council, sessionId: ' route-shared-1 ', instructions: 'UNTRUSTED_EXTRA_COUNCIL_INSTRUCTIONS' },
    });
    expect(result.status).toBe(200);
    expect(stream ? result.text : JSON.parse(result.text).reply).toBe(reply);
    expect(captured).toHaveLength(start + 1);
    const prompt = captured[start];
    expect(prompt).toContain(JSON.stringify(council));
    expect(prompt).not.toContain('UNTRUSTED_EXTRA_COUNCIL_INSTRUCTIONS');
    for (const item of history) expect(prompt).toContain(item.content);
    expect(prompt).toContain(JSON.stringify(currentDecision));
    expect(prompt).toContain('COUNCIL_WORLD_AUTHORITY');
    expect(prompt).toContain('```consiglio');
    expect(prompt.match(/\[RECENT CONVERSATION\]/g)).toHaveLength(1);
  });

  it('propagates council through the legacy streaming fallback', async () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    const original = session.getMinisterStream;
    session.getMinisterStream = undefined;
    try {
      const start = captured.length;
      const result = await post(true, { message: 'Rispondi.', history, council });
      expect(result).toEqual({ status: 200, text: reply });
      expect(captured[start]).toContain(JSON.stringify(council));
    } finally { session.getMinisterStream = original; }
  });

  it.each([false, true])('rejects invalid council before generation (stream %s)', async stream => {
    for (const invalid of [null, { ...council, phase: 'signed' }, { ...council, participants: ['esteri', 'guerra'] }, { ...council, participants: ['esteri', 'tesoro', 'tesoro'] }]) {
      const count = captured.length;
      const result = await post(stream, { message: 'Rispondi.', history, council: invalid });
      expect(result.status).toBe(400);
      expect(JSON.parse(result.text).code).toBe('invalid_council');
      expect(captured).toHaveLength(count);
    }
  });

  it('does not publish partial text or terminate successfully when generation fails', async () => {
    const original = session.getMinisterStream;
    session.getMinisterStream = async (_seat: string, _message: string, _history: unknown, token: (text: string) => void) => {
      token('Partial council intervention');
      await new Promise(resolve => setTimeout(resolve, 10));
      throw new Error('Provider failed mid-stream');
    };
    try {
      const result = await post(true, { message: 'Rispondi.', history, council });
      expect(result.status).toBe(500);
      expect(result.text).not.toContain('Partial council intervention');
    } finally { session.getMinisterStream = original; }
  });

  it('does not leak council into the next legacy request', async () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    await post(false, { message: 'Rispondi.', history, council });
    const start = captured.length;
    expect((await post(false, { message: 'Come stanno i conti?', history: [] })).status).toBe(200);
    expect(captured[start]).not.toContain('route-shared-1');
    expect(captured[start]).not.toContain('```consiglio');
  });
});
