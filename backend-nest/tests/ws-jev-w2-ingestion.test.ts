/**
 * WS-JEV-W2 — Ingestion narrativa (RED first, poi implementazione).
 *
 * Copre: classificatore deterministico KEEP/DEFER/DROP, `ingestJevMemory`
 * (idempotenza, flag off senza accesso al repository, validazione scope),
 * gli adapter governo/ministro/giocatore, l'integrazione con `getMinisterMemory`
 * (W3), la potatura/fork del repository e i due sidecar di `game.repository`.
 *
 * Soltanto SQLite temporaneo: `OPEN_PAX_DB_PATH` punta a una directory usa-e-getta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JevIngestInput, JevMemoryRecord, JevScope } from '../src/core/government/jev/jev.types';
import type { FactionMemoryEvent } from '../src/core/simulation/FactionMemory';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w2-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
const originalEnabled = process.env.JEV_MEMORY_ENABLED;
const testDbPath = path.join(directory, 'memory.sqlite');
process.env.OPEN_PAX_DB_PATH = testDbPath;
process.env.JEV_MEMORY_ENABLED = 'true';

const GAME = 'jev-w2-game';
const WORLD = 'jev-w2-world';
const MAIN = 'jev-w2-main';
const OTHER_BRANCH = 'jev-w2-other';

let db: any;
let databaseModule: typeof import('../src/database');
let service: typeof import('../src/core/government/jev/jev-memory.service');
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let gameRepo: typeof import('../src/repositories').gameRepository;
let types: typeof import('../src/core/government/jev/jev.types');
let classify: typeof import('../src/core/government/jev/jev-classify').classifyJevIngest;

/** Provider fittizio: se JEV lo invocasse, lo spy lo registrerebbe. */
const provider = { generate: vi.fn(async () => ({ content: 'x' })), stream: vi.fn(async () => ({ content: 'x' })) };

function baseInput(over: Partial<JevIngestInput> = {}): JevIngestInput {
  const scope: JevScope = over.scope ?? { kind: 'government', gameId: GAME, branchId: MAIN };
  return {
    gameId: GAME,
    branchId: MAIN,
    gameDate: '1951-01-01',
    turn: 1,
    source: 'government',
    actorIds: ['president'],
    text: 'Il governo dichiara guerra alla fazione rivale.',
    eventType: 'war_declared',
    scope,
    ...over,
  };
}

function governmentScope(branchId: string | null = MAIN): JevScope {
  return { kind: 'government', gameId: GAME, branchId };
}

beforeAll(async () => {
  databaseModule = await import('../src/database');
  db = databaseModule.default;
  databaseModule.initDatabase();
  types = await import('../src/core/government/jev/jev.types');
  service = await import('../src/core/government/jev/jev-memory.service');
  classify = (await import('../src/core/government/jev/jev-classify')).classifyJevIngest;
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  gameRepo = (await import('../src/repositories')).gameRepository;
  db.prepare('INSERT OR IGNORE INTO worlds (id, name, description, start_date, base_prompt) VALUES (?, ?, ?, ?, ?)')
    .run(WORLD, 'JEV W2', '', '1951-01-01', 'Fixture');
  db.prepare('INSERT INTO games (id, world_id, current_turn, current_date, head_branch_id) VALUES (?, ?, ?, ?, ?)')
    .run(GAME, WORLD, 1, '1951-01-01', MAIN);
});

