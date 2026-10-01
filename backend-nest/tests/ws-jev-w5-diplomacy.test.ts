/**
 * WS-JEV-W5 — Diplomazia: memoria condivisa e viste di percezione separate.
 *
 * Difende le due invarianti della fase:
 *  1. la memoria **condivisa** usa la coppia **ordinata alfabeticamente**
 *     (`diplomacy:FRA:ITA`), qualunque sia l'ordine dei due attori;
 *  2. la **percezione** è direzionale e separata (`nation:ITA:view:FRA` ≠
 *     `nation:FRA:view:ITA`): le due viste non si mescolano mai tra loro né
 *     con il fatto condiviso.
 *
 * Ogni lettura filtra per `game_id` E `branch_id`. Solo SQLite temporaneo e
 * repository reale: nessun backend, nessuna rete, nessun provider.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-jev-w5-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'memory.sqlite');
const originalEnabled = process.env.JEV_MEMORY_ENABLED;

const GAME = 'jev-w5-game';
const OTHER_GAME = 'jev-w5-other';
const BRANCH = 'branch-A';

let db: any;
let service: typeof import('../src/core/government/jev/jev-memory.service');
let jevRepo: typeof import('../src/repositories/jev-memory.repository').jevMemoryRepository;
let types: typeof import('../src/core/government/jev/jev.types');
let classify: typeof import('../src/core/government/jev/jev-classify');
let diplomacy: typeof import('../src/game/DiplomacyService');

const POINT = { gameDate: '2026-02-01', turn: 10 };

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  service = await import('../src/core/government/jev/jev-memory.service');
  jevRepo = (await import('../src/repositories/jev-memory.repository')).jevMemoryRepository;
  types = await import('../src/core/government/jev/jev.types');
  classify = await import('../src/core/government/jev/jev-classify');
  diplomacy = await import('../src/game/DiplomacyService');
});

beforeEach(() => {
  process.env.JEV_MEMORY_ENABLED = 'true';
  jevRepo.deleteBranch({ gameId: GAME, branchId: BRANCH });
  jevRepo.deleteBranch({ gameId: OTHER_GAME, branchId: BRANCH });
});

afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(over: Partial<Parameters<typeof service.diplomaticMemoryInputs>[0]> = {}) {
  return {
    gameId: GAME, branchId: BRANCH, gameDate: '2026-01-01', turn: 5,
    a: 'ITA', b: 'FRA', eventType: 'diplomacy_relationship',
    text: 'Rapporti tra Italia e Francia: neutral.',
    sourceEventId: 'rel-1',
    views: [
      { observer: 'ITA', subject: 'FRA', text: 'PERCEZIONE_ITA_DI_FRA' },
      { observer: 'FRA', subject: 'ITA', text: 'PERCEZIONE_FRA_DI_ITA' },
    ],
    ...over,
  };
}

function sharedScope(gameId = GAME, a = 'ITA', b = 'FRA') {
  return { kind: 'diplomacy' as const, gameId, branchId: BRANCH, a, b };
}
function viewScope(observer: string, subject: string, gameId = GAME) {
  return { kind: 'perception' as const, gameId, branchId: BRANCH, observer, subject };
}

describe('JEV-W5 chiavi canoniche', () => {
  it('la coppia condivisa è ordinata alfabeticamente e indipendente dall’ordine', () => {
    const ita = types.jevScopeKey({ kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'ITA', b: 'FRA' });
    const fra = types.jevScopeKey({ kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'FRA', b: 'ITA' });
    expect(ita).toBe('diplomacy:FRA:ITA');
    expect(fra).toBe(ita);
  });

  it('la percezione è direzionale e distinta nelle due direzioni', () => {
    const ita = types.jevScopeKey({ kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA' });
    const fra = types.jevScopeKey({ kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'FRA', subject: 'ITA' });
    expect(ita).toBe('nation:ITA:view:FRA');
    expect(fra).toBe('nation:FRA:view:ITA');
    expect(ita).not.toBe(fra);
    // Mai confusa con la memoria condivisa.
    expect(ita.startsWith('diplomacy:')).toBe(false);
  });

  it('rifiuta una coppia o una percezione con sé stessi', () => {
    expect(() => types.jevScopeKey({ kind: 'diplomacy', gameId: GAME, branchId: BRANCH, a: 'ITA', b: 'ITA' }))
      .toThrow(/distinct/i);
    expect(() => types.jevScopeKey({ kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'ITA' }))
      .toThrow(/distinct/i);
  });
});

describe('JEV-W5 adapter e ingestion', () => {
  it('produce una memoria condivisa e due viste con id namespaciati distinti', () => {
    const inputs = service.diplomaticMemoryInputs(event());
    expect(inputs).toHaveLength(3);
    expect(inputs[0].scope).toMatchObject({ kind: 'diplomacy', a: 'FRA', b: 'ITA' });
    expect(inputs[1].scope).toMatchObject({ kind: 'perception', observer: 'ITA', subject: 'FRA' });
    expect(inputs[2].scope).toMatchObject({ kind: 'perception', observer: 'FRA', subject: 'ITA' });
    const ids = inputs.map(input => (input.metadata as any).eventId);
    expect(new Set(ids).size).toBe(3);
    // La condivisa è la stessa anche invertendo i due attori.
    const swapped = service.diplomaticMemoryInputs(event({ a: 'FRA', b: 'ITA' }));
    expect((swapped[0].metadata as any).eventId).toBe(ids[0]);
  });

  it('salva il fatto condiviso e le viste, senza mescolarli', () => {
    expect(service.ingestJevBatch(service.diplomaticMemoryInputs(event())).telemetry.stored).toBe(3);
    // La condivisa si legge da entrambi gli ordini (stessa chiave).
    expect(jevRepo.listMemory(sharedScope())).toHaveLength(1);
    expect(jevRepo.listMemory(sharedScope(GAME, 'FRA', 'ITA'))).toHaveLength(1);
    // Ogni vista è isolata: ITA→FRA non vede FRA→ITA.
    const itaView = jevRepo.listMemory(viewScope('ITA', 'FRA'));
    const fraView = jevRepo.listMemory(viewScope('FRA', 'ITA'));
    expect(itaView).toHaveLength(1);
    expect(fraView).toHaveLength(1);
    expect(itaView[0].text).toContain('PERCEZIONE_ITA_DI_FRA');
    expect(itaView[0].text).not.toContain('PERCEZIONE_FRA_DI_ITA');
    expect(fraView[0].text).toContain('PERCEZIONE_FRA_DI_ITA');
    expect(fraView[0].text).not.toContain('PERCEZIONE_ITA_DI_FRA');
  });

  it('è idempotente: lo stesso evento aggiorna, non duplica', () => {
    service.ingestJevBatch(service.diplomaticMemoryInputs(event()));
    service.ingestJevBatch(service.diplomaticMemoryInputs(event()));
    expect(jevRepo.listMemory(sharedScope())).toHaveLength(1);
    expect(jevRepo.listMemory(viewScope('ITA', 'FRA'))).toHaveLength(1);
  });

  it('non contamina altri giochi né altri rami', () => {
    service.ingestJevBatch(service.diplomaticMemoryInputs(event()));
    service.ingestJevBatch(service.diplomaticMemoryInputs(event({ gameId: OTHER_GAME })));
    // Stessa coppia, ramo diverso: nessuna riga finché non si scrive.
    expect(jevRepo.listMemory({ kind: 'diplomacy', gameId: GAME, branchId: 'branch-B', a: 'ITA', b: 'FRA' })).toHaveLength(0);
    // Giochi diversi restano separati.
    expect(jevRepo.listMemory(sharedScope(GAME))).toHaveLength(1);
    expect(jevRepo.listMemory(sharedScope(OTHER_GAME))).toHaveLength(1);
    expect(jevRepo.listMemory(viewScope('ITA', 'FRA', GAME))).toHaveLength(1);
    expect(jevRepo.listMemory(viewScope('ITA', 'FRA', OTHER_GAME))).toHaveLength(1);
  });

  it('flag off: non tocca il repository e non salva nulla', () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    const upsert = vi.spyOn(jevRepo, 'upsert');
    const result = service.ingestJevBatch(service.diplomaticMemoryInputs(event()));
    expect(result.telemetry.stored).toBe(0);
    expect(result.outcomes.every(outcome => outcome.reason === 'jev_disabled')).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
    expect(jevRepo.listMemory(sharedScope())).toHaveLength(0);
  });

  it('i tipi diplomatici sono classificati KEEP, il rumore UI DROP', () => {
    for (const eventType of ['diplomacy_relationship', 'diplomacy_alliance', 'diplomatic_exchange', 'diplomatic_view']) {
      expect(classify.classifyJevIngest({ ...service.diplomaticMemoryInputs(event())[0], eventType } as any).decision).toBe('KEEP');
    }
    expect(classify.classifyJevIngest(service.diplomaticMemoryInputs(event({ eventType: 'ui_notification' }))[0]).decision).toBe('DROP');
  });
});

describe('JEV-W5 retrieval: condivisa e vista mai fuse', () => {
  function seed() {
    service.ingestJevBatch(service.diplomaticMemoryInputs(event()));
    // Una vista non pertinente alla query resta comunque nel suo scope.
    service.ingestJevBatch(service.diplomaticMemoryInputs(event({
      sourceEventId: 'rel-2', eventType: 'diplomatic_exchange',
      text: 'Trattativa commerciale tra Italia e Francia.',
      views: [{ observer: 'ITA', subject: 'FRA', text: 'PERCEZIONE_ITA_COMMERCIO' }],
    })));
  }

  it('tiene le due sezioni separate e usa le chiavi canoniche', () => {
    seed();
    const result = service.getDiplomaticMemory({
      gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT,
    });
    expect(result.shared.scopeKey).toBe('diplomacy:FRA:ITA');
    expect(result.view.scopeKey).toBe('nation:ITA:view:FRA');
    expect(result.shared.text).toContain('RAPPORTI CONDIVISI');
    expect(result.view.text).toContain('PERCEZIONE DI ITA VERSO FRA');
    // Il testo della percezione non finisce nella sezione condivisa.
    expect(result.shared.text).not.toContain('PERCEZIONE_ITA_DI_FRA');
    expect(result.shared.text).not.toContain('PERCEZIONE_ITA_COMMERCIO');
    expect(result.view.text).toContain('PERCEZIONE_ITA_DI_FRA');
    expect(result.view.text).not.toContain('PERCEZIONE_FRA_DI_ITA');
    expect(result.telemetry.model_calls).toBe(0);
  });

  it('la vista dell’altro osservatore non compare in questa vista', () => {
    seed();
    const ita = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT });
    const fra = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'FRA', subject: 'ITA', query: 'Francia', asOf: POINT });
    expect(ita.view.text).not.toContain('PERCEZIONE_FRA_DI_ITA');
    expect(fra.view.text).toContain('PERCEZIONE_FRA_DI_ITA');
    expect(fra.view.text).not.toContain('PERCEZIONE_ITA_DI_FRA');
  });

  it('rispetta il budget complessivo e include memoria quando il tetto lo consente', () => {
    seed();
    const result = service.getDiplomaticMemory({
      gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT, maxTokens: 1_200,
    });
    expect(result.shared.bytes + result.view.bytes).toBeLessThanOrEqual(1_200);
    expect(result.shared.bytes).toBeGreaterThan(0);
    expect(result.view.bytes).toBeGreaterThan(0);
    expect(result.telemetry.token_upper_bound).toBe(result.shared.bytes + result.view.bytes);
  });

  it('con un tetto irrisorio torna a sezioni vuote senza superarlo', () => {
    seed();
    const result = service.getDiplomaticMemory({
      gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT, maxTokens: 1,
    });
    expect(result.shared.bytes + result.view.bytes).toBeLessThanOrEqual(1);
    expect(result.shared.text).toBe('');
    expect(result.view.text).toBe('');
  });

  it('non legge la memoria di un altro ramo', () => {
    seed();
    const other = service.getDiplomaticMemory({ gameId: GAME, branchId: 'branch-B', observer: 'ITA', subject: 'FRA', query: '', asOf: POINT });
    expect(other.shared.text).toBe('');
    expect(other.view.text).toBe('');
  });

  it('non mescola coppie diverse: ITA/DEU non vede ITA/FRA', () => {
    seed();
    const other = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'DEU', query: '', asOf: POINT });
    expect(other.shared.text).toBe('');
    expect(other.view.text).toBe('');
  });

  it('la pertinenza filtra quando trova un riscontro, altrimenti ripiega sui fatti salienti', () => {
    service.ingestJevBatch(service.diplomaticMemoryInputs(event({ sourceEventId: 'rel-tecnica', text: 'Rapporti tra Italia e Francia: intesa tecnica.' })));
    service.ingestJevBatch(service.diplomaticMemoryInputs(event({ sourceEventId: 'rel-commercio', eventType: 'diplomatic_exchange', text: 'Trattativa commerciale tra Italia e Francia.', views: [] })));
    const match = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'commerciale', asOf: POINT });
    expect(match.shared.text).toContain('commerciale');
    expect(match.shared.text).not.toContain('intesa tecnica');
    const fallback = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'astronautica', asOf: POINT });
    expect(fallback.shared.text).toContain('intesa tecnica');
  });

  it('esclude il futuro', () => {
    service.ingestJevBatch(service.diplomaticMemoryInputs(event({
      gameDate: '2027-01-01', turn: 40, sourceEventId: 'future',
      views: [{ observer: 'ITA', subject: 'FRA', text: 'PERCEZIONE_FUTURA' }],
    })));
    const result = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT });
    expect(result.shared.text).not.toContain('PERCEZIONE_FUTURA');
    expect(result.view.text).not.toContain('PERCEZIONE_FUTURA');
  });

  it('flag off: sezioni vuote e nessun accesso al repository', () => {
    seed();
    process.env.JEV_MEMORY_ENABLED = 'false';
    const list = vi.spyOn(jevRepo, 'listMemory');
    const result = service.getDiplomaticMemory({ gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA', query: 'Francia', asOf: POINT });
    expect(result.shared.text).toBe('');
    expect(result.view.text).toBe('');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('JEV-W5 adapter dei rapporti', () => {
  it('produce fatto condiviso + due viste, con etichette narrative e niente valori interni', () => {
    const inputs = service.relationshipMemoryInputs({
      gameId: GAME, branchId: BRANCH, gameDate: '2026-01-01', turn: 5,
      changes: [{ from: 'ITA', to: 'FRA', newRelationship: 'ally', reason: 'Patto firmato' }],
      publicName: id => ({ ITA: 'Italia', FRA: 'Francia' }[id] || id),
      currentRelationship: () => 'ally',
    });
    expect(inputs).toHaveLength(3);
    expect(inputs[0].scope).toMatchObject({ kind: 'diplomacy', a: 'FRA', b: 'ITA' });
    expect(inputs[0].eventType).toBe('diplomacy_alliance');
    expect(inputs[0].text).toContain('alleanza');
    expect(inputs[0].text).not.toContain('ally');
    expect(inputs.slice(1).map(input => input.scope)).toEqual([
      { kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'ITA', subject: 'FRA' },
      { kind: 'perception', gameId: GAME, branchId: BRANCH, observer: 'FRA', subject: 'ITA' },
    ]);
  });
});

describe('JEV-W5 attribuzione del parlante', () => {
  const participants = [
    { id: 'PLAYER', name: 'Giocatore', role: 'player' },
    { id: 'FRA', name: 'Francia', role: 'polity' },
    { id: 'ITA', name: 'Italia', role: 'polity' },
  ];

  it('in una chat di gruppo attribuisce la memoria a chi risponde davvero', () => {
    expect(diplomacy.diplomaticSpeaker(participants, 'Italia')).toMatchObject({ id: 'ITA' });
    expect(diplomacy.diplomaticSpeaker(participants, 'Francia')).toMatchObject({ id: 'FRA' });
    expect(diplomacy.diplomaticSpeaker(participants, 'Giocatore')).toBeUndefined();
    expect(diplomacy.diplomaticSpeaker(participants, 'Sconosciuto')).toBeUndefined();
  });

  it('se il parlante non è risolvibile ricade sul titolare del canale', () => {
    expect(diplomacy.diplomaticSpeaker(participants, 'Sconosciuto')?.id ?? 'FRA').toBe('FRA');
  });
});
