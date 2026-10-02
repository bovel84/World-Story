/**
 * WS-JEV-W8 — Telemetria, token reduction e test di accettazione B.
 *
 * La telemetria è un effetto collaterale di sola lettura: non cambia il testo
 * prodotto né le decisioni. Le prove verificano:
 *  1. la struttura `JevTelemetry` e le sue funzioni pure;
 *  2. che i retrieval esistenti (W3/W4/W5/W6) la popolino, con l'invariante
 *     `considered = selected + deferred + dropped` e `model_calls === 0`;
 *  3. l'accettazione B: storia grezza > 150k token ma contesti advisor < 6000,
 *     ministro < 5000, diplomatico < 5000 (fallisce se i budget non sono
 *     rispettati);
 *  4. flag off ⇒ telemetria vuota e zero accessi a JEV.
 *
 * Solo SQLite temporaneo e repository reale: nessun backend, nessuna rete,
 * nessun provider, MAI il DB operativo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JevIngestInput, JevScope } from '../src/core/government/jev/jev.types';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w8-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'metrics.sqlite');
const originalEnabled = process.env.JEV_MEMORY_ENABLED;

const GAME = 'jev-w8-game';
const OTHER_GAME = 'jev-w8-other';
const BRANCH = 'branch-A';
const BRANCH_B = 'branch-B';
const FUTURE = { gameDate: '1999-12-31', turn: 99_999 };
const NOW = '2026-01-01T00:00:00.000Z';

let db: any;
let service: typeof import('../src/core/government/jev/jev-memory.service');
let telemetry: typeof import('../src/core/government/jev/jev-telemetry');
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  db.prepare(`INSERT INTO worlds (id, name, description, start_date, base_prompt) VALUES ('w8-world', 'W8', '', '1951-01-01', '')`).run();
  db.prepare(`INSERT INTO games (id, world_id, current_turn, current_date) VALUES (?, 'w8-world', 260, '1951-06-01')`).run(GAME);
  db.prepare(`UPDATE games SET head_branch_id = ? WHERE id = ?`).run(BRANCH, GAME);
  service = await import('../src/core/government/jev/jev-memory.service');
  telemetry = await import('../src/core/government/jev/jev-telemetry');
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.JEV_MEMORY_ENABLED = 'true';
  for (const gameId of [GAME, OTHER_GAME]) {
    for (const branchId of [BRANCH, BRANCH_B, null]) jevRepo.deleteBranch({ gameId, branchId });
  }
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

function governmentScope(gameId = GAME, branchId: string | null = BRANCH): JevScope {
  return { kind: 'government', gameId, branchId };
}

function rawInput(turn: number, text: string, over: Partial<JevIngestInput> = {}): JevIngestInput {
  return {
    gameId: GAME, branchId: BRANCH, gameDate: '1951-01-01', turn,
    source: 'government', actorIds: ['governo'], text, eventType: 'government_decision',
    scope: governmentScope(), ...over,
  };
}

function seedRaw(turns: number[], text = (turn: number) => `Decisione del turno ${turn}`): void {
  service.ingestJevBatch(turns.map(turn => rawInput(turn, text(turn))), NOW);
}

describe('JEV-W8 telemetria: struttura e funzioni pure', () => {
  it('buildJevTelemetry calcola il rapporto e impone model_calls 0', () => {
    const metrics = telemetry.buildJevTelemetry({
      considered: 10, selected: 3, deferred: 6, dropped: 1,
      contextTokensBefore: 40_000, contextTokensAfter: 4_000, retrievalMs: 1.23456,
    });
    expect(metrics).toMatchObject({
      memoriesConsidered: 10, memoriesSelected: 3, memoriesDeferred: 6, memoriesDropped: 1,
      contextTokensBefore: 40_000, contextTokensAfter: 4_000, model_calls: 0,
    });
    expect(metrics.compressionRatio).toBe(0.1);
    expect(metrics.retrievalMs).toBeCloseTo(1.235, 3);
  });

  it('senza dati la telemetria è tutta a zero, con rapporto 0', () => {
    expect(telemetry.buildJevTelemetry()).toEqual({
      memoriesConsidered: 0, memoriesSelected: 0, memoriesDeferred: 0, memoriesDropped: 0,
      contextTokensBefore: 0, contextTokensAfter: 0, compressionRatio: 0,
      retrievalMs: 0, consolidationMs: 0, model_calls: 0,
    });
  });

  it('estimateTokens è deterministico e arrotonda per eccesso', () => {
    expect(telemetry.estimateTokens('')).toBe(0);
    expect(telemetry.estimateTokens('abcd')).toBe(1);
    expect(telemetry.estimateTokens('abcde')).toBe(2);
    expect(telemetry.estimateTokens('à'.repeat(4))).toBe(2); // 2 byte per 'à' in UTF-8
    expect(telemetry.estimateTokens('abcde')).toBe(telemetry.estimateTokens('abcde'));
  });

  it('sumJevTelemetry somma i contatori e prende la latenza massima', () => {
    const a = telemetry.buildJevTelemetry({ considered: 2, selected: 1, contextTokensBefore: 100, contextTokensAfter: 20, retrievalMs: 5 });
    const b = telemetry.buildJevTelemetry({ considered: 3, selected: 2, deferred: 1, contextTokensBefore: 300, contextTokensAfter: 10, retrievalMs: 9 });
    const total = telemetry.sumJevTelemetry(a, b);
    expect(total).toMatchObject({ memoriesConsidered: 5, memoriesSelected: 3, memoriesDeferred: 1,
      contextTokensBefore: 400, contextTokensAfter: 30, retrievalMs: 9, model_calls: 0 });
    expect(total.compressionRatio).toBe(0.075);
  });
});

describe('JEV-W8 telemetria nei retrieval esistenti', () => {
  it('getMinisterMemory espone le metriche e conserva l’invariante', () => {
    const scope: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'm1' };
    service.ingestJevBatch(Array.from({ length: 8 }, (_, index) => rawInput(index + 1,
      `Tagliare le tasse danneggia il deficit, nota ${index}. ${'dettaglio '.repeat(60)}`, { scope, eventType: 'minister_decision', actorIds: ['tesoro'] })), NOW);
    const recall = service.getMinisterMemory(GAME, BRANCH, 'tesoro', 'm1', 'Cosa mi avevi consigliato sulle tasse?', 1200, FUTURE);
    const { metrics } = recall;
    expect(metrics.model_calls).toBe(0);
    expect(metrics.memoriesSelected).toBeGreaterThan(0);
    expect(metrics.memoriesConsidered).toBe(metrics.memoriesSelected + metrics.memoriesDeferred + metrics.memoriesDropped);
    expect(metrics.contextTokensBefore).toBeGreaterThan(metrics.contextTokensAfter);
    expect(metrics.compressionRatio).toBeLessThan(1);
    expect(metrics.retrievalMs).toBeGreaterThanOrEqual(0);
  });

  it('getDiplomaticMemory somma condivisa e percezione', () => {
    const shared: JevScope = { kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'FRA', b: 'ITA' };
    const view: JevScope = { kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA' };
    service.ingestJevBatch([
      rawInput(1, 'Trattato commerciale firmato con la Francia', { scope: shared, eventType: 'diplomacy_alliance' }),
      rawInput(2, 'La Francia considera l’Italia un alleato prudente', { scope: view, eventType: 'diplomatic_view' }),
    ], NOW);
    const result = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'trattato', asOf: FUTURE });
    expect(result.metrics.memoriesConsidered).toBe(2);
    expect(result.metrics.memoriesSelected).toBe(2);
    expect(result.metrics.contextTokensAfter).toBe(telemetry.bytesToTokens(result.shared.bytes + result.view.bytes));
    expect(result.metrics.model_calls).toBe(0);
  });

  it('getFactionMemory espone le metriche senza scrivere', () => {
    const scope: JevScope = { kind: 'faction', gameId: GAME, branchId: BRANCH, factionId: 'lavoratori' };
    service.ingestJevBatch([
      rawInput(1, 'Il governo ha concesso sussidi ai lavoratori', { scope, eventType: 'government_favor' }),
      rawInput(2, 'Il governo ha aumentato le tasse sui salari', { scope, eventType: 'government_grievance' }),
    ], NOW);
    const result = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'lavoratori', query: 'tasse', asOf: FUTURE, touch: false });
    expect(result.metrics.memoriesConsidered).toBe(2);
    expect(result.metrics.memoriesSelected).toBeGreaterThan(0);
    expect(result.metrics.contextTokensAfter).toBe(telemetry.bytesToTokens(result.bytes));
    expect(result.metrics.model_calls).toBe(0);
  });

  it('buildMinisterContext espone le metriche e non tocca il modello', () => {
    const scope: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'esteri', mandate: 'm2' };
    service.ingestJevBatch(Array.from({ length: 5 }, (_, index) => rawInput(index + 1,
      `Vertice diplomatico con la Francia numero ${index}`, { scope, eventType: 'minister_statement', actorIds: ['esteri'] })), NOW);
    const result = service.buildMinisterContext({
      scope: { gameId: GAME, branchId: BRANCH, seat: 'esteri', mandate: 'm2' },
      query: 'Come procedono i negoziati con la Francia?',
      verifiedState: 'Relazioni con la Francia: cordiali.',
      asOf: FUTURE,
    });
    expect(result.metrics.model_calls).toBe(0);
    expect(result.metrics.memoriesSelected).toBeGreaterThan(0);
    expect(result.metrics.memoriesConsidered).toBe(result.metrics.memoriesSelected + result.metrics.memoriesDeferred + result.metrics.memoriesDropped);
    expect(result.metrics.contextTokensAfter).toBe(telemetry.estimateTokens(result.text));
  });

  it('l’ingestion mappa KEEP/DEFER/DROP nella telemetria', () => {
    const batch = service.ingestJevBatch([
      rawInput(1, 'Decisione nota e conservata'),
      rawInput(1, 'Fatto ambiguo senza tipo noto', { eventType: 'fatto_generico' }),
      rawInput(1, '   '),
    ], NOW);
    expect(batch.metrics).toMatchObject({ memoriesConsidered: 3, memoriesSelected: 1, memoriesDeferred: 1, memoriesDropped: 1, model_calls: 0 });
  });

  it('il consolidamento espone consolidationMs e il rapporto grezzo→episodio', () => {
    seedRaw([1, 2, 3, 4, 5], turn => `Decisione lunga del turno ${turn} ${'dettaglio '.repeat(60)}`);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20, now: NOW });
    expect(result.metrics.consolidationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.memoriesConsidered).toBe(5);
    expect(result.metrics.memoriesSelected).toBe(5);
    expect(result.metrics.contextTokensAfter).toBeLessThan(result.metrics.contextTokensBefore);
    expect(result.metrics.compressionRatio).toBeLessThan(1);
    expect(result.metrics.model_calls).toBe(0);
  });

  it('il consolidamento distingue deferred (fuori finestra) e dropped (questioni aperte)', () => {
    seedRaw([1, 2, 3, 15], turn => `Decisione del turno ${turn}`);
    service.ingestJevBatch([rawInput(2, 'Promessa ancora aperta', { eventType: 'government_promise' })], NOW);
    const result = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20, now: NOW });
    expect(result.metrics.memoriesConsidered).toBe(3); // turni 1,2,3 nella finestra pronta
    expect(result.metrics.memoriesSelected).toBe(3);
    expect(result.metrics.memoriesDeferred).toBe(1); // turno 15: fuori finestra
    expect(result.metrics.memoriesDropped).toBe(1); // promessa aperta: non consolidata
    // Nella consolidazione l'invariante è `totale = considered + deferred + dropped`
    // (considered = archiviabili finiti in episodio).
    expect(result.metrics.memoriesConsidered).toBe(result.metrics.memoriesSelected);
    expect(result.metrics.memoriesConsidered + result.metrics.memoriesDeferred + result.metrics.memoriesDropped).toBe(5);
  });

  it('flag off: metriche vuote e nessun accesso a JEV', () => {
    seedRaw([1, 2, 3]);
    process.env.JEV_MEMORY_ENABLED = 'false';
    const list = vi.spyOn(jevRepo, 'listMemory');
    const scopes = vi.spyOn(jevRepo, 'listScopes');
    const currentPoint = vi.spyOn(jevRepo, 'currentPoint');
    const touch = vi.spyOn(jevRepo, 'touch');
    const find = vi.spyOn(jevRepo, 'find');
    const upsert = vi.spyOn(jevRepo, 'upsert');
    const archive = vi.spyOn(jevRepo, 'archive');
    const recall = service.getMinisterMemory(GAME, BRANCH, 'tesoro', 'm1', 'tasse', 1200, FUTURE);
    const faction = service.getFactionMemory({ gameId: GAME, branchId: BRANCH, factionId: 'x', asOf: FUTURE });
    const diplo = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 's', asOf: FUTURE });
    const consolidation = service.consolidateJevMemory({ gameId: GAME, branchId: BRANCH, turn: 20 });
    for (const metrics of [recall.metrics, faction.metrics, diplo.metrics, consolidation.metrics]) {
      expect(metrics).toMatchObject({ memoriesConsidered: 0, memoriesSelected: 0, contextTokensBefore: 0,
        contextTokensAfter: 0, compressionRatio: 0, model_calls: 0 });
    }
    for (const spy of [list, scopes, currentPoint, touch, find, upsert, archive]) expect(spy).not.toHaveBeenCalled();
  });

  it('le metriche restano filtrate per gioco e ramo', () => {
    const scope: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'm1' };
    const other: JevScope = { kind: 'minister', gameId: OTHER_GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'm1' };
    const otherBranch: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH_B, seat: 'tesoro', mandate: 'm1' };
    service.ingestJevBatch([
      rawInput(1, 'Tasse: memoria del gioco corretto', { scope, eventType: 'minister_decision' }),
      rawInput(1, 'Tasse: memoria di un altro gioco', { scope: other, eventType: 'minister_decision', gameId: OTHER_GAME }),
      rawInput(1, 'Tasse: memoria di un altro ramo', { scope: otherBranch, eventType: 'minister_decision', branchId: BRANCH_B }),
    ], NOW);
    const recall = service.getMinisterMemory(GAME, BRANCH, 'tesoro', 'm1', 'tasse', 1200, FUTURE);
    expect(recall.metrics.memoriesConsidered).toBe(1);
    expect(recall.metrics.memoriesSelected).toBe(1);
    expect(recall.text).toContain('gioco corretto');
    expect(recall.text).not.toContain('altro gioco');
    expect(recall.text).not.toContain('altro ramo');
  });
});

describe('JEV-W8 accettazione B — sessione lunga', () => {
  it('storia grezza > 150k token ma i contesti restano entro i budget', () => {
    const filler = 'riforma fiscale tasse budget deficit occupazione ministero economia ';
    const ministerScope: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'mand-1' };
    const diplomacyScope: JevScope = { kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'FRA', b: 'ITA' };
    const perceptionScope: JevScope = { kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA' };
    const inputs: JevIngestInput[] = [];
    // 500 decisioni del ministro + 200 di governo: la cronologia grezza.
    for (let index = 0; index < 500; index += 1) {
      inputs.push(rawInput(index + 1, `Decisione ministeriale ${index}. ${filler.repeat(20)}`,
        { scope: ministerScope, eventType: 'minister_decision', actorIds: ['tesoro'] }));
    }
    for (let index = 0; index < 200; index += 1) {
      inputs.push(rawInput(index + 1, `Decisione di governo ${index}. ${filler.repeat(20)}`));
    }
    for (let index = 0; index < 60; index += 1) {
      inputs.push(rawInput(index + 1, `Trattato commerciale con la Francia, intesa ${index}. ${filler.repeat(4)}`,
        { scope: diplomacyScope, eventType: 'diplomacy_alliance' }));
      inputs.push(rawInput(index + 1, `L’Italia vede la Francia come partner, nota ${index}. ${filler.repeat(4)}`,
        { scope: perceptionScope, eventType: 'diplomatic_view' }));
    }
    const batch = service.ingestJevBatch(inputs, NOW);
    expect(batch.metrics.memoriesSelected).toBe(inputs.length);

    const rawBytes = inputs.reduce((sum, input) => sum + Buffer.byteLength(input.text, 'utf8'), 0);
    const rawTokens = telemetry.bytesToTokens(rawBytes);
    expect(rawTokens).toBeGreaterThan(150_000); // la storia grezza è lunga davvero

    // 1. Advisor: il contesto a sezioni innestato nel builder (W4).
    const advisor = service.buildMinisterContext({
      scope: { gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'mand-1' },
      query: 'Cosa mi avevi consigliato sulle tasse?',
      verifiedState: 'PIL +2,1%; deficit -1,4%; disoccupazione 7,2%.',
      recentConversation: [{ role: 'user', content: 'Riduciamo le tasse?' }, { role: 'assistant', content: 'No: peggiorerebbe il deficit.' }],
      asOf: FUTURE,
    });
    const advisorTokens = telemetry.estimateTokens(advisor.text);
    expect(advisorTokens).toBeGreaterThan(0);
    expect(advisorTokens).toBeLessThan(6_000);
    expect(advisor.metrics.memoriesSelected).toBeGreaterThan(0);
    expect(advisor.metrics.contextTokensBefore).toBeGreaterThan(150_000);
    expect(advisor.metrics.model_calls).toBe(0);

    // 2. Ministro: la memoria dedicata (facade W3).
    const minister = service.getMinisterMemory(GAME, BRANCH, 'tesoro', 'mand-1', 'Cosa mi avevi consigliato sulle tasse?', 1_200, FUTURE);
    const ministerTokens = telemetry.estimateTokens(minister.text);
    expect(ministerTokens).toBeGreaterThan(0);
    expect(minister.metrics.memoriesSelected).toBeGreaterThan(0);
    expect(ministerTokens).toBeLessThan(5_000);

    // 3. NPC diplomatico: condivisa + percezione (W5).
    const diplomatic = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'trattato', asOf: FUTURE });
    const diplomaticTokens = telemetry.bytesToTokens(diplomatic.shared.bytes + diplomatic.view.bytes);
    expect(diplomaticTokens).toBeGreaterThan(0);
    expect(diplomatic.metrics.memoriesSelected).toBeGreaterThan(0);
    expect(diplomaticTokens).toBeLessThan(5_000);

    // Il rapporto di compressione documenta il risparmio reale.
    expect(advisor.metrics.compressionRatio).toBeLessThan(0.25);
  });

  it('il test fallisce se il budget del ministro viene sfondato', () => {
    // Prova che l’asserzione non è tautologica: con un budget enorme il testo
    // supera la soglia e `toBeLessThan` fallirebbe. Usiamo un budget > soglia.
    const scope: JevScope = { kind: 'minister', gameId: GAME, branchId: BRANCH, seat: 'tesoro', mandate: 'mand-1' };
    service.ingestJevBatch(Array.from({ length: 120 }, (_, index) => rawInput(index + 1,
      `Ricordo sulle tasse numero ${index}. ${'dettaglio '.repeat(40)}`, { scope, eventType: 'minister_decision' })), NOW);
    const huge = service.getMinisterMemory(GAME, BRANCH, 'tesoro', 'mand-1', 'tasse', 5_000_000, FUTURE);
    expect(telemetry.estimateTokens(huge.text)).toBeGreaterThan(5_000);
  });
});
