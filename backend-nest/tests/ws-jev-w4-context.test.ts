/**
 * WS-JEV-W4 — Context builder a sezioni, innestato nel PromptBuilder.
 *
 * Prova che:
 *  1. `buildMinisterContext` produce le sei sezioni, ognuna col suo budget;
 *  2. `CURRENT VERIFIED STATE` viene dal motore (`verifiedState`) e **mai** da JEV;
 *  3. i budget sono configurabili e tagliano davvero;
 *  4. flag off: nessun accesso al repository;
 *  5. il prompt reale del ministro (normal e stream) usa le sezioni e **non**
 *     ripete il dump della cronologia.
 *
 * Solo SQLite temporaneo e provider stub: nessun backend, nessuna rete.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mandateFor } from '../src/core/government/MinisterMemory';
import type { MinisterMemoryRecord } from '../src/core/government/MinisterMemory';
import { jevScopeKey, type JevMemoryRecord, type JevScope } from '../src/core/government/jev/jev.types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w4-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'memory.sqlite');
let originalEnabled = process.env.JEV_MEMORY_ENABLED;

const WORLD = 'jev-w4-world';
let db: any;
let service: typeof import('../src/core/government/jev/jev-memory.service');
let ministerRepo: typeof import('../src/repositories/minister-memory.repository').ministerMemoryRepository;
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let PromptEngine: typeof import('../src/prompt-builder').PromptEngine;
let session: any;
let scope: any;

const captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, _system: string, prompt: string) { captured.push(prompt); return { content: 'Risposta di fixture.' }; },
  async stream(_mechanic: string, _system: string, prompt: string, callback: (n: number) => void) { captured.push(prompt); callback(20); return { content: 'Risposta di fixture.' }; },
  clearCache() {},
};

function memory(over: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return { id: 'strategic', kind: 'proposal-discussed', state: 'discussed', summary: 'Avevo consigliato di NON ridurre le tasse.', refs: { gameDate: '2000-01-01', turn: 1 }, ...over };
}
function jevEvent(id: string, text: string, over: Partial<JevMemoryRecord> = {}, target: any = scope): JevMemoryRecord {
  return {
    id, gameId: target.gameId, branchId: target.branchId, scope: 'minister', scopeKey: jevScopeKey({ ...target, kind: 'minister' }),
    type: 'event', gameDate: '2000-01-01', turn: 1, createdAt: '2000-01-01T00:00:00Z', text, actors: [], topics: [],
    importance: 0.8, confidence: 0.8, status: 'active', lifecycle: 'warm', accessCount: 0, ...over,
  };
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  service = await import('../src/core/government/jev/jev-memory.service');
  ministerRepo = (await import('../src/repositories/minister-memory.repository')).ministerMemoryRepository;
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  PromptEngine = (await import('../src/prompt-builder')).PromptEngine;
  const repos = await import('../src/repositories');
  repos.worldRepository.createWithRegions(
    { id: WORLD, name: 'JEV W4', description: '', startDate: '2000-01-01', basePrompt: 'Fixture dichiarata.', historicalAccuracy: 0.8 },
    [{ id: `${WORLD}_ITA`, name: 'Italia', color: '#123456', owner: 'ITA', population: 1000, gdp: 2400, militaryPower: 10, flag: 'ITA', coastal: true, borders: [], objects: [] } as any],
  );
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession(WORLD, 'Player', `${WORLD}_ITA`, '#123456'));
  const branchId = repos.gameRepository.ensureMainBranch(session.id);
  scope = { gameId: session.id, branchId, seat: 'tesoro', mandate: mandateFor('tesoro', session.getGovernment(), session.getPlayer()?.polityId ?? null) };
});

beforeEach(() => {
  process.env.JEV_MEMORY_ENABLED = 'true';
  captured.length = 0;
  session.currentTurn = 21;
  session.currentDate = '2001-09-01';
  db.prepare('DELETE FROM minister_memory WHERE game_id = ? AND branch_id = ?').run(scope.gameId, scope.branchId);
  jevRepo.deleteBranch(scope);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('JEV-W4 buildMinisterContext', () => {
  function seed() {
    ministerRepo.upsertRecords(scope, [
      memory({ id: 'strategic', kind: 'proposal-discussed', summary: 'Avevo consigliato di NON ridurre le tasse.' }),
      memory({ id: 'open', kind: 'open-question', state: 'open', summary: 'Resta aperta la copertura del porto.' }),
    ]);
    const own: JevScope = { ...scope, kind: 'minister' };
    jevRepo.upsert(own, jevEvent('past', 'Nel 1995 il ministro avvertì che il deficit cresceva.'));
    jevRepo.upsert(own, jevEvent('promise', 'Il governo promise di non toccare le pensioni.', { type: 'promise' }));
  }

  it('produce le sei sezioni con la giusta provenienza', () => {
    seed();
    const result = service.buildMinisterContext({
      scope, query: 'tasse', verifiedState: 'STATO VERIFICATO: cassa 10 mld.',
      recentConversation: [{ role: 'user', content: 'Domanda vecchia' }, { role: 'assistant', content: 'Risposta vecchia' }],
      asOf: { gameDate: '2001-09-01', turn: 21 },
    });
    expect(result.sections.identity).toContain('MINISTER IDENTITY');
    expect(result.sections.identity).toContain('Ministro del Tesoro');
    expect(result.sections.worldState).toContain('CURRENT VERIFIED STATE');
    expect(result.sections.worldState).toContain('STATO VERIFICATO: cassa 10 mld.');
    expect(result.sections.strategicMemory).toContain('STRATEGIC MEMORY');
    expect(result.sections.strategicMemory).toContain('NON ridurre le tasse');
    expect(result.sections.relevantPast).toContain('RELEVANT PAST EVENTS');
    expect(result.sections.relevantPast).toContain('il deficit cresceva');
    expect(result.sections.unresolved).toContain('UNRESOLVED ISSUES');
    expect(result.sections.unresolved).toContain('copertura del porto');
    expect(result.sections.unresolved).toContain('non toccare le pensioni');
    expect(result.sections.recentConversation).toContain('Domanda vecchia');
    expect(result.sections.recentConversation).toContain('Risposta vecchia');
    expect(result.telemetry.model_calls).toBe(0);
    expect(result.telemetry.jev_ids).toContain('past');
  });

  it('lo stato verificato non arriva mai da JEV', () => {
    const own: JevScope = { ...scope, kind: 'minister' };
    jevRepo.upsert(own, jevEvent('claim', 'CLAIM_JEV_NEL_TESTO', { type: 'opinion', topics: ['verificato'] }));
    const result = service.buildMinisterContext({ scope, query: 'verificato', verifiedState: 'STATO_DEL_MOTORE', asOf: { gameDate: '2001-09-01', turn: 21 } });
    expect(result.sections.worldState).toContain('STATO_DEL_MOTORE');
    expect(result.sections.worldState).not.toContain('CLAIM_JEV_NEL_TESTO');
  });

  it('i budget sono configurabili e tagliano le sezioni di memoria', () => {
    seed();
    const result = service.buildMinisterContext({
      scope, query: 'tasse', verifiedState: 'stato', asOf: { gameDate: '2001-09-01', turn: 21 },
      recentConversation: [{ role: 'user', content: 'x' }],
      budget: { identity: 1, worldState: 1, strategicMemory: 1, retrievedMemory: 1, recentConversation: 1 },
    });
    expect(result.sections.strategicMemory).toBe('');
    expect(result.sections.relevantPast).toBe('');
    expect(result.sections.unresolved).toBe('');
    expect(result.sections.recentConversation).toBe('');
    expect(result.sections.worldState).toContain('stato');
  });

  it('esclude il futuro, sia legacy sia JEV', () => {
    ministerRepo.upsertRecords(scope, [memory({ id: 'future-legacy', summary: 'FUTURO_LEGACY', refs: { gameDate: '2002-01-01', turn: 40 } })]);
    const own: JevScope = { ...scope, kind: 'minister' };
    jevRepo.upsert(own, jevEvent('future-jev', 'FUTURO_JEV', { gameDate: '2002-01-01', turn: 40 }));
    const result = service.buildMinisterContext({ scope, query: 'futuro', asOf: { gameDate: '2001-09-01', turn: 21 } });
    expect(result.text).not.toContain('FUTURO_LEGACY');
    expect(result.text).not.toContain('FUTURO_JEV');
  });

  it('flag off: nessun testo e nessun accesso al repository', () => {
    seed();
    process.env.JEV_MEMORY_ENABLED = 'false';
    const listJev = vi.spyOn(jevRepo, 'listMemory');
    const listLegacy = vi.spyOn(ministerRepo, 'listMemory');
    const result = service.buildMinisterContext({ scope, query: 'tasse', verifiedState: 'stato', asOf: { gameDate: '2001-09-01', turn: 21 } });
    expect(result.text).toBe('');
    expect(result.telemetry.total_bytes).toBe(0);
    expect(listJev).not.toHaveBeenCalled();
    expect(listLegacy).not.toHaveBeenCalled();
  });

  it('rispetta il tetto complessivo e l’ordine delle sezioni', () => {
    seed();
    const result = service.buildMinisterContext({
      scope, query: 'tasse', verifiedState: 'STATO', asOf: { gameDate: '2001-09-01', turn: 21 },
      recentConversation: [{ role: 'user', content: 'domanda' }],
    });
    expect(result.telemetry.budget_bytes).toBe(4400);
    // La somma delle sezioni di memoria non supera i budget dichiarati oltre al
    // briefing del motore, che è l'unica parte intenzionalmente esente dal taglio.
    expect(result.telemetry.total_bytes).toBeLessThanOrEqual(
      400 + 800 + 1200 + 800 + Buffer.byteLength(result.sections.worldState, 'utf8'));
    // Ordine §3 di WS-GOV-MINISTER-WORLD-CONTEXT: mondo/paese prima della
    // memoria e i dati verificati del motore per ultimi (la verità più forte).
    const order = ['MINISTER IDENTITY', 'STRATEGIC MEMORY',
      'RELEVANT PAST EVENTS', 'UNRESOLVED ISSUES', 'RECENT CONVERSATION', 'CURRENT VERIFIED STATE'];
    const positions = order.map(header => result.text.indexOf(header));
    expect(positions.every(index => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('registra l’accesso alle sole evidenze JEV selezionate (touch di W3)', () => {
    seed();
    const own: JevScope = { ...scope, kind: 'minister' };
    service.buildMinisterContext({ scope, query: 'deficit', verifiedState: 'stato', asOf: { gameDate: '2001-09-01', turn: 21 } });
    expect(jevRepo.find(own, 'past')!.accessCount).toBe(1);
    expect(jevRepo.find(own, 'promise')!.accessCount).toBe(1);
  });
});

describe('JEV-W4 innesto nel prompt del ministro', () => {
  it('normal e stream: sezioni nel prompt e cronologia non ripetuta', async () => {
    ministerRepo.upsertRecords(scope, [memory({ id: 'strategic', summary: 'Avevo consigliato di NON ridurre le tasse.' })]);
    const history = Array.from({ length: 40 }, (_, n) => ({ role: (n % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `CRONACA_DUMP_${n} ${'testo '.repeat(40)}` }));
    await session.getMinisterReply('tesoro', 'Cosa mi avevi consigliato sulle tasse?', history);
    await session.getMinisterStream('tesoro', 'Cosa mi avevi consigliato sulle tasse?', history, () => {});
    for (const prompt of captured) {
      expect(prompt).toContain('CURRENT VERIFIED STATE');
      expect(prompt).toContain('STRATEGIC MEMORY');
      expect(prompt).toContain('RECENT CONVERSATION');
      expect(prompt).toContain('QUELLO CHE PORTI AL CONSIGLIO');
      expect(prompt).toContain('Cosa mi avevi consigliato sulle tasse?');
      expect(prompt.match(/NON ridurre le tasse/g)).toHaveLength(1);
      // La cronologia recente è nella sezione, non ripetuta come dump: il testo
      // più vecchio è tagliato dal budget, quello recente compare una volta sola.
      expect(prompt).not.toContain('CRONACA_DUMP_0');
      expect(prompt.match(/CRONACA_DUMP_39/g)).toHaveLength(1);
    }
  });

  it('PromptEngine: lo stato verificato diventa CURRENT VERIFIED STATE e la history non è un dump', async () => {
    const engine = new PromptEngine(provider);
    const data = session.buildGameData();
    data.currentTurn = 21; data.currentDate = '2001-09-01';
    data.ministerMemoryRequest = { scope, query: 'tasse', verifiedState: 'STATO_VERIFICATO_ENGINE' };
    await engine.getAdvisor(data, 'Domanda secca', [{ role: 'user', content: 'SCAMBIO_VECCHIO' }, { role: 'assistant', content: 'RISPOSTA_RECENTE' }]);
    expect(captured[0]).toContain('CURRENT VERIFIED STATE');
    expect(captured[0]).toContain('STATO_VERIFICATO_ENGINE');
    expect(captured[0]).toContain('RECENT CONVERSATION');
    expect(captured[0]).toContain('RISPOSTA_RECENTE');
    // La history è citata una volta sola, nella sezione: non c'è un secondo dump.
    expect(captured[0].match(/RISPOSTA_RECENTE/g)).toHaveLength(1);
  });

  it('percorso advisor senza richiesta ministro: nessuna sezione JEV nè dump sostituto', async () => {
    const engine = new PromptEngine(provider);
    const data = session.buildGameData();
    await engine.getAdvisor(data, 'Domanda advisor', [{ role: 'user', content: 'VECCHIO_ADVISOR' }]);
    expect(captured[0]).not.toContain('CURRENT VERIFIED STATE');
    expect(captured[0]).not.toContain('STRATEGIC MEMORY');
    expect(captured[0]).not.toContain('RECENT CONVERSATION');
  });
});