beforeEach(() => {
  process.env.JEV_MEMORY_ENABLED = 'true';
  provider.generate.mockClear();
  provider.stream.mockClear();
  db.prepare('DELETE FROM jev_memory WHERE game_id = ?').run(GAME);
  db.prepare('DELETE FROM games WHERE id = ?').run(GAME);
  db.prepare('INSERT INTO games (id, world_id, current_turn, current_date, head_branch_id) VALUES (?, ?, ?, ?, ?)')
    .run(GAME, WORLD, 1, '1951-01-01', MAIN);
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH;
  else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED;
  else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('JEV-W2 classificatore deterministico', () => {
  it('KEEP per gli eventi noti (war_declared, treaty_signed)', () => {
    expect(classify(baseInput({ eventType: 'war_declared' })).decision).toBe('KEEP');
    expect(classify(baseInput({ eventType: 'treaty_signed', source: 'diplomacy' })).decision).toBe('KEEP');
  });

  it('DROP per ui_notification, source ui e testo vuoto', () => {
    expect(classify(baseInput({ eventType: 'ui_notification' })).decision).toBe('DROP');
    expect(classify({ ...baseInput(), source: 'ui' } as unknown as JevIngestInput).decision).toBe('DROP');
    expect(classify(baseInput({ text: '   ' })).decision).toBe('DROP');
  });

  it('DROP per testi oltre 4000 caratteri', () => {
    expect(classify(baseInput({ text: 'x'.repeat(4001) })).decision).toBe('DROP');
  });

  it('KEEP quando la simulazione porta un esito numerico verificato', () => {
    const result = classify(baseInput({ source: 'simulation', eventType: undefined, metadata: { hasNumericOutcome: true } }));
    expect(result.decision).toBe('KEEP');
  });

  it('DEFER per l’ambiguo: nessun LLM, `llmFallbackEnabled=false`', () => {
    expect(classify(baseInput({ eventType: undefined })).decision).toBe('DEFER');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
  });
});

describe('JEV-W2 ingestJevMemory', () => {
  it('KEEP scrive una sola riga e la re-ingestione identica non duplica', () => {
    const first = service.ingestJevMemory(baseInput());
    expect(first).toMatchObject({ decision: 'KEEP', stored: true, scopeKey: 'government' });
    const second = service.ingestJevMemory(baseInput());
    expect(second.id).toBe(first.id);
    const rows = jevRepo.listMemory(governmentScope());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'conflict', importance: 0.95, confidence: 0.9, lifecycle: 'hot', status: 'active', accessCount: 0 });
  });

  it('con eventId esplicito la re-ingestione aggiorna il testo nella stessa riga', () => {
    const input = baseInput({ metadata: { eventId: 'evt-update' } });
    service.ingestJevMemory(input);
    service.ingestJevMemory({ ...input, text: 'Testo aggiornato dello stesso evento.' });
    const rows = jevRepo.listMemory(governmentScope());
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('Testo aggiornato dello stesso evento.');
  });

  it('DEFER e DROP non scrivono nulla', () => {
    expect(service.ingestJevMemory(baseInput({ eventType: undefined }))).toMatchObject({ decision: 'DEFER', stored: false });
    expect(service.ingestJevMemory(baseInput({ text: '' }))).toMatchObject({ decision: 'DROP', stored: false });
    expect(jevRepo.listMemory(governmentScope())).toHaveLength(0);
  });

  it('flag off: nessuna scrittura, nessun accesso al repository, funziona senza tabella', () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    const upsert = vi.spyOn(jevRepo, 'upsert');
    db.exec('DROP TABLE jev_memory');
    try {
      const outcome = service.ingestJevMemory(baseInput());
      expect(outcome).toMatchObject({ decision: 'DROP', reason: 'jev_disabled', stored: false });
      expect(upsert).not.toHaveBeenCalled();
    } finally {
      databaseModule.initDatabase();
      upsert.mockRestore();
    }
  });

  it('valida che scope, gameId e branchId coincidano', () => {
    expect(() => service.ingestJevMemory(baseInput({ scope: { kind: 'government', gameId: 'altro', branchId: MAIN } }))).toThrow(TypeError);
    expect(() => service.ingestJevMemory(baseInput({ scope: { kind: 'government', gameId: GAME, branchId: OTHER_BRANCH } }))).toThrow(TypeError);
    expect(() => service.ingestJevMemory(baseInput({ branchId: OTHER_BRANCH }))).toThrow(TypeError);
  });

  it('un ramo diverso non vede la riga', () => {
    service.ingestJevMemory(baseInput());
    expect(jevRepo.listMemory(governmentScope())).toHaveLength(1);
    expect(jevRepo.listMemory(governmentScope(OTHER_BRANCH))).toHaveLength(0);
  });

  it('scopeKey canonico e id esplicito deterministico', () => {
    expect(service.ingestJevMemory(baseInput()).scopeKey).toBe('government');
    const input = baseInput({ metadata: { eventId: 'event-42' } });
    const id = service.ingestJevMemory(input).id;
    expect(id).toBe('jev:event-42');
    expect(service.ingestJevMemory(input).id).toBe(id);
  });

  it('esito numerico della simulazione viene persistito come outcome verificato', () => {
    const outcome = service.ingestJevMemory(baseInput({
      source: 'simulation', eventType: undefined, metadata: { hasNumericOutcome: true },
      text: 'La riforma ha ridotto l’occupazione dell’1,2%.',
    }));
    const stored = jevRepo.find(governmentScope(), outcome.id!)!;
    expect(stored.type).toBe('outcome');
    expect(stored.importance).toBe(0.9);
    expect(stored.metadata).toMatchObject({ hasNumericOutcome: true });
  });

  it('un evento invalido non fa cadere il batch: gli altri vengono ingeriti', () => {
    const bad = baseInput({ scope: { kind: 'government', gameId: 'altro', branchId: MAIN } });
    const { outcomes, telemetry } = service.ingestJevBatch([bad, baseInput({ text: 'Ordine valido del governo.' })]);
    expect(outcomes[0]).toMatchObject({ decision: 'DROP', reason: 'ingest_error', stored: false });
    expect(outcomes[1].stored).toBe(true);
    expect(telemetry.stored).toBe(1);
  });

  it('telemetria di batch con model_calls a zero', () => {
    const { outcomes, telemetry } = service.ingestJevBatch([
      baseInput(),
      baseInput({ text: '' }),
      baseInput({ eventType: undefined }),
    ]);
    expect(outcomes).toHaveLength(3);
    expect(telemetry).toMatchObject({ considered: 3, kept: 1, dropped: 1, deferred: 1, stored: 1, model_calls: 0 });
    expect(telemetry.latency_ms).toBeGreaterThanOrEqual(0);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('cappa il testo a 2000 caratteri con ellissi', () => {
    const long = `Inizio. ${'parola '.repeat(400)}`;
    service.ingestJevMemory(baseInput({ text: long }));
    const stored = jevRepo.listMemory(governmentScope())[0];
    expect(stored.text.length).toBeLessThanOrEqual(2000);
    expect(stored.text.endsWith('…')).toBe(true);
  });
});

describe('JEV-W2 adapter', () => {
  it('governmentEventInput mappa kind -> eventType, attori e topics', () => {
    const event: FactionMemoryEvent = {
      factionId: 'industry', kind: 'favor', lever: 'taxation', weight: 12,
      turn: 4, gameDate: '1951-04-01', text: 'Il governo concede sgravi all’industria.', sourceEventId: 'src-9',
    };
    const input = service.governmentEventInput(event, { gameId: GAME, branchId: MAIN, gameDate: '1951-04-01', turn: 4 });
    expect(input.scope).toEqual({ kind: 'government', gameId: GAME, branchId: MAIN });
    expect(input.eventType).toBe('government_favor');
    expect(input.actorIds).toEqual(['industry']);
    expect(input.metadata?.topics).toEqual(['taxation']);
    const outcome = service.ingestJevMemory(input);
    const stored = jevRepo.find(governmentScope(), outcome.id!)!;
    expect(stored.type).toBe('decision');
    expect(stored.importance).toBe(0.8);
    expect(stored.actors).toEqual(['industry']);
    expect(stored.topics).toEqual(['taxation']);
    expect(stored.sourceEventIds).toEqual(['src-9']);
    expect(stored.metadata).toMatchObject({ source: 'government', eventType: 'government_favor' });
  });

  it('playerDecisionInput usa lo scope governo e l’id dell’azione', () => {
    const input = service.playerDecisionInput({ gameId: GAME, branchId: MAIN, gameDate: '1951-01-01', turn: 1, actionId: 'act-7', text: 'Ordino il taglio delle tasse.' });
    expect(input.scope).toEqual({ kind: 'government', gameId: GAME, branchId: MAIN });
    expect(input.eventType).toBe('player_decision');
    expect(input.actorIds).toEqual(['player']);
    const outcome = service.ingestJevMemory(input);
    expect(outcome.id).toBe('jev:act-7');
    const stored = jevRepo.find(governmentScope(), outcome.id!)!;
    expect(stored.type).toBe('decision');
    expect(stored.sourceEventIds).toEqual(['act-7']);
  });

  it('ministerExchangeInput usa lo scope minister e W3 ritrova la conversazione', () => {
    const mandate = 'tesoro@ITA:m1';
    const question = 'Cosa mi avevi consigliato sulle tasse?';
    const reply = 'Avevo consigliato di NON ridurre le tasse per proteggere il bilancio.';
    const input = service.ministerExchangeInput({ gameId: GAME, branchId: MAIN, seat: 'tesoro', mandate, gameDate: '1951-01-01', turn: 1, question, reply });
    expect(input.scope).toEqual({ kind: 'minister', gameId: GAME, branchId: MAIN, seat: 'tesoro', mandate });
    expect(input.eventType).toBe('minister_statement');
    const outcome = service.ingestJevMemory(input);
    expect(outcome.stored).toBe(true);
    const recalled = service.getMinisterMemory(GAME, MAIN, 'tesoro', mandate, 'tasse', 1200, { gameDate: '1951-01-01', turn: 1 });
    expect(recalled.text).toContain('NON ridurre le tasse');
    expect(recalled.jevIds).toEqual([outcome.id]);
    expect(recalled.telemetry.model_calls).toBe(0);
  });
});

describe('JEV-W2 repository: potatura e fork', () => {
  it('pruneAfterTurn elimina oltre il turno/la data e conserva il resto', () => {
    const scope = governmentScope();
    const rec = (id: string, turn: number | null, date: string): JevMemoryRecord => ({
      id, gameId: GAME, branchId: MAIN, scope: 'government', scopeKey: 'government', type: 'decision',
      gameDate: date, turn, createdAt: '2026-01-01T00:00:00Z', text: id, actors: [], topics: [],
      importance: 0.5, confidence: 0.5, status: 'active', lifecycle: 'warm', accessCount: 0,
    });
    jevRepo.upsert(scope, rec('past', 1, '1951-01-01'));
    jevRepo.upsert(scope, rec('future-turn', 9, '1951-02-01'));
    jevRepo.upsert(scope, rec('future-date', null, '1952-01-01'));
    expect(jevRepo.pruneAfterTurn(scope, { turn: 5, gameDate: '1951-06-01' })).toBe(2);
    expect(jevRepo.listMemory(scope).map(r => r.id)).toEqual(['past']);
  });

  it('pruneAfterTurn su un ramo non tocca l’altro ramo', () => {
    const main = governmentScope(MAIN);
    const other = governmentScope(OTHER_BRANCH);
    const rec = (id: string, branchId: string): JevMemoryRecord => ({
      id, gameId: GAME, branchId, scope: 'government', scopeKey: 'government', type: 'decision',
      gameDate: '1951-01-01', turn: 1, createdAt: '2026-01-01T00:00:00Z', text: id, actors: [], topics: [],
      importance: 0.5, confidence: 0.5, status: 'active', lifecycle: 'warm', accessCount: 0,
    });
    jevRepo.upsert(main, rec('main-turn', MAIN));
    jevRepo.upsert(other, rec('other-turn', OTHER_BRANCH));
    expect(jevRepo.pruneAfterTurn(main, { turn: 0 })).toBe(1);
    expect(jevRepo.listMemory(main)).toHaveLength(0);
    expect(jevRepo.listMemory(other).map(r => r.id)).toEqual(['other-turn']);
  });

  it('forkMemory copia sul nuovo ramo, non tocca l’origine e non duplica', () => {
    const from = governmentScope();
    const record: JevMemoryRecord = {
      id: 'keep', gameId: GAME, branchId: MAIN, scope: 'government', scopeKey: 'government', type: 'decision',
      gameDate: '1951-01-01', turn: 1, createdAt: '2026-01-01T00:00:00Z', text: 'keep', actors: [], topics: [],
      importance: 0.5, confidence: 0.5, status: 'active', lifecycle: 'warm', accessCount: 0,
    };
    jevRepo.upsert(from, record);
    expect(jevRepo.forkMemory(from, OTHER_BRANCH)).toBe(1);
    expect(jevRepo.forkMemory(from, OTHER_BRANCH)).toBe(0);
    expect(jevRepo.listMemory(governmentScope(OTHER_BRANCH)).map(r => r.id)).toEqual(['keep']);
    expect(jevRepo.listMemory(from).map(r => r.id)).toEqual(['keep']);
  });
});

describe('JEV-W2 sidecar game.repository', () => {
  it('deleteAfterTurn pota la memoria JEV oltre il punto di ripristino', () => {
    const scope = governmentScope();
    const rec = (id: string, turn: number, date: string): JevMemoryRecord => ({
      id, gameId: GAME, branchId: MAIN, scope: 'government', scopeKey: 'government', type: 'decision',
      gameDate: date, turn, createdAt: '2026-01-01T00:00:00Z', text: id, actors: [], topics: [],
      importance: 0.5, confidence: 0.5, status: 'active', lifecycle: 'warm', accessCount: 0,
    });
    jevRepo.upsert(scope, rec('past', 1, '1951-01-01'));
    jevRepo.upsert(scope, rec('future', 4, '1951-04-01'));
    gameRepo.deleteAfterTurn(GAME, 1);
    expect(jevRepo.listMemory(scope).map(r => r.id)).toEqual(['past']);
  });

  it('createBranch copia la memoria JEV sul figlio', () => {
    const scope = governmentScope();
    const record: JevMemoryRecord = {
      id: 'heritage', gameId: GAME, branchId: MAIN, scope: 'government', scopeKey: 'government', type: 'decision',
      gameDate: '1951-01-01', turn: 1, createdAt: '2026-01-01T00:00:00Z', text: 'heritage', actors: [], topics: [],
      importance: 0.5, confidence: 0.5, status: 'active', lifecycle: 'warm', accessCount: 0,
    };
    jevRepo.upsert(scope, record);
    gameRepo.createBranch({ id: 'jev-child', gameId: GAME, name: 'child', parentBranchId: MAIN });
    expect(jevRepo.listMemory(governmentScope('jev-child')).map(r => r.id)).toEqual(['heritage']);
    expect(jevRepo.listMemory(scope).map(r => r.id)).toEqual(['heritage']);
  });
});
