import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memorySection, mandateFor, type MinisterMemoryRecord } from '../src/core/government/MinisterMemory';
import { jevScopeKey, type JevMemoryRecord, type JevScope } from '../src/core/government/jev/jev.types';

const dbPath = path.join(os.tmpdir(), `jev-w3-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = dbPath;
let db: any, ministerRepo: any, jevRepo: any, service: any, PromptEngine: any, gameRepo: any, session: any, scope: any;
let captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  generate: async (_mechanic: string, _system: string, prompt: string) => { captured.push(prompt); return { content: 'Risposta di fixture.' }; },
  stream: async (_mechanic: string, _system: string, prompt: string, callback: (n: number) => void) => { captured.push(prompt); callback(20); return { content: 'Risposta di fixture.' }; },
  clearCache() {},
};
const oldAdvice: MinisterMemoryRecord = { id: 'tax-advice', kind: 'proposal-discussed', state: 'discussed', summary: 'Avevo consigliato di NON ridurre le tasse per proteggere il bilancio.', refs: { messageId: 'advice-1', gameDate: '2000-01-01', turn: 1 } };
function event(id: string, text: string, overrides: Partial<JevMemoryRecord> = {}, target = scope): JevMemoryRecord {
  return { id, gameId: target.gameId, branchId: target.branchId, scope: 'minister', scopeKey: jevScopeKey({ ...target, kind: 'minister' }), type: 'event', gameDate: '2000-01-01', turn: 1, createdAt: '2000-01-01T00:00:00Z', text, actors: [], topics: [], importance: 0.8, confidence: 0.8, status: 'active', lifecycle: 'warm', accessCount: 0, ...overrides };
}
function snapshot() { return JSON.stringify(db.prepare('SELECT * FROM games').all()) + JSON.stringify(db.prepare('SELECT * FROM pending_actions').all()); }

beforeAll(async () => {
  const database = await import('../src/database'); db = database.default; database.initDatabase();
  ministerRepo = (await import('../src/repositories/minister-memory.repository')).ministerMemoryRepository;
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  service = await import('../src/core/government/jev/jev-memory.service');
  PromptEngine = (await import('../src/prompt-builder')).PromptEngine;
  const repos = await import('../src/repositories'); gameRepo = repos.gameRepository;
  repos.worldRepository.createWithRegions({ id: 'jev-world', name: 'JEV fixture', startDate: '2000-01-01', basePrompt: 'Fixture dichiarata.' }, [{ id: 'jev-ITA', name: 'Italia', owner: 'ITA', color: '#123456', population: 1000, gdp: 2400, militaryPower: 10, borders: [], objects: [] }]);
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession('jev-world', 'Player', 'jev-ITA'));
  const branchId = gameRepo.ensureMainBranch(session.id);
  scope = { gameId: session.id, branchId, seat: 'tesoro', mandate: mandateFor('tesoro', session.getGovernment(), session.getPlayer()?.polityId ?? null) };
});
beforeEach(() => {
  process.env.JEV_MEMORY_ENABLED = 'true'; captured = [];
  // Explicit cursor fixture: twenty elapsed turns, not twenty executed simulations.
  session.currentTurn = 21; session.currentDate = '2001-09-01';
  db.prepare('DELETE FROM minister_memory WHERE game_id=? AND branch_id=?').run(scope.gameId, scope.branchId);
  jevRepo.deleteBranch(scope);
  db.prepare('UPDATE games SET current_turn=21,"current_date"=? WHERE id=?').run('2001-09-01', scope.gameId);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.JEV_MEMORY_ENABLED; });
afterAll(() => { db?.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true }); });

describe('JEV-W3: estensione della memoria ministro', () => {
  it('dopo 20 turni seleziona consiglio ignorato ed esito senza duplicare MinisterMemory', () => {
    ministerRepo.upsertRecords(scope, [oldAdvice,
      { id: 'tax-order', kind: 'queued-decision', state: 'executed', summary: 'Il Presidente ha ridotto le tasse nonostante il consiglio contrario.', refs: { orderId: 'order-1', gameDate: '2000-02-01', turn: 2 } },
      { id: 'tax-outcome', kind: 'verified-outcome', state: 'verified', summary: 'Il bilancio verificato registra un peggioramento del deficit dopo la riforma fiscale.', refs: { orderId: 'order-1', gameDate: '2001-09-01', turn: 21 } },
      { ...oldAdvice, id: 'war', summary: 'Discussione di guerra sulle truppe e la difesa.', refs: { gameDate: '2001-08-01', turn: 20 } }]);
    const before = snapshot();
    const recalled = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'Cosa mi avevi consigliato sulle tasse?', 1200);
    expect(recalled.text).toContain('NON ridurre le tasse'); expect(recalled.text).toContain('nonostante'); expect(recalled.text).toContain('peggioramento del deficit');
    expect(recalled.text).not.toContain('truppe'); expect(recalled.tokenUpperBound).toBeLessThanOrEqual(1200);
    expect(jevRepo.listMemory({ ...scope, kind: 'minister' })).toHaveLength(0);
    expect(ministerRepo.listMemory(scope)).toHaveLength(4); expect(snapshot()).toBe(before);
  });
  it('non scarta un consiglio pertinente dietro 40 righe legacy di priorità più alta', () => {
    ministerRepo.upsertRecords(scope, [oldAdvice]);
    ministerRepo.upsertRecords(scope, Array.from({ length: 40 }, (_, n) => ({ ...oldAdvice, id: `noise-${n}`, kind: 'proposal-rejected', state: 'rejected', summary: 'Truppe di guerra e difesa.', refs: { gameDate: '2001-08-01', turn: 20 } })));
    const result = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse');
    expect(result.text).toContain('NON ridurre le tasse');
  });
  it('non perde il motivo di rifiuto o un passo pertinente in fondo a un testo lungo', () => {
    ministerRepo.upsertRecords(scope, [{ ...oldAdvice, id: 'steel', kind: 'proposal-rejected', state: 'rejected', summary: 'Informativa amministrativa. '.repeat(40), reason: 'Manca l’acciaio.' }]);
    jevRepo.upsert({ ...scope, kind: 'minister' }, event('long', `${'Introduzione generica. '.repeat(40)} La promessa sull’acciaio non fu mantenuta.`));
    const result = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'acciaio');
    expect(result.text).toContain('Manca l’acciaio'); expect(result.text).toContain('non fu mantenuta'); expect(result.tokenUpperBound).toBeLessThanOrEqual(1200);
  });
  it('archiviati e superseded non consumano il limite prima del filtro di retrieval', () => {
    const own: JevScope = { ...scope, kind: 'minister' };
    db.transaction(() => {
      for (let n = 0; n < 5000; n++) jevRepo.upsert(own, event(`archive-${n}`, 'Vecchie tasse ARCHIVIATO', { importance: 1, lifecycle: 'archived' }));
      jevRepo.upsert(own, event('eligible', 'Promessa attiva sulle tasse.', { importance: 0.5 }));
    })();
    expect(service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse').jevIds).toEqual(['eligible']);
  });
  it('Unicode e budget minimo: niente overflow né stringhe spezzate; solo metadata di accesso', () => {
    const own: JevScope = { ...scope, kind: 'minister' };
    jevRepo.upsert(own, event('utf', `${'🙂 '.repeat(150)} Consiglio sulle tasse: non ridurle.`));
    const first = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse', 1200);
    const second = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse', 1200);
    expect(first.text).toBe(second.text); expect(first.text).not.toContain('\uFFFD'); expect(first.tokenUpperBound).toBeLessThanOrEqual(1200);
    expect(first.telemetry.model_calls).toBe(0); expect(first.telemetry.scopes_consulted).toHaveLength(1);
    expect(service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse', 1).text).toBe('');
  });
  it('legge JEV del solo mandato/ramo/game e conserva il numero come claim, mai stato', () => {
    const own: JevScope = { ...scope, kind: 'minister' };
    jevRepo.upsert(own, event('claim', 'Il ministro sosteneva un deficit di 999 miliardi.', { type: 'opinion', topics: ['budget'] }));
    for (const [index, target] of [{ ...scope, branchId: 'other' }, { ...scope, gameId: 'other' }, { ...scope, seat: 'guerra' }, { ...scope, mandate: 'new' }].entries()) {
      const isolated: JevScope = { ...target, kind: 'minister' };
      jevRepo.upsert(isolated, event(`isolated-${index}`, 'Deficit SEGRETO_DI_ALTRO_SCOPE', {}, target));
    }
    const before = snapshot();
    const result = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'deficit', 1200);
    expect(result.text).toContain('999'); expect(result.text).toContain('stato verificato'); expect(result.text).not.toContain('SEGRETO');
    expect(result.jevIds).toEqual(['claim']); expect(snapshot()).toBe(before);
  });
  it('evento importante remoto supera rumore recente; esclude futuro e archiviati', () => {
    const own: JevScope = { ...scope, kind: 'minister' };
    for (const record of [event('old', 'Promessa fiscale decisiva sulle tasse.', { gameDate: '1990-01-01', importance: 1, type: 'promise' }), event('recent', 'Piccolo dettaglio sulle tasse.', { importance: 0.01 }), event('future', 'Tasse FUTURO', { gameDate: '2050-01-01', turn: 600 }), event('archived', 'Tasse ARCHIVIATO', { lifecycle: 'archived' })]) jevRepo.upsert(own, record);
    const result = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse', 500);
    expect(result.jevIds[0]).toBe('old'); expect(result.text).not.toMatch(/FUTURO|ARCHIVIATO/);
    expect(jevRepo.find(own, 'old').accessCount).toBe(1); expect(jevRepo.find(own, 'future').accessCount).toBe(0);
  });
  it('flag off: stesso blocco legacy, zero letture/scritture JEV anche senza tabella', async () => {
    ministerRepo.upsertRecords(scope, [oldAdvice]); process.env.JEV_MEMORY_ENABLED = 'false';
    db.exec('DROP TABLE jev_memory');
    try {
      const result = service.getMinisterMemory(scope.gameId, scope.branchId, scope.seat, scope.mandate, 'tasse', 1);
      expect(result.text).toBe(memorySection({ scope, records: ministerRepo.listMemory(scope) }));
      await session.getMinisterReply('tesoro', 'Tasse?', []);
      const legacy = session.ministerPrompt('tesoro', 'Tasse?');
      const engine = new PromptEngine(provider);
      await engine.getAdvisor(session.buildGameData(), legacy, []);
      expect(captured[0]).toBe(captured[1]);
    } finally { (await import('../src/database')).initDatabase(); }
  });
  it('innesto reale normal/stream: domanda autentica e legacy presenti una volta, identità stabile', async () => {
    ministerRepo.upsertRecords(scope, [oldAdvice]);
    const before = snapshot();
    await session.getMinisterReply('tesoro', 'Cosa consigliavi sulle tasse?', []);
    await session.getMinisterStream('tesoro', 'Cosa consigliavi sulle tasse?', [], () => {});
    for (const prompt of captured) {
      expect(prompt).toContain('NON ridurre le tasse');
      expect(prompt.match(/NON ridurre le tasse/g)).toHaveLength(1);
      expect(prompt).toContain('Cosa consigliavi sulle tasse?'); expect(prompt).toContain('QUELLO CHE PORTI AL CONSIGLIO');
    }
    expect(snapshot()).toBe(before);
  });
  it.each([true, false].flatMap(enabled => [true, false].flatMap(preset => [true, false].map(stream => ({ enabled, preset, stream })))))
  ('contratto normal/stream e preset/default, enabled=$enabled preset=$preset stream=$stream', async ({ enabled, preset, stream }) => {
    ministerRepo.upsertRecords(scope, [oldAdvice]); process.env.JEV_MEMORY_ENABLED = String(enabled);
    const data = session.buildGameData();
    data.ministerMemoryRequest = { scope, query: 'tasse' };
    if (preset) data.prompts = { advisor: 'PRESET_TEST: ruolo storico.' };
    const prompt = session.ministerPrompt('tesoro', 'Tasse?', !enabled);
    const reads = vi.spyOn(jevRepo, 'listMemory');
    const engine = new PromptEngine(provider);
    if (stream) await engine.getAdvisorStream(data, prompt, [], () => {});
    else await engine.getAdvisor(data, prompt, []);
    expect(captured[0].match(/NON ridurre le tasse/g)).toHaveLength(1);
    expect(captured[0]).toContain(enabled ? 'STRATEGIC MEMORY' : 'MEMORIA DELLA SEDUTA');
    if (preset) expect(captured[0]).toContain('PRESET_TEST');
    if (!enabled) {
      expect(reads).not.toHaveBeenCalled();
      delete data.ministerMemoryRequest;
      if (stream) await engine.getAdvisorStream(data, prompt, [], () => {});
      else await engine.getAdvisor(data, prompt, []);
      expect(captured[0]).toBe(captured[1]);
    }
  });
  it('500 turni/oltre 150k token raw: il prompt ministro non contiene l’intera cronologia', async () => {
    ministerRepo.upsertRecords(scope, [oldAdvice]);
    const data = session.buildGameData();
    data.currentTurn = 500; data.currentDate = '2040-01-01';
    data.results = Array.from({ length: 500 }, (_, turn) => ({ turn, date: '2000-01-01', narration: `RAW_${turn} ${'storia '.repeat(400)}`, events: [] }));
    expect(data.results.reduce((sum: number, r: any) => sum + r.narration.length / 4, 0)).toBeGreaterThan(150000);
    data.ministerMemoryRequest = { scope, query: 'consiglio sulle tasse' };
    const engine = new PromptEngine(provider);
    await engine.getAdvisor(data, 'consiglio sulle tasse', Array.from({ length: 500 }, (_, n) => ({ role: 'assistant', content: `SCAMBIO_${n} ${'dialogo '.repeat(30)}` })));
    const prompt = captured[0];
    expect(prompt).toContain('NON ridurre le tasse'); expect(prompt).not.toContain('RAW_0'); expect(prompt).not.toContain('SCAMBIO_0');
    expect(Math.ceil(Buffer.byteLength(prompt, 'utf8') / 4)).toBeLessThan(5000);
    const disabled = vi.spyOn(jevRepo, 'listMemory');
    process.env.JEV_MEMORY_ENABLED = 'false';
    const plain = session.buildGameData();
    await engine.getAdvisor(plain, 'Tasse?', []);
    expect(disabled).not.toHaveBeenCalled();
  });
});
