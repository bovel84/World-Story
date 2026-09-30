/**
 * WS-MINISTER-UX-05 (innesto) — La memoria del ministro persistita.
 *
 * Prova le tre cose che la fase chiede, sul database vero:
 *  1. il repository scrive/legge per scope (partita, ramo, sedia, mandato);
 *  2. il **fork** copia la memoria sul ramo nuovo, con la nuova identità;
 *  3. il **rewind** pota la memoria oltre il punto di ripristino.
 *
 * E prova che con memoria vuota i flussi esistenti non cambiano: `createBranch`
 * e `deleteAfterTurn` non toccano nulla, e la lettura del prompt resta vuota.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { mandateFor, normalizeMinisterMemory } from '../src/core/government/MinisterMemory';
import type { MinisterMemoryRecord } from '../src/core/government/MinisterMemory';

const TEST_DB = path.join(os.tmpdir(), `world-story-minister-memory-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'minister_memory_world';
let db: any;
let gameRepository: any;
let ministerMemoryRepository: any;
let gameId: string;
let mainBranch: string;
let session: any;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(_mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    const content = '{}';
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

function record(over: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'r1',
    kind: 'queued-decision',
    state: 'queued',
    summary: 'Strada di collegamento accodata',
    refs: { gameDate: '1951-01-01', turn: 1 },
    ...over,
  };
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  gameRepository = repos.gameRepository;
  ministerMemoryRepository = repos.ministerMemoryRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Minister Memory World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [], objects: [],
      },
    ],
  );
  const created = registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
  gameId = created.gameId;
  session = created.session;
  mainBranch = gameRepository.ensureMainBranch(gameId);
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* tmp */ }
});

describe('memoria del ministro: validazione e mandato', () => {
  it('il mandato è derivato da governo e polity, non da un’etichetta', () => {
    expect(mandateFor('tesoro', { dominantId: 'democristiani' }, 'ITA')).toBe('tesoro@ITA:democristiani');
    // Senza governo in carica il mandato è il consiglio, non un buco.
    expect(mandateFor('guerra', null, 'ITA')).toBe('guerra@ITA:council');
    expect(mandateFor('tesoro', { dominantId: null }, null)).toBe('tesoro@unknown:council');
  });

  it('un genere o uno stato fuori vocabolario fa scartare il ricordo', () => {
    const kept = normalizeMinisterMemory([record()]);
    expect(kept).toHaveLength(1);
    expect(normalizeMinisterMemory([record({ kind: 'inventato' as any })])).toHaveLength(0);
    expect(normalizeMinisterMemory([record({ state: 'magari' as any })])).toHaveLength(0);
    expect(normalizeMinisterMemory('non un array')).toHaveLength(0);
  });
});

describe('memoria del ministro: repository', () => {
  it('scrive e legge per scope (partita, ramo, sedia, mandato)', () => {
    const scope = { gameId, branchId: mainBranch, seat: 'tesoro' as const, mandate: 'tesoro@ITA:democristiani' };
    ministerMemoryRepository.upsertRecords(scope, [record()]);
    expect(ministerMemoryRepository.listMemory(scope)).toHaveLength(1);
    // Lo stesso ricordo aggiorna, non duplica.
    ministerMemoryRepository.upsertRecords(scope, [record({ state: 'executed', summary: 'Firmata' })]);
    const updated = ministerMemoryRepository.listMemory(scope);
    expect(updated).toHaveLength(1);
    expect(updated[0].state).toBe('executed');
    // Un mandato o una sedia diversi non vedono nulla: la memoria non è globale.
    expect(ministerMemoryRepository.listMemory({ ...scope, mandate: 'tesoro@ITA:altro' })).toHaveLength(0);
    expect(ministerMemoryRepository.listMemory({ ...scope, seat: 'guerra' })).toHaveLength(0);
  });

  it('con memoria vuota le letture tornano vuote, senza errori', () => {
    expect(ministerMemoryRepository.listMemory({
      gameId, branchId: mainBranch, seat: 'esteri', mandate: 'esteri@ITA:council',
    })).toHaveLength(0);
    expect(ministerMemoryRepository.listBranch({ gameId, branchId: mainBranch })).toHaveLength(1);
  });
});

describe('memoria del ministro: il rewind pota il futuro', () => {
  it('una decisione futura non resta nel passato', () => {
    const scope = { gameId, branchId: mainBranch, seat: 'tesoro' as const, mandate: 'tesoro@ITA:democristiani' };
    // Un ricordo del turno 1 (passato) e uno del turno 3 (futuro da annullare).
    ministerMemoryRepository.upsertRecords(scope, [
      record({ id: 'prima', refs: { gameDate: '1951-01-01', turn: 1 } }),
      record({ id: 'dopo', refs: { gameDate: '1951-03-01', turn: 3 } }),
    ]);
    // Il mondo è ripristinato al turno 1: `deleteAfterTurn(gameId, 0)`.
    db.prepare('UPDATE games SET current_turn = 1, current_date = ? WHERE id = ?').run('1951-01-01', gameId);
    gameRepository.deleteAfterTurn(gameId, 0);
    const remaining = ministerMemoryRepository.listMemory(scope).map((r: MinisterMemoryRecord) => r.id);
    expect(remaining).toContain('prima');
    expect(remaining).not.toContain('dopo');
  });
});

describe('memoria del ministro: il fork la copia sul ramo nuovo', () => {
  it('il ramo figlio eredita la memoria e il padre la conserva', () => {
    const scope = { gameId, branchId: mainBranch, seat: 'tesoro' as const, mandate: 'tesoro@ITA:democristiani' };
    expect(ministerMemoryRepository.listMemory(scope).some((r: MinisterMemoryRecord) => r.id === 'prima')).toBe(true);
    gameRepository.createBranch({ id: 'br-fork', gameId, name: 'ramo alternativo', parentBranchId: mainBranch });
    // Il figlio ha la stessa memoria del padre…
    const forked = ministerMemoryRepository.listBranch({ gameId, branchId: 'br-fork' });
    expect(forked.some((r: MinisterMemoryRecord) => r.id === 'prima')).toBe(true);
    // …con la nuova identità di ramo, e il padre non è stato svuotato.
    expect(gameRepository.getHeadBranch(gameId)).toBe('br-fork');
    expect(ministerMemoryRepository.listBranch({ gameId, branchId: mainBranch }).some((r: MinisterMemoryRecord) => r.id === 'prima')).toBe(true);
    // Una scrittura sul figlio non tocca il padre.
    ministerMemoryRepository.upsertRecords(
      { ...scope, branchId: 'br-fork' },
      [record({ id: 'solo-figlio' })],
    );
    expect(ministerMemoryRepository.listBranch({ gameId, branchId: 'br-fork' }).some((r: MinisterMemoryRecord) => r.id === 'solo-figlio')).toBe(true);
    expect(ministerMemoryRepository.listBranch({ gameId, branchId: mainBranch }).some((r: MinisterMemoryRecord) => r.id === 'solo-figlio')).toBe(false);
  });
});

describe('memoria del ministro: il percorso di lettura del prompt', () => {
  it('con memoria vuota la lettura per la sedia è vuota', () => {
    const emptySeat = (session as any).ministerMemoryFor('esteri');
    expect(emptySeat).toEqual([]);
  });

  it('una volta scritta, la memoria risale al prompt della sedia', () => {
    // Lo stesso mandato che deriva il server nel percorso di lettura.
    const government = (session as any).getGovernment();
    const polityId = (session as any).getPlayer()?.polityId ?? null;
    const mandate = mandateFor('esteri', government, polityId);
    ministerMemoryRepository.upsertRecords(
      { gameId, branchId: 'br-fork', seat: 'esteri', mandate },
      [record({ id: 'esteri-1', kind: 'open-question', state: 'open', summary: 'Porto da decidere' })],
    );
    const read = (session as any).ministerMemoryFor('esteri');
    expect(read.some((r: MinisterMemoryRecord) => r.id === 'esteri-1')).toBe(true);
  });
});
